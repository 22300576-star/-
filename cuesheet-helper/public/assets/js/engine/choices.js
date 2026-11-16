// 학부가 고른 피드백만 큐시트에 반영해 '피드백 반영본'을 만든다.
//  - 자동 정리(apply: 'auto')는 analyze의 disabled(fixId)로 켜고 끈다 → res.revised에 이미 들어가 있음
//  - 골라서 반영하는 수정(apply: 'op')과 음향·조명 제안(advice actions)은 여기서 res.revised 위에 적용
//  - 원본(첨부한 시트)은 건드리지 않는다
import { KEYS, PLACEHOLDER, MERGEABLE } from './constants.js';
import { buildBlocks } from './parser.js';
import { annotateKinds } from './context.js';
import { parseRunTime } from './time.js';
import { norm, PENDING_RE, OFF_ONLY_RE } from './vocab.js';
import { applyText, EX_RE } from './ops.js';
import { splitText } from './remedy.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const LIGHT_ROW_KEYS = ['lStage', 'lTop', 'pin1', 'pin2', 'pin3', 'pin4'];

// 반영 여부: 사용자가 고른 값 → 없으면 기본값
export function isChosen(item, choice) {
  if (item.apply === 'auto') return item.fixEnabled !== false;
  if (item.apply !== 'op' || !item.ops) return false;
  const c = choice && (choice instanceof Map ? choice.get(item.id) : choice[item.id]);
  return c === undefined ? !!item.defaultOn : !!c;
}

// 고를 수 있는 모든 항목 (피드백 + 무대별 제안)
export function choiceItems(res) {
  const out = res.findings.filter((f) => f.apply === 'auto' || f.apply === 'op');
  for (const a of res.advice || []) for (const act of a.actions || []) out.push(act);
  return out;
}

// '수정 후'를 고친 글로 작업을 바꾼다
export function editOps(item, text) {
  const op = item.ops[0];
  const t = String(text).replace(/\r/g, '').replace(/\n+$/, '');
  if (op.split) return [{ rowId: op.rowId, split: parseSplitText(t) }];
  if (op.replace) return [{ rowId: op.rowId, key: op.key, replace: [op.replace[0], t] }];
  return [{ rowId: op.rowId, key: op.key, set: t }];
}

// '00:40 ~ 00:52 (12초) 가사 1 / 가사 2' 줄들 → [{ runtime, lyrics }]
export function parseSplitText(text) {
  const rows = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    const m = line.match(/^\s*(\[?\d{1,2}:\d{2}\]?\s*~\s*\[?\d{1,2}:\d{2}\]?(?:\s*\([^)]*\))?)\s*(.*)$/);
    if (m) rows.push({ runtime: m[1].trim(), lyrics: m[2].split(/\s+\/\s+/).join('\n').trim() });
    else if (rows.length) rows[rows.length - 1].lyrics = `${rows[rows.length - 1].lyrics}\n${line.trim()}`.trim();
    else rows.push({ runtime: '', lyrics: line.trim() });
  }
  return rows;
}
export const editText = (item) => (item.ops && item.ops[0] && item.ops[0].split ? splitText(item.ops[0].split) : item.after);

function blankMarks() {
  return Object.fromEntries(KEYS.map((k) => [k, null]));
}
function mark(row, key, before, by, value) {
  row.marks = row.marks || blankMarks();
  const m = row.marks[key] || { changed: false, before: null, reasons: [], pending: false, placeholder: false, fixIds: [] };
  m.changed = true;
  if (m.before === null || m.before === undefined) m.before = before;
  m.by = by;
  m.placeholder = EX_RE.test(value) || norm(value) === PLACEHOLDER;
  m.pending = PENDING_RE.test(value);
  row.marks[key] = m;
}

// 한 곡을 여러 행으로 나눔: 첫 행은 원래 행(Run Time·개사만 바뀜), 나머지는 새 행
function splitRow(S, row, parts, by) {
  const at = S.rows.indexOf(row);
  if (at < 0 || !parts.length) return;
  const first = parts[0];
  const beforeRt = row.c.runtime;
  const beforeLy = row.c.lyrics;
  row.c.runtime = first.runtime;
  row.cont.runtime = false;
  mark(row, 'runtime', beforeRt, by, `[${first.runtime}]`); // Run Time은 고르게 나눈 예 → 확인 필요 표시
  if (first.lyrics) {
    row.c.lyrics = first.lyrics;
    row.cont.lyrics = false;
    mark(row, 'lyrics', beforeLy, by, first.lyrics);
  }
  const lightOn = (k) => {
    const v = norm(row.c[k]);
    return v && !OFF_ONLY_RE.test(v) && !/^X\b/.test(v);
  };
  const add = parts.slice(1).map((p, i) => {
    const nr = { id: `${row.id}-s${i + 2}`, src: null, kind: row.kind, inserted: true, c: {}, cont: {}, extra: {}, marks: blankMarks() };
    for (const k of KEYS) {
      nr.c[k] = '';
      nr.cont[k] = false;
    }
    for (const k of MERGEABLE) nr.cont[k] = true; // 항목·무대·대기 인원·음향·화면은 위 칸과 병합
    nr.c.runtime = p.runtime;
    mark(nr, 'runtime', '', by, `[${p.runtime}]`);
    nr.c.lyrics = p.lyrics || PLACEHOLDER; // 가사를 모르면 직접 채우기
    mark(nr, 'lyrics', '', by, nr.c.lyrics);
    nr.c.detail = PLACEHOLDER;
    mark(nr, 'detail', '', by, PLACEHOLDER);
    for (const k of LIGHT_ROW_KEYS) nr.c[k] = lightOn(k) || norm(row.c[k]) === '유지' ? '유지' : 'X';
    nr.c.details = 'X';
    return nr;
  });
  S.rows.splice(at + 1, 0, ...add);
}

/**
 * 고른 피드백을 반영한 큐시트
 * @param {object} res analyze() 결과
 * @param {Map|object} choice 항목 id → 반영 여부 (없으면 기본값)
 * @param {Map|object} edits 항목 id → 고친 '수정 후' 글
 * @returns {{ S, applied: string[], conflicts: Map<string, string[]> }}
 */
export function buildOutput(res, choice = new Map(), edits = new Map(), extra = []) {
  const S = clone(res.revised);
  const get = (m, k) => (m instanceof Map ? m.get(k) : m && m[k]);
  const rowById = () => new Map(S.rows.map((r) => [r.id, r]));
  let rows = rowById();
  const owners = new Map(); // 'rowId|key' → 그 칸을 통째로 바꾼 항목들
  const applied = [];
  const conflicts = new Map();
  // extra: 'AI 대안'에서 반영을 누른 문장처럼 항상 반영하는 작업 [{ id, ops }]
  for (const item of [...choiceItems(res), ...extra.map((x) => ({ ...x, apply: 'op', defaultOn: true, editable: false }))]) {
    if (item.apply === 'auto') {
      if (isChosen(item, choice)) applied.push(item.id);
      continue;
    }
    if (!isChosen(item, choice)) continue;
    const edited = get(edits, item.id);
    const ops = edited !== undefined && edited !== null && item.editable !== false && item.ops.length === 1 ? editOps(item, edited) : item.ops;
    let did = false;
    for (const op of ops) {
      const row = rows.get(op.rowId);
      if (!row) continue;
      if (op.split) {
        splitRow(S, row, op.split, item.id);
        rows = rowById();
        did = true;
        continue;
      }
      const before = row.cont[op.key] ? '' : row.c[op.key] || '';
      const value = applyText(before, op);
      if (op.set !== undefined) {
        const k = `${row.id}|${op.key}`;
        const prev = owners.get(k) || [];
        for (const p of prev) {
          conflicts.set(item.id, [...(conflicts.get(item.id) || []), p]);
          conflicts.set(p, [...(conflicts.get(p) || []), item.id]);
        }
        owners.set(k, [...prev, item.id]);
      }
      if (value === norm(before) && !row.cont[op.key]) continue;
      row.c[op.key] = value;
      row.cont[op.key] = false;
      mark(row, op.key, before, item.id, value);
      did = true;
    }
    if (did) applied.push(item.id);
  }
  // 행을 나눴으면 묶음·시간을 다시 계산
  S.blocks = buildBlocks(S.rows);
  annotateKinds(S, S.blocks);
  for (const r of S.rows) r.rt = parseRunTime(r.c.runtime);
  return { S, applied, conflicts };
}

// 반영 현황: 전체 고를 수 있는 항목 · 반영 · 수정요망 중 반영
export function choiceStats(res, choice) {
  const items = choiceItems(res);
  const on = items.filter((i) => isChosen(i, choice));
  const todo = res.findings.filter((f) => f.level === 'error' || f.level === 'warn');
  return {
    total: items.length,
    on: on.length,
    auto: on.filter((i) => i.apply === 'auto').length,
    picked: on.filter((i) => i.apply !== 'auto').length,
    todo: todo.length,
    todoOn: todo.filter((f) => isChosen(f, choice)).length,
    manual: todo.filter((f) => f.apply === 'manual' || f.apply === 'none').length,
  };
}

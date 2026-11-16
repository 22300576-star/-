// 피드백마다 '원래 → 수정 후'와, 반영하면 큐시트에 실제로 적용할 작업(ops)을 붙인다.
//  before / after : 학부가 처음 적은 내용 / 피드백을 반영한 모습
//  apply          : 'auto'(사이트가 고치는 형식 정리 — fixId로 켜고 끔) · 'op'(골라서 반영하는 수정) · 'manual'(직접 고쳐야 함) · 'none'
//  ops            : [{ rowId, key, set } | { rowId, key, append } | { rowId, key, suffix } | { rowId, key, replace: [from, to] } | { rowId, split: [{ runtime, lyrics }] }]
//  sure           : 시트 안의 값만으로 계산한 확실한 수정(기본으로 반영) — 아니면 예시라 학부가 골라서 반영
//  editable       : 반영 전에 '수정 후' 문구를 고칠 수 있는지 (ops가 칸 하나일 때)
//  pairs          : 여러 칸을 바꾸는 경우 칸별 원래 → 수정 후 [{ loc, before, after }]
//  merged · also  : 같은 칸을 바꾸는 피드백을 한 장으로 묶은 것(첫 피드백이 최종 문구를 맡음) · 함께 해결되는 피드백 제목
//  dupOf · choiceId : 묶여 들어간 피드백 — 따로 보이지 않고, 반영 여부는 묶은 피드백을 따른다
import { fmtClock, fmtRunTime, fmtDurationKo, parseRunTime } from './time.js';
import { norm, isBlank, OFF_ONLY_RE, PENDING_RE, SUBJECTIVE_RE, ZONE_RE, COLOR_WORD_RE, FX_TYPES, LOC_WORDS, INSTRUMENT_RE } from './vocab.js';
import { PIN_POS, PIN_KEYS, LIGHT_KEYS, PLACEHOLDER, STAGE_LIMIT_SEC, colName } from './constants.js';
import { josa } from './josa.js';
import { micsFor } from './rules-stagecraft.js';
import { lightPlanRow, describeRowLight, shortLyric } from './advice.js';
import { applyText, EX_RE } from './ops.js';

export { applyText, EX_RE };

// '수정 후' 표시 이름
export const AFTER_LABEL = { auto: '자동 정리', off: '자동 정리 · 반영 안 함', example: '반영하면 이렇게', guide: '고칠 방향' };

const one = (t) => norm(t).replace(/\n+/g, ' / ');
const ex = (t) => `[${t}]`;
const label = (b) => ((b && b.item) || '').split('\n')[0].trim();

// 처음 적은 값: 자동 수정·작성 필요 표시 전의 값
export function originalValue(row, key) {
  if (!row) return '';
  const m = row.marks && row.marks[key];
  const v = m && m.before !== null && m.before !== undefined ? m.before : row.c[key];
  return v === PLACEHOLDER ? '' : norm(v);
}
// 지금(자동 정리 뒤) 칸 값 — 작업은 이 값에 적용된다
const cur = (row, key) => {
  const v = row.cont[key] ? '' : norm(row.c[key]);
  return v === PLACEHOLDER ? '' : v;
};

function blockLen(b) {
  const t = b.rows.filter((r) => r.rt && r.rt.ok);
  return t.length ? Math.max(...t.map((r) => r.rt.end)) - Math.min(...t.map((r) => r.rt.start)) : 0;
}

// 무대·단상 위 사람: 시트 전체에서 '콰이어 24명', '댄서 16명'처럼 숫자를 찾는다
function headcounts(S) {
  const all = S.rows.map((r) => [r.c.stage, r.c.waiting, r.c.detail].join('\n')).join('\n');
  const out = {};
  for (const [k, re] of [
    ['콰이어', /(콰이어|합창단)\s*(\d+)\s*명/],
    ['댄서', /(댄서|안무팀)\s*(\d+)\s*명/],
  ]) {
    const m = all.match(re);
    if (m) out[k] = Number(m[2]);
  }
  return out;
}

// 가사를 슬라이드(2줄) 단위로 나눈 행 (Run Time은 고르게 나눈 예)
export function splitPlan(start, end, lyrics) {
  const lines = lyrics.length ? lyrics : [];
  const n = Math.max(2, Math.min(8, lines.length ? Math.ceil(lines.length / 2) : Math.round((end - start) / 20)));
  const step = (end - start) / n;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const s = Math.round(start + step * i);
    const e = i === n - 1 ? end : Math.round(start + step * (i + 1));
    rows.push({ runtime: fmtRunTime(s, e), lyrics: lines.slice(i * 2, i * 2 + 2).join('\n') });
  }
  return rows;
}
export const splitText = (rows) => rows.map((r) => `${r.runtime}${r.lyrics ? ` ${r.lyrics.replace(/\n/g, ' / ')}` : ''}`).join('\n');

const lyricsOf = (r) =>
  norm(r.c.lyrics)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(x|간주|전주|후주|없음|-)$/i.test(l) && !/^\(.*\)$/.test(l) && !PENDING_RE.test(l));

// '구역 / 색상 / 밝기%'에서 빠진 것을 채운 예시
function fillZone(text, key, st, x) {
  const m = st ? st.mood : { top: '하늘색', low: 30, high: 90 };
  const pct = !x ? 70 : x.phase === '절정' ? 100 : x.phase === '도입' ? (key === 'lTop' ? m.low : 40) : x.phase === '마무리' ? 50 : 70;
  return norm(text)
    .split('\n')
    .map((line) => {
      if (!line.trim() || OFF_ONLY_RE.test(line) || /^X\b/.test(line) || /^유지/.test(line)) return line;
      const zone = (line.match(ZONE_RE) || [])[0];
      const color = (line.match(COLOR_WORD_RE) || line.match(/#[0-9a-f]{3,6}/i) || [])[0];
      const p = (line.match(/(\d{1,3})\s*%/) || [])[1];
      const time = (line.match(/^\s*\d{1,2}:\d{2}\s*/) || [''])[0];
      return `${time}${zone || ex('전체')} / ${color || (key === 'lTop' ? ex(m.top) : ex('흰색'))} / ${p ? `${p}%` : ex(`${pct}%`)}`;
    })
    .join('\n');
}

// 시트 안에서 찾을 수 있는 정보로 '수정 후'와 반영 작업을 만든다
export function attachRemedies(ctx, stages) {
  const { S } = ctx;
  const rowById = new Map(S.rows.map((r) => [r.id, r]));
  const rowIndex = new Map(S.rows.map((r, i) => [r.id, i]));
  const stageOf = new Map(stages.map((st) => [st.block.index, st]));
  const xOf = (row) => {
    const st = row && stageOf.get(row.blockIndex);
    return st ? st.rows.find((x) => x.row === row) : null;
  };
  const counts = headcounts(S);
  const loc = (rowId, key) => `${(rowIndex.get(rowId) ?? 0) + 5}행 ${colName(key)}`;
  const timedContent = S.rows.filter((r) => (r.kind === 'stage' || r.kind === 'video') && r.rt && r.rt.ok);
  const prevTimed = (row) => {
    const i = rowIndex.get(row.id);
    return [...timedContent].reverse().find((r) => rowIndex.get(r.id) < i) || null;
  };
  const nextBlockStage = (b) => S.blocks.slice(b.index + 1).find((x) => x.kind === 'stage');
  const withCounts = (t) =>
    norm(t).replace(/(콰이어|합창단|댄서|안무팀)(들)?(?!\s*\d)/g, (m, w) => {
      const k = /콰이어|합창단/.test(w) ? '콰이어' : '댄서';
      return `${w} ${counts[k] ? `${counts[k]}명` : ex('n명')}`;
    });
  const set = (row, key, value) => ({ rowId: row.id, key, set: value });
  // 여러 칸을 바꾸는 작업 → 칸별 원래 → 수정 후
  const pairsOf = (ops) =>
    ops
      .filter((o) => o.key)
      .map((o) => {
        const r = rowById.get(o.rowId);
        return { loc: loc(o.rowId, o.key), before: one(originalValue(r, o.key)), after: one(applyText(cur(r, o.key), o)) };
      });

  // '합창 마이크 4개, 무선 마이크 3개' → { 합창: 4, 무선: 3 }
  const micCounts = (t) => {
    const out = {};
    for (const m of norm(t).matchAll(/(합창|무선|유선|핸드|헤드셋)\s*(?:마이크)?\s*\(?\s*(\d+)\s*\)?\s*(?:개|대|ea)?/gi)) out[m[1]] = (out[m[1]] || 0) + Number(m[2]);
    return out;
  };
  // FX 문장 '수정 후': 많이 쓴 효과 2개에 FX1·FX2를 붙이고, 나머지는 빼고, 스트로브는 짧게, 시각이 없으면 앞에 붙인다
  const fxRank = (() => {
    const uses = new Map();
    for (const r of S.rows) for (const k of [...LIGHT_KEYS, 'details', 'note']) for (const t of FX_TYPES) if (t.re.test(r.c[k] || '')) uses.set(t.key, (uses.get(t.key) || 0) + 1);
    const labeled = new Map();
    for (const r of S.rows)
      for (const line of norm(r.c.details).split('\n')) {
        const m = line.match(/FX\s*([12])/i);
        if (m) for (const t of FX_TYPES) if (t.re.test(line)) labeled.set(t.key, `FX${m[1]}`);
      }
    const order = [...uses.keys()].sort((a, b) => (labeled.has(b) ? 1 : 0) - (labeled.has(a) ? 1 : 0) || (uses.get(b) || 0) - (uses.get(a) || 0));
    const map = new Map();
    const free = ['FX1', 'FX2'].filter((l) => ![...labeled.values()].includes(l));
    for (const k of order) map.set(k, labeled.get(k) || free.shift() || null);
    return map;
  })();
  const fxLine = (line, row) => {
    const parts = line.split(/,\s*/);
    const out = [];
    const dropped = [];
    for (let p of parts) {
      const t = FX_TYPES.find((x) => x.re.test(p));
      if (t) {
        const lab = fxRank.get(t.key);
        if (!lab) {
          dropped.push(t.name);
          continue;
        }
        // '후렴에서 스트로브 …'처럼 앞에 시점이 있으면 효과 이름 앞에, 아니면 맨 앞에 FX 이름을 붙인다
        if (!/FX\s*[12]/i.test(p)) p = /^\s*\S+(?:에서|에)\s/.test(p) ? p.replace(t.re, (w) => `${lab} ${w}`) : `${lab} ${p.trim()}`;
        if (t.key === 'strobe') p = p.replace(/(\d+)\s*초/, (w, n) => (Number(n) > 3 ? '2초' : w));
      }
      out.push(p);
    }
    const x = xOf(row);
    const time = /\d{1,2}:\d{2}/.test(line) ? '' : x && x.start != null && x.phase !== '전체' && x.phase !== '도입' ? `${fmtClock(x.start)} ` : `${ex('03:38')} `;
    return `${time}${out.join(', ')}${dropped.length ? ` (${dropped.join('·')}은 빼기 — FX는 2개까지)` : ''}`;
  };
  // 한 칸 안의 한 줄을 바꾸는 작업 (FX 문장 등)
  const lineOp = (row, key, from, to) => ({ rowId: row.id, key, replace: [from, to] });

  // 세부 내용 예시 (행 하나)
  const detailExample = (row, before = '') => {
    const b = S.blocks[row.blockIndex];
    if (b.kind === 'video') {
      const next = nextBlockStage(b);
      const nst = next && stageOf.get(next.index);
      const p0 = nst && nst.protags[0];
      const from = p0 && p0.move ? (p0.move.match(/([가-힣A-Za-z0-9]+(?:\s[가-힣A-Za-z0-9]+){0,3})에서/) || [])[1] : '';
      const who = p0 ? `${josa(p0.name, '은/는')} ${from || (p0.zoneName ? `무대 ${p0.zoneName}` : ex('무대 왼쪽 계단 아래'))}` : '';
      const dancers = counts['댄서'] ? `댄서 ${counts['댄서']}명` : `댄서 ${ex('n명')}`;
      return `${josa(label(b), '이/가')} 나오는 동안 ${dancers}은 ${ex('무대 양 옆')}에서 ${next ? `${label(next)} ` : ''}첫 대형 위치로 이동해 대기${who ? `, ${who}에서 대기` : ''}`;
    }
    const x = xOf(row);
    const st = stageOf.get(b.index);
    const t = x && x.start != null ? `${fmtClock(x.start)} ` : '';
    const cue = x && x.lyrics.length ? `가사 "${shortLyric(x.lyrics[0], 3)}"에 맞춰 ` : x && x.phase === '도입' ? '전주가 시작되면 ' : '';
    if (before) {
      const who = /댄서|안무/.test(before) || (x && x.dance) ? (st && st.dancers ? `댄서 ${st.dancers}명이` : `댄서 ${counts['댄서'] ? `${counts['댄서']}명` : ex('n명')}이`) : /합창|노래|콰이어/.test(before) ? `콰이어 ${st && st.choir ? `${st.choir}명` : ex('n명')}이` : `${ex('댄서 16명')}이`;
      const what = /합창|노래/.test(before) && !/안무/.test(before) ? `단상에서 ${ex('3줄로 서서')} 노래` : `${ex('무대 중앙')}에서 ${ex('2줄 대형')}으로 ${/안무|춤/.test(before) ? '안무' : ex('동작')}`;
      return `${t}${cue}${who} ${what}${/전체|단체/.test(before) ? `, ${ex('후렴에 가운데 4명이 앞으로 나옴')}` : ''}`;
    }
    const who = st && st.dancers ? `댄서 ${st.dancers}명이` : counts['댄서'] ? `댄서 ${counts['댄서']}명이` : `${ex('댄서 16명')}이`;
    const choir = st && st.choir ? `, 콰이어 ${st.choir}명은 단상에서 노래` : '';
    return `${t}${cue}${who} ${ex('무대 중앙')}에서 ${ex('2줄 대형으로 안무')}${choir}`;
  };
  const lyricsExample = (row) => {
    const x = xOf(row);
    return x && (x.dance || x.phase === '도입') ? ex('간주') : ex('그 구간의 가사 — 없으면 간주 또는 X');
  };

  const R = {
    'time:limit': () => {
      const over = S.totalSec - STAGE_LIMIT_SEC;
      const list = S.blocks
        .filter((b) => b.kind === 'stage' || b.kind === 'video')
        .map((b) => ({ b, len: blockLen(b) }))
        .filter((v) => v.len > 0)
        .sort((a, b) => b.len - a.len);
      const pick = list.find((v) => v.b.kind === 'video' && v.len - over >= 20) || list[0];
      return {
        before: `무대 시간 ${fmtDurationKo(S.totalSec)} (11분보다 ${fmtDurationKo(over)} 김)`,
        after: `무대 시간 11분 이내${pick ? ` — 예) ${label(pick.b)} ${fmtDurationKo(pick.len)} → ${fmtDurationKo(pick.len - over)}로 줄이기(여러 순서에서 나눠 줄여도 됨)` : ''}`,
        afterKind: 'guide',
        manual: '어느 순서를 얼마나 줄일지는 학부가 정해야 해서 자동으로 반영하지 않습니다.',
      };
    },
    'time:split1': (f, row) => {
      if (!row.rt || !row.rt.ok) return null;
      const rows = splitPlan(row.rt.start, row.rt.end, lyricsOf(row));
      return { after: splitText(rows), ops: [{ rowId: row.id, split: rows }], afterNote: `반영하면 ${rows.length}행으로 나눕니다 — Run Time은 고르게 나눈 예라 실제 슬라이드 시각으로 확인` };
    },
    'lyrics:long': (f, row) => {
      if (!row.rt || !row.rt.ok) return null;
      const rows = splitPlan(row.rt.start, row.rt.end, lyricsOf(row));
      return { after: splitText(rows), ops: [{ rowId: row.id, split: rows }], afterNote: `반영하면 가사 슬라이드(2줄)마다 ${rows.length}행으로 나눕니다` };
    },
    'time:split': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const untimed = b.rows.filter((r) => !(r.rt && r.rt.ok) && !r.cont.runtime);
      const p = prevTimed(untimed[0] || row);
      const next = b.rows.slice(b.rows.indexOf(untimed[untimed.length - 1]) + 1).find((r) => r.rt && r.rt.ok);
      if (!p || !next || next.rt.start <= p.rt.end) return { after: `${ex('00:00')} ~ ${ex('00:00')} (${ex('n')}초)`, ops: [set(row, 'runtime', `${ex('00:00')} ~ ${ex('00:00')} (${ex('n')}초)`)] };
      const step = (next.rt.start - p.rt.end) / untimed.length;
      const ops = untimed.map((r, i) => set(r, 'runtime', fmtRunTime(Math.round(p.rt.end + step * i), Math.round(p.rt.end + step * (i + 1)))));
      return { after: ops[0].set, ops, afterNote: '앞 행 끝 시각부터 고르게 나눈 예 — 실제 시각으로 확인' };
    },
    'time:missing': (f, row) => {
      const p = prevTimed(row);
      const s = p ? p.rt.end : null;
      const v = s == null ? `${ex('00:00')} ~ ${ex('01:00')} (${ex('60')}초)` : `${fmtClock(s)} ~ ${ex(fmtClock(s + 60))} (${ex('60')}초)`;
      return { after: v, ops: [set(row, 'runtime', v)], afterNote: s == null ? '' : `앞 순서가 ${fmtClock(s)}에 끝나므로 ${fmtClock(s)}부터 — 끝 시각은 실제 길이로` };
    },
    'time:gap': (f, row) => {
      const p = prevTimed(row);
      if (!p || !row.rt.ok) return null;
      const v = fmtRunTime(p.rt.end, row.rt.end);
      return { after: v, ops: [set(row, 'runtime', v)], sure: true, afterNote: `앞 행이 끝나는 ${fmtClock(p.rt.end)}부터 이어지게(그 사이에 일이 있으면 시트에서 행을 추가)` };
    },
    'time:overlap': (f, row) => {
      const p = prevTimed(row);
      if (!(p && row.rt.ok && row.rt.end > p.rt.end)) return null;
      const v = fmtRunTime(p.rt.end, row.rt.end);
      return { after: v, ops: [set(row, 'runtime', v)], sure: true, afterNote: `앞 행이 끝나는 ${fmtClock(p.rt.end)}부터 시작` };
    },
    'time:order': (f, row) => {
      if (row.rt.start == null || row.rt.end == null) return null;
      const v = fmtRunTime(Math.min(row.rt.start, row.rt.end), Math.max(row.rt.start, row.rt.end));
      return { after: v, ops: [set(row, 'runtime', v)] };
    },
    'time:uncertain': (f, row) => {
      const rt = parseRunTime(norm(row.c.runtime).replace(/(약|±\s*\d+\s*초?|정도|쯤)/g, ''));
      if (!rt.ok) return null;
      const v = fmtRunTime(rt.start, rt.end);
      return { after: v, ops: [set(row, 'runtime', v)], sure: true, afterNote: '확정된 길이로(±, 약 빼기)' };
    },
    'time:dur': () => ({ after: `${ex('앞 순서 끝 시각')} ~ ${ex('끝 시각')} (n초)`, afterKind: 'guide', manual: '앞 순서의 Run Time을 먼저 채우면 자동으로 이어서 계산됩니다.' }),
    'time:rebase': () => ({ after: '앞 순서 끝 시각부터 이어지는 전체 타임라인', afterKind: 'guide', manual: '앞 영상 행에 길이를 적으면 자동으로 이어서 계산됩니다.' }),

    'stage:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const st = stageOf.get(b.index);
      const parts = [];
      if (st) for (const p of st.protags) parts.push(`${p.name} ${p.zoneName ? `무대 ${p.zoneName}` : ex('무대 중앙')}`);
      const d = norm(b.rows.map((r) => r.c.detail).join(' '));
      if (/댄서/.test(d) || (st && st.dancers)) parts.push(`댄서 ${counts['댄서'] ? `${counts['댄서']}명` : ex('n명')} 무대`);
      if (b.kind === 'stage' || /콰이어|합창/.test(d)) parts.push(`콰이어 ${counts['콰이어'] ? `${counts['콰이어']}명` : ex('n명')} 단상`);
      if (!parts.length) parts.push(`${ex('댄서 16명')} 무대`, `${ex('콰이어 24명')} 단상`);
      const v = parts.join(' / ');
      return { after: v, ops: [set(row, 'stage', v)] };
    },
    'stage:count': (f, row) => {
      const before = cur(row, 'stage');
      let after = withCounts(before);
      const all = [counts['콰이어'] ? `콰이어 ${counts['콰이어']}명` : '', counts['댄서'] ? `댄서 ${counts['댄서']}명` : ''].filter(Boolean).join(' · ');
      if (after === before && /(전원|모두|전체)/.test(before)) after = before.replace(/(전원|모두|전체)/, `$1(${all || ex('콰이어 24명 · 댄서 16명')})`);
      if (after === before) after = `${before} ${ex('콰이어 24명 단상 / 댄서 16명 무대')}`;
      return { after, ops: [set(row, 'stage', after)] };
    },
    'wait:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const next = nextBlockStage(b);
      const st = next && stageOf.get(next.index);
      const v = st && st.dancers && b.kind === 'video' ? `댄서 ${ex(`${st.dancers}명`)}` : ex('X');
      return { after: v, ops: [set(row, 'waiting', v)], afterNote: '무대 아래 대기 인원이 없으면 X, 있으면 인원 수' };
    },
    'wait:num': (f, row) => {
      const before = cur(row, 'waiting');
      const after = withCounts(before);
      const v = after !== before ? after : `${before} ${ex('n명')}`;
      return { after: v, ops: [set(row, 'waiting', v)] };
    },

    'detail:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const blanks = b.rows.filter((r) => !r.cont.detail && !originalValue(r, 'detail'));
      const ops = (blanks.length ? blanks : [row]).map((r) => set(r, 'detail', detailExample(r)));
      return { after: ops[0].set, ops };
    },
    'detail:vague': (f, row) => {
      const ids = f.rows && f.rows.length ? f.rows : [row.id];
      const ops = ids.map((id) => rowById.get(id)).filter(Boolean).map((r) => set(r, 'detail', detailExample(r, cur(r, 'detail') || originalValue(r, 'detail'))));
      return { after: ops[0].set, ops };
    },
    'lyrics:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const blanks = b.rows.filter((r) => !r.cont.lyrics && !originalValue(r, 'lyrics'));
      const ops = (blanks.length ? blanks : [row]).map((r) => set(r, 'lyrics', lyricsExample(r)));
      return { after: ops[0].set, ops, afterNote: '가사가 없는 구간은 간주, 노래 없이 동작만 있으면 X' };
    },

    'sound:blank': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      let v = `합창 마이크 ${ex('4')}개 (단상 앞)`;
      if (st) {
        const lines = [];
        if (st.rows.some((x) => x.singing)) lines.push(`합창 마이크 ${ex(String(micsFor(st.choir)))}개 (단상 앞${st.choir ? `, 콰이어 ${st.choir}명` : ''})`);
        const singers = st.protags.filter((p) => p.sings);
        if (singers.length) lines.push(`무선 마이크 ${Math.min(2, singers.length)}개 (${singers.map((p) => p.name).join(', ')})`);
        for (const inst of st.instruments) lines.push(`${inst} ${/(기타|피아노|건반|키보드|베이스)/.test(inst) ? 'DI' : '마이킹'} 1개`);
        if (st.dialogue) lines.push(`핸드 마이크 1개 (${ex('내레이션')})`);
        v = lines.length ? lines.join('\n') : ex('X (마이크 사용 안 함)');
      }
      return { after: v, ops: [set(row, 'sound', v)] };
    },
    'sound:count': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = cur(row, 'sound');
      const n = micsFor(st && st.choir);
      let after = before
        .replace(/(합창\s*마이크)(?!\s*\d)/g, `$1 ${ex(String(n))}개${st && st.choir ? ` (콰이어 ${st.choir}명)` : ''}`)
        .replace(/((?:무선|유선|핸드|솔로)\s*마이크)(?!\s*\d)/g, `$1 ${ex('1')}개`)
        .replace(/^마이크(?!\s*\d)/, `마이크 ${ex('n')}개`);
      if (after === before) after = `${before} ${ex('4')}개`;
      return { after, ops: [set(row, 'sound', after)] };
    },
    'sound:wireless': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = cur(row, 'sound');
      const who = st && st.protags.length ? st.protags.slice(0, 2).map((p) => p.name).join(', ') : ex('주인공, 솔로 1');
      const from = (before.match(/무선\s*마이크\s*\(?\s*\d+\s*\)?\s*개?/) || [''])[0];
      if (!from) return null;
      const to = `무선 마이크 2개 (${who})`;
      return { before: from, after: to, ops: [lineOp(row, 'sound', from, to)], afterNote: '기본 2대 — 더 필요하면 TFT 음향팀과 확인' };
    },
    'sound:who': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = cur(row, 'sound');
      const who = st && st.protags.length ? st.protags.map((p) => p.name).join(', ') : ex('솔로 1, 솔로 2');
      const from = (before.match(/(?:무선|유선|핸드|솔로)\s*마이크\s*\d+\s*개(?!\s*\()/) || [''])[0];
      if (from) return { before: from, after: `${from} (${who})`, ops: [lineOp(row, 'sound', from, `${from} (${who})`)] };
      const add = `(${who} 사용 · ${ex('00:52')}에 ON)`;
      return { after: applyText(before, { append: add }), ops: [{ rowId: row.id, key: 'sound', append: add }] };
    },
    'sound:inst': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const inst = (b.rows.map((r) => `${r.c.sound} ${r.c.detail} ${r.c.note}`).join(' ').match(INSTRUMENT_RE) || [])[0] || '악기';
      const add = `${inst} ${/(기타|피아노|건반|키보드|베이스)/.test(inst) ? 'DI' : '마이킹'} 1개`;
      return { after: applyText(cur(row, 'sound'), { append: add }), ops: [{ rowId: row.id, key: 'sound', append: add }] };
    },
    'sound:fd': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const curB = b.kind === 'stage' ? b : nextBlockStage(b) || b;
      const prev = [...S.blocks.slice(0, curB.index)].reverse().find((x) => x.kind === 'stage');
      const st = stageOf.get(curB.index);
      const people = st ? st.protags.filter((p) => p.sings) : [];
      const to = people.length ? people.map((p) => `${p.name}${p.zoneName ? `(무대 ${p.zoneName})` : ''}`).join(', ') : ex('솔로 1');
      const a = micCounts(prev ? prev.rows.map((r) => r.c.sound).join('\n') : '');
      const z = micCounts(curB.rows.map((r) => r.c.sound).join('\n'));
      const acts = [];
      for (const k of new Set([...Object.keys(a), ...Object.keys(z)])) {
        const d = (z[k] || 0) - (a[k] || 0);
        if (d > 0) acts.push(k === '무선' || k === '핸드' ? `${k} 마이크 ${d}개를 ${to}에게 전달` : `${k} 마이크 ${d}개를 ${ex('단상 앞')}에 세팅`);
        if (d < 0) acts.push(`${k} 마이크 ${-d}개 회수`);
      }
      const when = b.kind === 'video' ? `${josa(label(b), '이/가')} 송출되는 동안` : '무대 전환 중';
      const add = `${when} FD가 ${acts.length ? acts.join(', ') : `${ex('합창 마이크 4개를 단상 앞')}에 세팅, 무선 마이크 1개를 ${to}에게 전달`}`;
      return { after: applyText(cur(row, f.key), { append: add }), ops: [{ rowId: row.id, key: f.key, append: add }] };
    },
    'screen:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const st = stageOf.get(b.index);
      const sing = st && st.rows.some((x) => x.singing);
      const n = S.blocks.filter((x) => x.kind === 'stage' && x.index <= b.index).length;
      const v = sing ? ex(`가사 영상 ${n}`) : ex('X (검은 화면)');
      return { after: v, ops: [set(row, 'screen', v)], afterNote: '가사를 띄운다면 가사 영상, 아니면 PPT / X' };
    },

    'light:none': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      if (!st) return null;
      const ops = [];
      for (const x of st.rows) {
        const p = lightPlanRow(st, x);
        const r = x.row;
        if (!r.cont.lStage) ops.push(set(r, 'lStage', p.lStage));
        if (!r.cont.lTop) ops.push(set(r, 'lTop', p.lTop));
        for (const k of PIN_KEYS) if (!r.cont[k]) ops.push(set(r, k, p.pins[k] || 'X'));
        if (!r.cont.details) ops.push(set(r, 'details', ex(p.cue)));
      }
      const first = st.rows[0] && lightPlanRow(st, st.rows[0]);
      return {
        after: first ? `무대 ${first.lStage} · 상단 ${first.lTop} · Details: ${first.cue}${st.rows.length > 1 ? ` … 외 ${st.rows.length - 1}행` : ''}` : '',
        ops,
        afterNote: `${st.mood.name ? `${st.mood.name} 곡이라 상단 ${st.mood.top}` : '상단 색 하나를 정해'} 도입은 어둡게, 절정은 밝게 — 무대 연출 계획의 예`,
      };
    },
    'light:details': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      if (!st) return null;
      const ids = f.rows && f.rows.length ? f.rows : [row.id];
      const ops = ids
        .map((id) => rowById.get(id))
        .filter(Boolean)
        .map((r) => {
          const x = xOf(r);
          if (!x) return null;
          return set(r, 'details', describeRowLight(st, x) || ex(lightPlanRow(st, x).details));
        })
        .filter(Boolean);
      if (!ops.length) return null;
      return { after: ops[0].set, ops, afterNote: '이 행의 조명 칸을 말로 풀어 언제·어떻게 바뀌는지' };
    },
    'light:transition': (f, row) => {
      const ids = f.rows && f.rows.length ? f.rows : [row.id];
      const ops = ids
        .map((id) => rowById.get(id))
        .filter(Boolean)
        .map((r) => {
          const x = xOf(r);
          const how = x && x.phase === '절정' ? '즉시' : x && x.phase === '마무리' ? '3초에 걸쳐 서서히' : x && x.phase === '도입' ? '2초에 걸쳐 서서히' : '즉시';
          return { rowId: r.id, key: 'details', suffix: ` (${ex(how)} 바꾸기)` };
        });
      return { after: applyText(cur(row, 'details'), ops[0]), ops };
    },
    'light:subjective': (f, row) => {
      const x = xOf(row);
      const before = cur(row, 'details');
      const phrase = (before.match(SUBJECTIVE_RE) || [''])[0];
      const cue = x && x.lyrics.length ? `가사 "${shortLyric(x.lyrics[0], 3)}" 시작과 동시에` : x && x.start != null ? `${fmtClock(x.start)}에` : ex('출연자 전원이 무대 중앙에 정렬한 후');
      const t = x && x.start != null && !/^\d{1,2}:\d{2}/.test(before) ? `${fmtClock(x.start)} ` : '';
      // '분위기가 고조될 때' 처럼 뒤에 붙은 말(될 때, 에, 하면)까지 한꺼번에 바꾼다
      const clause = phrase ? new RegExp(`${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\S*(?:\\s*(?:때|에|면))?`) : null;
      const v = `${t}${clause ? before.replace(clause, cue) : `${cue} ${before}`}`.replace(/[ \t]+/g, ' ').trim();
      return { after: v, ops: [set(row, 'details', v)] };
    },
    'light:zone': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = originalValue(row, f.key);
      const sentence = /[가-힣]{2,}(?:주세요|합니다|됩니다|니다|해요|하기|켜기|in|out)\.?$/i.test(norm(before)) || /(서서히|즉시|fade)/i.test(before);
      const v = fillZone(cur(row, f.key) || before, f.key, st, xOf(row));
      return { after: v, ops: [set(row, f.key, v)], afterNote: sentence ? '언제·어떻게 바뀌는지 쓴 문장은 Details 칸으로 옮기기' : '' };
    },
    'light:pinfollow': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const p = st && (st.protags.find((q) => q.pin) || st.protags[0]);
      const pin = p && p.pin ? PIN_POS[p.pin] : PIN_POS[f.key] || PIN_POS.pin3;
      const who = p ? p.name : ex('주인공');
      const d = cur(row, 'details');
      const v = `${josa(who, '이/가')} ${pin.where}(${pin.name} 자리)에 서면 ${pin.name} 즉시 ON`;
      const core = d.replace(/[\s\d:~.,/()-]/g, '');
      // Details가 '따라가기' 한 문장뿐이면 그 문장을 바꾸고, 다른 내용이 많으면 직접 고치기
      if (/따라/.test(d) && core.length <= 20) return { before: d, after: v, ops: [set(row, 'details', v)], afterNote: '핀은 따라가지 않고 정해진 자리만 비춤 — 걸어오는 동안은 무대 조명 구역을 차례로' };
      return { before: /따라/.test(d) ? d : originalValue(row, f.key), after: v, afterKind: 'guide', manual: 'Details에 다른 내용이 함께 있어, 핀이 따라가는 부분만 직접 고쳐 주세요.' };
    },
    'light:pinloc': (f, row) => {
      const key = originalValue(row, f.key) ? f.key : PIN_KEYS.find((k) => originalValue(row, k)) || f.key;
      const before = originalValue(row, key);
      const z = LOC_WORDS.find((w) => w.re.test(before));
      const place = z ? (before.match(z.re) || [''])[0] : '';
      const better = z && Object.values(PIN_POS).find((p) => p.zone === z.zone);
      const pinName = PIN_POS[key] ? PIN_POS[key].name : 'Pin';
      if (better) {
        const betterKey = Object.keys(PIN_POS).find((k) => PIN_POS[k] === better);
        const ops = [set(row, key, 'X'), set(row, betterKey, 'ON')];
        return { before, after: `${pinName}: X / ${better.name}: ON (${better.where})`, ops, pairs: pairsOf(ops) };
      }
      const ops = [set(row, key, 'X'), { rowId: row.id, key: 'details', append: `FX${ex('1')} 추가 핀: ${place || ex('객석 통로')}` }];
      return { before, after: `${pinName}: X — Details에 'FX${ex('1')} 추가 핀: ${place || ex('객석 통로')}'`, ops, pairs: pairsOf(ops), afterNote: 'Pin1~4는 무대 위 고정 위치만 비춤' };
    },
    'light:pingroup': (f, row) => {
      const key = originalValue(row, f.key) ? f.key : PIN_KEYS.find((k) => originalValue(row, k)) || f.key;
      f.key = key;
      const before = originalValue(row, key);
      const z = LOC_WORDS.find((w) => w.re.test(before));
      const zone = /(콰이어|합창|단상|전원|전체)/.test(before) ? '전체' : z ? { left: '왼쪽', right: '오른쪽', center: '중앙', back: '전체' }[z.zone] || '전체' : ex('왼쪽');
      const color = (before.match(COLOR_WORD_RE) || ['흰색'])[0];
      const pct = (before.match(/\d{1,3}\s*%/) || [ex('70%')])[0];
      const line = `${zone} / ${color} / ${pct}`;
      const ops = [set(row, key, 'X'), { rowId: row.id, key: 'lStage', append: line }];
      return { before, after: `${PIN_POS[key] ? `${PIN_POS[key].name}: X / ` : ''}무대: ${line}`, ops, pairs: pairsOf(ops), afterNote: '그룹은 무대 조명 구역으로, 핀은 1명만' };
    },
    'light:pincolor': (f, row) => ({ after: 'ON', ops: [set(row, f.key, 'ON')], afterNote: '색이 필요한 연출은 무대·상단 조명이나 FX로' }),
    'light:hspan': () => ({ after: '무대 / 상단 / Pin1~4 / Details 칸마다 나눠 적기', afterKind: 'guide', manual: '한 문장을 여러 칸으로 나누는 일이라 직접 고쳐 주세요.' }),
    'light:outside': (f, row) => ({ after: `${fmtClock(row.rt.start)}~${fmtClock(row.rt.end)} 안의 시각으로 고치거나, 그 시각의 행으로 옮기기`, afterKind: 'guide', manual: '어느 시각이 맞는지는 학부가 확인해야 합니다.' }),
    'light:nosheet': () => ({ before: '조명 칸이 모두 비어 있음', after: '행마다 무대 / 상단 / Pin1~4 / Details — 쓰지 않는 조명은 X', afterKind: 'guide', manual: '조명 전체를 새로 써야 합니다.' }),

    'fx:toomany': () => {
      const types = (S.fx && S.fx.types) || [];
      const name = (k) => (FX_TYPES.find((t) => t.key === k) || { name: k }).name;
      const keep = types.filter((k) => fxRank.get(k)).sort((a, b) => fxRank.get(a).localeCompare(fxRank.get(b)));
      const drop = types.filter((k) => !fxRank.get(k));
      return {
        before: `FX ${types.length}종류: ${types.map(name).join(', ')}`,
        after: `${keep.map((k) => `${fxRank.get(k)} = ${name(k)}`).join(', ')}${drop.length ? ` (${drop.map(name).join('·')}은 빼거나 무대·상단 조명으로)` : ''}`,
        afterKind: 'guide',
        manual: "어떤 효과를 뺄지는 학부가 정합니다 — 'FX로 지정하지 않음' 항목을 반영하면 그 문장이 FX1·FX2로 바뀝니다.",
      };
    },
    'fx:unlabeled': (f, row) => {
      const before = cur(row, f.key);
      const t = FX_TYPES.find((x) => f.id.endsWith(`:${x.key}`));
      const line = before.split('\n').find((l) => t && t.re.test(l)) || before;
      const to = fxLine(line, row);
      return { before: line, after: to, ops: [lineOp(row, f.key, line, to)], afterNote: 'FX는 2개까지 · 언제 / 어떤 효과(FX1) / 얼마나' };
    },
    'fx:undefined': (f, row) => {
      const n = f.id.split(':')[2];
      const line = cur(row, 'details').split('\n').find((l) => new RegExp(`FX\\s*${n}`, 'i').test(l)) || '';
      const add = `※ FX${n} = ${ex('스트로브')} (스트로브 · 고보 · 무빙 · 추가 핀 중 하나)`;
      return { before: line, after: `${line ? `${line}\n` : ''}${add}`, ops: [{ rowId: row.id, key: 'details', append: add }], afterNote: '화면 위 FX 지정에서 고르면 그 효과로 들어갑니다' };
    },
    'fx:strobe': (f, row) => {
      const before = cur(row, f.key);
      const line = before.split('\n').find((l) => /스트로브|strobe/i.test(l)) || before;
      const to = fxLine(line, row);
      return { before: line, after: to, ops: [lineOp(row, f.key, line, to)], afterNote: '스트로브는 1~3초로 짧게' };
    },
    'fx:pinmoving': () => ({ after: 'Pin: X / Details: FX1 무빙 — 언제·어디를·얼마나', afterKind: 'guide', manual: '움직이는 연출을 FX로 다시 정해야 합니다.' }),
    'fx:outside': (f, row) => ({ after: `Details: ${one(originalValue(row, f.key))}`, afterKind: 'guide', manual: 'FX 문장을 Details 칸으로 옮겨 주세요.' }),
  };

  for (const f of ctx.findings) {
    const row = f.rowId ? rowById.get(f.rowId) : null;
    const fix = f.fixId ? ctx.fixes.get(f.fixId) : null;
    f.apply = 'none';
    f.ops = null;
    // 1) 규칙이 직접 만든 '수정 후' (주인공 조명 Details · 노래 마이크): 그 칸에 그대로 넣는다
    if (f.after) {
      f.before = f.before ?? (row && f.key ? originalValue(row, f.key) : '');
      f.afterKind = 'example';
      if (row && f.key && f.afterCell) {
        f.ops = [set(row, f.key, f.after)];
        f.apply = 'op';
        f.editable = true;
      }
      continue;
    }
    // 2) 자동 정리: 실제로 바뀐 값 (fixId로 켜고 끔)
    const own = fix && row && f.key ? fix.cells.find((c) => c.rowId === row.id && c.key === f.key) : null;
    if (fix && fix.cells.length && (own || !(row && f.key))) {
      const cell = own || fix.cells[0];
      f.before = norm(cell.before);
      f.after = norm(cell.after);
      f.afterKind = f.fixEnabled === false ? 'off' : 'auto';
      f.apply = 'auto';
      if (!own || fix.cells.length > 1) {
        f.pairs = fix.cells.slice(0, 3).map((c) => ({ loc: loc(c.rowId, c.key), before: one(c.before), after: one(c.after) }));
        f.pairsMore = Math.max(0, fix.cells.length - 3);
      }
      continue;
    }
    // 3) 규칙별 수정 (골라서 반영)
    const kind = f.id.split(':').slice(0, 2).join(':');
    const make = R[kind];
    let out = null;
    try {
      out = make ? make(f, row) : null;
    } catch {
      out = null; // 예시를 못 만들어도 피드백 자체는 그대로
    }
    if (out && out.after) {
      f.before = out.before ?? (row && f.key ? originalValue(row, f.key) : '');
      f.after = out.after;
      f.afterKind = out.afterKind || 'example';
      if (out.afterNote) f.afterNote = out.afterNote;
      if (out.ops && out.ops.length) {
        f.ops = out.ops;
        f.apply = 'op';
        f.sure = !!out.sure && !EX_RE.test(out.ops.map((o) => o.set ?? o.append ?? o.suffix ?? (o.replace ? o.replace[1] : '') ?? '').join('\n'));
        if (out.pairs) f.pairs = out.pairs;
        else if (out.ops.length > 1 && out.ops.every((o) => o.key)) {
          f.pairs = pairsOf(out.ops).slice(0, 6);
          f.pairsMore = Math.max(0, out.ops.length - 6);
        }
      } else if (out.manual) {
        f.apply = 'manual';
        f.manual = out.manual;
      }
    } else if (f.suggestion) {
      f.before = row && f.key ? originalValue(row, f.key) : '';
      f.after = String(f.suggestion).replace(/^예\)\s*/, '');
      f.afterKind = 'guide';
      if (f.level !== 'info') {
        f.apply = 'manual';
        f.manual = '자동으로 반영할 수 없는 항목이라, 받은 시트에서 직접 고쳐 주세요.';
      }
    } else if (f.level !== 'info') {
      f.apply = 'manual';
      f.manual = '자동으로 반영할 수 없는 항목이라, 받은 시트에서 직접 고쳐 주세요.';
    }
    // 작업이 하나면 반영 전에 '수정 후' 문구를 고칠 수 있다 (행 나누기는 줄마다 'Run Time 가사')
    if (f.apply === 'op') f.editable = f.ops.length === 1;
  }
  for (const f of ctx.findings) {
    // 기본 선택: 자동 정리는 반영, 시트 값만으로 계산한 확실한 수정요망도 반영, 예시가 들어가는 것과 참고는 골라서
    f.defaultOn = f.apply === 'auto' ? true : f.apply === 'op' ? !!f.sure && f.level !== 'info' : false;
  }
  mergeSameCell(ctx.findings, rowById);
}

// 같은 칸을 바꾸는 피드백은 한 장으로 — 칸 하나 = 결정 하나 (수정요망끼리, 참고끼리)
//  예) 조명 Details 한 칸에 'FX로 지정하지 않음' 3개 + '스트로브를 오래' → 최종 문구 하나와 함께 해결되는 피드백 목록
//  최종 문구(차례대로 적용한 결과)는 칸을 통째로 바꾸는 마지막 피드백이 맡고(없으면 첫 피드백), 나머지는 dupOf로 따라간다
export function mergeSameCell(findings, rowById) {
  const tier = (f) => (f.level === 'error' || f.level === 'warn' ? 'todo' : 'opt');
  const groups = new Map();
  for (const f of findings) {
    if (f.apply !== 'op' || !f.ops || !f.ops.length) continue;
    const cells = new Set(f.ops.map((o) => (o.rowId && o.key && !o.split && !o.insert ? `${o.rowId}|${o.key}` : '')));
    if (cells.size !== 1 || cells.has('')) continue;
    const k = `${tier(f)}|${[...cells][0]}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(f);
  }
  for (const fs of groups.values()) {
    if (fs.length < 2) continue;
    const setters = fs.filter((f) => f.ops.some((o) => o.set !== undefined));
    const p = setters.length ? setters[setters.length - 1] : fs[0];
    const rest = fs.filter((f) => f !== p);
    const { rowId, key } = p.ops[0];
    const row = rowById.get(rowId);
    if (!row) continue;
    let text = cur(row, key);
    for (const f of fs) for (const o of f.ops) text = applyText(text, o);
    p.merged = fs.map((f) => f.id);
    p.also = [...new Set(rest.map((f) => f.title))].filter((t) => t !== p.title);
    p.ops = [{ rowId, key, set: text }];
    p.after = text;
    p.afterKind = 'example';
    p.afterNote = '';
    p.pairs = null;
    p.pairsMore = 0;
    p.editable = true;
    p.sure = fs.every((f) => f.sure);
    if (fs.some((f) => f.level === 'error')) p.level = 'error';
    p.defaultOn = !EX_RE.test(text) && fs.some((f) => f.defaultOn);
    for (const f of rest) {
      f.dupOf = p.id;
      f.choiceId = p.id;
      f.defaultOn = p.defaultOn;
    }
  }
}

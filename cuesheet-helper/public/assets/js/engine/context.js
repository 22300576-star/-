// 분석 컨텍스트: 발견 사항(findings)과 자동 수정(fix) 기록
import { KEYS } from './constants.js';
import { classifyItem } from './classify.js';

export function cloneModel(model) {
  return JSON.parse(JSON.stringify(model));
}

export function makeContext(model, opts) {
  const S = cloneModel(model);
  S.rows.forEach((r) => {
    r.marks = {};
    for (const k of KEYS) r.marks[k] = null;
  });
  const ctx = {
    S,
    o: opts,
    findings: [],
    fixes: new Map(), // fixId -> { id, title, enabled, count }
    seen: new Set(),
  };
  return ctx;
}

export function isEnabled(ctx, fixId) {
  return !ctx.o.disabled.has(fixId);
}

function markCell(row, key, patch) {
  const m = row.marks[key] || { changed: false, before: null, reasons: [], pending: false, placeholder: false, fixIds: [] };
  Object.assign(m, patch.flags || {});
  if (patch.reason && !m.reasons.includes(patch.reason)) m.reasons.push(patch.reason);
  if (patch.fixId && !m.fixIds.includes(patch.fixId)) m.fixIds.push(patch.fixId);
  if (patch.before !== undefined && m.before === null) m.before = patch.before;
  row.marks[key] = m;
}

export function markPending(row, key) {
  markCell(row, key, { flags: { pending: true } });
}

// 셀 값을 바꾸는 자동 수정. 같은 fixId로 여러 셀을 묶을 수 있다.
export function applyChange(ctx, fixId, row, key, value, reason) {
  const enabled = isEnabled(ctx, fixId);
  const rec = ctx.fixes.get(fixId) || { id: fixId, enabled, cells: [] };
  ctx.fixes.set(fixId, rec);
  const before = row.c[key];
  if (before === value) return false;
  rec.cells.push({ rowId: row.id, key, before, after: value });
  if (!enabled) return false;
  row.c[key] = value;
  markCell(row, key, { flags: { changed: true, placeholder: false }, before, reason, fixId });
  return true;
}

export function applyPlaceholder(ctx, fixId, row, key, text, reason) {
  const enabled = isEnabled(ctx, fixId);
  const rec = ctx.fixes.get(fixId) || { id: fixId, enabled, cells: [] };
  ctx.fixes.set(fixId, rec);
  rec.cells.push({ rowId: row.id, key, before: row.c[key], after: text });
  if (!enabled) return false;
  const before = row.c[key];
  row.c[key] = text;
  markCell(row, key, { flags: { placeholder: true }, before, reason, fixId });
  return true;
}

// 발견 사항 추가
// f: { id, cat, level, rowId?, key?, block?, title, msg, why?, suggestion?, fixId?, examples? }
export function addFinding(ctx, f) {
  if (ctx.seen.has(f.id)) return null;
  ctx.seen.add(f.id);
  const fin = { ...f };
  if (fin.fixId) {
    fin.fixEnabled = isEnabled(ctx, fin.fixId);
  }
  ctx.findings.push(fin);
  return fin;
}

export function rowKind(ctx, row) {
  return row.kind || 'stage';
}

export function annotateKinds(S, blocks) {
  for (const b of blocks) {
    const kind = classifyItem(b.item, b.rows);
    b.kind = kind;
    b.rows.forEach((r, i) => {
      r.kind = kind;
      r.blockFirst = i === 0;
      r.blockIndex = b.index;
    });
  }
}

export function blockLabel(b) {
  if (!b) return '';
  const first = (b.item || '').split('\n')[0].trim();
  return first || `${b.index + 1}번째 항목`;
}

export function rowLabel(S, row) {
  const b = S.blocks[row.blockIndex];
  const label = blockLabel(b);
  const rt = row.c.runtime && !row.c.runtime.startsWith('(') ? ` · ${row.c.runtime.split('\n')[0]}` : '';
  if (b && b.rows.length > 1) {
    const idx = b.rows.indexOf(row);
    return `${label} ${idx + 1}행${rt}`;
  }
  return `${label}${rt}`;
}

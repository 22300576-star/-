// 큐시트 분석 + 자동 수정 오케스트레이터
import { KEYS, LEVELS, CATS } from './constants.js';
import { buildBlocks } from './parser.js';
import { makeContext, annotateKinds } from './context.js';
import { runTimeRules, reparse } from './rules-time.js';
import { lightRules } from './rules-light.js';
import { formRules, pendingRules, stageRules, detailRules, lyricsRules, soundRules, screenRules, reportVideoDefaults } from './rules-content.js';
import { buildSummary } from './summary.js';

function blankRow(id, item, extra = {}) {
  const row = { id, src: null, c: {}, cont: {}, extra: {}, inserted: true };
  for (const k of KEYS) {
    row.c[k] = '';
    row.cont[k] = false;
  }
  row.c.item = item;
  Object.assign(row.c, extra);
  return row;
}

function ensureHostIntro(S) {
  const hasHost = S.rows.some((r) => r.kind === 'host');
  const hasIntro = S.rows.some((r) => r.kind === 'intro');
  const add = [];
  if (!hasHost) add.push(blankRow('host-new', '학부 소개 및 투표(사회자)', { stage: '사회자' }));
  if (!hasIntro) add.push(blankRow('intro-new', '학부 인트로 영상'));
  if (!add.length) return;
  // 사회자 행은 맨 앞, 인트로는 사회자 다음
  const hostIdx = S.rows.findIndex((r) => r.kind === 'host');
  if (!hasHost) S.rows.unshift(add.shift());
  if (!hasIntro) {
    const at = hasHost ? hostIdx + 1 : 1;
    S.rows.splice(at, 0, add.shift());
  }
}

function rebuild(S) {
  S.blocks = buildBlocks(S.rows);
  annotateKinds(S, S.blocks);
}

export function analyze(model, options = {}) {
  const opts = { disabled: new Set(), fx: { FX1: '', FX2: '' }, ...options };
  if (!(opts.disabled instanceof Set)) opts.disabled = new Set(opts.disabled || []);
  const ctx = makeContext(model, opts);
  const { S } = ctx;
  rebuild(S);
  ensureHostIntro(S);
  for (const r of S.rows) if (!r.marks) r.marks = Object.fromEntries(KEYS.map((k) => [k, null]));
  rebuild(S);

  formRules(ctx);
  runTimeRules(ctx);
  lightRules(ctx);
  stageRules(ctx);
  detailRules(ctx);
  lyricsRules(ctx);
  soundRules(ctx);
  screenRules(ctx);
  pendingRules(ctx);
  reportVideoDefaults(ctx);
  reparse(S);

  // 정렬: 수준 → 행 순서
  const rowOrder = new Map(S.rows.map((r, i) => [r.id, i]));
  ctx.findings.sort((a, b) => {
    const la = LEVELS[a.level].order - LEVELS[b.level].order;
    if (la) return la;
    return (rowOrder.get(a.rowId) ?? -1) - (rowOrder.get(b.rowId) ?? -1);
  });
  ctx.findings.forEach((f) => {
    if (f.fixId) f.fixEnabled = !opts.disabled.has(f.fixId);
  });

  const summary = buildSummary(S, ctx.findings, ctx.fixes);
  const timeline = S.rows
    .filter((r) => (r.kind === 'stage' || r.kind === 'video') && r.rt && r.rt.ok)
    .map((r) => ({ rowId: r.id, block: r.blockIndex, kind: r.kind, start: r.rt.start, end: r.rt.end, label: (S.blocks[r.blockIndex].item || '').split('\n')[0] }));

  // 직렬화 가능한 결과 (rt 같은 내부 값은 남겨도 무방)
  return {
    revised: S,
    findings: ctx.findings,
    fixes: [...ctx.fixes.values()].map((f) => ({ id: f.id, enabled: !opts.disabled.has(f.id), count: f.cells.length })),
    summary,
    timeline,
    cats: CATS,
  };
}

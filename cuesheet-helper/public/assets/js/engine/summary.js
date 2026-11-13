// 요약: 점수, 영역별 상태, TFT식 피드백 문구
import { CATS, LEVELS } from './constants.js';
import { fmtDurationKo } from './time.js';

const CAT_ORDER = ['time', 'stage', 'detail', 'lyrics', 'sound', 'screen', 'light', 'fx', 'form', 'pending'];

export function buildSummary(S, findings, fixes) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.level]++;
  const byCat = {};
  for (const c of CAT_ORDER) byCat[c] = { error: 0, warn: 0, info: 0, items: [] };
  for (const f of findings) {
    const c = byCat[f.cat] || (byCat[f.cat] = { error: 0, warn: 0, info: 0, items: [] });
    c[f.level]++;
    c.items.push(f);
  }
  // 영역별 점수
  const scored = ['time', 'stage', 'detail', 'lyrics', 'sound', 'screen', 'light'];
  let total = 0;
  const catStatus = {};
  for (const c of scored) {
    const x = byCat[c];
    let s;
    if (x.error) s = Math.max(0, 40 - (x.error - 1) * 10);
    else if (x.warn) s = Math.max(55, 85 - (x.warn - 1) * 5);
    else s = 100;
    catStatus[c] = { score: s, status: x.error ? 'error' : x.warn ? 'warn' : 'ok', ...x };
    total += s;
  }
  const score = Math.round(total / scored.length);
  const pendingCount = byCat.pending ? byCat.pending.items.length : 0;
  const autoFixes = [...fixes.values()].filter((f) => f.cells.length);
  const autoCells = autoFixes.reduce((n, f) => n + (f.enabled ? f.cells.length : 0), 0);

  // TFT 피드백 문구 (큐시트 1행에 들어가는 형식)
  const lines = [];
  const pick = (level) => findings.filter((f) => f.level === level && f.cat !== 'pending');
  const fmtGroup = (arr) => {
    const groups = new Map();
    for (const f of arr) {
      const key = `${CATS[f.cat] || f.cat}: ${f.title}`;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return [...groups.entries()].map(([k, n]) => (n > 1 ? `${k} (${n}곳)` : k));
  };
  const errs = fmtGroup(pick('error'));
  const warns = fmtGroup(pick('warn'));
  if (errs.length) lines.push(`[필수 수정] ${errs.slice(0, 6).join(' / ')}${errs.length > 6 ? ` 외 ${errs.length - 6}건` : ''}`);
  if (warns.length) lines.push(`[권장] ${warns.slice(0, 6).join(' / ')}${warns.length > 6 ? ` 외 ${warns.length - 6}건` : ''}`);
  if (pendingCount) lines.push(`[논의 중] ${pendingCount}개 행 — 보라색 칸 확정 필요`);
  const fixedTitles = findings.filter((f) => f.fixId && f.fixEnabled && f.level !== 'error').map((f) => f.title);
  if (autoCells) lines.push(`[자동 반영] ${autoCells}칸 수정 — ${[...new Set(fixedTitles)].slice(0, 4).join(', ')}`);

  return {
    counts,
    score,
    catStatus,
    pendingCount,
    autoCells,
    totalSec: S.totalSec || 0,
    totalText: S.totalSec ? fmtDurationKo(S.totalSec) : '-',
    baseMode: S.baseMode,
    feedbackLines: lines,
    feedbackText: lines.join('\n'),
    levels: LEVELS,
  };
}

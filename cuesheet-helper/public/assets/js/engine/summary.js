// 요약: 남은 수정요망 개수, 총평·수정 방향, TFT식 1행 피드백 문구
import { LEVELS } from './constants.js';
import { fmtDurationKo } from './time.js';
import { buildOverview } from './overview.js';

export function buildSummary(S, findings, fixes) {
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.level]++;
  const todo = counts.error + counts.warn; // 화면에는 모두 '수정요망' 하나로 보여줌
  const autoFixes = [...fixes.values()].filter((f) => f.cells.length);
  const autoCells = autoFixes.reduce((n, f) => n + (f.enabled ? f.cells.length : 0), 0);
  const totalSec = S.totalSec || 0;

  const overview = buildOverview(S, findings, { totalSec, autoCells });

  // TFT 피드백 문구 (큐시트 1행에 들어가는 형식)
  const lines = [`[총평] ${overview.lead}`];
  if (overview.directions.length) {
    const dirs = overview.directions.map((d) => `${d.item}: ${d.action}`);
    lines.push(`[수정요망] ${dirs.slice(0, 6).join(' / ')}${dirs.length > 6 ? ` 외 ${dirs.length - 6}가지` : ''}`);
  }
  if (overview.autoNote) lines.push(`[자동 반영] ${overview.autoNote}`);

  return {
    counts,
    todo,
    autoCells,
    totalSec,
    totalText: totalSec ? fmtDurationKo(totalSec) : '-',
    baseMode: S.baseMode,
    overview,
    feedbackLines: lines,
    feedbackText: lines.join('\n'),
    levels: LEVELS,
  };
}

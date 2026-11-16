// AI 큐시트 작성 결과를 사이트의 '반영 고르기'로 잇는다 (브라우저와 Node 공용)
//  - sheetForAI: AI에게 보낼 큐시트(행 id + 칸, 병합 칸은 '(위와 같음)')
//  - itemsFromEdit: '고치기' 결과 → 반영 / 반영 안 함을 고를 수 있는 항목 (칸 바꾸기 · 행 넣기)
//  - gridFromRows: '새로 작성' 결과 → 2026 양식 표 (피드백 받기로 이어짐)
import { KEYS, colName } from './constants.js';
import { norm } from './vocab.js';

export const HEADER = [
  ['항목', 'Run Time', '무대', '대기 인원', '세부 내용', '개사 내용', '음향 / FD', '화면(영상)', '조명', '', '', '', '', '', '', '비고'],
  ['', '', '', '', '', '', '', '', '무대', '상단', 'Pin1', 'Pin2', 'Pin3', 'Pin4', 'Details', ''],
];

export function sheetForAI(S) {
  return S.rows.map((r) => {
    const cells = {};
    for (const k of KEYS) {
      if (r.cont[k]) cells[k] = '(위와 같음)';
      else if (norm(r.c[k])) cells[k] = norm(r.c[k]);
    }
    return { id: r.id, kind: r.kind || '', cells };
  });
}

export const findingsForAI = (findings) =>
  findings.filter((f) => f.level === 'error' || f.level === 'warn').map((f) => ({ rowId: f.rowId || '', key: f.key || '', title: f.title, msg: f.msg }));

const rowLabel = (S, id) => {
  const i = S.rows.findIndex((r) => r.id === id);
  if (i < 0) return '';
  const r = S.rows[i];
  const b = S.blocks && S.blocks[r.blockIndex];
  return `${i + 5}행${b && b.item ? ` · ${b.item.split('\n')[0]}` : ''}`;
};
const cellsBrief = (c) =>
  [c.item && c.item.split('\n')[0], c.runtime, c.lyrics && c.lyrics.replace(/\n/g, ' / '), c.detail]
    .filter(Boolean)
    .join(' · ')
    .slice(0, 160);

// '고치기' 결과 → 고를 수 있는 항목 (AI에게 요청한 것이라 처음엔 반영으로)
export function itemsFromEdit(result, S, jobId, prompt = '') {
  const rows = new Map(S.rows.map((r) => [r.id, r]));
  const items = [];
  (result.changes || []).forEach((c, i) => {
    const row = rows.get(c.rowId);
    if (!row) return;
    items.push({
      id: `aiw:${jobId}:c${i}`,
      source: 'ai',
      job: jobId,
      prompt,
      apply: 'op',
      ops: [{ rowId: c.rowId, key: c.key, set: c.text }],
      defaultOn: true,
      editable: true,
      level: 'info',
      cat: 'ai',
      rowId: c.rowId,
      key: c.key,
      title: c.reason || `${colName(c.key)} 고치기`,
      msg: c.reason || '',
      loc: `${rowLabel(S, c.rowId)} · ${colName(c.key)}`,
      before: row.cont[c.key] ? '' : norm(row.c[c.key]),
      after: c.text,
      afterKind: 'ai',
    });
  });
  (result.inserts || []).forEach((ins, i) => {
    if (!rows.has(ins.afterRowId)) return;
    items.push({
      id: `aiw:${jobId}:i${i}`,
      source: 'ai',
      job: jobId,
      prompt,
      apply: 'op',
      ops: [{ afterRowId: ins.afterRowId, insert: [ins.cells] }],
      defaultOn: true,
      editable: false,
      level: 'info',
      cat: 'ai',
      rowId: ins.afterRowId,
      key: null,
      title: ins.reason || '행 추가',
      msg: ins.reason || '',
      loc: `${rowLabel(S, ins.afterRowId)} 다음에 새 행`,
      before: '',
      after: cellsBrief(ins.cells),
      afterKind: 'ai',
      cells: ins.cells,
    });
  });
  return items;
}

// '새로 작성' 결과 → 2026 양식 표 (머리글 2행 + 내용)
export function gridFromRows(rows, name = 'AI 작성 큐시트') {
  return { name, cells: [...HEADER.map((r) => [...r]), ...rows.map((c) => KEYS.map((k) => String(c[k] ?? '')))], merges: [] };
}

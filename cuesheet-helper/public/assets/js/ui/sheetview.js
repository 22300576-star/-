// 큐시트 표(구글 시트 모양) 그리기 — 전체 표와 항목별 열만 보기에 같이 쓴다
import { COLS, KEYS, colName } from '../engine/constants.js';

export const COL_PX = { item: 120, runtime: 150, stage: 170, waiting: 120, detail: 230, lyrics: 200, sound: 170, screen: 110, lStage: 150, lTop: 150, pin1: 80, pin2: 80, pin3: 80, pin4: 80, details: 260, note: 130 };
const LIGHT = ['lStage', 'lTop', 'pin1', 'pin2', 'pin3', 'pin4', 'details'];
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function blocksOf(S) {
  if (S.blocks) return S.blocks;
  const blocks = [];
  let cur = null;
  for (const r of S.rows) {
    if (!cur || (r.c.item && !r.cont.item)) {
      cur = { rows: [] };
      blocks.push(cur);
    }
    cur.rows.push(r);
  }
  return blocks;
}

function spansFor(blocks, key) {
  const map = new Map();
  for (const b of blocks) {
    for (let i = 0; i < b.rows.length; i++) {
      if (b.rows[i].cont[key]) continue;
      let j = i + 1;
      while (j < b.rows.length && b.rows[j].cont[key]) j++;
      map.set(b.rows[i].id, j - i);
      i = j - 1;
    }
  }
  return map;
}

/**
 * @param {object} S 큐시트 모델(analyze 결과 revised 또는 원본)
 * @param {object} o { cols, editable, findings, originalMap, showDiff, rowFilter }
 */
export function sheetHtml(S, o = {}) {
  const cols = o.cols || KEYS;
  const blocks = blocksOf(S);
  const spans = Object.fromEntries(cols.map((k) => [k, spansFor(blocks, k)]));
  const nums = new Map(S.rows.map((r, i) => [r.id, 5 + i]));
  const level = new Map();
  const rank = { error: 3, warn: 2, info: 1 };
  for (const f of o.findings || []) {
    if (!f.rowId || !f.key || f.level === 'info') continue;
    const k = `${f.rowId}|${f.key}`;
    if (!level.has(k) || rank[f.level] > rank[level.get(k)]) level.set(k, f.level);
  }
  const width = 34 + cols.reduce((n, k) => n + COL_PX[k], 0);
  const lightCols = cols.filter((k) => LIGHT.includes(k));
  let head = `<colgroup><col style="width:34px">${cols.map((k) => `<col style="width:${COL_PX[k]}px">`).join('')}</colgroup><thead><tr class="h1"><th class="rowh" rowspan="2"></th>`;
  let lightDone = false;
  for (const k of cols) {
    if (LIGHT.includes(k)) {
      if (!lightDone) head += `<th colspan="${lightCols.length}">조명</th>`;
      lightDone = true;
    } else head += `<th rowspan="2" class="c-${k}">${esc(COLS.find((c) => c.key === k).label)}</th>`;
  }
  head += `</tr><tr class="h2">${lightCols.map((k) => `<th>${esc(COLS.find((c) => c.key === k).label)}</th>`).join('')}</tr></thead>`;
  let body = '<tbody>';
  for (const row of S.rows) {
    if (o.rowFilter && !o.rowFilter(row)) continue;
    const orig = o.originalMap ? o.originalMap.get(row.id) : null;
    body += `<tr class="k-${row.kind || 'stage'}${o.selected === row.id ? ' sel' : ''}" data-row="${esc(row.id)}"><td class="rowh" data-rowh="${esc(row.id)}">${nums.get(row.id)}</td>`;
    for (const k of cols) {
      if (row.cont[k]) continue;
      const m = row.marks && row.marks[k];
      const cls = [`c-${k}`];
      let diff = false;
      if (o.showDiff && o.originalMap) {
        if (!orig) diff = !!row.c[k];
        else diff = (row.c[k] || '') !== (orig.cont[k] ? '' : orig.c[k] || '');
      }
      if (m && m.pending) cls.push('pd');
      else if (m && m.placeholder) cls.push('ph');
      else if (diff) cls.push('changed');
      const lv = level.get(`${row.id}|${k}`);
      const rs = spans[k].get(row.id) > 1 ? ` rowspan="${spans[k].get(row.id)}"` : '';
      const ce = o.editable ? ' contenteditable="true" spellcheck="false"' : '';
      body += `<td class="${cls.join(' ')}" data-row="${esc(row.id)}" data-key="${k}"${rs}${ce} aria-label="${esc(colName(k))}">${esc(row.c[k] || '')}${lv ? '<i class="mk error"></i>' : ''}</td>`;
    }
    body += '</tr>';
  }
  body += '</tbody>';
  return `<table class="sheet" style="width:${width}px">${head}${body}</table>`;
}

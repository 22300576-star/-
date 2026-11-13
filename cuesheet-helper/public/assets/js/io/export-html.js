// 구글 시트에 붙여 넣을 수 있는 HTML 표(셀 병합·색 포함) + 탭 구분 텍스트
import { KEYS, COLS, GUIDE_ROW } from '../engine/constants.js';

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
// 2차 큐시트 열 너비(px) — 붙여넣는 곳이 열 너비를 받아 주면 그대로 쓰이도록 함께 보냄
const COL_PX = { item: 150, runtime: 234, stage: 234, waiting: 175, detail: 292, lyrics: 234, sound: 234, screen: 190, lStage: 164, lTop: 164, pin1: 100, pin2: 100, pin3: 100, pin4: 100, details: 402, note: 100 };
const BG = { guide: '#f4cccc', host: '#cfe2f3', intro: '#d9ead3', video: '#efefef', pending: '#d9d2e9', feedback: '#fff2cc' };

function td(text, { rs = 1, cs = 1, bg, bold, size = 10, color } = {}) {
  const st = [
    'font-family:Arial',
    `font-size:${size}pt`,
    'border:1px solid #000000',
    'text-align:center',
    'vertical-align:middle',
    'white-space:normal',
    bg ? `background-color:${bg}` : '',
    bold ? 'font-weight:bold' : '',
    color ? `color:${color}` : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<td${rs > 1 ? ` rowspan="${rs}"` : ''}${cs > 1 ? ` colspan="${cs}"` : ''} style="${st}">${esc(text)}</td>`;
}

function spans(S, key) {
  const map = new Map();
  for (const b of S.blocks) {
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

export function toHtmlTable(S, { feedbackText = '', includeHeader = true } = {}) {
  const out = ['<table style="border-collapse:collapse">', `<colgroup>${KEYS.map((k) => `<col width="${COL_PX[k]}" style="width:${COL_PX[k]}px">`).join('')}</colgroup>`];
  if (includeHeader) {
    out.push(`<tr>${td(feedbackText ? '피드백' : '', { bold: true, color: '#ff0000' })}${td(feedbackText, { cs: 15, bg: BG.feedback, bold: !!feedbackText, color: '#ff0000' })}</tr>`);
    let r2 = '';
    COLS.forEach((c) => {
      if (c.key === 'lStage') r2 += td('조명', { cs: 7, bold: true, size: 11 });
      else if (c.group) return;
      else if (c.key === 'note') r2 += td('비고', { rs: 3, bold: true, size: 12 });
      else r2 += td(c.label, { rs: 2, bold: c.key !== 'item', size: c.key === 'item' ? 10 : 11 });
    });
    out.push(`<tr>${r2}</tr>`);
    out.push(`<tr>${COLS.filter((c) => c.group).map((c) => td(c.label, { bold: true, size: c.key === 'details' ? 12 : 11 })).join('')}</tr>`);
    out.push(`<tr>${KEYS.filter((k) => k !== 'note').map((k) => td(k === 'item' ? '' : GUIDE_ROW[k], { bg: BG.guide, bold: true, size: 9 })).join('')}</tr>`);
  }
  const spanMaps = Object.fromEntries(KEYS.map((k) => [k, spans(S, k)]));
  for (const row of S.rows) {
    let html = '';
    for (const k of KEYS) {
      if (row.cont[k]) continue;
      const m = row.marks && row.marks[k];
      let bg;
      if (row.kind === 'video') bg = BG.video;
      if (row.kind === 'host' && k === 'item') bg = BG.host;
      if (row.kind === 'intro' && k === 'item') bg = BG.intro;
      if (m && m.pending) bg = BG.pending;
      else if (m && m.placeholder) bg = BG.guide;
      const bold = (row.kind === 'host' && ['item', 'stage', 'note'].includes(k)) || (row.kind === 'intro' && (k === 'item' || KEYS.indexOf(k) >= 8));
      html += td(row.c[k], { rs: spanMaps[k].get(row.id) || 1, bg, bold, size: row.kind === 'intro' && KEYS.indexOf(k) >= 8 ? 12 : 10 });
    }
    out.push(`<tr>${html}</tr>`);
  }
  out.push('</table>');
  return out.join('');
}

export function toTsv(S) {
  const q = (s) => {
    const v = String(s ?? '');
    return /[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  return S.rows.map((row) => KEYS.map((k) => (row.cont[k] ? '' : q(row.c[k]))).join('\t')).join('\n');
}

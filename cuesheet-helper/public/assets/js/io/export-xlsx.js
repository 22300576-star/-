// 2026 학부합창대회 2차 큐시트 양식(.xlsx) 생성
// 열 너비·행 높이·글꼴(Arial)·글자 크기·색·테두리·셀 병합·틀 고정을 2차 큐시트 템플릿과 같게 만든다.
import { KEYS, COLS, GUIDE_ROW, CATS, LEVELS, colName } from '../engine/constants.js';

const COL_PX = { item: 150, runtime: 234, stage: 234, waiting: 175, detail: 292, lyrics: 234, sound: 234, screen: 190, lStage: 164, lTop: 164, pin1: 100, pin2: 100, pin3: 100, pin4: 100, details: 402, note: 100 };
const FILL = {
  guide: 'FFF4CCCC', // 4행 안내(붉은색) / 작성 필요 칸
  host: 'FFCFE2F3', // 학부 소개 및 투표(사회자)
  intro: 'FFD9EAD3', // 학부 인트로 영상
  video: 'FFEFEFEF', // 자체영상
  pending: 'FFD9D2E9', // 논의 중(보라)
  feedback: 'FFFFF2CC', // 1행 피드백 칸
  changed: 'FFFFF9C4', // (검토용) 자동 수정된 칸
};
const BLACK = { argb: 'FF000000' };
const thin = { style: 'thin', color: BLACK };
const dbl = { style: 'double', color: BLACK };
const ALL_THIN = { top: thin, left: thin, bottom: thin, right: thin };

const pxToWidth = (px) => Math.round(((px - 5) / 7) * 100) / 100;
const pxToPt = (px) => Math.round(px * 0.75 * 100) / 100;

function font(extra = {}) {
  return { name: 'Arial', size: 10, ...extra };
}
function fill(argb) {
  return { type: 'pattern', pattern: 'solid', fgColor: { argb } };
}
const center = (wrap = true, vertical = 'middle') => ({ horizontal: 'center', vertical, wrapText: wrap });

export function safeSheetName(name) {
  const n = String(name || '큐시트').replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim();
  return (n || '큐시트').slice(0, 31);
}

// 셀 내용 길이로 필요한 줄 수 추정
function linesFor(text, px) {
  if (!text) return 1;
  const usable = Math.max(40, px - 10);
  let lines = 0;
  for (const ln of String(text).split('\n')) {
    let w = 0;
    for (const ch of ln) w += /[ㄱ-힣一-鿿]/.test(ch) ? 12 : 6.6;
    lines += Math.max(1, Math.ceil(w / usable));
  }
  return lines;
}

function verticalRuns(S, key) {
  const runs = [];
  for (const b of S.blocks) {
    for (let i = 0; i < b.rows.length; i++) {
      if (b.rows[i].cont[key]) continue;
      let j = i + 1;
      while (j < b.rows.length && b.rows[j].cont[key]) j++;
      if (j - i > 1) runs.push({ from: b.rows[i], to: b.rows[j - 1], len: j - i });
      i = j - 1;
    }
  }
  return runs;
}

/**
 * @param {*} ExcelJS ExcelJS 라이브러리
 * @param {object} S analyze().revised
 * @param {object} opts { mode: 'review'|'submit', feedbackText, findings, title }
 */
export async function buildWorkbook(ExcelJS, S, opts = {}) {
  const mode = opts.mode || 'review';
  const wb = new ExcelJS.Workbook();
  wb.creator = '2026 학부합창대회 큐시트 피드백 도우미';
  wb.created = new Date();
  const ws = wb.addWorksheet(safeSheetName(opts.title || S.name), {
    views: [{ state: 'frozen', xSplit: 1, ySplit: 4, zoomScale: 100 }],
  });
  ws.properties.defaultRowHeight = pxToPt(21);
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  ws.columns = KEYS.map((k) => ({ key: k, width: pxToWidth(COL_PX[k]), style: { font: font() } }));

  // ---------- 1행: 피드백 ----------
  const r1 = ws.getRow(1);
  const fbText = mode === 'review' ? opts.feedbackText || '' : '';
  r1.getCell(1).value = mode === 'review' ? '피드백' : '';
  r1.getCell(1).font = font({ bold: true, color: { argb: 'FFFF0000' } });
  r1.getCell(1).alignment = center(true);
  ws.mergeCells(1, 2, 1, 16);
  const b1 = r1.getCell(2);
  b1.value = fbText;
  b1.font = font({ bold: !!fbText, color: fbText ? { argb: 'FFFF0000' } : undefined });
  b1.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  b1.fill = fill(FILL.feedback);
  b1.border = { top: dbl, left: dbl, right: dbl, bottom: thin };
  const fbLines = fbText ? linesFor(fbText, 2900) : 1;
  r1.height = pxToPt(Math.max(47, fbLines * 16 + 12));

  // ---------- 2~3행: 머리글 ----------
  const r2 = ws.getRow(2);
  const r3 = ws.getRow(3);
  r2.height = pxToPt(23);
  r3.height = pxToPt(23);
  COLS.forEach((c, i) => {
    const col = i + 1;
    if (!c.group && c.key !== 'note') {
      ws.mergeCells(2, col, 3, col);
      const cell = r2.getCell(col);
      cell.value = c.label;
      cell.font = c.key === 'item' ? font() : font({ bold: true, size: 11 });
      cell.alignment = center(false);
      cell.border = c.key === 'item' ? { top: dbl, left: thin, right: thin, bottom: thin } : ALL_THIN;
    }
  });
  ws.mergeCells(2, 9, 2, 15);
  const light = r2.getCell(9);
  light.value = '조명';
  light.font = font({ bold: true, size: 11 });
  light.alignment = center(true, 'bottom');
  light.border = ALL_THIN;
  COLS.forEach((c, i) => {
    if (!c.group) return;
    const cell = r3.getCell(i + 1);
    cell.value = c.label;
    cell.font = font({ bold: true, size: c.key === 'details' ? 12 : 11 });
    cell.alignment = center(true, 'bottom');
    cell.border = ALL_THIN;
  });
  ws.mergeCells(2, 16, 4, 16);
  const note = r2.getCell(16);
  note.value = '비고';
  note.font = font({ bold: true, size: 12 });
  note.alignment = center(true);
  note.border = { right: dbl, bottom: dbl };

  // ---------- 4행: 붉은색 안내 ----------
  const r4 = ws.getRow(4);
  r4.height = pxToPt(21);
  KEYS.forEach((k, i) => {
    if (k === 'note') return;
    const cell = r4.getCell(i + 1);
    cell.value = k === 'item' ? '' : GUIDE_ROW[k] || '';
    cell.fill = fill(FILL.guide);
    cell.font = font({ bold: true, size: 9 });
    cell.alignment = center(true);
    cell.border = k === 'item' ? { left: dbl } : { top: thin, left: thin, right: thin };
  });

  // ---------- 본문 ----------
  const rowNo = new Map();
  S.rows.forEach((row, idx) => rowNo.set(row.id, 5 + idx));
  const heights = new Map();
  S.rows.forEach((row, idx) => {
    const r = ws.getRow(5 + idx);
    let maxLines = 1;
    KEYS.forEach((k, ci) => {
      const cell = r.getCell(ci + 1);
      const v = row.cont[k] ? '' : row.c[k] || '';
      cell.value = v;
      cell.font = font();
      cell.alignment = center(true);
      cell.border = ALL_THIN;
      // 템플릿 서식
      if (row.kind === 'host') {
        if (k === 'item') {
          cell.font = font({ bold: true });
          cell.fill = fill(FILL.host);
        }
        if (k === 'stage') cell.font = font({ bold: true });
        if (k === 'note') cell.font = font({ bold: true, size: 12 });
      } else if (row.kind === 'intro') {
        if (k === 'item') {
          cell.font = font({ bold: true });
          cell.fill = fill(FILL.intro);
        }
        if (ci >= 8) cell.font = font({ bold: true, size: 12 });
      } else if (row.kind === 'video') {
        cell.fill = fill(FILL.video);
      }
      const m = row.marks && row.marks[k];
      if (m && !row.cont[k]) {
        if (m.pending) cell.fill = fill(FILL.pending);
        else if (m.placeholder) cell.fill = fill(FILL.guide);
        else if (m.changed && mode === 'review') cell.fill = fill(FILL.changed);
        if (mode === 'review' && (m.changed || m.placeholder)) {
          const before = m.before == null ? '' : String(m.before);
          const reasons = (m.reasons || []).join(', ');
          const txt = `[자동 수정] ${reasons}${before ? `\n원래 내용: ${before.length > 180 ? `${before.slice(0, 180)}…` : before}` : '\n원래 내용: (빈칸)'}`;
          cell.note = { texts: [{ font: { size: 9, name: 'Arial' }, text: txt }], margins: { insetmode: 'auto' } };
        }
      }
      if (!row.cont[k]) {
        const lines = linesFor(v, COL_PX[k]);
        const runLen = row.span && row.span[k] ? row.span[k] : 1;
        maxLines = Math.max(maxLines, Math.ceil(lines / runLen));
      }
    });
    const px = row.kind === 'host' || row.kind === 'intro' ? Math.max(43, maxLines * 16 + 10) : Math.max(43, maxLines * 16 + 10);
    heights.set(row.id, px);
  });
  // 세로 병합
  for (const k of KEYS) {
    const col = KEYS.indexOf(k) + 1;
    for (const run of verticalRuns(S, k)) {
      const a = rowNo.get(run.from.id);
      const z = rowNo.get(run.to.id);
      ws.mergeCells(a, col, z, col);
      // 병합 칸 내용이 길면 마지막 행 높이를 늘림
      const need = linesFor(run.from.c[k] || '', COL_PX[k]) * 16 + 10;
      let have = 0;
      for (let n = a; n <= z; n++) have += heights.get(S.rows[n - 5].id);
      if (need > have) heights.set(run.to.id, heights.get(run.to.id) + (need - have));
    }
  }
  S.rows.forEach((row, idx) => {
    ws.getRow(5 + idx).height = pxToPt(Math.min(heights.get(row.id), 409 / 0.75));
  });

  // ---------- 검토용: 피드백 목록 시트 ----------
  if (mode === 'review' && opts.findings) {
    const fs = wb.addWorksheet('피드백 목록', { views: [{ state: 'frozen', ySplit: 1 }] });
    fs.columns = [
      { header: '수준', key: 'level', width: 10 },
      { header: '영역', key: 'cat', width: 14 },
      { header: '위치', key: 'where', width: 30 },
      { header: '내용', key: 'title', width: 40 },
      { header: '설명 / 대안', key: 'msg', width: 90 },
      { header: '근거', key: 'why', width: 50 },
      { header: '자동 반영', key: 'fix', width: 12 },
    ];
    fs.getRow(1).font = font({ bold: true });
    fs.getRow(1).fill = fill('FFD9D9D9');
    for (const f of opts.findings) {
      const row = f.rowId ? S.rows.find((r) => r.id === f.rowId) : null;
      const where = row ? `${rowNo.get(row.id)}행${f.key ? ` ${colName(f.key)}` : ''}` : '전체';
      const r = fs.addRow({
        level: LEVELS[f.level].label,
        cat: CATS[f.cat] || f.cat,
        where,
        title: f.title,
        msg: [f.msg, f.suggestion ? `→ ${f.suggestion}` : '', f.examples && f.examples.length ? `예: ${f.examples.join(' / ')}` : ''].filter(Boolean).join('\n'),
        why: f.why || '',
        fix: f.fixId ? (f.fixEnabled ? '반영함' : '반영 안 함') : '-',
      });
      r.alignment = { vertical: 'top', wrapText: true };
      r.font = font({ color: f.level === 'error' ? { argb: 'FFC00000' } : undefined });
    }
  }
  return wb;
}

export async function exportXlsx(ExcelJS, S, opts) {
  const wb = await buildWorkbook(ExcelJS, S, opts);
  return wb.xlsx.writeBuffer();
}

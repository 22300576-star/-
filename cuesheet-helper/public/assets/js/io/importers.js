// 큐시트 불러오기: 엑셀(.xlsx) 파일 / 구글 시트 붙여넣기(HTML 표·TSV)

// ExcelJS 셀 값 → 문자열
function cellText(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (v.richText) return v.richText.map((t) => t.text).join('');
  if (v.text !== undefined) return typeof v.text === 'string' ? v.text : cellText(v.text);
  if (v.result !== undefined) return cellText(v.result);
  if (v.formula !== undefined) return '';
  if (v.error) return '';
  return String(v);
}

function colToIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}
function parseRange(ref) {
  const m = String(ref).match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
  if (!m) return null;
  return { r1: Number(m[2]) - 1, c1: colToIndex(m[1]), r2: Number(m[4]) - 1, c2: colToIndex(m[3]) };
}

export async function readWorkbook(ExcelJS, arrayBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const sheets = [];
  wb.eachSheet((ws) => {
    const rowCount = Math.min(ws.rowCount || 0, 400);
    const colCount = Math.min(ws.columnCount || 0, 40);
    const cells = [];
    for (let r = 1; r <= rowCount; r++) {
      const row = ws.getRow(r);
      const arr = [];
      for (let c = 1; c <= colCount; c++) {
        const cell = row.getCell(c);
        // 병합 칸의 비-앵커 셀은 값이 앵커와 같게 보이므로 비움
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) arr.push('');
        else arr.push(cellText(cell.value));
      }
      cells.push(arr);
    }
    const merges = [];
    const raw = (ws.model && ws.model.merges) || [];
    for (const ref of raw) {
      const m = parseRange(ref);
      if (m) merges.push(m);
    }
    sheets.push({ name: ws.name, cells, merges, mergeInfo: true, state: ws.state });
  });
  return sheets.filter((s) => s.state !== 'hidden' && s.state !== 'veryHidden');
}

// 큐시트처럼 보이는 시트인지 점수 매기기 (여러 탭 중 고르기 도움)
export function looksLikeCueSheet(sheet) {
  const flat = sheet.cells.slice(0, 12).map((r) => r.join('|')).join('\n');
  let score = 0;
  if (/항목/.test(flat)) score += 2;
  if (/Run\s*Time/i.test(flat)) score += 3;
  if (/Pin\s*1/i.test(flat)) score += 2;
  if (/개사/.test(flat)) score += 1;
  return score;
}

// 구글 시트에서 복사한 HTML 표 → grid (rowspan/colspan → merges)
export function gridFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table');
  if (!table) return null;
  const cells = [];
  const merges = [];
  const occupied = new Set();
  const trs = [...table.querySelectorAll('tr')];
  trs.forEach((tr, r) => {
    let c = 0;
    cells[r] = cells[r] || [];
    for (const td of tr.querySelectorAll('td,th')) {
      while (occupied.has(`${r},${c}`)) c++;
      const rs = Math.max(1, Number(td.getAttribute('rowspan')) || 1);
      const cs = Math.max(1, Number(td.getAttribute('colspan')) || 1);
      // <br> → 줄바꿈
      td.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
      const text = (td.innerText !== undefined && td.innerText !== '' ? td.innerText : td.textContent || '').replace(/ /g, ' ');
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          occupied.add(`${rr},${cc}`);
          cells[rr] = cells[rr] || [];
          cells[rr][cc] = dr === 0 && dc === 0 ? text.trim() : '';
        }
      }
      if (rs > 1 || cs > 1) merges.push({ r1: r, c1: c, r2: r + rs - 1, c2: c + cs - 1 });
      c += cs;
    }
  });
  const width = Math.max(...cells.map((r) => (r ? r.length : 0)));
  const grid = cells.map((r) => {
    const a = r ? [...r] : [];
    for (let i = 0; i < width; i++) if (a[i] == null) a[i] = '';
    return a;
  });
  return { cells: grid, merges, mergeInfo: true };
}

// TSV (따옴표로 감싼 여러 줄 셀 포함) → grid
export function gridFromTsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  const s = text.replace(/\r\n?/g, '\n');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === '\t') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return { cells: rows, merges: [], mergeInfo: false };
}

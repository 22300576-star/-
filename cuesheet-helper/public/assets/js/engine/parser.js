// 표(grid) → 큐시트 모델
// grid: { cells: string[][], merges: [{r1,c1,r2,c2}] (0-based, inclusive), name, mergeInfo: bool }
import { KEYS, LIGHT_KEYS } from './constants.js';
import { norm, squash, isBlank } from './vocab.js';

const HEADER_MAP = [
  [/^항목$/, 'item'],
  [/^runtime$/, 'runtime'],
  [/^무대$/, 'stage'],
  [/^대기인원$/, 'waiting'],
  [/^세부내용$/, 'detail'],
  [/^개사내용$|^개사$/, 'lyrics'],
  [/^원곡가사$/, 'x:원곡 가사'],
  [/음향/, 'sound'],
  [/^화면|^프로젝터$|^영상$/, 'screen'],
  [/^조명$/, '@light'],
  [/^비고/, 'note'],
];

const SUB_MAP = [
  [/^무대$|^stage$/, 'lStage'],
  [/^상단$/, 'lTop'],
  [/^pin1$|^핀1$/, 'pin1'],
  [/^pin2$|^핀2$/, 'pin2'],
  [/^pin3$|^핀3$/, 'pin3'],
  [/^pin4$|^핀4$/, 'pin4'],
  [/^details?$|^디테일$/, 'details'],
  [/^house$/, 'x:House'],
];

function isHeaderRow(row) {
  const s = row.map(squash);
  return s.includes('항목') && s.some((v) => v === 'runtime' || v.startsWith('runtime'));
}

function isGuideRow(row) {
  const t = row.map(norm).join(' ');
  return /총\s*13분|적어주세요|작성해주세요|O\s*\/\s*X\s*표시로/.test(t);
}

function isEmptyRow(row) {
  return row.every((v) => isBlank(v));
}

export function parseGrid(grid) {
  const cells = (grid.cells || []).map((r) => (r || []).map((v) => (v == null ? '' : String(v))));
  const merges = grid.merges || [];
  const width = Math.max(0, ...cells.map((r) => r.length));
  for (const r of cells) while (r.length < width) r.push('');

  const warnings = [];
  let headerIdx = -1;
  for (let i = 0; i < Math.min(cells.length, 25); i++) {
    if (isHeaderRow(cells[i])) {
      headerIdx = i;
      break;
    }
  }

  const colMap = new Array(width).fill(null); // column index -> key ('x:..' extra)
  let layout = 'unknown';
  let feedbackNote = '';

  if (headerIdx >= 0) {
    const head = cells[headerIdx].map(squash);
    const sub = (cells[headerIdx + 1] || []).map(squash);
    let lightStart = -1;
    head.forEach((h, c) => {
      if (!h) return;
      for (const [re, key] of HEADER_MAP) {
        if (re.test(h)) {
          if (key === '@light') lightStart = c;
          else if (!colMap.includes(key) || key.startsWith('x:')) colMap[c] = key;
          else colMap[c] = `x:${norm(cells[headerIdx][c]).replace(/\n/g, ' ')}`;
          return;
        }
      }
      colMap[c] = `x:${norm(cells[headerIdx][c])}`;
    });
    // 조명 하위 열
    let sawHouse = false;
    let pinCount = 0;
    sub.forEach((h, c) => {
      if (!h) return;
      if (lightStart >= 0 && c < lightStart) return;
      for (const [re, key] of SUB_MAP) {
        if (re.test(h)) {
          if (colMap[c] && !colMap[c].startsWith('x:') && colMap[c] !== 'stage') return;
          colMap[c] = key;
          if (key === 'x:House') sawHouse = true;
          if (/^pin/.test(key)) pinCount++;
          return;
        }
      }
    });
    if (sawHouse || (pinCount === 2 && !colMap.includes('lTop'))) {
      // 2025 양식: House / Stage / Pin1(왼쪽) / Pin2(오른쪽) / Details
      layout = '2025';
      const p2 = colMap.indexOf('pin2');
      if (p2 >= 0 && !colMap.includes('pin4')) colMap[p2] = 'pin4';
    } else layout = '2026';
    // 비고 다음의 이름 없는 열은 버린다
    feedbackNote = cells
      .slice(0, headerIdx)
      .map((r) => r.map(norm).filter(Boolean).join(' / '))
      .filter(Boolean)
      .join('\n');
  } else {
    // 머리글 없이 본문만 붙여 넣은 경우: 2026 양식 열 순서로 가정
    KEYS.forEach((k, i) => {
      if (i < width) colMap[i] = k;
    });
    for (let i = KEYS.length; i < width; i++) colMap[i] = `x:열 ${i + 1}`;
    layout = 'assumed';
    warnings.push('머리글(항목 / Run Time …) 행을 찾지 못해 2026 양식 열 순서(A~P)로 읽었습니다.');
  }

  // 본문 시작 행
  let start = headerIdx >= 0 ? headerIdx + 1 : 0;
  // 하위 머리글(조명 무대/상단/Pin) 행 건너뛰기
  if (headerIdx >= 0) {
    const s = (cells[start] || []).map(squash);
    if (s.some((v) => /^pin\d$|^상단$|^house$|^stage$/.test(v))) start++;
  }

  // 병합 정보: 각 셀이 어느 병합의 일부인지
  const anchorOf = new Map(); // "r,c" -> merge
  for (const m of merges) {
    for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) anchorOf.set(`${r},${c}`, m);
  }

  const rows = [];
  const extraKeys = [];
  for (let r = start; r < cells.length; r++) {
    const raw = cells[r];
    if (isHeaderRow(raw)) {
      // 2025 양식처럼 머리글이 반복되는 경우 → 다음 행(하위 머리글)도 건너뜀
      const next = (cells[r + 1] || []).map(squash);
      if (next.some((v) => /^pin\d$|^상단$|^house$|^stage$/.test(v))) r++;
      continue;
    }
    if (isGuideRow(raw)) continue;
    const rowMerged = raw.some((_, c) => {
      const m = anchorOf.get(`${r},${c}`);
      return m && m.r1 < r;
    });
    if (isEmptyRow(raw) && !rowMerged) continue;

    const row = { id: `r${r + 1}`, src: r + 1, c: {}, cont: {}, extra: {} };
    for (const k of KEYS) {
      row.c[k] = '';
      row.cont[k] = false;
    }
    raw.forEach((v, c) => {
      const key = colMap[c];
      if (!key) return;
      const val = norm(v);
      const m = anchorOf.get(`${r},${c}`);
      if (key.startsWith('x:')) {
        const name = key.slice(2);
        if (!val) return;
        if (!extraKeys.includes(name)) extraKeys.push(name);
        row.extra[name] = row.extra[name] ? `${row.extra[name]}\n${val}` : val;
        return;
      }
      if (m && (m.r1 !== r || m.c1 !== c)) {
        // 병합된 셀의 비-앵커 위치
        if (m.r1 < r && c === m.c1) {
          row.cont[key] = true; // 위 행과 세로 병합
        } else if (m.r1 === r && m.c1 < c) {
          // 같은 행 가로 병합: 'X', '암전'처럼 짧은 공통 지시는 각 조명 칸에 복사,
          // 긴 설명(여러 조명을 한 칸에 몰아 쓴 경우)은 앵커 칸에만 두고 나중에 칸별로 나눈다
          const anchorKey = colMap[m.c1];
          const anchorVal = norm(cells[r][m.c1]);
          const short = anchorVal.length <= 20 && !anchorVal.includes('\n') && !/[:：]/.test(anchorVal);
          if ((LIGHT_KEYS.includes(key) || key === 'details') && short) {
            if (anchorKey && (LIGHT_KEYS.includes(anchorKey) || anchorKey === 'details')) row.c[key] = anchorVal;
          } else if (LIGHT_KEYS.includes(key) || key === 'details') {
            row.hspan = row.hspan || {};
            row.hspan[anchorKey] = (row.hspan[anchorKey] || []).concat(key);
          }
        } else if (m.r1 < r && c > m.c1) {
          row.cont[key] = true;
        }
        return;
      }
      if (row.c[key]) row.c[key] += `\n${val}`;
      else row.c[key] = val;
    });
    rows.push(row);
  }

  // 마지막 빈 행 정리
  while (rows.length) {
    const last = rows[rows.length - 1];
    const hasAny = KEYS.some((k) => last.c[k]) || Object.keys(last.extra).length;
    if (hasAny) break;
    rows.pop();
  }

  return {
    name: grid.name || '',
    layout,
    mergeInfo: !!grid.mergeInfo,
    feedbackNote,
    extraKeys,
    warnings,
    rows,
  };
}

// 모델 → 블록(항목 단위) 구조
export function buildBlocks(rows) {
  const blocks = [];
  let cur = null;
  rows.forEach((row, i) => {
    const startsNew = !cur || (row.c.item && !row.cont.item);
    if (startsNew) {
      cur = { index: blocks.length, item: row.c.item, rows: [], startRow: i };
      blocks.push(cur);
    }
    cur.rows.push(row);
    row.block = cur.index;
  });
  return blocks;
}

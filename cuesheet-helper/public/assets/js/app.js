import { parseGrid, buildBlocks } from './engine/parser.js';
import { classifyItem } from './engine/classify.js';
import { analyze } from './engine/analyze.js';
import { COLS, KEYS, CATS, LEVELS, GUIDE_ROW, PLACEHOLDER, colName } from './engine/constants.js';
import { fmtClock, fmtDurationKo } from './engine/time.js';
import { readWorkbook, looksLikeCueSheet, gridFromHtml, gridFromTsv } from './io/importers.js';
import { exportXlsx, safeSheetName } from './io/export-xlsx.js';
import { toHtmlTable, toTsv } from './io/export-html.js';
import { SAMPLE_DRAFT, SAMPLE_MODEL } from './samples.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clone = (o) => JSON.parse(JSON.stringify(o));

const COL_PX = { item: 120, runtime: 150, stage: 170, waiting: 120, detail: 230, lyrics: 200, sound: 160, screen: 110, lStage: 150, lTop: 150, pin1: 80, pin2: 80, pin3: 80, pin4: 80, details: 260, note: 110 };
const FX_OPTIONS = ['', '스트로브', '고보(무늬 투사)', '무빙(좌우 교차·원 그리기)', '추가 핀(Pin1~4 외 위치)', '조합 연출(여러 효과를 하나로)'];

const state = {
  name: '',
  original: null,
  originalMap: new Map(),
  base: null,
  disabled: new Set(),
  fx: { FX1: '', FX2: '' },
  result: null,
  view: 'revised',
  showDiff: true,
  editMode: false,
  history: [],
  filter: { level: 'all', cat: 'all' },
  openId: null,
  selectedRow: null,
  ai: [],
  workbookSheets: null,
  uid: 0,
};

// ---------------- 공통 UI ----------------
function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}
function setStatus(msg, err = false) {
  const s = $('#load-status');
  s.textContent = msg || '';
  s.classList.toggle('err', !!err);
}

function nav(view) {
  for (const v of ['check', 'guide', 'example']) $(`#view-${v}`).hidden = v !== view;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === view));
  if (view === 'example') renderExample();
  window.scrollTo({ top: 0 });
}
window.addEventListener('hashchange', () => nav(location.hash.replace('#', '') || 'check'));

// ---------------- 불러오기 ----------------
function initInputs() {
  $$('.tab').forEach((t) =>
    t.addEventListener('click', () => {
      $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
      $$('.tab-panel').forEach((p) => p.classList.toggle('active', p.dataset.panel === t.dataset.tab));
    }),
  );
  $('#btn-load-link').addEventListener('click', loadFromLink);
  $('#sheet-url').addEventListener('keydown', (e) => e.key === 'Enter' && loadFromLink());
  const dz = $('#dropzone');
  const fi = $('#file-input');
  fi.addEventListener('change', () => fi.files[0] && loadFile(fi.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => (e.preventDefault(), dz.classList.add('drag'))));
  ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => (e.preventDefault(), dz.classList.remove('drag'))));
  dz.addEventListener('drop', (e) => e.dataTransfer.files[0] && loadFile(e.dataTransfer.files[0]));
  $('#paste-box').addEventListener('paste', onPaste);
  $('#btn-sample-draft').addEventListener('click', () => loadGrid(clone(SAMPLE_DRAFT), '예시학부(수정 전)'));
  $('#btn-sample-model').addEventListener('click', () => loadGrid(clone(SAMPLE_MODEL), '예시학부(모범 예시)'));
  $('#btn-blank').addEventListener('click', startBlank);
  $('#btn-pick-sheet').addEventListener('click', () => {
    const i = Number($('#sheet-select').value);
    const sh = state.workbookSheets[i];
    loadGrid(sh, sh.name);
  });
}

function ensureExcel() {
  if (!window.ExcelJS) throw new Error('엑셀 처리 모듈을 아직 불러오는 중입니다. 잠시 후 다시 시도해주세요.');
  return window.ExcelJS;
}

async function loadFile(file) {
  try {
    setStatus(`'${file.name}' 읽는 중…`);
    const buf = await file.arrayBuffer();
    const sheets = await readWorkbook(ensureExcel(), buf);
    offerSheets(sheets, null);
  } catch (e) {
    console.error(e);
    setStatus(`파일을 읽지 못했습니다: ${e.message}`, true);
  }
}

function sheetIdFromUrl(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  const g = String(url).match(/[#&?]gid=(\d+)/);
  return m ? { id: m[1], gid: g ? g[1] : null } : null;
}

async function loadFromLink() {
  const parsed = sheetIdFromUrl($('#sheet-url').value.trim());
  if (!parsed) return setStatus('구글 시트 주소를 확인해주세요. (https://docs.google.com/spreadsheets/d/… 형식)', true);
  setStatus('구글 시트를 불러오는 중… (탭이 많으면 몇 초 걸립니다)');
  $('#btn-load-link').disabled = true;
  const q = `id=${encodeURIComponent(parsed.id)}`;
  const tsvP = parsed.gid
    ? fetch(`/api/sheet?${q}&gid=${parsed.gid}&format=tsv`)
        .then((r) => (r.ok ? r.text() : null))
        .catch(() => null)
    : Promise.resolve(null);
  try {
    let sheets = null;
    let err = null;
    try {
      const res = await fetch(`/api/sheet?${q}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `불러오기 실패 (${res.status})`);
      }
      sheets = await readWorkbook(ensureExcel(), await res.arrayBuffer());
    } catch (e) {
      err = e;
    }
    const tsv = await tsvP;
    if (sheets) return offerSheets(sheets, tsv);
    if (tsv) {
      loadGrid({ ...gridFromTsv(tsv), name: '구글 시트 탭' }, '구글 시트 탭');
      setStatus('셀 병합 정보 없이 탭 내용만 불러왔습니다. 병합된 칸은 위 칸과 같은 내용으로 보고 점검했습니다.');
      return;
    }
    throw err || new Error('시트를 불러오지 못했습니다.');
  } catch (e) {
    console.error(e);
    setStatus(e.message, true);
  } finally {
    $('#btn-load-link').disabled = false;
  }
}

function matchGid(sheets, tsv) {
  if (!tsv) return -1;
  const g = gridFromTsv(tsv);
  const sample = g.cells.flat().map((s) => s.replace(/\s+/g, '')).filter((s) => s.length > 3).slice(0, 40);
  let best = -1;
  let bestScore = 0;
  sheets.forEach((sh, i) => {
    const txt = sh.cells.flat().join('').replace(/\s+/g, '');
    const score = sample.filter((s) => txt.includes(s)).length;
    if (score > bestScore) {
      best = i;
      bestScore = score;
    }
  });
  return bestScore >= Math.min(5, sample.length) ? best : -1;
}

function offerSheets(sheets, gidTsv) {
  if (!sheets.length) return setStatus('시트를 찾지 못했습니다.', true);
  state.workbookSheets = sheets;
  const gidIdx = matchGid(sheets, gidTsv);
  const scored = sheets.map((s, i) => ({ i, s, score: looksLikeCueSheet(s) }));
  const cue = scored.filter((x) => x.score >= 5);
  if (sheets.length === 1 || (cue.length === 1 && gidIdx < 0)) {
    const pick = sheets.length === 1 ? sheets[0] : cue[0].s;
    return loadGrid(pick, pick.name);
  }
  const sel = $('#sheet-select');
  sel.innerHTML = scored
    .map((x) => `<option value="${x.i}" ${x.i === gidIdx ? 'selected' : ''}>${esc(x.s.name)}${x.score >= 5 ? '' : ' (큐시트 아님?)'}</option>`)
    .join('');
  if (gidIdx < 0 && cue.length) sel.value = String(cue[0].i);
  $('#sheet-picker').hidden = false;
  setStatus(`탭 ${sheets.length}개를 찾았습니다. 점검할 학부 탭을 고르세요.${gidIdx >= 0 ? ' (주소의 탭을 먼저 골라두었습니다)' : ''}`);
  if (gidIdx >= 0) loadGrid(sheets[gidIdx], sheets[gidIdx].name);
}

function onPaste(e) {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  let grid = null;
  if (html && /<table/i.test(html)) grid = gridFromHtml(html);
  if (!grid && text) grid = gridFromTsv(text);
  if (!grid || !grid.cells.length) return setStatus('붙여넣은 내용에서 표를 찾지 못했습니다.', true);
  $('#paste-box').textContent = `표 ${grid.cells.length}행을 읽었습니다.`;
  loadGrid(grid, '붙여넣은 큐시트');
}

function blankGrid() {
  const H = [
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['항목', 'Run Time', '무대', '대기 인원', '세부 내용', '개사 내용', '음향 / FD', '화면(영상)', '조명', '', '', '', '', '', '', '비고'],
    ['', '', '', '', '', '', '', '', '무대', '상단', 'Pin1', 'Pin2', 'Pin3', 'Pin4', 'Details', ''],
  ];
  const e = () => new Array(16).fill('');
  const row = (vals) => Object.assign(e(), vals);
  return {
    name: '새 큐시트',
    mergeInfo: true,
    merges: [],
    cells: [
      ...H,
      row({ 0: '학부 소개 및 투표(사회자)', 2: '사회자' }),
      row({ 0: '학부 인트로 영상', 2: '무대 단원 대기 및 입장', 7: '영상' }),
      row({ 0: '자체영상 1', 1: '00:00 ~ 00:30 (30초)', 7: '영상' }),
      row({ 0: '무대 1\n(곡 제목 - 가수)', 1: '00:30 ~ 00:45 (15초)', 7: '가사 영상 1' }),
      row({ 1: '00:45 ~ 01:10 (25초)' }),
      row({ 0: '자체영상 2', 1: '01:10 ~ 01:40 (30초)', 7: '영상' }),
      row({ 0: '무대 2\n(곡 제목 - 가수)', 1: '01:40 ~ 02:00 (20초)', 7: '가사 영상 2' }),
    ],
  };
}

function startBlank() {
  loadGrid(blankGrid(), '새 큐시트');
  setEditMode(true);
  toast('빈 양식을 열었습니다. 칸을 눌러 바로 작성하세요.');
}

function loadGrid(grid, name) {
  try {
    const model = parseGrid(grid);
    if (!model.rows.length) throw new Error('큐시트 내용 행을 찾지 못했습니다.');
    state.name = (name || grid.name || '큐시트').replace(/\.xlsx$/i, '');
    for (const b of buildBlocks(model.rows)) {
      const kind = classifyItem(b.item, b.rows);
      b.rows.forEach((r) => (r.kind = kind));
    }
    state.original = model;
    state.originalMap = new Map(model.rows.map((r) => [r.id, r]));
    state.base = clone(model);
    state.disabled = new Set();
    state.history = [];
    state.editMode = false;
    state.ai = [];
    state.fx = { FX1: '', FX2: '' };
    state.filter = { level: 'all', cat: 'all' };
    state.view = 'revised';
    $('#toggle-edit').checked = false;
    $('#sheet-picker').hidden = !!(state.workbookSheets && state.workbookSheets.length > 1) ? false : true;
    run();
    $('#result').hidden = false;
    setStatus(`'${state.name}' 점검 완료${model.warnings.length ? ` · ${model.warnings.join(' ')}` : ''}`);
    $('#summary').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    console.error(e);
    setStatus(e.message, true);
  }
}

// ---------------- 분석 실행 ----------------
function run() {
  state.result = analyze(state.base, { disabled: state.disabled, fx: state.fx });
  renderAll();
}

function renderAll() {
  renderSummary();
  renderFilters();
  renderFx();
  renderFeedback();
  renderGrid();
  renderAI();
  $('#feedback-text').value = state.result.summary.feedbackText;
}

function rowNumberMap(S) {
  const m = new Map();
  S.rows.forEach((r, i) => m.set(r.id, 5 + i));
  return m;
}

function locText(f) {
  const S = state.result.revised;
  if (!f.rowId) return '큐시트 전체';
  const nums = rowNumberMap(S);
  const row = S.rows.find((r) => r.id === f.rowId);
  if (!row) return '';
  const b = S.blocks[row.blockIndex];
  const label = (b && b.item ? b.item.split('\n')[0] : '') || '';
  return `${nums.get(row.id)}행 · ${label}${f.key ? ` · ${colName(f.key)}` : ''}`;
}

// ---------------- 요약 ----------------
function scoreRing(score) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const color = score >= 90 ? '#188038' : score >= 70 ? '#c77700' : '#d93025';
  return `<div class="score"><svg width="108" height="108" viewBox="0 0 108 108"><circle cx="54" cy="54" r="${r}" fill="none" stroke="#eef1f6" stroke-width="10"/><circle cx="54" cy="54" r="${r}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round" stroke-dasharray="${(c * score) / 100} ${c}"/></svg><div class="num"><div><b>${score}</b><small>완성도</small></div></div></div>`;
}

function renderSummary() {
  const { summary, timeline, revised } = state.result;
  const c = summary.counts;
  const blocks = [];
  for (const t of timeline) {
    const last = blocks[blocks.length - 1];
    if (last && last.block === t.block) last.end = t.end;
    else blocks.push({ ...t });
  }
  const total = Math.max(660, ...blocks.map((b) => b.end), 1);
  const segs = blocks
    .map((b) => {
      const w = ((b.end - b.start) / total) * 100;
      const left = (b.start / total) * 100;
      return `<div class="seg ${b.kind}" style="position:absolute;left:${left}%;width:${w}%" title="${esc(b.label)} ${fmtClock(b.start)}~${fmtClock(b.end)}">${w > 6 ? esc(b.label) : ''}</div>`;
    })
    .join('');
  const catKeys = ['time', 'stage', 'detail', 'lyrics', 'sound', 'screen', 'light'];
  const cats = catKeys
    .map((k) => {
      const s = summary.catStatus[k];
      const n = s.error + s.warn;
      return `<button class="cat ${s.status}" data-cat="${k}"><b>${CATS[k]}</b>${s.status === 'ok' ? '통과' : `${s.error ? `필수 ${s.error}` : ''}${s.error && s.warn ? ' · ' : ''}${s.warn ? `권장 ${s.warn}` : ''}`}</button>`;
    })
    .join('');
  const base = summary.baseMode && summary.baseMode.startsWith('after') ? '인트로 영상 이후 00:00 기준' : '인트로 포함 기준';
  $('#summary').innerHTML = `
    ${scoreRing(summary.score)}
    <div class="sum-main">
      <h2>${esc(state.name)}</h2>
      <div class="meta">${revised.rows.length}행 · 무대 시간 ${summary.totalText} / 11분 · ${base} · 자동 수정 ${summary.autoCells}칸${state.editMode ? ' · 직접 수정 중' : ''}</div>
      <div class="chips">
        <button class="chip error" data-level="error">필수 수정 ${c.error}</button>
        <button class="chip warn" data-level="warn">권장 ${c.warn}</button>
        <button class="chip info" data-level="info">참고 ${c.info}</button>
        ${summary.pendingCount ? `<button class="chip pending" data-cat="pending">논의 중 ${summary.pendingCount}행</button>` : ''}
        ${c.error === 0 && c.warn === 0 ? '<span class="chip ok">제출 가능</span>' : ''}
      </div>
      <div class="timebar">
        <div class="track" style="position:relative">${segs}<div class="limit" style="left:${(660 / total) * 100}%" title="11분"></div></div>
        <div class="labels"><span>00:00</span><span>무대 11분 제한 ▲ · 파랑 = 무대, 회색 = 영상</span><span>${fmtClock(total)}</span></div>
      </div>
    </div>
    <div class="cats">${cats}</div>`;
  $$('#summary [data-level]').forEach((b) => b.addEventListener('click', () => setFilter({ level: b.dataset.level, cat: 'all' })));
  $$('#summary [data-cat]').forEach((b) => b.addEventListener('click', () => setFilter({ level: 'all', cat: b.dataset.cat })));
}

// ---------------- 피드백 목록 ----------------
function setFilter(f) {
  state.filter = { ...state.filter, ...f };
  renderFilters();
  renderFeedback();
  $('#feedback-pane').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function renderFilters() {
  const { level, cat } = state.filter;
  const usedCats = [...new Set(state.result.findings.map((f) => f.cat))];
  const lv = [['all', '전체'], ['error', '필수 수정'], ['warn', '권장'], ['info', '참고']];
  $('#filters').innerHTML =
    lv.map(([k, t]) => `<button class="filter ${level === k ? 'active' : ''}" data-l="${k}">${t}</button>`).join('') +
    `<select class="filter" id="cat-filter"><option value="all">모든 영역</option>${usedCats.map((k) => `<option value="${k}" ${cat === k ? 'selected' : ''}>${CATS[k] || k}</option>`).join('')}</select>`;
  $$('#filters [data-l]').forEach((b) => b.addEventListener('click', () => setFilter({ level: b.dataset.l })));
  $('#cat-filter').addEventListener('change', (e) => setFilter({ cat: e.target.value }));
}

function renderFx() {
  const det = (state.result.revised.fx && state.result.revised.fx.defs) || {};
  const typeName = { strobe: '스트로브', gobo: '고보', moving: '무빙', extraPin: '추가 핀' };
  $$('#fx-box select').forEach((sel) => {
    const k = sel.dataset.fx;
    const n = k.slice(2);
    const found = (det[n] || []).map((t) => typeName[t]).join('+');
    sel.innerHTML = FX_OPTIONS.map((o) => `<option value="${esc(o)}" ${state.fx[k] === o ? 'selected' : ''}>${o || (found ? `감지됨: ${found}` : '지정 안 함')}</option>`).join('');
    sel.onchange = () => {
      state.fx[k] = sel.value;
      run();
    };
  });
}

function fbHtml(f) {
  const open = state.openId === f.id;
  const fix = f.fixId
    ? `<label class="switch fb-fix ${f.fixEnabled ? '' : 'off'}" onclick="event.stopPropagation()"><input type="checkbox" data-fix="${esc(f.fixId)}" ${f.fixEnabled ? 'checked' : ''}><span>${f.fixEnabled ? '수정본에 자동 반영함' : '자동 반영 안 함'}</span></label>`
    : '';
  return `<div class="fb ${f.level} ${open ? 'open active' : ''}" data-id="${esc(f.id)}">
    <div class="fb-top"><span class="badge ${f.level}">${LEVELS[f.level].label}</span><span class="badge cat">${CATS[f.cat] || f.cat}</span></div>
    <div class="fb-title">${esc(f.title)}</div>
    <div class="fb-loc">${esc(locText(f))}</div>
    <div class="fb-msg">${esc(f.msg)}
      ${f.suggestion ? `<div class="fb-sug">대안 → ${esc(f.suggestion)}</div>` : ''}
      ${f.examples && f.examples.length ? `<ul class="fb-ex">${f.examples.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${f.why ? `<div class="fb-why">${esc(f.why)}</div>` : ''}
      ${fix}
    </div>
  </div>`;
}

function renderFeedback() {
  const { level, cat } = state.filter;
  const list = state.result.findings.filter((f) => (level === 'all' || f.level === level) && (cat === 'all' || f.cat === cat));
  if (!list.length) {
    $('#feedback-list').innerHTML = `<div class="empty">${state.result.findings.length ? '이 조건에 맞는 피드백이 없습니다.' : '고칠 점이 없습니다. 제출해도 좋습니다! 🎉'}</div>`;
    return;
  }
  let html = '';
  for (const lv of ['error', 'warn', 'info']) {
    const items = list.filter((f) => f.level === lv);
    if (!items.length) continue;
    html += `<div class="group-title">${LEVELS[lv].label} ${items.length}</div>${items.map(fbHtml).join('')}`;
  }
  $('#feedback-list').innerHTML = html;
  $$('#feedback-list .fb').forEach((el) =>
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      state.openId = state.openId === id ? null : id;
      renderFeedback();
      const f = state.result.findings.find((x) => x.id === id);
      if (f && state.openId) focusCell(f.rowId, f.key);
    }),
  );
  $$('#feedback-list [data-fix]').forEach((cb) =>
    cb.addEventListener('change', () => {
      const id = cb.dataset.fix;
      if (cb.checked) state.disabled.delete(id);
      else state.disabled.add(id);
      run();
    }),
  );
}

function focusCell(rowId, key) {
  if (!rowId) return;
  if (state.view !== 'revised') setView('revised');
  const sel = key ? `td[data-row="${CSS.escape(rowId)}"][data-key="${key}"]` : `td[data-row="${CSS.escape(rowId)}"]`;
  let td = $(sel, $('#grid-wrap'));
  if (!td && key) {
    // 병합된 칸이면 같은 열의 앵커를 찾음
    const S = state.result.revised;
    const idx = S.rows.findIndex((r) => r.id === rowId);
    for (let i = idx; i >= 0; i--) {
      td = $(`td[data-row="${CSS.escape(S.rows[i].id)}"][data-key="${key}"]`, $('#grid-wrap'));
      if (td) break;
    }
  }
  if (!td) return;
  td.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  td.classList.remove('flash');
  void td.offsetWidth;
  td.classList.add('flash');
}

// ---------------- 시트 그리드 ----------------
function setView(v) {
  state.view = v;
  $$('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  renderGrid();
}

function spansFor(S, key) {
  const map = new Map();
  for (const b of S.blocks || []) {
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

function originalBlocks(model) {
  // 원본 보기용 블록(세로 병합 계산)
  const blocks = [];
  let cur = null;
  for (const r of model.rows) {
    if (!cur || (r.c.item && !r.cont.item)) {
      cur = { rows: [] };
      blocks.push(cur);
    }
    cur.rows.push(r);
  }
  return blocks;
}

function sheetTable(S, { mode = 'revised', editable = false, findings = [], compact = false } = {}) {
  const nums = new Map(S.rows.map((r, i) => [r.id, 5 + i]));
  const blocks = S.blocks || originalBlocks(S);
  const spanS = { ...S, blocks };
  const spans = Object.fromEntries(KEYS.map((k) => [k, spansFor(spanS, k)]));
  const cellLevel = new Map();
  const rank = { error: 3, warn: 2, info: 1 };
  for (const f of findings) {
    if (!f.rowId || !f.key) continue;
    const k = `${f.rowId}|${f.key}`;
    if (!cellLevel.has(k) || rank[f.level] > rank[cellLevel.get(k)]) cellLevel.set(k, f.level);
  }
  const cols = `<colgroup><col style="width:34px">${KEYS.map((k) => `<col style="width:${COL_PX[k]}px">`).join('')}</colgroup>`;
  let head = '<thead><tr class="h1"><th class="rowh" rowspan="2"></th>';
  for (const c of COLS) {
    if (c.key === 'lStage') head += '<th colspan="7">조명</th>';
    else if (c.group) continue;
    else head += `<th rowspan="2" class="c-${c.key}">${esc(c.label)}</th>`;
  }
  head += `</tr><tr class="h2">${COLS.filter((c) => c.group).map((c) => `<th>${esc(c.label)}</th>`).join('')}</tr>`;
  if (!compact) head += `<tr class="h3"><th class="rowh">4</th>${KEYS.map((k) => `<th class="c-${k}" title="${esc(GUIDE_ROW[k] || '')}"><span>${esc((GUIDE_ROW[k] || '').split('\n')[0])}</span></th>`).join('')}</tr>`;
  head += '</thead>';
  let body = '<tbody>';
  for (const row of S.rows) {
    const orig = state.originalMap.get(row.id);
    body += `<tr class="k-${row.kind || 'stage'} ${state.selectedRow === row.id && editable ? 'sel' : ''}" data-row="${esc(row.id)}"><td class="rowh" data-rowh="${esc(row.id)}">${nums.get(row.id)}</td>`;
    for (const k of KEYS) {
      const isCont = row.cont[k];
      if (isCont && !editable) continue;
      const m = row.marks && row.marks[k];
      const cls = [`c-${k}`];
      let diff = false;
      if (mode === 'revised' && state.showDiff && !isCont) {
        if (!orig) diff = !!row.c[k];
        else diff = (row.c[k] || '') !== (orig.cont[k] ? '' : orig.c[k] || '') || (orig.cont[k] && !isCont && !!row.c[k]);
      }
      if (m && m.pending) cls.push('pending');
      else if (m && m.placeholder) cls.push('placeholder');
      else if (diff) cls.push('changed');
      if (isCont) cls.push('cont');
      const lvl = cellLevel.get(`${row.id}|${k}`);
      const rs = !editable && spans[k].get(row.id) > 1 ? ` rowspan="${spans[k].get(row.id)}"` : '';
      const ce = editable ? ' contenteditable="true"' : '';
      const text = isCont ? '' : row.c[k] || '';
      body += `<td class="${cls.join(' ')}" data-row="${esc(row.id)}" data-key="${k}"${rs}${ce}>${esc(text)}${isCont && editable ? '' : ''}${lvl ? `<i class="mk ${lvl}"></i>` : ''}</td>`;
    }
    body += '</tr>';
  }
  body += '</tbody>';
  const width = 34 + KEYS.reduce((n, k) => n + COL_PX[k], 0);
  return `<table class="sheet ${editable ? 'editing' : ''}" style="width:${width}px">${cols}${head}${body}</table>`;
}

function renderGrid() {
  const wrap = $('#grid-wrap');
  const scroll = { t: wrap.scrollTop, l: wrap.scrollLeft };
  const S = state.view === 'original' ? state.original : state.result.revised;
  const editable = state.editMode && state.view === 'revised';
  wrap.innerHTML = sheetTable(S, { mode: state.view, editable, findings: state.view === 'revised' ? state.result.findings : [] });
  wrap.scrollTop = scroll.t;
  wrap.scrollLeft = scroll.l;
  ['#btn-add-row', '#btn-del-row', '#btn-undo'].forEach((s) => ($(s).hidden = !state.editMode));
}

// 툴팁
function initTooltip() {
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const td = e.target.closest && e.target.closest('#grid-wrap td[data-key]');
    if (!td || state.view !== 'revised' || document.activeElement === td) return (tip.hidden = true);
    const row = state.result.revised.rows.find((r) => r.id === td.dataset.row);
    if (!row) return (tip.hidden = true);
    const k = td.dataset.key;
    const orig = state.originalMap.get(row.id);
    const m = row.marks && row.marks[k];
    const parts = [`<b>${esc(colName(k))}</b>`];
    if (m && m.reasons && m.reasons.length) parts.push(`자동 수정: ${esc(m.reasons.join(', '))}`);
    const ov = orig ? (orig.cont[k] ? '(위 칸과 병합)' : orig.c[k]) : '(새로 추가된 행)';
    if (td.classList.contains('changed') || (m && (m.changed || m.placeholder))) parts.push(`<span class="before">원래: ${esc(ov || '(빈칸)').slice(0, 240)}</span>`);
    const fs = state.result.findings.filter((f) => f.rowId === row.id && f.key === k);
    for (const f of fs.slice(0, 3)) parts.push(`• [${LEVELS[f.level].label}] ${esc(f.title)}`);
    if (parts.length === 1) return (tip.hidden = true);
    tip.innerHTML = parts.join('\n');
    tip.hidden = false;
    const r = td.getBoundingClientRect();
    const x = Math.min(window.innerWidth - 380, r.left);
    const y = r.bottom + 8 + 160 > window.innerHeight ? r.top - 8 - tip.offsetHeight : r.bottom + 8;
    tip.style.left = `${Math.max(8, x)}px`;
    tip.style.top = `${Math.max(8, y)}px`;
  });
  document.addEventListener('scroll', () => ($('#tip').hidden = true), true);
}

// ---------------- 직접 수정 ----------------
function stripForBase(S) {
  return {
    name: S.name,
    layout: '2026',
    mergeInfo: true,
    feedbackNote: S.feedbackNote || '',
    extraKeys: [],
    warnings: [],
    rows: S.rows.map((r) => ({ id: r.id, src: r.src, c: { ...r.c }, cont: { ...r.cont }, extra: {} })),
  };
}

function setEditMode(on) {
  if (on && !state.editMode) {
    state.history.push({ base: clone(state.base), disabled: new Set(state.disabled) });
    state.base = stripForBase(state.result.revised);
    state.disabled = new Set();
    state.editMode = true;
    toast('지금의 수정본을 기준으로 직접 고칠 수 있습니다. 칸을 눌러 수정하세요.');
  } else if (!on && state.editMode) {
    state.editMode = false;
  }
  $('#toggle-edit').checked = state.editMode;
  setView('revised');
  run();
}

function initEditing() {
  const wrap = $('#grid-wrap');
  wrap.addEventListener('focusout', onCellBlur);
  wrap.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.matches('td[contenteditable]')) e.target.blur();
  });
  wrap.addEventListener('focusin', (e) => {
    if (e.target.matches && e.target.matches('td[contenteditable]')) state.selectedRow = e.target.dataset.row;
  });
  wrap.addEventListener('click', (e) => {
    const td = e.target.closest && e.target.closest('td[data-rowh]');
    if (!td || !state.editMode) return;
    state.selectedRow = td.dataset.rowh;
    $$('tr.sel', wrap).forEach((tr) => tr.classList.remove('sel'));
    td.parentElement.classList.add('sel');
  });
}

function onCellBlur(e) {
  const td = e.target;
  if (!td.matches || !td.matches('td[contenteditable]')) return;
  const row = state.base.rows.find((r) => r.id === td.dataset.row);
  if (!row) return;
  const k = td.dataset.key;
  const val = td.innerText.replace(/\r/g, '').replace(/\n$/, '').trim();
  const cur = row.cont[k] ? '' : row.c[k] || '';
  if (val === cur) return;
  row.c[k] = val;
  row.cont[k] = false;
  clearTimeout(onCellBlur._t);
  onCellBlur._t = setTimeout(run, 60);
}

function addRow() {
  const rows = state.base.rows;
  const idx = Math.max(0, rows.findIndex((r) => r.id === state.selectedRow));
  const nr = { id: `u${Date.now().toString(36)}${state.uid++}`, src: null, c: Object.fromEntries(KEYS.map((k) => [k, ''])), cont: Object.fromEntries(KEYS.map((k) => [k, false])), extra: {} };
  rows.splice(idx + 1, 0, nr);
  state.selectedRow = nr.id;
  run();
  focusCell(nr.id, 'runtime');
}

function delRow() {
  const rows = state.base.rows;
  const idx = rows.findIndex((r) => r.id === state.selectedRow);
  if (idx < 0) return toast('지울 행의 왼쪽 행 번호를 먼저 눌러 선택하세요.');
  const r = rows[idx];
  const next = rows[idx + 1];
  if (r.c.item && next && !next.c.item) {
    // 블록 첫 행을 지우면 공통 항목을 다음 행으로 넘김
    for (const k of ['item', 'stage', 'waiting', 'sound', 'screen']) {
      if (next.cont[k]) {
        next.c[k] = r.c[k];
        next.cont[k] = false;
      }
    }
  }
  rows.splice(idx, 1);
  state.selectedRow = null;
  run();
}

function undoAll() {
  if (!state.history.length) return;
  const h = state.history[0];
  state.base = h.base;
  state.disabled = h.disabled;
  state.history = [];
  state.editMode = false;
  $('#toggle-edit').checked = false;
  run();
  toast('직접 수정 전, 처음 점검 결과로 되돌렸습니다.');
}

// ---------------- 내보내기 ----------------
function download(buf, filename) {
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => (URL.revokeObjectURL(a.href), a.remove()), 1000);
}

async function exportFile(mode) {
  try {
    const buf = await exportXlsx(ensureExcel(), state.result.revised, {
      mode,
      feedbackText: $('#feedback-text').value,
      findings: state.result.findings,
      title: safeSheetName(state.name),
    });
    const base = state.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || '큐시트';
    download(buf, `${base}_2026큐시트_${mode === 'review' ? '검토용' : '수정본'}.xlsx`);
    toast(mode === 'review' ? '검토용 엑셀을 내려받았습니다.' : '제출용 수정본을 내려받았습니다.');
  } catch (e) {
    console.error(e);
    toast(`엑셀을 만들지 못했습니다: ${e.message}`);
  }
}

async function copySheet() {
  const S = state.result.revised;
  const html = toHtmlTable(S, { feedbackText: '', includeHeader: true });
  const text = toTsv(S);
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) }),
    ]);
  } catch {
    const div = document.createElement('div');
    div.innerHTML = html;
    div.style.position = 'fixed';
    div.style.left = '-9999px';
    document.body.appendChild(div);
    const range = document.createRange();
    range.selectNodeContents(div);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('copy');
    sel.removeAllRanges();
    div.remove();
  }
  toast('복사했습니다. 새 구글 시트의 A1 칸을 누르고 붙여넣기 하세요. (열 너비는 엑셀 파일이 더 정확합니다)', 4200);
}

function reportText() {
  const { summary, findings } = state.result;
  const L = [];
  L.push(`[2026 학부합창대회 큐시트 피드백] ${state.name}`);
  L.push(`완성도 ${summary.score}점 · 필수 수정 ${summary.counts.error} · 권장 ${summary.counts.warn} · 무대 시간 ${summary.totalText}/11분`);
  for (const lv of ['error', 'warn']) {
    const items = findings.filter((f) => f.level === lv && f.cat !== 'pending');
    if (!items.length) continue;
    L.push('');
    L.push(`■ ${LEVELS[lv].label}`);
    items.forEach((f, i) => {
      L.push(`${i + 1}. [${CATS[f.cat]}] ${f.title}${f.rowId ? ` (${locText(f)})` : ''}`);
      L.push(`   - ${f.msg}`);
      if (f.suggestion) L.push(`   → ${f.suggestion}`);
    });
  }
  const pend = findings.filter((f) => f.cat === 'pending');
  if (pend.length) {
    L.push('');
    L.push(`■ 논의 중(확정 필요) ${pend.length}곳: ${pend.map((f) => locText(f)).join(', ')}`);
  }
  const fixed = findings.filter((f) => f.fixId && f.fixEnabled);
  if (fixed.length) {
    L.push('');
    L.push('■ 수정본에 자동으로 반영한 것');
    [...new Set(fixed.map((f) => f.title))].forEach((t) => L.push(`- ${t}`));
  }
  L.push('');
  L.push('수정본 엑셀을 함께 보냅니다. 붉은 칸(작성 필요)과 보라 칸(논의 중)을 채워 다시 제출해주세요.');
  return L.join('\n');
}

async function copyText(text, msg) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  toast(msg);
}

// ---------------- AI 대안 (선택) ----------------
function renderAI() {
  const box = $('#ai-status');
  if (!state.ai.length) return;
  const html = state.ai
    .map(
      (s, i) => `<div class="ai-sug" data-i="${i}">
      <div><span class="badge cat">${esc(s.block || '')}</span> <b>${esc(colName(s.key))}</b> ${s.reason ? `<span class="fb-loc">— ${esc(s.reason)}</span>` : ''}</div>
      ${s.old ? `<div class="old">${esc(s.old)}</div>` : ''}<div class="new">${esc(s.text)}</div>
      <div class="acts">${s.applied ? '<span class="fb-loc">적용함</span>' : `<button class="btn small" data-apply="${i}">수정본에 적용</button><button class="btn small" data-skip="${i}">무시</button>`}</div></div>`,
    )
    .join('');
  box.innerHTML = html;
  $$('[data-apply]', box).forEach((b) => b.addEventListener('click', () => applyAI(Number(b.dataset.apply))));
  $$('[data-skip]', box).forEach((b) =>
    b.addEventListener('click', () => {
      state.ai.splice(Number(b.dataset.skip), 1);
      renderAI();
    }),
  );
}

function applyAI(i) {
  const s = state.ai[i];
  if (!state.editMode) setEditMode(true);
  const row = state.base.rows.find((r) => r.id === s.rowId);
  if (!row) return toast('해당 행을 찾지 못했습니다.');
  row.c[s.key] = s.text;
  row.cont[s.key] = false;
  s.applied = true;
  run();
  focusCell(s.rowId, s.key);
}

async function runAI() {
  const S = state.result.revised;
  const blocks = S.blocks.filter((b) => b.kind === 'stage' || b.kind === 'video');
  if (!blocks.length) return;
  if (!confirm('AI 대안을 만들기 위해 이 큐시트의 무대 내용이 Anthropic Claude API로 전송됩니다. 계속할까요?')) return;
  const btn = $('#btn-ai');
  btn.disabled = true;
  state.ai = [];
  const status = $('#ai-status');
  try {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const label = (b.item || '').split('\n')[0];
      status.innerHTML = `<div class="fb-loc">${i + 1}/${blocks.length} · ${esc(label)} 검토 중…</div>${status.innerHTML.replace(/^<div class="fb-loc">.*?<\/div>/, '')}`;
      const ids = new Set(b.rows.map((r) => r.id));
      const payload = {
        block: { label, kind: b.kind, rows: b.rows.map((r) => ({ id: r.id, cells: Object.fromEntries(KEYS.map((k) => [k, r.cont[k] ? '(위와 같음)' : r.c[k]])) })) },
        findings: state.result.findings.filter((f) => ids.has(f.rowId)).map((f) => ({ rowId: f.rowId, key: f.key, level: f.level, title: f.title, msg: f.msg })),
        context: { fx: S.fx || {}, totalSec: S.totalSec || 0 },
      };
      const res = await fetch('/api/ai-review', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json().catch(() => ({}));
      if (res.status === 501) {
        status.innerHTML = `<div class="fb-loc">${esc(data.error || 'AI 기능이 아직 설정되지 않았습니다.')}</div>`;
        return;
      }
      if (!res.ok) {
        if (res.status >= 500 || res.status === 422 || res.status === 429) {
          status.insertAdjacentHTML('beforeend', `<div class="fb-loc">${esc(label)}: ${esc(data.error || `건너뜀 (${res.status})`)}</div>`);
          continue;
        }
        throw new Error(data.error || `AI 요청 실패 (${res.status})`);
      }
      for (const s of data.suggestions || []) {
        if (!ids.has(s.rowId) || !KEYS.includes(s.key)) continue;
        const row = b.rows.find((r) => r.id === s.rowId);
        state.ai.push({ ...s, block: label, old: row ? row.c[s.key] : '' });
      }
      renderAI();
    }
    if (!state.ai.length) status.innerHTML = '<div class="fb-loc">AI가 추가로 제안할 내용이 없습니다.</div>';
    else toast(`AI 제안 ${state.ai.length}개를 받았습니다. 적용할 것만 골라주세요.`);
  } catch (e) {
    console.error(e);
    status.insertAdjacentHTML('afterbegin', `<div class="fb-loc">${esc(e.message)}</div>`);
  } finally {
    btn.disabled = false;
  }
}

// ---------------- 모범 예시 ----------------
let exampleRendered = false;
function renderExample() {
  if (exampleRendered) return;
  const res = analyze(parseGrid(clone(SAMPLE_MODEL)), {});
  const saved = state.originalMap;
  state.originalMap = new Map(res.revised.rows.map((r) => [r.id, r]));
  $('#example-grid').innerHTML = sheetTable(res.revised, { mode: 'original', findings: [] });
  state.originalMap = saved;
  exampleRendered = true;
}

// ---------------- 시작 ----------------
function init() {
  initInputs();
  initTooltip();
  initEditing();
  $$('.seg-btn').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#toggle-diff').addEventListener('change', (e) => {
    state.showDiff = e.target.checked;
    renderGrid();
  });
  $('#toggle-edit').addEventListener('change', (e) => setEditMode(e.target.checked));
  $('#btn-add-row').addEventListener('click', addRow);
  $('#btn-del-row').addEventListener('click', delRow);
  $('#btn-undo').addEventListener('click', undoAll);
  $('#btn-xlsx-review').addEventListener('click', () => exportFile('review'));
  $('#btn-xlsx-submit').addEventListener('click', () => exportFile('submit'));
  $('#btn-copy-sheet').addEventListener('click', copySheet);
  $('#btn-copy-report').addEventListener('click', () => copyText(reportText(), '피드백 메시지를 복사했습니다. 카톡에 붙여넣으세요.'));
  $('#btn-ai').addEventListener('click', runAI);
  nav(location.hash.replace('#', '') || 'check');
}
init();

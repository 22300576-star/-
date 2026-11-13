// HANFLIX 큐시트 체크 — 페이지별 화면(해시 라우팅)
import { parseGrid, buildBlocks } from './engine/parser.js';
import { classifyItem } from './engine/classify.js';
import { analyze } from './engine/analyze.js';
import { KEYS, LEVELS, colName } from './engine/constants.js';
import { fmtDurationKo } from './engine/time.js';
import { readWorkbook, looksLikeCueSheet, gridFromHtml, gridFromTsv } from './io/importers.js';
import { exportXlsx, safeSheetName } from './io/export-xlsx.js';
import { toHtmlTable, toTsv } from './io/export-html.js';
import { SAMPLE_MODEL } from './samples.js';
import { icon, wordmark } from './ui/icons.js';
import { sheetHtml, esc } from './ui/sheetview.js';
import { guideIndexHtml, guidePageHtml } from './ui/guide.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clone = (o) => JSON.parse(JSON.stringify(o));
const app = $('#app');

// ---------------- 항목(페이지) 정의 ----------------
const PAGES = [
  { id: 'time', name: 'Run Time', icon: 'clock', rule: '<b>00:00 ~ 00:04 (4초)</b> · 앞 행 끝 = 다음 행 시작 · 무대 <b>11분</b> 이내' },
  { id: 'stage', name: '무대 · 인원', icon: 'users', rule: '무대·단상 위 인원과 <b>무대 아래 대기 인원</b>을 숫자로' },
  { id: 'detail', name: '세부 내용', icon: 'route', rule: '<b>언제 · 어디서 · 누가(몇 명) · 무엇을 · 어떻게</b>' },
  { id: 'lyrics', name: '개사', icon: 'mic', rule: 'Run Time에 맞춰 <b>슬라이드 단위</b>로 · 가사 없으면 간주 / X' },
  { id: 'sound', name: '음향 · FD', icon: 'sliders', rule: '<b>장비·개수 · 누가 · 언제</b> · 무대 사이 마이크 이동' },
  { id: 'screen', name: '화면', icon: 'monitor', rule: '화면에 띄울 <b>영상 / PPT</b>' },
  { id: 'light', name: '조명', icon: 'bulb', rule: '무대·상단 <b>구역 / 색상 / 밝기%</b> · 핀은 <b>ON / X</b> · FX는 2개' },
  { id: 'form', name: '양식', icon: 'clipboard', rule: '<b>양식 유지</b> · 빈칸 없이 X / 유지 · 공통 항목 셀 병합' },
];
const PAGE = Object.fromEntries(PAGES.map((p) => [p.id, p]));
const KEY_PAGE = { runtime: 'time', stage: 'stage', waiting: 'stage', detail: 'detail', lyrics: 'lyrics', sound: 'sound', screen: 'screen', lStage: 'light', lTop: 'light', pin1: 'light', pin2: 'light', pin3: 'light', pin4: 'light', details: 'light', item: 'form', note: 'form' };
const CAT_PAGE = { time: 'time', stage: 'stage', detail: 'detail', lyrics: 'lyrics', sound: 'sound', screen: 'screen', light: 'light', fx: 'light', form: 'form' };
const pageOf = (f) => (f.cat === 'pending' ? KEY_PAGE[f.key] || 'form' : CAT_PAGE[f.cat] || 'form');
const FX_OPTIONS = ['', '스트로브', '고보(무늬 투사)', '무빙(좌우 교차·원 그리기)', '추가 핀(Pin1~4 외 위치)', '조합 연출(여러 효과를 하나로)'];

// ---------------- 상태 ----------------
const state = {
  name: '',
  original: null,
  originalMap: new Map(),
  base: null,
  disabled: new Set(),
  fx: { FX1: '', FX2: '' },
  result: null,
  editMode: false,
  firstBase: null,
  firstDisabled: [],
  showDiff: true,
  sheetView: 'revised',
  selectedRow: null,
  open: new Set(), // 펼친 피드백 카드
  openSecs: new Set(), // 펼친 항목(Run Time, 조명 …)
  showAll: new Set(), // '더 보기'를 누른 항목
  scrollTo: null,
  fbText: null,
  ai: { enabled: false, items: [], running: false },
  sheets: null,
};
const STORE = 'hanflix-cuesheet-v1';

function save() {
  try {
    if (!state.original) return sessionStorage.removeItem(STORE);
    sessionStorage.setItem(
      STORE,
      JSON.stringify({ name: state.name, original: state.original, base: state.base, disabled: [...state.disabled], fx: state.fx, editMode: state.editMode, firstBase: state.firstBase, firstDisabled: state.firstDisabled }),
    );
  } catch {
    /* 저장 공간이 없어도 동작에는 문제 없음 */
  }
}
function restore() {
  try {
    const d = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (!d || !d.original) return;
    Object.assign(state, { name: d.name, original: d.original, base: d.base, disabled: new Set(d.disabled || []), fx: d.fx || { FX1: '', FX2: '' }, editMode: !!d.editMode, firstBase: d.firstBase || null, firstDisabled: d.firstDisabled || [] });
    state.originalMap = new Map(state.original.rows.map((r) => [r.id, r]));
    state.result = analyze(state.base, { disabled: state.disabled, fx: state.fx });
  } catch {
    /* 무시 */
  }
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), ms);
}

function run(rerender = true) {
  state.result = analyze(state.base, { disabled: state.disabled, fx: state.fx });
  save();
  if (rerender) render();
}

// ---------------- 불러오기 ----------------
function annotateKinds(model) {
  for (const b of buildBlocks(model.rows)) {
    const kind = classifyItem(b.item, b.rows);
    b.rows.forEach((r) => (r.kind = kind));
  }
}

// 불러오면 결과 한 화면으로 (항목은 모두 접힌 채)
function loadGrid(grid, name) {
  const model = parseGrid(grid);
  if (!model.rows.length) throw new Error('큐시트 내용 행을 찾지 못했습니다. 머리글(항목, Run Time …)부터 복사해주세요.');
  annotateKinds(model);
  Object.assign(state, {
    name: (name || grid.name || '큐시트').replace(/\.xlsx$/i, ''),
    original: model,
    originalMap: new Map(model.rows.map((r) => [r.id, r])),
    base: clone(model),
    disabled: new Set(),
    fx: { FX1: '', FX2: '' },
    editMode: false,
    firstBase: null,
    firstDisabled: [],
    open: new Set(),
    selectedRow: null,
    sheetView: 'revised',
    openSecs: new Set(),
    showAll: new Set(),
    fbText: null,
  });
  state.ai.items = [];
  run(false);
  location.hash = '#/result';
  render();
}

function ensureExcel() {
  if (!window.ExcelJS) throw new Error('엑셀 모듈을 불러오는 중입니다. 잠시 후 다시 눌러주세요.');
  return window.ExcelJS;
}

function setStatus(msg, err = false) {
  const s = $('#status');
  if (!s) return;
  s.textContent = msg || '';
  s.classList.toggle('err', !!err);
}

function sheetIdFromUrl(url) {
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  const g = String(url).match(/[#&?]gid=(\d+)/);
  return m ? { id: m[1], gid: g ? g[1] : null } : null;
}

function matchGid(sheets, tsv) {
  if (!tsv) return -1;
  const sample = gridFromTsv(tsv)
    .cells.flat()
    .map((s) => s.replace(/\s+/g, ''))
    .filter((s) => s.length > 3)
    .slice(0, 40);
  let best = -1;
  let score = 0;
  sheets.forEach((sh, i) => {
    const txt = sh.cells.flat().join('').replace(/\s+/g, '');
    const n = sample.filter((s) => txt.includes(s)).length;
    if (n > score) {
      best = i;
      score = n;
    }
  });
  return score >= Math.min(5, sample.length) ? best : -1;
}

async function loadFromLink() {
  const input = $('#sheet-url');
  const parsed = sheetIdFromUrl(input.value.trim());
  if (!parsed) return setStatus('구글 시트 주소를 확인해주세요.', true);
  const btn = $('#btn-link');
  btn.disabled = true;
  setStatus('불러오는 중…');
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
    if (sheets && sheets.length) {
      const gidIdx = matchGid(sheets, tsv);
      const cue = sheets.map((s, i) => ({ s, i, score: looksLikeCueSheet(s) })).filter((x) => x.score >= 5);
      if (gidIdx >= 0) return loadGrid(sheets[gidIdx], sheets[gidIdx].name);
      if (sheets.length === 1 || cue.length === 1) {
        const s = sheets.length === 1 ? sheets[0] : cue[0].s;
        return loadGrid(s, s.name);
      }
      state.sheets = sheets;
      const pick = $('#picker');
      $('#picker-select').innerHTML = sheets.map((s, i) => `<option value="${i}">${esc(s.name)}${looksLikeCueSheet(s) >= 5 ? '' : ' (큐시트 아님?)'}</option>`).join('');
      if (cue.length) $('#picker-select').value = String(cue[0].i);
      pick.hidden = false;
      setStatus(`탭 ${sheets.length}개 — 점검할 학부 탭을 고르세요.`);
      return;
    }
    if (tsv) {
      loadGrid({ ...gridFromTsv(tsv), name: '구글 시트' }, '구글 시트');
      toast('셀 병합 없이 탭 내용만 불러왔습니다.');
      return;
    }
    throw err || new Error('시트를 불러오지 못했습니다.');
  } catch (e) {
    console.error(e);
    setStatus(e.message, true);
    togglePaste(true); // 링크가 안 되면 붙여넣기 칸을 바로 열어 줌
  } finally {
    btn.disabled = false;
  }
}

function togglePaste(open) {
  const box = $('#paste-box');
  if (!box) return;
  const show = open ?? box.hidden;
  box.hidden = !show;
  $('#btn-paste').setAttribute('aria-expanded', String(show));
  if (show) $('#paste').focus({ preventScroll: true });
}

function onPaste(e) {
  e.preventDefault();
  const html = e.clipboardData.getData('text/html');
  const text = e.clipboardData.getData('text/plain');
  let grid = null;
  if (html && /<table/i.test(html)) grid = gridFromHtml(html);
  if (!grid && text) grid = gridFromTsv(text);
  if (!grid || !grid.cells.length) return setStatus('붙여넣은 내용에서 표를 찾지 못했습니다.', true);
  try {
    loadGrid(grid, '붙여넣은 큐시트');
  } catch (err) {
    setStatus(err.message, true);
  }
}

// ---------------- 직접 수정 ----------------
function stripForBase(S) {
  return { name: S.name, layout: '2026', mergeInfo: true, feedbackNote: S.feedbackNote || '', extraKeys: [], warnings: [], rows: S.rows.map((r) => ({ id: r.id, src: r.src, kind: r.kind, c: { ...r.c }, cont: { ...r.cont }, extra: {} })) };
}
function commitIfNeeded() {
  if (state.editMode) return;
  state.firstBase = clone(state.base);
  state.firstDisabled = [...state.disabled];
  state.base = stripForBase(state.result.revised);
  state.disabled = new Set();
  state.editMode = true;
}
function saveCell(rowId, key, value, { quiet = false } = {}) {
  commitIfNeeded();
  const row = state.base.rows.find((r) => r.id === rowId);
  if (!row) return toast('해당 행을 찾지 못했습니다.');
  const v = String(value).replace(/\r/g, '').replace(/\n+$/, '').trim();
  if ((row.cont[key] ? '' : row.c[key] || '') === v) return;
  row.c[key] = v;
  row.cont[key] = false;
  run();
  if (!quiet) toast('수정본에 반영하고 다시 점검했습니다.');
}
function undoAll() {
  if (!state.firstBase) return;
  state.base = state.firstBase;
  state.disabled = new Set(state.firstDisabled);
  state.firstBase = null;
  state.editMode = false;
  run();
  toast('직접 고치기 전 결과로 되돌렸습니다.');
}

// ---------------- 공통 조각 ----------------
function rowNo(S, id) {
  return S.rows.findIndex((r) => r.id === id) + 5;
}
function locText(f) {
  const S = state.result.revised;
  if (!f.rowId) return '큐시트 전체';
  const row = S.rows.find((r) => r.id === f.rowId);
  if (!row) return '';
  const b = S.blocks[row.blockIndex];
  const label = ((b && b.item) || '').split('\n')[0];
  return `${rowNo(S, row.id)}행${label ? ` · ${label}` : ''}${f.key ? ` · ${colName(f.key)}` : ''}`;
}
const firstSentence = (s) => (String(s).match(/^.*?[.!?다요](?=\s|$)/) || [s])[0];

function pageStats(id) {
  const fs = state.result.findings.filter((f) => pageOf(f) === id);
  return {
    fs,
    error: fs.filter((f) => f.level === 'error').length,
    warn: fs.filter((f) => f.level === 'warn').length,
    auto: fs.filter((f) => f.fixId && f.fixEnabled).length,
    pending: fs.filter((f) => f.cat === 'pending').length,
  };
}

// Run Time 항목 안: 무대 시간 막대 (11분 기준선)
function timeCardHtml() {
  const { summary, timeline } = state.result;
  const blocks = [];
  for (const t of timeline) {
    const last = blocks[blocks.length - 1];
    if (last && last.block === t.block) last.end = t.end;
    else blocks.push({ ...t });
  }
  const total = Math.max(660, ...blocks.map((b) => b.end), 1);
  const over = summary.totalSec > 660;
  const lim = (660 / total) * 100;
  const segs = blocks.map((b) => `<i class="${b.kind}" style="left:${(b.start / total) * 100}%;width:${((b.end - b.start) / total) * 100}%" title="${esc(b.label)}"></i>`).join('');
  return `<div class="timecard">
    <div class="tc-head"><b>무대 시간</b><span class="${over ? 'over' : ''}">${summary.totalText} / 11분${over ? ` · ${fmtDurationKo(summary.totalSec - 660)} 초과` : ''}</span></div>
    <div class="timebar"><div class="bar-wrap"><div class="track">${segs}</div><span class="limit" style="left:${lim}%"></span></div><div class="labels"><span>00:00</span><span class="lim ${over ? '' : 'end'}" style="left:${lim}%">11분</span></div></div>
  </div>`;
}

function needResult() {
  if (state.result) return false;
  app.innerHTML = `<section class="page"><div class="empty-ok"><b style="color:#fff">먼저 큐시트를 불러와주세요</b><a class="btn primary" href="#/" style="margin-top:12px">${icon('link', 18)} 큐시트 불러오기</a></div></section>`;
  return true;
}

// ---------------- 페이지: 홈 ----------------
// 구글 시트 링크 하나로 시작. 붙여넣기는 링크가 안 될 때만 쓰는 보조 방법.
function pageHome() {
  app.innerHTML = `<section class="page">
    <div class="hero">
      ${wordmark('wm hero-wm')}
      <h1>큐시트, 넣기만 하세요.</h1>
      <p>피드백부터 2차 큐시트 양식 수정본까지 바로 돌려드립니다.</p>
      <div class="start">
        <div class="field"><input id="sheet-url" type="url" placeholder="구글 시트 주소를 붙여넣으세요" autocomplete="off"><button class="btn primary big" id="btn-link">시작하기</button></div>
        <p class="hint">공유: '링크가 있는 모든 사용자 · 뷰어' · 학부 탭 주소(#gid=…)면 바로 그 탭을 엽니다</p>
        <div class="picker" id="picker" hidden><select id="picker-select"></select><button class="btn primary" id="btn-pick">이 탭 점검</button></div>
        <div class="status" id="status" role="status"></div>
        <button class="text-link" id="btn-paste" type="button" aria-expanded="false" aria-controls="paste-box">링크가 안 되면? <u>표를 복사해서 붙여넣기</u></button>
        <div class="paste-box" id="paste-box" hidden>
          <div class="paste" id="paste" contenteditable="true" spellcheck="false" aria-label="여기에 붙여넣기"></div>
          <p class="hint">구글 시트에서 '항목' 머리글부터 마지막 행까지 복사</p>
        </div>
      </div>
    </div>
  </section>`;
  $('#btn-link').addEventListener('click', loadFromLink);
  $('#sheet-url').addEventListener('keydown', (e) => e.key === 'Enter' && loadFromLink());
  $('#btn-paste').addEventListener('click', () => togglePaste());
  $('#paste').addEventListener('paste', onPaste);
  $('#btn-pick').addEventListener('click', () => {
    const s = state.sheets[Number($('#picker-select').value)];
    loadGrid(s, s.name);
  });
}

// ---------------- 페이지: 결과 (한 화면) ----------------
// 맨 위: 학부 이름 · 남은 개수 · 무대 시간 · 내려받기 버튼
// 그 아래: 항목 8개를 접힌 목록으로 — 눌러서 펼치면 피드백(근거·대안), 바로 고치기, 자동 수정 끄기
function issueHtml(f) {
  const open = state.open.has(f.id);
  const cls = f.cat === 'pending' ? 'pending' : f.level;
  const editable = f.rowId && f.key && !(f.rows && f.rows.length > 1);
  const row = editable ? state.result.revised.rows.find((r) => r.id === f.rowId) : null;
  let editor = '';
  if (row && !row.cont[f.key]) {
    editor = `<div class="editor"><label>${esc(colName(f.key))} 고치기</label><textarea data-edit-row="${esc(row.id)}" data-edit-key="${f.key}">${esc(row.c[f.key] || '')}</textarea><div class="acts"><button class="btn primary small" data-save>${icon('check', 16)} 반영</button><a class="btn small" href="#/sheet" data-jump="${esc(row.id)}|${f.key}">표에서 보기</a></div></div>`;
  }
  const how = f.suggestion ? `→ ${f.suggestion}` : firstSentence(f.msg);
  return `<div class="issue ${cls} ${open ? 'open' : ''}" data-id="${esc(f.id)}">
    <div class="issue-top"><div class="t"><b>${esc(f.title)}</b><div class="loc">${esc(locText(f))}</div><div class="how">${esc(how)}</div></div>${icon('chevron', 20).replace('class="ic"', 'class="ic chev"')}</div>
    <div class="issue-body"><p>${esc(f.msg)}</p>${f.why ? `<div class="why">근거 · ${esc(f.why)}</div>` : ''}${editor}</div>
  </div>`;
}

const fixHtml = (f) =>
  `<div class="fix"><div class="t">${esc(f.title)}<small>${esc(firstSentence(f.msg))}</small></div><label class="switch"><input type="checkbox" data-fix="${esc(f.fixId)}" ${f.fixEnabled ? 'checked' : ''} ${state.editMode ? 'disabled' : ''}><span>${f.fixEnabled ? '반영' : '끔'}</span></label></div>`;
const noteHtml = (f) => `<div class="fix"><div class="t">${esc(f.title)}<small>${esc(firstSentence(f.msg))}</small></div></div>`;
const fxHtml = () =>
  `<div class="fix fx"><div class="t"><b>FX 지정</b><small>학부가 쓰는 효과 2개를 고르면 Details에 함께 적습니다</small></div><div class="fx-sel">${['FX1', 'FX2']
    .map((k) => `<select data-fx="${k}" class="btn small">${FX_OPTIONS.map((o) => `<option value="${esc(o)}" ${state.fx[k] === o ? 'selected' : ''}>${o ? `${k}: ${o}` : `${k} 지정 안 함`}</option>`).join('')}</select>`)
    .join('')}</div></div>`;

function sectionHtml(p) {
  const s = pageStats(p.id);
  const open = state.openSecs.has(p.id);
  const status = s.error ? 'error' : s.warn ? 'warn' : 'ok';
  const chips = status === 'ok' ? '<span class="pill ok">통과</span>' : `${s.error ? `<span class="pill error">필수 ${s.error}</span>` : ''}${s.warn ? `<span class="pill warn">권장 ${s.warn}</span>` : ''}`;
  let body = '';
  if (open) {
    const todo = s.fs.filter((f) => f.level === 'error' || f.level === 'warn').sort((a, b) => LEVELS[a.level].order - LEVELS[b.level].order);
    const autos = s.fs.filter((f) => f.fixId);
    // 총 무대 시간 안내는 Run Time의 무대 시간 막대가 대신 보여줌
    const notes = s.fs.filter((f) => f.level === 'info' && !f.fixId && f.id !== 'time:total');
    const all = state.showAll.has(p.id);
    body = `<div class="sec-body">
      <div class="rule">${p.rule}</div>
      ${p.id === 'time' ? timeCardHtml() : ''}
      ${todo.length ? `<div class="issues">${todo.slice(0, all ? todo.length : 6).map(issueHtml).join('')}</div>${todo.length > 6 && !all ? `<button class="btn ghost small more" data-more="${p.id}">나머지 ${todo.length - 6}개 더 보기</button>` : ''}` : '<div class="sec-ok">고칠 것이 없습니다.</div>'}
      ${p.id === 'light' ? `<h3 class="sub-title">FX</h3>${fxHtml()}` : ''}
      ${autos.length ? `<h3 class="sub-title">자동으로 고친 것 <small>${state.editMode ? '직접 고친 뒤에는 처음 결과로 되돌려야 끌 수 있습니다' : '끄면 원래 내용으로 돌아갑니다'}</small></h3><div class="fixes">${autos.map(fixHtml).join('')}</div>` : ''}
      ${notes.length ? `<h3 class="sub-title">참고</h3><div class="fixes">${notes.map(noteHtml).join('')}</div>` : ''}
    </div>`;
  }
  return `<section class="sec ${status}${open ? ' open' : ''}" data-sec="${p.id}">
    <button class="sec-head" type="button" aria-expanded="${open}">${icon(p.icon, 22)}<b>${p.name}</b><span class="chips">${chips}</span>${icon('chevron', 20).replace('class="ic"', 'class="ic chev"')}</button>
    ${body}
  </section>`;
}

function redrawSec(id) {
  const el = $(`.sec[data-sec="${id}"]`, app);
  if (!el) return;
  const tmp = document.createElement('div');
  tmp.innerHTML = sectionHtml(PAGE[id]);
  el.replaceWith(tmp.firstElementChild);
}

function pageResult() {
  if (needResult()) return;
  const { summary } = state.result;
  const c = summary.counts;
  const ok = !c.error && !c.warn;
  const over = summary.totalSec > 660;
  app.innerHTML = `<section class="page result">
    <div class="card res-head">
      <div class="res-info">
        <h1>${esc(state.name)}</h1>
        <div class="chips">
          ${ok ? '<span class="pill ok">제출 가능</span>' : ''}${c.error ? `<span class="pill error">필수 ${c.error}</span>` : ''}${c.warn ? `<span class="pill warn">권장 ${c.warn}</span>` : ''}${summary.pendingCount ? `<span class="pill pending">논의 중 ${summary.pendingCount}</span>` : ''}
          <span class="pill ${over ? 'error' : ''}">무대 시간 ${summary.totalText}${over ? ` · ${fmtDurationKo(summary.totalSec - 660)} 초과` : ' / 11분'}</span>
          ${summary.autoCells ? `<span class="pill info">자동 수정 ${summary.autoCells}칸</span>` : ''}
        </div>
      </div>
      <div class="res-actions">
        <button class="btn primary" id="d-submit">${icon('download', 18)} 수정본 엑셀</button>
        <button class="btn" id="d-review">${icon('list', 18)} 검토용 엑셀</button>
        <button class="btn" id="d-copy">${icon('copy', 18)} 구글 시트에 붙여넣기</button>
        <button class="btn" id="d-msg">${icon('chat', 18)} 피드백 메시지 복사</button>
        ${state.ai.enabled ? `<a class="btn ghost" href="#/ai">${icon('sparkle', 18)} AI 대안</a>` : ''}
      </div>
    </div>
    <div class="sections">${PAGES.map(sectionHtml).join('')}</div>
    <div class="res-foot"><a class="btn" href="#/sheet">${icon('grid', 18)} 전체 표에서 직접 고치기 ${icon('right', 18)}</a>${state.firstBase ? '<button class="btn ghost" id="b-undo">처음 결과로 되돌리기</button>' : ''}</div>
    <details class="more"><summary>큐시트 1행 TFT 피드백 문구 고치기</summary><textarea id="fb-text">${esc(state.fbText ?? summary.feedbackText)}</textarea></details>
  </section>`;
  $('#d-submit').addEventListener('click', () => exportFile('submit'));
  $('#d-review').addEventListener('click', () => exportFile('review'));
  $('#d-copy').addEventListener('click', copySheet);
  $('#d-msg').addEventListener('click', () => copyText(reportText(), '피드백 메시지를 복사했습니다.'));
  $('#fb-text').addEventListener('input', (e) => (state.fbText = e.target.value));
  if ($('#b-undo')) $('#b-undo').addEventListener('click', undoAll);
  const root = $('.sections', app);
  root.addEventListener('click', (e) => {
    const head = e.target.closest('.sec-head');
    if (head) {
      const id = head.closest('.sec').dataset.sec;
      if (state.openSecs.has(id)) state.openSecs.delete(id);
      else state.openSecs.add(id);
      return redrawSec(id);
    }
    const top = e.target.closest('.issue-top');
    if (top) {
      const card = top.closest('.issue');
      const fid = card.dataset.id;
      if (state.open.has(fid)) state.open.delete(fid);
      else state.open.add(fid);
      return card.classList.toggle('open');
    }
    const save = e.target.closest('[data-save]');
    if (save) {
      const ta = save.closest('.editor').querySelector('textarea');
      return saveCell(ta.dataset.editRow, ta.dataset.editKey, ta.value);
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      state.showAll.add(more.dataset.more);
      return redrawSec(more.dataset.more);
    }
    const jump = e.target.closest('[data-jump]');
    if (jump) state.jump = jump.dataset.jump;
  });
  root.addEventListener('change', (e) => {
    const cb = e.target.closest('[data-fix]');
    if (cb) {
      if (cb.checked) state.disabled.delete(cb.dataset.fix);
      else state.disabled.add(cb.dataset.fix);
      return run();
    }
    const sel = e.target.closest('[data-fx]');
    if (sel) {
      state.fx[sel.dataset.fx] = sel.value;
      run();
    }
  });
}

// ---------------- 페이지: 전체 표 ----------------
function pageSheet() {
  if (needResult()) return;
  const isOrig = state.sheetView === 'original';
  const S = isOrig ? state.original : state.result.revised;
  app.innerHTML = `<section class="page">
    <a class="back" href="#/result">${icon('left', 18)} 결과</a>
    <h1 class="page-title">전체 표</h1>
    <p class="page-sub">${esc(state.name)} · 2차 큐시트 모양 그대로 · 칸을 눌러 바로 고칠 수 있습니다</p>
    <div class="sheet-tools">
      <div class="seg"><button data-v="revised" class="${isOrig ? '' : 'active'}">수정본</button><button data-v="original" class="${isOrig ? 'active' : ''}">원본</button></div>
      <label class="switch"><input type="checkbox" id="t-diff" ${state.showDiff ? 'checked' : ''}><span>바뀐 칸 표시</span></label>
      <span class="gap"></span>
      ${isOrig ? '' : `<button class="btn small" id="b-add">${icon('pencil', 16)} 아래에 행 추가</button><button class="btn small" id="b-del">행 삭제</button>`}
      ${state.firstBase ? `<button class="btn small" id="b-undo">처음 결과로</button>` : ''}
    </div>
    <div class="sheet-card"><div class="grid-wrap" id="grid">${sheetHtml(S, { editable: !isOrig, findings: isOrig ? [] : state.result.findings, originalMap: isOrig ? null : state.originalMap, showDiff: state.showDiff && !isOrig, selected: state.selectedRow })}</div></div>
    <div class="legend"><span><i class="sw changed"></i>자동 수정</span><span><i class="sw ph"></i>직접 작성</span><span><i class="sw pd"></i>논의 중</span><span><i class="dot error"></i>필수</span><span><i class="dot warn"></i>권장</span><span>행 번호를 누르면 행 선택</span></div>
  </section>`;
  $$('.seg button', app).forEach((b) =>
    b.addEventListener('click', () => {
      state.sheetView = b.dataset.v;
      pageSheet();
    }),
  );
  $('#t-diff').addEventListener('change', (e) => {
    state.showDiff = e.target.checked;
    pageSheet();
  });
  if ($('#b-add')) $('#b-add').addEventListener('click', addRow);
  if ($('#b-del')) $('#b-del').addEventListener('click', delRow);
  if ($('#b-undo')) $('#b-undo').addEventListener('click', undoAll);
  if (state.jump) {
    const [rid, key] = state.jump.split('|');
    state.jump = null;
    setTimeout(() => {
      const td = $(`td[data-row="${CSS.escape(rid)}"][data-key="${key}"]`, app);
      if (td) {
        td.scrollIntoView({ block: 'center', inline: 'center' });
        td.classList.add('flash');
      }
    }, 50);
  }
}

function addRow() {
  commitIfNeeded();
  const rows = state.base.rows;
  const idx = rows.findIndex((r) => r.id === state.selectedRow);
  const at = idx < 0 ? rows.length - 1 : idx;
  const nr = { id: `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, src: null, c: Object.fromEntries(KEYS.map((k) => [k, ''])), cont: Object.fromEntries(KEYS.map((k) => [k, false])), extra: {} };
  rows.splice(at + 1, 0, nr);
  state.selectedRow = nr.id;
  run();
}
function delRow() {
  const idx = state.base.rows.findIndex((r) => r.id === state.selectedRow);
  if (idx < 0) return toast('지울 행의 왼쪽 번호를 먼저 눌러주세요.');
  commitIfNeeded();
  const rows = state.base.rows;
  const i = rows.findIndex((r) => r.id === state.selectedRow);
  const r = rows[i];
  const next = rows[i + 1];
  if (r.c.item && next && !next.c.item) {
    for (const k of ['item', 'stage', 'waiting', 'sound', 'screen']) {
      if (next.cont[k]) {
        next.c[k] = r.c[k];
        next.cont[k] = false;
      }
    }
  }
  rows.splice(i, 1);
  state.selectedRow = null;
  run();
}

// ---------------- 페이지: 내려받기 ----------------
function reportText() {
  const { summary, findings } = state.result;
  const L = [`[2026 학부합창대회 큐시트 피드백] ${state.name}`, `필수 수정 ${summary.counts.error} · 권장 ${summary.counts.warn} · 무대 시간 ${summary.totalText}/11분`];
  for (const p of PAGES) {
    const items = findings.filter((f) => pageOf(f) === p.id && (f.level === 'error' || f.level === 'warn'));
    if (!items.length) continue;
    L.push('', `■ ${p.name}`);
    items.forEach((f) => L.push(`- ${f.level === 'error' ? '[필수] ' : ''}${f.title}${f.rowId ? ` (${locText(f)})` : ''}${f.suggestion ? `\n  → ${f.suggestion}` : ''}`));
  }
  L.push('', '수정본 엑셀을 함께 보냅니다. 붉은 칸(작성 필요)과 보라 칸(논의 중)을 채워 다시 제출해주세요.');
  return L.join('\n');
}

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
      feedbackText: state.fbText ?? state.result.summary.feedbackText,
      findings: state.result.findings,
      title: safeSheetName(state.name),
    });
    const base = state.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || '큐시트';
    download(buf, `${base}_2026큐시트_${mode === 'review' ? '검토용' : '수정본'}.xlsx`);
    toast('엑셀을 내려받았습니다.');
  } catch (e) {
    console.error(e);
    toast(`엑셀을 만들지 못했습니다: ${e.message}`);
  }
}
async function copySheet() {
  const S = state.result.revised;
  const html = toHtmlTable(S, { includeHeader: true });
  const text = toTsv(S);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
  } catch {
    const div = document.createElement('div');
    div.innerHTML = html;
    Object.assign(div.style, { position: 'fixed', left: '-9999px' });
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
  toast('복사했습니다. 새 구글 시트의 A1 칸에 붙여넣으세요.', 3600);
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

// ---------------- 페이지: 가이드 / 모범 예시 ----------------
function pageGuide(id) {
  if (!id) {
    app.innerHTML = guideIndexHtml();
    return;
  }
  const html = guidePageHtml(id);
  if (!html) return (location.hash = '#/guide');
  app.innerHTML = html;
}

let exampleCache = null;
function pageExample() {
  if (!exampleCache) exampleCache = analyze(parseGrid(clone(SAMPLE_MODEL)), {}).revised;
  app.innerHTML = `<section class="page">
    <a class="back" href="#/guide">${icon('left', 18)} 가이드</a>
    <h1 class="page-title">모범 예시</h1>
    <p class="page-sub">가장 잘 쓴 2차 큐시트(공시)의 방식을 따른 가상 학부입니다</p>
    <div class="chips" style="margin-bottom:16px">
      <span class="pill info">Run Time 이어짐</span><span class="pill info">바뀌는 곳마다 행 분리</span><span class="pill info">인원 숫자</span><span class="pill info">조명 구역/색상/밝기%</span><span class="pill info">핀 ON/X</span><span class="pill info">FD 지시</span>
    </div>
    <div class="sheet-card"><div class="grid-wrap" style="max-height:none">${sheetHtml(exampleCache, {})}</div></div>
  </section>`;
}

// ---------------- 페이지: AI 대안 (선택) ----------------
function pageAI() {
  if (needResult()) return;
  const items = state.ai.items;
  app.innerHTML = `<section class="page">
    <a class="back" href="#/result">${icon('left', 18)} 결과</a>
    <h1 class="page-title">AI 대안 <span class="pill info">베타</span></h1>
    <p class="page-sub">무대마다 문장·조명 대안을 받아 골라서 반영합니다. 큐시트 내용이 Anthropic Claude API로 전송됩니다.</p>
    <button class="btn primary" id="b-ai" ${state.ai.running ? 'disabled' : ''}>${icon('sparkle', 18)} ${state.ai.running ? '받는 중…' : items.length ? '다시 받기' : '대안 받기'}</button>
    <div class="status" id="ai-status"></div>
    <div class="issues" style="margin-top:14px">${items
      .map(
        (s, i) => `<div class="issue info open"><div class="issue-top"><div class="t"><b>${esc(s.block)} · ${esc(colName(s.key))}</b><div class="how">${esc(s.reason || '')}</div></div></div>
        <div class="issue-body">${s.old ? `<p class="muted" style="text-decoration:line-through">${esc(s.old)}</p>` : ''}<div class="example">${esc(s.text)}</div>
        <div class="acts" style="margin-top:10px;display:flex;gap:8px">${s.applied ? '<span class="pill ok">반영함</span>' : `<button class="btn primary small" data-apply="${i}">반영</button><button class="btn small" data-skip="${i}">무시</button>`}</div></div></div>`,
      )
      .join('')}</div>
  </section>`;
  $('#b-ai').addEventListener('click', runAI);
  $$('[data-apply]', app).forEach((b) =>
    b.addEventListener('click', () => {
      const s = items[Number(b.dataset.apply)];
      s.applied = true;
      saveCell(s.rowId, s.key, s.text);
    }),
  );
  $$('[data-skip]', app).forEach((b) =>
    b.addEventListener('click', () => {
      items.splice(Number(b.dataset.skip), 1);
      pageAI();
    }),
  );
}

async function runAI() {
  const S = state.result.revised;
  const blocks = S.blocks.filter((b) => b.kind === 'stage' || b.kind === 'video');
  state.ai.running = true;
  state.ai.items = [];
  pageAI();
  const st = () => $('#ai-status');
  try {
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      const label = (b.item || '').split('\n')[0];
      if (st()) st().textContent = `${i + 1}/${blocks.length} · ${label} 검토 중…`;
      const ids = new Set(b.rows.map((r) => r.id));
      const res = await fetch('/api/ai-review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          block: { label, kind: b.kind, rows: b.rows.map((r) => ({ id: r.id, cells: Object.fromEntries(KEYS.map((k) => [k, r.cont[k] ? '(위와 같음)' : r.c[k]])) })) },
          findings: state.result.findings.filter((f) => ids.has(f.rowId)).map((f) => ({ rowId: f.rowId, key: f.key, level: f.level, title: f.title, msg: f.msg })),
          context: { fx: S.fx || {}, totalSec: S.totalSec || 0 },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 501) throw new Error(data.error || 'AI 기능이 설정되지 않았습니다.');
        continue;
      }
      for (const s of data.suggestions || []) {
        if (!ids.has(s.rowId)) continue;
        const row = b.rows.find((r) => r.id === s.rowId);
        state.ai.items.push({ ...s, block: label, old: row ? row.c[s.key] : '' });
      }
    }
  } catch (e) {
    toast(e.message, 4000);
  } finally {
    state.ai.running = false;
    if (location.hash === '#/ai') pageAI();
  }
}

// ---------------- 라우터 ----------------
function renderNav(route) {
  $('#nav-result').hidden = !state.result;
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === route.top));
}

function parseRoute() {
  const h = (location.hash || '#/').replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (!a) return { name: 'home', top: 'home' };
  if (a === 'result') return { name: 'result', top: 'result' };
  // 예전 주소(#/check, #/check/항목, #/report, #/download)는 결과 화면으로
  if (a === 'check' || a === 'report' || a === 'download') return { name: 'legacy', id: a === 'check' ? b : null, top: 'result' };
  if (a === 'sheet') return { name: 'sheet', top: 'result' };
  if (a === 'ai') return { name: 'ai', top: 'result' };
  if (a === 'guide') return { name: 'guide', id: b, top: 'guide' };
  if (a === 'example') return { name: 'example', top: 'guide' };
  return { name: 'home', top: 'home' };
}

let lastRouteKey = '';
function render() {
  const route = parseRoute();
  if (route.name === 'legacy') {
    // #/check/조명 처럼 항목을 가리키던 주소면 그 항목을 펼쳐서 보여줌
    if (PAGE[route.id]) {
      state.openSecs.add(route.id);
      state.scrollTo = route.id;
    }
    location.replace('#/result');
    return;
  }
  const key = `${route.name}/${route.id || ''}`;
  const sameRoute = key === lastRouteKey;
  const y = window.scrollY;
  const grid = $('.grid-wrap', app);
  const gs = grid ? { t: grid.scrollTop, l: grid.scrollLeft } : null;
  $('#tip').hidden = true;
  renderNav(route);
  if (route.name === 'home') pageHome();
  else if (route.name === 'result') pageResult();
  else if (route.name === 'sheet') pageSheet();
  else if (route.name === 'ai') pageAI();
  else if (route.name === 'guide') pageGuide(route.id);
  else if (route.name === 'example') pageExample();
  if (sameRoute) {
    window.scrollTo(0, y);
    const g2 = $('.grid-wrap', app);
    if (g2 && gs) {
      g2.scrollTop = gs.t;
      g2.scrollLeft = gs.l;
    }
  } else window.scrollTo(0, 0);
  if (state.scrollTo) {
    const sec = $(`.sec[data-sec="${state.scrollTo}"]`, app);
    state.scrollTo = null;
    if (sec) sec.scrollIntoView({ block: 'start' });
  }
  lastRouteKey = key;
}

// ---------------- 표 편집·툴팁 (위임) ----------------
function initDelegates() {
  app.addEventListener('focusout', (e) => {
    const td = e.target;
    if (!td.matches || !td.matches('td[contenteditable]')) return;
    const row = state.result.revised.rows.find((r) => r.id === td.dataset.row);
    if (!row) return;
    const val = td.innerText;
    const cur = row.c[td.dataset.key] || '';
    if (val.replace(/\r/g, '').trim() === cur.trim()) return;
    saveCell(td.dataset.row, td.dataset.key, val, { quiet: true });
  });
  app.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && e.target.matches && e.target.matches('td[contenteditable]')) e.target.blur();
  });
  app.addEventListener('click', (e) => {
    const h = e.target.closest && e.target.closest('td[data-rowh]');
    if (!h) return;
    state.selectedRow = h.dataset.rowh;
    $$('tr.sel', app).forEach((tr) => tr.classList.remove('sel'));
    h.parentElement.classList.add('sel');
  });
  const tip = $('#tip');
  document.addEventListener('mouseover', (e) => {
    const td = e.target.closest && e.target.closest('#app td[data-key]');
    if (!td || !state.result || document.activeElement === td) return (tip.hidden = true);
    const row = state.result.revised.rows.find((r) => r.id === td.dataset.row);
    if (!row || state.sheetView === 'original') return (tip.hidden = true);
    const k = td.dataset.key;
    const m = row.marks && row.marks[k];
    const orig = state.originalMap.get(row.id);
    const parts = [];
    if (m && m.reasons && m.reasons.length) parts.push(`<b>자동 수정</b> ${esc(m.reasons.join(', '))}`);
    if (td.classList.contains('changed') || (m && (m.changed || m.placeholder))) parts.push(`<span class="before">원래: ${esc((orig ? (orig.cont[k] ? '(위 칸과 병합)' : orig.c[k]) : '(새 행)') || '(빈칸)').slice(0, 220)}</span>`);
    for (const f of state.result.findings.filter((x) => x.rowId === row.id && x.key === k && x.level !== 'info').slice(0, 2)) parts.push(`• ${esc(f.title)}`);
    if (!parts.length) return (tip.hidden = true);
    tip.innerHTML = parts.join('\n');
    tip.hidden = false;
    const r = td.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 360, r.left))}px`;
    tip.style.top = `${r.bottom + 8 + 140 > window.innerHeight ? Math.max(8, r.top - 8 - tip.offsetHeight) : r.bottom + 8}px`;
  });
  document.addEventListener('scroll', () => (tip.hidden = true), true);
}

async function checkAI() {
  try {
    const r = await fetch('/api/ai-review');
    const d = await r.json();
    state.ai.enabled = !!d.enabled;
  } catch {
    state.ai.enabled = false;
  }
}

restore();
initDelegates();
window.addEventListener('hashchange', render);
render();
checkAI().then(() => {
  // AI가 켜져 있으면 결과 화면 맨 위에 'AI 대안' 버튼을 보여줌
  if (state.ai.enabled && parseRoute().name === 'result') render();
});

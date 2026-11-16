// HANFLIX 큐시트 체크 — 큐시트 첨부 → 반영할 피드백 고르기 → 피드백 반영한 구글 시트 받기 (해시 라우팅)
import { parseGrid, buildBlocks } from './engine/parser.js';
import { classifyItem } from './engine/classify.js';
import { analyze } from './engine/analyze.js';
import { overviewText, placeText } from './engine/overview.js';
import { adviceText } from './engine/advice.js';
import { AFTER_LABEL } from './engine/remedy.js';
import { EX_RE } from './engine/ops.js';
import { buildOutput, isChosen, choiceItems, choiceStats, editText } from './engine/choices.js';
import { KEYS, LEVELS, colName } from './engine/constants.js';
import { fmtDurationKo } from './engine/time.js';
import { readWorkbook, looksLikeCueSheet, gridFromTsv } from './io/importers.js';
import { exportXlsx, safeSheetName } from './io/export-xlsx.js';
import { loadGis, gisReady, requestToken, uploadAsSheet } from './io/gsheet.js';
import { SAMPLE_MODEL } from './samples.js';
import { icon, wordmark } from './ui/icons.js';
import { sheetHtml, esc } from './ui/sheetview.js';
import { guideIndexHtml, guidePageHtml } from './ui/guide.js';
import { sheetForAI, findingsForAI, itemsFromEdit, gridFromRows } from './engine/aiwrite.js';
import { readAttachment, labelFor, ACCEPT, MAX_FILES, MAX_BINARY, sizeText } from './io/attach.js';

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
  { id: 'sound', name: '음향 · FD', icon: 'sliders', rule: '<b>장비·개수 · 누가 · 언제</b> · 노래하는 구간과 주인공·솔로의 <b>마이크</b> · 무대 사이 마이크 이동' },
  { id: 'screen', name: '화면', icon: 'monitor', rule: '화면에 띄울 <b>영상 / PPT</b>' },
  { id: 'light', name: '조명', icon: 'bulb', rule: '무대·상단 <b>구역 / 색상 / 밝기%</b> · 핀은 <b>ON / X</b> · FX는 2개 · 주인공이 있으면 Details에 주인공의 <b>동선 · 의상 · 위치</b>' },
  { id: 'form', name: '양식', icon: 'clipboard', rule: '<b>양식 유지</b> · 빈칸 없이 X / 유지 · 공통 항목 셀 병합' },
];
const PAGE = Object.fromEntries(PAGES.map((p) => [p.id, p]));
// 항목 → 가이드 페이지 (결과 화면에서 그 기준의 작성법으로 바로 이동)
const GUIDE_OF = { time: 'time', stage: 'content', detail: 'content', lyrics: 'content', sound: 'sound', screen: 'content', light: 'light', form: 'basic' };
const CAT_PAGE = { time: 'time', stage: 'stage', detail: 'detail', lyrics: 'lyrics', sound: 'sound', screen: 'screen', light: 'light', fx: 'light', form: 'form' };
const pageOf = (f) => CAT_PAGE[f.cat] || 'form';
// 고칠 것: 큰 문제(error)와 나머지(warn)를 나누지 않고 모두 '수정요망'
const isTodo = (f) => f.level === 'error' || f.level === 'warn';
const FX_OPTIONS = ['', '스트로브', '고보(무늬 투사)', '무빙(좌우 교차·원 그리기)', '추가 핀(Pin1~4 외 위치)', '조합 연출(여러 효과를 하나로)'];

// ---------------- 상태 ----------------
const state = {
  name: '',
  original: null, // 첨부한 큐시트 (바꾸지 않음)
  originalMap: new Map(),
  disabled: new Set(), // 반영 안 함으로 고른 자동 정리(fixId)
  choice: new Map(), // 골라서 반영하는 항목 id → true/false (없으면 기본값)
  edits: new Map(), // 항목 id → 고친 '수정 후' 문구
  fx: { FX1: '', FX2: '' },
  result: null, // analyze 결과
  output: null, // 고른 피드백을 반영한 큐시트 { S, applied, conflicts }
  highlight: false, // 새 시트에서 바뀐 칸을 노란색으로
  editing: null, // '수정 후' 문구를 고치는 중인 항목 id
  showDiff: true,
  sheetView: 'output',
  open: new Set(), // 펼친 피드백 카드
  openSecs: new Set(), // 펼친 항목(Run Time, 조명 …)
  showAll: new Set(), // '더 보기'를 누른 항목
  showAllDirs: false, // 총평의 수정 방향 '더 보기'
  scrollTo: null,
  fbText: null,
  source: null, // 첨부한 큐시트: { kind: 'link', title, tab, url, rows, at }
  pendingSource: null, // 탭 고르기 중인 링크
  made: null, // 만든 구글 시트 { url, name, at, count }
  gs: { clientId: '', busy: false }, // 구글 로그인 설정 (/api/config)
  // AI 큐시트 작성(OpenAI): 요구사항 · 첨부 파일 → 고칠 칸(items, 반영 고르기) 또는 새 큐시트(created)
  aiw: { enabled: null, model: '', mode: 'edit', prompt: '', fixFindings: false, files: [], run: null, error: '', items: [], jobs: [], created: null },
  sheets: null,
};
const STORE = 'hanflix-cuesheet-v2';
const AI_STORE = 'hanflix-aiw-v1';

// AI 작성 상태 (요구사항 · 진행 중인 요청 · 받은 결과) — 첨부 파일은 크기 때문에 저장하지 않음
function saveAI() {
  try {
    const { mode, prompt, fixFindings, run, error, items, jobs, created } = state.aiw;
    sessionStorage.setItem(AI_STORE, JSON.stringify({ mode, prompt, fixFindings, run, error, items, jobs, created }));
  } catch {
    /* 저장 공간이 없어도 동작에는 문제 없음 */
  }
}
function restoreAI() {
  try {
    const d = JSON.parse(sessionStorage.getItem(AI_STORE) || 'null');
    if (!d) return;
    const w = state.aiw;
    Object.assign(w, {
      mode: d.mode === 'create' ? 'create' : 'edit',
      prompt: d.prompt || '',
      fixFindings: !!d.fixFindings,
      run: d.run || null,
      error: d.error || '',
      items: Array.isArray(d.items) ? d.items : [],
      jobs: Array.isArray(d.jobs) ? d.jobs : [],
      created: d.created || null,
    });
    // 보내는 중에 새로 고침했으면 그 요청은 이어 받을 수 없음
    if (w.run && (!w.run.id || Date.now() - w.run.startedAt > AI_TIMEOUT)) {
      w.run = null;
      w.error = '페이지를 새로 고치는 동안 요청이 끊겼습니다. 다시 요청해 주세요.';
    }
  } catch {
    /* 무시 */
  }
}

function save() {
  saveAI();
  try {
    if (!state.original) return sessionStorage.removeItem(STORE);
    sessionStorage.setItem(
      STORE,
      JSON.stringify({
        name: state.name,
        source: state.source,
        original: state.original,
        disabled: [...state.disabled],
        choice: [...state.choice],
        edits: [...state.edits],
        fx: state.fx,
        highlight: state.highlight,
        made: state.made,
      }),
    );
  } catch {
    /* 저장 공간이 없어도 동작에는 문제 없음 */
  }
}
function restore() {
  restoreAI();
  try {
    const d = JSON.parse(sessionStorage.getItem(STORE) || 'null');
    if (!d || !d.original) return;
    Object.assign(state, {
      name: d.name,
      source: d.source || null,
      original: d.original,
      disabled: new Set(d.disabled || []),
      choice: new Map(d.choice || []),
      edits: new Map(d.edits || []),
      fx: d.fx || { FX1: '', FX2: '' },
      highlight: !!d.highlight,
      made: d.made || null,
    });
    state.originalMap = new Map(state.original.rows.map((r) => [r.id, r]));
    recompute();
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

// AI가 새로 쓴 큐시트의 [ ] 자리표시(AI가 모르는 내용)는 받은 시트에서 붉은 칸(직접 채울 칸)으로
function markAIPlaceholders(S) {
  for (const r of S.rows)
    for (const k of KEYS) {
      if (r.cont[k] || !EX_RE.test(r.c[k] || '')) continue;
      r.marks = r.marks || {};
      if (r.marks[k] && r.marks[k].changed) continue;
      r.marks[k] = { changed: false, before: r.c[k], reasons: ['AI가 자리만 잡아 둔 내용 — 직접 채우기'], pending: false, placeholder: true, fixIds: [] };
    }
}
// 자동 정리를 켜고 끄면 다시 분석, 고르기만 바꾸면 반영본만 다시 만든다 (AI 작성에서 받은 항목도 함께)
function recompute({ reanalyze = true } = {}) {
  if (reanalyze || !state.result) state.result = analyze(state.original, { disabled: state.disabled, fx: state.fx });
  state.output = buildOutput(state.result, state.choice, state.edits, state.aiw.items);
  if (state.source && state.source.kind === 'ai') markAIPlaceholders(state.output.S);
}
function run(rerender = true, opts) {
  recompute(opts);
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

// 큐시트를 첨부하면 그 큐시트의 피드백(반영할 것 고르기)으로 이어짐
// source: 어떤 큐시트를 첨부했는지 — 결과 화면 맨 위에 그대로 보여줌
function loadGrid(grid, name, source = {}) {
  const model = parseGrid(grid);
  if (!model.rows.length) throw new Error('큐시트 내용 행을 찾지 못했습니다. 머리글(항목, Run Time …)부터 있는 탭인지 확인해 주세요.');
  annotateKinds(model);
  Object.assign(state, {
    name: (name || grid.name || '큐시트').replace(/\.xlsx$/i, ''),
    source: { kind: 'link', ...source, rows: model.rows.length, at: Date.now() },
    pendingSource: null,
    original: model,
    originalMap: new Map(model.rows.map((r) => [r.id, r])),
    disabled: new Set(),
    choice: new Map(),
    edits: new Map(),
    fx: { FX1: '', FX2: '' },
    editing: null,
    open: new Set(),
    sheetView: 'output',
    openSecs: new Set(),
    showAll: new Set(),
    showAllDirs: false,
    fbText: null,
    made: null,
  });
  // 그 전 큐시트를 고친 AI 항목은 행이 달라 쓸 수 없음
  state.aiw.items = [];
  state.aiw.jobs = [];
  if (state.aiw.run && state.aiw.run.mode === 'edit') state.aiw.run.stale = true;
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
  // 스프레드시트 제목(서버가 구글 파일 이름에서 꺼내 줌) — 결과 화면에 '어떤 큐시트인지' 표시
  const titleOf = (r) => {
    try {
      return decodeURIComponent(r.headers.get('x-sheet-title') || '');
    } catch {
      return '';
    }
  };
  const tsvP = parsed.gid
    ? fetch(`/api/sheet?${q}&gid=${parsed.gid}&format=tsv`)
        .then(async (r) => (r.ok ? { text: await r.text(), title: titleOf(r) } : null))
        .catch(() => null)
    : Promise.resolve(null);
  try {
    let sheets = null;
    let err = null;
    let title = '';
    try {
      const res = await fetch(`/api/sheet?${q}`);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || `불러오기 실패 (${res.status})`);
      }
      title = titleOf(res);
      sheets = await readWorkbook(ensureExcel(), await res.arrayBuffer());
    } catch (e) {
      err = e;
    }
    const tsvRes = await tsvP;
    const tsv = tsvRes && tsvRes.text;
    const src = { kind: 'link', url: input.value.trim(), title: title || (tsvRes && tsvRes.title) || '' };
    if (sheets && sheets.length) {
      const gidIdx = matchGid(sheets, tsv);
      const cue = sheets.map((s, i) => ({ s, i, score: looksLikeCueSheet(s) })).filter((x) => x.score >= 5);
      if (gidIdx >= 0) return loadGrid(sheets[gidIdx], sheets[gidIdx].name, { ...src, tab: sheets[gidIdx].name });
      if (sheets.length === 1 || cue.length === 1) {
        const s = sheets.length === 1 ? sheets[0] : cue[0].s;
        return loadGrid(s, s.name, { ...src, tab: s.name });
      }
      state.sheets = sheets;
      state.pendingSource = src;
      const pick = $('#picker');
      $('#picker-select').innerHTML = sheets.map((s, i) => `<option value="${i}">${esc(s.name)}${looksLikeCueSheet(s) >= 5 ? '' : ' (큐시트 아님?)'}</option>`).join('');
      if (cue.length) $('#picker-select').value = String(cue[0].i);
      pick.hidden = false;
      setStatus(`탭이 ${sheets.length}개 있습니다 — 큐시트가 있는 탭을 고르세요.`);
      return;
    }
    if (tsv) {
      loadGrid({ ...gridFromTsv(tsv), name: '구글 시트' }, src.title || '구글 시트', { ...src, note: '셀 병합 없이 불러옴' });
      toast('셀 병합 없이 탭 내용만 불러왔습니다.');
      return;
    }
    throw err || new Error('시트를 불러오지 못했습니다.');
  } catch (e) {
    console.error(e);
    setStatus(e.message, true);
  } finally {
    btn.disabled = false;
  }
}

// ---------------- 반영 고르기 ----------------
const findingById = (id) => state.result.findings.find((x) => x.id === id) || allActions().find((a) => a.id === id) || state.aiw.items.find((a) => a.id === id);
const allActions = () => (state.result.advice || []).flatMap((a) => a.actions || []);
const chosen = (item) => isChosen(item, state.choice);
const stats = () => choiceStats(state.result, state.choice, state.aiw.items);

function setChoice(id, on) {
  const item = findingById(id);
  if (!item) return;
  if (item.apply === 'auto') {
    if (on) state.disabled.delete(item.fixId);
    else state.disabled.add(item.fixId);
    run(true, { reanalyze: true });
    return;
  }
  state.choice.set(id, !!on);
  run(true, { reanalyze: false });
}

// 한꺼번에 고르기: todo(수정요망만) · all · none · reset(처음 선택), page로 항목을 좁힐 수 있음
function bulkChoose(mode, pageId = null) {
  const items = [...choiceItems(state.result).filter((i) => !pageId || (i.advice ? i.cat === pageId : pageOf(i) === pageId)), ...(pageId ? [] : state.aiw.items)];
  if (mode === 'reset') {
    for (const i of items) {
      if (i.apply === 'auto') state.disabled.delete(i.fixId);
      else state.choice.delete(i.id);
    }
  } else {
    for (const i of items) {
      const on = mode === 'all' ? true : mode === 'none' ? false : isTodo(i) || i.apply === 'auto' ? true : chosen(i);
      if (i.apply === 'auto') {
        if (on) state.disabled.delete(i.fixId);
        else state.disabled.add(i.fixId);
      } else state.choice.set(i.id, on);
    }
  }
  run(true, { reanalyze: true });
}

// AI 요청 하나(job)의 항목을 한꺼번에 반영 / 반영 안 함
function bulkAI(job, on) {
  for (const i of state.aiw.items) if (job === '*' || i.job === job) state.choice.set(i.id, on);
  run(true, { reanalyze: false });
}
// AI 요청 하나를 지움 (그 요청에서 받은 항목도 함께)
function dropAIJob(job) {
  const ids = new Set(state.aiw.items.filter((i) => i.job === job).map((i) => i.id));
  state.aiw.items = state.aiw.items.filter((i) => !ids.has(i.id));
  state.aiw.jobs = state.aiw.jobs.filter((j) => j.id !== job);
  for (const id of ids) {
    state.choice.delete(id);
    state.edits.delete(id);
  }
  run(true, { reanalyze: false });
  toast('AI 요청 결과를 지웠습니다.');
}

// ---------------- 공통 조각 ----------------
function rowNo(S, id) {
  return S.rows.findIndex((r) => r.id === id) + 5;
}
function locText(f) {
  if (f.loc) return f.loc;
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
  const acts = id === 'sound' || id === 'light' ? allActions().filter((a) => a.cat === id) : [];
  const pickable = [...fs.filter((f) => f.apply === 'auto' || f.apply === 'op'), ...acts];
  return {
    fs,
    todo: fs.filter(isTodo).length,
    pickable: pickable.length,
    on: pickable.filter(chosen).length,
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
  app.innerHTML = `<section class="page"><div class="empty-ok"><b style="color:#fff">큐시트를 첨부하면 피드백 결과가 여기에 나옵니다</b><a class="btn primary" href="#/" style="margin-top:12px">${icon('link', 18)} 큐시트 첨부하기</a></div></section>`;
  return true;
}

// ---------------- 페이지: 홈 ----------------
// 우리 학부 큐시트의 구글 시트 링크 하나로 시작
function pageHome() {
  app.innerHTML = `<section class="page">
    <div class="hero">
      ${wordmark('wm hero-wm')}
      <h1>큐시트, 넣기만 하세요.</h1>
      <p>우리 학부 큐시트 시트 링크를 넣으면 피드백을 드립니다. 반영할 피드백을 고르면, 반영된 큐시트를 새 구글 시트로 만들어 드립니다.</p>
      <div class="start">
        <div class="field"><input id="sheet-url" type="url" placeholder="우리 학부 큐시트의 구글 시트 주소를 붙여넣으세요" autocomplete="off"><button class="btn primary big" id="btn-link">피드백 받기</button></div>
        <p class="hint">공유 설정을 '링크가 있는 모든 사용자 · 뷰어'로 바꿔 주세요 · 원본 시트는 읽기만 하고 바꾸지 않습니다</p>
        <div class="picker" id="picker" hidden><select id="picker-select"></select><button class="btn primary" id="btn-pick">이 탭으로 피드백 받기</button></div>
        <div class="status" id="status" role="status"></div>
      </div>
      <ol class="home-steps"><li><b>1</b>링크 첨부</li><li><b>2</b>반영할 피드백 고르기</li><li><b>3</b>피드백 반영한 구글 시트 받기</li></ol>
    </div>
  </section>`;
  $('#btn-link').addEventListener('click', loadFromLink);
  $('#sheet-url').addEventListener('keydown', (e) => e.key === 'Enter' && loadFromLink());
  $('#btn-pick').addEventListener('click', () => {
    const s = state.sheets[Number($('#picker-select').value)];
    loadGrid(s, s.name, { ...(state.pendingSource || { kind: 'link' }), tab: s.name });
  });
}

// ---------------- 원래 → 수정 후 ----------------
// [ ] 안은 학부만 아는 내용이라 예로 넣은 부분 → 파란 글씨로 표시
const markEx = (t) => esc(t).replace(/\[([^\]\n]{1,40})\]/g, '<mark>$1</mark>');
const hasEx = (t) => EX_RE.test(String(t || ''));
const clip = (t, n = 60) => {
  const v = String(t || '').replace(/\s*\n\s*/g, ' / ').trim();
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
};
const afterOf = (f) => (state.edits.has(f.id) ? state.edits.get(f.id) : f.after);
// 접힌 카드: 한 줄로 원래 → 수정 후
function baMini(f) {
  if (f.cells) return `<div class="ba-mini"><span class="k a">새 행</span><span class="v">${markEx(clip(f.after, 90))}</span></div>`;
  if (f.after == null) return `<div class="how">${esc(f.suggestion ? `→ ${f.suggestion}` : firstSentence(f.msg))}</div>`;
  const before = f.before ? `<span class="v b">${esc(clip(f.before, 34))}</span>` : '<span class="v b empty">빈칸</span>';
  return `<div class="ba-mini"><span class="k">원래</span>${before}<span class="arr">→</span><span class="k a">수정 후</span><span class="v">${markEx(clip(afterOf(f), 64))}</span></div>`;
}
// 펼친 카드: 원래 | 수정 후 두 칸
// AI가 넣는 새 행: 칸마다 내용
function insHtml(f) {
  const c = f.cells || {};
  const rows = KEYS.filter((k) => String(c[k] || '').trim())
    .map((k) => `<div><dt>${esc(colName(k))}</dt><dd>${markEx(String(c[k]).trim())}</dd></div>`)
    .join('');
  return `<div class="ba-new"><div class="ba-k">새 행 <span class="pill ai">AI 작성</span></div><dl>${rows || '<div><dd>빈 행</dd></div>'}</dl><div class="ba-note">${esc(f.loc)}에 들어갑니다 · 비운 공통 칸(항목 · 무대 · 대기 인원 · 음향 · 화면)은 같은 순서면 위 칸과 병합</div></div>`;
}
function baHtml(f) {
  if (f.after == null) return '';
  if (f.cells) return insHtml(f);
  const edited = state.edits.has(f.id);
  const kind = edited ? '고친 문구' : f.afterKind === 'ai' ? 'AI 작성' : AFTER_LABEL[f.afterKind] || '';
  const pill = f.apply === 'auto' ? 'ok' : f.afterKind === 'guide' ? '' : f.afterKind === 'ai' ? 'ai' : 'info';
  const after = afterOf(f);
  const note = [f.afterNote, hasEx(after) ? "파란 글씨는 예시 — 반영하면 시트에 '[ ]'로 들어가고 붉게 표시되니, 받은 시트에서 실제 내용으로 바꿔 적어 주세요" : ''].filter(Boolean);
  const pairs =
    f.pairs && f.pairs.length > 1
      ? `<ul class="ba-pairs">${f.pairs.map((p) => `<li><span class="loc">${esc(p.loc)}</span><s>${esc(clip(p.before, 60) || '빈칸')}</s> → <b>${markEx(clip(p.after, 60))}</b></li>`).join('')}${f.pairsMore ? `<li class="muted">외 ${f.pairsMore}곳</li>` : ''}</ul>`
      : '';
  return `<div class="ba is-${esc(f.afterKind || 'none')}">
    <div class="ba-col b"><div class="ba-k">원래</div><div class="ba-v">${f.before ? esc(f.before) : '<i>빈칸</i>'}</div></div>
    <div class="ba-arrow" aria-hidden="true">→</div>
    <div class="ba-col a"><div class="ba-k">수정 후 ${kind ? `<span class="pill ${pill}">${esc(kind)}</span>` : ''}</div><div class="ba-v">${markEx(after)}</div>${note.length ? `<div class="ba-note">${note.map(esc).join(' · ')}</div>` : ''}</div>
  </div>${pairs}`;
}

// 반영 / 반영 안 함
function choiceHtml(f) {
  if (f.apply === 'auto' || f.apply === 'op') {
    const on = chosen(f);
    const attr = f.apply === 'auto' ? `data-fix="${esc(f.fixId)}"` : `data-choose="${esc(f.id)}"`;
    return `<div class="choice" role="group" aria-label="반영 여부"><button type="button" ${attr} data-v="1" class="${on ? 'on' : ''}" aria-pressed="${on}">${icon('check', 15)} 반영</button><button type="button" ${attr} data-v="0" class="${on ? '' : 'on'}" aria-pressed="${!on}">반영 안 함</button></div>`;
  }
  if (isTodo(f)) return '<span class="pill manual-pill" title="자동으로 반영할 수 없어 받은 시트에서 직접 고칩니다">직접 고치기</span>';
  return '';
}
function editHtml(f) {
  if (f.apply !== 'op' || !f.editable) return '';
  if (state.editing === f.id) {
    const cur = state.edits.has(f.id) ? state.edits.get(f.id) : editText(f);
    return `<div class="edit-after"><label>수정 후 문구 고치기 <small>저장하면 이 문구로 반영합니다${f.ops[0].split ? " · 한 줄에 'Run Time 가사 / 가사' 한 행" : ''}</small></label><textarea data-edit-text rows="${Math.min(10, Math.max(3, String(cur).split('\n').length + 1))}">${esc(cur)}</textarea>
      <div class="acts"><button class="btn primary small" type="button" data-edit-save>${icon('check', 16)} 저장하고 반영</button><button class="btn small" type="button" data-edit-cancel>취소</button>${state.edits.has(f.id) ? '<button class="btn ghost small" type="button" data-edit-reset>예시로 되돌리기</button>' : ''}</div></div>`;
  }
  return `<div class="edit-after"><button class="linkbtn" type="button" data-edit-open>${icon('pencil', 14)} 수정 후 문구 고치기${hasEx(afterOf(f)) ? ' (파란 글씨를 실제 내용으로)' : ''}</button></div>`;
}
function conflictHtml(f) {
  const others = state.output && state.output.conflicts.get(f.id);
  if (!others || !others.length || !chosen(f)) return '';
  const names = [...new Set(others)].map((id) => findingById(id)).filter(Boolean).map((x) => `'${x.title}'`);
  return `<p class="conflict">${icon('chat', 15)} 같은 칸을 바꾸는 ${names.join(', ')} 항목도 반영하기로 골라져 있어, 아래에 있는 항목의 문구가 최종으로 들어갑니다.</p>`;
}

function issueHtml(f) {
  const open = state.open.has(f.id);
  const on = chosen(f);
  const pickable = f.apply === 'auto' || f.apply === 'op';
  const cls = ['issue', isTodo(f) ? 'error' : 'note', f.source === 'ai' ? 'ai' : '', pickable ? (on ? 'is-on' : 'is-off') : 'is-manual', open ? 'open' : ''].filter(Boolean).join(' ');
  const msg = f.msg && !(f.source === 'ai' && f.msg === f.title) ? `<p>${esc(f.msg)}</p>` : '';
  return `<div class="${cls}" data-id="${esc(f.id)}">
    <div class="issue-top"><div class="t"><b>${esc(f.title)}</b><div class="loc">${esc(locText(f))}</div>${baMini(f)}</div>${choiceHtml(f)}${icon('chevron', 20).replace('class="ic"', 'class="ic chev"')}</div>
    <div class="issue-body">${msg}${baHtml(f)}${editHtml(f)}${conflictHtml(f)}${f.apply === 'manual' ? `<p class="manual">${icon('pencil', 15)} ${esc(f.manual || '받은 시트에서 직접 고쳐 주세요.')}</p>` : ''}${f.why ? `<div class="why">근거 · ${esc(f.why)}</div>` : ''}</div>
  </div>`;
}

const fixEx = (f) => {
  const p = f.pairs && f.pairs.length ? f.pairs[0] : f.after != null ? { before: f.before, after: f.after } : null;
  return p ? `<span class="fx-ex"><s>${esc(clip(p.before, 36) || '빈칸')}</s> → <b>${esc(clip(p.after, 44))}</b></span>` : '';
};
const autoHtml = (f) => `<div class="fix ${chosen(f) ? 'is-on' : 'is-off'}" data-id="${esc(f.id)}"><div class="t">${esc(f.title)}<small>${esc(firstSentence(f.msg))}</small>${fixEx(f)}</div>${choiceHtml(f)}</div>`;
const noteHtml = (f) => `<div class="fix"><div class="t">${esc(f.title)}<small>${esc(firstSentence(f.msg))}</small></div></div>`;
const fxHtml = () =>
  `<div class="fix fx"><div class="t"><b>FX 지정</b><small>학부가 쓰는 효과 2개를 고르면 Details에 함께 적습니다</small></div><div class="fx-sel">${['FX1', 'FX2']
    .map((k) => `<select data-fx="${k}" class="btn small">${FX_OPTIONS.map((o) => `<option value="${esc(o)}" ${state.fx[k] === o ? 'selected' : ''}>${o ? `${k}: ${o}` : `${k} 지정 안 함`}</option>`).join('')}</select>`)
    .join('')}</div></div>`;

// 음향 · 조명 항목 안: 무대 내용·개사를 분석한 제안 (반영할 수 있는 제안은 고르기)
function actionHtml(a) {
  return `<div class="act ${chosen(a) ? 'is-on' : 'is-off'}" data-id="${esc(a.id)}"><div class="t"><b>${esc(a.title)}</b><div class="ba-mini"><span class="k a">반영하면</span><span class="v">${markEx(clip(a.after, 90))}</span></div></div>${choiceHtml(a)}</div>`;
}
function adviceHtml(cat) {
  const list = (state.result.advice || []).filter((a) => a[cat].length || (a.actions || []).some((x) => x.cat === cat));
  if (!list.length) return '';
  return `<h3 class="sub-title">이 무대에 맞춘 ${cat === 'sound' ? '음향' : '조명'} 제안 <small>무대 내용·개사를 분석한 제안 — 반영할 수 있는 것은 골라서 반영</small><a class="g-link small" href="#/guide/plan">구성법 ${icon('right', 14)}</a></h3>
    <div class="advice">${list
      .map(
        (a) => `<div class="adv"><div class="adv-h"><b>${esc(a.label)}</b>${a.title ? ` <span>${esc(a.title)}</span>` : ''}${a.about ? `<small>${esc(a.about)}</small>` : ''}</div>
        <ul>${a[cat].map((t) => `<li>${esc(t)}</li>`).join('')}</ul>${a.now.filter((n) => n.cat === cat).map((n) => `<p class="adv-now"><b>지금 큐시트</b> ${esc(n.text)}</p>`).join('')}
        ${(a.actions || []).filter((x) => x.cat === cat).map(actionHtml).join('')}</div>`,
      )
      .join('')}</div>`;
}

function sectionHtml(p) {
  const s = pageStats(p.id);
  const open = state.openSecs.has(p.id);
  const status = s.todo ? 'todo' : 'ok';
  const chips = `${s.todo ? `<span class="pill error">수정요망 ${s.todo}</span>` : '<span class="pill ok">통과</span>'}${s.pickable ? `<span class="pill sel">반영 ${s.on}/${s.pickable}</span>` : ''}`;
  let body = '';
  if (open) {
    const todo = s.fs.filter(isTodo).sort((a, b) => LEVELS[a.level].order - LEVELS[b.level].order);
    const picks = s.fs.filter((f) => !isTodo(f) && f.apply === 'op');
    const autos = s.fs.filter((f) => !isTodo(f) && f.apply === 'auto');
    // 총 무대 시간 안내는 Run Time의 무대 시간 막대가 대신 보여줌
    const notes = s.fs.filter((f) => !isTodo(f) && f.apply !== 'op' && f.apply !== 'auto' && f.id !== 'time:total');
    const all = state.showAll.has(p.id);
    body = `<div class="sec-body">
      <div class="rule">${p.rule} <a class="g-link small" href="#/guide/${GUIDE_OF[p.id]}">가이드 ${icon('right', 14)}</a></div>
      ${s.pickable ? `<div class="sec-bulk"><button class="btn small" type="button" data-bulk="all" data-page="${p.id}">${icon('check', 15)} 이 항목 모두 반영</button><button class="btn small" type="button" data-bulk="none" data-page="${p.id}">모두 반영 안 함</button></div>` : ''}
      ${p.id === 'time' ? timeCardHtml() : ''}
      ${todo.length ? `<div class="issues">${todo.slice(0, all ? todo.length : 6).map(issueHtml).join('')}</div>${todo.length > 6 && !all ? `<button class="btn ghost small more" data-more="${p.id}">나머지 ${todo.length - 6}개 더 보기</button>` : ''}` : '<div class="sec-ok">고칠 것이 없습니다.</div>'}
      ${picks.length ? `<h3 class="sub-title">참고 — 골라서 반영 <small>꼭 고칠 것은 아니지만 반영하면 더 분명해지는 것</small></h3><div class="issues">${picks.map(issueHtml).join('')}</div>` : ''}
      ${p.id === 'sound' || p.id === 'light' ? adviceHtml(p.id) : ''}
      ${p.id === 'light' ? `<h3 class="sub-title">FX</h3>${fxHtml()}` : ''}
      ${autos.length ? `<h3 class="sub-title">자동 정리 <small>형식을 맞추는 수정 — 처음부터 반영으로 골라져 있고, 반영 안 함을 누르면 원래대로 둡니다</small></h3><div class="fixes">${autos.map(autoHtml).join('')}</div>` : ''}
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

// ---------------- AI 요청 결과 (반영 고르기) ----------------
const timeOf = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
const notesHtml = (notes) => (notes && notes.length ? `<ul class="w-notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : '');
function aiJobsHtml() {
  const w = state.aiw;
  return w.jobs
    .map((j) => {
      const items = w.items.filter((i) => i.job === j.id);
      const on = items.filter(chosen).length;
      const files = j.files && j.files.length ? ` <span class="muted">· 첨부 ${esc(j.files.join(', '))}</span>` : '';
      return `<section class="card w-job" data-job="${esc(j.id)}">
      <div class="w-rh"><span class="pill ai">${icon('sparkle', 14)} AI 요청</span><span class="muted">${esc(timeOf(j.at))}${items.length ? ` · 반영 ${on}/${items.length}` : ''}</span><button class="linkbtn" type="button" data-reuse="${esc(j.id)}">요구사항 다시 쓰기</button></div>
      <p class="w-q"><q>${esc(clip(j.prompt || '(첨부 파일대로)', 240))}</q>${files}</p>
      ${j.summary ? `<p class="w-sum">${esc(j.summary)}</p>` : ''}
      ${notesHtml(j.notes)}
      ${
        items.length
          ? `<div class="sec-bulk"><button class="btn small" type="button" data-aibulk="1" data-job="${esc(j.id)}">${icon('check', 15)} 이 요청 모두 반영</button><button class="btn small" type="button" data-aibulk="0" data-job="${esc(j.id)}">모두 반영 안 함</button><button class="btn ghost small" type="button" data-aidel="${esc(j.id)}">요청 지우기</button></div><div class="issues">${items.map(issueHtml).join('')}</div>`
          : `<p class="muted w-none">바꿀 칸은 없었습니다. <button class="linkbtn" type="button" data-aidel="${esc(j.id)}">지우기</button></p>`
      }
    </section>`;
    })
    .join('');
}
// 피드백 결과 화면: AI 작성에서 받은 수정도 같은 방식으로 고르기
function aiSectionHtml() {
  const w = state.aiw;
  if (!w.jobs.length) return '';
  const on = w.items.filter(chosen).length;
  return `<section class="ai-sec" id="ai-sec">
    <h2 class="sec-title">${icon('sparkle', 20)} AI 요청 반영 <span class="pill ai">반영 ${on}/${w.items.length}</span><small>AI 작성에서 받은 수정 — 반영으로 고른 것만 새 구글 시트에 들어갑니다</small><a class="g-link small" href="#/write">AI 작성 ${icon('right', 14)}</a></h2>
    ${aiJobsHtml()}
  </section>`;
}
function redrawAISec() {
  const el = $('#ai-sec', app);
  if (!el) return render();
  const tmp = document.createElement('div');
  tmp.innerHTML = aiSectionHtml();
  if (tmp.firstElementChild) el.replaceWith(tmp.firstElementChild);
  else el.remove();
}
// 카드 하나를 다시 그림: 피드백은 그 항목(섹션)만, AI 항목은 AI 섹션(결과 화면) 또는 화면 전체
function redrawItem(item) {
  if (!item) return render();
  if (item.source === 'ai') return parseRoute().name === 'result' ? redrawAISec() : render();
  return redrawSec(pageOf(item));
}

// 어떤 큐시트를 첨부했는지: 구글 시트 제목 › 탭 (시트 열기) · 행 수 · 첨부 시각
function sourceHtml() {
  const s = state.source;
  if (!s) return esc(state.name);
  const what = s.kind === 'paste' ? '복사해서 붙여넣은 표' : s.kind === 'ai' ? `AI가 작성한 큐시트${s.title ? ` '${esc(s.title)}'` : ''}` : ['구글 시트', s.title ? `'${esc(s.title)}'` : '', s.tab ? `› ${esc(s.tab)} 탭` : ''].filter(Boolean).join(' ');
  const time = s.at ? new Date(s.at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
  const extra = [s.note, s.rows ? `${s.rows}행` : '', time ? `${time} ${s.kind === 'ai' ? '작성' : '첨부'}` : '', s.kind === 'ai' ? '' : '원본은 바꾸지 않음'].filter(Boolean).join(' · ');
  const open = s.kind === 'link' && /^https:\/\/docs\.google\.com\/spreadsheets\/d\//.test(s.url || '') ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">시트 열기 ↗</a>` : '';
  return `${what}${extra ? ` <span class="muted">· ${esc(extra)}</span>` : ''}${open}`;
}

// 총평 · 수정 방향: 항목별 피드백을 한눈에 이해할 수 있게 글로 묶은 것
function overviewHtml() {
  const o = state.result.summary.overview;
  if (!o) return '';
  const dirs = o.directions;
  const shown = state.showAllDirs ? dirs : dirs.slice(0, 8);
  const li = (d) =>
    `<li class="${d.fixed ? 'fixed' : ''}"><b>${esc(d.item)}</b> ${esc(d.action)}${d.places.length ? ` <span class="muted">${esc(placeText(d).trim())}</span>` : ''}${d.fixed ? ' <span class="pill ok">자동 정리</span>' : ''}</li>`;
  return `<section class="card overview">
    <h2>${icon('chat', 20)} 총평</h2>
    <p class="ov-lead">${esc(o.lead)}</p>
    ${dirs.length ? `<h3>수정 방향</h3><ol class="ov-dirs">${shown.map(li).join('')}</ol>${dirs.length > shown.length ? `<button class="btn ghost small more" id="b-dirs" type="button">나머지 ${dirs.length - shown.length}가지 더 보기</button>` : ''}` : ''}
    ${o.advice && o.advice.length ? `<h3>음향 · 조명 제안 <small>무대 내용 · 개사 분석</small></h3><ul class="ov-adv">${o.advice.map((a) => `<li><b>${esc(a.label)}</b>${a.title ? ` <span class="muted">${esc(a.title)}</span>` : ''} — ${esc(a.brief)}</li>`).join('')}</ul><p class="ov-hint">무대별 자세한 제안은 아래 '음향 · FD'와 '조명' 항목을 펼치면 볼 수 있습니다. <a class="g-link small" href="#/guide/plan">음향 · 조명 구성법 ${icon('right', 14)}</a></p>` : ''}
    ${o.autoNote ? `<p class="ov-auto">${esc(o.autoNote)}</p>` : ''}
  </section>`;
}

// 진행 단계: ① 첨부 ② 고르기 ③ 받기
const stepsHtml = () =>
  `<ol class="flow-bar"><li class="done"><span>1</span>큐시트 첨부</li><li class="${state.made ? 'done' : 'now'}"><span>2</span>반영할 피드백 고르기</li><li class="${state.made ? 'done' : ''}"><span>3</span>피드백 반영한 구글 시트 받기</li></ol>`;

const makeLabel = () => (state.gs.busy ? '만드는 중…' : '피드백 반영한 구글 시트 만들기');
function madeHtml() {
  const m = state.made;
  if (!m) return '';
  const at = new Date(m.at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  return `<div class="made"><b>${icon('check', 18)} 새 구글 시트를 만들었습니다</b><a class="btn primary small" href="${esc(m.url)}" target="_blank" rel="noopener noreferrer">'${esc(m.name)}' 열기 ↗</a><span class="muted">${esc(at)} · 반영한 피드백 ${m.count}개 · 첨부한 원본은 그대로</span></div>`;
}

function getPanelHtml() {
  const st = stats();
  return `<section class="card get" id="get">
    <h2><span class="g-no">3</span> 피드백 반영한 구글 시트 받기</h2>
    <p class="get-lead">반영하기로 고른 <b>${st.on}개</b> 항목(자동 정리 ${st.auto} · 직접 고른 ${st.picked - st.ai}${st.ai ? ` · AI 작성 ${st.ai}` : ''})이 들어간 큐시트를 <b>내 구글 드라이브에 새 구글 시트</b>로 만듭니다. 2026 2차 양식(열 너비 · 셀 색 · 글꼴 · 병합)이 그대로 들어가고, 첨부한 원본 시트는 바뀌지 않습니다.${st.manual ? ` '직접 고치기' ${st.manual}개는 받은 시트에서 고쳐 주세요.` : ''}</p>
    <label class="switch"><input type="checkbox" id="o-hl" ${state.highlight ? 'checked' : ''}><span>반영으로 바뀐 칸을 노란색으로 표시</span></label>
    <div class="res-actions">
      <button class="btn primary" type="button" data-make ${state.gs.busy ? 'disabled' : ''}>${icon('grid', 18)} ${makeLabel()}</button>
      <a class="btn" href="#/sheet">${icon('list', 18)} 미리보기</a>
      <button class="btn" type="button" id="d-submit">${icon('download', 18)} 엑셀 파일로 받기</button>
      <button class="btn" type="button" id="d-review">${icon('list', 18)} 검토용 엑셀</button>
      <button class="btn" type="button" id="d-msg">${icon('chat', 18)} 피드백 메시지 복사</button>
      <a class="btn ghost" href="#/write">${icon('sparkle', 18)} AI로 고치기</a>
    </div>
    <div class="make-note" id="make-note" role="status" ${state.made ? '' : 'hidden'}>${madeHtml()}</div>
  </section>`;
}
const barHtml = () => {
  const st = stats();
  return `<div class="getbar" role="region" aria-label="반영 현황"><div class="gb-txt"><b>반영 ${st.on}개</b><span>수정요망 ${st.todoOn}/${st.todo} 반영${st.manual ? ` · 직접 고치기 ${st.manual}` : ''}</span></div><a class="btn small" href="#/sheet">미리보기</a><button class="btn primary small" type="button" data-make ${state.gs.busy ? 'disabled' : ''}>${state.gs.busy ? '만드는 중…' : '구글 시트 만들기'}</button></div>`;
};

function pageResult() {
  if (needResult()) return;
  const { summary } = state.result;
  const ok = !summary.todo;
  const over = summary.totalSec > 660;
  const st = stats();
  if (state.gs.clientId) loadGis().catch(() => {}); // 버튼을 누르기 전에 구글 로그인 모듈을 미리 불러 둠
  app.innerHTML = `<section class="page result">
    <div class="card res-head">
      <div class="res-top"><span class="eyebrow">피드백 결과</span><span class="res-top-acts"><a class="btn small" href="#/write">${icon('sparkle', 16)} AI로 고치기</a><a class="btn small" href="#/">${icon('link', 16)} 다른 큐시트 첨부</a></span></div>
      <h1>${esc(state.name)}</h1>
      ${stepsHtml()}
      <dl class="res-meta">
        <div><dt>첨부한 원본</dt><dd>${sourceHtml()}</dd></div>
        <div><dt>점검 기준</dt><dd>2026 2차 큐시트 양식 · OT 작성 예시 · 2026 조명 가이드 · 모범 큐시트(공시) · 주인공 조명 Details · 무대 내용·개사 분석<a href="#/guide">가이드</a><a href="#/guide/feedback">피드백 고르는 법</a></dd></div>
      </dl>
      <div class="chips">
        ${ok ? '<span class="pill ok">제출 가능</span>' : `<span class="pill error">수정요망 ${summary.todo}</span>`}
        <span class="pill ${over ? 'error' : ''}">무대 시간 ${summary.totalText}${over ? ` · ${fmtDurationKo(summary.totalSec - 660)} 초과` : ' / 11분'}</span>
        <span class="pill sel">반영 ${st.on}개 선택</span>
      </div>
      ${state.made ? `<div class="made-top">${madeHtml()}</div>` : ''}
    </div>
    ${overviewHtml()}
    <div class="pick-head">
      <h2 class="sec-title"><span class="g-no">2</span> 반영할 피드백 고르기 <small>항목마다 반영 / 반영 안 함을 고르면, 반영한 것만 새 구글 시트에 들어갑니다</small></h2>
      <div class="pick-bulk">
        <button class="btn small" type="button" data-bulk="todo">${icon('check', 15)} 수정요망 모두 반영</button>
        <button class="btn small" type="button" data-bulk="all">모두 반영</button>
        <button class="btn small" type="button" data-bulk="none">모두 반영 안 함</button>
        <button class="btn ghost small" type="button" data-bulk="reset">처음 선택으로</button>
      </div>
      <ul class="pick-legend">
        <li><span class="pill ok">자동 정리</span> 표기 · 빈칸처럼 형식을 맞추는 수정 — 처음부터 반영</li>
        <li><span class="pill info">반영하면 이렇게</span> 예시가 들어가는 수정 — 골라서 반영 (<mark>파란 글씨</mark>는 시트에서 바꿔 적기, 문구를 먼저 고쳐도 됨)</li>
        <li><span class="pill manual-pill">직접 고치기</span> 자동으로 반영할 수 없는 것 — 받은 시트에서 고치기</li>
      </ul>
    </div>
    <div class="sections">${PAGES.map(sectionHtml).join('')}</div>
    ${aiSectionHtml()}
    ${getPanelHtml()}
    <details class="more"><summary>큐시트 1행 TFT 피드백 문구 고치기 (검토용 엑셀)</summary><textarea id="fb-text">${esc(state.fbText ?? summary.feedbackText)}</textarea></details>
    ${barHtml()}
  </section>`;
  bindResult();
}

// 반영 / 반영 안 함 · 문구 고치기 · 카드 펼치기 · 구글 시트 만들기 (피드백 결과 · AI 작성 화면 공용) — 처리했으면 true
function pickClick(e) {
  if (e.target.closest('[data-make]')) return makeSheet(), true;
  const ru = e.target.closest('[data-reuse]');
  if (ru) {
    const c = state.aiw.created;
    const j = state.aiw.jobs.find((x) => x.id === ru.dataset.reuse) || (c && c.id === ru.dataset.reuse ? c : null);
    if (j) {
      state.aiw.prompt = j.prompt || '';
      state.aiw.mode = j === c ? 'create' : 'edit';
      saveAI();
      if (parseRoute().name === 'write') render();
      else location.hash = '#/write';
      window.scrollTo(0, 0);
      const ta = $('#w-prompt', app);
      if (ta) ta.focus();
    }
    return true;
  }
  const ab = e.target.closest('[data-aibulk]');
  if (ab) return bulkAI(ab.dataset.job, ab.dataset.aibulk === '1'), true;
  const ad = e.target.closest('[data-aidel]');
  if (ad) return dropAIJob(ad.dataset.aidel), true;
  const pick = e.target.closest('[data-choose],[data-fix]');
  if (pick && pick.tagName === 'BUTTON') {
    const on = pick.dataset.v === '1';
    if (pick.dataset.fix) {
      const f = state.result.findings.find((x) => x.fixId === pick.dataset.fix && x.apply === 'auto');
      if (f) setChoice(f.id, on);
    } else setChoice(pick.dataset.choose, on);
    return true;
  }
  const card = e.target.closest('.issue');
  const fid = card && card.dataset.id;
  if (!fid) return false;
  if (e.target.closest('[data-edit-open]')) {
    state.editing = fid;
    return redrawItem(findingById(fid)), true;
  }
  if (e.target.closest('[data-edit-cancel]')) {
    state.editing = null;
    return redrawItem(findingById(fid)), true;
  }
  if (e.target.closest('[data-edit-reset]')) {
    state.edits.delete(fid);
    state.editing = null;
    return run(true, { reanalyze: false }), true;
  }
  if (e.target.closest('[data-edit-save]')) {
    const ta = card.querySelector('[data-edit-text]');
    state.edits.set(fid, ta.value.replace(/\r/g, '').replace(/\n+$/, ''));
    state.choice.set(fid, true);
    state.editing = null;
    run(true, { reanalyze: false });
    toast('고친 문구로 반영하도록 골랐습니다.');
    return true;
  }
  const top = e.target.closest('.issue-top');
  if (top && !e.target.closest('.choice')) {
    if (state.open.has(fid)) state.open.delete(fid);
    else state.open.add(fid);
    card.classList.toggle('open');
    return true;
  }
  return false;
}

function bindResult() {
  $('#d-submit').addEventListener('click', () => exportFile('submit'));
  $('#d-review').addEventListener('click', () => exportFile('review'));
  $('#d-msg').addEventListener('click', () => copyText(reportText(), '피드백 메시지를 복사했습니다.'));
  $('#fb-text').addEventListener('input', (e) => (state.fbText = e.target.value));
  $('#o-hl').addEventListener('change', (e) => {
    state.highlight = e.target.checked;
    save();
  });
  if ($('#b-dirs'))
    $('#b-dirs').addEventListener('click', () => {
      state.showAllDirs = true;
      render();
    });
  const root = $('.result', app);
  root.addEventListener('click', (e) => {
    if (pickClick(e)) return;
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) return bulkChoose(bulk.dataset.bulk, bulk.dataset.page || null);
    const head = e.target.closest('.sec-head');
    if (head) {
      const id = head.closest('.sec').dataset.sec;
      if (state.openSecs.has(id)) state.openSecs.delete(id);
      else state.openSecs.add(id);
      return redrawSec(id);
    }
    const more = e.target.closest('[data-more]');
    if (more) {
      state.showAll.add(more.dataset.more);
      return redrawSec(more.dataset.more);
    }
  });
  root.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fx]');
    if (sel) {
      state.fx[sel.dataset.fx] = sel.value;
      run(true, { reanalyze: true });
    }
  });
}

// ---------------- 페이지: 미리보기 (피드백 반영본) ----------------
function pageSheet() {
  if (needResult()) return;
  const isOrig = state.sheetView === 'original';
  const S = isOrig ? state.original : state.output.S;
  const st = stats();
  // 아직 남은 수정요망(반영 안 함 · 직접 고치기)만 표시
  const left = state.result.findings.filter((f) => isTodo(f) && !chosen(f));
  app.innerHTML = `<section class="page">
    <a class="back" href="#/result">${icon('left', 18)} 반영할 피드백 고르기</a>
    <h1 class="page-title">미리보기</h1>
    <p class="page-sub">${esc(state.name)} · ${isOrig ? '첨부한 원본' : `고른 피드백 ${st.on}개를 반영한 모습`} · 2026 2차 양식 그대로 · 반영 여부는 피드백 결과에서 바꿀 수 있습니다</p>
    <div class="sheet-tools">
      <div class="seg"><button data-v="output" class="${isOrig ? '' : 'active'}">피드백 반영본</button><button data-v="original" class="${isOrig ? 'active' : ''}">원본</button></div>
      <label class="switch"><input type="checkbox" id="t-diff" ${state.showDiff ? 'checked' : ''}><span>바뀐 칸 표시</span></label>
      <span class="gap"></span>
      <button class="btn primary small" type="button" data-make ${state.gs.busy ? 'disabled' : ''}>${icon('grid', 16)} ${makeLabel()}</button>
    </div>
    <div class="make-note" id="make-note" role="status" ${state.made ? '' : 'hidden'}>${madeHtml()}</div>
    <div class="sheet-card"><div class="grid-wrap" id="grid">${sheetHtml(S, { editable: false, findings: isOrig ? [] : left, originalMap: isOrig ? null : state.originalMap, showDiff: state.showDiff && !isOrig })}</div></div>
    <div class="legend"><span><i class="sw changed"></i>반영으로 바뀐 칸</span><span><i class="sw ph"></i>직접 채울 칸 · 예시</span><span><i class="sw pd"></i>논의 중</span><span><i class="dot error"></i>아직 남은 수정요망</span></div>
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
  $('[data-make]', app).addEventListener('click', makeSheet);
  if (state.gs.clientId) loadGis().catch(() => {});
}

// ---------------- 내보내기 · 메시지 ----------------
// 학부 디렉터에게 보낼 메시지: 총평 · 수정 방향 → 항목별 피드백(반영 여부 · 원래 → 수정 후) → 음향·조명 제안
function reportText() {
  const { summary, findings } = state.result;
  const st = stats();
  const L = [`[2026 학부합창대회 큐시트 피드백] ${state.name}`, `${summary.todo ? `수정요망 ${summary.todo}건` : '제출 가능'} · 무대 시간 ${summary.totalText}/11분 · 반영하기로 고른 항목 ${st.on}개`, '', '■ 총평', overviewText(summary.overview, { withAdvice: false })];
  const items = [];
  for (const p of PAGES) {
    const fs = findings.filter((f) => pageOf(f) === p.id && isTodo(f));
    if (!fs.length) continue;
    items.push('', `[${p.name}]`);
    fs.forEach((f) => {
      const tag = f.apply === 'manual' || f.apply === 'none' ? '직접 고치기' : chosen(f) ? '반영' : '반영 안 함';
      items.push(`- [${tag}] ${f.title}${f.rowId ? ` (${locText(f)})` : ''}`);
      if (f.after != null) items.push(`  원래: ${clip(f.before, 90) || '(빈칸)'}`, `  수정 후: ${clip(afterOf(f), 140)}`);
      else if (f.suggestion) items.push(`  → ${f.suggestion}`);
    });
  }
  if (items.length) L.push('', '■ 항목별 피드백 (수정요망) — 원래 → 수정 후, [ ]는 예시', ...items);
  if (state.aiw.items.length) {
    L.push('', '■ AI 요청 반영');
    for (const j of state.aiw.jobs) {
      const list = state.aiw.items.filter((i) => i.job === j.id);
      if (!list.length) continue;
      L.push(`요청: ${clip(j.prompt || '(첨부 파일대로)', 120)}`);
      for (const i of list) L.push(`- [${chosen(i) ? '반영' : '반영 안 함'}] ${i.title} (${i.loc})`, `  ${i.cells ? '새 행' : '수정 후'}: ${clip(afterOf(i), 140)}`);
    }
  }
  const adv = adviceText(state.result.advice);
  if (adv) L.push('', `■ ${adv}`);
  L.push('', state.made ? `피드백을 반영한 새 구글 시트: ${state.made.url}` : '피드백을 반영한 새 구글 시트를 만들어 함께 보냅니다.', "붉은 칸('(작성 필요)', [ ] 예시)을 채워 다시 제출해 주세요.");
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
async function buildBuffer(mode) {
  return exportXlsx(ensureExcel(), state.output.S, {
    mode,
    feedbackText: state.fbText ?? state.result.summary.feedbackText,
    findings: [...state.result.findings, ...state.aiw.items.map((i) => ({ ...i, cat: 'AI 요청', after: afterOf(i) }))],
    chosen: new Set(state.output.applied),
    highlight: state.highlight,
    title: safeSheetName(state.name),
    overviewText: mode === 'review' ? [overviewText(state.result.summary.overview, { maxDirections: 100, withAdvice: false }), adviceText(state.result.advice)].filter(Boolean).join('\n\n') : '',
  });
}
const baseName = () => state.name.replace(/[\\/:*?"<>|]/g, ' ').trim() || '큐시트';
// 내려받은 파일 이름을 돌려줌 (실패하면 null)
async function exportFile(mode, { quiet = false } = {}) {
  try {
    const buf = await buildBuffer(mode);
    const file = `${baseName()}_2026큐시트_${mode === 'review' ? '검토용' : '피드백반영'}.xlsx`;
    download(buf, file);
    if (!quiet) toast('엑셀을 내려받았습니다.');
    return file;
  } catch (e) {
    console.error(e);
    toast(`엑셀을 만들지 못했습니다: ${e.message}`);
    return null;
  }
}

// ---------------- 피드백 반영한 구글 시트 만들기 ----------------
// 구글 로그인(drive.file 권한) → 2026 양식 엑셀을 구글 시트로 변환해 학부 계정의 드라이브에 새 파일로 만든다.
// 구글 로그인이 설정되지 않았으면(GOOGLE_CLIENT_ID 없음) 새 빈 시트를 열고 엑셀을 '가져오기' 하는 방식으로 대신한다.
const sheetTitle = () => `${state.name} 2026 큐시트 (피드백 반영)`;
function setNote(html) {
  for (const n of $$('#make-note', app)) {
    n.hidden = false;
    n.innerHTML = html;
  }
}
function setBusy(on) {
  state.gs.busy = on;
  for (const b of $$('[data-make]', app)) {
    if (b.classList.contains('linkbtn')) continue;
    b.disabled = on;
    if (b.closest('.getbar')) b.textContent = on ? '만드는 중…' : '구글 시트 만들기';
    else b.innerHTML = `${icon('grid', b.classList.contains('small') ? 16 : 18)} ${makeLabel()}`;
  }
}
function makeSheet() {
  if (state.gs.busy) return;
  if (!state.gs.clientId) return makeViaImport();
  // 로그인 창은 클릭한 순간 바로 열어야 팝업 차단에 걸리지 않는다 (await 전에 요청)
  const tokenP = requestToken(state.gs.clientId);
  setBusy(true);
  setNote(`<b>${icon('grid', 18)} 구글 계정을 확인하는 중…</b><p>로그인 창이 열리면 계정을 고르고 '허용'을 눌러 주세요. 이 사이트가 만드는 파일에만 접근하는 권한입니다.</p>`);
  (async () => {
    try {
      const accessToken = await tokenP;
      setNote(`<b>${icon('grid', 18)} 새 구글 시트를 만드는 중…</b><p>고른 피드백 ${stats().on}개를 반영한 2026 양식 큐시트를 내 드라이브에 만들고 있습니다.</p>`);
      const buf = await buildBuffer('submit');
      const file = await uploadAsSheet(accessToken, sheetTitle(), buf);
      state.made = { url: file.url, name: file.name, at: Date.now(), count: stats().on };
      state.gs.busy = false;
      save();
      const w = window.open(file.url, '_blank');
      if (w) w.opener = null;
      render();
      toast('새 구글 시트를 만들었습니다.');
    } catch (e) {
      console.error(e);
      setNote(`<b>새 구글 시트를 만들지 못했습니다.</b><p>${esc(e.message)}</p><p><button class="linkbtn" type="button" data-make>다시 시도</button> · <button class="linkbtn" type="button" id="b-import">엑셀을 받아 새 시트에 가져오기</button></p>`);
      const bi = $('#b-import', app);
      if (bi) bi.addEventListener('click', makeViaImport);
    } finally {
      setBusy(false);
    }
  })();
}

// 구글 로그인을 쓸 수 없을 때: 새 빈 시트 + 반영본 엑셀 내려받기 → '가져오기'
const newSheetUrl = () => `https://docs.google.com/spreadsheets/create?title=${encodeURIComponent(sheetTitle())}`;
async function makeViaImport() {
  const w = window.open(newSheetUrl(), '_blank'); // 클릭 안에서 바로 열어야 팝업 차단에 걸리지 않음
  if (w) w.opener = null;
  const file = await exportFile('submit', { quiet: true });
  if (!file) return setNote('<b>반영본 엑셀을 만들지 못했습니다.</b> 잠시 후 다시 눌러 주세요.');
  const openLink = `<a href="${esc(newSheetUrl())}" target="_blank" rel="noopener noreferrer">새 구글 시트 열기 ↗</a>`;
  setNote(`<b>${icon('check', 18)} ${w ? '새 구글 시트를 열고, ' : ''}피드백 반영본 엑셀을 내려받았습니다.</b>
    <ol>
      ${w ? '' : `<li>${openLink}</li>`}
      <li>새 시트에서 <b>파일 → 가져오기 → 업로드</b>를 누르고, 방금 받은 <b>${esc(file)}</b> 파일을 고릅니다.</li>
      <li>가져오기 위치를 <b>스프레드시트 바꾸기</b>로 두고 <b>데이터 가져오기</b>를 누릅니다.</li>
    </ol>
    <p>2026 2차 양식(열 너비 · 셀 색 · 글꼴 · 셀 병합)이 그대로 들어가고, 첨부한 원본 시트는 그대로입니다. <button class="linkbtn" type="button" id="b-redl">엑셀 다시 받기</button></p>`);
  const r = $('#b-redl', app);
  if (r) r.addEventListener('click', () => exportFile('submit'));
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

// ---------------- 페이지: AI 작성 (OpenAI) ----------------
// 학부 디렉터가 요구사항(자유 형식 프롬프트)과 참고 파일을 넣으면 AI가 2026 2차 양식으로
//  - 고치기: 첨부한 큐시트(지금 고른 피드백을 반영한 상태)에서 바꿀 칸 · 새 행 → 반영 / 반영 안 함을 골라 구글 시트로
//  - 새로 작성: 큐시트 전체 → '이 큐시트로 피드백 받기' → 피드백 · 반영 고르기 → 구글 시트로
// 요청은 /api/ai/start(접수) → 백그라운드 함수(OpenAI) → /api/ai/status(결과)로, 다른 화면을 봐도 계속 기다린다.
const AI_TIMEOUT = 16 * 60 * 1000;
const AI_EX = {
  edit: [
    ['주인공 동선 · 의상', '무대 2 주인공(흰 드레스)이 무대 왼쪽 계단에서 올라와 Pin3 자리에 서는 동선을 조명 Details에 넣어 주세요.'],
    ['후렴 조명', '각 무대의 후렴(절정)에서 무대 전체를 가장 밝게, 상단은 곡 분위기에 맞는 색 100%로 바꿔 주세요.'],
    ['행 나누기', '가사 슬라이드가 바뀌는 곳마다 행을 나누고 Run Time이 끊김 없이 이어지게 맞춰 주세요.'],
    ['마이크', '노래하는 구간에는 합창 마이크를, 솔로 · 주인공에는 무선 마이크를 넣고 무대 사이 마이크 이동은 FD 지시로 적어 주세요.'],
  ],
  create: [
    ['순서 · 인원', "우리 학부는 자체영상 1개(1분) → 무대 1 '[곡 제목]'(콰이어 24명) → 무대 2 '[곡 제목]'(댄서 16명 + 주인공 1명) 순서입니다."],
    ['기획안대로', '첨부한 기획안 문서의 순서와 내용대로 2026 2차 양식 큐시트를 작성해 주세요.'],
    ['가사 나누기', '첨부한 가사를 2줄씩 슬라이드로 나눠 개사 칸과 Run Time을 맞춰 주세요.'],
    ['조명 분위기', '무대 1은 차분하게(진파랑), 무대 2는 밝고 희망차게(하늘색), 마지막 후렴에서 가장 밝게 해 주세요.'],
  ],
};
const AI_PH = {
  edit: '예) 무대 2의 주인공(흰 드레스)이 무대 왼쪽 계단에서 올라와 Pin3 자리에 서는 동선을 조명 Details에 넣어 주세요.\n무대 1 후렴부터 상단 조명을 하늘색 100%로, 노래가 끝나면 즉시 암전으로 바꿔 주세요.\n첨부한 가사 파일대로 개사 칸을 2줄씩 나눠 주세요.',
  create: "예) 우리 학부는 자체영상 1개(1분) → 무대 1 '[곡 제목]'(콰이어 24명) → 무대 2 '[곡 제목]'(댄서 16명 + 주인공 1명) 순서입니다.\n무대 2 후렴에서 가장 밝게, 주인공은 흰 드레스를 입고 무대 왼쪽 계단에서 Pin3 자리로 걸어 나옵니다.\n가사는 첨부한 파일을 2줄씩 나눠 주세요.",
};
const aiMode = () => (state.result ? state.aiw.mode : 'create');
const renderIfWrite = () => parseRoute().name === 'write' && render();
const elapsedText = (t) => {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const RUN_STATE = { sending: '요청을 보내는 중', queued: '차례를 기다리는 중', running: 'AI가 작성하는 중' };
const binaryOf = (files) => files.reduce((n, f) => n + (f.error || f.reading ? 0 : f.bytes || 0), 0);

function setAIError(msg) {
  state.aiw.error = msg || '';
  saveAI();
  const el = $('#w-err', app);
  if (!el) return renderIfWrite();
  el.textContent = state.aiw.error;
  el.hidden = !state.aiw.error;
}

// ---- 첨부 파일 ----
function fileHtml(f, i) {
  const meta = f.reading ? '읽는 중…' : f.error ? f.error : [f.kind === 'text' ? `글자 ${Number(f.chars || 0).toLocaleString()}자` : sizeText(f.bytes || f.size || 0), f.note].filter(Boolean).join(' · ');
  return `<li class="${f.error ? 'err' : ''}${f.reading ? ' reading' : ''}"><span class="fi-k">${esc(f.label || '파일')}</span><span class="fi-n">${esc(f.name)}</span><span class="fi-m">${esc(meta)}</span><button type="button" class="fi-x" data-wfile="${i}" aria-label="${esc(f.name)} 빼기">×</button></li>`;
}
function filesBoxHtml() {
  const w = state.aiw;
  const bin = binaryOf(w.files);
  return `${w.files.length ? `<ul class="w-files">${w.files.map(fileHtml).join('')}</ul>` : ''}${bin > MAX_BINARY ? `<p class="status err">PDF · 이미지가 합계 ${sizeText(bin)}입니다 — 3.5MB 이하가 되도록 빼거나 줄여 주세요.</p>` : ''}`;
}
function redrawFiles() {
  const box = $('#w-files-box', app);
  if (box) box.innerHTML = filesBoxHtml();
}
async function addFiles(list) {
  const w = state.aiw;
  const files = [...(list || [])];
  if (!files.length) return;
  const room = MAX_FILES - w.files.length;
  if (room <= 0) return toast(`파일은 ${MAX_FILES}개까지 붙일 수 있습니다.`);
  if (files.length > room) toast(`파일은 ${MAX_FILES}개까지 — 앞의 ${room}개만 붙였습니다.`);
  const take = files.slice(0, room);
  const entries = take.map((f) => ({ name: f.name, label: labelFor(f.name), size: f.size, reading: true }));
  w.files.push(...entries);
  redrawFiles();
  await Promise.all(
    take.map(async (f, i) => {
      try {
        Object.assign(entries[i], await readAttachment(f, { ExcelJS: window.ExcelJS }), { reading: false });
      } catch (e) {
        Object.assign(entries[i], { reading: false, error: e.message || '파일을 읽지 못했습니다.' });
      }
    }),
  );
  redrawFiles();
}

// ---- 요청 · 결과 기다리기 ----
let pollT = null;
let tickT = null;
function stopTick() {
  clearInterval(tickT);
  tickT = null;
}
function startTick() {
  stopTick();
  tickT = setInterval(() => {
    const el = $('#w-elapsed', app);
    const r = state.aiw.run;
    if (!el || !r) return stopTick();
    el.textContent = elapsedText(r.startedAt);
    const st = $('#w-state', app);
    if (st) st.textContent = RUN_STATE[r.state] || RUN_STATE.running;
  }, 1000);
}

async function startAI() {
  const w = state.aiw;
  if (w.run) return;
  const mode = aiMode();
  const prompt = w.prompt.trim();
  if (w.files.some((f) => f.reading)) return setAIError('파일을 읽는 중입니다. 잠시 후 다시 눌러 주세요.');
  const files = w.files.filter((f) => !f.error);
  if (!prompt && !files.length) return setAIError('요구사항을 쓰거나 파일을 첨부해 주세요.');
  if (binaryOf(files) > MAX_BINARY) return setAIError(`PDF · 이미지가 합계 ${sizeText(binaryOf(files))}입니다. 3.5MB 이하로 줄여 주세요.`);
  const body = { mode, prompt, files: files.map(({ name, kind, text, data, mime }) => ({ name, kind, text, data, mime })) };
  if (mode === 'edit') {
    body.sheet = { name: state.name, rows: sheetForAI(state.output.S) };
    if (w.fixFindings) {
      body.fixFindings = true;
      body.findings = findingsForAI(state.result.findings.filter((f) => isTodo(f) && !chosen(f)));
    }
  }
  const r = { id: null, mode, prompt, files: files.map((f) => f.name), startedAt: Date.now(), sheetAt: state.source ? state.source.at : null, state: 'sending' };
  w.error = '';
  w.run = r;
  saveAI();
  render();
  try {
    const res = await fetch('/api/ai/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.id) {
      const msg = d.error || (res.status === 429 ? '요청이 많습니다. 1분 뒤 다시 시도해 주세요.' : res.status === 413 ? '요청이 너무 큽니다. 첨부 파일을 줄여 주세요.' : `AI 작업을 시작하지 못했습니다 (${res.status}).`);
      throw new Error(msg);
    }
    if (state.aiw.run !== r) {
      fetch(`/api/ai/status?id=${encodeURIComponent(d.id)}`, { method: 'DELETE' }).catch(() => {});
      return;
    }
    r.id = d.id;
    r.state = 'queued';
    saveAI();
    clearTimeout(pollT);
    pollT = setTimeout(pollAI, 2000);
  } catch (e) {
    if (state.aiw.run !== r) return;
    w.run = null;
    w.error = /fetch|network/i.test(e.message) ? '서버에 연결하지 못했습니다. 인터넷 연결을 확인해 주세요.' : e.message;
    saveAI();
    renderIfWrite();
  }
}

async function pollAI() {
  clearTimeout(pollT);
  const r = state.aiw.run;
  if (!r || !r.id) return;
  if (Date.now() - r.startedAt > AI_TIMEOUT) return finishAI(null, 'AI 응답이 너무 오래 걸려 멈췄습니다. 요청을 나눠서(예: 무대 하나씩) 다시 해 주세요.');
  let d = null;
  try {
    const res = await fetch(`/api/ai/status?id=${encodeURIComponent(r.id)}`, { cache: 'no-store' });
    d = await res.json().catch(() => null);
    if (state.aiw.run !== r) return;
    if (res.status === 404) return finishAI(null, (d && d.error) || '작업을 찾지 못했습니다. 다시 요청해 주세요.');
    if (!res.ok) d = null;
  } catch {
    d = null;
  }
  if (state.aiw.run !== r) return;
  if (d && d.state === 'done') return finishAI(d.result || {});
  if (d && d.state === 'error') return finishAI(null, d.error || 'AI 작업이 실패했습니다. 다시 시도해 주세요.');
  if (d && d.state) {
    r.state = d.state;
    r.fails = 0;
  } else r.fails = (r.fails || 0) + 1;
  if (r.fails > 8) return finishAI(null, '결과를 확인하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 요청해 주세요.');
  pollT = setTimeout(pollAI, 2500);
}

function finishAI(result, error) {
  const w = state.aiw;
  const r = w.run;
  if (!r) return;
  clearTimeout(pollT);
  stopTick();
  w.run = null;
  if (r.id) fetch(`/api/ai/status?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => {});
  const where = parseRoute().name;
  if (error) {
    w.error = error;
    saveAI();
    if (where !== 'write') toast(`AI 작성이 실패했습니다: ${error}`, 4200);
    return renderIfWrite();
  }
  const key = (r.id.split('-')[1] || r.id.slice(-8)).slice(0, 8);
  if (r.mode === 'create') {
    w.created = { id: key, prompt: r.prompt, files: r.files, at: Date.now(), model: result.model || '', title: result.title || 'AI 작성 큐시트', summary: result.summary || '', notes: result.notes || [], rows: result.rows || [] };
  } else {
    if (!state.result || r.stale || (r.sheetAt && state.source && state.source.at !== r.sheetAt)) {
      w.error = '요청한 뒤 다른 큐시트를 첨부해서 AI 결과를 넣지 못했습니다. 다시 요청해 주세요.';
      saveAI();
      return renderIfWrite();
    }
    const items = itemsFromEdit(result, state.output.S, key, r.prompt);
    w.items.push(...items);
    w.jobs.unshift({ id: key, prompt: r.prompt, files: r.files, at: Date.now(), model: result.model || '', summary: result.summary || '', notes: result.notes || [], count: items.length });
    recompute({ reanalyze: false });
  }
  w.prompt = '';
  w.error = '';
  save();
  toast(r.mode === 'create' ? 'AI가 큐시트를 작성했습니다.' : 'AI가 고친 내용이 도착했습니다. 반영할 것을 골라 주세요.', 3600);
  if (where === 'write' || where === 'result') render();
}

function cancelAI() {
  const r = state.aiw.run;
  if (!r) return;
  clearTimeout(pollT);
  stopTick();
  state.aiw.run = null;
  if (r.id) fetch(`/api/ai/status?id=${encodeURIComponent(r.id)}`, { method: 'DELETE' }).catch(() => {});
  saveAI();
  render();
  toast('AI 요청을 취소했습니다.');
}

// ---- 새로 작성한 큐시트 ----
let createdCache = null;
function createdModel() {
  const c = state.aiw.created;
  if (!c) return null;
  if (createdCache && createdCache.id === c.id && createdCache.at === c.at) return createdCache.model;
  const model = parseGrid(gridFromRows(c.rows, c.title));
  annotateKinds(model);
  markAIPlaceholders(model);
  createdCache = { id: c.id, at: c.at, model };
  return model;
}
function loadCreated() {
  const c = state.aiw.created;
  if (!c) return;
  try {
    loadGrid(gridFromRows(c.rows, c.title), c.title, { kind: 'ai', title: c.title, job: c.id });
    toast('AI가 작성한 큐시트로 피드백을 받았습니다.');
  } catch (e) {
    setAIError(e.message);
  }
}
function createdHtml() {
  const c = state.aiw.created;
  if (!c) return '';
  const model = createdModel();
  const loaded = !!(state.source && state.source.kind === 'ai' && state.source.job === c.id);
  const files = c.files && c.files.length ? ` <span class="muted">· 첨부 ${esc(c.files.join(', '))}</span>` : '';
  return `<section class="card w-result w-created" id="w-created">
    <div class="w-rh"><span class="pill ai">${icon('sparkle', 14)} AI가 새로 쓴 큐시트</span><span class="muted">${esc(timeOf(c.at))} · ${model.rows.length}행</span><button class="linkbtn" type="button" data-reuse="${esc(c.id)}">요구사항 다시 쓰기</button></div>
    <h2>${esc(c.title)}</h2>
    <p class="w-q"><q>${esc(clip(c.prompt || '(첨부 파일대로)', 240))}</q>${files}</p>
    ${c.summary ? `<p class="w-sum">${esc(c.summary)}</p>` : ''}
    ${notesHtml(c.notes)}
    <div class="sheet-card w-sheet"><div class="grid-wrap">${sheetHtml(model, {})}</div></div>
    <p class="w-hint">붉은 칸의 [ ] 안은 AI가 모르는 내용이라 자리만 잡아 둔 곳입니다. 피드백을 받으면 2026 기준으로 한 번 더 점검하고, 받은 구글 시트에서도 붉은 칸으로 표시되니 실제 내용으로 바꿔 적어 주세요.</p>
    <div class="w-acts">${loaded ? `<a class="btn primary" href="#/result">${icon('check', 18)} 피드백 결과로 가기</a><span class="pill ok">피드백 받는 중인 큐시트</span>` : `<button class="btn primary" type="button" id="w-load">${icon('check', 18)} 이 큐시트로 피드백 받기</button>`}<button class="btn ghost" type="button" id="w-forget">지우기</button></div>
    ${!loaded && state.result ? `<p class="muted w-warn">피드백을 받으면 지금 첨부한 '${esc(state.name)}' 대신 이 큐시트로 바뀝니다(원래 시트는 그대로).</p>` : ''}
  </section>`;
}

// ---- 고친 내용 ----
function editResultsHtml() {
  if (!state.aiw.jobs.length || !state.result) return '';
  return `<div class="w-results" id="w-results">
    <div class="w-res-head">
      <h2 class="sec-title">${icon('check', 20)} AI가 고친 내용 <small>항목마다 반영 / 반영 안 함을 고르면, 고른 피드백과 함께 새 구글 시트에 들어갑니다</small></h2>
      <div class="w-acts"><button class="btn primary" type="button" data-make ${state.gs.busy ? 'disabled' : ''}>${icon('grid', 18)} ${makeLabel()}</button><a class="btn" href="#/result">${icon('list', 18)} 피드백과 함께 보기</a><a class="btn" href="#/sheet">미리보기</a></div>
      <div class="make-note" id="make-note" role="status" ${state.made ? '' : 'hidden'}>${madeHtml()}</div>
    </div>
    ${aiJobsHtml()}
  </div>`;
}

function progressHtml() {
  const r = state.aiw.run;
  if (!r) return '';
  return `<div class="w-progress" role="status"><span class="spin" aria-hidden="true"></span><div class="w-p-t"><b>${r.mode === 'edit' ? 'AI가 큐시트를 고치는 중…' : 'AI가 큐시트를 쓰는 중…'}</b><span><span id="w-state">${esc(RUN_STATE[r.state] || RUN_STATE.running)}</span> · <span id="w-elapsed">${elapsedText(r.startedAt)}</span></span><small>보통 1~3분, 파일이 많으면 더 걸립니다. 다른 화면을 보고 와도 결과를 기다립니다.</small></div><button class="btn small ghost" type="button" id="w-cancel">취소</button></div>`;
}

function pageWrite() {
  const w = state.aiw;
  const hasSheet = !!state.result;
  const mode = aiMode();
  const off = w.enabled === false;
  const running = !!w.run;
  const todoLeft = hasSheet ? state.result.findings.filter((f) => isTodo(f) && !chosen(f)).length : 0;
  const target =
    mode === 'edit'
      ? `고칠 큐시트 <b>${esc(state.name)}</b> <span class="muted">· ${state.output.S.rows.length}행 · 지금 고른 피드백을 반영한 상태에서 고칩니다</span> <a href="#/result">피드백 결과</a>`
      : hasSheet
        ? 'AI가 2026 2차 양식으로 새 큐시트를 처음부터 씁니다. 지금 첨부한 큐시트는 그대로 둡니다.'
        : 'AI가 2026 2차 양식으로 새 큐시트를 처음부터 씁니다. 이미 쓴 큐시트를 고치려면 먼저 <a href="#/">큐시트 링크를 첨부</a>하세요.';
  app.innerHTML = `<section class="page write">
    <span class="eyebrow">${icon('sparkle', 15)} AI 큐시트 작성 · OpenAI</span>
    <h1 class="page-title">원하는 큐시트를 말로 설명하세요</h1>
    <p class="page-sub">요구사항을 자유롭게 쓰고 기획안 · 가사 · 콘티 같은 파일을 붙이면, AI가 2026 2차 양식에 맞춰 큐시트를 고치거나 새로 씁니다. 결과는 피드백처럼 <b>반영 / 반영 안 함</b>을 고른 뒤 새 구글 시트로 받습니다.</p>
    ${off ? `<div class="w-off" role="note">${icon('chat', 18)}<div><b>AI 기능이 아직 켜져 있지 않습니다.</b><p>사이트 관리자가 Netlify AI Gateway를 쓰거나 환경 변수 OPENAI_API_KEY를 넣으면 사용할 수 있습니다. 그동안은 <a href="#/">큐시트 링크로 피드백 받기</a>를 이용해 주세요.</p></div></div>` : ''}
    <div class="card w-form">
      <div class="w-step"><span class="g-no">1</span><b>무엇을 할까요?</b></div>
      <div class="seg w-mode" role="group" aria-label="작업 종류">
        <button type="button" data-wmode="edit" class="${mode === 'edit' ? 'active' : ''}" aria-pressed="${mode === 'edit'}" ${hasSheet ? '' : 'disabled title="먼저 큐시트 링크를 첨부하세요"'}>첨부한 큐시트 고치기</button>
        <button type="button" data-wmode="create" class="${mode === 'create' ? 'active' : ''}" aria-pressed="${mode === 'create'}">새 큐시트 작성</button>
      </div>
      <p class="w-target">${target}</p>
      <div class="w-step"><span class="g-no">2</span><label for="w-prompt"><b>요구사항</b></label><small>자유 형식 — 문장 · 목록 · 표를 붙여넣어도 됩니다</small></div>
      <textarea id="w-prompt" class="w-prompt" rows="8" maxlength="8000" placeholder="${esc(AI_PH[mode])}">${esc(w.prompt)}</textarea>
      <div class="w-under"><div class="w-chips">${AI_EX[mode].map(([k, t], i) => `<button type="button" class="chip" data-wex="${i}" title="${esc(t)}">+ ${esc(k)}</button>`).join('')}</div><span class="w-count" id="w-count">${w.prompt.length.toLocaleString()} / 8,000</span></div>
      <div class="w-step"><span class="g-no">3</span><b>참고 파일</b> <small>선택 · 최대 ${MAX_FILES}개</small></div>
      <div class="drop" id="w-drop" tabindex="0" role="button" aria-label="참고 파일 고르기"><input type="file" id="w-file" multiple accept="${esc(ACCEPT)}" hidden>${icon('download', 22)}<span><b>파일을 끌어다 놓거나 눌러서 고르기</b><small>텍스트 · 워드(.docx) · 한글(.hwpx) · PDF · 파워포인트(.pptx) · 엑셀 · 이미지(콘티 · 동선도) — PDF · 이미지는 합계 3.5MB까지</small></span></div>
      <div id="w-files-box">${filesBoxHtml()}</div>
      ${mode === 'edit' && todoLeft ? `<label class="switch w-fix"><input type="checkbox" id="w-fix" ${w.fixFindings ? 'checked' : ''}><span>아직 반영하지 않은 수정요망 ${todoLeft}개도 AI가 함께 고치기</span></label>` : ''}
      <p class="w-privacy">${icon('chat', 15)} 요구사항 · 첨부 파일${mode === 'edit' ? ' · 큐시트 내용' : ''}이 OpenAI${w.model ? `(${esc(w.model)})` : ''}로 전송됩니다. 연락처 같은 개인정보는 넣지 마세요. 서버에 잠시 둔 요청은 결과를 받으면 지웁니다.</p>
      <div class="w-go">
        <button class="btn primary big" type="button" id="w-run" ${running || off ? 'disabled' : ''}>${icon('sparkle', 18)} ${mode === 'edit' ? 'AI에게 고쳐 달라고 요청' : 'AI에게 큐시트 작성 요청'}</button>
        <p class="status err" id="w-err" role="alert" ${w.error ? '' : 'hidden'}>${esc(w.error)}</p>
      </div>
      ${progressHtml()}
    </div>
    ${createdHtml()}
    ${editResultsHtml()}
    ${state.result && w.items.length ? barHtml() : ''}
  </section>`;
  bindWrite();
}

function bindWrite() {
  const root = $('.write', app);
  const ta = $('#w-prompt', app);
  let saveT = null;
  ta.addEventListener('input', () => {
    state.aiw.prompt = ta.value;
    $('#w-count', app).textContent = `${ta.value.length.toLocaleString()} / 8,000`;
    clearTimeout(saveT);
    saveT = setTimeout(saveAI, 400);
  });
  const input = $('#w-file', app);
  input.addEventListener('change', () => {
    addFiles(input.files);
    input.value = '';
  });
  const drop = $('#w-drop', app);
  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      input.click();
    }
  });
  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('over');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('over');
    addFiles(e.dataTransfer && e.dataTransfer.files);
  });
  const fix = $('#w-fix', app);
  if (fix)
    fix.addEventListener('change', () => {
      state.aiw.fixFindings = fix.checked;
      saveAI();
    });
  root.addEventListener('click', (e) => {
    const m = e.target.closest('[data-wmode]');
    if (m) {
      if (m.disabled) return;
      state.aiw.mode = m.dataset.wmode;
      saveAI();
      return render();
    }
    const ex = e.target.closest('[data-wex]');
    if (ex) {
      const t = AI_EX[aiMode()][Number(ex.dataset.wex)][1];
      const cur = state.aiw.prompt.replace(/\s+$/, '');
      state.aiw.prompt = cur ? `${cur}\n${t}` : t;
      ta.value = state.aiw.prompt;
      $('#w-count', app).textContent = `${ta.value.length.toLocaleString()} / 8,000`;
      saveAI();
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
      return;
    }
    const fx = e.target.closest('[data-wfile]');
    if (fx) {
      state.aiw.files.splice(Number(fx.dataset.wfile), 1);
      return redrawFiles();
    }
    if (e.target.closest('#w-run')) return startAI();
    if (e.target.closest('#w-cancel')) return cancelAI();
    if (e.target.closest('#w-load')) return loadCreated();
    if (e.target.closest('#w-forget')) {
      state.aiw.created = null;
      saveAI();
      return render();
    }
    pickClick(e);
  });
  if (state.aiw.run) startTick();
}

// ---------------- 라우터 ----------------
// 상단 메뉴는 홈 · AI 작성 · 가이드. 피드백 결과는 메뉴가 아니라 큐시트를 첨부한 다음 단계로만 나옴
function renderNav(route) {
  $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === route.top));
}

function parseRoute() {
  const h = (location.hash || '#/').replace(/^#\/?/, '');
  const [a, b] = h.split('/');
  if (!a) return { name: 'home', top: 'home' };
  if (a === 'result') return { name: 'result', top: '' };
  // 예전 주소(#/check, #/check/항목, #/report, #/download)는 결과 화면으로
  if (a === 'check' || a === 'report' || a === 'download') return { name: 'legacy', id: a === 'check' ? b : null, top: '' };
  if (a === 'sheet') return { name: 'sheet', top: '' };
  if (a === 'write') return { name: 'write', top: 'write' };
  if (a === 'ai') return { name: 'legacy-ai', top: 'write' }; // 예전 'AI 대안' 주소
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
  if (route.name === 'legacy-ai') return location.replace('#/write');
  const key = `${route.name}/${route.id || ''}`;
  if (route.name !== 'write') stopTick();
  const sameRoute = key === lastRouteKey;
  const y = window.scrollY;
  const grid = $('.grid-wrap', app);
  const gs = grid ? { t: grid.scrollTop, l: grid.scrollLeft } : null;
  $('#tip').hidden = true;
  renderNav(route);
  document.body.classList.toggle('has-getbar', !!state.result && (route.name === 'result' || (route.name === 'write' && state.aiw.items.length > 0)));
  if (route.name === 'home') pageHome();
  else if (route.name === 'result') pageResult();
  else if (route.name === 'sheet') pageSheet();
  else if (route.name === 'write') pageWrite();
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

// ---------------- 미리보기 툴팁 (위임) ----------------
function initDelegates() {
  const tip = $('#tip');
  const titleOf = (id) => {
    const f = id && findingById(id);
    return f ? `${f.source === 'ai' ? '[AI 작성] ' : ''}${f.title}` : '';
  };
  document.addEventListener('mouseover', (e) => {
    const td = e.target.closest && e.target.closest('#app td[data-key]');
    if (!td || !state.result || !state.output || state.sheetView === 'original' || parseRoute().name !== 'sheet') return (tip.hidden = true);
    const row = state.output.S.rows.find((r) => r.id === td.dataset.row);
    if (!row) return (tip.hidden = true);
    const k = td.dataset.key;
    const m = row.marks && row.marks[k];
    const orig = state.originalMap.get(row.id);
    const parts = [];
    if (m && m.by) parts.push(`<b>반영한 피드백</b> ${esc(titleOf(m.by))}`);
    else if (m && m.reasons && m.reasons.length) parts.push(`<b>자동 정리</b> ${esc(m.reasons.join(', '))}`);
    if (td.classList.contains('changed') || (m && (m.changed || m.placeholder))) parts.push(`<span class="before">원래: ${esc((orig ? (orig.cont[k] ? '(위 칸과 병합)' : orig.c[k]) : '(새 행)') || '(빈칸)').slice(0, 220)}</span>`);
    for (const f of state.result.findings.filter((x) => x.rowId === row.id && x.key === k && isTodo(x) && !chosen(x)).slice(0, 2)) parts.push(`• ${esc(f.title)}`);
    if (!parts.length) return (tip.hidden = true);
    tip.innerHTML = parts.join('\n');
    tip.hidden = false;
    const r = td.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - 360, r.left))}px`;
    tip.style.top = `${r.bottom + 8 + 140 > window.innerHeight ? Math.max(8, r.top - 8 - tip.offsetHeight) : r.bottom + 8}px`;
  });
  document.addEventListener('scroll', () => (tip.hidden = true), true);
}

// 사이트 설정: 구글 로그인 · AI 작성(OpenAI) 사용 여부
async function loadConfig() {
  const cfg = await fetch('/api/config')
    .then((r) => (r.ok ? r.json() : {}))
    .catch(() => ({}));
  state.gs.clientId = (cfg && cfg.googleClientId) || '';
  state.aiw.enabled = !!(cfg && cfg.ai && cfg.ai.enabled);
  state.aiw.model = (cfg && cfg.ai && cfg.ai.model) || '';
}

restore();
initDelegates();
window.addEventListener('hashchange', render);
render();
if (state.aiw.run && state.aiw.run.id) pollAI(); // 새로 고치기 전에 보낸 AI 요청을 이어서 기다림
loadConfig().then(() => {
  if (state.gs.clientId) loadGis().catch(() => {});
  // AI 작성 화면이면 사용 가능 여부(안내)를 다시 그림
  if (parseRoute().name === 'write') render();
});

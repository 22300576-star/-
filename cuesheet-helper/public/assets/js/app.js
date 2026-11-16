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
  ai: { enabled: false, items: [], running: false, accepted: new Map() },
  sheets: null,
};
const STORE = 'hanflix-cuesheet-v2';

function save() {
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

const aiExtra = () => [...state.ai.accepted.values()].map((s) => ({ id: s.id, ops: [{ rowId: s.rowId, key: s.key, set: s.text }] }));
// 자동 정리를 켜고 끄면 다시 분석, 고르기만 바꾸면 반영본만 다시 만든다
function recompute({ reanalyze = true } = {}) {
  if (reanalyze || !state.result) state.result = analyze(state.original, { disabled: state.disabled, fx: state.fx });
  state.output = buildOutput(state.result, state.choice, state.edits, aiExtra());
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
  state.ai.items = [];
  state.ai.accepted = new Map();
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
const findingById = (id) => state.result.findings.find((x) => x.id === id) || allActions().find((a) => a.id === id);
const allActions = () => (state.result.advice || []).flatMap((a) => a.actions || []);
const chosen = (item) => isChosen(item, state.choice);
const stats = () => choiceStats(state.result, state.choice);

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
  const items = choiceItems(state.result).filter((i) => !pageId || (i.advice ? i.cat === pageId : pageOf(i) === pageId));
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
  if (f.after == null) return `<div class="how">${esc(f.suggestion ? `→ ${f.suggestion}` : firstSentence(f.msg))}</div>`;
  const before = f.before ? `<span class="v b">${esc(clip(f.before, 34))}</span>` : '<span class="v b empty">빈칸</span>';
  return `<div class="ba-mini"><span class="k">원래</span>${before}<span class="arr">→</span><span class="k a">수정 후</span><span class="v">${markEx(clip(afterOf(f), 64))}</span></div>`;
}
// 펼친 카드: 원래 | 수정 후 두 칸
function baHtml(f) {
  if (f.after == null) return '';
  const edited = state.edits.has(f.id);
  const kind = edited ? '고친 문구' : AFTER_LABEL[f.afterKind] || '';
  const pill = f.apply === 'auto' ? 'ok' : f.afterKind === 'guide' ? '' : 'info';
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
  const cls = ['issue', isTodo(f) ? 'error' : 'note', pickable ? (on ? 'is-on' : 'is-off') : 'is-manual', open ? 'open' : ''].join(' ');
  return `<div class="${cls}" data-id="${esc(f.id)}">
    <div class="issue-top"><div class="t"><b>${esc(f.title)}</b><div class="loc">${esc(locText(f))}</div>${baMini(f)}</div>${choiceHtml(f)}${icon('chevron', 20).replace('class="ic"', 'class="ic chev"')}</div>
    <div class="issue-body"><p>${esc(f.msg)}</p>${baHtml(f)}${editHtml(f)}${conflictHtml(f)}${f.apply === 'manual' ? `<p class="manual">${icon('pencil', 15)} ${esc(f.manual || '받은 시트에서 직접 고쳐 주세요.')}</p>` : ''}${f.why ? `<div class="why">근거 · ${esc(f.why)}</div>` : ''}</div>
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

// 어떤 큐시트를 첨부했는지: 구글 시트 제목 › 탭 (시트 열기) · 행 수 · 첨부 시각
function sourceHtml() {
  const s = state.source;
  if (!s) return esc(state.name);
  const what = s.kind === 'paste' ? '복사해서 붙여넣은 표' : ['구글 시트', s.title ? `'${esc(s.title)}'` : '', s.tab ? `› ${esc(s.tab)} 탭` : ''].filter(Boolean).join(' ');
  const time = s.at ? new Date(s.at).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
  const extra = [s.note, s.rows ? `${s.rows}행` : '', time ? `${time} 첨부` : '', '원본은 바꾸지 않음'].filter(Boolean).join(' · ');
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
    <p class="get-lead">반영하기로 고른 <b>${st.on}개</b> 항목(자동 정리 ${st.auto} · 직접 고른 ${st.picked})이 들어간 큐시트를 <b>내 구글 드라이브에 새 구글 시트</b>로 만듭니다. 2026 2차 양식(열 너비 · 셀 색 · 글꼴 · 병합)이 그대로 들어가고, 첨부한 원본 시트는 바뀌지 않습니다.${st.manual ? ` '직접 고치기' ${st.manual}개는 받은 시트에서 고쳐 주세요.` : ''}</p>
    <label class="switch"><input type="checkbox" id="o-hl" ${state.highlight ? 'checked' : ''}><span>반영으로 바뀐 칸을 노란색으로 표시</span></label>
    <div class="res-actions">
      <button class="btn primary" type="button" data-make ${state.gs.busy ? 'disabled' : ''}>${icon('grid', 18)} ${makeLabel()}</button>
      <a class="btn" href="#/sheet">${icon('list', 18)} 미리보기</a>
      <button class="btn" type="button" id="d-submit">${icon('download', 18)} 엑셀 파일로 받기</button>
      <button class="btn" type="button" id="d-review">${icon('list', 18)} 검토용 엑셀</button>
      <button class="btn" type="button" id="d-msg">${icon('chat', 18)} 피드백 메시지 복사</button>
      ${state.ai.enabled ? `<a class="btn ghost" href="#/ai">${icon('sparkle', 18)} AI 대안</a>` : ''}
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
      <div class="res-top"><span class="eyebrow">피드백 결과</span><a class="btn small" href="#/">${icon('link', 16)} 다른 큐시트 첨부</a></div>
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
    ${getPanelHtml()}
    <details class="more"><summary>큐시트 1행 TFT 피드백 문구 고치기 (검토용 엑셀)</summary><textarea id="fb-text">${esc(state.fbText ?? summary.feedbackText)}</textarea></details>
    ${barHtml()}
  </section>`;
  bindResult();
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
    const make = e.target.closest('[data-make]');
    if (make) return makeSheet();
    const bulk = e.target.closest('[data-bulk]');
    if (bulk) return bulkChoose(bulk.dataset.bulk, bulk.dataset.page || null);
    const pick = e.target.closest('[data-choose],[data-fix]');
    if (pick && pick.tagName === 'BUTTON') {
      const on = pick.dataset.v === '1';
      if (pick.dataset.fix) {
        const f = state.result.findings.find((x) => x.fixId === pick.dataset.fix && x.apply === 'auto');
        return f && setChoice(f.id, on);
      }
      return setChoice(pick.dataset.choose, on);
    }
    const head = e.target.closest('.sec-head');
    if (head) {
      const id = head.closest('.sec').dataset.sec;
      if (state.openSecs.has(id)) state.openSecs.delete(id);
      else state.openSecs.add(id);
      return redrawSec(id);
    }
    const card = e.target.closest('.issue');
    const fid = card && card.dataset.id;
    if (e.target.closest('[data-edit-open]')) {
      state.editing = fid;
      return redrawSec(pageOf(findingById(fid)));
    }
    if (e.target.closest('[data-edit-cancel]')) {
      state.editing = null;
      return redrawSec(pageOf(findingById(fid)));
    }
    if (e.target.closest('[data-edit-reset]')) {
      state.edits.delete(fid);
      state.editing = null;
      return run(true, { reanalyze: false });
    }
    if (e.target.closest('[data-edit-save]')) {
      const ta = card.querySelector('[data-edit-text]');
      state.edits.set(fid, ta.value.replace(/\r/g, '').replace(/\n+$/, ''));
      state.choice.set(fid, true);
      state.editing = null;
      run(true, { reanalyze: false });
      return toast('고친 문구로 반영하도록 골랐습니다.');
    }
    const top = e.target.closest('.issue-top');
    if (top && !e.target.closest('.choice')) {
      if (state.open.has(fid)) state.open.delete(fid);
      else state.open.add(fid);
      return card.classList.toggle('open');
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
    findings: state.result.findings,
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

// ---------------- 페이지: AI 대안 (선택) ----------------
function pageAI() {
  if (needResult()) return;
  const items = state.ai.items;
  app.innerHTML = `<section class="page">
    <a class="back" href="#/result">${icon('left', 18)} 반영할 피드백 고르기</a>
    <h1 class="page-title">AI 대안 <span class="pill info">베타</span></h1>
    <p class="page-sub">무대마다 문장·조명 대안을 받아 골라서 반영합니다. 반영한 대안은 피드백 반영본(구글 시트)에 함께 들어갑니다. 큐시트 내용이 Anthropic Claude API로 전송됩니다.</p>
    <button class="btn primary" id="b-ai" ${state.ai.running ? 'disabled' : ''}>${icon('sparkle', 18)} ${state.ai.running ? '받는 중…' : items.length ? '다시 받기' : '대안 받기'}</button>
    <div class="status" id="ai-status"></div>
    <div class="issues" style="margin-top:14px">${items
      .map((s, i) => {
        const on = state.ai.accepted.has(s.id);
        return `<div class="issue note open ${on ? 'is-on' : 'is-off'}"><div class="issue-top"><div class="t"><b>${esc(s.block)} · ${esc(colName(s.key))}</b><div class="how">${esc(s.reason || '')}</div></div></div>
        <div class="issue-body">${s.old ? `<p class="muted" style="text-decoration:line-through">${esc(s.old)}</p>` : ''}<div class="example">${esc(s.text)}</div>
        <div class="choice" style="margin-top:10px"><button type="button" data-ai="${i}" data-v="1" class="${on ? 'on' : ''}">${icon('check', 15)} 반영</button><button type="button" data-ai="${i}" data-v="0" class="${on ? '' : 'on'}">반영 안 함</button></div></div></div>`;
      })
      .join('')}</div>
  </section>`;
  $('#b-ai').addEventListener('click', runAI);
  $$('[data-ai]', app).forEach((b) =>
    b.addEventListener('click', () => {
      const s = items[Number(b.dataset.ai)];
      if (b.dataset.v === '1') state.ai.accepted.set(s.id, s);
      else state.ai.accepted.delete(s.id);
      run(false, { reanalyze: false });
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
        state.ai.items.push({ ...s, id: `ai:${s.rowId}:${s.key}:${state.ai.items.length}`, block: label, old: row ? row.c[s.key] : '' });
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
// 상단 메뉴는 홈 · 가이드만. 피드백 결과는 메뉴가 아니라 큐시트를 첨부한 다음 단계로만 나옴
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
  if (a === 'ai') return { name: 'ai', top: '' };
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
  document.body.classList.toggle('has-getbar', route.name === 'result' && !!state.result);
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

// ---------------- 미리보기 툴팁 (위임) ----------------
function initDelegates() {
  const tip = $('#tip');
  const titleOf = (id) => {
    const f = id && findingById(id);
    return f ? f.title : id && id.startsWith('ai:') ? 'AI 대안' : '';
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

// 사이트 설정(구글 로그인)과 AI 대안 사용 여부
async function loadConfig() {
  const [cfg, ai] = await Promise.all([
    fetch('/api/config')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
    fetch('/api/ai-review')
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({})),
  ]);
  state.gs.clientId = (cfg && cfg.googleClientId) || '';
  state.ai.enabled = !!(ai && ai.enabled);
}

restore();
initDelegates();
window.addEventListener('hashchange', render);
render();
loadConfig().then(() => {
  if (state.gs.clientId) loadGis().catch(() => {});
  // AI가 켜져 있으면 결과 화면에 'AI 대안' 버튼을 보여줌
  if (state.ai.enabled && parseRoute().name === 'result') render();
});

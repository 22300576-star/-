// 총평과 수정 방향
// 항목별 피드백을 학부 디렉터가 한눈에 이해할 수 있도록 짧은 글로 묶는다.
//  - lead: 큐시트 구성 · 무대 시간 · 잘한 점 · 고칠 곳 요약
//  - directions: 무엇을 어떻게 고칠지 (11분 초과 → 수정요망 큰 것부터, 같은 종류는 한 줄로 묶고 위치를 붙임)
//  - autoNote: 자동으로 고쳐 수정본에 이미 반영한 것
import { fmtDurationKo } from './time.js';
import { josa } from './josa.js';
import { STAGE_LIMIT_SEC } from './constants.js';

// 결과 화면의 항목 묶음과 같다
export const ITEMS = [
  { id: 'time', name: 'Run Time', cats: ['time'] },
  { id: 'stage', name: '무대 · 인원', cats: ['stage'] },
  { id: 'detail', name: '세부 내용', cats: ['detail'] },
  { id: 'lyrics', name: '개사', cats: ['lyrics'] },
  { id: 'sound', name: '음향 · FD', cats: ['sound'] },
  { id: 'screen', name: '화면', cats: ['screen'] },
  { id: 'light', name: '조명', cats: ['light', 'fx'] },
  { id: 'form', name: '양식', cats: ['form'] },
];
const itemIndex = (id) => ITEMS.findIndex((it) => it.id === id);
export const itemOf = (f) => (ITEMS.find((it) => it.cats.includes(f.cat)) || ITEMS[ITEMS.length - 1]).id;
const itemName = (id) => (ITEMS[itemIndex(id)] || ITEMS[ITEMS.length - 1]).name;

// 피드백 종류(제목) → 수정 방향 한 줄
const ACTIONS = [
  [/분 초과/, (c) => `무대 시간을 ${c.over} 줄여 11분 안으로 맞추기`],
  [/한 곡을 한 행으로만|단시가 나뉘지 않은/, () => '한 곡을 한 행에 몰아 쓰지 말고, 가사·대형·조명이 바뀌는 지점마다 행을 나눠 Run Time 적기'],
  [/Run Time 없음/, () => "비어 있는 Run Time을 '00:00 ~ 00:04 (4초)' 형식으로 채우기"],
  [/초 겹침/, () => '앞 행이 끝나는 시각과 다음 행이 시작하는 시각이 겹치지 않게 맞추기'],
  [/다시 시작함/, () => '무대마다 00:00부터 다시 세지 말고, 인트로 영상 이후 00:00부터 이어서 적기'],
  [/기준 시점 통일/, () => '인트로 영상이 끝난 시점을 00:00으로 잡아 이어서 적기'],
  [/길이만 적혀/, () => "길이만 적지 말고 '시작 ~ 끝 (n초)' 형식으로 적기"],
  [/계산이 맞지 않음/, () => '단시(n초)가 시작~끝 시각과 맞는지 다시 계산하기'],
  [/무대 칸이 비어/, () => '무대 칸에 무대·단상 위 인원과 위치 적기'],
  [/대기 인원 칸이 비어/, () => '대기 인원 칸을 숫자로 채우기 (없으면 X)'],
  [/세부 내용(이)? ?(빈칸|비어)/, () => "비어 있는 세부 내용을 '언제·어디서·누가(몇 명)·무엇을·어떻게'로 채우기"],
  [/세부 내용이 구체적이지 않/, () => "짧게 적은 세부 내용을 '언제·어디서·누가·무엇을·어떻게'가 드러나게 구체적으로 쓰기"],
  [/개사 내용 빈칸/, () => "개사 칸 채우기 (가사가 없으면 '간주' 또는 X)"],
  [/가사가 너무 많음/, () => '가사가 많은 행은 슬라이드 단위로 나눠 Run Time에 맞추기'],
  [/음향 장비가 적혀 있지 않/, () => '음향/FD 칸에 쓰는 장비(마이크 종류·개수) 적기'],
  [/마이크 개수가 없음/, () => '마이크는 종류와 개수까지 적기 (예: 합창 마이크 4개)'],
  [/화면\(영상\) 칸이 비어/, () => '화면 칸에 띄울 영상·PPT 적기 (없으면 X)'],
  [/조명 전체 미작성/, () => '조명 칸 전체를 2026 조명 가이드 형식으로 작성하기'],
  [/조명 미작성/, () => '비어 있는 조명 칸 채우기 (끄면 X)'],
  [/조명 시간이 Run Time과 맞지 않/, () => '조명 시각을 그 행의 Run Time에 맞추기'],
  [/Run Time 밖에 있는 조명 시간/, () => '조명 시각이 그 행의 Run Time 안에 들어가게 맞추기'],
  [/색상 지정 — 핀조명/, () => '핀조명(Pin1~4)에는 색을 적지 말고 ON/X만 적기 — 색은 무대·상단 조명으로'],
  [/한 칸에 몰려/, () => '한 칸에 몰아 쓴 조명 지시를 무대·상단·Pin·Details 칸으로 나누기'],
  [/가로로 병합/, () => '가로로 합친 조명 칸을 칸마다 나눠 쓰기'],
  [/여러 행에 걸쳐 병합/, () => '여러 행에 걸쳐 합친 조명 칸을 행마다 나눠 쓰기'],
  [/조명-(무대|상단) 칸 형식/, () => "무대·상단 조명은 '구역 / 색상 / 밝기%' 형식으로 쓰기"],
  [/Details가 (비어|빈)/, () => '조명이 바뀌는 행은 Details에 바뀌는 시점과 방법 적기'],
  [/따라가도록/, () => '핀은 위치가 고정이라 사람을 따라갈 수 없으니, 사람이 핀 자리로 이동하게 쓰기'],
  [/여러 명을 비춤/, () => '핀은 1명용이니 여러 명은 무대 조명으로 비추기'],
  [/핀 위치와 맞지 않/, () => '핀이 실제로 비추는 고정 위치에 맞게 고치기'],
  [/FX 효과가 \d+종류/, () => '쓸 효과를 2개만 골라 FX1·FX2로 적기'],
  [/어떤 효과인지 적혀 있지 않/, () => 'FX1·FX2가 어떤 효과인지 Details에 적기'],
  [/FX로 지정하지 않/, () => '스트로브·고보·무빙 같은 효과는 FX1·FX2로 지정하기'],
  [/스트로브를 오래/, () => '스트로브는 1~3초로 짧게 쓰기'],
  [/양식에 없는 열/, () => '2026 양식에 없는 열은 지우고 양식 그대로 쓰기'],
];

const firstSentence = (s) => (String(s || '').match(/^.*?[.!?다요](?=\s|$)/) || [String(s || '')])[0];
// '빈 조명 칸 20곳 채움 (X 16 · 유지 4)' → '빈 조명 칸 채움'
const plainTitle = (t) => String(t).replace(/\s*\([^)]*\)/g, '').replace(/\s*\d+곳/g, '').replace(/\s+/g, ' ').trim();

function actionFor(f, c) {
  const hit = ACTIONS.find(([re]) => re.test(f.title));
  if (hit) return hit[1](c);
  return f.suggestion ? String(f.suggestion).replace(/^예\)\s*/, '예: ') : firstSentence(f.msg) || f.title;
}

function placesOf(S, f) {
  const ids = f.rows && f.rows.length ? f.rows : f.rowId ? [f.rowId] : [];
  const out = [];
  for (const id of ids) {
    const row = S.rows.find((r) => r.id === id);
    const b = row && S.blocks[row.blockIndex];
    const label = b && (b.item || '').split('\n')[0].trim();
    if (label && !out.includes(label)) out.push(label);
  }
  return out;
}

export function buildOverview(S, findings, { totalSec = 0, autoCells = 0 } = {}) {
  const todo = findings.filter((f) => f.level === 'error' || f.level === 'warn');
  const over = totalSec > STAGE_LIMIT_SEC ? totalSec - STAGE_LIMIT_SEC : 0;
  const c = { over: over ? fmtDurationKo(over) : '' };

  // 수정 방향: (항목, 고칠 방법)이 같으면 한 줄로 묶고 위치를 모은다
  const dirs = new Map();
  for (const f of todo) {
    const item = itemOf(f);
    const action = actionFor(f, c);
    const key = `${item}|${action}`;
    const d = dirs.get(key) || { item, action, error: false, fixed: true, n: 0, places: [] };
    d.error = d.error || f.level === 'error';
    d.fixed = d.fixed && !!(f.fixId && f.fixEnabled); // 모두 자동으로 고쳐졌으면 '수정본에 반영됨'
    d.n++;
    for (const p of placesOf(S, f)) if (!d.places.includes(p)) d.places.push(p);
    dirs.set(key, d);
  }
  // 순서: 11분 초과 → 직접 고칠 것(큰 문제 먼저, 항목 순) → 수정본에 이미 반영된 것
  const rank = (d) => (/11분 안으로/.test(d.action) ? 0 : d.fixed ? 2 : 1);
  const directions = [...dirs.values()]
    .sort((a, b) => rank(a) - rank(b) || Number(b.error) - Number(a.error) || itemIndex(a.item) - itemIndex(b.item))
    .map((d) => ({ item: itemName(d.item), action: d.action, fixed: d.fixed, places: d.places.slice(0, 3), more: Math.max(0, d.places.length - 3) }));

  // 자동으로 고친 것 · 직접 채울 칸
  const fixed = [...new Set(findings.filter((f) => f.level === 'info' && f.fixId && f.fixEnabled && f.fixId !== 'fill:placeholder').map((f) => plainTitle(f.title)))];
  const blanks = (S.rows || []).reduce((n, r) => n + Object.values(r.marks || {}).filter((m) => m && m.placeholder).length, 0);
  const autoParts = [];
  if (autoCells) autoParts.push(`${fixed.length ? `${fixed.slice(0, 3).join(' · ')}${fixed.length > 3 ? ' 등' : ''} ` : ''}자동으로 고친 ${autoCells}칸은 수정본에 이미 반영했습니다.`);
  if (blanks) autoParts.push(`직접 채워야 하는 ${blanks}칸은 수정본에 붉은 '(작성 필요)'로 표시해 두었습니다.`);
  const autoNote = autoParts.join(' ');

  // 총평 문장
  const kinds = (S.blocks || []).map((b) => b.kind);
  const stages = kinds.filter((k) => k === 'stage').length;
  const videos = kinds.filter((k) => k === 'video').length;
  const parts = [stages ? `무대 ${stages}개` : '', videos ? `영상 ${videos}개` : ''].filter(Boolean);
  const comp = parts.length ? `${parts.join('와 ')}로 구성된 큐시트` : '큐시트';
  const lead = [];
  if (totalSec) {
    lead.push(`${comp}로, 무대 시간은 ${fmtDurationKo(totalSec)}입니다.${over ? ` 11분을 ${fmtDurationKo(over)} 넘었으니 가장 먼저 줄여야 합니다.` : ' 11분 안에 잘 맞췄습니다.'}`);
  } else {
    lead.push(`${comp}입니다.`);
  }
  const perItem = ITEMS.map((it) => ({ ...it, n: todo.filter((f) => itemOf(f) === it.id).length }));
  const good = perItem.filter((it) => !it.n).map((it) => it.name);
  const bad = perItem.filter((it) => it.n).sort((a, b) => b.n - a.n);
  if (!todo.length) {
    lead.push(`2026 기준을 모두 지켰습니다. ${autoCells ? `자동으로 맞춘 ${autoCells}칸만 확인하고 ` : ''}그대로 제출하면 됩니다.`);
  } else {
    if (good.length) lead.push(`${josa(good.join(' · '), '은/는')} 2026 기준에 맞게 잘 작성했습니다.`);
    const top = bad.slice(0, 3).map((it) => `${it.name}(${it.n}건)`).join(' · ');
    lead.push(`수정이 필요한 곳은 ${top}${bad.length > 3 ? ' 등' : ''} 모두 ${todo.length}건이며, 아래 수정 방향 순서대로 고치면 됩니다.`);
  }

  return { lead: lead.join(' '), directions, autoNote, todo: todo.length, ok: !todo.length };
}

// '(무대 2, 무대 3 외 2곳)'
export const placeText = (d) => (d.places.length ? ` (${d.places.join(', ')}${d.more ? ` 외 ${d.more}곳` : ''})` : '');

// 메시지·엑셀용 글
export function overviewText(o, { maxDirections = 10 } = {}) {
  if (!o) return '';
  const L = [o.lead];
  if (o.directions.length) {
    L.push('', '수정 방향');
    o.directions.slice(0, maxDirections).forEach((d, i) => {
      L.push(`${i + 1}. ${d.item} — ${d.action}${placeText(d)}${d.fixed ? ' — 수정본에 반영됨' : ''}`);
    });
    if (o.directions.length > maxDirections) L.push(`그 밖에 ${o.directions.length - maxDirections}가지는 항목별 피드백을 참고해 주세요.`);
  }
  if (o.autoNote) L.push('', o.autoNote);
  return L.join('\n');
}

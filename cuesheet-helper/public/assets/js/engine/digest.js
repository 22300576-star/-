// 피드백을 읽기 쉽게 묶는다 (결과 화면 · 피드백 메시지 공용)
//  - todo  : 고칠 것 — 고칠 방법(종류)마다 한 묶음. 설명 · 근거는 묶음에 한 번만, 위치마다 원래 → 수정 후
//  - auto  : 자동 정리 — 표기 · 빈칸처럼 사이트가 형식을 맞추는 수정(수정요망이어도 처음부터 반영)
//  - extra : 참고 — 꼭 고칠 것은 아니지만 반영하면 더 분명해지는 수정
//  - notes : 반영할 것 없는 참고 문장
// 같은 칸을 바꾸는 피드백은 엔진(remedy.mergeSameCell)에서 이미 한 장으로 묶였다(dupOf는 건너뜀).
import { ITEMS, itemOf, groupLabel } from './overview.js';
import { STAGE_LIMIT_SEC } from './constants.js';
import { fmtDurationKo } from './time.js';

const isTodo = (f) => f.level === 'error' || f.level === 'warn';
const firstSentence = (s) => (String(s || '').match(/^.*?[.!?다요](?=\s|$)/) || [String(s || '')])[0];

function groupOf(list, keyOf) {
  const map = new Map();
  for (const f of list) {
    const k = keyOf(f);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(f);
  }
  return map;
}

/**
 * @param {object} res analyze() 결과
 * @returns {{ todo: Group[], auto: Group[], extra: Group[], notes: object[], items: object[] }}
 *   Group = { key, item, itemName, label, level, kind: 'pick'|'manual'|'mixed'|'auto', why, note, places: finding[] }
 */
export function digest(res) {
  const S = res.revised;
  const order = new Map(S.rows.map((r, i) => [r.id, i]));
  const pos = (f) => (f.rowId && order.has(f.rowId) ? order.get(f.rowId) : -1);
  const total = (res.summary && res.summary.totalSec) || 0;
  const c = { over: total > STAGE_LIMIT_SEC ? fmtDurationKo(total - STAGE_LIMIT_SEC) : '' };
  const shown = res.findings.filter((f) => !f.dupOf);

  const make = (key, list) => {
    const places = [...list].sort((a, b) => pos(a) - pos(b));
    const first = places[0];
    const applies = new Set(places.map((f) => (f.apply === 'op' ? 'pick' : f.apply === 'auto' ? 'auto' : 'manual')));
    const whys = [...new Set(places.map((f) => f.why).filter(Boolean))];
    // 위치마다 '수정 후'가 없고 설명이 같으면 묶음에 한 번만
    const msgs = [...new Set(places.filter((f) => f.after == null).map((f) => firstSentence(f.msg)))];
    return {
      key,
      item: itemOf(first),
      itemName: (ITEMS.find((it) => it.id === itemOf(first)) || ITEMS[ITEMS.length - 1]).name,
      label: groupLabel(first, c),
      level: places.some((f) => f.level === 'error') ? 'error' : first.level,
      kind: applies.size === 1 ? [...applies][0] : 'mixed',
      why: whys.join(' / '),
      note: msgs.length === 1 && places.every((f) => f.after == null) ? msgs[0] : '',
      places,
    };
  };
  const keyOf = (f) => `${itemOf(f)}|${groupLabel(f, c)}`;
  const itemIdx = (g) => ITEMS.findIndex((it) => it.id === g.item);

  // 고칠 것: 수정요망 중 사이트가 자동으로 맞추지 않는 것 — 11분 초과 → 큰 문제 → 항목 순
  const todoList = shown.filter((f) => isTodo(f) && f.apply !== 'auto');
  const todo = [...groupOf(todoList, keyOf)].map(([k, list]) => make(k, list));
  const rank = (g) => (/11분 안으로/.test(g.label) ? 0 : 1);
  todo.sort((a, b) => rank(a) - rank(b) || Number(b.level === 'error') - Number(a.level === 'error') || itemIdx(a) - itemIdx(b) || pos(a.places[0]) - pos(b.places[0]));

  // 자동 정리: 형식을 맞추는 수정(수정요망 · 참고 모두) — 종류마다 한 줄
  //  같은 자동 정리(fixId)는 켜고 끄는 것이 하나라 한 번만 (바뀐 칸 목록은 그 안에)
  const seenFix = new Set();
  const autoList = shown.filter((f) => {
    if (f.apply !== 'auto') return false;
    if (!f.fixId) return true;
    if (seenFix.has(f.fixId)) return false;
    seenFix.add(f.fixId);
    return true;
  });
  const auto = [...groupOf(autoList, keyOf)].map(([k, list]) => make(k, list));
  auto.sort((a, b) => itemIdx(a) - itemIdx(b));

  // 참고: 골라서 반영하는 수정(수정요망 아님)
  const extraList = shown.filter((f) => !isTodo(f) && f.apply === 'op');
  const extra = [...groupOf(extraList, keyOf)].map(([k, list]) => make(k, list));
  extra.sort((a, b) => itemIdx(a) - itemIdx(b));

  // 반영할 것 없는 참고 문장 (총 무대 시간처럼 위에서 이미 보이는 것은 뺌)
  const notes = shown.filter((f) => !isTodo(f) && f.apply !== 'op' && f.apply !== 'auto' && f.id !== 'time:total');

  // 항목별 상태: 고칠 것 위치 수 (자동 정리는 빼고)
  const items = ITEMS.map((it) => ({ id: it.id, name: it.name, todo: todo.filter((g) => g.item === it.id).reduce((n, g) => n + g.places.length, 0) }));
  return { todo, auto, extra, notes, items };
}

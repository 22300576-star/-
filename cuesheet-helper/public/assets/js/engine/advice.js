// 무대 내용(출연 구성 · 가사 분위기 · 곡 흐름 · 주인공)에 맞춘 음향 · 조명 제안
// 제안은 '수정요망'으로 세지 않는다. 결과 화면의 음향·FD / 조명 항목과 총평에 보여 주고,
// 빈칸 피드백의 '수정 후' 예시를 만들 때도 쓴다.
import { fmtClock } from './time.js';
import { norm, isBlank, OFF_ONLY_RE, PENDING_RE } from './vocab.js';
import { PIN_POS, PIN_KEYS, PLACEHOLDER } from './constants.js';
import { josa } from './josa.js';
import { micsFor } from './rules-stagecraft.js';
import { MAIN_CHAR_RE } from './content.js';
import { applyText } from './ops.js';

const ZONE_LABEL = { left: '왼쪽', right: '오른쪽', center: '중앙', back: '전체', offstage: '전체' };
const round10 = (n) => Math.round(n / 10) * 10;
const span = (x) => (x && x.start != null && x.end != null ? `${fmtClock(x.start)} ~ ${fmtClock(x.end)}` : '');
export function shortLyric(line, words = 4) {
  const w = String(line || '').trim().split(/\s+/);
  return w.length > words ? `${w.slice(0, words).join(' ')}…` : w.join(' ');
}
const cueOf = (x) => (x && x.lyrics.length ? `가사 "${shortLyric(x.lyrics[0], 3)}"` : '');

// 행의 조명이 켜져 있는 정도(가장 밝은 %) — 꺼짐/유지는 null
function brightness(row) {
  let best = null;
  for (const k of ['lStage', 'lTop']) {
    const v = norm(row.c[k]);
    if (!v || OFF_ONLY_RE.test(v) || /^X\b/.test(v) || /^유지/.test(v)) continue;
    for (const m of v.matchAll(/(\d{1,3})\s*%/g)) best = Math.max(best ?? 0, Number(m[1]));
  }
  return best;
}
const pinsOn = (row) => PIN_KEYS.filter((k) => {
  const v = norm(row.c[k]);
  return v && !/^X\b/i.test(v) && !OFF_ONLY_RE.test(v) && !/^유지/.test(v);
});

// 행 하나의 조명 예시(무대 / 상단 / 핀 / Details) — 조명이 아예 없는 무대의 '수정 후' 예시
export function lightPlanRow(st, x) {
  const m = st.mood;
  const late = st.moodEnd && st.turn && st.rows.indexOf(x) >= st.rows.indexOf(st.turn);
  const top = late ? st.moodEnd.top : m.top;
  const mid = round10((m.low + m.high) / 2);
  const here = st.protags.filter((p) => p.pin && p.firstRow && st.rows.indexOf(st.rows.find((y) => y.row === p.firstRow)) <= st.rows.indexOf(x));
  const zone = here.length ? ZONE_LABEL[here[0].zone] || '중앙' : '중앙';
  const plan = {
    도입: x.singing && ['bright', 'passion'].includes(m.key) ? { lStage: '전체 / 흰색 / 70%', lTop: `전체 / ${top} / ${mid}%`, how: '즉시 켜기' } : { lStage: here.length ? `${zone} / 흰색 / 40%` : 'X', lTop: `전체 / ${top} / ${m.low}%`, how: '2초에 걸쳐 서서히 켜기' },
    전개: { lStage: x.dance ? '전체 / 흰색 / 70%' : `${zone} / 흰색 / 60%`, lTop: `전체 / ${top} / ${mid}%`, how: '즉시 바꾸기' },
    절정: { lStage: '전체 / 흰색 / 100%', lTop: `전체 / ${top} / ${m.high}%`, how: '즉시 밝게' },
    마무리: { lStage: '전체 / 흰색 / 60%', lTop: `전체 / ${top} / ${m.low}%`, how: '3초에 걸쳐 서서히 어둡게' },
    전체: { lStage: '전체 / 흰색 / 80%', lTop: `전체 / ${top} / ${mid}%`, how: '즉시 켜기' },
  }[x.phase] || { lStage: '전체 / 흰색 / 70%', lTop: `전체 / ${top} / ${mid}%`, how: '즉시 바꾸기' };
  const pins = {};
  for (const p of here) pins[p.pin] = 'ON';
  const t = x.start != null ? `${fmtClock(x.start)} ` : '';
  const cue = cueOf(x) ? `${cueOf(x)} 시작과 동시에` : x.phase === '도입' || x.phase === '전체' ? '음악이 시작되면' : '이 구간이 시작되면';
  const pinTxt = Object.keys(pins).length ? `, ${Object.keys(pins).map((k) => PIN_POS[k].name).join('·')} ON` : '';
  const words = (v) => v.replace(/\s*\/\s*/g, ' ');
  const what = `${plan.lStage === 'X' ? '무대 끄고' : `무대 ${words(plan.lStage)}`} · 상단 ${words(plan.lTop)}`;
  return { ...plan, pins, details: `${t}${cue} ${what}${pinTxt}, ${plan.how}`, cue: `${t}${cue} ${plan.how}` };
}

// 행의 실제 조명 칸을 말로 풀어 Details 예시를 만든다 — 'Details가 비어 있음'의 '수정 후'
export function describeRowLight(st, x) {
  const r = x.row;
  const parts = [];
  const say = (k, label) => {
    const v = norm(r.c[k]);
    if (!v || /^유지/.test(v) || isBlank(v) || PENDING_RE.test(v)) return;
    if (OFF_ONLY_RE.test(v) || /^X\b/.test(v)) parts.push(`${label} 끄기`);
    else parts.push(`${label} ${v.split('\n')[0].replace(/\s*\/\s*/g, ' ').replace(/\s+/g, ' ').trim()}`);
  };
  say('lStage', '무대');
  say('lTop', '상단');
  const on = pinsOn(r).map((k) => PIN_POS[k].name);
  if (on.length) parts.push(`${on.join('·')} ON`);
  if (!parts.length) return '';
  const t = x.start != null ? `${fmtClock(x.start)} ` : '';
  const who = st.protags.find((p) => p.firstRow === r && p.zone);
  const cue = who
    ? `${josa(who.name, '이/가')} ${who.zoneName === '단상' ? '단상' : `무대 ${who.zoneName}`}에 서면`
    : cueOf(x)
      ? `${cueOf(x)} 시작과 동시에`
      : x.dance
        ? '안무가 시작되면'
        : '이 구간이 시작되면';
  const how = x.phase === '도입' ? '2초에 걸쳐 서서히' : x.phase === '마무리' ? '3초에 걸쳐 서서히' : cue.includes('동시에') ? '' : '즉시';
  return `${t}${cue} ${how} ${parts.length ? parts.join(', ') : '조명 바꾸기'}`.replace(/\s+/g, ' ').trim();
}

// 무대 하나에 대한 음향 · 조명 제안
export function stageAdvice(S, st) {
  const m = st.mood;
  const sing = st.rows.filter((x) => x.singing);
  const quiet = st.rows.filter((x) => !x.singing && x.start != null);
  const climax = st.rows.length > 1 && st.climax && st.climax.singing ? st.climax : null;
  const first = st.rows[0];
  const last = st.rows[st.rows.length - 1];
  const singers = st.protags.filter((p) => p.sings);
  const pinned = st.protags.filter((p) => p.pin);
  const sound = [];
  const light = [];
  const now = []; // 지금 큐시트와 비교한 점검(제안 문구 앞에 '지금')

  // ---------- 음향 ----------
  if (sing.length) {
    const n = micsFor(st.choir);
    sound.push(`합창 마이크 ${n}개 정도 — ${st.choir ? `콰이어 ${st.choir}명` : '노래하는 인원'} 기준(6명당 1개), 단상 앞에 배치. 최종 수량은 TFT 음향팀과 확인`);
  }
  if (singers.length) {
    const moving = singers.filter((p) => p.move);
    sound.push(`무선 마이크 ${Math.min(2, singers.length)}개 — ${singers.map((p) => p.name).join('·')}의 노래용${moving.length ? `(${josa(moving.map((p) => p.name).join('·'), '은/는')} 움직이며 부르므로 무선)` : ''}${singers.length > 2 ? ', 기본 무선 마이크가 2대라 번갈아 쓰는 순서 적기' : ''}`);
  }
  if (sing.length && quiet.length && quiet.length < st.rows.length) {
    const q = quiet.slice(0, 2).map((x) => `${span(x)}${x.dance ? ' 안무' : ' 간주'}`).join(', ');
    const firstSing = sing[0];
    const introQuiet = st.rows.indexOf(quiet[0]) < st.rows.indexOf(firstSing);
    const on = introQuiet && firstSing.start != null ? `${fmtClock(firstSing.start)} 가사가 시작될 때 ON` : '가사가 다시 시작될 때 ON';
    sound.push(`가사 없는 구간(${q}${quiet.length > 2 ? ' 등' : ''})에는 합창 마이크를 꺼 두고(OFF), ${on} — 음향/FD 칸에 시각과 함께 적기`);
  }
  if (climax && climax.start != null) {
    sound.push(`절정 ${fmtClock(climax.start)} ${cueOf(climax)}: 합창이 음원에 묻히지 않도록 '합창 마이크 볼륨 크게'를 음향/FD 칸에 적기`);
  }
  if (st.dialogue) sound.push("대사·내레이션: 말하는 사람에게 핸드 마이크 1개(또는 헤드셋)를 지정 — 영상에 녹음된 음원이면 '영상 음원'으로 적기");
  for (const inst of st.instruments) {
    const di = /(기타|피아노|건반|키보드|베이스)/.test(inst);
    sound.push(`${inst}: ${di ? 'DI 1개(악기 선을 음향 콘솔에 연결)' : '악기 마이크 1개(마이킹)'}를 음향 칸에 적기`);
  }

  // ---------- 조명 ----------
  if (m.name) {
    light.push(`가사 분위기: ${m.name} 곡(${st.moodWords.join('·')}) → 상단은 ${m.top} 계열 ${m.low}~${m.high}%, 무대 조명은 흰색으로 사람을 밝게`);
  } else {
    light.push(`가사에서 분위기를 읽을 단어가 적습니다 — 상단 색 하나(예: ${m.top})를 정해 도입은 어둡게(${m.low}%), 절정은 밝게(${m.high}%) 대비를 주기`);
  }
  if (st.moodEnd && st.turn) {
    light.push(`분위기 흐름 ${st.flow}: ${st.turn.start != null ? `${fmtClock(st.turn.start)} ` : ''}${cueOf(st.turn) ? `${cueOf(st.turn)}부터 ` : '후반부터 '}상단을 ${st.moodEnd.top}으로 바꾸기`);
  }
  const lively = ['bright', 'passion'].includes(m.key);
  if (st.rows.length > 1 && first.start != null) {
    if (!first.singing) light.push(`도입 ${span(first)} (간주): 상단 ${m.top} ${m.low}%로 어둡게 시작, 2초에 걸쳐 서서히 켜기`);
    else if (lively) light.push(`첫 소절 ${span(first)} ${cueOf(first)}: 노래 시작과 동시에 즉시 켜기 — 상단 ${m.top} ${round10((m.low + m.high) / 2)}%`);
    else light.push(`첫 소절 ${span(first)} ${cueOf(first)}: 상단 ${m.top} ${m.low}%로 차분하게 시작, 2초에 걸쳐 서서히 켜기`);
  }
  const blockFx = st.block.rows.some((r) => /(FX\s*[12]|스트로브|고보|무빙)/i.test(`${r.c.details} ${r.c.lStage} ${r.c.lTop}`));
  if (climax && climax !== first) {
    light.push(`절정 ${span(climax)} ${cueOf(climax)}: 무대 전체 흰색 100% · 상단 ${m.high}%로 즉시 밝게${!blockFx && S.fx && S.fx.types && S.fx.types.length < 2 ? ' (FX를 쓴다면 이 순간 1~2초 스트로브처럼 짧게 한 번)' : ''}`);
  }
  for (const p of pinned) {
    const pos = PIN_POS[p.pin];
    light.push(`${p.name}: 무대 ${p.zoneName}에 서므로 ${pos.name}(${pos.where}) ON — 핀은 고정이라 ${josa(p.name, '이/가')} ${pos.name} 자리에 와서 서도록 동선을 맞추기${MAIN_CHAR_RE.test(p.name) ? ', Details에 동선·의상·위치 적기' : ''}`);
  }
  // 자리가 정해지지 않은 사람은 한 줄로 묶음 (핀 1개에 1명)
  const unpinned = st.protags.filter((q) => !q.pin);
  if (unpinned.length) {
    const main = unpinned.some((p) => MAIN_CHAR_RE.test(p.name));
    light.push(`${unpinned.map((p) => p.name).join('·')}: 설 자리를 Pin1(무대 왼쪽) · Pin2(단상 바로 앞) · Pin3(무대 앞쪽 중앙) · Pin4(무대 오른쪽) 중에서 정해 그 핀을 ON${unpinned.length > 1 ? ' (핀 1개에 1명)' : ''}${main ? ' — 주인공은 Details에 동선·의상·위치 적기' : ''}`);
  }
  const dance = st.rows.find((x) => x.dance);
  if (dance && (st.dancers || dance.start != null)) {
    light.push(`${st.dancers ? `댄서 ${st.dancers}명 ` : ''}안무${dance.start != null ? `(${fmtClock(dance.start)}~)` : ''}: 무대 조명을 전체 70% 이상으로 — 대형이 모두 보이게`);
  }
  if (last && last.end != null) light.push(`끝 ${fmtClock(last.end)}: 노래가 끝나면 즉시 암전(X) → 다음 순서로 넘어가기`);

  // 지금 큐시트와 비교: 절정이 도입보다 밝지 않음
  if (climax && climax !== first) {
    const a = brightness(first.row);
    const z = brightness(climax.row);
    if (a != null && z != null && z <= a) now.push({ cat: 'light', text: `절정(${fmtClock(climax.start ?? 0)})의 밝기(${z}%)가 도입(${a}%)보다 높지 않습니다 — 절정에서 밝기를 올리면 곡의 흐름이 살아납니다` });
  }

  // ---------- 반영할 수 있는 제안 (골라서 반영 · 기본은 반영 안 함) ----------
  const actions = [];
  const b = st.block.index;
  const soundRow = st.block.rows.find((r) => !r.cont.sound) || st.block.rows[0];
  const soundNow = norm(soundRow.c.sound) === PLACEHOLDER ? '' : norm(soundRow.c.sound);
  const act = (id, cat, title, row, key, op) => {
    const before = row.cont[key] ? '' : norm(row.c[key]) === PLACEHOLDER ? '' : norm(row.c[key]);
    const o = { rowId: row.id, key, ...op };
    actions.push({ id, cat, title, level: 'info', advice: true, apply: 'op', ops: [o], defaultOn: false, editable: true, rowId: row.id, key, before, after: applyText(before, o), afterKind: 'example' });
  };
  if (sing.length && quiet.length && quiet.length < st.rows.length && !/OFF/i.test(soundNow)) {
    const lines = [];
    for (const q of quiet.slice(0, 3)) {
      lines.push(`${span(q)} ${q.dance ? '안무' : '간주'}: 합창 마이크 OFF`);
      const next = st.rows.slice(st.rows.indexOf(q) + 1).find((x) => x.singing && x.start != null);
      if (next) lines.push(`${fmtClock(next.start)} 가사 시작: 합창 마이크 ON`);
    }
    act(`adv:mic:${b}`, 'sound', '간주 · 안무 구간은 합창 마이크 OFF, 가사 시작에 ON', soundRow, 'sound', { append: [...new Set(lines)].join('\n') });
  }
  if (climax && climax.start != null && !/볼륨/.test(soundNow)) {
    act(`adv:vol:${b}`, 'sound', '절정에서 합창 마이크 볼륨 크게', soundRow, 'sound', { append: `${fmtClock(climax.start)} 절정${cueOf(climax) ? ` ${cueOf(climax)}` : ''}: 합창 마이크 볼륨 크게` });
  }
  if (now.some((n) => n.cat === 'light') && climax && !climax.row.cont.lStage) {
    act(`adv:climax:${b}`, 'light', `절정 ${fmtClock(climax.start ?? 0)}에 무대 전체 100%로 밝게`, climax.row, 'lStage', { set: '전체 / 흰색 / 100%' });
  }

  // 총평용 한 줄
  const brief = [
    m.name ? `${m.short} 분위기 → 상단 ${m.top}${st.moodEnd ? `→${st.moodEnd.top}` : ''}` : '',
    climax && climax !== first && climax.start != null ? `절정 ${fmtClock(climax.start)} 전체 밝게` : '',
    pinned.length ? pinned.map((p) => `${p.name} ${PIN_POS[p.pin].name}`).join('·') : '',
    sing.length ? `합창 마이크 ${micsFor(st.choir)}개${singers.length ? ` + 무선 ${Math.min(2, singers.length)}개(${singers.length > 2 ? `${singers.length}명 번갈아` : singers.map((p) => p.name).join('·')})` : ''}` : '',
  ].filter(Boolean).join(' · ');

  return {
    block: st.block.index,
    rowId: st.block.rows[0].id,
    label: st.label,
    title: st.title,
    about: [m.name ? `${m.name} 곡` : '', st.choir ? `콰이어 ${st.choir}명` : '', st.dancers ? `댄서 ${st.dancers}명` : '', st.protags.length ? st.protags.map((p) => p.name).join('·') : ''].filter(Boolean).join(' · '),
    sound,
    light,
    now,
    brief,
    actions,
  };
}

export function buildAdvice(S, stages) {
  return stages.map((st) => stageAdvice(S, st)).filter((a) => a.sound.length || a.light.length);
}


// 앞 무대와 똑같은 제안은 짧게: '합창 마이크 4개 정도 — 콰이어 24명 기준…' → '합창 마이크 4개 정도 (무대 1과 같음)'
export function compactAdvice(advice) {
  const seen = new Map(); // 제안 문장 → 처음 나온 무대
  const short = (a) => (t) => {
    if (!seen.has(t)) {
      seen.set(t, a.label);
      return t;
    }
    return `${t.split(/ — |\. |: /)[0]} (${josa(seen.get(t), '과/와')} 같음)`;
  };
  return (advice || []).map((a) => ({ ...a, sound: a.sound.map(short(a)), light: a.light.map(short(a)) }));
}

// 메시지 · 검토용 엑셀에 넣는 글: 무대마다 음향 · 조명 제안
export function adviceText(advice) {
  if (!advice || !advice.length) return '';
  const L = ['음향·조명 제안 (무대 내용·개사 분석 — 수정요망 개수에는 넣지 않음)'];
  for (const a of compactAdvice(advice)) {
    L.push('', `■ ${a.label}${a.title ? ` ${a.title}` : ''}${a.about ? ` — ${a.about}` : ''}`);
    for (const t of a.sound) L.push(`[음향] ${t}`);
    for (const t of a.light) L.push(`[조명] ${t}`);
    for (const n of a.now) L.push(`[지금 큐시트] ${n.text}`);
  }
  return L.join('\n');
}

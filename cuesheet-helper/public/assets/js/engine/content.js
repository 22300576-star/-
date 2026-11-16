// 무대 내용 분석: 출연 구성 · 주인공(솔로) · 가사 분위기 · 곡 흐름(도입-전개-절정-마무리) · 악기 · 대사
// 음향·조명 제안과 '수정 후' 예시, 주인공 조명 Details 점검이 같은 분석을 쓴다.
import { norm, isBlank, PENDING_RE, INSTRUMENT_RE, LOC_WORDS } from './vocab.js';
import { PIN_POS } from './constants.js';

// 무대에 따로 비춰야 하는 사람: 주인공(극의 주인공) · 솔로 · 메인 보컬
export const PROTAG_RE = /(주인공|솔로\s*\d*|메인\s*보컬|리드\s*보컬|주연)/;
// 조명 Details의 '동선·의상·위치' 기준은 학부가 주인공을 쓸 때만 적용한다
export const MAIN_CHAR_RE = /^(주인공|주연)$/;
const PROTAG_G = new RegExp(PROTAG_RE.source, 'g');
export const DIALOGUE_RE = /(대사|내레이션|나레이션|낭독|멘트|독백)/;
const NOSING_RE = /^(x|간주|전주|후주|인트로|아웃트로|없음|-|—|가사\s*없음|음악만|연주)$/i;

// 조명 Details 점검용: 위치 · 동선 · 의상
export const POS_TEXT_RE = /(중앙|가운데|센터|왼쪽|오른쪽|좌측|우측|앞쪽|뒤쪽|무대\s*앞|무대\s*뒤|단상|계단|객석|통로|입구|Pin\s*[1-4]|핀\s*[1-4]|[1-4]번\s*핀|자리|위치|하수|상수)/i;
export const MOVE_TEXT_RE = /(이동|걸어|걸으|올라|내려|들어오|들어가|나오|나와|나가|등장|퇴장|입장|도착|향해|다가|돌아|달려|건너|지나|→|->|⇒|에서\s*\S+\s*(?:으로|로)(?=\s|$|,))/;
export const STAY_TEXT_RE = /(제자리|이동\s*없|움직이지\s*않|서\s*있|앉아\s*있|고정|그대로\s*(?:서|있))/;
export const COSTUME_RE = /(의상|옷(?!걸)|드레스|정장|셔츠|블라우스|한복|교복|원피스|재킷|자켓|코트|치마|스커트|바지|티셔츠|후드|가운(?!데)|턱시도|모자(?![라랄란])|망토|베일|유니폼|[가-힣]+색\s*(?:옷|의상|드레스|정장|셔츠|원피스|티))/;

// 가사 분위기 → 조명 색 (무대 조명은 인물을 비추는 밝은 계열, 상단은 무대에 색을 입히는 조명 — 2026 조명 가이드)
export const MOODS = [
  { key: 'calm', name: '차분하고 서정적인', short: '차분', re: /(새벽|밤(?!새)|어둠|별빛|(?<![특개구차분식작])별(?!로)|달빛|고요|조용|그리움|그리워|눈물|슬픔|슬퍼|이별|외로|쓸쓸|겨울|추억|기억)/g, top: '진파랑', low: 20, high: 60 },
  { key: 'bright', name: '밝고 희망찬', short: '희망', re: /(빛나|햇살|태양|아침|희망|내일|기쁨|웃음|행복|축제|봄날|날개|미래|새로운|꿈을|꿈이|빛)/g, top: '하늘색', low: 40, high: 100 },
  { key: 'warm', name: '따뜻한', short: '따뜻', re: /(사랑|마음|품에|온기|따뜻|감사|고마|가족|친구|우정|위로|손을\s*잡)/g, top: '주황색', low: 30, high: 90 },
  { key: 'passion', name: '힘차고 열정적인', short: '열정', re: /(뜨거|불꽃|외쳐|달려|자유|힘차|열정|승리|행진|일어나|도전|함성|멈추지)/g, top: '빨간색', low: 50, high: 100 },
  { key: 'faith', name: '경건한', short: '경건', re: /(주님|하나님|예수|은혜|찬양|십자가|영광|할렐루야|축복|기도)/g, top: '금색', low: 30, high: 90 },
];
const DEFAULT_MOOD = { key: 'plain', name: '', short: '', top: '하늘색', low: 30, high: 90 };

const ZONE_NAME = { left: '왼쪽', right: '오른쪽', center: '중앙', back: '단상', offstage: '무대 밖' };
export const PIN_OF_ZONE = { left: 'pin1', back: 'pin2', center: 'pin3', right: 'pin4' };

const val = (r, k) => (r.cont[k] ? '' : norm(r.c[k]));
const segs = (t) => String(t || '').split(/[\n/,.·]|(?:\s-\s)/).map((s) => s.trim()).filter(Boolean);

// '흰 드레스를 입은 주인공' → '흰 드레스' (의상 앞의 색·꾸밈말 한 단어까지)
export function costumeOf(seg) {
  const m = String(seg).match(COSTUME_RE);
  if (!m) return '';
  const prev = String(seg).slice(0, m.index).trim().split(/\s+/).pop() || '';
  const adj = /(색|은|운|한|빛|무늬|흰|검은|까만|하얀|빨간|파란|노란)$/.test(prev) && !/(주인공|주연|솔로)/.test(prev) ? `${prev} ` : '';
  return `${adj}${m[0]}`;
}

export function lyricLines(text) {
  const t = norm(text);
  if (isBlank(t) || PENDING_RE.test(t)) return [];
  return t
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !NOSING_RE.test(l) && !/^\(.*\)$/.test(l));
}

function lastZone(text) {
  let best = null;
  let at = -1;
  for (const w of LOC_WORDS) {
    const re = new RegExp(w.re.source, 'g');
    let m;
    while ((m = re.exec(text))) {
      if (m.index >= at) {
        at = m.index;
        best = w.zone;
      }
    }
  }
  return best;
}

function count(text, re) {
  const m = String(text || '').match(re);
  return m ? Number(m[2] || m[1]) : null;
}

// 블록 하나(무대)를 분석
export function analyzeStage(S, b) {
  const rows = b.rows.map((r) => {
    const lyrics = lyricLines(val(r, 'lyrics'));
    const detail = val(r, 'detail');
    return {
      row: r,
      start: r.rt && r.rt.ok ? r.rt.start : null,
      end: r.rt && r.rt.ok ? r.rt.end : null,
      lyrics,
      singing: lyrics.length > 0,
      dance: /(안무|춤|댄스|퍼포먼스)/.test(detail),
    };
  });
  const text = (k) => b.rows.map((r) => val(r, k)).join('\n');
  const stageTxt = text('stage');
  const detailTxt = text('detail');
  const lightTxt = b.rows.map((r) => ['details', 'pin1', 'pin2', 'pin3', 'pin4'].map((k) => val(r, k)).join('\n')).join('\n');
  const all = [stageTxt, text('waiting'), detailTxt, text('sound'), text('note')].join('\n');

  const choir = count(all, /(콰이어|합창단|합창)\s*(\d+)\s*명/) ?? count(all, /(\d+)\s*명\s*(?:의\s*)?(?:콰이어|합창)/);
  const dancers = count(all, /(댄서|안무팀)\s*(\d+)\s*명/) ?? count(all, /(\d+)\s*명\s*(?:의\s*)?댄서/);

  // 주인공 · 솔로
  const names = new Set();
  for (const t of [stageTxt, detailTxt, lightTxt, rows.flatMap((x) => x.row.c.lyrics || '').join('\n')]) {
    for (const m of String(t).matchAll(PROTAG_G)) names.add(m[1].replace(/\s+/g, ' ').trim());
  }
  const allSegs = segs([stageTxt, detailTxt, lightTxt].join('\n'));
  const protags = [...names]
    // '솔로 1·2'가 있거나, '주인공은 … 솔로'처럼 솔로가 다른 사람의 동작이면 '솔로'를 따로 세지 않음
    .filter((name, _, arr) => !(name === '솔로' && (arr.some((n) => /^솔로 ?\d/.test(n)) || allSegs.filter((s) => s.includes('솔로')).every((s) => /(주인공|주연)/.test(s)))))
    .map((name) => {
      const re = new RegExp(name.replace(/\s+/g, '\\s*'));
      const has = (t) => re.test(t);
      const inStage = segs(stageTxt).filter(has);
      const inDetail = segs(detailTxt).filter(has);
      const moveSeg = inDetail.find((s) => MOVE_TEXT_RE.test(s)) || '';
      const zone = lastZone(moveSeg) || lastZone(inStage.join(' ')) || lastZone(inDetail.join(' '));
      const firstRow = rows.find((x) => [val(x.row, 'stage'), val(x.row, 'detail'), val(x.row, 'details'), x.row.c.lyrics || ''].some(has));
      const sings = /솔로/.test(name) || rows.some((x) => has(x.row.c.lyrics || '')) || inDetail.some((s) => /(솔로|노래|부름|부르)/.test(s));
      const costumeSeg = segs(all).find((s) => has(s) && COSTUME_RE.test(s));
      const costume = costumeSeg ? costumeOf(costumeSeg) : '';
      const pin = PIN_OF_ZONE[zone] || null;
      return { name, main: MAIN_CHAR_RE.test(name), zone, zoneName: ZONE_NAME[zone] || '', pin, pinWhere: pin ? PIN_POS[pin].where : '', move: moveSeg, costume, sings, firstRow: firstRow ? firstRow.row : null };
    });

  // 가사 분위기 (앞 절반 / 뒤 절반)
  const lyricAll = rows.flatMap((x) => x.lyrics).join(' ');
  const title = (b.item || '').split('\n').slice(1).join(' ');
  const score = (t) =>
    MOODS.map((m) => ({ m, n: (String(t).match(m.re) || []).length, words: [...new Set(String(t).match(m.re) || [])] })).sort((a, b2) => b2.n - a.n);
  const ranked = score(`${title} ${lyricAll}`);
  const mood = ranked[0].n ? ranked[0].m : DEFAULT_MOOD;
  const words = ranked[0].n ? ranked[0].words.slice(0, 3) : [];
  const half = Math.ceil(rows.length / 2);
  const a = score(rows.slice(0, half).flatMap((x) => x.lyrics).join(' '))[0];
  const z = score(rows.slice(half).flatMap((x) => x.lyrics).join(' '))[0];
  const flow = a.n && z.n && a.m.key !== z.m.key ? `${a.m.short} → ${z.m.short}` : '';

  // 곡 흐름: 반복되는 가사(후렴)가 있거나 마지막으로 노래하는 행을 절정으로
  const seen = new Map();
  rows.forEach((x, i) => x.lyrics.forEach((l) => {
    const k = l.replace(/\s+/g, '');
    if (k.length < 4) return; // '오', '예예' 같은 짧은 추임새는 후렴으로 보지 않음
    seen.set(k, (seen.get(k) || new Set()).add(i));
  }));
  // 다른 행에서 다시 나오는 가사(후렴)가 있으면 그 마지막 행이 절정 (한 행 안에서 반복된 것은 제외)
  const repeatRow = [...seen.values()].filter((v) => v.size > 1).map((v) => Math.max(...v)).sort((p, q) => q - p)[0];
  const singIdx = rows.map((x, i) => (x.singing ? i : -1)).filter((i) => i >= 0);
  const climax = repeatRow ?? (singIdx.length ? singIdx[singIdx.length - 1] : rows.length - 1);
  rows.forEach((x, i) => {
    if (rows.length === 1) x.phase = '전체';
    else if (i === 0 && i !== climax) x.phase = '도입';
    else if (i === climax) x.phase = '절정';
    else if (i > climax) x.phase = '마무리';
    else x.phase = '전개';
  });

  return {
    block: b,
    label: (b.item || '').split('\n')[0].trim(),
    title,
    rows,
    choir,
    dancers,
    protags,
    instruments: [...new Set((all.match(new RegExp(INSTRUMENT_RE.source, 'g')) || []))],
    dialogue: DIALOGUE_RE.test(`${detailTxt}\n${text('lyrics')}`),
    mood,
    moodWords: words,
    flow,
    moodEnd: flow ? z.m : null, // 뒤 절반의 분위기(흐름이 바뀔 때)
    turn: flow ? rows[half] || null : null, // 분위기가 바뀌기 시작하는 행
    climax: rows[climax] || null,
    sound: text('sound'),
  };
}

export function analyzeStages(S) {
  return (S.blocks || []).filter((b) => b.kind === 'stage').map((b) => analyzeStage(S, b));
}

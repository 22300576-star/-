// 피드백마다 '원래 → 수정 후'를 붙인다.
//  before    : 학부가 처음 적은 내용(칸 값 또는 상황 설명)
//  after     : 피드백을 반영한 모습
//  afterKind : auto(수정본에 반영됨) · off(자동 수정을 끔 — 켜면 이렇게) · example(이렇게 고쳐 적기 — [ ]는 예시) · guide(칸이 아닌 방향)
//  afterCell : after를 그 칸에 그대로 넣을 수 있는지(결과 화면의 '예시로 채우기')
//  pairs     : 여러 칸을 한꺼번에 고친 자동 수정의 예 [{ loc, before, after }]
import { fmtClock, fmtRunTime, fmtDurationKo, parseRunTime } from './time.js';
import { norm, isBlank, OFF_ONLY_RE, PENDING_RE, SUBJECTIVE_RE, ZONE_RE, COLOR_WORD_RE, PERCENT_RE, FX_TYPES, LOC_WORDS, INSTRUMENT_RE } from './vocab.js';
import { PIN_POS, PIN_KEYS, LIGHT_KEYS, PLACEHOLDER, STAGE_LIMIT_SEC, colName } from './constants.js';
import { josa } from './josa.js';
import { micsFor } from './rules-stagecraft.js';
import { lightPlanRow, describeRowLight, shortLyric } from './advice.js';

// '수정 후' 표시 이름
export const AFTER_LABEL = { auto: '수정본에 반영됨', off: '자동 수정 꺼짐 · 켜면 이렇게', example: '이렇게 고쳐 적기', guide: '고칠 방향' };

const one = (t) => norm(t).replace(/\n+/g, ' / ');
const ex = (t) => `[${t}]`;
const label = (b) => ((b && b.item) || '').split('\n')[0].trim();

// 처음 적은 값: 자동 수정·작성 필요 표시 전의 값
export function originalValue(row, key) {
  if (!row) return '';
  const m = row.marks && row.marks[key];
  const v = m && m.before !== null && m.before !== undefined ? m.before : row.c[key];
  return v === PLACEHOLDER ? '' : norm(v);
}

function blockLen(b) {
  const t = b.rows.filter((r) => r.rt && r.rt.ok);
  return t.length ? Math.max(...t.map((r) => r.rt.end)) - Math.min(...t.map((r) => r.rt.start)) : 0;
}

// 무대·단상 위 사람: 시트 전체에서 '콰이어 24명', '댄서 16명'처럼 숫자를 찾는다
function headcounts(S) {
  const all = S.rows.map((r) => [r.c.stage, r.c.waiting, r.c.detail].join('\n')).join('\n');
  const out = {};
  for (const [k, re] of [
    ['콰이어', /(콰이어|합창단)\s*(\d+)\s*명/],
    ['댄서', /(댄서|안무팀)\s*(\d+)\s*명/],
  ]) {
    const m = all.match(re);
    if (m) out[k] = Number(m[2]);
  }
  return out;
}

// 가사를 슬라이드(2줄) 단위로 나눠 행을 예시로 만든다
function splitRows(start, end, lyrics, max = 4) {
  const lines = lyrics.length ? lyrics : [];
  const n = Math.max(2, Math.min(8, lines.length ? Math.ceil(lines.length / 2) : Math.round((end - start) / 20)));
  const step = (end - start) / n;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const s = Math.round(start + step * i);
    const e = i === n - 1 ? end : Math.round(start + step * (i + 1));
    const lyr = lines.slice(i * 2, i * 2 + 2).join(' / ');
    rows.push(`${fmtRunTime(s, e)}${lyr ? ` ${lyr}` : ''}`);
  }
  return rows.length > max ? [...rows.slice(0, max - 1), `… (${rows.length}행으로 나누기)`] : rows;
}

const lyricsOf = (r) =>
  norm(r.c.lyrics)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(x|간주|전주|후주|없음|-)$/i.test(l) && !/^\(.*\)$/.test(l) && !PENDING_RE.test(l));

// '구역 / 색상 / 밝기%'에서 빠진 것을 채운 예시
function fillZone(text, key, st, x) {
  const m = st ? st.mood : { top: '하늘색', low: 30, high: 90 };
  const pct = !x ? 70 : x.phase === '절정' ? 100 : x.phase === '도입' ? (key === 'lTop' ? m.low : 40) : x.phase === '마무리' ? 50 : 70;
  return norm(text)
    .split('\n')
    .map((line) => {
      if (!line.trim() || OFF_ONLY_RE.test(line) || /^X\b/.test(line) || /^유지/.test(line)) return line;
      const zone = (line.match(ZONE_RE) || [])[0];
      const color = (line.match(COLOR_WORD_RE) || line.match(/#[0-9a-f]{3,6}/i) || [])[0];
      const p = (line.match(/(\d{1,3})\s*%/) || [])[1];
      const time = (line.match(/^\s*\d{1,2}:\d{2}\s*/) || [''])[0];
      return `${time}${zone || '전체'} / ${color || (key === 'lTop' ? ex(m.top) : '흰색')} / ${p ? `${p}%` : ex(`${pct}%`)}`;
    })
    .join('\n');
}

// 시트 안에서 찾을 수 있는 정보로 '수정 후'를 만든다
export function attachRemedies(ctx, stages) {
  const { S } = ctx;
  const rowById = new Map(S.rows.map((r) => [r.id, r]));
  const rowIndex = new Map(S.rows.map((r, i) => [r.id, i]));
  const stageOf = new Map(stages.map((st) => [st.block.index, st]));
  const xOf = (row) => {
    const st = row && stageOf.get(row.blockIndex);
    return st ? st.rows.find((x) => x.row === row) : null;
  };
  const counts = headcounts(S);
  const loc = (rowId, key) => `${(rowIndex.get(rowId) ?? 0) + 5}행 ${colName(key)}`;
  const timedContent = S.rows.filter((r) => (r.kind === 'stage' || r.kind === 'video') && r.rt && r.rt.ok);
  const prevTimed = (row) => {
    const i = rowIndex.get(row.id);
    return [...timedContent].reverse().find((r) => rowIndex.get(r.id) < i) || null;
  };
  const nextBlockStage = (b) => S.blocks.slice(b.index + 1).find((x) => x.kind === 'stage');
  const withCounts = (t) =>
    norm(t).replace(/(콰이어|합창단|댄서|안무팀)(들)?(?!\s*\d)/g, (m, w) => {
      const k = /콰이어|합창단/.test(w) ? '콰이어' : '댄서';
      return `${w} ${counts[k] ? `${counts[k]}명` : ex('n명')}`;
    });

  // '합창 마이크 4개, 무선 마이크 3개' → { 합창: 4, 무선: 3 }
  const micCounts = (t) => {
    const out = {};
    for (const m of norm(t).matchAll(/(합창|무선|유선|핸드|헤드셋)\s*(?:마이크)?\s*\(?\s*(\d+)\s*\)?\s*(?:개|대|ea)?/gi)) out[m[1]] = (out[m[1]] || 0) + Number(m[2]);
    return out;
  };
  // FX 문장 '수정 후': 많이 쓴 효과 2개에 FX1·FX2를 붙이고, 나머지는 빼고, 스트로브는 짧게, 시각이 없으면 앞에 붙인다
  const fxRank = (() => {
    const uses = new Map();
    for (const r of S.rows) for (const k of [...LIGHT_KEYS, 'details', 'note']) for (const t of FX_TYPES) if (t.re.test(r.c[k] || '')) uses.set(t.key, (uses.get(t.key) || 0) + 1);
    const labeled = new Map();
    for (const r of S.rows) for (const line of norm(r.c.details).split('\n')) {
      const m = line.match(/FX\s*([12])/i);
      if (m) for (const t of FX_TYPES) if (t.re.test(line)) labeled.set(t.key, `FX${m[1]}`);
    }
    const order = [...uses.keys()].sort((a, b) => (labeled.has(b) ? 1 : 0) - (labeled.has(a) ? 1 : 0) || (uses.get(b) || 0) - (uses.get(a) || 0));
    const map = new Map();
    const free = ['FX1', 'FX2'].filter((l) => ![...labeled.values()].includes(l));
    for (const k of order) map.set(k, labeled.get(k) || free.shift() || null);
    return map;
  })();
  const fxLine = (line, row) => {
    const parts = line.split(/,\s*/);
    const out = [];
    const dropped = [];
    for (let p of parts) {
      const t = FX_TYPES.find((x) => x.re.test(p));
      if (t) {
        const lab = fxRank.get(t.key);
        if (!lab) {
          dropped.push(t.name);
          continue;
        }
        // '후렴에서 스트로브 …'처럼 앞에 시점이 있으면 효과 이름 앞에, 아니면 맨 앞에 FX 이름을 붙인다
        if (!/FX\s*[12]/i.test(p)) p = /^\s*\S+(?:에서|에)\s/.test(p) ? p.replace(t.re, (w) => `${lab} ${w}`) : `${lab} ${p.trim()}`;
        if (t.key === 'strobe') p = p.replace(/(\d+)\s*초/, (w, n) => (Number(n) > 3 ? '2초' : w));
      }
      out.push(p);
    }
    const x = xOf(row);
    const time = /\d{1,2}:\d{2}/.test(line) ? '' : x && x.start != null && x.phase !== '전체' && x.phase !== '도입' ? `${fmtClock(x.start)} ` : `${ex('03:38')} `;
    return `${time}${out.join(', ')}${dropped.length ? ` (${dropped.join('·')}은 빼기 — FX는 2개까지)` : ''}`;
  };

  const R = {
    'time:limit': () => {
      const over = S.totalSec - STAGE_LIMIT_SEC;
      const list = S.blocks
        .filter((b) => b.kind === 'stage' || b.kind === 'video')
        .map((b) => ({ b, len: blockLen(b) }))
        .filter((v) => v.len > 0)
        .sort((a, b) => b.len - a.len);
      const pick = list.find((v) => v.b.kind === 'video' && v.len - over >= 20) || list[0];
      return {
        before: `무대 시간 ${fmtDurationKo(S.totalSec)} (11분보다 ${fmtDurationKo(over)} 김)`,
        after: `무대 시간 11분 이내${pick ? ` — 예) ${label(pick.b)} ${fmtDurationKo(pick.len)} → ${fmtDurationKo(pick.len - over)}로 줄이기(여러 순서에서 나눠 줄여도 됨)` : ''}`,
        afterKind: 'example',
      };
    },
    'time:split1': (f, row) => {
      if (!row.rt || !row.rt.ok) return null;
      return { after: splitRows(row.rt.start, row.rt.end, lyricsOf(row)).join('\n'), afterKind: 'example', afterNote: '가사 슬라이드·대형·조명이 바뀌는 지점마다 행을 나누기' };
    },
    'lyrics:long': (f, row) => {
      if (!row.rt || !row.rt.ok) return { after: lyricsOf(row).reduce((a, l, i) => (i % 2 ? `${a} / ${l}` : `${a}${i ? '\n' : ''}[00:00 ~ 00:00] ${l}`), ''), afterKind: 'example' };
      return { after: splitRows(row.rt.start, row.rt.end, lyricsOf(row)).join('\n'), afterKind: 'example', afterNote: '가사 영상 슬라이드(2줄)마다 행을 나누고 Run Time 적기' };
    },
    'time:split': (f, row) => {
      const p = prevTimed(row);
      const b = S.blocks[row.blockIndex];
      const untimed = b.rows.filter((r) => !(r.rt && r.rt.ok) && !r.cont.runtime);
      const next = b.rows.slice(b.rows.indexOf(untimed[untimed.length - 1]) + 1).find((r) => r.rt && r.rt.ok);
      if (!p || !next || next.rt.start <= p.rt.end) return { after: `${ex('00:00')} ~ ${ex('00:00')} (${ex('n')}초)`, afterKind: 'example', afterCell: true };
      const step = (next.rt.start - p.rt.end) / untimed.length;
      return { after: fmtRunTime(p.rt.end, Math.round(p.rt.end + step)), afterKind: 'example', afterCell: true, afterNote: '앞 행 끝 시각부터 이어서' };
    },
    'time:missing': (f, row) => {
      const p = prevTimed(row);
      const s = p ? p.rt.end : null;
      return s == null
        ? { after: `${ex('00:00')} ~ ${ex('01:00')} (${ex('60')}초)`, afterKind: 'example', afterCell: true }
        : { after: `${fmtClock(s)} ~ ${ex(fmtClock(s + 60))} (${ex('60')}초)`, afterKind: 'example', afterCell: true, afterNote: `앞 순서가 ${fmtClock(s)}에 끝나므로 ${fmtClock(s)}부터 — 끝 시각은 실제 길이로` };
    },
    'time:gap': (f, row) => {
      const p = prevTimed(row);
      return p && row.rt.ok ? { after: fmtRunTime(p.rt.end, row.rt.end), afterKind: 'example', afterCell: true, afterNote: `앞 행이 끝나는 ${fmtClock(p.rt.end)}부터 이어지게(그 사이에 일이 있으면 행을 추가)` } : null;
    },
    'time:overlap': (f, row) => {
      const p = prevTimed(row);
      return p && row.rt.ok && row.rt.end > p.rt.end ? { after: fmtRunTime(p.rt.end, row.rt.end), afterKind: 'example', afterCell: true, afterNote: `앞 행이 끝나는 ${fmtClock(p.rt.end)}부터 시작` } : null;
    },
    'time:order': (f, row) => (row.rt.start != null && row.rt.end != null ? { after: fmtRunTime(Math.min(row.rt.start, row.rt.end), Math.max(row.rt.start, row.rt.end)), afterKind: 'example', afterCell: true } : null),
    'time:uncertain': (f, row) => {
      const rt = parseRunTime(norm(row.c.runtime).replace(/(약|±\s*\d+\s*초?|정도|쯤)/g, ''));
      return rt.ok ? { after: fmtRunTime(rt.start, rt.end), afterKind: 'example', afterCell: true, afterNote: '확정된 길이로(±, 약 빼기)' } : null;
    },
    'time:dur': () => ({ after: `${ex('앞 순서 끝 시각')} ~ ${ex('끝 시각')} (n초)`, afterKind: 'guide' }),
    'time:rebase': () => ({ after: '앞 순서 끝 시각부터 이어지는 전체 타임라인 (앞 영상 행에 길이를 적으면 자동 계산)', afterKind: 'guide' }),

    'stage:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const st = stageOf.get(b.index);
      const parts = [];
      if (st) for (const p of st.protags) parts.push(`${p.name} ${p.zoneName ? `무대 ${p.zoneName}` : ex('무대 중앙')}`);
      const d = norm(b.rows.map((r) => r.c.detail).join(' '));
      if (/댄서/.test(d) || (st && st.dancers)) parts.push(`댄서 ${counts['댄서'] ? `${counts['댄서']}명` : ex('n명')} 무대`);
      if (b.kind === 'stage' || /콰이어|합창/.test(d)) parts.push(`콰이어 ${counts['콰이어'] ? `${counts['콰이어']}명` : ex('n명')} 단상`);
      if (!parts.length) parts.push(`${ex('댄서 16명')} 무대`, `${ex('콰이어 24명')} 단상`);
      return { after: parts.join(' / '), afterKind: 'example', afterCell: true };
    },
    'stage:count': (f, row) => {
      const before = originalValue(row, 'stage');
      let after = withCounts(before);
      const all = [counts['콰이어'] ? `콰이어 ${counts['콰이어']}명` : '', counts['댄서'] ? `댄서 ${counts['댄서']}명` : ''].filter(Boolean).join(' · ');
      if (after === before && /(전원|모두|전체)/.test(before)) after = before.replace(/(전원|모두|전체)/, `$1(${all || ex('콰이어 24명 · 댄서 16명')})`);
      return after !== before ? { after, afterKind: 'example', afterCell: true } : { after: `${before} → ${ex('콰이어 24명 단상 / 댄서 16명 무대')}처럼 인원 수를 함께`, afterKind: 'guide' };
    },
    'wait:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const next = nextBlockStage(b);
      const st = next && stageOf.get(next.index);
      const waiting = st && st.dancers && b.kind === 'video' ? `댄서 ${st.dancers}명` : null;
      return { after: waiting || 'X', afterKind: 'example', afterCell: true, afterNote: '무대 아래 대기 인원이 없으면 X, 있으면 인원 수' };
    },
    'wait:num': (f, row) => {
      const before = originalValue(row, 'waiting');
      const after = withCounts(before);
      return { after: after !== before ? after : `${before} ${ex('n명')}`, afterKind: 'example', afterCell: true };
    },

    'detail:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      if (b.kind === 'video') {
        const next = nextBlockStage(b);
        const nst = next && stageOf.get(next.index);
        const p0 = nst && nst.protags[0];
        const from = p0 && p0.move ? (p0.move.match(/([가-힣A-Za-z0-9]+(?:\s[가-힣A-Za-z0-9]+){0,3})에서/) || [])[1] : '';
        const who = p0 ? `${josa(p0.name, '은/는')} ${from || (p0.zoneName ? `무대 ${p0.zoneName}` : ex('무대 왼쪽 계단 아래'))}` : '';
        const dancers = counts['댄서'] ? `댄서 ${counts['댄서']}명` : `댄서 ${ex('n명')}`;
        return { after: `${josa(label(b), '이/가')} 나오는 동안 ${dancers}은 ${ex('무대 양 옆')}에서 ${next ? `${label(next)} ` : ''}첫 대형 위치로 이동해 대기${who ? `, ${who}에서 대기` : ''}`, afterKind: 'example', afterCell: true };
      }
      const x = xOf(row);
      const st = stageOf.get(b.index);
      const t = x && x.start != null ? `${fmtClock(x.start)} ` : '';
      const cue = x && x.lyrics.length ? `가사 "${shortLyric(x.lyrics[0], 3)}"에 맞춰 ` : x && x.phase === '도입' ? '전주가 시작되면 ' : '';
      const who = st && st.dancers ? `댄서 ${st.dancers}명이` : counts['댄서'] ? `댄서 ${counts['댄서']}명이` : `${ex('댄서 16명')}이`;
      const choir = st && st.choir ? `, 콰이어 ${st.choir}명은 단상에서 노래` : '';
      return { after: `${t}${cue}${who} ${ex('무대 중앙')}에서 ${ex('2줄 대형으로 안무')}${choir}`, afterKind: 'example', afterCell: true };
    },
    'detail:vague': (f, row) => {
      const x = xOf(row);
      const b = S.blocks[row.blockIndex];
      const st = stageOf.get(b.index);
      const before = originalValue(row, 'detail');
      const t = x && x.start != null ? `${fmtClock(x.start)} ` : '';
      const cue = x && x.lyrics.length ? `가사 "${shortLyric(x.lyrics[0], 3)}"에 맞춰 ` : '';
      const who = /댄서|안무/.test(before) || (x && x.dance) ? (st && st.dancers ? `댄서 ${st.dancers}명이` : `댄서 ${counts['댄서'] ? `${counts['댄서']}명` : ex('n명')}이`) : /합창|노래|콰이어/.test(before) ? `콰이어 ${st && st.choir ? `${st.choir}명` : ex('n명')}이` : `${ex('댄서 16명')}이`;
      const what = /합창|노래/.test(before) && !/안무/.test(before) ? `단상에서 ${ex('3줄로 서서')} 노래` : `${ex('무대 중앙')}에서 ${ex('2줄 대형')}으로 ${/안무|춤/.test(before) ? '안무' : ex('동작')}`;
      return { after: `${t}${cue}${who} ${what}${/전체|단체/.test(before) ? `, ${ex('후렴에 가운데 4명이 앞으로 나옴')}` : ''}`, afterKind: 'example', afterCell: true };
    },
    'lyrics:blank': (f, row) => {
      const x = xOf(row);
      const dance = x && x.dance;
      return { after: dance || (x && x.phase === '도입') ? '간주' : `${ex('그 구간의 가사')} (가사가 없으면 간주, 노래 없이 동작만 있으면 X)`, afterKind: 'example', afterCell: dance || (x && x.phase === '도입') };
    },

    'sound:blank': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      if (!st) return { after: `합창 마이크 ${ex('4')}개 (단상 앞)`, afterKind: 'example', afterCell: true };
      const sing = st.rows.some((x) => x.singing);
      const lines = [];
      if (sing) lines.push(`합창 마이크 ${micsFor(st.choir)}개 (단상 앞${st.choir ? `, 콰이어 ${st.choir}명` : ''})`);
      const singers = st.protags.filter((p) => p.sings);
      if (singers.length) lines.push(`무선 마이크 ${Math.min(2, singers.length)}개 (${singers.map((p) => p.name).join(', ')})`);
      for (const inst of st.instruments) lines.push(`${inst} ${/(기타|피아노|건반|키보드|베이스)/.test(inst) ? 'DI' : '마이킹'} 1개`);
      if (st.dialogue) lines.push(`핸드 마이크 1개 (${ex('내레이션')})`);
      return { after: lines.length ? lines.join('\n') : 'X (마이크 사용 안 함)', afterKind: 'example', afterCell: true };
    },
    'sound:count': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = originalValue(row, 'sound');
      const n = micsFor(st && st.choir);
      const after = before
        .replace(/(합창\s*마이크)(?!\s*\d)/g, `$1 ${n}개${st && st.choir ? ` (콰이어 ${st.choir}명)` : ''}`)
        .replace(/((?:무선|유선|핸드|솔로)\s*마이크)(?!\s*\d)/g, `$1 ${ex('1')}개`)
        .replace(/^마이크(?!\s*\d)/, `마이크 ${ex('n')}개`);
      return { after: after !== before ? after : `${before} ${ex('4')}개`, afterKind: 'example', afterCell: true };
    },
    'sound:wireless': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = originalValue(row, 'sound');
      const who = st && st.protags.length ? st.protags.slice(0, 2).map((p) => p.name).join(', ') : ex('주인공, 솔로 1');
      return { after: before.replace(/무선\s*마이크\s*\(?\s*\d+\s*\)?\s*개?/, `무선 마이크 2개 (${who})`), afterKind: 'example', afterCell: true, afterNote: '기본 2대 — 더 필요하면 TFT 음향팀과 확인' };
    },
    'sound:who': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = originalValue(row, 'sound');
      const who = st && st.protags.length ? st.protags.map((p) => p.name).join(', ') : ex('솔로 1, 솔로 2');
      const after = before.replace(/((?:무선|유선|핸드|솔로)\s*마이크\s*\d+\s*개)(?!\s*\()/, `$1 (${who})`);
      return { after: after !== before ? after : `${before}\n(${who} 사용 · ${ex('00:52')}에 ON)`, afterKind: 'example', afterCell: true };
    },
    'sound:inst': (f, row) => {
      const before = originalValue(row, 'sound');
      const b = S.blocks[row.blockIndex];
      const inst = (b.rows.map((r) => `${r.c.sound} ${r.c.detail} ${r.c.note}`).join(' ').match(INSTRUMENT_RE) || [])[0] || '악기';
      return { after: `${before}\n${inst} ${/(기타|피아노|건반|키보드|베이스)/.test(inst) ? 'DI' : '마이킹'} 1개`, afterKind: 'example', afterCell: true };
    },
    'sound:fd': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const cur = b.kind === 'stage' ? b : nextBlockStage(b) || b;
      const prev = [...S.blocks.slice(0, cur.index)].reverse().find((x) => x.kind === 'stage');
      const st = stageOf.get(cur.index);
      const people = st ? st.protags.filter((p) => p.sings) : [];
      const to = people.length ? people.map((p) => `${p.name}${p.zoneName ? `(무대 ${p.zoneName})` : ''}`).join(', ') : ex('솔로 1');
      const a = micCounts(prev ? prev.rows.map((r) => r.c.sound).join('\n') : '');
      const z = micCounts(cur.rows.map((r) => r.c.sound).join('\n'));
      const acts = [];
      for (const k of new Set([...Object.keys(a), ...Object.keys(z)])) {
        const d = (z[k] || 0) - (a[k] || 0);
        if (d > 0) acts.push(k === '무선' || k === '핸드' ? `${k} 마이크 ${d}개를 ${to}에게 전달` : `${k} 마이크 ${d}개를 ${ex('단상 앞')}에 세팅`);
        if (d < 0) acts.push(`${k} 마이크 ${-d}개 회수`);
      }
      const when = b.kind === 'video' ? `${josa(label(b), '이/가')} 송출되는 동안` : '무대 전환 중';
      return { after: `${when} FD가 ${acts.length ? acts.join(', ') : `${ex('합창 마이크 4개를 단상 앞')}에 세팅, 무선 마이크 1개를 ${to}에게 전달`}`, afterKind: 'example', afterCell: true };
    },
    'screen:blank': (f, row) => {
      const b = S.blocks[row.blockIndex];
      const st = stageOf.get(b.index);
      const sing = st && st.rows.some((x) => x.singing);
      const n = S.blocks.filter((x) => x.kind === 'stage' && x.index <= b.index).length;
      return { after: sing ? `가사 영상 ${n}` : 'X (검은 화면)', afterKind: 'example', afterCell: true, afterNote: sing ? '가사를 띄운다면 가사 영상, 아니면 PPT / X' : '' };
    },

    'light:none': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      if (!st) return null;
      const lines = st.rows.slice(0, 4).map((x) => {
        const p = lightPlanRow(st, x);
        const pins = Object.keys(p.pins).map((k) => `${PIN_POS[k].name} ON`).join(' · ');
        return `${x.start != null ? `${span2(x)} ` : ''}무대 ${p.lStage} · 상단 ${p.lTop}${pins ? ` · ${pins}` : ''} · Details: ${p.cue}`;
      });
      if (st.rows.length > 4) lines.push(`… 나머지 ${st.rows.length - 4}행도 같은 방식으로`);
      return { after: lines.join('\n'), afterKind: 'example', afterNote: `${st.mood.name ? `${st.mood.name} 곡이라 상단 ${st.mood.top}` : '상단 색 하나를 정해'} 도입은 어둡게, 절정은 밝게` };
    },
    'light:details': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const x = xOf(row);
      if (!st || !x) return null;
      const said = describeRowLight(st, x);
      if (said) return { after: said, afterKind: 'example', afterCell: true, afterNote: '이 행의 조명 칸을 말로 풀어 언제·어떻게 바뀌는지' };
      return { after: lightPlanRow(st, x).details, afterKind: 'example', afterCell: true, afterNote: '조명이 정해지면 언제·어떻게 바뀌는지' };
    },
    'light:transition': (f, row) => {
      const x = xOf(row);
      const before = originalValue(row, 'details');
      const how = x && x.phase === '절정' ? '즉시' : x && x.phase === '마무리' ? '3초에 걸쳐 서서히' : x && x.phase === '도입' ? '2초에 걸쳐 서서히' : '즉시';
      return { after: before ? `${before} (${how} 바꾸기)` : `${how} 바꾸기`, afterKind: 'example', afterCell: true };
    },
    'light:subjective': (f, row) => {
      const x = xOf(row);
      const before = originalValue(row, 'details');
      const phrase = (before.match(SUBJECTIVE_RE) || [''])[0];
      const cue = x && x.lyrics.length ? `가사 "${shortLyric(x.lyrics[0], 3)}" 시작과 동시에` : x && x.start != null ? `${fmtClock(x.start)}에` : ex('출연자 전원이 무대 중앙에 정렬한 후');
      const t = x && x.start != null && !/^\d{1,2}:\d{2}/.test(before) ? `${fmtClock(x.start)} ` : '';
      // '분위기가 고조될 때' 처럼 뒤에 붙은 말(될 때, 에, 하면)까지 한꺼번에 바꾼다
      const clause = phrase ? new RegExp(`${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\S*(?:\\s*(?:때|에|면))?`) : null;
      return { after: `${t}${clause ? before.replace(clause, cue) : `${cue} ${before}`}`.replace(/\s+/g, ' ').trim(), afterKind: 'example', afterCell: true };
    },
    'light:zone': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const before = originalValue(row, f.key);
      const sentence = /[가-힣]{2,}(?:주세요|합니다|됩니다|니다|해요|하기|켜기|in|out)\.?$/i.test(norm(before)) || /(서서히|즉시|fade)/i.test(before);
      return { after: fillZone(row.c[f.key] || before, f.key, st, xOf(row)), afterKind: f.fixId && f.fixEnabled ? 'auto' : 'example', afterCell: true, afterNote: sentence ? '언제·어떻게 바뀌는지 쓴 문장은 Details 칸으로 옮기기' : '' };
    },
    'light:pinfollow': (f, row) => {
      const st = stageOf.get(row.blockIndex);
      const p = st && (st.protags.find((q) => q.pin) || st.protags[0]);
      const pin = p && p.pin ? PIN_POS[p.pin] : PIN_POS[f.key] || PIN_POS.pin3;
      const who = p ? p.name : ex('주인공');
      const d = originalValue(row, 'details');
      return { before: /따라/.test(d) ? d : originalValue(row, f.key), after: `${josa(who, '이/가')} ${pin.where}(${pin.name} 자리)에 서면 ${pin.name} ON — 걸어오는 동안은 무대 조명 구역을 차례로 켜기`, afterKind: 'example', afterNote: '핀은 따라가지 않고 정해진 자리만 비춤' };
    },
    'light:pinloc': (f, row) => {
      const key = originalValue(row, f.key) ? f.key : PIN_KEYS.find((k) => originalValue(row, k)) || f.key;
      const before = originalValue(row, key);
      const z = LOC_WORDS.find((w) => w.re.test(before));
      const place = z ? (before.match(z.re) || [''])[0] : '';
      const better = z && Object.values(PIN_POS).find((p) => p.zone === z.zone);
      const pinName = PIN_POS[key] ? PIN_POS[key].name : 'Pin';
      return better
        ? { before, after: `${pinName}: X / ${better.name}: ON (${better.where})`, afterKind: 'example' }
        : { before, after: `${pinName}: X — Details에 'FX${ex('1')} 추가 핀: ${place || ex('객석 통로')}'으로 요청`, afterKind: 'example', afterNote: 'Pin1~4는 무대 위 고정 위치만 비춤' };
    },
    'light:pingroup': (f, row) => {
      const key = originalValue(row, f.key) ? f.key : PIN_KEYS.find((k) => originalValue(row, k)) || f.key;
      f.key = key;
      const before = originalValue(row, key);
      const z = LOC_WORDS.find((w) => w.re.test(before));
      const zone = /(콰이어|합창|단상|전원|전체)/.test(before) ? '전체' : z ? { left: '왼쪽', right: '오른쪽', center: '중앙', back: '전체' }[z.zone] || '전체' : ex('왼쪽');
      const color = (before.match(COLOR_WORD_RE) || ['흰색'])[0];
      const pct = (before.match(/\d{1,3}\s*%/) || ['70%'])[0];
      return { before, after: `${PIN_POS[key] ? `${PIN_POS[key].name}: X / ` : ''}무대: ${zone} / ${color} / ${pct}`, afterKind: 'example', afterNote: '그룹은 무대 조명 구역으로, 핀은 1명만' };
    },
    'light:pincolor': () => ({ after: 'ON (색이 필요한 연출은 무대·상단 조명이나 FX로)', afterKind: 'example', afterCell: true }),
    'light:hspan': (f) => ({ after: '무대 / 상단 / Pin1~4 / Details 칸마다 나눠 적기', afterKind: 'guide' }),
    'light:outside': (f, row) => ({ after: `${fmtClock(row.rt.start)}~${fmtClock(row.rt.end)} 안의 시각으로 고치거나, 그 시각의 행으로 옮기기`, afterKind: 'guide' }),
    'light:nosheet': () => ({ before: '조명 칸이 모두 비어 있음', after: '행마다 무대 / 상단 / Pin1~4 / Details — 쓰지 않는 조명은 X', afterKind: 'guide' }),

    'fx:toomany': () => {
      const types = (S.fx && S.fx.types) || [];
      const name = (k) => (FX_TYPES.find((t) => t.key === k) || { name: k }).name;
      const keep = types.filter((k) => fxRank.get(k)).sort((a, b) => fxRank.get(a).localeCompare(fxRank.get(b)));
      const drop = types.filter((k) => !fxRank.get(k));
      return {
        before: `FX ${types.length}종류: ${types.map(name).join(', ')}`,
        after: `${keep.map((k) => `${fxRank.get(k)} = ${name(k)}`).join(', ')}${drop.length ? ` (${drop.map(name).join('·')}은 빼거나 무대·상단 조명으로)` : ''}`,
        afterKind: 'example',
      };
    },
    'fx:unlabeled': (f, row) => {
      const before = originalValue(row, f.key);
      const t = FX_TYPES.find((x) => f.id.endsWith(`:${x.key}`));
      const line = before.split('\n').find((l) => t && t.re.test(l)) || before;
      return { before: line, after: fxLine(line, row), afterKind: 'example', afterNote: 'FX는 2개까지 · 언제 / 어떤 효과(FX1) / 얼마나' };
    },
    'fx:undefined': (f, row) => {
      const n = f.id.split(':')[2];
      const line = originalValue(row, 'details').split('\n').find((l) => new RegExp(`FX\\s*${n}`, 'i').test(l)) || '';
      return { before: line, after: `${line ? `${line}\n` : ''}※ FX${n} = ${ex('스트로브')} (스트로브 · 고보 · 무빙 · 추가 핀 중 하나)`, afterKind: 'example', afterNote: '화면 위 FX 지정에서 고르면 수정본에 함께 적힘' };
    },
    'fx:strobe': (f, row) => {
      const before = originalValue(row, f.key);
      const line = before.split('\n').find((l) => /스트로브|strobe/i.test(l)) || before;
      return { before: line, after: fxLine(line, row), afterKind: 'example', afterNote: '스트로브는 1~3초로 짧게' };
    },
    'fx:pinmoving': () => ({ after: 'Pin: X / Details: FX1 무빙 — 언제·어디를·얼마나', afterKind: 'example' }),
    'fx:outside': (f, row) => ({ after: `Details: ${one(originalValue(row, f.key))}`, afterKind: 'example' }),
  };

  function span2(x) {
    return x.start != null && x.end != null ? `${fmtClock(x.start)}~${fmtClock(x.end)}` : '';
  }

  for (const f of ctx.findings) {
    const row = f.rowId ? rowById.get(f.rowId) : null;
    const fix = f.fixId ? ctx.fixes.get(f.fixId) : null;
    // 1) 규칙이 직접 만든 '수정 후'
    if (f.after) {
      f.before = f.before ?? (row && f.key ? originalValue(row, f.key) : '');
      f.afterKind = f.afterKind || 'example';
      continue;
    }
    // 2) 자동 수정: 실제로 바뀐 값
    const own = fix && row && f.key ? fix.cells.find((c) => c.rowId === row.id && c.key === f.key) : null;
    // 칸 하나에 대한 피드백은 그 칸이 바뀐 경우에만 자동 수정 값을 보여준다
    if (fix && fix.cells.length && (own || !(row && f.key))) {
      const cell = own || fix.cells[0];
      f.before = norm(cell.before);
      f.after = norm(cell.after);
      f.afterKind = f.fixEnabled === false ? 'off' : 'auto';
      if (!own || fix.cells.length > 1) {
        f.pairs = fix.cells.slice(0, 3).map((c) => ({ loc: loc(c.rowId, c.key), before: one(c.before), after: one(c.after) }));
        f.pairsMore = Math.max(0, fix.cells.length - 3);
      }
      continue;
    }
    // 3) 규칙별 예시
    const kind = f.id.split(':').slice(0, 2).join(':');
    const make = R[kind];
    let out = null;
    try {
      out = make ? make(f, row) : null;
    } catch {
      out = null; // 예시를 못 만들어도 피드백 자체는 그대로
    }
    if (out && out.after) {
      f.before = out.before ?? (row && f.key ? originalValue(row, f.key) : '');
      f.after = out.after;
      f.afterKind = out.afterKind || 'example';
      f.afterCell = !!out.afterCell && !!row && !!f.key;
      if (out.afterNote) f.afterNote = out.afterNote;
    } else if (f.suggestion) {
      f.before = row && f.key ? originalValue(row, f.key) : '';
      f.after = String(f.suggestion).replace(/^예\)\s*/, '');
      f.afterKind = /^예\)/.test(f.suggestion) ? 'example' : 'guide';
    }
  }
}

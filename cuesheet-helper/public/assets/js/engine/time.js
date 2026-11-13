// Run Time 파싱/포맷 유틸
// 표준 표기: "00:00 ~ 00:04 (4초)"  (OT 자료 '무대 큐시트 작성 예시' 기준: 시작 ~ 끝 + 단시(n초))

// 시각 토큰: 1:30, 01:30, 01: 32(공백 오타), 1:02:03(시:분:초)
const CLOCK_RE = /(?<![\d#A-Za-z])(\d{1,2})\s*[:：]\s*(\d{2})(?:[:：](\d{2}))?(?![\d%A-Za-z])/g;

export function findClockTokens(text) {
  const out = [];
  if (!text) return out;
  const s = String(text);
  CLOCK_RE.lastIndex = 0;
  let m;
  while ((m = CLOCK_RE.exec(s))) {
    let sec;
    if (m[3] !== undefined) sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    else {
      if (Number(m[2]) >= 60) continue;
      sec = Number(m[1]) * 60 + Number(m[2]);
    }
    out.push({ sec, index: m.index, length: m[0].length, raw: m[0] });
  }
  return out;
}

export function parseClock(text) {
  const t = findClockTokens(text);
  return t.length ? t[0].sec : null;
}

export function fmtClock(sec) {
  if (sec == null || Number.isNaN(sec)) return '';
  const neg = sec < 0;
  let s = Math.abs(Math.round(sec));
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return (neg ? '-' : '') + body;
}

export function fmtDurationKo(sec) {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m && s) return `${m}분 ${s}초`;
  if (m) return `${m}분`;
  return `${s}초`;
}

export function fmtRunTime(start, end) {
  return `${fmtClock(start)} ~ ${fmtClock(end)} (${end - start}초)`;
}

// "1분 22초", "2분", "30초", "120초", 2', 1'40'', 50''
export function parseDurationText(text) {
  if (!text) return null;
  const s = String(text);
  let m = s.match(/(\d+)\s*분\s*(?:(\d+)\s*초)?/);
  if (m) return Number(m[1]) * 60 + (m[2] ? Number(m[2]) : 0);
  m = s.match(/(\d+)\s*초/);
  if (m) return Number(m[1]);
  const t = s.replace(/[’‘`]/g, "'").replace(/[”“]/g, '"').replace(/''/g, '"');
  m = t.match(/(\d+)\s*'\s*(\d+)\s*"/); // 1'40''
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  m = t.match(/(\d+)\s*"/); // 50''
  if (m) return Number(m[1]);
  m = t.match(/(\d+)\s*'/); // 2'
  if (m) return Number(m[1]) * 60;
  return null;
}

// Run Time 셀 해석
// 반환: { raw, start, end, stated, durOnly, uncertain, ok, empty }
export function parseRunTime(text) {
  const raw = (text || '').trim();
  const res = { raw, start: null, end: null, stated: null, durOnly: false, uncertain: false, ok: false, empty: !raw };
  if (!raw) return res;
  res.uncertain = /±|약\s*\d|정도|미정|\?/.test(raw);
  const tokens = findClockTokens(raw);
  // 괄호 안이나 시각 토큰 밖에 적힌 단시
  let rest = raw;
  for (let i = tokens.length - 1; i >= 0; i--) {
    const t = tokens[i];
    rest = rest.slice(0, t.index) + ' '.repeat(t.length) + rest.slice(t.index + t.length);
  }
  res.stated = parseDurationText(rest);
  if (tokens.length >= 2) {
    res.start = tokens[0].sec;
    res.end = tokens[1].sec;
    res.ok = res.end > res.start;
  } else if (tokens.length === 1) {
    res.start = tokens[0].sec;
    if (res.stated != null) {
      res.end = res.start + res.stated;
      res.ok = true;
    }
  } else if (res.stated != null) {
    res.durOnly = true;
  }
  return res;
}

// 텍스트 안의 시각 토큰을 함수로 변환 (조명 큐 시간 보정용)
export function shiftClocksInText(text, fn) {
  if (!text) return text;
  const tokens = findClockTokens(text);
  if (!tokens.length) return text;
  let out = '';
  let last = 0;
  for (const t of tokens) {
    out += text.slice(last, t.index) + fmtClock(fn(t.sec));
    last = t.index + t.length;
  }
  return out + text.slice(last);
}

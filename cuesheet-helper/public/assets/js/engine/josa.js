// 한국어 조사 자동 선택 (을/를, 이/가, 은/는, 과/와, 으로/로)
const DIGIT_BATCHIM = { 0: true, 1: true, 2: false, 3: true, 4: false, 5: false, 6: true, 7: true, 8: true, 9: false };
const DIGIT_RIEUL = { 1: true, 7: true, 8: true };

function lastChar(word) {
  let w = String(word || '').trim();
  // 끝의 괄호·따옴표 부분은 건너뜀: "무대 3(113초)" → "무대 3"
  for (let i = 0; i < 3; i++) {
    const m = w.match(/^(.*?)\s*(\([^()]*\)|\[[^\[\]]*\]|'[^']*'|"[^"]*")\s*$/);
    if (m && m[1]) w = m[1];
    else break;
  }
  w = w.replace(/[\s'"’”)\]]+$/, '');
  return w.slice(-1);
}

function info(word) {
  const ch = lastChar(word);
  if (!ch) return { batchim: false, rieul: false };
  const code = ch.charCodeAt(0);
  if (code >= 0xac00 && code <= 0xd7a3) {
    const jong = (code - 0xac00) % 28;
    return { batchim: jong !== 0, rieul: jong === 8 };
  }
  if (/\d/.test(ch)) return { batchim: DIGIT_BATCHIM[ch], rieul: !!DIGIT_RIEUL[ch] };
  if (/[lmnr]/i.test(ch)) return { batchim: true, rieul: /[lr]/i.test(ch) };
  return { batchim: false, rieul: false };
}

// josa('무대 중앙', '을/를') → '무대 중앙을'
export function josa(word, pair) {
  const [a, b] = pair.split('/');
  const { batchim, rieul } = info(word);
  if (pair === '으로/로') return `${word}${batchim && !rieul ? '으로' : '로'}`;
  return `${word}${batchim ? a : b}`;
}

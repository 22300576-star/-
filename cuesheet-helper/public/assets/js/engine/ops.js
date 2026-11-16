// 반영 작업(ops)을 칸 값에 적용하는 규칙 — 화면의 '수정 후'와 실제 반영이 같은 규칙을 쓴다
import { norm, OFF_ONLY_RE } from './vocab.js';
import { PLACEHOLDER } from './constants.js';

// [ ] 안은 학부만 아는 내용이라 예로 넣은 부분
export const EX_RE = /\[[^\]\n]{1,40}\]/;

// op: { set } 칸을 통째로 · { append } 새 줄로 더하기(빈칸·X면 바꾸기) · { suffix } 끝에 붙이기 · { replace: [from, to] } 한 줄 바꾸기
export function applyText(curText, op) {
  const c = norm(curText) === PLACEHOLDER ? '' : norm(curText);
  if (op.set !== undefined) return op.set;
  if (op.append !== undefined) return !c || OFF_ONLY_RE.test(c) || /^X$/i.test(c) ? op.append : `${c}\n${op.append}`;
  if (op.suffix !== undefined) return c ? `${c}${op.suffix}` : op.suffix.trim();
  if (op.replace) {
    const [from, to] = op.replace;
    if (!from) return to;
    return c.includes(from) ? c.replace(from, to) : c;
  }
  return c;
}

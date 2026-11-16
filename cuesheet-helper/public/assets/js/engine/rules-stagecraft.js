// 무대 내용을 보고 하는 점검 (연출)
//  - 조명 Details: 학부가 주인공을 쓰면 주인공의 동선 · 의상 · 위치를 구체적으로 (TFT 기준)
//  - 음향: 노래하는 구간에 마이크가 있는지, 노래하는 주인공·솔로에게 마이크가 있는지
import { addFinding } from './context.js';
import { josa } from './josa.js';
import { fmtClock } from './time.js';
import { norm, isBlank, OFF_ONLY_RE, MIC_RE, HANDHELD_RE } from './vocab.js';
import { PIN_POS } from './constants.js';
import { POS_TEXT_RE, MOVE_TEXT_RE, STAY_TEXT_RE, COSTUME_RE, MAIN_CHAR_RE } from './content.js';

const WHY_PROTAG = "TFT 조명 Details 기준(주인공이 있는 학부): 주인공이 어떤 동선으로 움직이고, 어떤 의상을 입고, 어느 위치에 있는지 구체적으로 · 2026 큐시트 4행: 디테일한 '동선' 포인트로 작성";
const WHY_SOUND = "2026 큐시트 4행: '어떤 음향 장비를 몇 개 사용하실 건지 정확하게' · 2025 공시 큐시트(노래하는 사람마다 마이크 지정)";

const hasText = (t) => !isBlank(t) && !OFF_ONLY_RE.test(norm(t)) && !/^X\b/.test(norm(t));
const segsOf = (t) => norm(t).split(/[\n.,]|(?:\s\/\s)/).map((s) => s.trim()).filter(Boolean);
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 합창 마이크 개수 제안: 6명당 1개(최소 2개, 최대 6개)
export const micsFor = (n) => (n ? Math.min(6, Math.max(2, Math.ceil(n / 6))) : 4);

// 주인공 동선 · 의상 · 위치가 Details에 있는지
export function protagCheck(detailsText, name) {
  const nameRe = new RegExp(escRe(name));
  const segs = segsOf(detailsText);
  const about = segs.some((s) => nameRe.test(s));
  if (!about) return { about, missing: ['동선', '의상', '위치'] };
  const missing = [];
  if (!segs.some((s) => (MOVE_TEXT_RE.test(s) && (POS_TEXT_RE.test(s) || /→/.test(s))) || STAY_TEXT_RE.test(s))) missing.push('동선');
  if (!COSTUME_RE.test(detailsText)) missing.push('의상');
  if (!POS_TEXT_RE.test(detailsText)) missing.push('위치');
  return { about, missing };
}

// 주인공 조명 Details '수정 후' 예시 — 원래 문장이 충분하면 빠진 것만 더하고, 거의 없으면 새로 쓴다
// [ ] 안은 학부만 알 수 있어 예시로 넣은 부분
export function protagAfter(orig, p, row, missing) {
  const t = norm(orig);
  const name = p.name;
  const nameRe = new RegExp(escRe(name));
  const costume = p.costume ? p.costume : '[흰 드레스]';
  const pinName = p.pin ? PIN_POS[p.pin].name : '[Pin3]';
  const pos = p.zoneName ? `무대 ${p.zoneName}${p.pin ? `(${PIN_POS[p.pin].name} 자리)` : ''}` : '[무대 중앙(Pin3 자리)]';
  const rt = row && row.rt && row.rt.ok ? `${fmtClock(row.rt.start)} ` : '';
  // 세부 내용의 주인공 동선을 가져옴: '주인공 1명이 …', '주인공3이 …', '주인공(김신&은탁)이 …'
  const lead = new RegExp(`^(${escRe(name)})\\s*(\\([^)]*\\))?\\s*(\\d+)?\\s*(\\d+\\s*명)?\\s*(?:이|가|은|는)?\\s+`);
  const m = p.move ? p.move.match(lead) : null;
  const moveText = m ? p.move.slice(m[0].length) : '[무대 왼쪽 계단에서 무대 중앙으로 걸어 나옴]';
  const paren = m && m[2] ? m[2].slice(1, -1) : '';
  const who = `${name}${m && m[3] ? m[3] : ''}${m && m[4] && !/^1\s*명/.test(m[4]) ? ` ${m[4].replace(/\s+/g, '')}` : ''}(${paren ? `${paren}, ` : ''}${costume})`; // '주인공 1명'은 '주인공'으로
  const sentence = `${rt}${josa(who, '이/가')} ${moveText} → ${pos}에 서면 ${pinName} 즉시 ON`;
  const core = t.replace(new RegExp(escRe(name), 'g'), '').replace(/[\s\d:~.,/()-]/g, '');
  if (!t || core.length < 12 || !nameRe.test(t)) {
    // 원래 Details가 거의 없거나 주인공 이야기가 없으면: 주인공 문장을 맨 앞에, 원래 내용은 다음 줄에
    return { text: `${sentence}${t && core.length >= 12 ? `\n${t}` : ''}`, mode: 'rewrite' };
  }
  // 원래 문장은 그대로 두고 빠진 것만 더한다
  let out = t;
  if (missing.includes('의상')) out = out.replace(nameRe, (w) => `${w}(${costume})`);
  const add = [];
  if (missing.includes('동선')) add.push(`동선: ${moveText}`);
  if (missing.includes('위치')) add.push(`위치: ${pos}`);
  if (add.length) out = `${out}\n${name} ${add.join(' / ')}`;
  return { text: out, mode: 'add' };
}

export function stagecraftRules(ctx, stages) {
  for (const st of stages) {
    const b = st.block;

    // ---- 조명 Details: 주인공 동선 · 의상 · 위치 (학부가 주인공을 쓰는 무대만) ----
    for (const p of st.protags.filter((x) => MAIN_CHAR_RE.test(x.name))) {
      const rows = b.rows.filter((r) => !r.cont.details && hasText(r.c.details));
      if (!rows.length) continue; // Details가 모두 비어 있으면 'Details 빈칸' 피드백에서 다룬다
      const nameRe = new RegExp(escRe(p.name));
      const about = rows.filter((r) => nameRe.test(r.c.details));
      const scope = (about.length ? about : rows).map((r) => r.c.details).join('\n');
      const { missing } = about.length ? protagCheck(scope, p.name) : { missing: ['동선', '의상', '위치'] };
      if (!missing.length) continue;
      // 주인공이 처음 나오는 행(그 행 Details가 있으면) → 주인공이 언급된 Details 행 → 첫 Details 행
      const row = (p.firstRow && rows.includes(p.firstRow) && p.firstRow) || about[0] || rows[0];
      const after = protagAfter(row.c.details, p, row, missing);
      addFinding(ctx, {
        id: `light:protag:${b.index}:${p.name}`,
        cat: 'light',
        level: 'warn',
        rowId: row.id,
        key: 'details',
        title: about.length ? `조명 Details에 ${p.name}의 ${josa(missing.join('·'), '이/가')} 없음` : `조명 Details에 ${josa(p.name, '이/가')} 나오지 않음`,
        msg: `${st.label}에 ${josa(p.name, '이/가')} 나옵니다. 조명팀이 ${josa(p.name, '을/를')} 정확히 비추려면 Details에 ${p.name}의 ① 동선(어디에서 어디로, 언제 움직이는지) ② 의상(색·종류) ③ 위치(무대 중앙·Pin3 자리처럼 서는 곳)를 구체적으로 적어야 합니다. 지금은 ${josa(missing.join(', '), '이/가')} 빠져 있습니다.`,
        why: WHY_PROTAG,
        after: after.text,
        afterCell: true,
      });
    }

    // ---- 음향: 노래하는 구간 · 노래하는 주인공·솔로의 마이크 ----
    const sound = norm(st.sound);
    if (isBlank(sound)) continue; // '음향 장비가 적혀 있지 않음'에서 다룬다
    const sing = st.rows.filter((x) => x.singing);
    const r0 = b.rows.find((r) => !r.cont.sound && !isBlank(r.c.sound)) || b.rows[0];
    const singers = st.protags.filter((p) => p.sings);
    const orig = norm(r0.c.sound);
    if (sing.length && !MIC_RE.test(sound)) {
      addFinding(ctx, {
        id: `sound:sing:${b.index}`,
        cat: 'sound',
        level: 'warn',
        rowId: r0.id,
        key: 'sound',
        title: '노래하는 구간이 있는데 마이크가 없음',
        msg: `${st.label}에서 ${sing[0].start != null ? `${fmtClock(sing[0].start)}부터 ` : ''}가사를 부르는데 음향/FD 칸에 마이크가 없습니다. 부르는 인원에 맞춰 합창 마이크 개수를 적어주세요${singers.length ? `. ${singers.map((p) => p.name).join('·')}의 노래에는 무선 마이크도 필요합니다` : ''}.`,
        why: WHY_SOUND,
        after: [`합창 마이크 ${micsFor(st.choir)}개 (단상 앞${st.choir ? `, 콰이어 ${st.choir}명` : ''})`, ...singers.map((p) => `무선 마이크 1개 (${p.name})`)].join('\n'),
        afterCell: true,
      });
    } else if (singers.length && !HANDHELD_RE.test(sound)) {
      addFinding(ctx, {
        id: `sound:solo:${b.index}`,
        cat: 'sound',
        level: 'warn',
        rowId: r0.id,
        key: 'sound',
        title: `${josa(singers.map((p) => p.name).join('·'), '이/가')} 노래하는데 솔로 마이크가 없음`,
        msg: `${singers.map((p) => p.name).join('·')}의 노래는 합창 마이크로는 잘 잡히지 않습니다. 노래하는 사람마다 무선(핸드) 마이크를 적고, 언제 켜는지 함께 적어주세요.${singers.some((p) => p.move) ? ' 움직이면서 부르면 무선 마이크가 필요합니다.' : ''}${singers.length > 2 ? ' 행사 기본 무선 마이크는 2대이므로 번갈아 쓰는 순서도 적어주세요.' : ''}`,
        why: WHY_SOUND,
        after: `${orig}\n무선 마이크 ${Math.min(2, singers.length)}개 (${singers.map((p) => p.name).join(', ')}${singers.length > 2 ? ' — 번갈아 사용' : ''})`,
        afterCell: true,
      });
    }
  }
}

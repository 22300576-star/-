import { josa } from './josa.js';
// 무대 / 대기 인원 / 세부 내용 / 개사 / 음향·FD / 화면 / 양식 규칙
// 근거: OT '무대 큐시트 작성' — [무대] 무대/단상 등 단원 위치, [대기인원/세부내용] 언제·어디서·누가(몇 명)·무엇을·어떻게,
//       [개사내용] Run Time에 맞춰 개사 내용 작성, [음향/FD] 어떤 음향장비를 (누가) 언제 어떻게, [화면(영상)] 화면에 띄워질 영상/PPT
//       2025 공시 큐시트 음향/FD 작성 방식(장비·개수·위치, 영상 송출 중 마이크 재배치, 마이크 전달 대상)
import { KEYS, MERGEABLE, PLACEHOLDER, colName } from './constants.js';
import {
  isBlank, norm, PENDING_RE, WHO_RE, WHERE_RE, ACTION_RE, VAGUE_DETAIL_RE, MIC_RE, HANDHELD_RE, WHO_MIC_RE, FD_RE,
  INSTRUMENT_RE, SOUND_NONE_RE,
} from './vocab.js';
import { addFinding, applyChange, applyPlaceholder, markPending, rowLabel, blockLabel } from './context.js';

const WHY_STAGE = "OT 자료: [무대] 무대/단상 등 단원 위치 작성 — 언제·어디서·누가(몇 명)·무엇을·어떻게, 디테일하게";
const WHY_DETAIL = 'OT 자료: [대기인원/세부내용] 언제·어디서·누가(몇 명)·무엇을·어떻게 → 디테일하게 작성';
const WHY_LYRICS = 'OT 자료: [개사내용] Run Time에 맞춰 개사 내용 작성 / 2026 큐시트 4행: 각 슬라이드에 들어갈 개사 내용';
const WHY_SOUND = 'OT 자료: [음향/FD] 어떤 음향장비를 (누가) 언제 어떻게 / 2026 큐시트 4행: 어떤 음향 장비를 몇 개 사용하실 건지 정확하게';
const WHY_SCREEN = 'OT 자료: [화면(영상)] 화면에 띄워질 영상 / PPT 작성';
const WHY_BLANK = "TFT 2차 피드백: '붉은색 부분은 빈칸 없이, 작성할 내용이 없다면 X 표시'";

// ---------------- 양식: 추가 열, 셀 병합 ----------------
export function formRules(ctx) {
  const { S } = ctx;
  if (S.extraKeys && S.extraKeys.length) {
    const names = S.extraKeys.filter((n) => n !== 'House');
    if (names.length) {
      const fixId = 'form:extra';
      addFinding(ctx, {
        id: fixId,
        cat: 'form',
        level: 'warn',
        title: `양식에 없는 열: ${names.join(', ')}`,
        msg: '2026 큐시트 양식의 열을 그대로 유지해야 운영팀이 모든 학부 큐시트를 같은 방식으로 읽을 수 있습니다. 추가한 열의 내용은 비고로 옮겼습니다.',
        why: "TFT 2차 피드백: '큐시트 양식 유지해주세요!'",
        fixId,
      });
    }
    for (const row of S.rows) {
      const parts = Object.entries(row.extra || {})
        .filter(([, v]) => v)
        .map(([k, v]) => `[${k}] ${v}`);
      if (!parts.length) continue;
      const fixId = S.extraKeys.includes('House') && Object.keys(row.extra).every((k) => k === 'House') ? 'light:2025' : 'form:extra';
      applyChange(ctx, fixId, row, 'note', [row.c.note, ...parts].filter(Boolean).join('\n'), '양식 밖 열 → 비고');
    }
  }
  // 셀 병합: 블록 안에서 공통 열(항목·무대·대기 인원·음향·화면)이 비어 있으면 위 셀과 병합
  let merged = 0;
  for (const b of S.blocks) {
    if (b.rows.length < 2) continue;
    for (const k of MERGEABLE) {
      let anchor = null;
      for (const r of b.rows) {
        if (r.cont[k]) continue;
        if (!isBlank(r.c[k])) {
          anchor = r;
          continue;
        }
        if (!anchor || ctx.o.disabled.has('form:merge')) continue;
        r.cont[k] = true;
        r.c[k] = '';
        merged++;
      }
    }
  }
  if (merged) {
    addFinding(ctx, {
      id: 'form:merge',
      cat: 'form',
      level: 'info',
      title: `공통 항목 셀 병합 ${merged}곳`,
      msg: '같은 무대 안에서 항목·무대·대기 인원·음향·화면처럼 공통된 내용은 위 칸과 셀 병합했습니다.',
      why: "OT 자료: '공통된 항목을 작성하실 때는 꼭 셀병합을 해주세요!'",
      fixId: 'form:merge',
    });
  }
  // 무대 번호 순서
  const nums = S.blocks
    .filter((b) => b.kind === 'stage')
    .map((b) => (b.item.match(/^\s*무대\s*(\d+)/) || [])[1])
    .filter(Boolean)
    .map(Number);
  for (let i = 0; i < nums.length; i++) {
    if (nums[i] !== i + 1) {
      addFinding(ctx, {
        id: 'form:numbering',
        cat: 'form',
        level: 'info',
        title: '무대 번호가 순서대로가 아님',
        msg: `무대 번호가 ${nums.join(', ')} 순서입니다. 빠진 번호가 있으면 운영팀이 무대 하나가 빠진 것으로 오해할 수 있으니 1부터 차례로 맞춰주세요.`,
        why: '운영 혼선 방지',
      });
      break;
    }
  }
  if (!S.rows.some((r) => r.kind === 'host')) {
    addFinding(ctx, {
      id: 'form:host',
      cat: 'form',
      level: 'info',
      title: "'학부 소개 및 투표(사회자)' 행 없음",
      msg: "양식의 첫 순서인 '학부 소개 및 투표(사회자)' 행이 없어 결과물에 추가했습니다.",
      why: '2026 큐시트 양식',
    });
  }
  if (!S.rows.some((r) => r.kind === 'intro')) {
    addFinding(ctx, {
      id: 'form:intro',
      cat: 'form',
      level: 'info',
      title: "'학부 인트로 영상' 행 없음",
      msg: "양식의 두 번째 순서인 '학부 인트로 영상' 행이 없어 결과물에 추가했습니다. 인트로 영상 중 단원 대기·입장 상황을 적어주세요.",
      why: '2026 큐시트 양식',
    });
  }
}

// ---------------- 논의 중 표시 ----------------
// '논의 중'·'미정' 칸은 공시 2차 큐시트처럼 수정본에서 보라색으로만 칠한다.
// 피드백 항목(수정요망)으로는 세지 않는다.
export function pendingRules(ctx) {
  const { S } = ctx;
  for (const row of S.rows) {
    for (const k of KEYS) {
      if (row.c[k] && PENDING_RE.test(row.c[k])) markPending(row, k);
    }
  }
}

function blockTopRows(b, key) {
  // 병합 고려: 실제 값이 들어갈 수 있는 행(연속 병합 아닌 행)
  return b.rows.filter((r) => !r.cont[key]);
}

// ---------------- 무대 / 대기 인원 ----------------
export function stageRules(ctx) {
  const { S } = ctx;
  for (const b of S.blocks) {
    if (b.kind === 'host') continue;
    const top = b.rows[0];
    if (b.kind === 'stage' || b.kind === 'video' || b.kind === 'intro') {
      for (const r of blockTopRows(b, 'stage')) {
        if (!isBlank(r.c.stage)) continue;
        if (r !== top) continue;
        addFinding(ctx, {
          id: `stage:blank:${r.id}`,
          cat: 'stage',
          level: b.kind === 'stage' ? 'error' : 'warn',
          rowId: r.id,
          key: 'stage',
          title: '무대 칸이 비어 있음',
          msg: `${blockLabel(b)}에서 무대와 단상 위에 누가 몇 명 있는지 적어주세요.`,
          why: WHY_STAGE,
          suggestion: '예) 댄서 16명 무대 / 콰이어 24명 단상',
        });
        applyPlaceholder(ctx, 'fill:placeholder', r, 'stage', PLACEHOLDER, '무대 작성 필요');
      }
      if (b.kind === 'stage' && top.c.stage && !/\d+\s*명|명/.test(top.c.stage) && !/\d/.test(b.rows.map((r) => r.c.detail).join(' '))) {
        addFinding(ctx, {
          id: `stage:count:${top.id}`,
          cat: 'stage',
          level: 'info',
          rowId: top.id,
          key: 'stage',
          title: '무대 인원 수가 없음',
          msg: `'${top.c.stage.split('\n')[0]}' — 무대와 단상에 각각 몇 명이 서는지 숫자로 적으면 조명·음향팀이 범위를 정하기 쉽습니다.`,
          why: WHY_STAGE,
        });
      }
      // 대기 인원
      for (const r of blockTopRows(b, 'waiting')) {
        if (r !== top) continue;
        if (isBlank(r.c.waiting)) {
          addFinding(ctx, {
            id: `wait:blank:${r.id}`,
            cat: 'stage',
            level: 'warn',
            rowId: r.id,
            key: 'waiting',
            title: '대기 인원 칸이 비어 있음',
            msg: '채플 무대 아래에서 대기하는 인원 수를 적어주세요. 대기 인원이 없으면 X로 표시합니다.',
            why: WHY_BLANK,
            suggestion: '예) 댄서 12명 / X',
          });
          applyPlaceholder(ctx, 'fill:placeholder', r, 'waiting', PLACEHOLDER, '대기 인원 작성 필요');
        } else if (!/\d|^x$|^X$|없음|^0/.test(r.c.waiting.trim()) && !PENDING_RE.test(r.c.waiting)) {
          addFinding(ctx, {
            id: `wait:num:${r.id}`,
            cat: 'stage',
            level: 'info',
            rowId: r.id,
            key: 'waiting',
            title: '대기 인원이 숫자가 아님',
            msg: `'${r.c.waiting.split('\n')[0]}' — 무대 아래에서 기다리는 인원을 '댄서 13명'처럼 숫자로 적어주세요.`,
            why: WHY_DETAIL,
          });
        }
      }
    }
  }
}

// 동작을 나타내는 끝말(뜀, 엶, 부숨, 한다, 이동함 …)
function hasVerbEnding(text) {
  for (const w of text.split(/[\s.,/·]+/)) {
    if (!w) continue;
    const ch = w.charCodeAt(w.length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3 && (ch - 0xac00) % 28 === 16) return true; // ㅁ 받침(명사형 어미)
    if (/(다|요|기|함|됨|짐)$/.test(w)) return true;
  }
  return false;
}

// ---------------- 세부 내용 ----------------
export function detailRules(ctx) {
  const { S } = ctx;
  const vague = [];
  for (const b of S.blocks) {
    if (b.kind === 'host') continue;
    const blanks = [];
    for (const r of b.rows) {
      if (r.cont.detail) continue;
      const d = norm(r.c.detail);
      if (isBlank(d)) {
        if (b.kind === 'stage' || b.kind === 'video') blanks.push(r);
        continue;
      }
      if (PENDING_RE.test(d) || b.kind !== 'stage') continue;
      const missing = [];
      if (!WHO_RE.test(d) && !/(명|들(?=[이은의과가을를\s.,]|$)|한\s*사람)/.test(d)) missing.push('누가(몇 명)');
      if (!WHERE_RE.test(d)) missing.push('어디서');
      if (!ACTION_RE.test(d) && !hasVerbEnding(d)) missing.push('무엇을·어떻게');
      const short = d.replace(/\s+/g, '').length;
      if (VAGUE_DETAIL_RE.test(d) || short < 8 || (missing.length >= 2 && short < 30) || missing.length === 3) vague.push({ r, d, missing });
    }
    if (blanks.length) {
      addFinding(ctx, {
        id: `detail:blank:${b.index}`,
        cat: 'detail',
        level: b.kind === 'stage' ? 'error' : 'warn',
        rowId: blanks[0].id,
        key: 'detail',
        title: blanks.length > 1 ? `세부 내용 빈칸 ${blanks.length}곳` : '세부 내용이 비어 있음',
        msg:
          b.kind === 'video'
            ? `${josa(blockLabel(b), '이/가')} 나오는 동안 단원들이 어디로 이동하고 무엇을 준비하는지(대형 이동·환복·소품 세팅) 적어주세요.`
            : `${blockLabel(b)}에서 세부 내용이 빈 행이 있습니다. 행마다 누가(몇 명) 어디에서 무엇을 어떻게 하는지 적어주세요. 대형 변화가 없으면 '대형 유지, 전원 노래'처럼 그 사실을 적습니다.`,
        why: WHY_DETAIL,
        suggestion: '예) 댄서 16명은 4명씩 4그룹으로 무대에 흩어져 대기, 콰이어 24명은 단상에서 노래',
      });
      for (const r of blanks) applyPlaceholder(ctx, 'fill:placeholder', r, 'detail', PLACEHOLDER, '세부 내용 작성 필요');
    }
  }
  const byBlock = new Map();
  for (const v of vague) {
    const k = v.r.blockIndex;
    if (!byBlock.has(k)) byBlock.set(k, []);
    byBlock.get(k).push(v);
  }
  for (const [bi, list] of byBlock) {
    const b = S.blocks[bi];
    const miss = [...new Set(list.flatMap((v) => v.missing))];
    const ex = [...new Set(list.map((v) => `'${v.d.split('\n')[0].slice(0, 24)}'`))].slice(0, 3).join(', ');
    addFinding(ctx, {
      id: `detail:vague:${bi}`,
      cat: 'detail',
      level: 'warn',
      rowId: list[0].r.id,
      key: 'detail',
      title: list.length > 1 ? `세부 내용이 구체적이지 않은 행 ${list.length}곳` : '세부 내용이 구체적이지 않음',
      msg: `${blockLabel(b)}: ${ex}${list.length > 3 ? ' 등' : ''} — ${miss.length ? `${josa(miss.join(', '), '이/가')} 빠져 있습니다. ` : ''}단원들의 동선(주인공 동선), 대형 변화, 소품 활용을 언제·어디서·누가(몇 명)·무엇을·어떻게로 적어주세요.`,
      why: WHY_DETAIL,
      suggestion: "예) '단체 안무' → '댄서 16명 2줄 대형에서 안무, 후렴 시작에 가운데 4명이 앞으로 나옴'",
      rows: list.map((v) => v.r.id),
    });
  }
}

// ---------------- 개사 내용 ----------------
export function lyricsRules(ctx) {
  const { S } = ctx;
  for (const b of S.blocks) {
    if (b.kind === 'host' || b.kind === 'intro') continue;
    if (b.kind === 'video') {
      for (const r of b.rows) if (isBlank(r.c.lyrics) && !r.cont.lyrics) applyChange(ctx, 'fill:video', r, 'lyrics', 'X', '영상 행: 개사 없음(X)');
      continue;
    }
    const blanks = b.rows.filter((r) => isBlank(r.c.lyrics) && !r.cont.lyrics);
    if (blanks.length) {
      addFinding(ctx, {
        id: `lyrics:blank:${b.index}`,
        cat: 'lyrics',
        level: 'warn',
        rowId: blanks[0].id,
        key: 'lyrics',
        title: `개사 내용 빈칸 ${blanks.length}곳`,
        msg: `${blockLabel(b)}에 개사 내용이 빈 행이 있습니다. 가사가 없는 구간은 '간주', 노래 없이 동작만 있으면 'X', 원곡을 그대로 쓰면 '원곡 그대로'처럼 빈칸 없이 적어주세요.`,
        why: "TFT 2차 피드백: '개사내용에 빈칸이 없게 부탁드립니다'",
      });
      for (const r of blanks) applyPlaceholder(ctx, 'fill:placeholder', r, 'lyrics', PLACEHOLDER, '개사 내용 작성 필요');
    }
    const longRows = b.rows.filter((r) => {
      const lines = r.c.lyrics.split('\n').filter((l) => l.trim());
      const dur = r.rt && r.rt.ok ? r.rt.end - r.rt.start : null;
      return lines.length >= 7 && (dur == null || dur > 40) && b.rows.length > 1;
    });
    if (longRows.length) {
      addFinding(ctx, {
        id: `lyrics:long:${b.index}`,
        cat: 'lyrics',
        level: 'warn',
        rowId: longRows[0].id,
        key: 'lyrics',
        title: longRows.length > 1 ? `한 행에 가사가 너무 많음 (${longRows.length}행)` : '한 행에 가사가 너무 많음',
        msg: `${blockLabel(b)}에서 7줄 이상의 가사가 한 행에 들어 있습니다. 가사 영상 슬라이드가 바뀌는 지점마다 행을 나누고 각각의 Run Time을 적어주세요.`,
        why: WHY_LYRICS,
      });
    }
  }
}

// ---------------- 음향 / FD ----------------
function soundSignature(t) {
  return (t || '')
    .replace(/\s+/g, '')
    .replace(/ea/gi, '개')
    .replace(/대/g, '개')
    .toLowerCase();
}

export function soundRules(ctx) {
  const { S } = ctx;
  const stageSounds = [];
  for (const b of S.blocks) {
    if (b.kind === 'host') continue;
    if (b.kind === 'video' || b.kind === 'intro') {
      if (b.kind === 'video') for (const r of b.rows) if (isBlank(r.c.sound) && !r.cont.sound) applyChange(ctx, 'fill:video', r, 'sound', 'X', '영상 행: 마이크 사용 없음(X)');
      continue;
    }
    const texts = b.rows.filter((r) => !r.cont.sound).map((r) => ({ r, t: norm(r.c.sound) }));
    const filled = texts.filter((x) => !isBlank(x.t));
    if (!filled.length) {
      addFinding(ctx, {
        id: `sound:blank:${b.index}`,
        cat: 'sound',
        level: 'error',
        rowId: b.rows[0].id,
        key: 'sound',
        title: '음향 장비가 적혀 있지 않음',
        msg: `${blockLabel(b)}에서 사용할 음향 장비와 개수를 적어주세요. 마이크를 쓰지 않으면 X로 표시합니다.`,
        why: WHY_SOUND,
        suggestion: '예) 합창 마이크 4개 / 무선 마이크 2개(주인공 1, 솔로 1) / 유선 마이크 2개(무대 왼쪽)',
      });
      applyPlaceholder(ctx, 'fill:placeholder', b.rows[0], 'sound', PLACEHOLDER, '음향 작성 필요');
      stageSounds.push({ b, sig: null });
      continue;
    }
    // 단위 통일: 4ea → 4개, '유선마이크 (3)' → '유선 마이크 3개'
    for (const { r, t } of filled) {
      let nt = t.replace(/(\d+)\s*ea\b/gi, '$1개').replace(/(마이크|거치대|스탠드)\s*\((\d+)\)/g, '$1 $2개').replace(/(무선|유선|합창|솔로|핸드)마이크/g, '$1 마이크');
      if (nt !== t) applyChange(ctx, 'sound:units', r, 'sound', nt, '음향 장비 표기 통일');
    }
    const all = filled.map((x) => x.r.c.sound).join('\n');
    if (MIC_RE.test(all) && !/\d/.test(all)) {
      addFinding(ctx, {
        id: `sound:count:${b.index}`,
        cat: 'sound',
        level: 'warn',
        rowId: filled[0].r.id,
        key: 'sound',
        title: '마이크 개수가 없음',
        msg: `'${all.split('\n')[0]}' — 마이크 종류별 개수를 정확히 적어주세요(예: 합창 마이크 4개).`,
        why: WHY_SOUND,
      });
    }
    const wireless = [...all.matchAll(/무선\s*마이크\s*(?:\(?\s*)?(\d+)/g)].map((m) => Number(m[1]));
    if (wireless.some((n) => n > 2)) {
      addFinding(ctx, {
        id: `sound:wireless:${b.index}`,
        cat: 'sound',
        level: 'info',
        rowId: filled[0].r.id,
        key: 'sound',
        title: '무선 마이크 수량 확인',
        msg: `무선 마이크 ${Math.max(...wireless)}개를 요청했습니다. 행사 기본 무선 마이크는 2대이므로 TFT 음향팀과 가용 수량을 확인해주세요.`,
        why: '2025·2026 학부합창대회 운영 기준(무선 마이크 2대)',
      });
    }
    const ctxText = b.rows.map((r) => `${r.c.sound} ${r.c.detail} ${r.c.note}`).join(' ');
    const micWho = ctxText
      .split(/[.\n/]|(?:,\s)/)
      .some((seg) => MIC_RE.test(seg) && WHO_MIC_RE.test(seg.replace(/\d+\s*개/g, '')));
    if (HANDHELD_RE.test(all) && !micWho) {
      addFinding(ctx, {
        id: `sound:who:${b.index}`,
        cat: 'sound',
        level: 'info',
        rowId: filled[0].r.id,
        key: 'sound',
        title: '마이크를 누가 쓰는지 없음',
        msg: '무선·유선(핸드) 마이크를 누가 사용하는지(주인공/솔로 1·2/콰이어 앞줄), 언제 ON 하는지 적어주세요. 솔로가 번갈아 쓰면 행마다 "핸드마이크 1 ON"처럼 적으면 음향팀이 바로 따라갈 수 있습니다.',
        why: WHY_SOUND,
      });
    }
    const inst = ctxText.match(INSTRUMENT_RE);
    if (inst && !/(DI|마이킹|악기)/i.test(all)) {
      addFinding(ctx, {
        id: `sound:inst:${b.index}`,
        cat: 'sound',
        level: 'info',
        rowId: filled[0].r.id,
        key: 'sound',
        title: `악기(${inst[0]}) 음향 확인`,
        msg: `${josa(inst[0], '을/를')} 사용한다면 마이킹이나 DI가 필요한지 음향 칸에 적어주세요(2025 법학부 예: 카혼 마이킹, 기타 DI).`,
        why: WHY_SOUND,
      });
    }
    stageSounds.push({ b, sig: soundSignature(filled[0].r.c.sound), text: filled[0].r.c.sound });
  }
  // 무대 사이 장비 변경 → 영상 송출 중 FD 지시
  const blocks = S.blocks;
  for (let i = 1; i < stageSounds.length; i++) {
    const prev = stageSounds[i - 1];
    const cur = stageSounds[i];
    if (!prev.sig || !cur.sig || prev.sig === cur.sig) continue;
    const between = blocks.slice(prev.b.index + 1, cur.b.index);
    const txt = [...between, cur.b].flatMap((b) => b.rows).map((r) => `${r.c.sound} ${r.c.detail} ${r.c.note}`).join(' ');
    if (MIC_RE.test(txt) && FD_RE.test(txt)) continue;
    const target = between.length ? between[between.length - 1].rows[0] : cur.b.rows[0];
    addFinding(ctx, {
      id: `sound:fd:${cur.b.index}`,
      cat: 'sound',
      level: 'info',
      rowId: target.id,
      key: between.length ? 'note' : 'sound',
      title: '무대 사이 마이크 세팅 변경(FD 지시)',
      msg: `${josa(`${blockLabel(prev.b)}('${prev.text.split('\n')[0]}')`, '과/와')} ${blockLabel(cur.b)}('${cur.text.split('\n')[0]}')의 음향 장비가 다릅니다. ${between.length ? `${blockLabel(between[between.length - 1])} 송출 중에` : '무대 전환 중에'} 마이크를 어디로 옮기고 누구에게 전달할지 적어주세요.`,
      why: '2025 공시 큐시트: "영상2가 송출될 때 무대 앞쪽에 있던 합창마이크 4대를 단상 바로 앞까지 붙여 배치해주세요!"',
      suggestion: `예) ${between.length ? blockLabel(between[between.length - 1]) : '전환'} 송출 중 유선 마이크 2개를 무대 왼쪽에 세팅, 무선 마이크 1개는 무대 오른쪽 계단에서 대기 중인 주인공에게 전달`,
    });
  }
  const su = ctx.fixes.get('sound:units');
  if (su && su.cells.length) {
    addFinding(ctx, {
      id: 'sound:units',
      cat: 'sound',
      level: 'info',
      title: `음향 장비 표기 통일 ${su.cells.length}곳`,
      msg: "'4ea', '마이크 (3)' 같은 표기를 '4개', '마이크 3개'로 통일했습니다.",
      why: WHY_SOUND,
      fixId: 'sound:units',
    });
  }
}

// ---------------- 화면(영상) ----------------
export function screenRules(ctx) {
  const { S } = ctx;
  for (const b of S.blocks) {
    if (b.kind === 'host') continue;
    const top = b.rows[0];
    if (b.kind === 'video' || b.kind === 'intro') {
      for (const r of b.rows) if (isBlank(r.c.screen) && !r.cont.screen) applyChange(ctx, 'fill:video', r, 'screen', '영상', '영상 행: 화면 = 영상');
      continue;
    }
    const any = b.rows.some((r) => !isBlank(r.c.screen));
    if (!any) {
      addFinding(ctx, {
        id: `screen:blank:${b.index}`,
        cat: 'screen',
        level: 'warn',
        rowId: top.id,
        key: 'screen',
        title: '화면(영상) 칸이 비어 있음',
        msg: `${blockLabel(b)} 동안 화면에 무엇을 띄우는지 적어주세요(가사 영상 / PPT / 검은 화면 X).`,
        why: WHY_SCREEN,
      });
      applyPlaceholder(ctx, 'fill:placeholder', top, 'screen', PLACEHOLDER, '화면 작성 필요');
    }
  }
}

// ---------------- 영상 행 기본값 묶음 보고 ----------------
export function reportVideoDefaults(ctx) {
  const fv = ctx.fixes.get('fill:video');
  if (fv && fv.cells.length) {
    addFinding(ctx, {
      id: 'fill:video',
      cat: 'form',
      level: 'info',
      title: `영상 행 빈칸 ${fv.cells.length}곳 기본값으로 채움`,
      msg: "영상 행의 빈칸을 공시 큐시트 방식으로 채웠습니다: 화면 '영상', 음향 'X', 개사 'X', 무대·상단 조명 'X (암전)', 핀 'X', Details '영상 재생 중 암전'. 영상 중 조명이 필요하면 고쳐주세요.",
      why: WHY_BLANK,
      fixId: 'fill:video',
    });
  }
  const ph = ctx.fixes.get('fill:placeholder');
  if (ph && ph.cells.length) {
    addFinding(ctx, {
      id: 'fill:placeholder',
      cat: 'form',
      level: 'info',
      title: `직접 작성해야 하는 칸 ${ph.cells.length}곳 표시`,
      msg: `학부만 알 수 있는 내용이라 대신 채울 수 없는 칸에 '${PLACEHOLDER}'를 넣고 붉은색으로 표시했습니다.`,
      why: WHY_BLANK,
      fixId: 'fill:placeholder',
    });
  }
}

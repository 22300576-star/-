import { josa } from './josa.js';
// 조명 규칙 (2026 기준: 무대 / 상단 / Pin1~4 / Details)
// 근거: 2026 조명 큐시트 작성 가이드
//  1. 무대 조명: 앞에서 인물을 비춤, 밝은 계열 권장, 좌/중앙/우 구역별 요청 — 예) 중앙 / 하얀색 / 100%
//  2. 상단 조명: 위에서 아래로 무대 색을 입힘, 좌/중앙/우 구역별 요청
//  3. 핀조명(Pin1~4): 색 변경 불가(ON/OFF·밝기만), 위치 고정(핀이 비추는 곳에 가서 선다), 1명에 가장 효과적, 3명 이상은 무대 조명 권장
//  4. FX1·FX2: 스트로브/고보/무빙/추가 핀 중 2개만 지정, Pin4 옆 Details에 작성, 스트로브 장시간 사용 지양
//  팁: 전환 방식(즉시/서서히) 명시, 영상 재생 시간 기준 시각, 객관적인 시점 사용
import { LIGHT_KEYS, PIN_KEYS, PIN_POS, PLACEHOLDER, colName } from './constants.js';
import { findClockTokens, shiftClocksInText, fmtClock } from './time.js';
import {
  norm, isBlank, PENDING_RE, OFF_ONLY_RE, BLACK_COLOR_RE, KEEP_RE, ZONE_RE, HEX_RE, COLOR_WORD_RE, WHITE_RE,
  PERCENT_RE, VAGUE_BRIGHT, PIN_ON_ONLY_RE, GROUP_RE, COUNT_RE, FOLLOW_RE, LOC_WORDS, FX_TYPES, FX_ANY_RE,
  TRANSITION_RE, SUBJECTIVE_RE,
} from './vocab.js';
import { addFinding, applyChange, applyPlaceholder, rowLabel, blockLabel } from './context.js';
import { reparse } from './rules-time.js';

const WHY_ZONE = '조명 가이드 1·2: 무대·상단 조명은 구역(왼쪽/중앙/오른쪽) / 색상 / 밝기로 요청 — 예) 중앙 / 하얀색 / 100%';
const WHY_PIN = '조명 가이드 3: 핀조명은 색 변경이 어렵고 ON/OFF와 밝기만 조절 가능, 위치 조정이 어려워 핀이 비추는 곳에 가서 서야 함, 3명 이상은 무대 조명 권장';
const WHY_FX = '조명 가이드 4: FX(스트로브·고보·무빙·추가 핀) 중 2개만 FX1·FX2로 지정해 Pin4 옆 Details에 작성';
const WHY_TIP = '조명 가이드 큐시트 작성 팁: 전환 방식(즉시/서서히) 명시, 영상 재생 시간 기준, 객관적이고 명확한 시점';

const TIME_PREFIX_RE = /^\s*(\d{1,2}\s*:\s*\d{2}(?:\s*[~\-–]\s*\d{1,2}\s*:\s*\d{2})?)\s*/;
const HEADING_ONLY_RE = /^(무대|상단|조명|무대\s*조명|상단\s*조명|핀|pin\s*\d?|details?)\s*:?$/i;
const OFFISH_RE = /(^|[\s\/(·,])(x|X|off|OFF|끄기|꺼짐|끔|암전|꺼주세요|끄고)(?=$|[\s\/()·,.])/;

export function splitCues(text) {
  const lines = (text || '').split('\n');
  const groups = [];
  let cur = null;
  for (const ln of lines) {
    const m = ln.match(TIME_PREFIX_RE);
    if (m || !cur) {
      cur = { prefix: m ? m[1] : '', lines: [] };
      groups.push(cur);
      cur.lines.push(m ? ln.slice(m[0].length) : ln);
    } else cur.lines.push(ln);
  }
  return groups;
}

function bodyOf(g) {
  return g.lines.filter((l) => !/^\s*\(.*\)\s*$/.test(l)).join(' ').trim();
}

function hasColor(t) {
  return COLOR_WORD_RE.test(t) || HEX_RE.test(t) || /(?<![#\w])[0-9a-fA-F]{6}(?![0-9a-fA-F])/.test(t) && /[a-fA-F]/.test((t.match(/(?<![#\w])[0-9a-fA-F]{6}(?![0-9a-fA-F])/) || [''])[0]);
}
function hasPct(t) {
  return PERCENT_RE.test(t) || /\/\s*\d{1,3}(?!\s*[:\d])/.test(t) || /(\d{1,3})\s*(?:~\s*\d{1,3}\s*)?정도의?\s*밝기|밝기\s*\d{1,3}/.test(t);
}
function vagueOf(t) {
  for (const [re, pct] of VAGUE_BRIGHT) {
    const m = t.match(re);
    if (m) return { phrase: m[0], pct };
  }
  return null;
}
function nonWhiteColors(t) {
  const out = [];
  const re = new RegExp(COLOR_WORD_RE.source, 'gi');
  let m;
  while ((m = re.exec(t))) if (!WHITE_RE.test(m[0])) out.push(m[0]);
  const hexRe = /#?(?<![\w])([0-9a-fA-F]{6}|[0-9a-fA-F]{3})(?![0-9a-fA-F])/g;
  while ((m = hexRe.exec(t))) {
    const h = m[1].toLowerCase();
    if (!/[a-f]/.test(h) && !m[0].startsWith('#')) continue;
    if (h === 'ffffff' || h === 'fff') continue;
    out.push(m[0]);
  }
  return out;
}

// ---------------- 1. '무대:… 상단:… pin1:…' 처럼 한 칸에 몰아 쓴 조명 나누기 ----------------
const LABEL_RE = /^\s*(무대(?:\s*조명)?|상단(?:\s*조명)?|(?:pin|핀)\s*\d(?:\s*[,·\/]\s*\d)*|(?:pin|핀)\s*\d\s*[~\-]\s*\d|fx\s*\d?|details?)\s*[:：]\s*(.*)$/i;

function labelTargets(label) {
  const l = label.toLowerCase().replace(/\s+/g, '');
  if (l.startsWith('무대')) return ['lStage'];
  if (l.startsWith('상단')) return ['lTop'];
  if (l.startsWith('fx') || l.startsWith('detail')) return ['details'];
  const range = l.match(/(?:pin|핀)(\d)[~\-](\d)/);
  if (range) {
    const out = [];
    for (let i = Number(range[1]); i <= Number(range[2]); i++) if (i >= 1 && i <= 4) out.push(`pin${i}`);
    return out;
  }
  const nums = (l.match(/\d/g) || []).map(Number).filter((n) => n >= 1 && n <= 4);
  return nums.map((n) => `pin${n}`);
}

function splitLabeled(ctx) {
  const { S } = ctx;
  for (const row of S.rows) {
    for (const key of ['lStage', 'lTop', 'details', 'note']) {
      const text = row.c[key];
      if (!text) continue;
      const spanned = (row.hspan && row.hspan[key]) || [];
      const lines = text.split('\n');
      const labeled = lines.map((l) => l.match(LABEL_RE)).filter(Boolean);
      const distinct = new Set(labeled.map((m) => labelTargets(m[1]).join(',')));
      if (labeled.length < 2 || distinct.size < 2) {
        if (spanned.length && LIGHT_KEYS.includes(key)) {
          addFinding(ctx, {
            id: `light:hspan:${row.id}`,
            cat: 'light',
            level: 'warn',
            rowId: row.id,
            key,
            title: '조명 칸을 가로로 병합해 한 번에 설명함',
            msg: `${colName(key)}부터 ${spanned.map(colName).join(', ')}까지 병합하고 설명을 한 번에 적었습니다. 조명팀은 무대·상단·Pin1~4·Details 칸을 따로 보고 큐를 넣으므로 칸마다 나눠 적어주세요.`,
            why: "TFT 2차 피드백: '큐시트 양식 유지 → 조명을 주어진 양식대로 수정'",
          });
          for (const k of spanned) if (!row.c[k]) applyPlaceholder(ctx, 'fill:placeholder', row, k, PLACEHOLDER, '칸별 조명 작성 필요');
        }
        continue;
      }
      const targets = {};
      let current = null;
      let section = '';
      const rest = [];
      for (const raw of lines) {
        const l = raw.trim();
        if (!l) {
          current = null;
          continue;
        }
        const m = l.match(LABEL_RE);
        if (m) {
          current = labelTargets(m[1]);
          const v = m[2].trim();
          if (v) for (const t of current) (targets[t] = targets[t] || []).push(section ? `[${section}] ${v}` : v);
          else for (const t of current) targets[t] = targets[t] || [];
        } else if (/^[^/:：]{1,24}[:：]?$/.test(l) && !current) {
          section = l.replace(/[:：]$/, '').trim();
        } else if (/^[^/:：]{1,24}[:：]$/.test(l)) {
          section = l.replace(/[:：]$/, '').trim();
          current = null;
        } else if (current) {
          for (const t of current) targets[t].push(section ? `[${section}] ${l}` : l);
        } else {
          rest.push(section ? `[${section}] ${l}` : l);
        }
      }
      const blocked = Object.keys(targets).some((t) => t !== key && !spanned.includes(t) && row.c[t] && !isBlank(row.c[t]) && !OFF_ONLY_RE.test(row.c[t]));
      if (blocked) continue;
      const fixId = `light:split:${row.id}:${key}`;
      addFinding(ctx, {
        id: fixId,
        cat: 'light',
        level: 'error',
        rowId: row.id,
        key,
        title: '조명 지시가 한 칸에 몰려 있음',
        msg: `${colName(key)} 칸에 '무대: … / 상단: … / pin: …'처럼 여러 조명을 함께 적었습니다. 조명팀은 열 단위로 큐를 읽으므로 무대·상단·Pin1~4·Details 칸에 나눠 옮겼습니다. 구간 이름([대사], [간주] 등)으로 적은 부분은 Run Time 행에 맞춰 다시 나눠야 합니다.`,
        why: "TFT 2차 피드백: '큐시트 양식 유지 → 조명을 주어진 양식대로 수정'",
        fixId,
      });
      const assigned = new Set(Object.keys(targets));
      for (const [t, vals] of Object.entries(targets)) {
        const v = vals.filter(Boolean).join('\n') || 'X';
        const merged = t === key || spanned.includes(t) || !row.c[t] || OFF_ONLY_RE.test(row.c[t]) ? v : `${row.c[t]}\n${v}`;
        applyChange(ctx, fixId, row, t, merged, '조명 칸 나누기');
      }
      const remain = rest.join('\n');
      if (!assigned.has(key)) {
        if (key === 'details' || key === 'note') applyChange(ctx, fixId, row, key, remain, '조명 칸 나누기');
        else {
          applyChange(ctx, fixId, row, key, '', '조명 칸 나누기');
          if (remain) applyChange(ctx, fixId, row, 'details', row.c.details ? `${row.c.details}\n${remain}` : remain, '조명 칸 나누기');
        }
      } else if (remain) {
        const dk = key === 'note' ? 'note' : 'details';
        applyChange(ctx, fixId, row, dk, row.c[dk] && dk !== key ? `${row.c[dk]}\n${remain}` : remain, '조명 칸 나누기');
      }
    }
  }
}

// 여러 행에 걸쳐 세로 병합된 조명 칸 → 행마다 나눔(시간이 적힌 큐는 해당 행으로, 나머지 행은 '유지')
function unmergeLighting(ctx) {
  const { S } = ctx;
  let count = 0;
  for (const b of S.blocks) {
    if (b.kind !== 'stage') continue;
    for (const key of [...LIGHT_KEYS, 'details']) {
      for (let i = 0; i < b.rows.length; i++) {
        const anchor = b.rows[i];
        if (anchor.cont[key]) continue;
        let j = i + 1;
        while (j < b.rows.length && b.rows[j].cont[key]) j++;
        if (j - i < 2) continue;
        const run = b.rows.slice(i, j);
        const fixId = 'light:unmerge';
        if (ctx.o.disabled.has(fixId)) continue;
        const groups = splitCues(anchor.c[key] || '');
        const per = new Map(run.map((r) => [r, []]));
        for (const g of groups) {
          const tok = g.prefix ? findClockTokens(g.prefix)[0] : null;
          const text = (g.prefix ? `${g.prefix} ` : '') + g.lines.join('\n').trim();
          let target = anchor;
          if (tok) {
            const hit = run.find((r) => r.rt && r.rt.ok && tok.sec >= r.rt.start - 1 && tok.sec < r.rt.end);
            if (hit) target = hit;
          }
          per.get(target).push(text);
        }
        const anchorOff = isOff(anchor.c[key]);
        for (const r of run) {
          r.cont[key] = false;
          const vals = per.get(r).filter(Boolean);
          const v = vals.length ? vals.join('\n') : r === anchor ? anchor.c[key] : key === 'details' ? 'X' : anchorOff ? 'X' : '유지';
          if (r === anchor) {
            if (v !== anchor.c[key]) applyChange(ctx, fixId, r, key, v, '병합된 조명 칸을 행별로 나눔');
          } else {
            r.c[key] = '';
            applyChange(ctx, fixId, r, key, v, '병합된 조명 칸을 행별로 나눔');
          }
          count++;
        }
        i = j - 1;
      }
    }
  }
  if (count) {
    addFinding(ctx, {
      id: 'light:unmerge',
      cat: 'light',
      level: 'warn',
      title: '조명 칸을 여러 행에 걸쳐 병합함',
      msg: "조명은 Run Time 행마다 상태를 적어야 조명팀이 시간에 맞춰 큐를 넣을 수 있습니다. 병합된 조명 칸을 행마다 나누고, 시간이 적힌 큐는 그 시간의 행으로 옮기고, 이어지는 행은 '유지'로 적었습니다.",
      why: "공시 큐시트 방식: 조명은 행마다 작성, 이어지는 조명은 '유지'",
      fixId: 'light:unmerge',
    });
  }
}

// ---------------- 2. 2025 양식 표기(LCR, Left1, O(TFT)) → 2026 표기 ----------------
function convert2025(ctx) {
  const { S } = ctx;
  if (S.layout !== '2025') return;
  addFinding(ctx, {
    id: 'light:2025',
    cat: 'form',
    level: 'error',
    title: '2025년 조명 양식으로 작성됨',
    msg: '2026 큐시트의 조명은 무대 / 상단 / Pin1~4 / Details 열로 바뀌었습니다. 2025 Stage 열은 2026 무대 조명 열로, 2025 Pin2(오른쪽)는 2026 Pin4(무대 오른쪽)로 옮겼습니다. House 조명은 학부가 요청하는 항목이 아니므로 비고로 옮겼습니다.',
    why: '2026 조명 큐시트 작성 가이드',
    fixId: 'light:2025',
  });
  for (const row of S.rows) {
    const v = row.c.lStage;
    if (!v) continue;
    const nv = v
      .replace(/\bLCR\b/gi, '전체')
      .replace(/\bleft\s*1?\b/gi, '왼쪽')
      .replace(/\bright\s*1?\b/gi, '오른쪽')
      .replace(/\bcenter\s*1?\b/gi, '중앙')
      .replace(/stage\s*off\s*\(?0%\)?/gi, 'X');
    if (nv !== v) applyChange(ctx, 'light:2025', row, 'lStage', nv, '2025 표기 → 2026 표기');
  }
}

// ---------------- 3. 조명 큐 시간 ↔ Run Time 정렬 ----------------
function alignCueTimes(ctx) {
  const { S } = ctx;
  reparse(S);
  const timedRows = S.rows.filter((r) => (r.kind === 'stage' || r.kind === 'video') && r.rt.ok);
  const cues = [];
  for (const r of timedRows) {
    for (const key of [...LIGHT_KEYS, 'details']) {
      for (const t of findClockTokens(r.c[key])) cues.push({ row: r, key, t: t.sec });
    }
  }
  if (cues.length < 3) return;
  const TOL = 2;
  const inRange = (c, t) => t >= c.row.rt.start - TOL && t <= c.row.rt.end + TOL;
  const frac = (fn) => cues.filter((c) => inRange(c, fn(c))).length / cues.length;
  const p0 = frac((c) => c.t);
  // 가장 많은 큐가 Run Time 안에 들어오는 보정값. 같은 점수가 이어지는 구간이면 그 가운데 값을 쓴다.
  const scores = [];
  for (let d = -300; d <= 300; d++) scores.push({ d, p: d === 0 ? p0 : frac((c) => c.t - d) });
  const maxP = Math.max(...scores.map((s) => s.p));
  const bestDs = scores.filter((s) => Math.abs(s.p - maxP) < 1e-9).map((s) => s.d);
  let run = [bestDs[0]];
  let bestRun = run;
  for (let i = 1; i < bestDs.length; i++) {
    if (bestDs[i] === bestDs[i - 1] + 1) run.push(bestDs[i]);
    else run = [bestDs[i]];
    if (run.length > bestRun.length) bestRun = [...run];
  }
  // 같은 점수 구간에서는 큐가 행의 시작·끝 시각과 정확히 맞는 개수가 가장 많은 값을 고른다
  const exact = (d) => cues.filter((c) => c.t - d === c.row.rt.start || c.t - d === c.row.rt.end).length;
  let pickD = bestRun[Math.floor(bestRun.length / 2)];
  let pickE = -1;
  for (const d of bestRun) {
    const e = exact(d);
    if (e > pickE) {
      pickE = e;
      pickD = d;
    }
  }
  const best = { d: bestRun.includes(0) ? 0 : pickD, p: maxP };
  // 곡 기준(무대 시작 = 0:00) 시간
  const blockStart = (r) => {
    const b = S.blocks[r.blockIndex];
    const f = b.rows.find((x) => x.rt.ok);
    return f ? f.rt.start : 0;
  };
  const pSong = frac((c) => c.t + blockStart(c.row));

  let mode = null;
  if (p0 < 0.7) {
    if (best.p >= 0.7 && best.p >= p0 + 0.25 && best.p >= pSong) mode = 'global';
    else if (pSong >= 0.7 && pSong >= p0 + 0.25) mode = 'song';
  }
  if (mode) {
    const fixId = 'light:align';
    const example = cues.find((c) => !inRange(c, c.t));
    const conv = (c) => (mode === 'global' ? c.t - best.d : c.t + blockStart(c.row));
    const msg =
      mode === 'global'
        ? `조명·Details에 적힌 시간이 Run Time보다 ${best.d > 0 ? `${best.d}초 늦게` : `${-best.d}초 빠르게`} 적혀 있습니다(${Math.round(p0 * 100)}%만 해당 행 Run Time 안에 있음). 조명팀은 Run Time(영상 재생 시간)을 보고 큐를 넣으므로, 조명 시간을 Run Time 기준으로 ${Math.abs(best.d)}초 보정했습니다.`
        : `조명 시간이 곡 기준(노래 시작 = 0:00)으로 적혀 있습니다. 조명팀은 학부 전체 Run Time을 보고 큐를 넣으므로, 각 무대 시작 시각을 더해 Run Time 기준으로 바꿨습니다.`;
    addFinding(ctx, {
      id: fixId,
      cat: 'light',
      level: 'error',
      title: '조명 시간이 Run Time과 맞지 않음',
      msg,
      why: "TFT 2차 피드백(공시): '조명 시간 Run Time 맞춰서 작성' / " + WHY_TIP,
      suggestion: example ? `예) ${rowLabel(S, example.row)}: ${fmtClock(example.t)} → ${fmtClock(conv(example))}` : '',
      fixId,
    });
    if (ctx.o.disabled.has(fixId)) return;
    for (const r of timedRows) {
      const off = mode === 'global' ? -best.d : blockStart(r);
      for (const key of [...LIGHT_KEYS, 'details']) {
        const v = r.c[key];
        if (!findClockTokens(v).length) continue;
        applyChange(ctx, fixId, r, key, shiftClocksInText(v, (t) => t + off), '조명 시간 → Run Time 기준');
      }
    }
  }
  // 정렬 후에도 Run Time 밖에 있는 시간 ('0:50과 동일' 같은 참조는 제외)
  const isReference = (text, t) => /^\s*(?:과|와|이랑|랑)?\s*(?:동일|같|처럼|상태|때와)/.test(text.slice(t.index + t.length, t.index + t.length + 8));
  const byRow = new Map();
  for (const r of timedRows) {
    const outs = [];
    for (const key of [...LIGHT_KEYS, 'details']) {
      const text = r.c[key] || '';
      for (const t of findClockTokens(text)) {
        if (isReference(text, t)) continue;
        if (t.sec < r.rt.start - TOL || t.sec > r.rt.end + TOL) outs.push(`${fmtClock(t.sec)}(${colName(key)})`);
      }
    }
    if (outs.length) byRow.set(r, [...new Set(outs)]);
  }
  for (const [r, outs] of byRow) {
    addFinding(ctx, {
      id: `light:outside:${r.id}`,
      cat: 'light',
      level: 'warn',
      rowId: r.id,
      key: 'details',
      title: '행의 Run Time 밖에 있는 조명 시간',
      msg: `이 행의 Run Time은 ${fmtClock(r.rt.start)}~${fmtClock(r.rt.end)}인데 ${josa(outs.slice(0, 4).join(', '), '이/가')} 적혀 있습니다. 해당 시간의 행으로 옮기거나, 시간이 맞는지 확인해주세요.`,
      why: "TFT 2차 피드백(공시): '조명 시간 Run Time 맞춰서 작성'",
    });
  }
}

// ---------------- 4. 칸별 정리·점검 ----------------
const SLASH_TAIL_NUM = /(?<![\d#A-Za-z%.:])(\d{1,3})(?![\d%A-Za-z:.초분명개번열줄회차])/g;

function fixZoneLine(line) {
  let out = line;
  // 6자리 색상코드 앞 # 붙이기
  out = out.replace(/(^|[^#\w])([0-9a-fA-F]{6})(?![0-9a-fA-F\w])/g, (m, pre, hex) => (/[a-fA-F]/.test(hex) ? `${pre}#${hex}` : m));
  // '구역/색상/30' → '30%'
  const segs = out.split(/(,\s*)/);
  for (let i = 0; i < segs.length; i += 2) {
    const s = segs[i];
    if (!s.includes('/')) continue;
    if (!(ZONE_RE.test(s) || hasColor(s))) continue;
    const idx = s.lastIndexOf('/');
    const head = s.slice(0, idx + 1);
    const tail = s.slice(idx + 1);
    if (/%/.test(tail)) continue;
    segs[i] = head + tail.replace(SLASH_TAIL_NUM, (m, n) => (Number(n) <= 100 ? `${n}%` : m));
  }
  out = segs.join('');
  out = out.replace(/(\d{1,3})\s*~\s*(\d{1,3})\s*정도의?\s*밝기/g, '$1%~$2%');
  out = out.replace(/밝기\s*(\d{1,3})(?![\d%])/g, '밝기 $1%');
  return out;
}

function normalizeZoneCell(text, kind) {
  if (!text) return { value: text, issues: [] };
  const issues = new Set();
  // 블랙/검정 = 꺼짐
  let value = text
    .split('\n')
    .map((ln) => {
      const prefix = (ln.match(TIME_PREFIX_RE) || [''])[0];
      const body = ln.slice(prefix.length);
      if (BLACK_COLOR_RE.test(body) && !nonWhiteColors(body.replace(BLACK_COLOR_RE, '')).length) {
        issues.add('black');
        return `${prefix}X`;
      }
      return prefix + fixZoneLine(body);
    })
    .join('\n');
  // 꺼짐 표현 통일
  value = value
    .split('\n')
    .map((ln) => {
      const prefix = (ln.match(TIME_PREFIX_RE) || [''])[0];
      const body = ln.slice(prefix.length).trim();
      if (OFF_ONLY_RE.test(body)) {
        const nb = /암전|blackout|블랙아웃/i.test(body) ? 'X (암전)' : 'X';
        return prefix ? `${prefix}${nb}` : nb;
      }
      return ln;
    })
    .join('\n');
  // 묶음 단위 점검 + 모호한 밝기 → %
  const groups = splitCues(value);
  const lines = [];
  for (const g of groups) {
    const body = bodyOf(g);
    const gl = [...g.lines];
    const skip =
      !body || HEADING_ONLY_RE.test(body) || KEEP_RE.test(body) || PENDING_RE.test(body) || OFF_ONLY_RE.test(body) || /^X\b/.test(body);
    if (!skip) {
      const z = ZONE_RE.test(body);
      const c = hasColor(body);
      let p = hasPct(body);
      const off = OFFISH_RE.test(body);
      if (!p) {
        const v = vagueOf(body);
        if (v && (z || c)) {
          for (let i = 0; i < gl.length; i++) {
            if (gl[i].includes(v.phrase)) {
              gl[i] = gl[i].replace(v.phrase, `${v.pct}%(${v.phrase})`);
              break;
            }
          }
          issues.add('vague');
          p = true;
        }
      }
      if (!off) {
        if (!z && (c || p)) {
          // 구역이 없으면 전체로 가정
          const spaced = /\s\/\s/.test(gl[0]);
          gl[0] = `${spaced ? '전체 / ' : '전체/'}${gl[0].trim()}`;
          issues.add('zoneAdded');
        } else if (!z && !c && !p) issues.add('unparsed');
        if (kind === 'lStage' && !c && (z || p) && !issues.has('unparsed')) {
          const t = gl[0].trim();
          const parts = t.split('/').map((s) => s.trim());
          if (parts.length === 2 && ZONE_RE.test(parts[0])) {
            gl[0] = gl[0].replace(t, `${parts[0]}/흰색/${parts[1]}`);
            issues.add('whiteAdded');
          } else {
            const m = t.match(/^(전체|왼쪽|오른쪽|중앙|좌우|양쪽)\s*(?:조명)?\s*(\d{1,3}\s*%)$/);
            if (m) {
              gl[0] = gl[0].replace(t, `${m[1]} / 흰색 / ${m[2].replace(/\s/g, '')}`);
              issues.add('whiteAdded');
            } else issues.add('noColor');
          }
        } else if (kind === 'lTop' && !c && (z || p)) issues.add('noColorTop');
        if (!p && !issues.has('unparsed')) issues.add('noPct');
      }
    }
    lines.push((g.prefix ? `${g.prefix} ` : '') + gl[0].replace(/^\s+/, ''), ...gl.slice(1));
  }
  value = lines.join('\n');
  return { value, issues: [...issues] };
}

function normalizePinCell(text, pinKey) {
  if (!text) return { value: text, issues: [], move: null };
  const issues = new Set();
  let move = null;
  const groups = splitCues(text);
  const out = [];
  for (const g of groups) {
    let body = g.lines.join('\n').trim();
    const bodyFlat = body.replace(/\n/g, ' ');
    if (!body) {
      out.push(g.prefix);
      continue;
    }
    if (PENDING_RE.test(bodyFlat) || HEADING_ONLY_RE.test(bodyFlat)) {
      out.push((g.prefix ? `${g.prefix} ` : '') + body);
      continue;
    }
    if (OFF_ONLY_RE.test(bodyFlat)) body = 'X';
    else if (PIN_ON_ONLY_RE.test(bodyFlat)) body = 'ON';
    else if (/^\d{1,3}\s*%$/.test(bodyFlat)) body = `ON (${bodyFlat.replace(/\s/g, '')})`;
    else {
      body = body.replace(/^(o|O)(?=\s*[\/(]|\s*$)/, 'ON').replace(/(pin|핀)\s*조명\s*on|pin\s*on|핀\s*on/gi, 'ON');
      const colors = nonWhiteColors(bodyFlat);
      const cnt = bodyFlat.match(COUNT_RE);
      const many = (cnt && Number(cnt[1]) >= 3) || GROUP_RE.test(bodyFlat);
      const simple = !bodyFlat.includes('[') && body.split('\n').length <= 2 && bodyFlat.length <= 60;
      if (colors.length && !simple) {
        issues.add('color');
        issues.add('colorComplex');
      } else if (colors.length) {
        issues.add('color');
        if (many) {
          // 그룹을 비추는 색 조명 → 무대 조명(구역)으로 옮김
          const loc = LOC_WORDS.find((l) => l.re.test(bodyFlat));
          const zone = loc ? { left: '왼쪽', right: '오른쪽', center: '중앙', back: '중앙', offstage: '전체' }[loc.zone] : '전체';
          const pct = (bodyFlat.match(/\d{1,3}\s*%/) || [''])[0].replace(/\s/g, '');
          move = { line: `${g.prefix ? `${g.prefix} ` : ''}${zone} / ${colors[0].replace(/^(?=[0-9a-fA-F]{6}$)/, '#')} / ${pct || '50%'}`, from: bodyFlat };
          issues.add('moved');
          body = 'X';
        } else {
          for (const c of colors) body = body.split(c).join('');
          body = body.replace(/\(\s*\)/g, '').replace(/\/\s*\//g, '/').replace(/^\s*\/\s*|\s*\/\s*$/g, '').replace(/\s{2,}/g, ' ').trim();
          if (!/^(ON|X)\b/.test(body)) body = `ON${body ? ` / ${body}` : ''}`;
        }
      } else if (many) issues.add('group');
      if (FOLLOW_RE.test(bodyFlat) && !/FX/i.test(bodyFlat)) issues.add('follow');
      const loc = LOC_WORDS.find((l) => l.re.test(bodyFlat));
      if (loc && !issues.has('moved')) {
        const fixed = PIN_POS[pinKey].zone;
        const ok = loc.zone === fixed || (fixed === 'back' && loc.zone === 'center') || (fixed === 'center' && loc.zone === 'center');
        if (!ok) issues.add(`loc:${loc.zone}`);
      }
      if (!/\b(ON|X|on|off|OFF)\b|깜빡|켜|끄|꺼|점등|소등|서서히|%/.test(body)) issues.add('noState');
    }
    out.push((g.prefix ? `${g.prefix} ` : '') + body);
  }
  return { value: out.join('\n').trim(), issues: [...issues], move };
}

function lightingRows(S) {
  return S.rows.filter((r) => r.kind === 'stage' || r.kind === 'video' || r.kind === 'intro');
}

function normalizeCells(ctx) {
  const { S } = ctx;
  const zoneIssueRows = [];
  const pinAgg = { group: {}, follow: {}, loc: {} };
  for (const row of lightingRows(S)) {
    for (const key of ['lStage', 'lTop']) {
      if (!row.c[key]) continue;
      const { value, issues } = normalizeZoneCell(row.c[key], key);
      if (value !== row.c[key]) applyChange(ctx, 'light:format', row, key, value, '조명 표기 정리(구역 / 색상 / 밝기%)');
      const real = issues.filter((i) => ['unparsed', 'noColor', 'noColorTop', 'noPct', 'black', 'vague', 'zoneAdded', 'whiteAdded'].includes(i));
      if (real.length) zoneIssueRows.push({ row, key, issues: real });
    }
    for (const key of PIN_KEYS) {
      if (!row.c[key]) continue;
      const { value, issues, move } = normalizePinCell(row.c[key], key);
      const pos = PIN_POS[key];
      if (issues.includes('color')) {
        const fixId = `light:pincolor:${row.id}:${key}`;
        addFinding(ctx, {
          id: fixId,
          cat: 'light',
          level: 'error',
          rowId: row.id,
          key,
          title: `${pos.name}에 색상 지정 — 핀조명은 색 변경 불가`,
          msg: move
            ? `${pos.name}에 '${move.from}'처럼 여러 명을 색 조명으로 비추도록 적었습니다. 핀조명은 흰색 한 사람용이라 이 연출은 무대 조명으로 옮겼습니다: '${move.line}'.`
            : issues.includes('colorComplex')
              ? `${josa(pos.name, '은/는')} ON/OFF와 밝기만 조절할 수 있는데 '${nonWhiteColors(row.c[key]).slice(0, 3).join(', ')}' 같은 색이 적혀 있습니다. 색이 필요한 연출은 무대·상단 조명이나 FX로 옮겨 적어주세요.`
              : `${josa(pos.name, '은/는')} ON/OFF와 밝기만 조절할 수 있습니다. 색상 표현은 지우고 ON/밝기만 남겼습니다. 색이 필요하면 무대·상단 조명이나 FX를 사용하세요.`,
          why: WHY_PIN,
          fixId: issues.includes('colorComplex') ? undefined : fixId,
        });
        if (!issues.includes('colorComplex')) applyChange(ctx, fixId, row, key, value, '핀조명 색상 제거');
        if (move) {
          const cur = row.c.lStage;
          const nv = !cur || OFF_ONLY_RE.test(cur) || /^X/.test(cur) ? move.line : `${cur}\n${move.line}`;
          applyChange(ctx, fixId, row, 'lStage', nv, `${pos.name}에서 옮긴 조명`);
        }
      } else if (value !== row.c[key]) {
        applyChange(ctx, 'light:pinformat', row, key, value, '핀조명 표기 통일(ON / X)');
      }
      if (issues.includes('group')) (pinAgg.group[row.id] = pinAgg.group[row.id] || { row, pins: [] }).pins.push(key);
      if (issues.includes('follow')) (pinAgg.follow[row.id] = pinAgg.follow[row.id] || { row, pins: [] }).pins.push(key);
      const loc = issues.find((i) => i.startsWith('loc:'));
      if (loc) (pinAgg.loc[row.id] = pinAgg.loc[row.id] || { row, pins: [] }).pins.push({ key, zone: loc.slice(4) });
    }
  }
  const names = (pins) => pins.map((k) => PIN_POS[k].name).join('·');
  for (const { row, pins } of Object.values(pinAgg.group)) {
    addFinding(ctx, {
      id: `light:pingroup:${row.id}`,
      cat: 'light',
      level: 'warn',
      rowId: row.id,
      key: pins[0],
      title: `${josa(names(pins), '으로/로')} 여러 명을 비춤`,
      msg: '핀조명은 1명을 단독으로 비출 때 가장 효과적이고, 3명 이상은 핀 안에 담기 어렵습니다. 그룹은 무대 조명의 구역(왼쪽/중앙/오른쪽)으로 비추는 것을 권장합니다.',
      why: WHY_PIN,
      suggestion: '예) 무대: 왼쪽 / 흰색 / 70%  (해당 그룹이 서 있는 구역)',
    });
  }
  for (const row of lightingRows(S)) {
    const d = row.c.details || '';
    if (/(핀|pin)\s*\d?[^\n]{0,12}(따라|이동하며|이동해)|따라[^\n]{0,8}(핀|pin)/i.test(d) && !/FX/i.test(d) && !pinAgg.follow[row.id]) {
      const pins = PIN_KEYS.filter((k) => row.c[k] && !/^X/.test(row.c[k]));
      pinAgg.follow[row.id] = { row, pins: pins.length ? pins : ['pin3'] };
    }
  }
  for (const { row, pins } of Object.values(pinAgg.follow)) {
    addFinding(ctx, {
      id: `light:pinfollow:${row.id}`,
      cat: 'light',
      level: 'warn',
      rowId: row.id,
      key: pins[0],
      title: `${josa(names(pins), '이/가')} 사람을 따라가도록 요청함`,
      msg: `핀조명은 위치를 옮기기 어렵습니다. 핀은 정해진 자리(${pins.map((k) => `${PIN_POS[k].name}: ${PIN_POS[k].where}`).join(', ')})를 비추고, 출연자가 그 자리로 이동해서 서야 합니다. 동선을 따라 비춰야 한다면 무대 조명 구역을 순서대로 바꾸거나 FX(무빙·추가 핀)로 요청하세요.`,
      why: WHY_PIN,
    });
  }
  const ZNAME = { left: '무대 왼쪽', right: '무대 오른쪽', center: '무대 중앙', back: '단상', offstage: '무대 밖(객석·출입문·계단 등)' };
  for (const { row, pins } of Object.values(pinAgg.loc)) {
    const parts = pins.map(({ key, zone }) => {
      const pos = PIN_POS[key];
      const better = Object.values(PIN_POS).find((p) => p.zone === zone);
      return `${josa(pos.name, '은/는')} ${pos.where}에 고정인데 ${josa(ZNAME[zone], '을/를')} 비추도록 적음${better ? `(→ ${better.name} 사용 권장)` : zone === 'offstage' ? '(→ FX 추가 핀으로 지정)' : ''}`;
    });
    addFinding(ctx, {
      id: `light:pinloc:${row.id}`,
      cat: 'light',
      level: 'warn',
      rowId: row.id,
      key: pins[0].key,
      title: `핀 위치와 맞지 않는 곳을 비추도록 적음 (${names(pins.map((p) => p.key))})`,
      msg: `${parts.join(' / ')}. 핀은 위치를 바꿀 수 없으므로 출연자가 해당 핀 자리로 이동하거나, 그 자리에 맞는 핀을 쓰세요.`,
      why: WHY_PIN,
    });
  }
  // 무대/상단 형식 문제를 칸별로 묶어서 보고
  for (const { row, key, issues } of zoneIssueRows) {
    const msgs = [];
    if (issues.includes('unparsed')) msgs.push("'구역 / 색상 / 밝기' 형식으로 읽을 수 없는 문장이 있습니다");
    if (issues.includes('noPct')) msgs.push('밝기(%)가 없습니다');
    if (issues.includes('noColor')) msgs.push('색상이 없습니다(무대 조명은 인물을 비추는 밝은 계열 권장)');
    if (issues.includes('noColorTop')) msgs.push('상단 조명 색상이 없습니다(상단은 무대에 색을 입히는 조명)');
    const auto = [];
    if (issues.includes('vague')) auto.push("'밝게/어둡게' 같은 표현을 추정 %로 바꿨습니다(실제 밝기 확인)");
    if (issues.includes('zoneAdded')) auto.push("구역이 없어 '전체'로 적었습니다");
    if (issues.includes('whiteAdded')) auto.push("색상이 없어 '흰색'으로 적었습니다");
    if (issues.includes('black')) auto.push("'블랙/검정' 조명은 없으므로 꺼짐(X)으로 바꿨습니다");
    const hard = issues.some((i) => ['unparsed', 'noPct', 'noColor', 'noColorTop'].includes(i));
    addFinding(ctx, {
      id: `light:zone:${row.id}:${key}`,
      cat: 'light',
      level: hard ? 'warn' : 'info',
      rowId: row.id,
      key,
      title: `${colName(key)} 칸 형식`,
      msg: [...msgs, ...auto].join(' · '),
      why: WHY_ZONE,
      suggestion: key === 'lStage' ? '예) 중앙 / 흰색 / 100%, 왼쪽·오른쪽 / 흰색 / 30%' : '예) 전체 / 파란색 / 50%, 중앙 / #FFF0DE / 30%',
      fixId: auto.length ? 'light:format' : undefined,
    });
  }
  const pf = ctx.fixes.get('light:pinformat');
  if (pf && pf.cells.length) {
    addFinding(ctx, {
      id: 'light:pinformat',
      cat: 'light',
      level: 'info',
      title: `핀조명 표기 통일 ${pf.cells.length}곳`,
      msg: "핀조명은 켜짐 'ON'(필요하면 밝기 %), 꺼짐 'X'로 통일했습니다(공시 큐시트 방식).",
      why: WHY_PIN,
      fixId: 'light:pinformat',
      examples: pf.cells.slice(0, 4).map((c) => `${c.before.replace(/\n/g, ' ')} → ${c.after.replace(/\n/g, ' ')}`),
    });
  }
}

// ---------------- 5. FX ----------------
function fxRules(ctx) {
  const { S, o } = ctx;
  const labelRows = { 1: [], 2: [] };
  const typeUse = new Map(); // type -> rows
  const defs = { 1: new Set(), 2: new Set() };
  const outside = [];
  for (const row of S.rows) {
    const cells = { ...Object.fromEntries([...LIGHT_KEYS, 'details', 'note'].map((k) => [k, row.c[k] || ''])) };
    for (const [key, text] of Object.entries(cells)) {
      if (!text) continue;
      for (const line of text.split('\n')) {
        const labels = [...line.matchAll(/FX\s*([12])/gi)].map((m) => m[1]);
        const types = FX_TYPES.filter((t) => t.re.test(line)).map((t) => t.key);
        for (const l of labels) {
          labelRows[l].push(row);
          for (const t of types) defs[l].add(t);
        }
        for (const t of types) {
          if (!typeUse.has(t)) typeUse.set(t, []);
          typeUse.get(t).push({ row, key, line, labeled: labels.length > 0 });
        }
        if ((labels.length || types.length) && LIGHT_KEYS.includes(key)) outside.push({ row, key });
      }
    }
  }
  const used = [1, 2].filter((n) => labelRows[n].length);
  for (const n of used) {
    const userDef = (o.fx && o.fx[`FX${n}`]) || '';
    if (!defs[n].size && !userDef) {
      addFinding(ctx, {
        id: `fx:undefined:${n}`,
        cat: 'fx',
        level: 'warn',
        rowId: labelRows[n][0].id,
        key: 'details',
        title: `${josa(`FX${n}`, '이/가')} 어떤 효과인지 적혀 있지 않음`,
        msg: `${josa(`FX${n}`, '을/를')} 사용한다고 적었지만 효과 종류가 없습니다. 스트로브 / 고보 / 무빙 / 추가 핀(기존 Pin 위치가 아닌 곳) 중 무엇인지 지정해주세요. (화면 위 'FX 설정'에 적으면 큐시트에 함께 반영됩니다.)`,
        why: WHY_FX,
        suggestion: `예) 00:00~00:01 노래가 시작되면 1초간 스트로브 조명(FX${n})을 틀어주세요.`,
      });
    } else if (userDef && !defs[n].size) {
      const row = labelRows[n][0];
      const fixId = `fx:def:${n}`;
      addFinding(ctx, {
        id: fixId,
        cat: 'fx',
        level: 'info',
        rowId: row.id,
        key: 'details',
        title: `FX${n} 효과 종류 반영`,
        msg: `처음 ${josa(`FX${n}`, '이/가')} 나오는 Details에 'FX${n} = ${userDef}'를 적었습니다.`,
        why: WHY_FX,
        fixId,
      });
      applyChange(ctx, fixId, row, 'details', `${row.c.details}\n※ FX${n} = ${userDef}`.trim(), 'FX 종류 명시');
    }
  }
  const types = [...typeUse.keys()];
  if (types.length > 2) {
    addFinding(ctx, {
      id: 'fx:toomany',
      cat: 'fx',
      level: 'error',
      title: `FX 효과가 ${types.length}종류 — 2개까지만 가능`,
      msg: `${josa(types.map((t) => FX_TYPES.find((x) => x.key === t).name).join(', '), '을/를')} 사용하려고 합니다. FX는 2개만 골라 FX1·FX2로 지정할 수 있습니다(여러 효과를 하나로 묶은 연출은 FX 하나로 인정).`,
      why: WHY_FX,
    });
  }
  for (const [t, uses] of typeUse) {
    const unlabeled = uses.filter((u) => !u.labeled);
    if (unlabeled.length && !uses.some((u) => u.labeled)) {
      const u = unlabeled[0];
      addFinding(ctx, {
        id: `fx:unlabeled:${t}`,
        cat: 'fx',
        level: 'warn',
        rowId: u.row.id,
        key: u.key,
        title: `${FX_TYPES.find((x) => x.key === t).name} 효과를 FX로 지정하지 않음`,
        msg: `'${u.line.trim().slice(0, 40)}' — 이 효과는 FX에 해당합니다. FX1 또는 FX2로 이름을 붙이고 Details에 '언제 / 어떤 효과(FX1) / 얼마나'를 적어주세요.`,
        why: WHY_FX,
      });
    }
  }
  const pinMoving = S.rows.find((r) => PIN_KEYS.some((k) => /무빙/.test(r.c[k] || '')));
  if (pinMoving && !typeUse.has('moving')) {
    addFinding(ctx, { id: 'fx:pinmoving', cat: 'fx', level: 'warn', rowId: pinMoving.id, title: '핀조명 무빙 요청', msg: '핀조명은 움직일 수 없습니다. 움직이는 조명은 FX(무빙)로 지정해 Details에 적어주세요.', why: WHY_FX });
  }
  if (outside.length) {
    const f = outside[0];
    addFinding(ctx, {
      id: 'fx:outside',
      cat: 'fx',
      level: 'info',
      rowId: f.row.id,
      key: f.key,
      title: 'FX 내용이 Details가 아닌 칸에 있음',
      msg: `FX 관련 내용이 ${outside.length}곳의 무대/상단/Pin 칸에 있습니다. FX는 Pin4 옆 Details 칸에 적는 것이 규칙입니다.`,
      why: WHY_FX,
    });
  }
  // 스트로브 장시간
  for (const u of typeUse.get('strobe') || []) {
    const m = u.line.match(/(\d+)\s*초/);
    if (m && Number(m[1]) > 5) {
      addFinding(ctx, {
        id: `fx:strobe:${u.row.id}`,
        cat: 'fx',
        level: 'warn',
        rowId: u.row.id,
        key: u.key,
        title: '스트로브를 오래 사용함',
        msg: `스트로브를 ${m[1]}초 사용하도록 적었습니다. 길게 쓰면 관객에게 불편을 줄 수 있어 짧게(1~3초) 쓰는 것을 권장합니다.`,
        why: WHY_FX,
      });
    }
  }
  S.fx = { used, defs: { 1: [...defs[1]], 2: [...defs[2]] }, types };
}

// ---------------- 6. 빈 칸 채우기 / Details / 조명 미작성 ----------------
function effective(row) {
  return [...LIGHT_KEYS].map((k) => (row.c[k] || '').trim());
}
function isOff(v) {
  return !v || OFF_ONLY_RE.test(v) || /^X(\s*\(.*\))?$/.test(v.trim());
}

function fillBlanks(ctx) {
  const { S } = ctx;
  const BLANK = (v) => isBlank(v);
  let anyLight = false;
  for (const row of S.rows) if (LIGHT_KEYS.some((k) => !BLANK(row.c[k]))) anyLight = true;

  for (const b of S.blocks) {
    if (b.kind === 'host') continue;
    const blockHasLight = b.rows.some((r) => LIGHT_KEYS.some((k) => !BLANK(r.c[k])) || !BLANK(r.c.details));
    if (b.kind === 'video' || b.kind === 'intro') {
      for (const r of b.rows) {
        for (const k of LIGHT_KEYS) {
          if (!BLANK(r.c[k]) || r.cont[k]) continue;
          applyChange(ctx, 'fill:video', r, k, k === 'lStage' || k === 'lTop' ? 'X (암전)' : 'X', '영상 재생 중 암전으로 기본값');
        }
        if (BLANK(r.c.details) && !r.cont.details) {
          const allOff = LIGHT_KEYS.every((k) => isOff(r.c[k]));
          applyChange(ctx, 'fill:video', r, 'details', allOff ? '영상 재생 중 암전' : 'X', '영상 행 Details 기본값');
        }
      }
      continue;
    }
    if (!blockHasLight) {
      const r0 = b.rows[0];
      addFinding(ctx, {
        id: `light:none:${b.index}`,
        cat: 'light',
        level: 'error',
        rowId: r0.id,
        key: 'lStage',
        title: '조명 미작성',
        msg: `${blockLabel(b)}에 조명이 하나도 적혀 있지 않습니다. 행마다 무대 / 상단 / Pin1~4 / Details를 채우고, 쓰지 않는 조명은 X로 표시해주세요.`,
        why: "TFT 2차 피드백: '조명 사용하지 않을 시에 X 표시 필요' · 조명 가이드",
      });
      for (const r of b.rows) {
        if (!r.cont.lStage) applyPlaceholder(ctx, 'fill:placeholder', r, 'lStage', PLACEHOLDER, '조명 작성 필요');
      }
      continue;
    }
    let prevState = null;
    b.rows.forEach((r, idx) => {
      for (const k of LIGHT_KEYS) {
        if (!BLANK(r.c[k]) || r.cont[k]) continue;
        const prev = idx > 0 ? b.rows[idx - 1].c[k] : '';
        const keep = idx > 0 && prev && !isOff(prev) && prev !== PLACEHOLDER;
        applyChange(ctx, 'fill:light', r, k, keep ? '유지' : 'X', keep ? '빈 칸 → 앞 행 상태 유지' : '빈 칸 → 사용 안 함(X)');
      }
      const state = effective(r).map((v, i) => (v === '유지' && prevState ? prevState[i] : v));
      const changed = !prevState ? state.some((v) => !isOff(v)) : state.some((v, i) => v !== prevState[i] && v !== '유지');
      if (BLANK(r.c.details) && !r.cont.details) {
        if (changed) {
          (b.detailsBlank = b.detailsBlank || []).push(r);
          applyPlaceholder(ctx, 'fill:placeholder', r, 'details', PLACEHOLDER, 'Details 작성 필요');
        } else {
          applyChange(ctx, 'fill:light', r, 'details', 'X', 'Details 빈 칸 → X');
        }
      } else if (changed && b.kind === 'stage') {
        const txt = [r.c.details, ...LIGHT_KEYS.map((k) => r.c[k])].join(' ');
        if (!TRANSITION_RE.test(txt)) {
          (b.noTransition = b.noTransition || []).push(r);
        }
      }
      if (b.kind === 'stage' && r.c.details && SUBJECTIVE_RE.test(r.c.details) && !findClockTokens(r.c.details).length && !/["'“”‘’「」]/.test(r.c.details)) {
        addFinding(ctx, {
          id: `light:subjective:${r.id}`,
          cat: 'light',
          level: 'info',
          rowId: r.id,
          key: 'details',
          title: '주관적인 시점 표현',
          msg: `'${(r.c.details.match(SUBJECTIVE_RE) || [''])[0]}'처럼 사람마다 다르게 느낄 수 있는 표현이 있습니다. '사회자가 ○○라고 말한 직후', '출연자 전원이 무대 중앙에 정렬한 후', 가사 "○○"처럼 누가 보더라도 분명한 시점으로 적어주세요.`,
          why: WHY_TIP,
        });
      }
      prevState = state;
    });
    if (b.detailsBlank && b.detailsBlank.length) {
      const r = b.detailsBlank[0];
      addFinding(ctx, {
        id: `light:details:${b.index}`,
        cat: 'light',
        level: 'warn',
        rowId: r.id,
        key: 'details',
        title: b.detailsBlank.length > 1 ? `조명이 바뀌는데 Details가 빈 행 ${b.detailsBlank.length}곳` : '조명이 바뀌는데 Details가 비어 있음',
        msg: `${blockLabel(b)}에서 조명이 바뀌는 행의 Details가 비어 있습니다. 언제(가사·동작·시간), 누가 어디에서 어디로 움직일 때, 어떻게(즉시/서서히) 바뀌는지 적어주세요.`,
        why: "2026 큐시트 4행: 어떤 조명으로 언제 어떻게 사용할 것인지 디테일한 '동선' 포인트로 작성",
        suggestion: '예) 01:05 댄서 전원이 고개를 드는 순간 상단을 3초에 걸쳐 서서히 밝게',
        rows: b.detailsBlank.map((x) => x.id),
      });
    }
    if (b.noTransition && b.noTransition.length) {
      const r = b.noTransition[0];
      addFinding(ctx, {
        id: `light:transition:${b.index}`,
        cat: 'light',
        level: 'info',
        rowId: r.id,
        key: 'details',
        title: '조명 전환 방식 미기재',
        msg: `${blockLabel(b)}에서 조명이 바뀌는 ${b.noTransition.length}개 행에 즉시 바뀌는지, 서서히(몇 초) 바뀌는지가 없습니다. 함께 끄거나 바꿔야 하는 조명도 같이 적어주세요.`,
        why: WHY_TIP,
        suggestion: "예) '바로 켜주세요', '2초에 걸쳐 서서히 어둡게', '상단 끄면서 Pin3만 남기기'",
      });
    }
  }
  if (!anyLight) {
    addFinding(ctx, { id: 'light:nosheet', cat: 'light', level: 'error', title: '조명 전체 미작성', msg: '큐시트 전체에 조명이 적혀 있지 않습니다.', why: '2026 조명 큐시트 작성 가이드' });
  }
  const fl = ctx.fixes.get('fill:light');
  if (fl && fl.cells.length) {
    const keep = fl.cells.filter((c) => c.after === '유지').length;
    addFinding(ctx, {
      id: 'fill:light',
      cat: 'light',
      level: 'info',
      title: `빈 조명 칸 ${fl.cells.length}곳 채움 (X ${fl.cells.length - keep} · 유지 ${keep})`,
      msg: "쓰지 않는 조명은 'X', 앞 행의 조명을 그대로 이어가는 칸은 '유지'로 채웠습니다. '유지'로 채운 칸이 실제 의도와 맞는지 확인해주세요.",
      why: "TFT 2차 피드백: '조명 사용하지 않을 시에 X 표시 필요', 'Detail 부분 빈칸이 없게, 없다면 X'",
      fixId: 'fill:light',
    });
  }
}

export function lightRules(ctx) {
  splitLabeled(ctx);
  convert2025(ctx);
  reparse(ctx.S);
  unmergeLighting(ctx);
  alignCueTimes(ctx);
  normalizeCells(ctx);
  fxRules(ctx);
  fillBlanks(ctx);
  const lf = ctx.fixes.get('light:format');
  if (lf && lf.cells.length && !ctx.findings.some((f) => f.id === 'light:format-sum')) {
    addFinding(ctx, {
      id: 'light:format-sum',
      cat: 'light',
      level: 'info',
      title: `조명 표기 정리 ${lf.cells.length}곳`,
      msg: "'구역 / 색상 / 밝기%' 형식으로 맞추고(% 누락 보충, 색상코드 # 보충, 꺼짐은 X로 통일) 모호한 밝기는 추정 %를 붙였습니다.",
      why: WHY_ZONE,
      fixId: 'light:format',
      examples: lf.cells.slice(0, 4).map((c) => `${c.before.replace(/\n/g, ' ')} → ${c.after.replace(/\n/g, ' ')}`),
    });
  }
}

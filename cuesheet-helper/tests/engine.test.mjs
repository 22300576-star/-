import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { parseGrid } from '../public/assets/js/engine/parser.js';
import { analyze } from '../public/assets/js/engine/analyze.js';
import { parseRunTime, fmtRunTime, shiftClocksInText } from '../public/assets/js/engine/time.js';
import { josa } from '../public/assets/js/engine/josa.js';
import { buildWorkbook } from '../public/assets/js/io/export-xlsx.js';
import { gridFromTsv } from '../public/assets/js/io/importers.js';
import { SAMPLE_DRAFT, SAMPLE_MODEL } from '../public/assets/js/samples.js';
import { overviewText } from '../public/assets/js/engine/overview.js';
import { adviceText } from '../public/assets/js/engine/advice.js';
import { buildOutput, isChosen, choiceItems, choiceStats, editOps, parseSplitText } from '../public/assets/js/engine/choices.js';

const clone = (o) => JSON.parse(JSON.stringify(o));
const titles = (res) => res.findings.map((f) => f.title);

test('Run Time 표기를 해석한다', () => {
  assert.deepEqual(
    (({ start, end, stated }) => ({ start, end, stated }))(parseRunTime('0:00-0:17  (17초)')),
    { start: 0, end: 17, stated: 17 },
  );
  const a = parseRunTime('01:29 - 01: 32 (3초)');
  assert.equal(a.start, 89);
  assert.equal(a.end, 92);
  const b = parseRunTime('2분 30초');
  assert.ok(b.durOnly);
  assert.equal(b.stated, 150);
  const c = parseRunTime("1'40''");
  assert.equal(c.stated, 100);
  assert.equal(parseRunTime('10:33 ~ 12:28 (1분 55초)').stated, 115);
  assert.equal(fmtRunTime(0, 4), '00:00 ~ 00:04 (4초)');
  assert.equal(shiftClocksInText('0:50 왼쪽/진파랑/30', (t) => t - 20), '00:30 왼쪽/진파랑/30');
});

test('조사를 받침에 맞게 고른다', () => {
  assert.equal(josa('Pin1', '은/는'), 'Pin1은');
  assert.equal(josa('Pin2', '은/는'), 'Pin2는');
  assert.equal(josa('무대 중앙', '을/를'), '무대 중앙을');
  assert.equal(josa('무대 3(113초)', '이/가'), '무대 3(113초)이');
});

test('모범 예시는 고칠 점이 없다', () => {
  const res = analyze(parseGrid(clone(SAMPLE_MODEL)));
  assert.equal(res.summary.counts.error, 0, titles(res).join(' / '));
  assert.equal(res.summary.counts.warn, 0, titles(res).join(' / '));
});

test('수정 전 예시의 대표 오류를 모두 찾는다', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const t = titles(res).join('\n');
  for (const want of ['11분 초과', 'FX 효과가 3종류', '핀조명은 색 변경 불가', '한 곡을 한 행으로만 작성함', '길이만 적혀 있음', 'Run Time 기준 시점 통일', '마이크 개수가 없음', '사람을 따라가도록']) {
    assert.ok(t.includes(want), `'${want}' 없음:\n${t}`);
  }
  // 인트로 포함 시간 → 인트로 이후 00:00 기준으로 변환
  const first = res.revised.rows.find((r) => r.kind === 'video');
  assert.equal(first.c.runtime, '00:00 ~ 00:40 (40초)');
  // 그룹 핀(색) → 무대 조명으로 이동
  assert.ok(res.revised.rows.some((r) => /분홍색 \/ 60%/.test(r.c.lStage)));
});

test('자동 반영을 끄면 원래 값이 남는다', () => {
  const model = parseGrid(clone(SAMPLE_DRAFT));
  const on = analyze(model);
  const off = analyze(model, { disabled: new Set(['time:base']) });
  const v1 = on.revised.rows.find((r) => r.kind === 'video').c.runtime;
  const v2 = off.revised.rows.find((r) => r.kind === 'video').c.runtime;
  assert.notEqual(v1, v2);
});

test('조명 큐 시간이 Run Time과 어긋나면 보정한다', () => {
  const H = [['항목', 'Run Time', '무대', '대기 인원', '세부 내용', '개사 내용', '음향 / FD', '화면(영상)', '조명', '', '', '', '', '', '', '비고'], ['', '', '', '', '', '', '', '', '무대', '상단', 'Pin1', 'Pin2', 'Pin3', 'Pin4', 'Details', '']];
  const r = (a) => Object.assign(new Array(16).fill(''), a);
  const grid = {
    cells: [
      ...H,
      r({ 0: '무대 1\n(곡)', 1: '00:30 ~ 00:46 (16초)', 2: '댄서 10명 무대', 3: 'X', 4: '댄서 10명이 중앙으로 걸어옴', 5: '간주', 6: '합창 마이크 4개', 7: '영상', 8: '0:50 왼쪽/흰색/30', 9: '0:58 전체/파랑/20', 10: 'X', 11: 'X', 12: '0:50 ON', 13: 'X', 14: '0:50 댄서 등장 시 즉시 켜기' }),
      r({ 1: '00:46 ~ 01:12 (26초)', 4: '댄서 10명 삼각형 대형 안무', 5: '노래 1', 8: '유지', 9: '1:07 전체/파랑/100', 10: 'X', 11: 'X', 12: 'ON', 13: 'X', 14: '1:07 서서히 밝게' }),
      r({ 1: '01:12 ~ 01:23 (11초)', 4: '댄서 10명 2줄로 퍼짐', 5: '노래 2', 8: '1:33 전체/빨강/70', 9: '1:39 X', 10: 'X', 11: 'X', 12: 'X', 13: 'X', 14: '1:33 즉시 바꾸기' }),
    ],
    merges: [],
  };
  const res = analyze(parseGrid(grid));
  assert.ok(titles(res).includes('조명 시간이 Run Time과 맞지 않음'));
  const row = res.revised.rows.find((x) => x.c.lStage.includes('왼쪽'));
  assert.match(row.c.lStage, /^00:(29|30|31) /);
});

test('붙여넣은 TSV(여러 줄 셀)를 읽는다', () => {
  const g = gridFromTsv('항목\tRun Time\n"무대 1\n(곡)"\t0:00-0:10\n');
  assert.equal(g.cells[1][0], '무대 1\n(곡)');
});

test('2차 큐시트 양식으로 엑셀을 만든다', async () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const wb = await buildWorkbook(ExcelJS, res.revised, { mode: 'review', feedbackText: res.summary.feedbackText, findings: res.findings, title: '예시학부' });
  const ws = wb.getWorksheet('예시학부');
  assert.ok(ws);
  assert.equal(ws.getCell('B2').value, 'Run Time');
  assert.equal(ws.getCell('I2').value, '조명');
  assert.equal(ws.getCell('O3').value, 'Details');
  assert.equal(ws.getCell('B2').font.name, 'Arial');
  assert.ok(ws.views[0].state === 'frozen' && ws.views[0].ySplit === 4);
  assert.ok(wb.getWorksheet('피드백 목록'));
  assert.equal(wb.getWorksheet('피드백 목록').getCell('A2').value, '수정요망');
  const buf = await wb.xlsx.writeBuffer();
  assert.ok(buf.byteLength > 5000);
  const wb2 = await buildWorkbook(ExcelJS, res.revised, { mode: 'review', findings: res.findings, title: '예시학부', overviewText: overviewText(res.summary.overview) });
  assert.match(String(wb2.getWorksheet('총평').getCell('A2').value), /11분 40초/);
});

test('총평과 수정 방향을 만든다 (수정요망 하나로, 논의 중은 피드백에서 뺌)', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const { summary } = res;
  const o = summary.overview;
  assert.ok(!res.findings.some((f) => f.cat === 'pending'), '논의 중 피드백이 남아 있음');
  assert.ok(res.revised.rows.some((r) => Object.values(r.marks || {}).some((m) => m && m.pending)), '논의 중 칸의 보라색 표시는 남아야 함');
  assert.equal(summary.todo, summary.counts.error + summary.counts.warn);
  assert.match(o.lead, /11분 40초/);
  assert.match(o.lead, /40초 넘었/);
  assert.match(o.directions[0].action, /40초 줄여 11분 안으로/);
  const firstFixed = o.directions.findIndex((d) => d.fixed);
  assert.ok(firstFixed > 0 && o.directions.slice(firstFixed).every((d) => d.fixed), '수정본에 반영된 것은 맨 뒤');
  assert.match(summary.feedbackText, /^\[총평\] /);
  assert.match(summary.feedbackText, /\n\[수정요망\] /);
  assert.doesNotMatch(summary.feedbackText, /필수|권장|논의 중/);
  assert.match(overviewText(o), /수정 방향\n1\. Run Time — /);
});

test('고칠 것이 없으면 총평이 제출 가능으로 끝난다', () => {
  const o = analyze(parseGrid(clone(SAMPLE_MODEL))).summary.overview;
  assert.ok(o.ok);
  assert.equal(o.directions.length, 0);
  assert.match(o.lead, /그대로 제출하면 됩니다/);
});

// ---------- 원래 → 수정 후 · 주인공 조명 기준 · 음향·조명 제안 ----------
const HEAD = [['항목', 'Run Time', '무대', '대기 인원', '세부 내용', '개사 내용', '음향 / FD', '화면(영상)', '조명', '', '', '', '', '', '', '비고'], ['', '', '', '', '', '', '', '', '무대', '상단', 'Pin1', 'Pin2', 'Pin3', 'Pin4', 'Details', '']];
const cells = (a) => Object.assign(new Array(16).fill(''), a);
function stageGrid({ details, sound = '합창 마이크 4개 (단상 앞)\n무선 마이크 1개 (주인공)', lyrics2 = '새벽을 깨우는 노래\n함께라서 두렵지 않아' }) {
  return {
    cells: [
      ...HEAD,
      cells({ 0: '무대 1\n(새벽의 노래)', 1: '00:00 ~ 00:12 (12초)', 2: '주인공 1명 무대 중앙 / 콰이어 24명 단상', 3: 'X', 4: '주인공 1명이 무대 왼쪽 계단에서 무대 중앙으로 걸어 올라옴', 5: '간주', 6: sound, 7: '가사 영상 1', 8: 'X', 9: '전체 / 진파랑 / 20%', 10: 'X', 11: 'X', 12: '00:04 ON', 13: 'X', 14: details }),
      cells({ 1: '00:12 ~ 00:40 (28초)', 4: '콰이어 24명 단상에서 노래, 주인공은 무대 중앙에서 솔로', 5: lyrics2, 8: '중앙 / 흰색 / 60%', 9: '유지', 10: 'X', 11: 'X', 12: 'ON', 13: 'X', 14: '00:12 가사 시작과 동시에 무대 중앙 흰색 60% 즉시 ON' }),
    ],
    merges: [],
  };
}

test('주인공이 있으면 조명 Details에 동선·의상·위치를 요구한다', () => {
  const full = analyze(parseGrid(stageGrid({ details: '00:04 흰 드레스를 입은 주인공이 무대 왼쪽 계단에서 올라와 Pin3 위치(무대 앞쪽 중앙)에 도착하면 Pin3 즉시 ON' })));
  assert.ok(!full.findings.some((f) => f.id.startsWith('light:protag')), titles(full).join(' / '));
  const noCostume = analyze(parseGrid(stageGrid({ details: '00:04 주인공이 무대 왼쪽 계단에서 올라와 Pin3 위치에 도착하면 Pin3 즉시 ON' })));
  const f = noCostume.findings.find((x) => x.id.startsWith('light:protag'));
  assert.ok(f, '의상이 없으면 피드백');
  assert.equal(f.title, '조명 Details에 주인공의 의상이 없음');
  assert.equal(f.level, 'warn');
  // 원래 문장은 두고 의상만 더한 '수정 후'
  assert.equal(f.before, '00:04 주인공이 무대 왼쪽 계단에서 올라와 Pin3 위치에 도착하면 Pin3 즉시 ON');
  assert.match(f.after, /^00:04 주인공\(\[흰 드레스\]\)이 무대 왼쪽 계단에서/);
  const none = analyze(parseGrid(stageGrid({ details: '00:04 Pin3 즉시 ON' })));
  const g = none.findings.find((x) => x.id.startsWith('light:protag'));
  assert.equal(g.title, '조명 Details에 주인공이 나오지 않음');
  assert.match(g.after, /주인공\(\[흰 드레스\]\)이 무대 왼쪽 계단에서 무대 중앙으로 걸어 올라옴 → 무대 중앙\(Pin3 자리\)에 서면 Pin3 즉시 ON/);
  // 주인공이 없는 학부(솔로만)에는 이 기준을 쓰지 않음
  const model = analyze(parseGrid(clone(SAMPLE_MODEL)));
  assert.ok(!model.findings.some((x) => x.id.startsWith('light:protag:4')), '솔로만 있는 무대 2에는 주인공 기준을 적용하지 않음');
});

test('노래하는 구간·노래하는 주인공에 마이크가 없으면 알려준다', () => {
  const d = '00:04 흰 드레스를 입은 주인공이 무대 왼쪽 계단에서 올라와 Pin3 위치에 도착하면 Pin3 즉시 ON';
  const noMic = analyze(parseGrid(stageGrid({ details: d, sound: 'X' })));
  const f = noMic.findings.find((x) => x.id.startsWith('sound:sing'));
  assert.ok(f, titles(noMic).join(' / '));
  assert.match(f.after, /합창 마이크 4개 \(단상 앞, 콰이어 24명\)/);
  assert.match(f.after, /무선 마이크 1개 \(주인공\)/);
  const choirOnly = analyze(parseGrid(stageGrid({ details: d, sound: '합창 마이크 4개 (단상 앞)' })));
  const g = choirOnly.findings.find((x) => x.id.startsWith('sound:solo'));
  assert.ok(g, '주인공이 솔로로 부르는데 무선 마이크가 없음');
  assert.equal(g.before, '합창 마이크 4개 (단상 앞)');
  assert.match(g.after, /무선 마이크 1개 \(주인공\)/);
});

test('피드백마다 원래 → 수정 후를 보여준다', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const todo = res.findings.filter((f) => f.level !== 'info');
  const missing = todo.filter((f) => f.after == null).map((f) => f.id);
  assert.deepEqual(missing, [], '수정요망인데 수정 후가 없는 피드백');
  const pin = res.findings.find((f) => f.id === 'light:pincolor:r7:pin3');
  assert.equal(pin.before, '주인공 / 금색');
  assert.equal(pin.afterKind, 'auto');
  assert.doesNotMatch(pin.after, /금색/);
  const split = res.findings.find((f) => f.id === 'time:split1:5');
  assert.equal(split.before, '4:41-6:31');
  assert.equal(split.after.split('\n').length, 4);
  assert.match(split.after, /^02:41 ~ 03:09 \(28초\) 함께 걷는 이 길 위에 \/ 우리의 꿈을 그려요/);
  const vague = res.findings.find((f) => f.id === 'detail:vague:3');
  assert.equal(vague.before, '전체 안무');
  assert.match(vague.after, /^00:52 가사 "새벽을 깨우는 우리의…"에 맞춰 댄서 15명이/);
  const limit = res.findings.find((f) => f.id === 'time:limit');
  assert.match(limit.before, /11분 40초/);
  assert.match(limit.after, /11분 이내/);
  const subj = res.findings.find((f) => f.id === 'light:subjective:r9');
  assert.equal(subj.after, '01:20 가사 "빛나는 내일을 향해" 시작과 동시에 밝게');
  const fx = res.findings.find((f) => f.id === 'fx:unlabeled:strobe');
  assert.match(fx.after, /FX1 스트로브 2초간, FX2 바닥 고보 패턴 \(무빙은 빼기/);
  // 메시지·검토용 엑셀에도 같은 원래 → 수정 후
  assert.ok(res.summary.feedbackText.includes('[음향·조명 제안]'));
});

test('무대 내용과 개사를 분석해 음향·조명을 제안한다', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const a = res.advice.find((x) => x.label === '무대 1');
  assert.ok(a);
  assert.match(a.about, /차분하고 서정적인 곡/);
  assert.ok(a.light.some((t) => /진파랑/.test(t) && /새벽/.test(t)), a.light.join('\n'));
  assert.ok(a.light.some((t) => /^절정 01:20 ~ 01:41 가사 "빛나는 내일을 향해"/.test(t)), a.light.join('\n'));
  assert.ok(a.light.some((t) => /주인공: 무대 중앙에 서므로 Pin3/.test(t)));
  assert.ok(a.sound.some((t) => /합창 마이크 4개 정도 — 콰이어 24명/.test(t)));
  assert.ok(a.sound.some((t) => /00:40 ~ 00:52 간주\)에는 합창 마이크를 꺼 두고/.test(t)), a.sound.join('\n'));
  assert.match(res.summary.overview.advice[0].brief, /차분 분위기 → 상단 진파랑/);
  assert.match(overviewText(res.summary.overview), /음향·조명 제안 \(무대 내용·개사 분석\)\n- 무대 1/);
  assert.match(adviceText(res.advice), /\[조명\] 가사 분위기: 차분하고 서정적인 곡/);
});

test('검토용 엑셀 피드백 목록에 원래 · 수정 후 열이 있다', async () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const wb = await buildWorkbook(ExcelJS, res.revised, { mode: 'review', findings: res.findings, title: '예시학부', overviewText: [overviewText(res.summary.overview, { withAdvice: false }), adviceText(res.advice)].join('\n\n') });
  const fl = wb.getWorksheet('피드백 목록');
  assert.equal(fl.getCell('E1').value, '원래');
  assert.equal(fl.getCell('F1').value, '수정 후');
  const rows = fl.getSheetValues().slice(2).filter(Boolean);
  const pin = rows.find((r) => /Pin3에 색상 지정/.test(r[4]));
  assert.equal(pin[5], '주인공 / 금색');
  assert.match(pin[6], /^\(자동 정리\) /);
  const ov = wb.getWorksheet('총평');
  const text = ov.getSheetValues().map((r) => (r ? r[1] : '')).join('\n');
  assert.match(text, /\[음향\] 합창 마이크 4개 정도/);
});

// ---------- 항목별 반영 고르기 → 피드백 반영본 ----------
const rowOf = (S, id) => S.rows.find((r) => r.id === id);

test('기본 선택: 자동 정리는 반영, 예시가 들어가는 수정은 골라서', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const pin = res.findings.find((f) => f.id === 'light:pincolor:r7:pin3');
  const protag = res.findings.find((f) => f.id.startsWith('light:protag'));
  const limit = res.findings.find((f) => f.id === 'time:limit');
  assert.equal(pin.apply, 'auto');
  assert.ok(isChosen(pin, new Map()));
  assert.equal(protag.apply, 'op');
  assert.ok(protag.editable);
  assert.ok(!isChosen(protag, new Map()), '[ ] 예시가 들어가는 수정은 기본으로 반영하지 않음');
  assert.equal(limit.apply, 'manual');
  // 고를 수 있는 항목: 자동 정리 + 반영 작업이 있는 수정 + 반영할 수 있는 제안
  const items = choiceItems(res);
  assert.ok(items.some((i) => i.id === 'adv:mic:3'), '간주 구간 마이크 OFF/ON 제안');
  const st = choiceStats(res, new Map());
  assert.equal(st.total, items.length);
  assert.equal(st.manual, 2); // 11분 초과 · FX 3종류는 직접 고치기
});

test('고른 피드백만 반영본에 들어가고 원본은 그대로', () => {
  const model = parseGrid(clone(SAMPLE_DRAFT));
  const snapshot = JSON.stringify(model);
  const res = analyze(model);
  const protag = res.findings.find((f) => f.id.startsWith('light:protag'));
  // 기본: 주인공 Details는 원래대로
  const def = buildOutput(res, new Map(), new Map());
  assert.equal(rowOf(def.S, 'r7').c.details, '주인공 따라 핀 이동');
  // 반영: 수정 후 문구가 그 칸에 들어가고, [ ] 예시가 있으면 붉게(작성 필요) 표시
  const on = buildOutput(res, new Map([[protag.id, true]]), new Map());
  const cell = rowOf(on.S, 'r7');
  assert.equal(cell.c.details, protag.after);
  assert.equal(cell.marks.details.by, protag.id);
  assert.ok(cell.marks.details.placeholder);
  assert.ok(on.applied.includes(protag.id));
  // 문구를 고쳐서 반영
  const ed = buildOutput(res, new Map([[protag.id, true]]), new Map([[protag.id, '00:40 흰 드레스를 입은 주인공이 무대 왼쪽 계단에서 올라와 Pin3 자리에 서면 Pin3 즉시 ON']]));
  assert.match(rowOf(ed.S, 'r7').c.details, /^00:40 흰 드레스를 입은/);
  assert.ok(!rowOf(ed.S, 'r7').marks.details.placeholder);
  // 첨부한 원본 모델은 바뀌지 않음
  assert.equal(JSON.stringify(model), snapshot);
});

test('자동 정리를 반영 안 함으로 고르면 그 칸은 원래대로', () => {
  const model = parseGrid(clone(SAMPLE_DRAFT));
  const off = analyze(model, { disabled: new Set(['light:pincolor:r7:pin3']) });
  const out = buildOutput(off, new Map(), new Map());
  assert.equal(rowOf(out.S, 'r7').c.pin3, '주인공 / 금색');
  assert.ok(!isChosen(off.findings.find((f) => f.id === 'light:pincolor:r7:pin3'), new Map()));
});

test('한 곡을 한 행으로 쓴 무대는 반영하면 가사 슬라이드마다 행을 나눈다', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const split = res.findings.find((f) => f.id === 'time:split1:5');
  const out = buildOutput(res, new Map([[split.id, true]]), new Map());
  assert.equal(out.S.rows.length, res.revised.rows.length + 3);
  const rows = out.S.rows.filter((r) => r.id === 'r11' || r.id.startsWith('r11-s'));
  assert.deepEqual(rows.map((r) => r.c.runtime), ['02:41 ~ 03:09 (28초)', '03:09 ~ 03:36 (27초)', '03:36 ~ 04:04 (28초)', '04:04 ~ 04:31 (27초)']);
  assert.equal(rows[1].c.lyrics, '손을 잡고 노래해요\n한동의 빛이 되어');
  assert.ok(rows[1].cont.item && rows[1].cont.sound, '항목·음향은 위 칸과 병합');
  assert.equal(rows[1].c.detail, '(작성 필요)');
  assert.equal(rows[1].c.lStage, '유지');
  // 나눈 행도 같은 무대(묶음)로 계산
  assert.equal(out.S.blocks.find((b) => b.rows.some((r) => r.id === 'r11')).rows.length, 4);
  // 문구를 고쳐 3행으로
  const ed = buildOutput(res, new Map([[split.id, true]]), new Map([[split.id, '02:41 ~ 03:30 (49초) 함께 걷는 이 길 위에 / 우리의 꿈을 그려요\n03:30 ~ 04:00 (30초) 손을 잡고 노래해요\n04:00 ~ 04:31 (31초) 우리의 행진은']]));
  assert.equal(ed.S.rows.length, res.revised.rows.length + 2);
  assert.deepEqual(parseSplitText('00:00 ~ 00:10 (10초) 가 / 나')[0], { runtime: '00:00 ~ 00:10 (10초)', lyrics: '가\n나' });
});

test('같은 칸을 바꾸는 피드백은 한 장으로 묶고, 제안도 반영할 수 있다', () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const follow = res.findings.find((f) => f.id === 'light:pinfollow:r7');
  const protag = res.findings.find((f) => f.id.startsWith('light:protag'));
  // 주인공 Details 문구가 그 칸의 최종 문구 → 주인공 피드백이 대표, '핀이 따라가도록'은 함께 해결
  assert.equal(follow.dupOf, protag.id);
  assert.deepEqual(protag.also, [follow.title]);
  assert.ok(!choiceItems(res).some((i) => i.id === follow.id), '묶여 들어간 피드백은 따로 고르지 않음');
  const both = buildOutput(res, new Map([[protag.id, true]]), new Map());
  assert.equal(rowOf(both.S, 'r7').c.details, protag.after);
  assert.equal(both.conflicts.size, 0, '같은 칸끼리 부딪치지 않음');
  assert.ok(both.applied.includes(follow.id) && isChosen(follow, new Map([[protag.id, true]])), '함께 해결된 피드백도 반영으로');
  // FX 한 칸에 걸린 4가지(FX로 지정 3 + 스트로브 길이)는 한 문구로
  const fx = res.findings.find((f) => f.id === 'fx:unlabeled:strobe');
  assert.equal(fx.merged.length, 4);
  assert.equal(fx.after, '[03:38] 후렴에서 FX1 스트로브 2초간, FX2 바닥 고보 패턴 (무빙은 빼기 — FX는 2개까지)');
  assert.deepEqual(editOps(fx, 'X'), [{ rowId: fx.rowId, key: 'details', set: 'X' }]);
  const mic = choiceItems(res).find((i) => i.id === 'adv:mic:3');
  const out = buildOutput(res, new Map([['adv:mic:3', true]]), new Map());
  const sound = rowOf(out.S, mic.rowId).c.sound;
  assert.match(sound, /00:40 ~ 00:52 간주: 합창 마이크 OFF\n00:52 가사 시작: 합창 마이크 ON/);
});

test('검토용 엑셀의 반영 열: 반영함 · 반영 안 함 · 직접 고치기', async () => {
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const protag = res.findings.find((f) => f.id.startsWith('light:protag'));
  const out = buildOutput(res, new Map([[protag.id, true]]), new Map());
  const wb = await buildWorkbook(ExcelJS, out.S, { mode: 'review', findings: res.findings, chosen: new Set(out.applied), title: '예시학부' });
  const rows = wb.getWorksheet('피드백 목록').getSheetValues().slice(2).filter(Boolean);
  const tag = (re) => rows.find((r) => re.test(r[4]))[9];
  assert.equal(wb.getWorksheet('피드백 목록').getCell('I1').value, '반영');
  assert.equal(tag(/조명 Details에 주인공/), '반영함');
  assert.equal(tag(/세부 내용이 구체적이지 않음/), '반영 안 함');
  assert.equal(tag(/11분 초과/), '직접 고치기');
  assert.equal(tag(/Pin3에 색상 지정/), '반영함');
  // 반영본 엑셀(제출용)에서 바뀐 칸 노란색은 고를 때만
  const plain = await buildWorkbook(ExcelJS, out.S, { mode: 'submit', title: '예시학부' });
  const hl = await buildWorkbook(ExcelJS, out.S, { mode: 'submit', title: '예시학부', highlight: true });
  // 8행 Pin3: '주인공 / 금색' → 'ON / 주인공' (자동 정리로 바뀐 칸)
  const cellAt = (wbk) => wbk.getWorksheet('예시학부').getCell(`M${out.S.rows.findIndex((r) => r.id === 'r7') + 5}`);
  assert.notEqual((cellAt(plain).fill || {}).fgColor && cellAt(plain).fill.fgColor.argb, 'FFFFF9C4');
  assert.equal(cellAt(hl).fill.fgColor.argb, 'FFFFF9C4');
});

// ---------- 읽기 쉽게 묶기: 같은 종류는 한 묶음 · 같은 칸은 한 장 · 같은 자동 정리는 한 번 ----------
test('피드백을 고칠 방법(종류)마다 묶고, 설명 · 근거는 묶음에 한 번만', async () => {
  const { digest } = await import('../public/assets/js/engine/digest.js');
  const res = analyze(parseGrid(clone(SAMPLE_DRAFT)));
  const d = digest(res);
  // 고칠 것: 11분 초과가 맨 앞, 수정요망 28건이 12가지로
  assert.match(d.todo[0].label, /40초 줄여 11분 안으로/);
  assert.equal(d.todo.length, 12);
  const places = d.todo.flatMap((g) => g.places);
  assert.ok(places.every((f) => (f.level === 'error' || f.level === 'warn') && f.apply !== 'auto' && !f.dupOf));
  // 같은 종류(빈 세부 내용 3곳)는 한 묶음, 위치 순서대로
  const blank = d.todo.find((g) => /비어 있는 세부 내용/.test(g.label));
  assert.equal(blank.places.length, 3);
  assert.equal(blank.kind, 'pick');
  assert.ok(blank.why && !/\n/.test(blank.why), '근거는 묶음에 한 번');
  // 같은 칸(조명 Details)에 걸린 FX 4가지는 한 곳으로
  const fx = d.todo.find((g) => /FX1·FX2로 지정하기/.test(g.label));
  assert.equal(fx.places.length, 1);
  assert.equal(fx.places[0].merged.length, 4);
  // 자동 정리: 같은 fixId는 한 번만
  const fixIds = d.auto.flatMap((g) => g.places).map((f) => f.fixId).filter(Boolean);
  assert.equal(new Set(fixIds).size, fixIds.length);
  // 항목별 고칠 곳 수 = 고칠 것 위치 수
  assert.equal(d.items.reduce((n, i) => n + i.todo, 0), places.length);
  assert.equal(d.items.find((i) => i.id === 'lyrics').todo, 0);
  // 모든 수정요망은 고칠 것 · 자동 정리 · (같은 칸으로 묶임) 중 하나에 들어감
  const inAuto = new Set(d.auto.flatMap((g) => g.places).map((f) => f.fixId));
  for (const f of res.findings.filter((x) => x.level === 'error' || x.level === 'warn')) {
    assert.ok(places.includes(f) || f.dupOf || (f.apply === 'auto' && inAuto.has(f.fixId)), f.id);
  }
});

// ---------------- TFT 조명 Q&A ----------------
// 모범 예시(고칠 점 없음)의 무대 1 칸을 바꿔 규칙을 확인한다. dr: 무대 1 첫 행에서 몇 번째 행인지
const COL = { lStage: 8, lTop: 9, pin1: 10, pin2: 11, pin3: 12, pin4: 13, details: 14, note: 15 };
function modelWith(edits) {
  const g = clone(SAMPLE_MODEL);
  const base = g.cells.findIndex((r) => /^무대 1/.test(r[0]));
  for (const [dr, key, v] of edits) g.cells[base + dr][COL[key]] = v;
  return analyze(parseGrid(g));
}
const ids = (res, re) => res.findings.filter((f) => re.test(f.id));

test('TFT 조명 Q&A: 점멸 · 반짝임은 FX가 아니지만 어떤 조명을 · 어떻게까지 적어야 한다', () => {
  let res = modelWith([[1, 'details', '후렴에서 신나게 깜빡깜빡']]);
  const f = ids(res, /^light:blink:/)[0];
  assert.ok(f, titles(res).join(' / '));
  assert.equal(f.level, 'warn');
  assert.match(f.msg, /빠진 것: 어떤 조명을, 어떻게/);
  assert.equal(ids(res, /^fx:/).filter((x) => x.level !== 'info').length, 0, 'FX로 세지 않는다');
  // 구체적으로 적으면 통과
  res = modelWith([[1, 'details', '00:52 가사 "새벽을" 동안 상단 전체 / 핑크를 1박마다 30% ↔ 80%로 점멸']]);
  assert.equal(ids(res, /^light:blink:/).length, 0, titles(res).join(' / '));
  // '깜빡임 X'는 하지 말라는 뜻
  res = modelWith([[1, 'details', '00:52 상단 빨강 즉시 ON (깜빡임 X)']]);
  assert.equal(ids(res, /^light:blink:/).length, 0);
  // 비트에 맞춘 번쩍임은 스트로브(FX)로 세지 않는다
  res = modelWith([[1, 'details', '00:55 비트에 맞춰 무대 중앙 / 흰색 / 100%를 0.5초 번쩍 (2번)']]);
  assert.equal(ids(res, /^fx:unlabeled:strobe|^light:blink:/).length, 0, titles(res).join(' / '));
  // FX 이름을 단순 점멸에 붙이면 'FX가 아님' 참고 ('어떤 효과인지 없음' 대신)
  res = modelWith([[1, 'details', '00:52 FX2 점멸 (상단 1초 간격)']]);
  assert.ok(res.findings.some((x) => x.id === 'fx:blinkfx:2' && x.level === 'info'), titles(res).join(' / '));
  assert.ok(!res.findings.some((x) => x.id === 'fx:undefined:2'));
});

test('TFT 조명 Q&A: 콰이어만 · 샤워 · 무대 아래 단원 · 십자가 비추기는 FX로 지정해야 한다', () => {
  const cases = [
    ['choirOnly', '01:00 후렴에서 콰이어만 따로 비춰주세요', /콰이어만 비추기 연출을 FX로 지정하지 않음/],
    ['shower', '01:00 위에서 샤워처럼 빛이 쏟아지게', /일반 핀으로 쓸 수 없습니다/],
    ['below', '01:00 무대 아래 왼쪽 계단 앞에서 안무하는 단원들도 비춰주세요', /단원들의 위치/],
    ['cross', '01:00 단원들은 어둡게, 채플 오른쪽 위 십자가만 비춰주세요', /FX를 써야 가능/],
  ];
  for (const [type, text, re] of cases) {
    const res = modelWith([[1, 'details', text]]);
    const f = res.findings.find((x) => x.id === `fx:unlabeled:${type}`);
    assert.ok(f, `${type}: ${titles(res).join(' / ')}`);
    assert.equal(f.level, 'warn');
    assert.match(`${f.title} ${f.msg}`, re);
    assert.match(f.why, /TFT 조명 Q&A/);
  }
  // 무대 아래에서 걸어 올라오는 사람을 핀으로 비추는 것은 '무대 아래 단원 비추기'가 아님
  let res = modelWith([[1, 'details', '00:55 댄서 1명이 무대 아래에서 가운데로 걸어올 때 Pin3 ON']]);
  assert.ok(!res.findings.some((x) => x.id === 'fx:unlabeled:below'), titles(res).join(' / '));
  // FX로 지정했어도 무대 아래 단원의 위치가 없으면 수정요망
  res = modelWith([[1, 'details', '01:00 FX2 무대 아래에서 안무하는 단원들 비춰주세요']]);
  assert.ok(res.findings.some((x) => /^fx:belowloc:/.test(x.id)), titles(res).join(' / '));
  assert.ok(!res.findings.some((x) => x.id === 'fx:unlabeled:below'));
  res = modelWith([[1, 'details', '01:00 FX2 무대 아래 왼쪽 계단 앞에서 안무하는 댄서 4명 비추기']]);
  assert.ok(!res.findings.some((x) => /^fx:belowloc:/.test(x.id)));
});

test('TFT 조명 Q&A: 같은 FX는 여러 번 써도 1종류, 고보는 TFT 사진에서 고르기', () => {
  // 모범 예시의 FX1(스트로브)을 한 번 더 써도 종류는 그대로
  let res = modelWith([[1, 'details', '01:00 가사 "새벽을"에 맞춰 1초간 스트로브(FX1)']]);
  assert.ok(!res.findings.some((x) => x.id === 'fx:toomany'), titles(res).join(' / '));
  res = modelWith([[1, 'details', '01:00 FX2 바닥 고보 패턴'], [2, 'details', '01:25 무빙 라이트 회전']]);
  const f = res.findings.find((x) => x.id === 'fx:toomany');
  assert.ok(f, titles(res).join(' / '));
  assert.match(f.msg, /반복하는 것은 1종류/);
  assert.ok(res.findings.some((x) => x.id === 'fx:gobo' && x.level === 'info'));
});

test('TFT 조명 Q&A: 밝기는 소수점 첫째 자리까지', () => {
  const res = modelWith([[1, 'lStage', '중앙 / 흰색 / 37.5'], [1, 'pin3', '37.5%'], [2, 'lTop', '전체 / 하늘색 / 62.55%']]);
  const r = res.revised.rows.find((x) => x.c.runtime === '00:52 ~ 01:20 (28초)');
  assert.equal(r.c.lStage, '중앙 / 흰색 / 37.5%');
  assert.equal(r.c.pin3, 'ON (37.5%)');
  const f = res.findings.find((x) => /^light:decimal:/.test(x.id));
  assert.ok(f && f.level === 'info', titles(res).join(' / '));
  assert.match(f.msg, /62\.6%/);
});

test('TFT 조명 Q&A: 앞줄 강조 · 연한 색과 밝기 · 레퍼런스 사진', () => {
  const front = '00:52 가사 "새벽을" 시작과 동시에 앞줄 강조, 즉시';
  let res = modelWith([[1, 'lStage', '전체 / 흰색 / 30%'], [1, 'lTop', '전체 / 파란색 / 80%'], [1, 'details', front]]);
  const f = res.findings.find((x) => /^light:frontrow:/.test(x.id));
  assert.ok(f && f.level === 'warn', titles(res).join(' / '));
  assert.match(f.msg, /무대 조명 30%보다 상단 조명 80%/);
  res = modelWith([[1, 'lStage', '전체 / 흰색 / 100%'], [1, 'lTop', '전체 / 파란색 / 20%'], [1, 'details', front]]);
  assert.ok(!res.findings.some((x) => /^light:frontrow:/.test(x.id)));
  // 연한 색이라고 밝기를 낮출 필요는 없음 (참고)
  res = modelWith([[1, 'lTop', '전체 / 연한 핑크 / 20%']]);
  assert.ok(res.findings.some((x) => /^light:pastel:/.test(x.id) && x.level === 'info'), titles(res).join(' / '));
  res = modelWith([[1, 'lTop', '전체 / 연한 핑크 / 70%']]);
  assert.ok(!res.findings.some((x) => /^light:pastel:/.test(x.id)));
  // 레퍼런스 사진과 똑같이 나오지 않을 수 있음 (참고)
  res = modelWith([[1, 'details', '00:52 레퍼런스 사진처럼 상단을 노란 색감으로 즉시']]);
  assert.ok(res.findings.some((x) => x.id === 'light:reference' && x.level === 'info'), titles(res).join(' / '));
});

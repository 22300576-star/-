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

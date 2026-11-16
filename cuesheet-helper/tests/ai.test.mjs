// AI 큐시트 작성: 서버 로직(요청 확인 · OpenAI 입력 · 응답 정리 · 모델 대체)과 사이트 쪽 연결(항목 · 표 · 문서 읽기)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { validateJob, buildInput, normalize, runJob, modelList, aiAvailable, errorMessage, JobError, newJobId, JOB_ID_RE, jobAge, EDIT_SCHEMA, CREATE_SCHEMA } from '../netlify/lib/aiwrite.mts';
import { parseGrid } from '../public/assets/js/engine/parser.js';
import { analyze } from '../public/assets/js/engine/analyze.js';
import { buildOutput, choiceStats, isChosen } from '../public/assets/js/engine/choices.js';
import { sheetForAI, findingsForAI, itemsFromEdit, gridFromRows } from '../public/assets/js/engine/aiwrite.js';
import { docxText, hwpxText, pptxText, unzip, decodeXml, toBase64 } from '../public/assets/js/io/doctext.js';
import { SAMPLE_DRAFT } from '../public/assets/js/samples.js';

const require = createRequire(import.meta.url);
const JSZip = require('jszip');
const clone = (o) => JSON.parse(JSON.stringify(o));
const draft = () => analyze(parseGrid(clone(SAMPLE_DRAFT)));
const editJob = (extra = {}) => validateJob({ mode: 'edit', prompt: '주인공 의상을 Details에 넣어 주세요', sheet: { name: '예시학부', rows: sheetForAI(draft().revised) }, ...extra });

test('요청 확인: 빈 요청 · 고칠 큐시트 없음 · 너무 큰 파일은 막는다', () => {
  assert.throws(() => validateJob({ mode: 'create', prompt: '' }), /요구사항을 쓰거나/);
  assert.throws(() => validateJob({ mode: 'edit', prompt: '고쳐 줘' }), /고칠 큐시트가 없습니다/);
  assert.throws(() => validateJob({ mode: 'x', prompt: 'a' }), /작업 종류/);
  assert.throws(() => validateJob({ mode: 'create', prompt: 'a'.repeat(9000) }), (e) => e instanceof JobError && e.status === 413);
  const big = 'A'.repeat(5_000_000);
  assert.throws(() => validateJob({ mode: 'create', prompt: 'a', files: [{ name: 'a.pdf', kind: 'pdf', data: big }] }), /너무 큽니다/);
  assert.throws(() => validateJob({ mode: 'create', prompt: 'a', files: [{ name: 'a.pdf', kind: 'pdf', data: '<<<' }] }), /읽지 못했습니다/);
  const job = editJob({ fixFindings: true, findings: findingsForAI(draft().findings), files: [{ name: '기획안.txt', kind: 'text', text: '무대 1 주인공은 흰 드레스' }, { name: 'x.exe', kind: 'bin' }] });
  assert.equal(job.mode, 'edit');
  assert.equal(job.files.length, 1, '모르는 종류의 파일은 뺌');
  assert.ok(job.sheet.rows.length > 5);
  assert.equal(job.findings.length, 28);
});

test('OpenAI 입력: 규칙 · 요구사항 · 큐시트 · 수정요망 · 텍스트 · PDF · 이미지', () => {
  const job = editJob({ fixFindings: true, findings: findingsForAI(draft().findings), files: [
    { name: '기획안.txt', kind: 'text', text: '주인공은 흰 드레스' },
    { name: '콘티.pdf', kind: 'pdf', data: 'JVBERi0x' },
    { name: '동선.png', kind: 'image', mime: 'image/png', data: 'iVBORw0K' },
  ] });
  const [msg] = buildInput(job);
  const parts = msg.content;
  assert.equal(msg.role, 'user');
  assert.match(parts[0].text, /첨부한 큐시트 고치기 \(mode: edit\)/);
  assert.match(parts[1].text, /주인공 의상을 Details에 넣어 주세요/);
  assert.match(parts[2].text, /"id":"r7"/);
  assert.match(parts[2].text, /\(위와 같음\)/);
  assert.match(parts[3].text, /함께 고칠 수정요망/);
  assert.deepEqual(parts.slice(4).map((p) => p.type), ['input_text', 'input_file', 'input_image']);
  assert.equal(parts[5].file_data, 'data:application/pdf;base64,JVBERi0x');
  assert.equal(parts[5].filename, '콘티.pdf');
  assert.equal(parts[6].image_url, 'data:image/png;base64,iVBORw0K');
  // 스키마: strict 모드가 받는 형식(모든 속성 required, additionalProperties false)
  for (const s of [EDIT_SCHEMA, CREATE_SCHEMA]) assert.deepEqual(Object.keys(s.properties).sort(), [...s.required].sort());
});

test('응답 정리: 없는 행·열, 그대로인 칸, 중복은 빼고 병합 표시는 빈칸으로', () => {
  const job = editJob();
  const out = normalize(job, {
    summary: '주인공 의상을 넣었습니다',
    changes: [
      { rowId: 'r7', key: 'details', text: '00:40 흰 드레스를 입은 주인공이 …', reason: '의상 추가' },
      { rowId: 'r7', key: 'details', text: '00:40 흰 드레스를 입은 주인공이 무대 왼쪽 계단에서 올라와 Pin3 자리에 서면 Pin3 즉시 ON', reason: '의상·동선' },
      { rowId: 'nope', key: 'details', text: 'x', reason: '' },
      { rowId: 'r7', key: 'color', text: 'x', reason: '' },
      { rowId: 'r7', key: 'lyrics', text: '간주', reason: '그대로' },
    ],
    inserts: [
      { afterRowId: 'r11', reason: '가사 둘째 슬라이드', cells: { item: '(위와 같음)', runtime: '03:09 ~ 03:36 (27초)', lyrics: '손을 잡고 노래해요\n한동의 빛이 되어' } },
      { afterRowId: 'zzz', reason: '', cells: { runtime: '1' } },
    ],
    notes: ['핀은 따라가지 않아 Pin3 자리로 바꿨습니다'],
  });
  assert.equal(out.changes.length, 1);
  assert.match(out.changes[0].text, /Pin3 즉시 ON$/, '같은 칸은 마지막 것');
  assert.equal(out.inserts.length, 1);
  assert.equal(out.inserts[0].cells.item, '', '(위와 같음) → 빈칸(병합)');
  assert.equal(out.inserts[0].cells.note, '');
  assert.equal(out.notes.length, 1);
  assert.throws(() => normalize(job, { summary: '', changes: [], inserts: [], notes: [] }), /바꿀 칸을 찾지 못했습니다/);
  const created = normalize(validateJob({ mode: 'create', prompt: '새로' }), { title: '예시학부 2026 큐시트', summary: '…', rows: [{ item: '학부 소개 및 투표(사회자)', stage: '사회자' }, {}], notes: [] });
  assert.equal(created.rows.length, 1, '빈 행은 뺌');
  assert.equal(Object.keys(created.rows[0]).length, 16);
});

test('모델 호출: 없는 모델은 다음으로, reasoning을 못 받으면 빼고 다시, 끊기거나 거절하면 알려 줌', async () => {
  const job = validateJob({ mode: 'create', prompt: '무대 1 하나만' });
  const calls = [];
  const okText = JSON.stringify({ title: 't', summary: 's', rows: [{ item: '학부 소개 및 투표(사회자)' }], notes: [] });
  const client = {
    responses: {
      create: async (p) => {
        calls.push(p);
        if (p.model === 'gone') throw Object.assign(new Error('model not found'), { status: 404 });
        if (p.reasoning) throw Object.assign(new Error("Unsupported parameter: 'reasoning'"), { status: 400 });
        return { status: 'completed', output: [], output_text: okText };
      },
    },
  };
  const res = await runJob(job, { client, models: ['gone', 'gpt-6.1-sol'], effort: 'low' });
  assert.equal(res.model, 'gpt-6.1-sol');
  assert.equal(res.rows.length, 1);
  assert.deepEqual(calls.map((c) => [c.model, !!c.reasoning]), [['gone', true], ['gpt-6.1-sol', true], ['gpt-6.1-sol', false]]);
  assert.equal(calls[2].text.format.type, 'json_schema');
  assert.equal(calls[2].text.format.strict, true);
  assert.match(calls[2].instructions, /2026 학부합창대회/);
  const cut = { responses: { create: async () => ({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [] }) } };
  await assert.rejects(runJob(job, { client: cut, models: ['m'] }), /너무 길어/);
  const refuse = { responses: { create: async () => ({ status: 'completed', output: [{ content: [{ type: 'refusal', refusal: 'no' }] }], output_text: '' }) } };
  await assert.rejects(runJob(job, { client: refuse, models: ['m'] }), /답하지 않았습니다/);
  assert.match(errorMessage(Object.assign(new Error('x'), { status: 429 })), /요청이 많아/);
  assert.match(errorMessage(Object.assign(new Error('x'), { status: 401 })), /키가 올바르지 않거나/);
});

test('설정: 모델은 OPENAI_MODEL이 먼저, AI Gateway나 키가 있으면 사용 가능, 작업 id', () => {
  assert.deepEqual(modelList({}).slice(0, 2), ['gpt-6.1-sol', 'gpt-6-sol']);
  assert.equal(modelList({ OPENAI_MODEL: 'gpt-5.5' })[0], 'gpt-5.5');
  assert.ok(aiAvailable({ OPENAI_BASE_URL: 'https://gw' }));
  assert.ok(aiAvailable({ OPENAI_API_KEY: 'k' }));
  assert.ok(!aiAvailable({}));
  const id = newJobId();
  assert.ok(JOB_ID_RE.test(id), id);
  assert.ok(jobAge(id) >= 0 && jobAge(id) < 5000);
  assert.ok(!JOB_ID_RE.test('../in/x'));
});

test('고치기 결과 → 반영 / 반영 안 함을 고르는 항목 → 반영본', () => {
  const res = draft();
  const result = {
    changes: [{ rowId: 'r7', key: 'details', text: '00:40 흰 드레스를 입은 주인공이 무대 왼쪽 계단에서 올라와 Pin3 자리에 서면 Pin3 즉시 ON', reason: '주인공 의상·동선·위치' }],
    inserts: [{ afterRowId: 'r11', reason: '가사 둘째 슬라이드 행', cells: { item: '', runtime: '03:09 ~ 03:36 (27초)', stage: '', waiting: '', detail: '댄서 16명 V자 대형', lyrics: '손을 잡고 노래해요', sound: '', screen: '', lStage: '유지', lTop: '유지', pin1: 'X', pin2: 'X', pin3: 'X', pin4: 'X', details: 'X', note: '' } }],
  };
  const items = itemsFromEdit(result, res.revised, 'job1', '주인공');
  assert.equal(items.length, 2);
  assert.equal(items[0].before, '주인공 따라 핀 이동');
  assert.match(items[0].loc, /^8행 · 무대 1 · 조명-Details$/);
  assert.ok(items.every((i) => i.defaultOn && i.source === 'ai'));
  const on = buildOutput(res, new Map(), new Map(), items);
  const r7 = on.S.rows.find((r) => r.id === 'r7');
  assert.equal(r7.c.details, result.changes[0].text);
  assert.equal(r7.marks.details.by, 'aiw:job1:c0');
  const at = on.S.rows.findIndex((r) => r.id === 'r11');
  const added = on.S.rows[at + 1];
  assert.equal(added.id, 'r11-a1');
  assert.equal(added.c.lyrics, '손을 잡고 노래해요');
  assert.ok(added.cont.item && added.cont.sound, '같은 순서의 새 행: 항목·음향은 위 칸과 병합');
  assert.equal(on.S.blocks.find((b) => b.rows.some((r) => r.id === 'r11')).rows.length, 2);
  // 반영 안 함
  const off = buildOutput(res, new Map([['aiw:job1:c0', false], ['aiw:job1:i0', false]]), new Map(), items);
  assert.equal(off.S.rows.find((r) => r.id === 'r7').c.details, '주인공 따라 핀 이동');
  assert.equal(off.S.rows.length, res.revised.rows.length);
  // 문구를 고쳐 반영
  const ed = buildOutput(res, new Map(), new Map([['aiw:job1:c0', '00:40 주인공(흰 드레스) Pin3']]), items);
  assert.equal(ed.S.rows.find((r) => r.id === 'r7').c.details, '00:40 주인공(흰 드레스) Pin3');
  const st = choiceStats(res, new Map(), items);
  assert.equal(st.ai, 2);
  assert.ok(isChosen(items[1], new Map()));
});

test('새로 작성 결과 → 2026 양식 표 → 피드백 분석', () => {
  const rows = [
    { item: '학부 소개 및 투표(사회자)', runtime: '', stage: '사회자' },
    { item: '학부 인트로 영상', runtime: '인트로 영상 2분', stage: '무대 단원 대기 및 입장', waiting: 'X', detail: '영상 재생 중 콰이어 24명 입장', screen: '영상' },
    { item: '무대 1\n(새벽의 노래)', runtime: '00:00 ~ 00:30 (30초)', stage: '콰이어 24명 단상', waiting: 'X', detail: '콰이어 24명 단상에서 노래', lyrics: '새벽을 깨우는 노래\n함께라서 두렵지 않아', sound: '합창 마이크 4개 (단상 앞)', screen: '가사 영상 1', lStage: '중앙 / 흰색 / 60%', lTop: '전체 / 진파랑 / 30%', pin1: 'X', pin2: 'X', pin3: 'X', pin4: 'X', details: '00:00 가사 시작과 동시에 즉시 켜기', note: '' },
    { item: '', runtime: '00:30 ~ 00:50 (20초)', detail: '콰이어 24명 노래', lyrics: '한 걸음씩 나아가자', lStage: '전체 / 흰색 / 100%', lTop: '유지', pin1: 'X', pin2: 'X', pin3: 'X', pin4: 'X', details: '00:30 즉시 밝게' },
  ];
  const grid = gridFromRows(rows.map((r) => Object.fromEntries(['item', 'runtime', 'stage', 'waiting', 'detail', 'lyrics', 'sound', 'screen', 'lStage', 'lTop', 'pin1', 'pin2', 'pin3', 'pin4', 'details', 'note'].map((k) => [k, r[k] || '']))), 'AI 작성');
  assert.equal(grid.cells.length, 6);
  const model = parseGrid(grid);
  assert.equal(model.rows.length, 4);
  const res = analyze(model);
  const stage = res.revised.blocks.find((b) => b.kind === 'stage');
  assert.equal(stage.rows.length, 2, '항목이 빈 행은 같은 무대');
  assert.ok(res.summary.totalSec === 50);
});

test('첨부 문서 읽기: 워드 · 한글(hwpx) · 파워포인트 글자 꺼내기', async () => {
  const docx = new JSZip();
  docx.file('word/document.xml', '<?xml version="1.0"?><w:document xmlns:w="x"><w:body><w:p><w:r><w:t>무대 1: 새벽의 노래</w:t></w:r></w:p><w:p><w:r><w:t xml:space="preserve">주인공은 </w:t></w:r><w:r><w:t>흰 드레스 &amp; 왼쪽 계단</w:t></w:r><w:r><w:tab/><w:t>Pin3</w:t></w:r></w:p></w:body></w:document>');
  const d = await docxText(await docx.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }));
  assert.equal(d, '무대 1: 새벽의 노래\n주인공은 흰 드레스 & 왼쪽 계단\tPin3');
  const hwpx = new JSZip();
  hwpx.file('Contents/section1.xml', '<hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>');
  hwpx.file('Contents/section0.xml', '<hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>첫 구역 &lt;기획안&gt;</hp:t></hp:run></hp:p></hs:sec>');
  assert.equal(await hwpxText(await hwpx.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })), '첫 구역 <기획안>\n\n둘째 구역');
  const pptx = new JSZip();
  pptx.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:r><a:t>절정</a:t></a:r></a:p></p:sld>');
  pptx.file('ppt/slides/slide10.xml', '<p:sld><a:p><a:r><a:t>끝</a:t></a:r></a:p></p:sld>');
  pptx.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>도입</a:t></a:r></a:p></p:sld>');
  assert.equal(await pptxText(await pptx.generateAsync({ type: 'uint8array', compression: 'STORE' })), '[슬라이드 1]\n도입\n\n[슬라이드 2]\n절정\n\n[슬라이드 3]\n끝');
  await assert.rejects(unzip(new Uint8Array([1, 2, 3])), /압축 형식이 아님/);
  assert.equal(decodeXml('&#xAC00;&#44032;&quot;'), '가가"');
  assert.equal(toBase64(new TextEncoder().encode('큐시트')), Buffer.from('큐시트').toString('base64'));
});

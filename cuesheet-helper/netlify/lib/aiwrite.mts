// AI 큐시트 작성 (OpenAI)
// 학부 디렉터가 쓴 요구사항(프롬프트)과 첨부 파일(텍스트·워드·PDF·이미지·엑셀)을 받아
//  - edit  : 첨부한 큐시트에서 바꿀 칸(changes)과 새로 넣을 행(inserts)을 돌려준다
//  - create: 무대에서 쓸 큐시트 행 전체(rows)를 2026 양식으로 새로 작성한다
// 결과는 사이트에서 피드백처럼 항목마다 반영 / 반영 안 함을 고른 뒤 구글 시트로 받는다.
// 이 파일은 함수들이 함께 쓰는 순수 로직만 둔다(SDK·저장소 없이 테스트 가능).

export const KEYS = ["item", "runtime", "stage", "waiting", "detail", "lyrics", "sound", "screen", "lStage", "lTop", "pin1", "pin2", "pin3", "pin4", "details", "note"] as const;
type Key = (typeof KEYS)[number];
type Cells = Record<Key, string>;

export const LIMITS = {
  prompt: 8000, // 요구사항 글자 수
  rows: 160, // 고칠 큐시트 행 수
  files: 8,
  textChars: 60000, // 텍스트 파일 하나
  binaryBytes: 3_600_000, // PDF·이미지 합계(디코딩 기준) — 함수 요청 6MB 안에 들어가게
  changes: 150,
  inserts: 80,
  createRows: 160,
};

export const SYSTEM = `당신은 한동대학교 2026 학부합창대회 TFT를 돕는 무대 큐시트 작성 보조입니다.
목표는 제출용 서류가 아니라, 무대 당일 음향 · 조명 · 영상 · FD 담당이 이 큐시트만 보고 그대로 무대를 진행할 수 있는 큐시트입니다.
학부 디렉터가 자유롭게 쓴 요구사항(프롬프트)과 첨부 자료(기획안 문서, PDF, 이미지, 엑셀 등)를 읽고, 2026 큐시트 양식(아래 열 구성)으로 큐시트를 고치거나 새로 작성합니다.

# 무대에서 쓸 수 있는 큐시트
- 운영팀은 Run Time과 각 칸에 적힌 대로만 움직입니다. 바뀌는 모든 것(조명 · 마이크 · 화면 · 출연자 이동)에 언제(Run Time 기준 시각, 가사 "○○" 시작이나 출연자 정렬 후 같은 객관적 시점) · 누가(어느 담당, 어느 장비) · 무엇을 · 어떻게(즉시 / n초에 걸쳐)가 드러나야 합니다.
- '적당히', '분위기에 맞게', '자연스럽게'처럼 운영자가 판단해야 하는 말 대신 구역 / 색상 / 밝기%, 장비 종류 · 개수, ON / X처럼 바로 실행할 수 있는 값으로 씁니다.
- 실제로 할 수 없는 연출은 쓰지 않습니다(핀은 색 변경 불가 · 위치 고정, FX는 학부 전체 2개까지, 무대 시간 11분 이내).
- '논의 중' · 미정 칸은 무대에서 실행할 수 없습니다. 학부가 아직 정하지 않았다고 한 것만 '논의 중'으로 두고, notes에 무대 전에 정해야 할 것으로 적습니다.

# 큐시트 열 (2026 큐시트 양식, 키 이름)
- item 항목: 순서 이름. "학부 소개 및 투표(사회자)", "학부 인트로 영상", "자체영상 n", "영상 n", "무대 n\\n(곡 제목 - 가수)". 한 순서(묶음)의 첫 행에만 적고 같은 순서의 다음 행은 빈 문자열.
- runtime Run Time: "00:00 ~ 00:04 (4초)" 형식(시작 ~ 끝 + 단시). 학부 영상 재생 시간 기준이며 인트로 영상(TFT, 2분)이 끝난 순간이 00:00. 앞 행 끝 = 다음 행 시작, 끊김·겹침 없이. 인트로 영상 행은 "인트로 영상 2분". 무대(인트로 제외) 전체 11분 이내.
- stage 무대: 무대와 단상 위에 누가 몇 명. 예) 댄서 16명 무대 / 콰이어 24명 단상
- waiting 대기 인원: 채플 무대 아래에서 대기하는 인원. 없으면 X.
- detail 세부 내용: 언제·어디서·누가(몇 명)·무엇을·어떻게. 주인공 동선, 대형 변화, 소품.
- lyrics 개사 내용: 가사 영상 슬라이드 단위(보통 2줄)로, 그 행 Run Time에 맞춰. 가사가 없으면 간주 또는 X.
- sound 음향 / FD: 장비 종류·개수·누가·언제. 예) 합창 마이크 4개 (단상 앞) / 무선 마이크 1개 (주인공). 노래하는 구간엔 합창 마이크(콰이어 6명당 1개 정도), 노래하는 주인공·솔로엔 무선 마이크. 무대 사이 마이크 이동은 영상 송출 중 FD 지시로.
- screen 화면(영상): 화면에 띄울 영상 / PPT. 예) 가사 영상 1, 영상
- lStage 조명-무대: 사람을 비추는 앞 조명. "구역 / 색상 / 밝기%" (구역: 왼쪽·중앙·오른쪽·전체, 관객석 기준). 밝은 계열.
- lTop 조명-상단: 무대에 색을 입히는 위 조명. "구역 / 색상 / 밝기%".
- pin1~pin4 핀조명: ON / X(필요하면 밝기 %)만. 색 변경 불가. 위치 고정(Pin1 무대 왼쪽, Pin2 단상 바로 앞 중앙, Pin3 무대 앞쪽 중앙, Pin4 무대 오른쪽) — 사람을 따라가지 않으니 출연자가 핀 자리로 가서 섬. 1명용, 3명 이상은 무대 조명 구역으로.
- details Details: 어떤 조명을 언제 어떻게. Run Time 기준 시각 + 객관적 시점(가사 "○○" 시작, 출연자 전원이 정렬한 후) + 전환 방식(즉시 / n초에 걸쳐 서서히). FX1·FX2(스트로브·고보·무빙·추가 핀 중 학부 전체 2개까지)도 여기에. 무대에 주인공이 있으면 주인공의 동선(어디에서 어디로)·의상(색·종류)·위치(어느 Pin 자리)를 구체적으로.
- note 비고: 참고 사항.
- 빈칸 금지: 쓰지 않는 칸은 X, 앞 행 조명이 이어지면 '유지'.
- 영상 행: 화면 '영상', 음향 X, 개사 X, 무대·상단 'X (암전)', 핀 X, Details '영상 재생 중 암전'(영상 중 조명이 필요하면 그 내용).

# 연출 기준
- 가사 분위기에 맞춰 상단 색: 차분·서정 → 진파랑 20~60%, 밝고 희망찬 → 하늘색 40~100%, 따뜻한 → 주황색 30~90%, 힘차고 열정적인 → 빨간색 50~100%, 경건한 → 금색 30~90%. 무대 조명은 흰색으로 사람을 밝게.
- 곡 흐름: 도입(간주)은 어둡게 서서히, 가사 시작에 켜기, 절정(반복되는 후렴)에서 가장 밝게(무대 전체 100%), 노래가 끝나면 즉시 암전.
- 가사 슬라이드 · 대형 · 조명이 바뀌는 지점마다 행을 나눈다.

# 작성 규칙
1. 요구사항과 첨부 자료, 기존 큐시트에 있는 사실만 쓴다. 인원 수, 이름, 의상, 동선, 가사, 곡처럼 학부만 아는 사실을 지어내지 말고, 모르는 값은 [댄서 n명], [00:00], [흰 드레스]처럼 대괄호 자리표시로 남긴다.
2. 요구사항이 기준과 어긋나면(예: 핀에 색, FX 3개) 기준에 맞게 바꾸고 notes에 무엇을 어떻게 바꿨는지 적는다.
3. 반영하지 못한 요청이나 학부가 확인해야 할 것은 notes에 짧게 적는다.
4. 모든 문장은 한국어로, 큐시트 칸에 그대로 들어갈 최종 문장으로 쓴다.`;

const EDIT_RULES = `# 이번 작업: 첨부한 큐시트 고치기 (mode: edit)
- 아래 '고칠 큐시트'의 행 id를 그대로 써서, 바꿀 칸만 changes에 담는다. text는 그 칸에 들어갈 '바뀐 뒤의 전체 문장'이다(원래 문장 일부만 쓰지 말 것).
- 요구사항과 관계없는 칸은 바꾸지 않는다(단 '수정요망도 함께 고치기'를 요청받았으면 함께 나열된 수정요망도 고친다).
- '(위와 같음)'은 위 칸과 병합된 칸이다. 바꾸려면 그 묶음의 맨 위 행 칸을 바꾼다.
- 행을 새로 넣어야 하면(예: 한 곡을 여러 행으로 나눌 때) inserts에 afterRowId(그 뒤에 넣을 행 id)와 새 행의 칸 전체(cells)를 담는다. 같은 순서(묶음) 안의 새 행은 item을 빈 문자열로 둔다. 원래 행의 Run Time · 개사가 바뀌면 changes에도 함께 넣는다.
- reason에는 왜 바꿨는지 한 문장, summary에는 요청을 어떻게 반영했는지 2~4문장.`;

const CREATE_RULES = `# 이번 작업: 새 큐시트 작성 (mode: create)
- 요구사항과 첨부 자료로 무대 당일 그대로 쓸 큐시트의 행을 2026 큐시트 양식으로 처음부터 순서대로 작성해 rows에 담는다.
- 첫 행은 item '학부 소개 및 투표(사회자)'(stage '사회자', 나머지 빈칸 대신 알맞게), 두 번째 행은 item '학부 인트로 영상'(runtime '인트로 영상 2분', 영상 중 단원 대기·입장 상황), 그다음부터 자체영상·무대를 순서대로.
- 한 순서(묶음)의 첫 행에만 item을 쓰고, 같은 순서의 다음 행은 item을 빈 문자열로 둔다. 같은 순서 안에서 그대로인 무대·대기 인원·음향·화면 칸도 빈 문자열로 두면 위 칸과 병합된다.
- 모든 행에 Run Time을 적는다(모르면 [00:00 ~ 00:00 (n초)]처럼 자리표시). 무대는 가사 슬라이드(2줄)·대형·조명이 바뀌는 지점마다 행을 나눈다.
- title에는 큐시트 이름(학부 이름을 알면 '○○학부 2026 큐시트'), summary에는 무엇을 근거로 어떻게 작성했는지 2~4문장.`;

const str = { type: "string" };
export const CELLS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...KEYS],
  properties: Object.fromEntries(KEYS.map((k) => [k, str])),
};
export const EDIT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "changes", "inserts", "notes"],
  properties: {
    summary: str,
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rowId", "key", "text", "reason"],
        properties: { rowId: str, key: { type: "string", enum: [...KEYS] }, text: str, reason: str },
      },
    },
    inserts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["afterRowId", "reason", "cells"],
        properties: { afterRowId: str, reason: str, cells: CELLS_SCHEMA },
      },
    },
    notes: { type: "array", items: str },
  },
};
export const CREATE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "rows", "notes"],
  properties: { title: str, summary: str, rows: { type: "array", items: CELLS_SCHEMA }, notes: { type: "array", items: str } },
};

export interface JobFile {
  name: string;
  kind: "text" | "pdf" | "image";
  mime?: string;
  text?: string;
  data?: string; // base64 (pdf · image)
}
export interface Job {
  mode: "edit" | "create";
  prompt: string;
  fixFindings?: boolean;
  sheet?: { name?: string; rows: Array<{ id: string; kind?: string; cells: Partial<Cells> }> };
  findings?: Array<{ rowId?: string; key?: string; title?: string; msg?: string }>;
  files?: JobFile[];
}

export class JobError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

// 요청 확인: 형식 · 크기 (함수 요청은 6MB까지)
export function validateJob(body: unknown): Job {
  if (!isObj(body)) throw new JobError("요청 형식이 올바르지 않습니다.");
  const mode = body.mode === "create" ? "create" : body.mode === "edit" ? "edit" : null;
  if (!mode) throw new JobError("작업 종류(고치기 / 새로 작성)를 알 수 없습니다.");
  const prompt = String(body.prompt ?? "").trim();
  const files = Array.isArray(body.files) ? body.files : [];
  if (!prompt && !files.length) throw new JobError("요구사항을 쓰거나 파일을 첨부해 주세요.");
  if (prompt.length > LIMITS.prompt) throw new JobError(`요구사항이 너무 깁니다(${LIMITS.prompt}자까지).`, 413);
  if (files.length > LIMITS.files) throw new JobError(`파일은 ${LIMITS.files}개까지 첨부할 수 있습니다.`, 413);
  let binary = 0;
  const outFiles: JobFile[] = [];
  for (const f of files) {
    if (!isObj(f)) continue;
    const kind = f.kind === "pdf" || f.kind === "image" || f.kind === "text" ? f.kind : null;
    if (!kind) continue;
    const name = clip(f.name || "첨부 파일", 120);
    if (kind === "text") {
      outFiles.push({ name, kind, text: clip(f.text, LIMITS.textChars) });
      continue;
    }
    const data = String(f.data ?? "");
    if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw new JobError(`'${name}' 파일을 읽지 못했습니다.`);
    binary += Math.floor((data.length * 3) / 4);
    const mime = kind === "pdf" ? "application/pdf" : /^image\/(png|jpeg|webp|gif)$/.test(String(f.mime)) ? String(f.mime) : "image/png";
    outFiles.push({ name, kind, mime, data });
  }
  if (binary > LIMITS.binaryBytes) throw new JobError("첨부한 PDF·이미지가 너무 큽니다(합계 3.5MB까지).", 413);
  const job: Job = { mode, prompt, fixFindings: !!body.fixFindings, files: outFiles };
  if (mode === "edit") {
    const sheet = isObj(body.sheet) ? body.sheet : null;
    const rows = sheet && Array.isArray(sheet.rows) ? sheet.rows : [];
    if (!rows.length) throw new JobError("고칠 큐시트가 없습니다. 먼저 큐시트 링크를 첨부해 주세요.");
    if (rows.length > LIMITS.rows) throw new JobError(`큐시트 행이 너무 많습니다(${LIMITS.rows}행까지).`, 413);
    job.sheet = {
      name: clip(sheet?.name, 80),
      rows: rows.filter(isObj).map((r) => ({
        id: clip(r.id, 40),
        kind: clip(r.kind, 12),
        cells: Object.fromEntries(KEYS.filter((k) => isObj(r.cells) && r.cells[k]).map((k) => [k, clip((r.cells as Record<string, unknown>)[k], 3000)])) as Partial<Cells>,
      })),
    };
    job.findings = (Array.isArray(body.findings) ? body.findings : []).filter(isObj).slice(0, 60).map((f) => ({ rowId: clip(f.rowId, 40), key: clip(f.key, 12), title: clip(f.title, 200), msg: clip(f.msg, 400) }));
  }
  return job;
}

// OpenAI Responses API 입력 (input_text · input_file(PDF) · input_image)
export function buildInput(job: Job) {
  const parts: Array<Record<string, unknown>> = [];
  parts.push({ type: "input_text", text: job.mode === "edit" ? EDIT_RULES : CREATE_RULES });
  parts.push({ type: "input_text", text: `## 학부 디렉터의 요구사항\n${job.prompt || "(따로 쓴 요구사항 없음 — 첨부 자료대로)"}` });
  if (job.mode === "edit" && job.sheet) {
    const lines = job.sheet.rows.map((r) => JSON.stringify({ id: r.id, kind: r.kind, cells: r.cells }));
    parts.push({ type: "input_text", text: `## 고칠 큐시트 '${job.sheet.name || ""}' (한 줄에 한 행 · 빠진 칸은 빈칸)\n${lines.join("\n")}` });
    if (job.fixFindings && job.findings && job.findings.length) {
      parts.push({ type: "input_text", text: `## 함께 고칠 수정요망 (사이트 점검 결과)\n${job.findings.map((f) => `- [${f.rowId || "전체"}${f.key ? ` ${f.key}` : ""}] ${f.title}: ${f.msg}`).join("\n")}` });
    }
  }
  for (const f of job.files || []) {
    if (f.kind === "text") parts.push({ type: "input_text", text: `## 첨부 파일 '${f.name}'\n${f.text}` });
    else if (f.kind === "pdf") parts.push({ type: "input_file", filename: f.name.endsWith(".pdf") ? f.name : `${f.name}.pdf`, file_data: `data:application/pdf;base64,${f.data}` });
    else parts.push({ type: "input_image", image_url: `data:${f.mime};base64,${f.data}`, detail: "auto" });
  }
  return [{ role: "user", content: parts }];
}

const normCells = (c: unknown): Cells =>
  Object.fromEntries(KEYS.map((k) => {
    const v = isObj(c) ? String(c[k] ?? "") : "";
    return [k, /^\(위와 같음\)$/.test(v.trim()) ? "" : clip(v.replace(/\r/g, "").trim(), 3000)];
  })) as Cells;

// AI 응답 정리: 없는 행 · 열, 바뀌지 않은 칸, 중복을 걸러낸다
export function normalize(job: Job, raw: unknown) {
  if (!isObj(raw)) throw new JobError("AI 응답을 해석하지 못했습니다.", 502);
  const notes = (Array.isArray(raw.notes) ? raw.notes : []).map((n) => clip(n, 400)).filter(Boolean).slice(0, 12);
  const summary = clip(raw.summary, 1500);
  if (job.mode === "create") {
    const rows = (Array.isArray(raw.rows) ? raw.rows : []).map(normCells).filter((c) => KEYS.some((k) => c[k])).slice(0, LIMITS.createRows);
    if (!rows.length) throw new JobError("AI가 큐시트 행을 만들지 못했습니다. 요구사항을 조금 더 자세히 써 주세요.", 422);
    return { mode: "create", title: clip(raw.title, 80), summary, rows, notes };
  }
  const rows = new Map((job.sheet?.rows || []).map((r) => [r.id, r]));
  const seen = new Map<string, { rowId: string; key: Key; text: string; reason: string }>();
  for (const c of Array.isArray(raw.changes) ? raw.changes : []) {
    if (!isObj(c)) continue;
    const row = rows.get(String(c.rowId));
    const key = String(c.key) as Key;
    if (!row || !KEYS.includes(key)) continue;
    const text = clip(String(c.text ?? "").replace(/\r/g, "").trim(), 3000);
    if (text === String(row.cells[key] ?? "").trim()) continue; // 바뀌지 않음
    seen.set(`${row.id}|${key}`, { rowId: row.id, key, text, reason: clip(c.reason, 300) });
  }
  const changes = [...seen.values()].slice(0, LIMITS.changes);
  const inserts = (Array.isArray(raw.inserts) ? raw.inserts : [])
    .filter((i) => isObj(i) && rows.has(String(i.afterRowId)))
    .map((i) => ({ afterRowId: String((i as Record<string, unknown>).afterRowId), reason: clip((i as Record<string, unknown>).reason, 300), cells: normCells((i as Record<string, unknown>).cells) }))
    .filter((i) => KEYS.some((k) => i.cells[k]))
    .slice(0, LIMITS.inserts);
  if (!changes.length && !inserts.length && !notes.length) throw new JobError("AI가 바꿀 칸을 찾지 못했습니다. 무엇을 어떻게 바꿀지 조금 더 구체적으로 써 주세요.", 422);
  return { mode: "edit", summary, changes, inserts, notes };
}

// 쓸 모델: 환경 변수 OPENAI_MODEL이 있으면 그것부터, 없으면 기본값 → 대체 모델 순서
export function modelList(env: Record<string, string | undefined> = process.env) {
  return [...new Set([env.OPENAI_MODEL, "gpt-6.1-sol", "gpt-6-sol", "gpt-5.5"].filter(Boolean) as string[])];
}
export const aiAvailable = (env: Record<string, string | undefined> = process.env) => !!(env.OPENAI_API_KEY || env.OPENAI_BASE_URL);

type Client = { responses: { create: (params: Record<string, unknown>) => Promise<any> } };

// AI 호출: 모델이 없으면 다음 모델로, reasoning을 받지 않는 모델이면 빼고 다시
export async function runJob(job: Job, { client, models = modelList(), effort = "low" }: { client: Client; models?: string[]; effort?: string }) {
  const schema = job.mode === "edit" ? EDIT_SCHEMA : CREATE_SCHEMA;
  const input = buildInput(job);
  let lastErr: unknown = null;
  for (const model of models) {
    // 모델마다: reasoning을 못 받으면 빼고, 출력 한도가 크다고 하면 줄여서 다시 (최대 4번)
    let withReasoning = !!effort;
    let maxTokens = 32000;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const res = await client.responses.create({
          model,
          instructions: SYSTEM,
          input,
          text: { format: { type: "json_schema", name: job.mode === "edit" ? "cuesheet_edit" : "cuesheet_create", schema, strict: true } },
          max_output_tokens: maxTokens,
          ...(withReasoning ? { reasoning: { effort } } : {}),
        });
        if (res && res.status === "incomplete") {
          throw new JobError(res.incomplete_details && res.incomplete_details.reason === "max_output_tokens" ? "AI 응답이 너무 길어 중간에 끊겼습니다. 요청을 나눠서(예: 무대 하나씩) 다시 해 주세요." : "AI 응답이 완료되지 않았습니다. 다시 시도해 주세요.", 502);
        }
        const refusal = (res?.output || []).flatMap((o: any) => o?.content || []).find((c: any) => c?.type === "refusal");
        if (refusal) throw new JobError("AI가 이 요청에는 답하지 않았습니다. 요구사항을 바꿔 다시 시도해 주세요.", 422);
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(res?.output_text || ""));
        } catch {
          throw new JobError("AI 응답을 해석하지 못했습니다. 다시 시도해 주세요.", 502);
        }
        return { ...normalize(job, parsed), model };
      } catch (err: any) {
        if (err instanceof JobError) throw err;
        lastErr = err;
        const status = err && err.status;
        const msg = String((err && err.message) || "");
        if (status === 400 && withReasoning && /reasoning/i.test(msg)) {
          withReasoning = false; // reasoning 없이 다시
          continue;
        }
        if (status === 400 && maxTokens > 16000 && /max_output_tokens|max_tokens|output tokens/i.test(msg)) {
          maxTokens = 16000; // 출력 한도를 줄여 다시
          continue;
        }
        // 없는 모델 · 이 키로 못 쓰는 모델(게이트웨이) → 다음 모델
        if (status === 404 || status === 403 || ((status === 400 || status === 422) && /model/i.test(msg))) break;
        throw err;
      }
    }
  }
  throw lastErr || new JobError("쓸 수 있는 AI 모델을 찾지 못했습니다.", 502);
}

// 사용자에게 보여줄 오류 문장
export function errorMessage(err: any) {
  if (err instanceof JobError) return err.message;
  const status = err && err.status;
  if (status === 401 || status === 403) return "AI 키가 올바르지 않거나 이 모델을 쓸 권한이 없습니다. 사이트 관리자에게 알려 주세요.";
  if (status === 429) return "AI 요청이 많아 잠시 막혔습니다. 1~2분 뒤 다시 시도해 주세요.";
  if (err && /timeout|timed out/i.test(String(err.name || err.message))) return "AI 응답이 너무 오래 걸렸습니다. 요청을 나눠서 다시 해 주세요.";
  return `AI 요청 중 오류가 발생했습니다${status ? ` (${status})` : ""}. 잠시 후 다시 시도해 주세요.`;
}

// 작업 id: 만든 시각(36진수) + 무작위 — 오래된 작업을 정리할 때 시각을 바로 읽는다
export const newJobId = () => `${Date.now().toString(36)}-${crypto.randomUUID()}`;
export const JOB_ID_RE = /^[0-9a-z]{6,12}-[0-9a-f-]{36}$/;
export const jobAge = (id: string) => Date.now() - parseInt(id.split("-")[0], 36);

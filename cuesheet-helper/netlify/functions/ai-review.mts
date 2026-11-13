// (선택 기능) Claude로 무대 한 블록씩 문장·조명 대안을 받는다.
// Netlify 환경 변수 ANTHROPIC_API_KEY가 있어야 동작한다. 없으면 501을 돌려주고, 사이트의 나머지 기능은 그대로 쓸 수 있다.
import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "@netlify/functions";

const KEYS = ["item", "runtime", "stage", "waiting", "detail", "lyrics", "sound", "screen", "lStage", "lTop", "pin1", "pin2", "pin3", "pin4", "details", "note"];

const SYSTEM = `당신은 한동대학교 2026 학부합창대회 TFT 부디렉터를 돕는 무대 큐시트 검토 보조입니다.
학부 디렉터가 쓴 학부 무대 큐시트의 한 블록(무대 한 곡 또는 영상 한 편)을 받아, 규칙에 맞지 않거나 운영팀이 실행하기 어려운 칸을 고친 문장을 제안합니다.

# 큐시트 열 (2026 2차 큐시트 양식)
- item 항목: 곡 제목 또는 영상 이름. "무대 n\\n(곡 제목 - 가수)", "자체영상 n".
- runtime Run Time: "00:00 ~ 00:04 (4초)" 형식. 학부 영상 재생 시간 기준, 인트로 영상(TFT) 이후 00:00. 앞 행 끝 = 다음 행 시작. 무대 11분 초과 금지.
- stage 무대: 무대와 단상 위에 누가 몇 명 있는지. 예) 댄서 16명 무대 / 콰이어 24명 단상
- waiting 대기 인원: 채플 무대 아래에서 대기하는 인원 수. 없으면 X.
- detail 세부 내용: 언제·어디서·누가(몇 명)·무엇을·어떻게. 주인공 동선, 대형 변화, 소품 활용.
- lyrics 개사 내용: 각 슬라이드에 들어갈 가사를 Run Time에 맞춰. 가사 없으면 '간주' 또는 X.
- sound 음향 / FD: 어떤 장비를 몇 개, 누가, 언제, 어떻게(영상 중 마이크 재배치·전달 포함). 예) 합창 마이크 4개(단상 앞) / 무선 마이크 1개(주인공)
- screen 화면(영상): 화면에 띄울 영상 / PPT.
- lStage 조명-무대: 무대 앞에서 인물을 비추는 조명. "구역 / 색상 / 밝기%". 구역은 왼쪽·중앙·오른쪽·전체(관객석 기준). 밝은 계열 권장. 예) 중앙 / 흰색 / 100%
- lTop 조명-상단: 위에서 아래로 무대에 색을 입히는 조명. "구역 / 색상 / 밝기%". 예) 전체 / 파란색 / 50%
- pin1~pin4 핀조명: ON / X(필요하면 밝기 %)만. 색 변경 불가. 위치 고정(Pin1 무대 왼쪽, Pin2 단상 바로 앞 중앙, Pin3 무대 앞쪽 중앙, Pin4 무대 오른쪽) — 사람을 따라갈 수 없고 출연자가 핀 자리로 가서 서야 함. 1명용, 3명 이상은 무대 조명 구역으로.
- details Details: 어떤 조명을 언제 어떻게. 시간(Run Time 기준) + 객관적 시점(가사 "○○" 시작, 출연자 전원이 중앙에 정렬한 후) + 전환 방식(즉시 / n초에 걸쳐 서서히) + 함께 끄거나 바꿀 조명. FX1·FX2(스트로브·고보·무빙·추가 핀 중 2개)도 여기에 적음. 예) 00:44 주인공이 Pin3 위치에 도착하면 Pin3 즉시 ON, 상단은 2초에 걸쳐 진파랑 20%
- note 비고: 참고 사항.
- 빈칸 금지: 쓰지 않으면 X, 앞 행 조명이 이어지면 '유지'. 미정은 '논의 중'.

# 제안 규칙
1. 입력의 findings(규칙 검사 결과)를 해결하는 데 집중하세요. 이미 좋은 칸은 건드리지 마세요.
2. 학부만 아는 사실(인원 수, 가사, 동선, 곡, 색상 의도)을 지어내지 마세요. 같은 블록의 다른 칸(세부 내용, 개사, 무대, 기존 조명)에서 확인되는 사실만 쓰고, 모르는 값은 [댄서 n명], [색상], [00:00]처럼 대괄호 자리표시로 남기세요.
3. 조명은 위 형식을 지키는 실행 가능한 문장으로 다시 쓰세요. 핀에 색을 넣지 말고, 그룹은 무대 조명 구역으로 옮기세요. Details에는 개사 내용·세부 내용에서 찾은 객관적 시점과 전환 방식을 넣으세요.
4. 시간은 해당 행 Run Time 안에서만 쓰세요.
5. 한 블록에 제안은 최대 10개. 각 제안의 text는 그 칸에 그대로 붙여넣을 최종 문장이고, reason은 왜 바꿨는지 한 문장(한국어)입니다.
6. 고칠 것이 없으면 suggestions를 빈 배열로 돌려주세요.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["rowId", "key", "text", "reason"],
        properties: {
          rowId: { type: "string" },
          key: { type: "string", enum: KEYS },
          text: { type: "string" },
          reason: { type: "string" },
        },
      },
    },
  },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

type Cells = Record<string, string>;
interface Payload {
  block?: { label?: string; kind?: string; rows?: Array<{ id: string; cells: Cells }> };
  findings?: Array<{ rowId?: string; key?: string; level?: string; title?: string; msg?: string }>;
  context?: Record<string, unknown>;
}

export default async (req: Request) => {
  const apiKey = Netlify.env.get("ANTHROPIC_API_KEY");
  if (req.method === "GET") return json({ enabled: !!apiKey });
  if (!apiKey) {
    return json({ error: "AI 대안 기능이 아직 켜져 있지 않습니다. 사이트 관리자가 Netlify 환경 변수 ANTHROPIC_API_KEY를 설정하면 사용할 수 있습니다. (규칙 기반 피드백과 수정본은 그대로 쓸 수 있습니다.)" }, 501);
  }
  let body: Payload;
  try {
    body = (await req.json()) as Payload;
  } catch {
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const rows = body.block?.rows ?? [];
  if (!rows.length || rows.length > 60) return json({ error: "검토할 행이 없거나 너무 많습니다." }, 400);
  const input = JSON.stringify({ block: body.block, findings: (body.findings ?? []).slice(0, 40), context: body.context ?? {} });
  if (input.length > 60_000) return json({ error: "블록 내용이 너무 깁니다." }, 413);

  const client = new Anthropic({ apiKey, timeout: 55_000, maxRetries: 1 });
  try {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 8000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA } },
      system: [{ type: "text", text: SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        {
          role: "user",
          content: `다음은 한 학부 큐시트의 블록 하나입니다. 규칙에 맞게 고칠 칸의 제안을 JSON으로 주세요.\n\n${input}`,
        },
      ],
    });
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") return json({ error: "AI가 이 블록에 대한 제안을 만들지 않았습니다.", suggestions: [] }, 422);
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    let parsed: { suggestions?: Array<{ rowId: string; key: string; text: string; reason: string }> } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      return json({ error: "AI 응답을 해석하지 못했습니다.", suggestions: [] }, 502);
    }
    const ids = new Set(rows.map((r) => r.id));
    const suggestions = (parsed.suggestions ?? []).filter((s) => ids.has(s.rowId) && KEYS.includes(s.key) && typeof s.text === "string").slice(0, 10);
    return json({ suggestions });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return json({ error: "ANTHROPIC_API_KEY가 올바르지 않습니다." }, 500);
    if (err instanceof Anthropic.RateLimitError) return json({ error: "요청이 많아 잠시 후 다시 시도해주세요." }, 429);
    if (err instanceof Anthropic.APIConnectionTimeoutError) return json({ error: "AI 응답이 늦어 이 블록은 건너뛰었습니다." }, 504);
    if (err instanceof Anthropic.APIError) return json({ error: `AI 요청 오류 (${err.status ?? ""})` }, 502);
    return json({ error: "AI 요청 중 오류가 발생했습니다." }, 500);
  }
};

export const config: Config = { path: "/api/ai-review", method: ["GET", "POST"] };

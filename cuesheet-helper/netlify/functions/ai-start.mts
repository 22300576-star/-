// AI 큐시트 작성 요청 받기 (/api/ai/start)
// 요청(요구사항 · 첨부 파일 · 고칠 큐시트)을 Netlify Blobs에 잠시 넣고, 백그라운드 함수(/api/ai/run)를 깨운 뒤
// 작업 id를 바로 돌려준다. 사이트는 /api/ai/status로 결과를 기다린다(AI 응답이 1분을 넘을 수 있어서).
import { getStore } from "@netlify/blobs";
import type { Config, Context } from "@netlify/functions";
import { validateJob, aiAvailable, newJobId, jobAge, JobError } from "../lib/aiwrite.mts";

const STORE = "ai-jobs";
const DAY = 24 * 60 * 60 * 1000;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

// 하루 지난 작업(결과를 가져가지 않은 것) 정리
async function cleanup(store: ReturnType<typeof getStore>) {
  for (const prefix of ["in/", "out/"]) {
    const { blobs } = await store.list({ prefix });
    for (const b of blobs.slice(0, 200)) {
      const id = b.key.slice(prefix.length);
      if (jobAge(id) > DAY) await store.delete(b.key);
    }
  }
}

export default async (req: Request, context: Context) => {
  if (!aiAvailable()) {
    return json({ error: "AI 기능이 아직 켜져 있지 않습니다. 사이트 관리자가 Netlify AI Gateway를 쓰거나 환경 변수 OPENAI_API_KEY를 넣으면 사용할 수 있습니다." }, 501);
  }
  let job;
  try {
    job = validateJob(await req.json());
  } catch (err) {
    if (err instanceof JobError) return json({ error: err.message }, err.status);
    return json({ error: "요청 형식이 올바르지 않습니다." }, 400);
  }
  const id = newJobId();
  const runKey = crypto.randomUUID();
  const store = getStore({ name: STORE, consistency: "strong" });
  await store.setJSON(`in/${id}`, { job, runKey });
  await store.setJSON(`out/${id}`, { state: "queued", at: Date.now() });
  context.waitUntil(cleanup(store).catch(() => {}));
  // 백그라운드 함수는 202를 바로 돌려준다
  const run = await fetch(new URL("/api/ai/run", req.url), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, runKey }),
  }).catch(() => null);
  if (!run || (run.status !== 202 && !run.ok)) {
    await store.setJSON(`out/${id}`, { state: "error", at: Date.now(), error: "AI 작업을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." });
    return json({ error: "AI 작업을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요." }, 502);
  }
  return json({ id });
};

// 같은 사람이 짧은 시간에 너무 많이 요청하지 않도록(비용 보호)
export const config: Config = {
  path: "/api/ai/start",
  method: "POST",
  rateLimit: { windowLimit: 6, windowSize: 60, aggregateBy: ["ip", "domain"] },
};

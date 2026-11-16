// AI 큐시트 작성 결과 확인 (/api/ai/status?id=…)
// GET: { state: queued | running | done | error, result?, error? } · DELETE: 결과를 받은 뒤 지우기
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { JOB_ID_RE } from "../lib/aiwrite.mts";

const STORE = "ai-jobs";
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default async (req: Request) => {
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!JOB_ID_RE.test(id)) return json({ error: "작업 id가 올바르지 않습니다." }, 400);
  const store = getStore({ name: STORE, consistency: "strong" });
  if (req.method === "DELETE") {
    await store.delete(`out/${id}`);
    await store.delete(`in/${id}`);
    return json({ ok: true });
  }
  const out = await store.get(`out/${id}`, { type: "json" });
  if (!out) return json({ state: "missing", error: "작업을 찾지 못했습니다. 다시 요청해 주세요." }, 404);
  return json(out);
};

export const config: Config = { path: "/api/ai/status", method: ["GET", "DELETE"] };

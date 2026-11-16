// AI 큐시트 작성 실행 (백그라운드 함수, 최대 15분) — /api/ai/start가 깨운다
// OpenAI Responses API로 요구사항 · 첨부 파일 · 큐시트를 보내고, 결과(JSON)를 Netlify Blobs에 넣는다.
// OpenAI 키는 Netlify AI Gateway가 넣어 주는 OPENAI_API_KEY / OPENAI_BASE_URL을 쓴다(직접 넣은 키가 있으면 그것).
import OpenAI from "openai";
import { getStore } from "@netlify/blobs";
import type { Config } from "@netlify/functions";
import { runJob, modelList, errorMessage, JOB_ID_RE } from "../lib/aiwrite.mts";

const STORE = "ai-jobs";

export default async (req: Request) => {
  let id = "";
  let runKey = "";
  try {
    ({ id, runKey } = (await req.json()) as { id: string; runKey: string });
  } catch {
    return;
  }
  if (!JOB_ID_RE.test(String(id))) return;
  const store = getStore({ name: STORE, consistency: "strong" });
  const input = (await store.get(`in/${id}`, { type: "json" })) as { job: any; runKey: string } | null;
  if (!input || input.runKey !== runKey) return;
  const out = (await store.get(`out/${id}`, { type: "json" })) as { state?: string } | null;
  if (out && out.state !== "queued") return; // 이미 실행 중이거나 끝남 (재시도로 두 번 돌지 않게)
  await store.setJSON(`out/${id}`, { state: "running", at: Date.now() });
  try {
    const client = new OpenAI({ timeout: 13 * 60 * 1000, maxRetries: 1 });
    const result = await runJob(input.job, { client, models: modelList(), effort: process.env.OPENAI_REASONING || "low" });
    await store.setJSON(`out/${id}`, { state: "done", at: Date.now(), result });
  } catch (err) {
    console.error("ai-run", err);
    await store.setJSON(`out/${id}`, { state: "error", at: Date.now(), error: errorMessage(err) });
  } finally {
    await store.delete(`in/${id}`); // 첨부 파일이 들어 있는 요청은 바로 지운다
  }
};

export const config: Config = { background: true, path: "/api/ai/run" };

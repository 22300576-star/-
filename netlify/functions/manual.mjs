// 매뉴얼 데이터 저장소 (Netlify Blobs)
// GET  /.netlify/functions/manual          → 저장된 매뉴얼 JSON (없으면 null)
// GET  /.netlify/functions/manual?check=1  → 비밀번호 확인 (x-edit-password 헤더)
// PUT  /.netlify/functions/manual          → 매뉴얼 저장 (x-edit-password 헤더 필요)
import { getStore } from "@netlify/blobs";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

const authorized = (req) => {
  const expected = process.env.EDIT_PASSWORD;
  return Boolean(expected) && req.headers.get("x-edit-password") === expected;
};

export default async (req) => {
  const store = getStore({ name: "manual", consistency: "strong" });
  const url = new URL(req.url);

  if (req.method === "GET") {
    if (url.searchParams.has("check")) {
      return authorized(req) ? json({ ok: true }) : json({ ok: false }, 401);
    }
    const data = await store.get("data", { type: "json" });
    return json(data ?? null);
  }

  if (req.method === "PUT") {
    if (!authorized(req)) return json({ error: "비밀번호가 올바르지 않습니다." }, 401);
    let data;
    try { data = await req.json(); } catch { return json({ error: "잘못된 데이터" }, 400); }
    if (!data || !Array.isArray(data.entries) || !Array.isArray(data.people)) {
      return json({ error: "잘못된 데이터 형식" }, 400);
    }
    data.updatedAt = new Date().toISOString();
    await store.setJSON("data", data);
    return json({ ok: true, updatedAt: data.updatedAt });
  }

  return json({ error: "Method not allowed" }, 405);
};

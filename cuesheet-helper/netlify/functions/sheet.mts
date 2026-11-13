// 공개 구글 시트(링크가 있는 모든 사용자 보기)를 내려받아 브라우저에 그대로 전달한다.
//  - format=xlsx (기본): 통합 문서 전체를 .xlsx로 스트리밍 (셀 병합 정보 포함, 최대 약 20MB)
//  - format=tsv&gid=…  : 한 탭만 탭 구분 텍스트로 (탭 고르기·대용량 대비)
// 시트 내용은 저장하지 않는다. 요청 주소는 시트 ID로만 만들어 다른 곳으로 보내지 않는다.
import type { Config } from "@netlify/functions";

const ID_RE = /^[a-zA-Z0-9_-]{20,100}$/;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

// 구글이 붙여 주는 파일 이름(Content-Disposition)에서 스프레드시트 제목을 꺼낸다.
// 결과 화면에 '어떤 큐시트를 점검했는지' 보여주는 데만 쓴다.
export function titleFrom(disposition: string): string {
  let name = "";
  const star = disposition.match(/filename\*\s*=\s*UTF-8''([^;]+)/i);
  if (star) {
    try {
      name = decodeURIComponent(star[1].trim());
    } catch {
      name = "";
    }
  }
  if (!name) {
    const plain = disposition.match(/filename\s*=\s*"([^"]*)"/i);
    if (plain) name = plain[1];
  }
  return name.replace(/\.(xlsx|tsv)$/i, "").trim().slice(0, 200);
}

const NOT_PUBLIC =
  "시트를 열 수 없습니다. 공유 설정을 '링크가 있는 모든 사용자: 뷰어'로 바꾸거나, 아래 칸에 표를 복사해서 붙여넣어 주세요.";

export default async (req: Request) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const gid = url.searchParams.get("gid") || "";
  const format = url.searchParams.get("format") === "tsv" ? "tsv" : "xlsx";
  if (!ID_RE.test(id)) return json({ error: "구글 시트 주소를 확인해주세요." }, 400);
  if (gid && !/^\d{1,12}$/.test(gid)) return json({ error: "탭 번호(gid)가 올바르지 않습니다." }, 400);
  if (format === "tsv" && !gid) return json({ error: "탭 번호(gid)가 필요합니다." }, 400);

  const target =
    format === "xlsx"
      ? `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`
      : `https://docs.google.com/spreadsheets/d/${id}/export?format=tsv&gid=${gid}`;
  let res: Response;
  try {
    res = await fetch(target, { redirect: "follow" });
  } catch {
    return json({ error: "구글 시트에 연결하지 못했습니다. 잠시 후 다시 시도해주세요." }, 502);
  }
  const type = res.headers.get("content-type") || "";
  if (res.status === 404) return json({ error: "시트를 찾지 못했습니다. 주소를 확인해주세요." }, 404);
  if (!res.ok || type.includes("text/html")) return json({ error: NOT_PUBLIC }, 403);
  const sheetTitle = encodeURIComponent(titleFrom(res.headers.get("content-disposition") || ""));

  if (format === "tsv") {
    const text = (await res.text()).slice(0, 400_000);
    return new Response(text, { headers: { "content-type": "text/tab-separated-values; charset=utf-8", "cache-control": "no-store", "x-sheet-title": sheetTitle } });
  }
  const len = Number(res.headers.get("content-length") || 0);
  if (len > 19 * 1024 * 1024) return json({ error: "시트 파일이 너무 큽니다. 학부 탭 주소(#gid=…)로 다시 시도하거나 붙여넣기를 이용해주세요.", tooLarge: true }, 413);
  return new Response(res.body, {
    headers: {
      "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "cache-control": "no-store",
      "x-sheet-title": sheetTitle,
    },
  });
};

export const config: Config = { path: "/api/sheet", method: ["GET"] };

// 사이트 설정
//  - googleClientId: 구글 로그인(OAuth 클라이언트 ID). 비밀값이 아니라 브라우저에 그대로 전달된다.
//    Netlify 환경 변수 GOOGLE_CLIENT_ID에 넣으면 '피드백 반영한 구글 시트 만들기'가 학부 계정의 드라이브에
//    새 구글 시트를 바로 만든다. 비어 있으면 엑셀을 내려받아 새 시트에 '가져오기'하는 방식으로 대신한다.
//  - ai: AI 큐시트 작성(OpenAI) 사용 가능 여부. Netlify AI Gateway(크레딧 요금제)가 켜져 있거나
//    환경 변수 OPENAI_API_KEY가 있으면 쓸 수 있다. 모델은 OPENAI_MODEL로 바꿀 수 있다.
import { aiAvailable, modelList } from "../lib/aiwrite.mts";

export default async () => {
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const ai = { enabled: aiAvailable(), provider: "OpenAI", model: modelList()[0] };
  return new Response(JSON.stringify({ googleClientId, ai }), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
};

export const config = { path: "/api/config" };

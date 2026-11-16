// 사이트 설정: 구글 로그인(OAuth 클라이언트 ID)
// 클라이언트 ID는 비밀값이 아니라 브라우저에 그대로 전달된다. Netlify 환경 변수 GOOGLE_CLIENT_ID에 넣으면
// 결과 화면의 '피드백 반영한 구글 시트 만들기'가 학부 계정의 드라이브에 새 구글 시트를 바로 만든다.
// 비어 있으면 엑셀을 내려받아 새 시트에 '가져오기'하는 방식으로 대신한다.
export default async () => {
  const googleClientId = (process.env.GOOGLE_CLIENT_ID || '').trim();
  return new Response(JSON.stringify({ googleClientId }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};

export const config = { path: '/api/config' };

// 피드백 반영본을 학부 계정의 구글 드라이브에 '새 구글 시트'로 만든다.
//  - 구글 로그인(Google Identity Services)으로 drive.file 권한만 받음: 이 사이트가 만든 파일에만 접근
//  - 2026 2차 양식 엑셀을 업로드하면서 구글 시트로 변환 → 열 너비·셀 색·글꼴·테두리·병합이 그대로 들어감
//  - 첨부한 원본 시트는 읽지도 바꾸지도 않는다 (원본은 /api/sheet가 공개 링크로만 읽음)
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';

let gisPromise = null;
let token = null; // { access_token, expires_at }

export const gisReady = () => !!(window.google && window.google.accounts && window.google.accounts.oauth2);

// 결과 화면이 열릴 때 미리 불러 둔다 (버튼을 누른 순간 바로 로그인 창을 열어야 팝업이 막히지 않음)
export function loadGis() {
  if (gisReady()) return Promise.resolve();
  if (gisPromise) return gisPromise;
  gisPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => (gisReady() ? resolve() : reject(new Error('구글 로그인 모듈을 불러오지 못했습니다.')));
    s.onerror = () => {
      gisPromise = null;
      reject(new Error('구글 로그인 모듈을 불러오지 못했습니다.'));
    };
    document.head.appendChild(s);
  });
  return gisPromise;
}

export const hasToken = () => !!(token && token.expires_at > Date.now() + 60000);

// 버튼 클릭 안에서 바로 불러야 한다 (await 전에)
export function requestToken(clientId) {
  if (hasToken()) return Promise.resolve(token.access_token);
  return new Promise((resolve, reject) => {
    if (!gisReady()) return reject(new Error('구글 로그인 모듈을 불러오는 중입니다. 잠시 후 다시 눌러 주세요.'));
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (resp) => {
        if (!resp || resp.error) {
          reject(new Error(resp && resp.error === 'access_denied' ? '구글 드라이브 권한을 허용해야 새 구글 시트를 만들 수 있습니다.' : `구글 로그인을 완료하지 못했습니다${resp && resp.error ? ` (${resp.error})` : ''}.`));
          return;
        }
        token = { access_token: resp.access_token, expires_at: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        resolve(token.access_token);
      },
      error_callback: (err) =>
        reject(
          new Error(
            err && err.type === 'popup_failed_to_open'
              ? '팝업이 차단되어 구글 로그인 창을 열지 못했습니다. 이 사이트의 팝업을 허용한 뒤 다시 눌러 주세요.'
              : err && err.type === 'popup_closed'
                ? '구글 로그인 창이 닫혀 새 시트를 만들지 않았습니다.'
                : '구글 로그인을 완료하지 못했습니다.',
          ),
        ),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// 엑셀(2026 양식)을 올리면서 구글 시트로 변환 → 내 드라이브에 새 구글 시트
export async function uploadAsSheet(accessToken, name, buffer) {
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify({ name, mimeType: 'application/vnd.google-apps.spreadsheet' })], { type: 'application/json; charset=UTF-8' }));
  form.append('file', new Blob([buffer], { type: XLSX_MIME }));
  const r = await fetch(UPLOAD_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: form });
  if (r.status === 401) {
    token = null;
    throw new Error('구글 로그인이 만료되었습니다. 다시 눌러 주세요.');
  }
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    const why = d && d.error && d.error.message ? `: ${d.error.message}` : '';
    throw new Error(`새 구글 시트를 만들지 못했습니다 (${r.status}${why})`);
  }
  const d = await r.json();
  return { id: d.id, name: d.name || name, url: d.webViewLink || `https://docs.google.com/spreadsheets/d/${d.id}/edit` };
}

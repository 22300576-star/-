// 작성 가이드 — 방향 잡기(작성 순서 · 무대 연출 계획) → 칸별 작성법 → 제출과 피드백
// 결과 화면의 기준(수정요망)과 제안, '원래 → 수정 후' 표시를 그대로 따른다.
import { icon } from './icons.js';

// 번호는 크게, '무대' · '합창' 같은 이름표는 작은 태그로
const noHtml = (no) => `<span class="no${/^\d+$/.test(String(no)) ? '' : ' tag'}">${no}</span>`;
const pt = (no, title, text, ex) => `<li>${noHtml(no)}<div><b>${title}</b><span>${text}</span>${ex ? `<div class="example">${ex}</div>` : ''}</div></li>`;
// 작성 순서처럼 설명 아래에 이동 링크를 붙이는 항목
const ptl = (no, title, text, links) => `<li>${noHtml(no)}<div><b>${title}</b><span>${text}</span><div class="g-links">${links}</div></div></li>`;
const NEW = '<span class="pill new">새 기준</span>';
const to = (href, label) => `<a class="g-link" href="${href}">${label} ${icon('right', 16)}</a>`;
// 원래 → 수정 후 (결과 화면의 피드백 카드와 같은 모양). [ ] 안은 학부만 아는 내용이라 예로 넣은 부분
const mark = (t) => t.replace(/\[([^\]]+)\]/g, '<mark>$1</mark>');
const ba = (label, before, after, { isNew = false, why = '' } = {}) => `<div class="gba">
  <div class="gba-h">${label}${isNew ? NEW : ''}</div>
  <div class="ba is-example"><div class="ba-col b"><div class="ba-k">원래</div><div class="ba-v">${before || '<i>빈칸</i>'}</div></div><div class="ba-arrow" aria-hidden="true">→</div><div class="ba-col a"><div class="ba-k">수정 후</div><div class="ba-v">${mark(after)}</div></div></div>
  ${why ? `<p class="gba-why">${why}</p>` : ''}
</div>`;
const fixes = (items) => `<h2 class="g-h2">자주 받는 피드백 <small>원래 → 수정 후 · 파란 글씨는 우리 무대에 맞게 바꿔 적는 부분</small></h2><div class="gbas">${items.join('')}</div>`;

const STAGE_SVG = `<svg viewBox="0 0 360 250" role="img" aria-label="무대 구역과 핀조명 위치">
  <rect x="20" y="10" width="320" height="34" rx="4" fill="#0b1a3a"/><text x="180" y="32" text-anchor="middle" fill="#8fb8ff" font-size="13">LED 스크린</text>
  <rect x="20" y="48" width="320" height="30" fill="#252b3d"/><text x="180" y="68" text-anchor="middle" fill="#c9d1e3" font-size="13">단상 (콰이어)</text>
  <rect x="20" y="82" width="320" height="140" fill="#141a2c" stroke="#2e3448"/>
  <line x1="126" y1="82" x2="126" y2="222" stroke="#3a4466" stroke-dasharray="4 4"/><line x1="234" y1="82" x2="234" y2="222" stroke="#3a4466" stroke-dasharray="4 4"/>
  <text x="73" y="214" text-anchor="middle" font-size="12" fill="#7d869a">왼쪽</text><text x="180" y="214" text-anchor="middle" font-size="12" fill="#7d869a">중앙</text><text x="287" y="214" text-anchor="middle" font-size="12" fill="#7d869a">오른쪽</text>
  <g font-size="11" text-anchor="middle" fill="#fff" font-weight="700">
    <circle cx="70" cy="140" r="22" fill="#0060d1"/><text x="70" y="144">Pin1</text>
    <circle cx="180" cy="104" r="20" fill="#0060d1"/><text x="180" y="108">Pin2</text>
    <circle cx="180" cy="172" r="22" fill="#0060d1"/><text x="180" y="176">Pin3</text>
    <circle cx="290" cy="140" r="22" fill="#0060d1"/><text x="290" y="144">Pin4</text>
  </g>
  <text x="180" y="244" text-anchor="middle" font-size="12" fill="#b4bccd">▲ 관객석에서 바라보는 기준</text>
</svg>`;

// 개사 분위기 → 상단 색 (사이트의 '이 무대에 맞춘 제안'과 같은 기준)
const MOOD_GUIDE = [
  { name: '차분 · 서정', words: '새벽, 밤, 별빛, 그리움, 눈물, 이별, 겨울, 추억', top: '진파랑', range: '20~60%', sw: '#1d3fb8' },
  { name: '밝고 희망찬', words: '빛나, 햇살, 아침, 희망, 내일, 기쁨, 꿈', top: '하늘색', range: '40~100%', sw: '#7cc7ff' },
  { name: '따뜻한', words: '사랑, 마음, 온기, 감사, 가족, 친구, 위로', top: '주황색', range: '30~90%', sw: '#ff9a3d' },
  { name: '힘차고 열정적인', words: '뜨거운, 불꽃, 외쳐, 자유, 열정, 승리, 행진', top: '빨간색', range: '50~100%', sw: '#ff4b4b' },
  { name: '경건한', words: '주님, 하나님, 은혜, 찬양, 영광, 축복, 기도', top: '금색', range: '30~90%', sw: '#d9ad45' },
];

// 곡 흐름 → 밝기
const CURVE = [
  { name: '도입', sub: '간주 · 전주', pct: 25, light: '상단만 20~30%로 어둡게, 2초에 걸쳐 서서히', sound: '합창 마이크 OFF' },
  { name: '전개', sub: '가사', pct: 65, light: '가사 시작과 동시에 무대 60~70%', sound: '가사 시작에 합창 마이크 ON' },
  { name: '절정', sub: '반복되는 후렴', pct: 100, light: '무대 전체 100% 즉시 · FX는 이때 1~2초', sound: "'합창 마이크 볼륨 크게'" },
  { name: '끝', sub: '노래 끝', pct: 4, light: '노래가 끝나면 즉시 암전(X)', sound: '다음 순서 FD 준비' },
];

export const GUIDE = [
  // ---------------- 1. 방향 잡기 ----------------
  {
    id: 'process',
    group: 'plan',
    icon: 'list',
    title: '작성 순서',
    short: '방향 잡기 → 작성 → 피드백 → 제출',
    body: () => `<ol class="points steps">
      ${ptl(1, '무대 구상 정리', '곡과 개사, 무대·단상 인원, 주인공·솔로, 대형 변화를 먼저 정리합니다. 주인공이 있으면 어디에서 나와 어디에 서는지, 어떤 의상인지도 정해 둡니다.', to('#/guide/content', '무대 · 세부 · 개사'))}
      ${ptl(2, '음향 · 조명 구성 정하기', '개사의 분위기와 곡 흐름(간주 · 첫 소절 · 절정 · 끝)으로 조명 색과 밝기를, 사람 배치로 Pin 자리를, 노래하는 사람으로 마이크를 정합니다.', to('#/guide/plan', '무대 연출 계획'))}
      ${ptl(3, '2026 양식에 채우기', "양식은 그대로 두고 Run Time부터 적습니다. 가사 슬라이드 · 대형 · 조명이 바뀌는 지점마다 행을 나누고, 빈칸 없이 X / 유지로 채웁니다. 기획안 · 가사가 정리돼 있으면 'AI 작성'에 요구사항과 파일을 넣어 초안을 받아 시작해도 됩니다.", `${to('#/guide/basic', '기본 규칙')}${to('#/guide/time', 'Run Time')}${to('#/guide/sound', '음향 / FD')}${to('#/guide/light', '조명')}${to('#/guide/ai', 'AI로 작성 · 고치기')}`)}
      ${ptl(4, '제출 전 체크', '19가지를 하나씩 확인합니다. 새로 추가된 기준(주인공 동선 · 의상 · 위치, 노래에 맞춘 마이크, TFT 조명 Q&A)도 들어 있습니다.', to('#/guide/check', '제출 전 체크'))}
      ${ptl(5, '링크로 피드백 받기', "구글 시트 공유를 '링크가 있는 모든 사용자 · 뷰어'로 바꾸고 홈에 링크를 넣습니다. 첨부한 원본은 읽기만 하고 바꾸지 않습니다.", to('#/', '홈에서 링크 넣기'))}
      ${ptl(6, '반영할 피드백 고르기', "피드백마다 원래 → 수정 후를 보고 '반영 / 반영 안 함'을 고릅니다. 표기·빈칸 같은 자동 정리는 처음부터 반영으로, 예시가 들어가는 수정은 골라서 반영합니다. 수정 후 문구를 먼저 고쳐서 반영할 수도 있고, 미리보기로 반영한 모습을 확인합니다.", to('#/guide/feedback', '피드백 고르고 받기'))}
      ${ptl(7, '피드백 반영한 구글 시트 받기', "'피드백 반영한 구글 시트 만들기'를 누르고 구글 계정으로 로그인하면, 고른 피드백만 반영된 큐시트가 내 드라이브에 새 구글 시트로 만들어집니다. 붉은 칸('(작성 필요)', [ ] 예시)을 채운 뒤 다시 첨부해 수정요망 0건을 확인하고 제출합니다.", to('#/guide/feedback', '구글 시트 받는 법'))}
    </ol>
    <div class="duo">
      <div class="card duo-col"><h3>${icon('sparkle', 18)} 사이트가 해 주는 것</h3><ul>
        <li>피드백마다 <b>원래 → 수정 후</b> — 그 학부의 Run Time · 가사 · 인원 · 동선으로 만든 수정</li>
        <li>Run Time · 조명 표기, 빈칸 X / 유지, 셀 병합 같은 <b>자동 정리</b> (끌 수 있음)</li>
        <li>무대 내용 · 개사를 분석한 <b>음향 · 조명 제안</b></li>
        <li>고른 피드백만 반영한 <b>새 구글 시트</b>를 내 드라이브에 만들기</li>
        <li><b>AI 작성</b> — 요구사항(프롬프트)과 기획안 · 가사 · 콘티 파일로 큐시트를 새로 쓰거나 고칠 칸 제안 (OpenAI)</li>
      </ul></div>
      <div class="card duo-col"><h3>${icon('pencil', 18)} 학부가 채워야 하는 것</h3><ul>
        <li>피드백마다 <b>반영 / 반영 안 함</b> 고르기</li>
        <li>인원 · 동선 · 의상 · 가사 · 연출 의도처럼 <b>학부만 아는 내용</b> — 수정 후의 <b>파란 글씨</b>를 실제 내용으로</li>
        <li>받은 시트의 붉은 <b>'(작성 필요)'</b> 칸과 보라색 <b>'논의 중'</b> 칸 확정, <b>직접 고치기</b> 항목 수정</li>
      </ul></div>
    </div>`,
  },
  {
    id: 'plan',
    group: 'plan',
    icon: 'sparkle',
    title: '무대 연출 계획',
    short: '개사 분위기 · 곡 흐름 · 사람 · 노래',
    body: () => `<p class="g-intro">칸을 채우기 전에 무대 내용과 개사를 보고 음향 · 조명의 큰 그림을 먼저 정하세요. 결과 화면의 <b>'이 무대에 맞춘 제안'</b>도 아래 순서로 만들어집니다. 제안은 수정요망 개수에 들어가지 않는 연출 아이디어이고, <span class="pill new">새 기준</span>이 붙은 항목은 지키지 않으면 수정요망입니다.</p>

    <h2 class="g-h2"><span class="g-no">1</span> 개사 분위기 → 상단 색</h2>
    <p class="g-text">가사에 많이 나오는 말로 곡의 분위기를 잡고, 색은 <b>상단 조명</b>으로 입힙니다. <b>무대 조명</b>(앞)은 흰색으로 사람을 밝게 비춥니다.</p>
    <div class="moods">${MOOD_GUIDE.map((m) => `<div class="mood"><div class="mood-h"><i class="sw" style="background:${m.sw}"></i><b>${m.name}</b></div><div class="mood-top">상단 ${m.top} · ${m.range}</div><div class="mood-w">${m.words}</div></div>`).join('')}</div>
    <ul class="g-bullets">
      <li>곡 중간에 분위기가 바뀌면(예: 차분 → 희망) 그 가사가 시작될 때 상단 색을 바꿉니다.</li>
      <li>분위기를 읽을 말이 적으면 상단 색 하나를 정하고 도입은 어둡게, 절정은 밝게 대비를 줍니다.</li>
    </ul>

    <h2 class="g-h2"><span class="g-no">2</span> 곡 흐름 → 밝기</h2>
    <div class="curve" role="img" aria-label="도입 25%, 전개 65%, 절정 100%, 끝 암전">${CURVE.map((c) => `<div class="cv"><div class="cv-bar"><i style="height:${c.pct}%"></i></div><b>${c.name}</b><small>${c.sub}</small></div>`).join('')}</div>
    <ul class="points">${CURVE.map((c, i) => pt(i + 1, `${c.name} <small class="muted">${c.sub}</small>`, `조명: ${c.light} · 음향: ${c.sound}`)).join('')}</ul>
    <p class="g-note">절정은 다시 나오는 가사(후렴)의 마지막 구간이고, 반복이 없으면 마지막으로 노래하는 구간입니다. 밝고 힘찬 곡이 첫 소절부터 노래로 시작하면 도입부터 즉시 켜도 됩니다.</p>

    <h2 class="g-h2"><span class="g-no">3</span> 사람 배치 → 자리와 핀</h2>
    <div class="split">
      <figure class="stage-fig">${STAGE_SVG}<figcaption>핀은 위치가 고정 — 사람이 핀 자리로 가서 섭니다.</figcaption></figure>
      <ul class="points">
        ${pt('1명', '주인공 · 솔로는 Pin 자리에', 'Pin1 무대 왼쪽 · Pin2 단상 바로 앞 · Pin3 무대 앞쪽 중앙 · Pin4 무대 오른쪽. 핀은 따라가지 않으니 그 자리에 서도록 동선을 짭니다.')}
        ${pt('그룹', '3명 이상은 무대 조명 구역', '왼쪽 · 중앙 · 오른쪽 · 전체로 비춥니다. 핀에 여러 명을 넣지 않습니다.')}
        ${pt('안무', '대형이 다 보이게', '안무 구간은 무대 전체 70% 이상.')}
      </ul>
    </div>

    <h2 class="g-h2"><span class="g-no">4</span> 주인공이 있다면 — 조명 Details에 동선 · 의상 · 위치 ${NEW}</h2>
    <div class="g-rule card"><p>학부가 <b>주인공</b>(주연)을 쓰는 무대는 조명 Details에 주인공의</p>
      <ol><li><b>동선</b> — 어디에서 어디로, 언제 움직이는지</li><li><b>의상</b> — 색 · 종류 (조명팀이 찾아 비출 수 있게)</li><li><b>위치</b> — 서는 곳과 그 자리의 Pin</li></ol>
      <p>를 구체적으로 적습니다. 하나라도 빠지면 수정요망입니다. 솔로만 있는 무대에는 적용하지 않습니다.</p></div>
    ${ba('조명 Details', '주인공 따라 핀 이동', '00:40 [흰 드레스]를 입은 주인공이 무대 아래 왼쪽 계단에서 무대 중앙으로 걸어 올라와 Pin3 자리(무대 앞쪽 중앙)에 서면 Pin3 즉시 ON', { isNew: true, why: '세부 내용에 쓴 주인공 동선과 같은 말로 적으면 조명팀과 운영팀이 같은 순간을 봅니다.' })}

    <h2 class="g-h2"><span class="g-no">5</span> 노래 → 마이크 ${NEW}</h2>
    <ul class="points">
      ${pt('합창', '노래하는 구간엔 합창 마이크', '콰이어 6명당 1개 정도(2~6개), 단상 앞. 최종 수량은 TFT 음향팀과 확인합니다.', '<em>예</em>합창 마이크 4개 (단상 앞, 콰이어 24명)')}
      ${pt('솔로', '노래하는 주인공 · 솔로엔 무선 마이크', '기본 무선 마이크는 2대 — 더 많으면 번갈아 쓰는 순서를 적습니다. 움직이며 부르면 무선.', '<em>예</em>무선 마이크 1개 (주인공)')}
      ${pt('ON/OFF', '간주 · 안무는 OFF, 가사 시작에 ON', '음향/FD 칸에 시각과 함께 적습니다. 절정에서는 합창이 음원에 묻히지 않게 볼륨을 키웁니다.', '<em>예</em>00:40 간주 OFF → 00:52 가사 시작 합창 마이크 ON')}
      ${pt('대사 · 악기', '말하는 사람과 악기도', "대사 · 내레이션은 핸드 마이크나 헤드셋(영상에 녹음된 소리면 '영상 음원'), 기타 · 건반은 DI, 카혼 · 드럼은 마이킹.")}
    </ul>
    <p class="g-note">노래하는 구간인데 마이크가 없거나, 노래하는 주인공 · 솔로에게 무선(핸드) 마이크가 없으면 수정요망입니다.</p>

    <h2 class="g-h2"><span class="g-no">6</span> 이렇게 정리하면 <small>모범 예시 무대 1 '새벽의 노래' · 차분 → 희망</small></h2>
    <div class="tl">
      <div class="tl-row"><div class="tl-t"><b>00:40 ~ 00:52</b><small>도입 · 간주</small></div><div class="tl-d"><span>조명</span>상단 진파랑 20%, 2초에 걸쳐 서서히 · 00:44 흰 드레스를 입은 주인공이 Pin3 자리에 서면 Pin3 ON</div><div class="tl-d"><span>음향</span>합창 마이크 OFF · 주인공 무선 마이크 준비</div></div>
      <div class="tl-row"><div class="tl-t"><b>00:52 ~ 01:20</b><small>전개 · "새벽을 깨우는…"</small></div><div class="tl-d"><span>조명</span>가사 시작과 동시에 무대 중앙 흰색 60% · 상단 진파랑 40%</div><div class="tl-d"><span>음향</span>합창 마이크 4개 ON · 주인공 솔로는 무선 마이크</div></div>
      <div class="tl-row"><div class="tl-t"><b>01:20 ~ 01:41</b><small>절정 · "한 걸음씩…"</small></div><div class="tl-d"><span>조명</span>무대 전체 흰색으로 밝게 · 상단은 하늘색으로 바꾸기(희망)</div><div class="tl-d"><span>음향</span>합창 마이크 볼륨 크게</div></div>
      <div class="tl-row"><div class="tl-t"><b>01:41</b><small>끝</small></div><div class="tl-d"><span>조명</span>노래가 끝나면 즉시 암전(X)</div><div class="tl-d"><span>음향</span>영상 2 송출 중 무선 마이크를 솔로 2에게 전달(FD)</div></div>
    </div>
    <p>${to('#/example', '모범 예시 전체 보기')}</p>`,
  },
  // ---------------- 2. 칸별 작성법 ----------------
  {
    id: 'basic',
    group: 'write',
    icon: 'clipboard',
    title: '기본 규칙',
    short: '양식 유지 · 빈칸 없이',
    body: () => `<ul class="points">
      ${pt(1, '양식을 그대로', '열을 더하거나 조명 칸을 합치지 않습니다. 필요한 말은 비고에.')}
      ${pt(2, '빈칸 없이', '안 쓰면 <b>X</b>, 앞 행 조명이 이어지면 <b>유지</b>.')}
      ${pt(3, '공통 항목은 셀 병합', '같은 무대 안의 항목·무대·대기 인원·음향·화면.')}
      ${pt(4, '미정은 표시', "정하지 못한 칸은 '논의 중'이라고 적습니다. 반영본에서 보라색으로 표시되고, 제출 전에 확정합니다.")}
      ${pt(5, '첫 두 행은 고정', '학부 소개 및 투표(사회자) → 학부 인트로 영상.')}
    </ul>
    <p class="g-note">빈칸 X / 유지, 공통 항목 셀 병합, 양식 밖 열을 비고로 옮기는 것은 '자동 정리'로 처음부터 반영하도록 골라져 있습니다(반영 안 함으로 끌 수 있음). 학부만 알 수 있는 칸은 반영본에서 붉은 '(작성 필요)'로 남습니다.</p>
    ${fixes([
      ba('조명-Pin2 (쓰지 않는 조명)', '', 'X', { why: '자동 정리로 반영 — 앞 행 조명이 이어지는 칸은 유지' }),
      ba('양식에 없는 열', '무대참고 이미지 열을 추가함', '열은 지우고 내용은 비고에 [무대참고 이미지: 컨셉보드 링크]'),
      ba('세부 내용 (아직 못 정함)', '', '논의 중', { why: '반영본에서 보라색으로 표시 — 정해지면 바꿔 적기' }),
    ])}`,
  },
  {
    id: 'time',
    group: 'write',
    icon: 'clock',
    title: 'Run Time',
    short: '00:00 ~ 00:04 (4초)',
    body: () => `<ul class="points">
      ${pt(1, '시작 ~ 끝 + 단시', '세 가지를 모두 적습니다.', '<em>예</em>00:00 ~ 00:04 (4초)')}
      ${pt(2, '인트로 영상 다음이 00:00', '학부 영상이 시작되는 순간부터 재생 시간 그대로.')}
      ${pt(3, '끊김·겹침 없이', '앞 행 끝 = 다음 행 시작. 무대마다 00:00으로 다시 시작하지 않기.')}
      ${pt(4, '바뀌는 지점마다 행 나누기', '가사 슬라이드·대형·조명이 바뀔 때마다. 연출 계획의 도입 · 전개 · 절정 · 끝도 행이 나뉘는 지점입니다.')}
      ${pt(5, '무대 11분 이내', '총 13분 = 인트로 2분 + 무대 11분.')}
    </ul>
    ${fixes([
      ba('Run Time (인트로 영상 포함 시간)', '2:41-2:52', '00:40 ~ 00:52 (12초)', { why: '인트로 영상이 끝난 순간이 00:00 — 자동 정리로 반영' }),
      ba('Run Time (한 곡을 한 행에)', '4:41-6:31', '02:41 ~ 03:09 (28초) 함께 걷는 이 길 위에 / 우리의 꿈을 그려요\n03:09 ~ 03:36 (27초) 손을 잡고 노래해요 / 한동의 빛이 되어\n03:36 ~ 04:04 (28초) 멈추지 않을 거예요 / 끝까지 함께해요\n04:04 ~ 04:31 (27초) 우리의 행진은 / 지금부터 시작', { why: "반영하면 가사 슬라이드(2줄)마다 행을 나눠 줍니다 — Run Time은 고르게 나눈 예라 실제 시각으로 확인" }),
      ba('Run Time (길이만)', '1분', '01:41 ~ 02:41 (60초)'),
      ba('무대 시간', '무대 시간 11분 40초', '무대 시간 11분 이내 — 예) [영상 2] 1분 → 20초로 줄이기(여러 순서에서 나눠 줄여도 됨)'),
    ])}`,
  },
  {
    id: 'content',
    group: 'write',
    icon: 'route',
    title: '무대 · 세부 · 개사',
    short: '누가 · 어디서 · 무엇을',
    body: () => `<ul class="points">
      ${pt('무대', '무대와 단상 위 인원', '', '<em>예</em>댄서 16명 무대 / 콰이어 24명 단상')}
      ${pt('대기', '무대 아래 대기 인원', '없으면 X.', '<em>예</em>댄서 12명')}
      ${pt('세부', '언제 · 어디서 · 누가 · 무엇을 · 어떻게', '주인공 동선, 대형 변화, 소품. 주인공이 있으면 어디에서 어디로, 어떤 의상으로 나오는지 — 조명 Details도 이 내용으로 씁니다.', '<em>예</em>흰 드레스를 입은 주인공 1명이 무대 왼쪽 계단에서 무대 중앙(Pin3 위치)으로 걸어 올라옴')}
      ${pt('개사', 'Run Time에 맞춰 슬라이드 단위로', '가사가 없으면 간주 또는 X. 개사의 분위기는 조명 색을 정하는 기준이 됩니다.', '<em>예</em>함께 걷는 이 길 위에 / 우리의 꿈을 그려요')}
      ${pt('화면', '띄울 영상 / PPT', '', '<em>예</em>가사 영상 1')}
    </ul>
    ${fixes([
      ba('세부 내용', '전체 안무', '00:52 가사 "새벽을 깨우는"에 맞춰 댄서 15명이 [무대 중앙]에서 [2줄 대형]으로 안무, [후렴에 가운데 4명이 앞으로 나옴]'),
      ba('세부 내용 (영상 중)', '', '자체영상 1이 나오는 동안 댄서 16명은 [무대 양 옆]에서 무대 1 첫 대형 위치로 이동해 대기, 주인공은 무대 아래 왼쪽 계단에서 대기'),
      ba('무대', '전원 무대', '전원(콰이어 24명 · 댄서 16명) 무대'),
      ba('개사 (가사 없는 구간)', '', '간주'),
    ])}`,
  },
  {
    id: 'sound',
    group: 'write',
    icon: 'sliders',
    title: '음향 / FD',
    short: '장비 · 누가 · 언제',
    body: () => `<ul class="points">
      ${pt(1, '장비 종류와 개수', '합창 마이크, 무선·유선 마이크, 거치대, 악기 마이킹.', '<em>예</em>합창 마이크 4개(단상 앞) / 무선 마이크 1개(주인공)')}
      ${pt(2, '누가 쓰는지', '솔로가 번갈아 쓰면 행마다 ON.', '<em>예</em>핸드마이크 1 ON')}
      ${pt(3, '무대 사이 마이크 이동', '영상이 나가는 동안 무엇을 어디로 옮기고 누구에게 주는지.', '<em>예</em>영상 2 송출 중 합창 마이크 4개를 단상 바로 앞으로')}
      ${pt(4, `노래에 맞춘 마이크 ${NEW}`, '노래하는 구간엔 합창 마이크(콰이어 6명당 1개 정도), 노래하는 주인공·솔로엔 무선 마이크. 간주·안무 구간은 OFF, 가사 시작에 ON. 빠지면 수정요망입니다.', '<em>예</em>00:40 간주 OFF → 00:52 가사 시작 합창 마이크 ON')}
    </ul>
    <p class="g-note">무대 내용 · 개사에 맞춘 마이크 구성은 ${to('#/guide/plan', '무대 연출 계획')}에 있습니다.</p>
    ${fixes([
      ba('음향 / FD (노래하는 주인공)', '합창 마이크 4개 (단상 앞)', '합창 마이크 4개 (단상 앞)\n무선 마이크 1개 (주인공)', { isNew: true, why: '주인공 · 솔로의 노래는 합창 마이크로 잘 잡히지 않음' }),
      ba('음향 / FD (노래하는데 X)', 'X', '합창 마이크 4개 (단상 앞, 콰이어 24명)', { isNew: true }),
      ba('음향 / FD (개수 없음)', '합창 마이크', '합창 마이크 4개 (콰이어 24명)'),
      ba('비고 (무대 사이 FD)', '', '영상 2가 송출되는 동안 FD가 무선 마이크 1개를 솔로 2(무대 오른쪽)에게 전달'),
    ])}`,
  },
  {
    id: 'light',
    group: 'write',
    icon: 'bulb',
    title: '조명',
    short: '구역 / 색상 / 밝기%',
    body: () => `<div class="split">
      <figure class="stage-fig">${STAGE_SVG}<figcaption>핀은 위치가 고정 — 핀 자리로 가서 섭니다.</figcaption></figure>
      <ul class="points">
        ${pt('무대', '인물을 비추는 앞 조명', '구역 / 색상 / 밝기%. 밝은 계열 권장.', '<em>예</em>중앙 / 흰색 / 100%')}
        ${pt('상단', '무대에 색을 입히는 위 조명', '구역 / 색상 / 밝기%. 색은 개사 분위기에 맞춰.', '<em>예</em>전체 / 파란색 / 50%')}
        ${pt('Pin', '1명용 · 색 변경 불가', 'ON / X와 밝기만. 3명 이상은 무대 조명으로.', '<em>예</em>00:44 ON (70%)')}
        ${pt('FX', '효과는 2종류만', '스트로브·고보·무빙·추가 핀 중 2종류를 FX1·FX2로, Details에. 같은 효과는 여러 번 써도 1종류, 점멸은 FX가 아님.', '<em>예</em>00:00~00:01 1초간 스트로브(FX1)')}
        ${pt('Details', '언제 · 무엇이 · 어떻게', '영상 시간 + 분명한 시점 + 즉시/서서히.', '<em>예</em>00:44 주인공이 Pin3에 서면 즉시 ON, 상단은 2초에 걸쳐 서서히')}
      </ul>
    </div>
    <h2 class="g-h2">주인공이 있는 무대 ${NEW}</h2>
    <div class="g-rule card"><p>조명 Details에 주인공의 <b>동선</b>(어디에서 어디로, 언제) · <b>의상</b>(색 · 종류) · <b>위치</b>(서는 곳과 Pin)를 구체적으로 적습니다. 하나라도 빠지면 수정요망입니다. 솔로만 있는 무대에는 적용하지 않습니다.</p></div>
    <h2 class="g-h2">곡 흐름에 맞춰</h2>
    <p class="g-text">차분한 곡은 어둡게 시작해 서서히, 절정(후렴)에서 가장 밝게, 노래가 끝나면 즉시 암전. 분위기별 색과 밝기는 ${to('#/guide/plan', '무대 연출 계획')}</p>
    <h2 class="g-h2">TFT 조명 Q&A ${NEW} <small>학부 질문에 대한 TFT 답변 · 피드백도 이 기준을 따릅니다</small></h2>
    <ul class="points">
      ${pt('FX', 'FX가 있어야 하는 연출', '콰이어만 비추기, 샤워처럼 쏟아지는 빛, 무대 아래에서 안무하는 단원 비추기, 십자가만 비추기는 FX를 써야 합니다. FX는 학부당 2종류이고, 같은 효과를 여러 구간에서 반복하는 것은 1종류로 셉니다. 무대 아래 단원은 서는 위치까지 적습니다.', '<em>예</em>02:10 FX1 무대 아래 왼쪽 계단 앞 댄서 4명 비추기')}
      ${pt('점멸', 'FX가 아닌 연출', '가사 · 비트에 맞춘 연속 점멸, 순간적인 반짝임, 두근두근 뛰는 듯한 점멸은 FX로 세지 않습니다. 요청이 많으면 운용이 어려우니 어떤 조명을 · 언제 · 어떻게(간격 · 밝기 변화) 점멸할지 구체적으로 적습니다. 정확한 시점은 최종 영상이 나온 뒤 맞춥니다.', '<em>예</em>01:05~01:13 상단 전체 / 핑크를 1박마다 30% ↔ 80%로 점멸')}
      ${pt('핀', '핀으로 부각하기', '무대 조명이 100%여도 핀으로 한 사람을 더 밝게 부각할 수 있습니다. 다만 FX에 쓰이는 핀은 효과가 이어지는 동안 일반 핀으로 쓸 수 없으니, FX를 고를 때 함께 생각합니다.', '')}
      ${pt('앞줄', '앞줄만 강조하려면', '무대 조명(앞에서 비추는 조명)을 밝게, 상단 조명을 어둡게 합니다. 무대를 끄고 상단을 켜면 오히려 앞줄이 덜 보입니다.', '<em>예</em>무대 전체 / 흰색 / 100%, 상단 전체 / 파란색 / 20%')}
      ${pt('색', '연한 색과 밝기는 별개', '연한 핑크처럼 연한 색을 원해도 밝기를 낮출 필요는 없습니다. 밝기는 소수점 첫째 자리까지(37.5%) 조절할 수 있습니다. 레퍼런스 사진과 채플은 조명 환경과 배치가 달라 똑같이 나오지 않을 수 있지만, 비슷한 색감은 낼 수 있습니다.', '<em>예</em>전체 / 연한 핑크 / 70%')}
      ${pt('구역', '왼쪽 · 중앙 · 오른쪽', '무대 전체를 3등분한 범위입니다. 조명 특성상 옆 구역으로 빛이 조금 퍼질 수 있습니다.', '')}
      ${pt('고보', '패턴 고르기', 'TFT가 주는 고보 패턴 사진에서 골라 패턴 이름(번호)을 적습니다. 무대 전체에 고르게 비출 수 있는지는 설치 후 확인합니다.', '')}
    </ul>
    <p class="g-note">레퍼런스 사진과 고보 패턴 사진은 TFT가 따로 보내 줍니다.</p>
    ${fixes([
      ba('조명 Details (주인공)', '주인공 따라 핀 이동', '00:40 주인공([흰 드레스])이 무대 아래 왼쪽 계단에서 무대 중앙으로 걸어 올라옴 → 무대 중앙(Pin3 자리)에 서면 Pin3 즉시 ON', { isNew: true, why: '동선 · 의상 · 위치가 모두 들어감 — 핀은 따라가지 않고 자리만 비춤' }),
      ba('조명 Details (의상만 빠짐)', '00:44 주인공이 Pin3 위치에 도착하면 Pin3 즉시 ON', '00:44 주인공([흰 드레스])이 Pin3 위치에 도착하면 Pin3 즉시 ON', { isNew: true }),
      ba('조명-Pin3', '주인공 / 금색', 'ON', { why: '핀은 색 변경 불가 — 색은 무대 · 상단 조명으로 (자동 정리)' }),
      ba('조명 Details (주관적인 시점)', '분위기가 고조될 때 밝게', '01:20 가사 "빛나는 내일을 향해" 시작과 동시에 밝게'),
      ba('조명-상단', '전체/빨강', '전체 / 빨강 / [70%]'),
      ba('조명 Details (FX)', '후렴에서 스트로브 10초간, 바닥 고보 패턴, 무빙 라이트', '[03:38] 후렴에서 FX1 스트로브 2초간, FX2 바닥 고보 패턴 (무빙은 빼기 — FX는 2개까지)'),
      ba('조명 Details (점멸)', '후렴에서 신나게 깜빡깜빡', '[02:10~02:18] 후렴 비트마다 [무대 중앙 / 흰색 / 100%]를 [0.5초]씩 번쩍 ([8번])', { isNew: true, why: '점멸은 FX가 아니지만 어떤 조명을 · 언제 · 어떻게까지 적어야 합니다' }),
      ba('조명 Details (FX가 필요한 연출)', '콰이어만 따로 비춰주세요', '[03:10] FX2 콰이어만 비추기 (단상 위 콰이어 [24명])', { isNew: true, why: '콰이어만 비추는 연출은 FX로 가능 — FX 2종류 중 하나' }),
    ])}`,
  },
  // ---------------- 3. 제출과 피드백 ----------------
  {
    id: 'check',
    group: 'submit',
    icon: 'check',
    title: '제출 전 체크',
    short: '19가지 확인',
    body: () => {
      const groups = [
        ['양식 · Run Time', '#/guide/time', ['양식(열·머리글)을 바꾸지 않았다', "모든 행에 '00:00 ~ 00:00 (n초)'가 있다", '앞 행 끝 = 다음 행 시작이다', '무대 시간이 11분 이하다', '가사·대형·조명이 바뀌는 곳마다 행을 나눴다']],
        ['무대 · 세부 · 개사', '#/guide/content', ['무대·대기 인원을 숫자로 적었다', '세부 내용에 누가·어디서·무엇을·어떻게가 있다', '개사 칸에 빈칸이 없다 (가사 없으면 간주 · X)']],
        ['음향 / FD', '#/guide/sound', ['음향 장비 개수와 사용자를 적었다', ['노래하는 구간엔 마이크, 노래하는 주인공·솔로엔 무선 마이크가 있다'], '무대 사이 마이크를 누가 어디로 옮기는지 적었다']],
        ['조명', '#/guide/light', ['무대·상단은 구역 / 색상 / 밝기%, Pin은 ON·X', 'FX는 2종류까지, Details에 적었다', ['콰이어만 · 무대 아래 단원 · 십자가 비추기, 샤워 빛은 FX로 지정했다'], ['점멸 · 반짝임은 어떤 조명을 · 언제 · 어떻게까지 적었다'], ['주인공이 있으면 조명 Details에 동선 · 의상 · 위치를 적었다'], '조명이 바뀌는 시점을 가사 "○○" · 시각처럼 분명하게, 즉시 · 서서히까지 적었다']],
        ['마무리', '#/guide/feedback', ["빈칸 없이 X·유지, 미정은 '논의 중'", '사이트에 링크를 넣어 수정요망 0건을 확인했다']],
      ];
      return groups
        .map(
          ([name, href, items]) => `<h2 class="g-h2">${name} <a class="g-link small" href="${href}">가이드 ${icon('right', 14)}</a></h2><ul class="checklist">${items
            .map((t) => (Array.isArray(t) ? `<li><label><input type="checkbox"> ${t[0]} ${NEW}</label></li>` : `<li><label><input type="checkbox"> ${t}</label></li>`))
            .join('')}</ul>`,
        )
        .join('');
    },
  },
  {
    id: 'feedback',
    group: 'submit',
    icon: 'chat',
    title: '피드백 고르고 받기',
    short: '같은 종류는 한 묶음 · 반영 / 반영 안 함 · 새 구글 시트',
    body: () => `<p class="g-intro">큐시트 링크를 넣으면 결과 화면이 이어서 나옵니다. 맨 위 <b>요약</b>(수정요망 개수 · 총평 · 무대 시간 · 항목별 고칠 곳)을 보고, <b>고칠 것</b>을 중요한 순서대로 고른 뒤, <b>피드백 반영한 구글 시트</b>를 받습니다. 형식만 맞춘 <b>자동 정리</b>와 꼭은 아닌 <b>더 좋게 하려면</b>(참고 수정 · 무대별 음향 · 조명 제안)은 접혀 있어 필요할 때만 펼쳐 봅니다.</p>

    <h2 class="g-h2">고칠 것 읽기</h2>
    <section class="grp warn sample" aria-label="고칠 것 예">
      <div class="grp-h"><span class="grp-no">10</span><div class="grp-t"><b>조명 Details에 주인공의 동선 · 의상 · 위치를 구체적으로 적기</b><div class="grp-sub"><span class="grp-tag">조명</span><span class="grp-why">근거 · TFT 조명 Details 기준</span></div></div></div>
      <div class="places"><div class="place is-off"><div class="pl-loc">8행 · 무대 1 · 조명-Details</div><div class="pl-main"><div class="pl-ba"><s>주인공 따라 핀 이동</s><span class="arr">→</span><span class="pl-after">00:40 주인공(<mark>흰 드레스</mark>)이 무대 아래 왼쪽 계단에서 무대 중앙으로 걸어 올라옴 → 무대 중앙(Pin3 자리)에 서면 Pin3 즉시 ON</span></div><div class="pl-also">함께 해결 · Pin3이 사람을 따라가도록 요청함</div></div><div class="pl-act"><div class="choice" role="group" aria-label="반영 여부 예"><button type="button" data-v="1" tabindex="-1">${icon('check', 15)} 반영</button><button type="button" data-v="0" class="on" tabindex="-1">반영 안 함</button></div><span class="pl-edit" aria-hidden="true">${icon('pencil', 15)}</span></div></div></div>
    </section>
    <ul class="g-bullets">
      <li><b>굵은 제목</b>이 고칠 방법입니다. 같은 종류의 피드백은 한 묶음이라 설명과 근거는 한 번만 나오고, 아래 줄마다 <b>위치 · 원래 → 수정 후</b>가 있습니다.</li>
      <li>줄마다 <b>반영 / 반영 안 함</b>을 고릅니다(묶음 전체는 '모두 반영'). 반영한 것만 새 구글 시트에 들어가고, 반영 안 함으로 둔 칸은 원래 내용 그대로 남습니다.</li>
      <li><mark>파란 글씨</mark>는 학부만 아는 내용(의상, 대형 등)이라 예로 넣은 부분입니다. ${icon('pencil', 14)}을 눌러 수정 후 문구 고치기 — 실제 내용으로 바꿔 저장하면 그 문구로 반영됩니다.</li>
      <li>한 칸에 여러 피드백이 걸리면 한 줄로 합쳐 최종 문구 하나만 보여 주고, 함께 해결되는 피드백을 '함께 해결'에 적습니다.</li>
    </ul>

    <h2 class="g-h2">항목의 세 종류</h2>
    <div class="kinds">
      <div class="kind"><span class="pill ok">자동 정리</span><p>Run Time · 조명 표기, 빈칸 X / 유지, 셀 병합처럼 형식을 맞추는 수정. 접힌 상자에 모여 있고 처음부터 '반영' — 펼쳐서 끌 수 있습니다.</p></div>
      <div class="kind"><span class="pill info">반영하면 이렇게</span><p>그 칸에 들어갈 문구가 정해진 수정. 예시(파란 글씨)가 들어가는 것은 처음에 '반영 안 함' — 확인하고 골라서 반영합니다.</p></div>
      <div class="kind"><span class="pill manual-pill">직접 고치기</span><p>무대 시간 11분 맞추기, FX 효과 고르기처럼 학부가 정해야 하는 것. 반영할 수 없어 받은 시트에서 고칩니다.</p></div>
    </div>
    <p class="g-note">'더 좋게 하려면'에는 꼭 고칠 것은 아니지만 반영하면 더 분명해지는 참고 수정과, 무대 내용 · 개사를 분석한 무대별 음향 · 조명 제안(마이크 OFF/ON 시각, 절정 볼륨처럼 칸에 넣을 수 있는 것은 골라서 반영), FX 지정이 있습니다.</p>

    <h2 class="g-h2">고르고 받기</h2>
    <ol class="points steps">
      ${pt(1, '보고 싶은 항목만', "맨 위 항목 칩(Run Time · 조명 …)을 누르면 그 항목의 고칠 것만 보입니다. 숫자는 고칠 곳 수, ✓는 고칠 것이 없는 항목입니다.")}
      ${pt(2, '줄마다 반영 / 반영 안 함', "한꺼번에 고르려면 '수정요망 모두 반영' · '모두 반영 안 함' · '처음 선택으로', 묶음 안에서는 '모두 반영'.")}
      ${pt(3, '문구를 고쳐서 반영 · 미리보기', "수정 후 문구 고치기(✎)로 파란 글씨를 실제 내용으로 바꾸고 '저장하고 반영'. 미리보기에서 반영한 모습을 2026 양식 표로 확인합니다.")}
      ${pt(4, '피드백 반영한 구글 시트 만들기', "버튼을 누르고 구글 계정으로 로그인해 '허용'하면, 고른 피드백만 반영된 큐시트가 <b>내 드라이브에 새 구글 시트</b>로 만들어지고 바로 열립니다. 2026 양식(열 너비 · 셀 색 · 글꼴 · 병합) 그대로이고, 첨부한 원본은 바뀌지 않습니다. 권한은 이 사이트가 만든 파일에만 접근하는 범위입니다.")}
      ${pt(5, '남은 칸 채우고 제출', "받은 시트의 붉은 칸('(작성 필요)', [ ] 예시)과 '직접 고치기' 항목을 고친 뒤, 그 시트 링크를 다시 넣어 수정요망 0건('제출 가능')을 확인하고 제출합니다.")}
    </ol>
    <p class="g-note">'AI 작성'으로 요구사항을 말해 큐시트를 쓰거나 고칠 수도 있습니다 — <a href="#/guide/ai">AI로 작성 · 고치기</a>. '반영으로 바뀐 칸을 노란색으로 표시'를 켜면 받은 시트에서 바뀐 곳을 찾기 쉽습니다. '피드백 메시지 복사'에는 고칠 것 묶음마다 위치별 반영 여부와 원래 → 수정 후가, '검토용 엑셀'에는 반영 열과 총평이 들어갑니다. 구글 로그인을 쓸 수 없을 때는 반영본 엑셀을 내려받아 새 시트에서 '파일 → 가져오기'로 넣는 방법을 안내합니다.</p>`,
  },
  {
    id: 'ai',
    group: 'submit',
    icon: 'sparkle',
    title: 'AI로 작성 · 고치기',
    short: '요구사항(프롬프트) + 기획안 · 가사 · 콘티 파일 → 큐시트 작성 · 고칠 칸 제안',
    body: () => `<p class="g-intro">위 메뉴의 <b>AI 작성</b>에서 원하는 큐시트를 말로 설명하고 기획안 · 가사 · 콘티 같은 파일을 붙이면, AI(OpenAI)가 2026 2차 양식과 이 가이드의 기준에 맞춰 큐시트를 <b>새로 쓰거나</b> 첨부한 큐시트에서 <b>고칠 칸</b>을 제안합니다. 결과는 피드백과 똑같이 <b>반영 / 반영 안 함</b>을 골라 새 구글 시트로 받습니다.</p>

    <h2 class="g-h2">두 가지 작업</h2>
    <div class="kinds two">
      <div class="kind"><span class="pill ai">새 큐시트 작성</span><p>순서 · 인원 · 곡 · 연출을 설명하거나 기획안을 붙이면 2026 양식 큐시트 전체를 씁니다. 미리 보고 <b>이 큐시트로 피드백 받기</b>를 누르면 점검 → 반영 고르기 → 구글 시트 받기로 이어집니다.</p></div>
      <div class="kind"><span class="pill ai">첨부한 큐시트 고치기</span><p>링크로 첨부한 큐시트(지금 고른 피드백을 반영한 상태)에서 바꿀 칸과 새로 넣을 행을 제안합니다. '수정요망도 함께 고치기'를 켜면 아직 반영하지 않은 수정요망도 함께 고칩니다.</p></div>
    </div>

    <h2 class="g-h2">요구사항 쓰는 법 <small>형식은 자유 — 문장, 목록, 엑셀에서 복사한 표 모두 됩니다</small></h2>
    <ol class="points steps">
      ${pt(1, '어디를', "'무대 2', '무대 1 후렴', '두 번째 영상 다음'처럼 바꿀 곳을 콕 집어 말합니다.")}
      ${pt(2, '무엇을 어떻게', "'상단 빨간색 100%', '즉시 암전', 'Pin3 ON'처럼 2026 표기로 말하면 그대로 들어갑니다. '차분하게', '가장 화려하게'처럼 분위기만 말해도 기준에 맞는 색 · 밝기로 바꿉니다.")}
      ${pt(3, '학부만 아는 사실', '인원 수, 주인공의 의상 · 동선, 곡 제목, 가사처럼 AI가 알 수 없는 것은 직접 적거나 파일로 붙입니다. 모르는 값은 AI가 지어내지 않고 [ ]로 자리만 잡아 둡니다.')}
      ${pt(4, '참고 파일', '텍스트 · 워드(.docx) · 한글(.hwpx) · PDF · 파워포인트(.pptx) · 엑셀 · 이미지(콘티 · 동선도)를 8개까지 붙일 수 있습니다. 한글(.hwp)이나 예전 오피스 파일은 PDF로 저장해서 올립니다.')}
    </ol>
    <div class="duo">
      <div class="card duo-col"><h3>${icon('chat', 18)} 막연한 요구사항</h3><ul>
        <li>조명 좀 예쁘게 해 줘</li>
        <li>주인공 부분 채워 줘</li>
      </ul></div>
      <div class="card duo-col"><h3>${icon('check', 18)} 바로 반영되는 요구사항</h3><ul>
        <li>무대 2 후렴(02:10부터)에서 무대 전체 100%, 상단 빨간색 100%로 바꿔 주세요.</li>
        <li>무대 1 주인공은 흰 드레스를 입고 무대 왼쪽 계단에서 올라와 Pin3 자리에 섭니다. 조명 Details에 넣어 주세요.</li>
      </ul></div>
    </div>

    <h2 class="g-h2">받은 결과 고르기</h2>
    <ul class="g-bullets">
      <li>보라색 카드가 AI가 고친 칸입니다. 처음엔 '반영'으로 골라져 있고, 원래 → 수정 후를 보고 반영 안 함으로 바꾸거나 '수정 후 문구 고치기'로 다듬습니다. <b>새 행</b> 카드는 그 행에 들어갈 칸을 모두 보여 줍니다.</li>
      <li>AI 작성 화면에서 바로 <b>피드백 반영한 구글 시트 만들기</b>를 눌러도 되고, 피드백 결과 화면의 'AI 요청 반영'에서 피드백과 함께 골라도 됩니다. 반영한 것만 새 구글 시트에 들어갑니다.</li>
      <li>요청은 여러 번 이어서 할 수 있습니다. 다음 요청은 앞에서 반영으로 고른 내용이 들어간 큐시트를 보고 고칩니다. '요구사항 다시 쓰기'로 지난 요청을 고쳐 다시 보낼 수 있습니다.</li>
      <li>[ ] 칸은 받은 시트에서 붉게 표시되니 실제 내용으로 바꾸고, 그 시트 링크를 다시 넣어 수정요망 0건을 확인하고 제출합니다.</li>
    </ul>
    <p class="g-note">요구사항 · 첨부 파일 · 큐시트 내용은 OpenAI로 전송되니 연락처 같은 개인정보는 넣지 마세요. 서버에 잠시 둔 요청은 결과를 받으면 지웁니다. 보통 1~3분 걸리고, 그동안 다른 화면을 봐도 결과를 기다립니다(첨부 파일은 새로 고치면 다시 붙여야 합니다). AI도 틀릴 수 있으니 반영하기 전에 원래 → 수정 후를 꼭 확인하세요.</p>
    <div class="g-links">${to('#/write', 'AI 작성 열기')}</div>`,
  },
];

const GROUPS = [
  { id: 'plan', name: '방향 잡기', sub: '쓰기 전에 무대의 큰 그림부터' },
  { id: 'write', name: '칸별 작성법', sub: '2026 2차 양식의 각 칸' },
  { id: 'submit', name: '제출과 피드백', sub: '확인하고, 반영할 피드백 · AI 수정을 골라 새 구글 시트로 받기' },
];

// 홈에서 결과까지의 흐름 (가이드 첫 화면)
const FLOW = [
  ['무대 구상', '#/guide/content'],
  ['음향 · 조명 구성', '#/guide/plan'],
  ['양식에 채우기', '#/guide/basic'],
  ['제출 전 체크', '#/guide/check'],
  ['링크로 피드백', '#/'],
  ['반영할 피드백 고르기', '#/guide/feedback'],
  ['반영된 구글 시트 받기', '#/guide/feedback'],
];

export function guideIndexHtml() {
  const tile = (g) => `<a class="tile" href="#/guide/${g.id}">${icon(g.icon, 28)}<div><b>${g.title}</b><span class="sub">${g.short}</span></div><i class="bar" style="width:${((GUIDE.indexOf(g) + 1) / GUIDE.length) * 100}%;background:var(--blue)"></i></a>`;
  return `<section class="page guide-index">
    <h1 class="page-title">작성 가이드</h1>
    <p class="page-sub">큐시트를 쓰기 전에 방향을 잡고, 피드백을 받은 뒤 고칠 때 보세요.</p>
    <ol class="flow">${FLOW.map(([t, href], i) => `<li><a href="${href}"><span>${i + 1}</span>${t}</a></li>`).join('')}</ol>
    <div class="card newbox">
      <h2>${icon('sparkle', 20)} 2026 새 기준 · 피드백 방식</h2>
      <ul>
        <li><a href="#/guide/light"><b>TFT 조명 Q&A</b> — FX가 필요한 연출(콰이어만 · 무대 아래 · 십자가 비추기, 샤워 빛), 점멸은 FX가 아니지만 구체적으로, 앞줄 강조 · 연한 색과 밝기</a>${NEW}</li>
        <li><a href="#/guide/light"><b>주인공이 있는 무대</b> — 조명 Details에 주인공의 동선 · 의상 · 위치</a>${NEW}</li>
        <li><a href="#/guide/sound"><b>노래에 맞춘 마이크</b> — 노래하는 구간엔 마이크, 노래하는 주인공 · 솔로엔 무선 마이크</a>${NEW}</li>
        <li><a href="#/guide/plan"><b>음향 · 조명 구성</b> — 개사 분위기 · 곡 흐름 · 사람 배치에 맞춘 제안</a><span class="pill info">제안</span></li>
        <li><a href="#/guide/feedback"><b>항목별 반영 고르기</b> — 피드백마다 원래 → 수정 후를 보고 반영 / 반영 안 함, 반영한 것만 새 구글 시트로</a><span class="pill">피드백</span></li>
        <li><a href="#/guide/ai"><b>AI 작성</b> — 요구사항(프롬프트)과 기획안 · 가사 · 콘티 파일로 큐시트를 새로 쓰거나 고치기</a><span class="pill ai">AI</span></li>
      </ul>
    </div>
    ${GROUPS.map(
      (gr) => `<h2 class="group-title">${gr.name} <small>${gr.sub}</small></h2>
    <div class="tiles">${GUIDE.filter((g) => g.group === gr.id).map(tile).join('')}${gr.id === 'submit' ? `<a class="tile" href="#/example">${icon('play', 28)}<div><b>모범 예시</b><span class="sub">기준을 모두 지킨 큐시트</span></div></a>` : ''}</div>`,
    ).join('')}
  </section>`;
}

export function guidePageHtml(id) {
  const i = GUIDE.findIndex((g) => g.id === id);
  const g = GUIDE[i];
  if (!g) return null;
  const prev = GUIDE[i - 1];
  const next = GUIDE[i + 1];
  return `<section class="page guide">
    <a class="back" href="#/guide">${icon('left', 18)} 가이드</a>
    <nav class="guide-nav">${GUIDE.map((x) => `<a href="#/guide/${x.id}" class="${x.id === id ? 'active' : ''}">${x.title}</a>`).join('')}</nav>
    <h1>${g.title}</h1>
    <p class="lead">${g.short}</p>
    ${g.body()}
    <div class="pager">
      ${prev ? `<a href="#/guide/${prev.id}"><small>이전</small>${prev.title}</a>` : '<span></span>'}
      ${next ? `<a class="next" href="#/guide/${next.id}"><small>다음</small>${next.title}</a>` : '<a class="next" href="#/example"><small>다음</small>모범 예시</a>'}
    </div>
  </section>`;
}

// 작성 가이드 — 주제별로 짧게 나눈 페이지
import { icon } from './icons.js';

const pt = (no, title, text, ex) => `<li><span class="no">${no}</span><div><b>${title}</b><span>${text}</span>${ex ? `<div class="example">${ex}</div>` : ''}</div></li>`;

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

export const GUIDE = [
  {
    id: 'basic',
    icon: 'clipboard',
    title: '기본 규칙',
    short: '양식 유지 · 빈칸 없이',
    body: () => `<ul class="points">
      ${pt(1, '양식을 그대로', '열을 더하거나 조명 칸을 합치지 않습니다. 필요한 말은 비고에.')}
      ${pt(2, '빈칸 없이', '안 쓰면 <b>X</b>, 앞 행 조명이 이어지면 <b>유지</b>.')}
      ${pt(3, '공통 항목은 셀 병합', '같은 무대 안의 항목·무대·대기 인원·음향·화면.')}
      ${pt(4, '미정은 표시', "정하지 못한 칸은 '논의 중'이라고 적습니다.")}
      ${pt(5, '첫 두 행은 고정', '학부 소개 및 투표(사회자) → 학부 인트로 영상.')}
    </ul>`,
  },
  {
    id: 'time',
    icon: 'clock',
    title: 'Run Time',
    short: '00:00 ~ 00:04 (4초)',
    body: () => `<ul class="points">
      ${pt(1, '시작 ~ 끝 + 단시', '세 가지를 모두 적습니다.', '<em>예</em>00:00 ~ 00:04 (4초)')}
      ${pt(2, '인트로 영상 다음이 00:00', '학부 영상이 시작되는 순간부터 재생 시간 그대로.')}
      ${pt(3, '끊김·겹침 없이', '앞 행 끝 = 다음 행 시작. 무대마다 00:00으로 다시 시작하지 않기.')}
      ${pt(4, '바뀌는 지점마다 행 나누기', '가사 슬라이드·대형·조명이 바뀔 때마다.')}
      ${pt(5, '무대 11분 이내', '총 13분 = 인트로 2분 + 무대 11분.')}
    </ul>`,
  },
  {
    id: 'content',
    icon: 'route',
    title: '무대 · 세부 · 개사',
    short: '누가 · 어디서 · 무엇을',
    body: () => `<ul class="points">
      ${pt('무대', '무대와 단상 위 인원', '', '<em>예</em>댄서 16명 무대 / 콰이어 24명 단상')}
      ${pt('대기', '무대 아래 대기 인원', '없으면 X.', '<em>예</em>댄서 12명')}
      ${pt('세부', '언제 · 어디서 · 누가 · 무엇을 · 어떻게', '주인공 동선, 대형 변화, 소품.', '<em>예</em>후렴 시작에 가운데 4명이 앞으로 나와 V자 대형')}
      ${pt('개사', 'Run Time에 맞춰 슬라이드 단위로', '가사가 없으면 간주 또는 X.', '<em>예</em>함께 걷는 이 길 위에 / 우리의 꿈을 그려요')}
      ${pt('화면', '띄울 영상 / PPT', '', '<em>예</em>가사 영상 1')}
    </ul>`,
  },
  {
    id: 'sound',
    icon: 'sliders',
    title: '음향 / FD',
    short: '장비 · 누가 · 언제',
    body: () => `<ul class="points">
      ${pt(1, '장비 종류와 개수', '합창 마이크, 무선·유선 마이크, 거치대, 악기 마이킹.', '<em>예</em>합창 마이크 4개(단상 앞) / 무선 마이크 1개(주인공)')}
      ${pt(2, '누가 쓰는지', '솔로가 번갈아 쓰면 행마다 ON.', '<em>예</em>핸드마이크 1 ON')}
      ${pt(3, '무대 사이 마이크 이동', '영상이 나가는 동안 무엇을 어디로 옮기고 누구에게 주는지.', '<em>예</em>영상 2 송출 중 합창 마이크 4개를 단상 바로 앞으로')}
    </ul>`,
  },
  {
    id: 'light',
    icon: 'bulb',
    title: '조명',
    short: '구역 / 색상 / 밝기%',
    body: () => `<div class="split">
      <figure class="stage-fig">${STAGE_SVG}<figcaption>핀은 위치가 고정 — 핀 자리로 가서 섭니다.</figcaption></figure>
      <ul class="points">
        ${pt('무대', '인물을 비추는 앞 조명', '구역 / 색상 / 밝기%. 밝은 계열 권장.', '<em>예</em>중앙 / 흰색 / 100%')}
        ${pt('상단', '무대에 색을 입히는 위 조명', '구역 / 색상 / 밝기%.', '<em>예</em>전체 / 파란색 / 50%')}
        ${pt('Pin', '1명용 · 색 변경 불가', 'ON / X와 밝기만. 3명 이상은 무대 조명으로.', '<em>예</em>00:44 ON (70%)')}
        ${pt('FX', '효과는 2개만', '스트로브·고보·무빙·추가 핀 중 2개를 FX1·FX2로, Details에.', '<em>예</em>00:00~00:01 1초간 스트로브(FX1)')}
        ${pt('Details', '언제 · 무엇이 · 어떻게', '영상 시간 + 분명한 시점 + 즉시/서서히.', '<em>예</em>00:44 주인공이 Pin3에 서면 즉시 ON, 상단은 2초에 걸쳐 서서히')}
      </ul>
    </div>`,
  },
  {
    id: 'check',
    icon: 'check',
    title: '제출 전 체크',
    short: '11가지 확인',
    body: () => `<ul class="checklist">${[
      '양식(열·머리글)을 바꾸지 않았다',
      "모든 행에 '00:00 ~ 00:00 (n초)'가 있다",
      '앞 행 끝 = 다음 행 시작이다',
      '무대 시간이 11분 이하다',
      '가사·대형·조명이 바뀌는 곳마다 행을 나눴다',
      '무대·대기 인원을 숫자로 적었다',
      '세부 내용에 누가·어디서·무엇을이 있다',
      '음향 장비 개수와 사용자를 적었다',
      '무대·상단은 구역 / 색상 / 밝기%, Pin은 ON·X',
      'FX는 2개까지, Details에 적었다',
      "빈칸 없이 X·유지, 미정은 '논의 중'",
    ]
      .map((t) => `<li><label><input type="checkbox"> ${t}</label></li>`)
      .join('')}</ul>`,
  },
];

export function guideIndexHtml() {
  return `<section class="page">
    <h1 class="page-title">작성 가이드</h1>
    <p class="page-sub">주제를 골라 하나씩 보세요.</p>
    <div class="tiles">${GUIDE.map(
      (g, i) => `<a class="tile" href="#/guide/${g.id}">${icon(g.icon, 28)}<div><b>${g.title}</b><span class="sub">${g.short}</span></div><i class="bar" style="width:${((i + 1) / GUIDE.length) * 100}%;background:var(--blue)"></i></a>`,
    ).join('')}
      <a class="tile" href="#/example">${icon('play', 28)}<div><b>모범 예시</b><span class="sub">기준을 모두 지킨 큐시트</span></div></a>
    </div>
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

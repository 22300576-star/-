// 2026 학부합창대회 2차 큐시트 양식 기준 상수
// 열 순서와 이름은 TFT가 배포한 2026 2차 큐시트(A~P열)를 그대로 따른다.

export const COLS = [
  { key: 'item', label: '항목', letter: 'A' },
  { key: 'runtime', label: 'Run Time', letter: 'B' },
  { key: 'stage', label: '무대', letter: 'C' },
  { key: 'waiting', label: '대기 인원', letter: 'D' },
  { key: 'detail', label: '세부 내용', letter: 'E' },
  { key: 'lyrics', label: '개사 내용', letter: 'F' },
  { key: 'sound', label: '음향 / FD', letter: 'G' },
  { key: 'screen', label: '화면(영상)', letter: 'H' },
  { key: 'lStage', label: '무대', group: '조명', letter: 'I' },
  { key: 'lTop', label: '상단', group: '조명', letter: 'J' },
  { key: 'pin1', label: 'Pin1', group: '조명', letter: 'K' },
  { key: 'pin2', label: 'Pin2', group: '조명', letter: 'L' },
  { key: 'pin3', label: 'Pin3', group: '조명', letter: 'M' },
  { key: 'pin4', label: 'Pin4', group: '조명', letter: 'N' },
  { key: 'details', label: 'Details', group: '조명', letter: 'O' },
  { key: 'note', label: '비고', letter: 'P' },
];

export const KEYS = COLS.map((c) => c.key);
export const COL_BY_KEY = Object.fromEntries(COLS.map((c, i) => [c.key, { ...c, index: i }]));

// 공통 내용이면 셀 병합하는 열 (OT 자료: "공통된 항목을 작성하실 때는 꼭 '셀병합'을 해주세요!")
export const MERGEABLE = ['item', 'stage', 'waiting', 'sound', 'screen'];
export const LIGHT_KEYS = ['lStage', 'lTop', 'pin1', 'pin2', 'pin3', 'pin4'];
export const PIN_KEYS = ['pin1', 'pin2', 'pin3', 'pin4'];
// 4행 안내가 붉은색으로 칠해진(빈칸 금지) 열: B~O
export const REQUIRED_KEYS = KEYS.filter((k) => !['item', 'note'].includes(k));

export function colName(key) {
  const c = COL_BY_KEY[key];
  if (!c) return key;
  if (c.group) return `조명-${c.label}`;
  return c.label;
}

// 핀조명 고정 위치 (조명 가이드 이미지: LED 스크린-단상-무대, 관객석에서 바라보는 기준)
export const PIN_POS = {
  pin1: { name: 'Pin1', where: '무대 왼쪽', zone: 'left' },
  pin2: { name: 'Pin2', where: '단상 바로 앞 중앙(무대 뒤쪽)', zone: 'back' },
  pin3: { name: 'Pin3', where: '무대 앞쪽 중앙', zone: 'center' },
  pin4: { name: 'Pin4', where: '무대 오른쪽', zone: 'right' },
};

// 2026 2차 큐시트 4행(붉은색 안내 행) 문구 — 템플릿 그대로
export const GUIDE_ROW = {
  runtime: '총 13분\n(인트로 영상 2분 + 무대 11분)\n* 무대 시간 11분 초과 절대 X',
  stage: '무대와 단상 위 상황을 적어주세요.',
  waiting: '채플 무대 아래에서\n대기하는 인원의 수를 적어주세요.',
  detail:
    '무대에서 벌어지는 주요 상황을 구체적으로 설명해주세요.\n 단원들의 동선(주인공이 있다면 주인공의 동선), \n대형 변화, 소품 활용 등',
  lyrics: '각 슬라이드에 들어갈 개사 내용을 적어주세요!\n인트로 대사가 있다면 적어주세요 !',
  sound: '어떤 음향 장비를 몇 개 사용하실 건지 정확하게 적어주세요!',
  screen: 'PPT / 영상과 같이\n항목을 작성해주세요',
  lStage: '구역 / 색상 / 밝기로 작성해주세요',
  lTop: '구역 / 색상 / 밝기로 작성해주세요',
  pin1: '',
  pin2: '',
  pin3: '',
  pin4: '',
  details:
    "어떤 조명으로 언제 어떻게 사용하실 것인지\n디테일한 '동선' 포인트로 적어주세요!\n(ex. 누가 어디에서 어디로 이동할 때 어떤 조명을 비춰주세요.)",
};

export const STAGE_LIMIT_SEC = 11 * 60; // 무대 11분
export const INTRO_SEC = 2 * 60; // 인트로 영상 2분

export const PLACEHOLDER = '(작성 필요)';

// 화면·엑셀에는 고칠 것을 모두 '수정요망' 하나로 보여준다 (order는 정렬용: 큰 문제 먼저)
export const LEVELS = {
  error: { label: '수정요망', order: 0 },
  warn: { label: '수정요망', order: 1 },
  info: { label: '참고', order: 2 },
};

export const CATS = {
  form: '양식',
  time: 'Run Time',
  stage: '무대·대기 인원',
  detail: '세부 내용',
  lyrics: '개사 내용',
  sound: '음향 / FD',
  screen: '화면(영상)',
  light: '조명',
  fx: 'FX',
};

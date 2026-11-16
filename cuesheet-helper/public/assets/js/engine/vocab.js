// 큐시트 문장 해석용 어휘 사전
// 근거: 2026 조명 큐시트 작성 가이드(무대/상단 구역·색상·밝기, Pin1~4, FX1·FX2, 큐시트 작성 팁)

export const norm = (s) => (s == null ? '' : String(s)).replace(/\r\n?/g, '\n').replace(/[ \t ]+\n/g, '\n').trim();
export const squash = (s) => norm(s).replace(/\s+/g, '').toLowerCase();
export const isBlank = (s) => !norm(s) || /^[·.\s]+$/.test(norm(s)) || /^\((작성 필요|조명 작성 필요)\)$/.test(norm(s));

// 논의 중/미정 표시 (공시 2차 큐시트: 논의 중 셀을 보라색으로 표시)
export const PENDING_RE = /(논의\s*중|의논\s*중|회의\s*중|미정|추후|구상\s*중|기획\s*중|수정\s*중|개사\s*중|협의\s*중|상의\s*중|확정\s*전|tbd|추가\s*예정|작성\s*예정|기록\s*예정|정해지지)/i;

// 꺼짐 표현
export const OFF_ONLY_RE = /^(?:x|X|×|ｘ|off|OFF|Off|-|—|–|ㅡ|없음|사용\s*안\s*함|사용\s*X|끔|끄기|꺼짐|암전|전체\s*암전|무대\s*전체\s*암전|x\s*\(암전\)|X\s*\(암전\)|(?:무대|상단|전체|핀|pin)\s*조명\s*off|(?:무대|상단|전체)\s*조명\s*X|블랙아웃|blackout)\s*\.?$/i;
export const BLACK_COLOR_RE = /(블랙|검정색?|검은색?|black)/i;

export const KEEP_RE = /^(유지|동일|위와\s*동일|위와\s*같음|상동|그대로)/;

// 구역
export const ZONE_RE = /(전체|모두|전부|좌우|양쪽|양\s*옆|사이드|좌·?중·?우|LCR|왼쪽|왼|좌측|좌(?![석표])|오른쪽|오른|우측|우(?![리측])|중앙|가운데|센터|center|left|right|중(?=\s*[\/·,]))/i;

// 색상
export const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/;
export const COLOR_WORD_RE = /(흰색|하얀색?|하양|화이트|white|백색|웜\s*화이트|쿨\s*화이트|빨간색?|빨강|붉은색?|레드|red|주황색?|오렌지|orange|노란색?|노랑|옐로우?|yellow|금색|골드|gold|초록색?|녹색|그린|green|연두색?|민트|mint|하늘색|파란색?|파랑|진파랑|블루|blue|남색|네이비|청록색?|시안|cyan|보라색?|보랏빛|퍼플|purple|바이올렛|분홍색?|핑크|pink|자주색?|마젠타|앰버|amber|따뜻한\s*\S*빛|차가운\s*\S*빛|따뜻한\s*\S*|차가운\s*\S*|주황빛|노란빛|푸른색?|푸른빛|붉은빛|핑크빛|살구색?|베이지)/i;
export const WHITE_RE = /(흰색|하얀색?|하양|화이트|white|백색|#fff(?:fff)?\b)/i;

// 밝기
export const PERCENT_RE = /\d{1,3}\s*%/;
export const VAGUE_BRIGHT = [
  [/(최대한\s*밝게|최대\s*밝기|가장\s*밝게|아주\s*밝게|완전\s*밝게|매우\s*밝게)/, 100],
  [/(아주\s*어둡게|매우\s*어둡게|아주\s*약하게|아주\s*은은하게|희미하게|사람만\s*보일\s*정도)/, 10],
  [/(조금은?\s*어둡게|살짝\s*어둡게|약간\s*어둡게|은은하게|연하게|약하게|은은한)/, 30],
  [/(중간\s*밝기|중간|적당히|보통)/, 50],
  [/(강하게|꽤\s*밝게|밝게|환하게|밝음|밝은)/, 80],
  [/(어둡게|어두움|어둡고|어두운)/, 20],
];

// 핀 ON
export const PIN_ON_ONLY_RE = /^(?:o|O|on|ON|On|켜기|켬|점등|pin\s*조명\s*on|핀\s*조명\s*on|pin\s*on|핀\s*on)\s*\.?$/i;

// 그룹(3명 이상) 표현
export const GROUP_RE = /(그룹|팀|단원들|인원|댄서들|콰이어|합창단|전원|모두|여러\s*명|단체|무리|열\b)/;
export const COUNT_RE = /(\d+)\s*(?:~\s*\d+\s*)?명/;

// 핀 추적/이동 요청
export const FOLLOW_RE = /(따라\s*(?:가|비|움직|이동)|따라감|따라서|따라가|좌우\s*이동|함께\s*이동|이동해\s*주세요|이동하면서|움직이며|추적|트래킹|tracking|follow)/i;

// 위치 표현
export const LOC_WORDS = [
  { re: /(피지\s*광장|출입문|입구|통로|객석|복도|뒷문|문\s*앞|계단|피아노)/, zone: 'offstage' },
  { re: /(단상)/, zone: 'back' },
  { re: /(왼쪽|좌측|좌\s|왼\s|하수)/, zone: 'left' },
  { re: /(오른쪽|우측|우\s|오른\s|상수)/, zone: 'right' },
  { re: /(중앙|가운데|센터|정중앙)/, zone: 'center' },
];

// FX 효과 종류 (조명 가이드 4. FX1, FX2)
export const FX_TYPES = [
  { key: 'strobe', name: '스트로브', re: /(스트로브|strobe|섬광|번쩍이)/i },
  { key: 'gobo', name: '고보', re: /(고보|gobo|패턴|무늬)/i },
  { key: 'moving', name: '무빙', re: /(무빙|moving|빔\b|beam|사선\s*빔|회전|원을\s*그리|교차하|레이저)/i },
  { key: 'extraPin', name: '추가 핀', re: /(추가\s*핀|다른\s*위치.{0,6}핀|별도\s*핀)/ },
];
export const FX_LABEL_RE = /FX\s*([12])/gi;
export const FX_ANY_RE = /(FX\s*[12]?|효과\s*조명|특수\s*효과)/i;

// 전환 방식 (큐시트 작성 팁 1)
export const TRANSITION_RE = /(즉시|바로|곧바로|서서히|천천히|점점|점차|페이드|fade|\d+\s*초(?:에|간|동안)?\s*(?:에\s*)?걸쳐|\d+\s*초간|\d+\s*초\s*동안|순간|딱|깜빡|번쩍|한\s*번에|동시에|지체\s*없이|켜지|꺼지|들어오|빠르게|암전)/i;

// 주관적 시점 표현 (큐시트 작성 팁 3)
export const SUBJECTIVE_RE = /(분위기가?\s*(?:고조|무르익|올라|바뀌)|신나는\s*분위기|감동적인\s*순간|적절(?:히|한\s*때)|알아서|느낌(?:으로|적으로|대로)|적당한\s*때|자연스럽게\s*(?:켜|꺼|바꿔)|고조될\s*때|클라이맥스)/;

// 세부 내용 5W1H 판단 요소
export const WHO_RE = /(\d+\s*명|댄서|콰이어|합창|주인공|단원|솔로|팀|역할|역\b|사회자|래퍼|전원|모두|인원|남자|여자|[A-Z]팀|그룹)/;
export const WHERE_RE = /(무대|단상|중앙|가운데|왼쪽|오른쪽|좌측|우측|양\s*옆|앞|뒤|계단|아래|위|피지|통로|객석|입구|문|대형|줄|열|자리|위치)/;
export const ACTION_RE = /(이동|입장|퇴장|등장|대형|안무|노래|합창|모여|모임|퍼지|퍼져|흩어|돌|앉|서\b|서서|서있|일어|들고|소품|걸어|뛰|달려|올라|내려|춤|연기|대사|멘트|인사|포즈|자세|박수|던지|펼치|접|바꾸|교차|정렬|대기)/;
export const VAGUE_DETAIL_RE = /^(전체\s*안무|단체\s*안무|안무|합창\.?|노래|전체\s*합창|단체|공연|무대|퍼포먼스|합창\s*및\s*퍼포먼스.*|X|x)$/;

// 음향
export const MIC_RE = /(마이크|mic|핸드\s*마이크|헤드셋|핀\s*마이크)/i;
export const MIC_ITEM_RE = /(합창\s*마이크|무선\s*마이크|유선\s*마이크|핸드\s*마이크|솔로\s*마이크|헤드셋|핀\s*마이크|마이크\s*거치대|스탠드|DI|마이킹)/gi;
export const HANDHELD_RE = /(무선|유선|핸드|솔로|헤드셋|핀\s*마이크)/;
export const WHO_MIC_RE = /(주인공|솔로|사회자|래퍼|역\b|역할|콰이어|댄서|\d+\s*명|담당|님|에게|이\s*사용|가\s*사용|들고|번갈아)/;
export const FD_RE = /(옮겨|배치|설치|치워|치우|전달|세팅|셋팅|이동|회수|건네|꽂아|정리|준비)/;
export const INSTRUMENT_RE = /(기타|카혼|피아노|건반|키보드|바이올린|첼로|드럼|베이스|우쿨렐레|플룻|플루트|색소폰|트럼펫|탬버린|젬베)/;
export const SOUND_NONE_RE = /^(x|X|없음|마이크\s*사용\s*x|사용\s*안\s*함|-|영상\s*음향(?:\s*필요)?|영상\s*음원)$/i;

// 화면
export const SCREEN_HINT_RE = /(영상|PPT|ppt|피피티|가사|화면|슬라이드|로고|자막|X|x|없음|검은)/;

// 영상 행 판단
export const VIDEO_ITEM_RE = /(영상|video|vcr)/i;
export const STAGE_ITEM_RE = /(무대|트랜지션|트렌지션|퍼포먼스|공연|곡|노래|stage)/i;
export const HOST_ITEM_RE = /(학부\s*소개|투표|사회자)/;
export const INTRO_ITEM_RE = /(인트로\s*영상|학부\s*인트로)/;

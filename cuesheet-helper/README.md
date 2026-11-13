# HANFLIX 큐시트 체크 (2026 학부합창대회)

학부 무대 큐시트를 넣으면 **항목별 피드백**을 주고, 고칠 수 있는 부분은 직접 고쳐 **2026 2차 큐시트 양식 그대로 수정본(.xlsx)** 을 만들어 주는 웹사이트입니다. 디자인은 대회 로고(HANFLIX, #0060D1 파랑 · 검정→남색)를 따릅니다.

- 배포 주소: https://cuesheet-feedback-2026.netlify.app
- Netlify 프로젝트: `cuesheet-feedback-2026` (운영 주소 공개, 미리보기 배포는 Netlify 팀 로그인 필요)

## 화면 구성

| 주소 | 화면 |
|---|---|
| `#/` | 홈 — 구글 시트 링크 입력과 '시작하기'만. 링크가 안 되면 아래 '표를 복사해서 붙여넣기'(불러오기에 실패하면 자동으로 열림) |
| `#/check/{time,stage,detail,lyrics,sound,screen,light,form}` | 항목별 — 고칠 것(펼쳐서 바로 수정), 자동으로 고친 것(끄기 가능), 그 항목 열만 보는 표. Run Time에는 무대 시간(11분 기준선) 막대 |
| `#/check` | 마지막으로 본 항목(없으면 고칠 것이 있는 첫 항목)으로 이동 — 상단 '점검' 메뉴 |
| `#/sheet` | 전체 표 — 수정본/원본, 칸 바로 수정, 행 추가·삭제 |
| `#/download` | 남은 필수·권장 개수와 제출 가능 여부, 수정본 엑셀, 검토용 엑셀, 구글 시트 붙여넣기용 복사, 피드백 메시지 복사 |
| `#/guide`, `#/guide/{basic,time,content,sound,light,check}`, `#/example` | 주제별 짧은 가이드, 모범 예시 |

결과 요약 화면은 따로 없습니다. 큐시트를 불러오면 고칠 것이 있는 첫 항목(필수 → 권장 순)으로 바로 이동하고, 고칠 것이 없으면 수정본 받기로 갑니다. 위쪽 탭 줄 맨 앞에는 지금 점검 중인 학부(탭) 이름이 고정되어 있고, 그 옆에 항목별 남은 개수가 보입니다. 홈으로 갔다가 돌아올 때는 상단 '점검' 메뉴를 씁니다. 예전 주소 `#/report`는 `#/check`로 넘어갑니다.

불러온 큐시트는 브라우저 탭(sessionStorage)에만 남고, 새로고침해도 이어서 볼 수 있습니다.

## 점검 기준

| 기준 자료 | 반영 내용 |
|---|---|
| 2026 2차 큐시트 양식(4행 붉은 안내) | 열 구성 A~P, 빈칸 금지(X/유지), 총 13분 = 인트로 2분 + 무대 11분, 글꼴·크기·색·병합·틀 고정 |
| 학부 디렉터 OT '무대 큐시트 작성 예시' | Run Time `00:00 ~ 00:04 (4초)`, 무대·대기 인원·세부 내용(언제·어디서·누가·무엇을·어떻게), 개사(Run Time에 맞춰), 음향/FD, 화면, 공통 항목 셀 병합 |
| 2026 조명 큐시트 작성 가이드 | 무대·상단 = 구역/색상/밝기, Pin1~4 = 색 변경 불가·위치 고정·1명용, FX1·FX2 2개만(Details에), 전환 방식·영상 시간 기준·객관적 시점 |
| 2025·2026 공시 큐시트 | 모범 작성 방식. 2025는 음향/FD만 참고 |
| 2026 2차 TFT 피드백 메모 | 단시·Runtime 분리, 조명 시간 Run Time 맞추기, 조명 X 표시, 논의 중 표시, 양식 유지 |

실제 학부 큐시트 내용은 사이트에 넣지 않았습니다. 예시는 모두 가상 학부입니다.

## 구조

```
public/                 정적 사이트 (Netlify publish)
  index.html            상단 바 + 화면 틀
  assets/js/app.js      해시 라우팅과 각 화면
  assets/js/ui/         아이콘·HANFLIX 워드마크, 표 그리기, 가이드 내용
  assets/js/engine/     분석·자동 수정 엔진 (브라우저와 Node 공용)
  assets/js/io/         구글 시트 xlsx 읽기, 붙여넣기, 엑셀·구글 시트용 내보내기
netlify/functions/
  sheet.mts             공개 구글 시트를 내려받아 전달 (/api/sheet)
  ai-review.mts         (선택) Claude로 문장·조명 대안 (/api/ai-review)
tests/engine.test.mjs   npm test
```

## AI 대안 기능 켜기 (선택)

규칙 기반 피드백과 수정본은 API 키 없이 동작합니다. Netlify 프로젝트 설정 → Environment variables에 `ANTHROPIC_API_KEY`(범위: Functions)를 넣고 다시 배포하면 위쪽 탭 줄에 'AI 대안'이 나타납니다. 모델은 `claude-opus-5-5`, 서버 측 대체 모델(`fallbacks: "default"`)을 켜 두었습니다. AI를 쓰면 무대별 큐시트 내용이 Anthropic API로 전송됩니다.

## 다시 배포

`cuesheet-helper` 폴더에서 Netlify CLI(`netlify deploy --prod`)나 Netlify MCP 배포 명령을 실행합니다. 빌드 명령은 없고 `public`을 그대로 올리며, 함수는 Netlify가 묶어서 배포합니다.

## 테스트

```bash
npm install
npm test
```

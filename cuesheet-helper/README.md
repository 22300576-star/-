# 큐시트 피드백 도우미 (2026 학부합창대회)

학부 무대 큐시트를 넣으면 **피드백·대안**을 주고, 고칠 수 있는 부분은 직접 고쳐 **2026 2차 큐시트 양식 그대로 수정본(.xlsx)** 을 만들어 주는 웹사이트입니다.

- 배포 주소: https://cuesheet-feedback-2026.netlify.app
- Netlify 프로젝트: `cuesheet-feedback-2026` (운영 주소는 공개, 미리보기 배포는 Netlify 팀 로그인 필요)

## 점검 기준

| 기준 자료 | 반영 내용 |
|---|---|
| 2026 2차 큐시트 양식(4행 붉은 안내) | 열 구성 A~P, 빈칸 금지(X/유지), 총 13분 = 인트로 2분 + 무대 11분, 글꼴·크기·색·병합·틀 고정 |
| 학부 디렉터 OT '무대 큐시트 작성 예시' | Run Time `00:00 ~ 00:04 (4초)`, 무대·대기 인원·세부 내용(언제·어디서·누가·무엇을·어떻게), 개사(Run Time에 맞춰), 음향/FD(장비·누가·언제·어떻게), 화면, 공통 항목 셀 병합 |
| 2026 조명 큐시트 작성 가이드 | 무대·상단 = 구역/색상/밝기, Pin1~4 = 색 변경 불가·위치 고정·1명용, FX1·FX2 2개만(Details에), 전환 방식·영상 시간 기준·객관적 시점 |
| 2025·2026 공시 큐시트 | 모범 작성 방식(행 분리, 조명 '유지', 영상 행 암전, 음향 FD 지시). 2025는 음향/FD만 참고 |
| 2026 2차 TFT 피드백 메모 | 단시·Runtime 분리, 조명 시간 Run Time 맞추기, 조명 X 표시, 논의 중 표시, 양식 유지 |

실제 학부 큐시트 내용은 사이트에 넣지 않았습니다. 예시는 모두 가상 학부입니다.

## 구조

```
public/                 정적 사이트 (Netlify publish)
  index.html            피드백 받기 / 작성 가이드 / 모범 예시
  assets/js/engine/     분석·자동 수정 엔진 (브라우저와 Node 공용)
    parser.js           표 → 큐시트 모델 (머리글·병합·2025 양식 인식)
    rules-time.js       Run Time 규칙 (기준 시점, 단시, 끊김·겹침, 11분)
    rules-light.js      조명 규칙 (구역/색상/밝기, Pin, FX, 조명 시간 ↔ Run Time 정렬)
    rules-content.js    무대·대기·세부·개사·음향/FD·화면·양식 규칙
    analyze.js          실행 순서, summary.js 점수·TFT 피드백 문구
  assets/js/io/         엑셀 읽기/쓰기(ExcelJS), 붙여넣기, 구글 시트용 복사
netlify/functions/
  sheet.mts             공개 구글 시트를 .xlsx로 내려받아 전달 (/api/sheet)
  ai-review.mts         (선택) Claude로 문장·조명 대안 (/api/ai-review)
tests/engine.test.mjs   npm test
```

## AI 대안 기능 켜기 (선택)

규칙 기반 피드백과 수정본은 API 키 없이 동작합니다. 'AI로 문장·조명 대안 받기'를 쓰려면 Netlify 프로젝트 설정 → Environment variables에 `ANTHROPIC_API_KEY`(범위: Functions)를 넣고 다시 배포하세요. 모델은 `claude-opus-5-5`, 서버 측 대체 모델(`fallbacks: "default"`)을 켜 두었습니다. AI를 쓰면 해당 블록의 큐시트 내용이 Anthropic API로 전송되며, 사이트가 사용 전에 확인을 받습니다.

## 다시 배포

`cuesheet-helper` 폴더에서 Netlify CLI(`netlify deploy --prod`)나 Netlify MCP 배포 명령을 실행합니다. 빌드 명령은 없고 `public`을 그대로 올리며, 함수는 Netlify가 묶어서 배포합니다.

## 테스트

```bash
npm install
npm test
```

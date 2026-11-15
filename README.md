# Synchro 100 — 이심전심 타임어택 파티 게임

## 실행
```bash
npm install
npm start
```
- **호스트(TV/빔프로젝터)**: `http://localhost:3000/host`
- **참가자(휴대폰)**: 호스트 화면의 QR 또는 `http://<노트북 IP>:3000` (같은 Wi-Fi)
- 혼자 테스트할 때: `node bots.js 8` → 가상 참가자 8명 접속

## 규칙
1. 제시어가 뜨면 15초 안에 단어 1개 제출 (라운드당 1회)
2. 점수 = **같은 단어 입력자 수 × 제출 시점 잔여 초 × 10**
3. 혼자만 쓴 단어는 0점 (`server.js`의 `MIN_MATCH`를 1로 바꾸면 혼자여도 득점)
4. 라운드 종료 → TOP 3 단어 팝업 → 리더보드 갱신 → 10초 후 자동으로 다음 라운드
5. 전원이 제출하면 타이머를 기다리지 않고 바로 종료

단어 비교는 공백·문장부호·대소문자를 무시합니다 (`교 촌` = `교촌`, `BHC` = `bhc`).

## 설정 (`server.js` 상단 `CFG`, `PROMPTS`)
라운드 수, 제한 시간, 결과 노출 시간, 초당 점수, 제시어 목록을 바꿀 수 있습니다.

## 구조
- `server.js` — Node HTTP + WebSocket(ws) 서버, 게임 상태·타이머·점수 계산을 서버가 단독으로 관리
- `public/host.html` — 메인 화면 (로비/QR, 카운트다운, 결과 포디움, 실시간 리더보드, 건너뛰기/리셋)
- `public/player.html` — 참가자 화면 (닉네임 입장, 타이머, 입력창, 내 순위·누적 점수, 새로고침해도 재접속 유지)
- `public/common.js`, `public/style.css` — 공용 소켓/시간 보정, 스타일
- `bots.js` — 테스트용 가상 참가자

## Render 배포 (카톡 링크로 플레이)
1. GitHub에 새 저장소를 만들고 이 폴더를 push
2. [Render](https://render.com) → **New + → Blueprint** → 저장소 선택 → `render.yaml` 설정 그대로 **Apply**
3. 배포가 끝나면 `https://<서비스명>.onrender.com/host` 를 열고 **🔗 링크 복사** → 카톡 단톡방에 붙여넣기

- 공개 주소는 Render가 넣어주는 `RENDER_EXTERNAL_URL`을 자동으로 사용합니다 (QR·링크·카톡 미리보기 모두 이 주소로 바뀜). 커스텀 도메인을 쓰면 환경변수 `PUBLIC_URL`에 넣으세요.
- 무료 플랜은 15분 동안 접속이 없으면 잠듭니다. 게임 시작 1~2분 전에 호스트 화면을 먼저 열어 깨워두세요. 서버가 재시작되면 진행 중이던 점수는 초기화됩니다.
- 카톡 미리보기가 예전 모습으로 나오면 [카카오 공유 디버거](https://developers.kakao.com/tool/debugger/sharing)에서 주소를 넣고 캐시를 초기화하세요.

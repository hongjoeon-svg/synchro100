// 테스트용 가상 참가자: node bots.js [인원수=8] [서버주소=ws://localhost:3000]
const WebSocket = require('ws');
const N = Number(process.argv[2]) || 8;
const URL = process.argv[3] || `ws://localhost:${process.env.PORT || 3000}`;
const NAMES = ['민지', '도윤', '서연', '하준', '지우', '예준', '수아', '시우', '하은', '주원', '채원', '지호'];
const WORDS = ['교촌', 'bhc', '노래방', '치킨', '커피', '집', '맥주', '라면', '제주도', '아아', '떡볶이', '잠'];

for (let i = 0; i < N; i++) {
  const ws = new WebSocket(URL);
  let round = -1;
  ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name: `${NAMES[i % NAMES.length]}${i >= NAMES.length ? i : ''}봇` })));
  ws.on('message', (raw) => {
    const s = JSON.parse(raw);
    if (s.t === 'state' && s.phase === 'input' && s.round !== round) {
      round = s.round;
      // 앞쪽 단어일수록 자주 고르도록 → 싱크가 생김
      const word = WORDS[Math.floor(Math.random() ** 2 * 6)];
      setTimeout(() => ws.send(JSON.stringify({ t: 'submit', word })), 1500 + Math.random() * 11000);
    }
  });
}
console.log(`${N}명의 봇이 ${URL} 에 접속했어요. Ctrl+C로 종료`);

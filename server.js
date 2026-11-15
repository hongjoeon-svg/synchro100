// Synchro 100 — 이심전심 타임어택 파티 게임 서버
// 실행: npm install && npm start  →  호스트: http://<IP>:3000/host  /  참가자: http://<IP>:3000
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT) || 3000;

// ───────── 게임 설정 ─────────
const CFG = {
  READY_SEC: 3,        // 라운드 시작 전 "준비" 카운트
  ROUND_SEC: 15,       // 입력 제한 시간
  RESULT_SEC: 10,      // 결과 팝업 + 리더보드 노출 시간 → 이후 자동으로 다음 라운드
  TOTAL_ROUNDS: 10,
  POINT_PER_SEC: 10,   // 잔여 1초당 +10점
  MIN_MATCH: 2,        // 최소 몇 명이 같은 단어를 써야 득점하는지 (1로 바꾸면 혼자 써도 득점)
};

const PROMPTS = [
  '치킨 하면 떠오르는 브랜드',
  '회식 2차로 가장 많이 가는 곳',
  '월요일 아침에 드는 생각 한 단어',
  '편의점에서 제일 먼저 집는 것',
  '첫 월급으로 사고 싶은 것',
  '여름휴가 국내 여행지',
  '야식 메뉴 하나',
  '노래방 첫 곡 장르 / 가수',
  '퇴근 후 가장 먼저 하는 일',
  '소개팅에서 가장 중요한 것',
  '카페에서 주문하는 음료',
  '로또 1등 되면 제일 먼저 할 일',
  '해장 음식 하나',
  '겨울 하면 떠오르는 간식',
  '단톡방에서 제일 많이 쓰는 이모티콘 느낌',
  '주말에 꼭 하는 일',
  '이 모임을 한 단어로 표현하면',
  '가장 많이 쓰는 배달 앱 메뉴 카테고리',
  'MBTI 중 가장 친해지고 싶은 유형',
  '여행 갈 때 꼭 챙기는 물건',
];

// ───────── 상태 ─────────
const players = new Map(); // id -> { id, name, score, ws, connected, answer, norm, rem, lastGain, lastMatch, joinedAt }
const hosts = new Set();
const game = {
  phase: 'lobby', // lobby | ready | input | result | final
  round: 0,
  prompt: '',
  endsAt: 0,
  results: [],     // 이번 라운드 상위 단어
  usedPrompts: [],
};
let timer = null;

const normalize = (w) => String(w || '').normalize('NFC').toLowerCase().replace(/[\s.,!?~'"`·\-_]/g, '').slice(0, 30);
const uid = () => Math.random().toString(36).slice(2, 10);

function pickPrompt() {
  const pool = PROMPTS.filter((p) => !game.usedPrompts.includes(p));
  const p = (pool.length ? pool : PROMPTS)[Math.floor(Math.random() * (pool.length || PROMPTS.length))];
  game.usedPrompts.push(p);
  return p;
}

function leaderboard() {
  return [...players.values()]
    .sort((a, b) => b.score - a.score || a.joinedAt - b.joinedAt)
    .map((p, i, arr) => ({
      id: p.id,
      name: p.name,
      score: p.score,
      gain: p.lastGain,
      match: p.lastMatch,
      connected: p.connected,
      submitted: !!p.answer,
      // 동점자는 같은 순위
      rank: i > 0 && arr[i - 1].score === p.score ? null : i + 1,
    }))
    .map((row, i, arr) => {
      if (row.rank === null) row.rank = arr.slice(0, i).reverse().find((r) => r.rank !== null).rank;
      return row;
    });
}

function publicState() {
  const list = [...players.values()];
  return {
    t: 'state',
    phase: game.phase,
    round: game.round,
    totalRounds: CFG.TOTAL_ROUNDS,
    roundSec: CFG.ROUND_SEC,
    prompt: game.phase === 'ready' ? '' : game.prompt,
    endsAt: game.endsAt,
    serverNow: Date.now(),
    playerCount: list.filter((p) => p.connected).length,
    submittedCount: list.filter((p) => p.answer).length,
    results: game.phase === 'result' || game.phase === 'final' ? game.results : [],
    leaderboard: leaderboard(),
    joinUrl: joinUrl(),
  };
}

function send(ws, msg) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function broadcast() {
  const state = publicState();
  const raw = JSON.stringify(state);
  hosts.forEach((ws) => ws.readyState === 1 && ws.send(raw));
  for (const p of players.values()) {
    if (!p.connected) continue;
    send(p.ws, { ...state, me: { id: p.id, name: p.name, score: p.score, answer: p.answer, rem: p.rem, gain: p.lastGain, match: p.lastMatch } });
  }
}

// ───────── 라운드 진행 ─────────
function schedule(sec, fn) {
  clearTimeout(timer);
  game.endsAt = Date.now() + sec * 1000;
  timer = setTimeout(fn, sec * 1000);
}

function startRound() {
  game.round += 1;
  game.prompt = pickPrompt();
  game.results = [];
  for (const p of players.values()) {
    p.answer = '';
    p.norm = '';
    p.rem = 0;
    p.lastGain = 0;
    p.lastMatch = 0;
  }
  game.phase = 'ready';
  schedule(CFG.READY_SEC, openInput);
  broadcast();
}

function openInput() {
  game.phase = 'input';
  schedule(CFG.ROUND_SEC, endRound);
  broadcast();
}

function endRound() {
  clearTimeout(timer);
  const groups = new Map();
  for (const p of players.values()) {
    if (!p.norm) continue;
    if (!groups.has(p.norm)) groups.set(p.norm, { word: p.answer, users: [], firstAt: p.submittedAt });
    const g = groups.get(p.norm);
    g.users.push(p);
    g.firstAt = Math.min(g.firstAt, p.submittedAt);
  }

  // 점수: 동일 단어 입력자 수 × 잔여 초 × 10
  for (const g of groups.values()) {
    const n = g.users.length;
    for (const p of g.users) {
      p.lastMatch = n;
      p.lastGain = n >= CFG.MIN_MATCH ? n * p.rem * CFG.POINT_PER_SEC : 0;
      p.score += p.lastGain;
    }
  }

  game.results = [...groups.values()]
    .sort((a, b) => b.users.length - a.users.length || a.firstAt - b.firstAt)
    .slice(0, 3)
    .map((g) => ({
      word: g.word,
      count: g.users.length,
      names: g.users.map((u) => u.name),
      points: g.users.reduce((s, u) => s + u.lastGain, 0),
    }));

  game.phase = 'result';
  const isLast = game.round >= CFG.TOTAL_ROUNDS;
  schedule(CFG.RESULT_SEC, () => {
    if (isLast) {
      game.phase = 'final';
      game.endsAt = 0;
      broadcast();
    } else startRound();
  });
  broadcast();
}

function resetGame() {
  clearTimeout(timer);
  Object.assign(game, { phase: 'lobby', round: 0, prompt: '', endsAt: 0, results: [], usedPrompts: [] });
  for (const [id, p] of players) {
    if (!p.connected) players.delete(id);
    else Object.assign(p, { score: 0, answer: '', norm: '', rem: 0, lastGain: 0, lastMatch: 0 });
  }
  broadcast();
}

// ───────── 메시지 처리 ─────────
function onMessage(ws, msg) {
  switch (msg.t) {
    case 'host':
      ws.role = 'host';
      hosts.add(ws);
      send(ws, publicState());
      break;

    case 'join': {
      const name = String(msg.name || '').trim().slice(0, 12);
      if (!name) return send(ws, { t: 'error', msg: '닉네임을 입력해 주세요.' });
      let p = msg.id && players.get(msg.id);
      if (p) {
        // 재접속
        if (p.ws && p.ws !== ws) try { p.ws.close(); } catch {}
      } else {
        const dup = [...players.values()].some((x) => x.name === name && x.connected);
        if (dup) return send(ws, { t: 'error', msg: '이미 사용 중인 닉네임이에요.' });
        p = { id: uid(), name, score: 0, answer: '', norm: '', rem: 0, lastGain: 0, lastMatch: 0, joinedAt: Date.now() };
        players.set(p.id, p);
      }
      p.ws = ws;
      p.connected = true;
      ws.role = 'player';
      ws.playerId = p.id;
      send(ws, { t: 'joined', id: p.id, name: p.name });
      broadcast();
      break;
    }

    case 'submit': {
      const p = players.get(ws.playerId);
      if (!p || game.phase !== 'input' || p.answer) return;
      const word = String(msg.word || '').trim().slice(0, 20);
      const norm = normalize(word);
      if (!norm) return send(ws, { t: 'error', msg: '단어를 입력해 주세요.' });
      const now = Date.now();
      p.answer = word;
      p.norm = norm;
      p.submittedAt = now;
      p.rem = Math.max(0, Math.min(CFG.ROUND_SEC, Math.ceil((game.endsAt - now) / 1000)));
      broadcast();
      // 접속 중인 전원이 제출하면 바로 라운드 종료
      const active = [...players.values()].filter((x) => x.connected);
      if (active.length && active.every((x) => x.answer)) setTimeout(() => game.phase === 'input' && endRound(), 600);
      break;
    }

    // 호스트 전용 제어
    case 'start':
      if (ws.role === 'host' && (game.phase === 'lobby' || game.phase === 'final')) {
        if (game.phase === 'final') resetGame();
        startRound();
      }
      break;
    case 'skip':
      if (ws.role !== 'host') break;
      if (game.phase === 'input') endRound();
      else if (game.phase === 'result') {
        clearTimeout(timer);
        if (game.round >= CFG.TOTAL_ROUNDS) { game.phase = 'final'; broadcast(); } else startRound();
      }
      break;
    case 'reset':
      if (ws.role === 'host') resetGame();
      break;
    case 'kick':
      if (ws.role === 'host' && players.has(msg.id)) {
        const p = players.get(msg.id);
        send(p.ws, { t: 'kicked' });
        players.delete(msg.id);
        broadcast();
      }
      break;
  }
}

// ───────── HTTP + WebSocket ─────────
function lanIp() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const i of list || []) if (i.family === 'IPv4' && !i.internal) return i.address;
  }
  return 'localhost';
}
// 공개 주소: PUBLIC_URL(직접 지정) > RENDER_EXTERNAL_URL(Render가 자동 주입) > 같은 Wi-Fi용 LAN 주소
const PUBLIC_URL = (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');
const joinUrl = () => PUBLIC_URL || `http://${lanIp()}:${PORT}`;
// HTML 안의 og:image 등은 절대 주소가 필요 → 요청 Host 기준으로 채움
const baseUrl = (req) => {
  if (PUBLIC_URL) return PUBLIC_URL;
  const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
  return `${proto}://${String(req.headers.host || 'localhost').replace(/[^\w.:\-\[\]]/g, '')}`;
};

const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const server = http.createServer((req, res) => {
  let url = req.url.split('?')[0];
  if (url === '/') url = '/player.html';
  if (url === '/host') url = '/host.html';
  if (url === '/healthz') { res.writeHead(200); return res.end('ok'); }
  const file = path.join(__dirname, 'public', path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    const ext = path.extname(file);
    if (ext === '.html') data = data.toString().replaceAll('__BASE_URL__', baseUrl(req));
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.png' ? 'public, max-age=86400' : 'no-cache',
    });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));
  ws.on('message', (raw) => {
    try { onMessage(ws, JSON.parse(raw)); } catch (e) { console.error('bad message', e.message); }
  });
  ws.on('close', () => {
    hosts.delete(ws);
    const p = players.get(ws.playerId);
    if (p && p.ws === ws) {
      p.connected = false;
      if (game.phase === 'lobby') players.delete(p.id);
      broadcast();
    }
  });
});
setInterval(() => wss.clients.forEach((ws) => {
  if (!ws.isAlive) return ws.terminate();
  ws.isAlive = false;
  ws.ping();
}), 15000);

server.listen(PORT, () => {
  console.log(`\n  Synchro 100 서버 실행 중`);
  console.log(`  ▶ 호스트 화면 : ${PUBLIC_URL || `http://localhost:${PORT}`}/host`);
  console.log(`  ▶ 참가자 접속 : ${joinUrl()}${PUBLIC_URL ? '' : '  (같은 Wi-Fi)'}\n`);
});

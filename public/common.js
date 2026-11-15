// 공용: 자동 재연결 웹소켓 + 서버 시간 보정 + 유틸
window.S100 = (() => {
  let ws, offset = 0, handlers = {}, onOpen = () => {};
  const listeners = (t, fn) => (handlers[t] = fn);

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    ws = new WebSocket(`${proto}://${location.host}`);
    ws.onopen = () => { setConn(true); onOpen(); };
    ws.onclose = () => { setConn(false); setTimeout(connect, 1200); };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.serverNow) offset = msg.serverNow - Date.now();
      (handlers[msg.t] || (() => {}))(msg);
    };
  }
  function setConn(ok) {
    const el = document.getElementById('conn');
    if (el) el.classList.toggle('off', !ok);
  }
  const send = (msg) => ws && ws.readyState === 1 && ws.send(JSON.stringify(msg));
  const now = () => Date.now() + offset;
  const remaining = (endsAt) => Math.max(0, (endsAt - now()) / 1000);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  return {
    start(openFn) { onOpen = openFn || onOpen; connect(); },
    on: listeners, send, now, remaining, esc,
  };
})();

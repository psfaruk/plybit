// Quick connection test — see if WS auth still works with current token
import WebSocket from 'ws';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

console.log(`Token: ${TOKEN.slice(0, 8)}…`);
console.log(`Cookies: ${COOKIES.length} chars\n`);

const ws = new WebSocket('wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket', {
  headers: { 'User-Agent': UA, 'Origin': 'https://market-qx.trade', 'Cookie': COOKIES },
  handshakeTimeout: 6000,
});

let sioConnected = false;
let msgCount = 0;
ws.on('open', () => { console.log('OPEN'); ws.send('40'); });
ws.on('message', (d, isBin) => {
  msgCount++;
  const raw = isBin ? '<binary>' : d.toString();
  console.log(`[${msgCount}] ${raw.slice(0, 200)}`);
  if (raw === '40' && !sioConnected) {
    sioConnected = true;
    console.log('→ sending auth');
    ws.send(`42${JSON.stringify(['authorization', { session: TOKEN, isDemo: 0, tournamentId: 0 }])}`);
  }
  if (raw.startsWith('42')) {
    try {
      const arr = JSON.parse(raw.slice(2));
      if (arr[0] === 's_authorization') console.log('✓ AUTH SUCCESS');
      if (arr[0] === 'authorization/reject' || arr[0] === 's_authorization/reject') console.log('✗ AUTH REJECTED');
    } catch {}
  }
});
ws.on('error', e => console.log('ERR:', e.message));
ws.on('close', (c, r) => console.log(`CLOSE: ${c} ${(r?.toString?.() || '').slice(0, 100)}`));
setTimeout(() => { ws.close(); process.exit(0); }, 8000);

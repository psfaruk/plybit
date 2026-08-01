// Diagnostic 2: try fetching qxbroker.com homepage first to get cookies,
// then use those cookies in the WebSocket handshake.
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

// Step 1: HTTP GET to https://qxbroker.com/ — collect cookies
console.log('Step 1: fetching https://qxbroker.com/ for cookies...');
const httpResp = await fetch('https://qxbroker.com/', {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cookie': `session_id=${TOKEN}`,
  },
  redirect: 'manual',
});
console.log('  HTTP status:', httpResp.status);
const setCookies = httpResp.headers.getSetCookie?.() || [];
console.log('  Set-Cookie count:', setCookies.length);
for (const c of setCookies.slice(0, 5)) console.log('  cookie:', c.slice(0, 120));
const cookieJar = setCookies.map(c => c.split(';')[0]).join('; ');
console.log('  final cookie jar:', cookieJar.slice(0, 200));

// Step 2: WebSocket connect WITH cookies
console.log('\nStep 2: WSS connect with cookies...');
const wsUrl = 'wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket';
const ws = new WebSocket(wsUrl, {
  headers: {
    'User-Agent': UA,
    'Origin': 'https://qxbroker.com',
    'Cookie': `session_id=${TOKEN}` + (cookieJar ? `; ${cookieJar}` : ''),
  },
  handshakeTimeout: 8000,
});

let msgCount = 0;
ws.on('open', () => {
  console.log('  OPEN');
  ws.send('40');
});

ws.on('message', (data) => {
  const raw = data.toString();
  msgCount++;
  console.log(`  MSG[${msgCount}]:`, raw.slice(0, 250));
  if (raw === '40' && msgCount === 2) {
    setTimeout(() => {
      console.log('  → sending auth');
      ws.send(`42["authorization",{"ssid":"session_id=${TOKEN}","device_id":"${randomUUID()}","user_agent":"${UA}","version":"2.7.0","language":"en"}]`);
    }, 300);
  }
});

ws.on('error', e => console.log('  ERR:', e.message));
ws.on('close', (c, r) => console.log('  CLOSE:', c, r.toString().slice(0, 200)));

setTimeout(() => { ws.close(); process.exit(0); }, 10000);

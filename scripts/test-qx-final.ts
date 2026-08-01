// Final investigation — what's at /api/v1/access and what does the /en/trade page expose?

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

const headers = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Cookie': `session_id=${TOKEN}`,
  'Origin': 'https://qxbroker.com',
  'Referer': 'https://qxbroker.com/',
};

// 1. Check /api/v1/access — what does it say?
console.log('=== GET /api/v1/access ===');
const r1 = await fetch('https://qxbroker.com/api/v1/access', { headers, redirect: 'manual' });
console.log('status:', r1.status);
console.log('body:', (await r1.text()).slice(0, 500));

// 2. POST login attempt — maybe Quotex uses HTTP login first to obtain a fresh session
console.log('\n=== POST /api/v1/login ===');
const r2 = await fetch('https://qxbroker.com/api/v1/login', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ssid: `session_id=${TOKEN}` }),
});
console.log('status:', r2.status);
console.log('body:', (await r2.text()).slice(0, 500));

// 3. Try POST /api/v1/access with ssid
console.log('\n=== POST /api/v1/access ===');
const r3 = await fetch('https://qxbroker.com/api/v1/access', {
  method: 'POST',
  headers: { ...headers, 'Content-Type': 'application/json' },
  body: JSON.stringify({ ssid: `session_id=${TOKEN}` }),
});
console.log('status:', r3.status);
console.log('body:', (await r3.text()).slice(0, 500));

// 4. Fetch the /en/trade page and look for embedded tokens/config (CSRF, app config, etc.)
console.log('\n=== GET /en/trade (looking for embedded config) ===');
const r4 = await fetch('https://qxbroker.com/en/trade', { headers });
const html = await r4.text();
console.log('status:', r4.status, 'length:', html.length);

// Look for embedded JS config
const tokenMatches = html.match(/["']?(?:token|ssid|session|api_token|auth_token)["']?\s*[:=]\s*["']([^"']{20,200})["']/gi) || [];
console.log('found token-like matches:', tokenMatches.slice(0, 5));

const socketMatches = html.match(/wss?:\/\/[^"'\s<>]+/gi) || [];
console.log('found WS URLs:', socketMatches.slice(0, 5));

const configMatches = html.match(/window\.\w+\s*=\s*({[^;]{10,300}})/g) || [];
console.log('found window config:', configMatches.slice(0, 3));

// 5. Check what cookies the /en/trade page sets
console.log('\n=== Cookies set by /en/trade ===');
const setCookies = r4.headers.getSetCookie?.() || [];
for (const c of setCookies) console.log('  ', c.slice(0, 100));

// 6. Try the WebSocket with all the cookies we have
console.log('\n=== WSS connect with full cookie jar ===');
const allCookies = [`session_id=${TOKEN}`];
for (const c of setCookies) {
  const kv = c.split(';')[0];
  if (kv && !kv.includes('=deleted') && !kv.startsWith('referer=')) {
    allCookies.push(kv);
  }
}
console.log('  cookie jar:', allCookies.join('; ').slice(0, 200));

import WebSocket from 'ws';
const ws = new WebSocket('wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket', {
  headers: {
    'User-Agent': UA,
    'Origin': 'https://qxbroker.com',
    'Cookie': allCookies.join('; '),
  },
  handshakeTimeout: 6000,
});

await new Promise<void>((resolve) => {
  const t = setTimeout(() => { try { ws.close(); } catch {}; resolve(); }, 7000);
  ws.on('open', () => { console.log('  WS OPEN ✓'); ws.send('40'); });
  ws.on('message', (d) => {
    const s = d.toString();
    console.log('  WS MSG:', s.slice(0, 250));
    if (s === '40') {
      console.log('  → sending auth with full cookies in ssid field');
      const auth = `42${JSON.stringify(['authorization', {
        ssid: allCookies.join('; '),
        device_id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
        user_agent: UA,
        version: '2.7.0',
        language: 'en',
      }])}`;
      ws.send(auth);
    }
    if (s.startsWith('42')) {
      const arr = JSON.parse(s.slice(2));
      console.log('  EVENT:', arr[0], JSON.stringify(arr[1] || {}).slice(0, 200));
    }
  });
  ws.on('close', (c, r) => {
    console.log('  WS CLOSE:', c, (r?.toString?.() || '').slice(0, 100));
    clearTimeout(t); resolve();
  });
  ws.on('error', (e) => { console.log('  WS ERR:', e.message); clearTimeout(t); resolve(); });
});

process.exit(0);

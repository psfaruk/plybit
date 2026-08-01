// Try auth with CSRF token — fetch CSRF first, then use it in WS auth.

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';

console.log('Step 1: Fetch /en/trade to extract CSRF token');
const tradeResp = await fetch('https://market-qx.trade/en/trade', {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html',
    'Cookie': COOKIES,
    'Referer': 'https://market-qx.trade/',
  },
});
const tradeHtml = await tradeResp.text();
const csrfMatch = tradeHtml.match(/"csrf":"([^"]+)"/);
const csrf = csrfMatch?.[1];
console.log(`  CSRF token: ${csrf}`);

if (!csrf) {
  console.log('  ✗ Could not extract CSRF token');
  process.exit(1);
}

// Update cookie jar with any new cookies from this response
let updatedCookies = COOKIES;
const setCookies = tradeResp.headers.getSetCookie?.() || [];
for (const c of setCookies) {
  const kv = c.split(';')[0];
  if (kv && !kv.includes('=deleted')) {
    const key = kv.split('=')[0];
    // Replace existing or add
    const regex = new RegExp(`\\b${key}=[^;]+;?\\s*`, 'g');
    updatedCookies = updatedCookies.replace(regex, '');
    updatedCookies = `${updatedCookies}; ${kv}`.replace(/^;\s*/, '');
  }
}

console.log('\nStep 2: Connect WebSocket');
const ws = new WebSocket(URL, {
  headers: {
    'User-Agent': UA,
    'Origin': 'https://market-qx.trade',
    'Cookie': updatedCookies,
  },
  handshakeTimeout: 6000,
});

let sioConnected = false;

ws.on('open', () => {
  console.log('  OPEN ✓');
  ws.send('40');
});

ws.on('message', (data) => {
  const raw = data.toString();
  console.log(`  MSG: ${raw.slice(0, 250)}`);

  if (raw === '40' && !sioConnected) {
    sioConnected = true;
    console.log('  → sending auth WITH CSRF token');

    // Try various auth formats with CSRF
    const authPayloads = [
      // v1: with _csrf field
      {
        ssid: COOKIES,
        _csrf: csrf,
        csrf: csrf,
        csrf_token: csrf,
        device_id: randomUUID(),
        user_agent: UA,
        version: '2.7.0',
        language: 'en',
      },
    ];

    const msg = `42${JSON.stringify(['authorization', authPayloads[0]])}`;
    console.log(`  → ${msg.slice(0, 200)}…`);
    ws.send(msg);
  }

  if (raw.startsWith('42')) {
    try {
      const arr = JSON.parse(raw.slice(2));
      if (Array.isArray(arr)) {
        console.log(`  EVENT: ${arr[0]} — ${JSON.stringify(arr[1] || {}).slice(0, 200)}`);
      }
    } catch {}
  }
  if (raw === '41') {
    console.log('  ✗ DISCONNECT');
  }
});

ws.on('error', (e) => console.log('  ERR:', e.message));
ws.on('close', (c, r) => {
  console.log(`  CLOSE: ${c} ${(r?.toString?.() || '').slice(0, 100)}`);
  if (c !== 1000 || !sioConnected) {
    // Try without CSRF — bare session_id from cookie
    console.log('\nStep 3: Try bare session_id format (extract from cookies)');
    // Maybe ssid should be just the laravel_session value
    const lsMatch = COOKIES.match(/laravel_session=([^;]+)/);
    const lsVal = lsMatch?.[1] || '';
    console.log(`  laravel_session value (first 50): ${lsVal.slice(0, 50)}…`);
    // Or maybe ssid should be a string like "auth_session=..." that the server issues
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 7000);

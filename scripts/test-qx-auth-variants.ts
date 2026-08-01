// Try many Quotex auth message variants to find which one the server accepts.
// A "success" is when we receive 42["authorization",{...account data...}] BEFORE
// a 41 (DISCONNECT) or close.

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket';

interface Variant {
  name: string;
  buildAuth: () => any;
  preConnectMsgs?: string[]; // messages to send right after Socket.IO CONNECT
}

const variants: Variant[] = [
  {
    name: 'v1: standard (current)',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  {
    name: 'v2: + is_revenue:true',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
      is_revenue: true,
    }),
  },
  {
    name: 'v3: + platform:1',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
      platform: 1,
    }),
  },
  {
    name: 'v4: bare token (no session_id= prefix)',
    buildAuth: () => ({
      ssid: TOKEN,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  {
    name: 'v5: version 3.0.0',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '3.0.0',
      language: 'en',
    }),
  },
  {
    name: 'v6: minimal fields only',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
    }),
  },
  {
    name: 'v7: with cookies field',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
      cookies: `session_id=${TOKEN}`,
    }),
  },
  {
    name: 'v8: with origin + referer fields',
    buildAuth: () => ({
      ssid: `session_id=${TOKEN}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
      origin: 'https://qxbroker.com',
      referer: 'https://qxbroker.com/',
    }),
  },
];

async function tryVariant(v: Variant): Promise<{ ok: boolean; result: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, {
      headers: {
        'User-Agent': UA,
        'Origin': 'https://qxbroker.com',
        'Cookie': `session_id=${TOKEN}`,
      },
      handshakeTimeout: 6000,
    });

    let gotAuthResponse = false;
    let gotDisconnect = false;
    let sioConnected = false;
    const messages: string[] = [];
    let timeout: NodeJS.Timeout;

    const finish = (ok: boolean, result: string) => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      resolve({ ok, result });
    };

    timeout = setTimeout(() => finish(false, 'timeout'), 8000);

    ws.on('open', () => {
      ws.send('40');
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      messages.push(raw);

      // Socket.IO CONNECT — send auth
      if (raw === '40' && !sioConnected) {
        sioConnected = true;
        const payload = v.buildAuth();
        const msg = `42${JSON.stringify(['authorization', payload])}`;
        ws.send(msg);
      }

      // Look for auth response or disconnect
      if (raw.startsWith('42')) {
        const payload = raw.slice(2);
        try {
          const arr = JSON.parse(payload);
          if (Array.isArray(arr) && arr[0] === 'authorization') {
            gotAuthResponse = true;
            const data = arr[1] || {};
            if (data.account_id || data.user_id || data.id) {
              finish(true, `✓ SUCCESS — account: ${data.account_id || data.user_id || data.id}`);
            } else {
              finish(false, `auth denied: ${JSON.stringify(data).slice(0, 150)}`);
            }
          } else if (Array.isArray(arr)) {
            // Some other event — Quotex may send other events after auth
            // But if we got an event (not disconnect), it might mean auth worked
            // and Quotex is starting to push data
            if (arr[0] === 'balance' || arr[0] === 'time-sync' || arr[0] === 'traders-list') {
              // These events only come AFTER successful auth!
              finish(true, `✓ SUCCESS — got event "${arr[0]}" (post-auth data)`);
            }
          }
        } catch {}
      }

      // Socket.IO DISCONNECT — auth rejected
      if (raw === '41') {
        gotDisconnect = true;
        finish(false, '✗ DISCONNECT (server rejected)');
      }
    });

    ws.on('error', (e) => finish(false, `error: ${e.message}`));
    ws.on('close', (c) => {
      if (!gotAuthResponse && !gotDisconnect) {
        finish(false, `closed (${c})`);
      }
    });
  });
}

console.log(`Token: ${TOKEN.slice(0, 6)}… (${TOKEN.length} chars)`);
console.log('='.repeat(60));

for (const v of variants) {
  process.stdout.write(`Testing ${v.name}… `.padEnd(50));
  const res = await tryVariant(v);
  console.log(res.result);
}

process.exit(0);

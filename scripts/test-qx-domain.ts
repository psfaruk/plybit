// Quick test: try market-qx.trade domain with the user's full cookie jar.
// We'll try multiple WS endpoints on this new domain.

import WebSocket from 'ws';

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

if (!COOKIES) {
  console.log('ERROR: QX_COOKIES env var not set');
  process.exit(1);
}

// Try HTTP first to find what endpoints exist
console.log('=== HTTP probes ===');
const httpEndpoints = [
  'https://market-qx.trade/',
  'https://market-qx.trade/api/v1/profile',
  'https://market-qx.trade/api/v1/balance',
  'https://market-qx.trade/api/v1/candles?asset=EURUSD_otc&period=60',
  'https://market-qx.trade/api/v1/instruments',
  'https://market-qx.trade/api/profile',
  'https://market-qx.trade/en/trade',
  'https://market-qx.trade/socket.io/?EIO=4&transport=polling',
  'https://ws.market-qx.trade/socket.io/?EIO=4&transport=polling',
  'https://api.market-qx.trade/v1/candles?asset=EURUSD_otc&period=60',
];

for (const url of httpEndpoints) {
  process.stdout.write(`${url.slice(0, 75)}`.padEnd(78));
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/plain, */*',
        'Cookie': COOKIES,
        'Origin': 'https://market-qx.trade',
        'Referer': 'https://market-qx.trade/',
      },
      redirect: 'manual',
    });
    const body = await resp.text();
    const loc = resp.headers.get('location');
    let preview: string;
    if (loc) {
      preview = `→ ${loc}`;
    } else if (resp.status === 200) {
      try {
        const j = JSON.parse(body);
        preview = `JSON ${JSON.stringify(j).slice(0, 120)}`;
      } catch {
        preview = `HTML ${body.length}b (${body.match(/<title>([^<]+)<\/title>/i)?.[1] || 'no title'})`;
      }
    } else {
      preview = body.slice(0, 80).replace(/\s+/g, ' ');
    }
    console.log(`${resp.status} ${preview}`);
  } catch (e: any) {
    console.log(`ERR ${e.message}`);
  }
}

// Try WebSocket endpoints on this domain
console.log('\n=== WebSocket probes ===');
const wsEndpoints = [
  'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket',
  'wss://market-qx.trade/socket.io/?EIO=4&transport=websocket',
  'wss://socket.market-qx.trade/socket.io/?EIO=4&transport=websocket',
  'wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket',  // maybe this domain still routes here
];

for (const url of wsEndpoints) {
  console.log(`\n--- ${url} ---`);
  try {
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': UA,
        'Origin': 'https://market-qx.trade',
        'Cookie': COOKIES,
      },
      handshakeTimeout: 5000,
    });
    let opened = false;
    let firstMsg: string | null = null;
    let sioConnected = false;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { ws.close(); } catch {}; resolve(); }, 7000);
      ws.on('open', () => { opened = true; console.log('  OPEN ✓'); ws.send('40'); });
      ws.on('message', (d) => {
        const s = d.toString();
        if (!firstMsg) { firstMsg = s.slice(0, 150); console.log('  MSG:', firstMsg); }
        else console.log('  MSG:', s.slice(0, 200));
        if (s === '40' && !sioConnected) {
          sioConnected = true;
          console.log('  → sending auth');
          // Try the new domain's auth format
          const auth = `42${JSON.stringify(['authorization', {
            ssid: COOKIES,
            device_id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
            user_agent: UA,
            version: '2.7.0',
            language: 'en',
          }])}`;
          ws.send(auth);
        }
        if (s.startsWith('42')) {
          try {
            const arr = JSON.parse(s.slice(2));
            console.log('  EVENT:', arr[0], JSON.stringify(arr[1] || {}).slice(0, 200));
          } catch {}
        }
        if (s === '41') {
          console.log('  ✗ DISCONNECT (auth rejected)');
          clearTimeout(t); resolve();
        }
      });
      ws.on('error', (e) => { console.log('  ERR:', e.message); clearTimeout(t); resolve(); });
      ws.on('close', (c, r) => {
        console.log('  CLOSE:', c, (r?.toString?.() || '').slice(0, 80));
        clearTimeout(t); resolve();
      });
    });
  } catch (e: any) {
    console.log('  EXC:', e.message);
  }
}

process.exit(0);

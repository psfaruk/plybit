// Try the new market-qx.trade endpoint with various auth message formats.
// The user provided full cookies. We need to find which exact field/format Quotex expects.

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';

if (!COOKIES) {
  console.log('ERROR: QX_COOKIES env var not set');
  process.exit(1);
}

// Parse cookies into a map for easy access
const cookieMap = new Map<string, string>();
for (const part of COOKIES.split(';')) {
  const idx = part.indexOf('=');
  if (idx > 0) {
    cookieMap.set(part.slice(0, idx).trim(), part.slice(idx + 1).trim());
  }
}
console.log('Available cookies:', Array.from(cookieMap.keys()).join(', '));

const laravelSession = cookieMap.get('laravel_session') || '';
const cfClearance = cookieMap.get('cf_clearance') || '';
const rememberToken = cookieMap.get('remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d') || '';
const cfBm = cookieMap.get('__cf_bm') || '';

console.log(`laravel_session length: ${laravelSession.length}`);
console.log(`cf_clearance length: ${cfClearance.length}`);
console.log(`remember_web length: ${rememberToken.length}`);
console.log(`__cf_bm length: ${cfBm.length}`);

interface Variant {
  name: string;
  buildAuth: () => any;
}

const variants: Variant[] = [
  // Maybe Quotex now expects the laravel_session as the ssid
  {
    name: 'ssid=laravel_session=...',
    buildAuth: () => ({
      ssid: `laravel_session=${laravelSession}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  // Or the remember_web token
  {
    name: 'ssid=remember_web=...',
    buildAuth: () => ({
      ssid: `remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=${rememberToken}`,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  // Or all cookies as a single string
  {
    name: 'ssid=full cookie string',
    buildAuth: () => ({
      ssid: COOKIES,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  // Try without ssid prefix — bare laravel_session
  {
    name: 'ssid=laravel_session (bare)',
    buildAuth: () => ({
      ssid: laravelSession,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  // Try with cookies field separately + ssid containing only session_id
  {
    name: 'ssid empty + cookies field',
    buildAuth: () => ({
      ssid: '',
      cookies: COOKIES,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
    }),
  },
  // Maybe with platform field
  {
    name: 'ssid=all cookies + platform=web',
    buildAuth: () => ({
      ssid: COOKIES,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
      platform: 'web',
    }),
  },
  // Maybe with fpjs/fingerprint field
  {
    name: 'ssid=full + fingerprint',
    buildAuth: () => ({
      ssid: COOKIES,
      device_id: randomUUID(),
      user_agent: UA,
      version: '2.7.0',
      language: 'en',
      fpjs: randomUUID(),
    }),
  },
];

async function tryVariant(v: Variant): Promise<{ ok: boolean; result: string }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, {
      headers: {
        'User-Agent': UA,
        'Origin': 'https://market-qx.trade',
        'Cookie': COOKIES,
      },
      handshakeTimeout: 6000,
    });

    let sioConnected = false;
    let gotDisconnect = false;
    let timeout: NodeJS.Timeout;

    const finish = (ok: boolean, result: string) => {
      clearTimeout(timeout);
      try { ws.close(); } catch {}
      resolve({ ok, result });
    };

    timeout = setTimeout(() => finish(false, 'timeout'), 8000);

    ws.on('open', () => { ws.send('40'); });
    ws.on('message', (data) => {
      const raw = data.toString();
      if (raw === '40' && !sioConnected) {
        sioConnected = true;
        const payload = v.buildAuth();
        const msg = `42${JSON.stringify(['authorization', payload])}`;
        ws.send(msg);
      }
      if (raw.startsWith('42')) {
        try {
          const arr = JSON.parse(raw.slice(2));
          if (Array.isArray(arr)) {
            if (arr[0] === 'authorization') {
              const d = arr[1] || {};
              if (d.account_id || d.user_id || d.id) {
                finish(true, `✓ SUCCESS — account: ${d.account_id || d.user_id || d.id}`);
              } else {
                finish(false, `auth denied: ${JSON.stringify(d).slice(0, 150)}`);
              }
            } else if (arr[0] === 'balance' || arr[0] === 'time-sync' || arr[0] === 'traders-list') {
              finish(true, `✓ SUCCESS — got post-auth event "${arr[0]}"`);
            } else {
              // Some other event — log and continue
              console.log(`    [event: ${arr[0]}]`);
            }
          }
        } catch {}
      }
      if (raw === '41') {
        gotDisconnect = true;
        finish(false, '✗ DISCONNECT');
      }
    });
    ws.on('error', (e) => finish(false, `error: ${e.message}`));
    ws.on('close', (c) => {
      if (!gotDisconnect && sioConnected) {
        finish(false, `closed (${c})`);
      }
    });
  });
}

console.log('\n=== Testing auth variants ===');
for (const v of variants) {
  process.stdout.write(`Testing ${v.name}…`.padEnd(45));
  const res = await tryVariant(v);
  console.log(res.result);
}

// Also fetch /en/trade and look for what auth setup the JS uses
console.log('\n=== Inspecting /en/trade for auth hints ===');
const tradeResp = await fetch('https://market-qx.trade/en/trade', {
  headers: { 'User-Agent': UA, 'Cookie': COOKIES, 'Referer': 'https://market-qx.trade/' },
});
const tradeHtml = await tradeResp.text();
console.log('length:', tradeHtml.length);

// Look for window.settings
const settingsMatch = tradeHtml.match(/window\.settings\s*=\s*({[^<]+?})\s*<\/script>/);
if (settingsMatch) {
  console.log('window.settings:', settingsMatch[1].slice(0, 400));
}

// Look for any socket.io setup code
const socketSetup = tradeHtml.match(/(?:io|socket)\([^)]+\)[^<]{0,300}/gi);
if (socketSetup) {
  console.log('\nSocket setup hints:');
  for (const s of socketSetup.slice(0, 5)) console.log('  ', s.slice(0, 200));
}

// Look for the api token / user token endpoint
const tokenEndpoint = tradeHtml.match(/["']\/api\/[^"']+token[^"']*["']/gi);
if (tokenEndpoint) {
  console.log('\nToken endpoints:', tokenEndpoint.slice(0, 5));
}

// Find all script src URLs to see what JS files we might need to inspect
const scriptSrcs = [...tradeHtml.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
console.log('\nScript sources:');
for (const s of scriptSrcs.slice(0, 10)) console.log('  ', s);

process.exit(0);

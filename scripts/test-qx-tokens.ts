// Try to obtain a real WebSocket auth token via HTTP first.
// Quotex may now require: GET /api/v1/socket-token → returns token → use in WS auth.

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

const baseHeaders = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://market-qx.trade',
  'Referer': 'https://market-qx.trade/en/trade',
  'Cookie': COOKIES,
  'X-Requested-With': 'XMLHttpRequest',
};

// Try various token-issuing endpoints
const endpoints = [
  'https://market-qx.trade/api/v1/socket/token',
  'https://market-qx.trade/api/v1/ws-token',
  'https://market-qx.trade/api/v1/auth/token',
  'https://market-qx.trade/api/v1/token',
  'https://market-qx.trade/api/v1/session',
  'https://market-qx.trade/api/v1/me',
  'https://market-qx.trade/api/v1/user',
  'https://market-qx.trade/api/v1/init',
  'https://market-qx.trade/api/v1/init-data',
  'https://market-qx.trade/api/socket/token',
  'https://market-qx.trade/api/v1/connection',
  'https://market-qx.trade/api/v1/connect',
  'https://market-qx.trade/api/v1/subscribe',
  'https://market-qx.trade/api/v1/access',  // We saw redirects to this earlier
  'https://market-qx.trade/api/v1/access/init',
  'https://market-qx.trade/socket.io/?EIO=4&transport=polling',  // polling with cookies
];

console.log('=== Token endpoint probes ===');
for (const url of endpoints) {
  process.stdout.write(`${url.slice(0, 70)}`.padEnd(72));
  try {
    const resp = await fetch(url, { headers: baseHeaders, redirect: 'manual' });
    const body = await resp.text();
    const loc = resp.headers.get('location');
    let summary: string;
    if (loc) {
      summary = `${resp.status} → ${loc}`;
    } else if (resp.status === 200) {
      try {
        const j = JSON.parse(body);
        summary = `200 JSON ${JSON.stringify(j).slice(0, 150)}`;
      } catch {
        const title = body.match(/<title>([^<]+)<\/title>/i)?.[1];
        summary = `200 ${title ? `(${title})` : ''} ${body.length}b`;
      }
    } else {
      summary = `${resp.status} ${body.slice(0, 80).replace(/\s+/g, ' ')}`;
    }
    console.log(summary);
  } catch (e: any) {
    console.log(`ERR ${e.message}`);
  }
}

// Try POST variants
console.log('\n=== POST variants ===');
const postEndpoints = [
  'https://market-qx.trade/api/v1/socket/token',
  'https://market-qx.trade/api/v1/access',
  'https://market-qx.trade/api/v1/auth',
  'https://market-qx.trade/api/v1/login',
  'https://market-qx.trade/api/v1/socket/auth',
];
for (const url of postEndpoints) {
  process.stdout.write(`POST ${url.slice(0, 65)}`.padEnd(72));
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
      redirect: 'manual',
    });
    const body = await resp.text();
    const loc = resp.headers.get('location');
    let summary: string;
    if (loc) {
      summary = `${resp.status} → ${loc}`;
    } else if (resp.status === 200) {
      try {
        const j = JSON.parse(body);
        summary = `200 JSON ${JSON.stringify(j).slice(0, 150)}`;
      } catch {
        summary = `200 HTML ${body.length}b`;
      }
    } else {
      summary = `${resp.status} ${body.slice(0, 80).replace(/\s+/g, ' ')}`;
    }
    console.log(summary);
  } catch (e: any) {
    console.log(`ERR ${e.message}`);
  }
}

// Try the polling endpoint with the cookies
console.log('\n=== Socket.IO polling with full cookies ===');
const pollResp = await fetch('https://ws.market-qx.trade/socket.io/?EIO=4&transport=polling', {
  headers: baseHeaders,
});
const pollBody = await pollResp.text();
console.log('status:', pollResp.status);
console.log('body:', pollBody.slice(0, 300));

// Look for the auth endpoint specifically
console.log('\n=== Look for inline JSON config in /en/trade ===');
const tradeResp = await fetch('https://market-qx.trade/en/trade', { headers: baseHeaders });
const tradeHtml = await tradeResp.text();
// Find any window.X = {...} blocks
const configMatches = [...tradeHtml.matchAll(/window\.(\w+)\s*=\s*({[\s\S]*?});\s*<\/script>/g)];
for (const m of configMatches) {
  console.log(`window.${m[1]}:`, m[2].slice(0, 300));
}
// Find any URLs containing "token" or "auth" or "socket"
const urlMatches = [...tradeHtml.matchAll(/["'](\/[^"']*(?:token|auth|socket|api\/v1)[^"']*)["']/gi)].map(m => m[1]);
console.log('URLs in /en/trade:', [...new Set(urlMatches)].slice(0, 20));

// Find inline JS that mentions authorization
const inlineScripts = [...tradeHtml.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
for (const s of inlineScripts) {
  if (s.includes('authorization') || s.includes('socket') || s.includes('emit(') || s.includes('subscribe')) {
    console.log('\nInline script with auth/socket mention:');
    console.log(s.slice(0, 600));
  }
}

process.exit(0);

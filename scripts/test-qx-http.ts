// Check Quotex HTTP API — verify the token is valid by hitting profile/account endpoints.
// If these work, the token is valid and the WS rejection is a separate issue.

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

const headers = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.5',
  'Cookie': `session_id=${TOKEN}`,
  'Referer': 'https://qxbroker.com/',
  'Origin': 'https://qxbroker.com',
};

console.log(`Token: ${TOKEN.slice(0, 6)}… (${TOKEN.length} chars)\n`);

// Test several HTTP endpoints that require auth
const endpoints = [
  { name: 'GET /api/v1/profile', url: 'https://qxbroker.com/api/v1/profile' },
  { name: 'GET /api/profile', url: 'https://qxbroker.com/api/profile' },
  { name: 'GET /api/v1/account', url: 'https://qxbroker.com/api/v1/account' },
  { name: 'GET /api/v1/balance', url: 'https://qxbroker.com/api/v1/balance' },
  { name: 'GET /api/account', url: 'https://qxbroker.com/api/account' },
  { name: 'GET /api/balance', url: 'https://qxbroker.com/api/balance' },
  { name: 'GET /api/v1/user', url: 'https://qxbroker.com/api/v1/user' },
  { name: 'GET /en/profile', url: 'https://qxbroker.com/en/profile' },
  { name: 'GET /en/trade', url: 'https://qxbroker.com/en/trade' },
];

for (const ep of endpoints) {
  process.stdout.write(`Testing ${ep.name}…`.padEnd(35));
  try {
    const resp = await fetch(ep.url, { headers, redirect: 'manual' });
    const body = await resp.text();
    const isRedirect = resp.status >= 300 && resp.status < 400;
    const loc = resp.headers.get('location');
    let preview = '';
    try {
      const j = JSON.parse(body);
      preview = JSON.stringify(j).slice(0, 150);
    } catch {
      preview = body.slice(0, 150).replace(/\s+/g, ' ');
    }
    console.log(`${resp.status} ${isRedirect ? '→ ' + loc : ''} ${preview}`);
  } catch (e: any) {
    console.log(`ERR ${e.message}`);
  }
}

// Also try to check the WebSocket protocol endpoint to see what it says
console.log('\n--- Socket.IO Engine.IO probe (no auth) ---');
const ioResp = await fetch('https://ws.qxbroker.com/socket.io/?EIO=4&transport=polling', {
  headers: { 'User-Agent': UA, 'Origin': 'https://qxbroker.com' },
});
console.log('  status:', ioResp.status);
console.log('  body:', (await ioResp.text()).slice(0, 200));

process.exit(0);

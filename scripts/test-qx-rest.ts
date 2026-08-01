// Try Quotex public REST endpoints for historical candle data.
// These don't require auth and may work for fetching OHLC history.

const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';

const headers = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Cookie': `session_id=${TOKEN}`,
  'Origin': 'https://qxbroker.com',
  'Referer': 'https://qxbroker.com/',
};

// Possible REST endpoints for candle data
const endpoints = [
  'https://qxbroker.com/api/v1/candles?asset=EURUSD_otc&period=60',
  'https://qxbroker.com/api/v1/candles?asset=EURUSD_otc&timeframe=60',
  'https://qxbroker.com/api/v1/history?asset=EURUSD_otc&period=60',
  'https://qxbroker.com/api/v1/quote?asset=EURUSD_otc',
  'https://qxbroker.com/api/v1/asset/list',
  'https://qxbroker.com/api/v1/instruments?platform=1',
  'https://qxbroker.com/api/v1/candle-generated?asset=EURUSD_otc',
  'https://qxbroker.com/api/candles?asset=EURUSD_otc',
  'https://qxbroker.com/api/quote?asset=EURUSD_otc',
  'https://qxbroker.com/api/assets',
  // Quotex may have a separate CDN domain
  'https://api.qxbroker.com/v1/candles?asset=EURUSD_otc&period=60',
  // Try a simple health check
  'https://qxbroker.com/api/v1/health',
  // Try the socket.io polling with auth
  'https://qxbroker.com/socket.io/?EIO=4&transport=polling',
];

for (const url of endpoints) {
  process.stdout.write(`${url.slice(0, 75)}`.padEnd(78));
  try {
    const resp = await fetch(url, { headers, redirect: 'manual' });
    const body = await resp.text();
    const loc = resp.headers.get('location');
    let preview = body.slice(0, 100).replace(/\s+/g, ' ');
    if (loc) preview = `→ ${loc}`;
    console.log(`${resp.status} ${preview}`);
  } catch (e: any) {
    console.log(`ERR ${e.message}`);
  }
}

// Try the engine.io polling endpoint with auth query param
console.log('\n--- Engine.IO polling with sid in URL ---');
const r1 = await fetch('https://ws.qxbroker.com/socket.io/?EIO=4&transport=polling&t=1731234567890-0', {
  headers: { 'User-Agent': UA, 'Origin': 'https://qxbroker.com', 'Cookie': `session_id=${TOKEN}` },
});
console.log('  status:', r1.status);
console.log('  body:', (await r1.text()).slice(0, 250));

// Try the actual qxbroker.com socket.io (not the ws. subdomain)
console.log('\n--- Engine.IO polling on main domain ---');
const r2 = await fetch('https://qxbroker.com/socket.io/?EIO=4&transport=polling', {
  headers: { 'User-Agent': UA, 'Origin': 'https://qxbroker.com', 'Cookie': `session_id=${TOKEN}` },
});
console.log('  status:', r2.status);
console.log('  body:', (await r2.text()).slice(0, 250));

process.exit(0);

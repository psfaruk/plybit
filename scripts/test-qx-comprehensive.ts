// Comprehensive auth check — verify the token against multiple Quotex auth surfaces.
// This will tell us definitively whether the token is valid or expired.

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

console.log(`Token: "${TOKEN}" (${TOKEN.length} chars)`);
console.log(`Expected: 32-char alphanumeric if it's a Quotex web session_id\n`);

// Check token characteristics
const isAlphanumeric = /^[a-zA-Z0-9]+$/.test(TOKEN);
console.log(`Is alphanumeric: ${isAlphanumeric}`);
console.log(`Contains dashes: ${TOKEN.includes('-')}`);
console.log(`Contains dots: ${TOKEN.includes('.')}`);
console.log(`Looks like UUID: ${/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(TOKEN)}`);

// Try with different cookie name patterns
console.log('\n=== Try various cookie name patterns ===');
const cookieVariants = [
  `session_id=${TOKEN}`,
  `session=${TOKEN}`,
  `auth_token=${TOKEN}`,
  `api_token=${TOKEN}`,
  `token=${TOKEN}`,
  `qxtoken=${TOKEN}`,
];

const baseHeaders = {
  'User-Agent': UA,
  'Accept': 'application/json, text/plain, */*',
  'Origin': 'https://qxbroker.com',
  'Referer': 'https://qxbroker.com/',
};

for (const cookie of cookieVariants) {
  const r = await fetch('https://qxbroker.com/api/v1/candles?asset=EURUSD_otc&period=60', {
    headers: { ...baseHeaders, 'Cookie': cookie },
    redirect: 'manual',
  });
  const body = await r.text();
  const loc = r.headers.get('location');
  let summary: string;
  if (r.status === 200) {
    try {
      const j = JSON.parse(body);
      summary = `OK — ${JSON.stringify(j).slice(0, 100)}`;
    } catch {
      summary = `200 (HTML) — ${body.slice(0, 60)}`;
    }
  } else if (loc) {
    summary = `${r.status} → ${loc}`;
  } else {
    summary = `${r.status} — ${body.slice(0, 60)}`;
  }
  console.log(`  ${cookie.slice(0, 50).padEnd(52)} ${summary}`);
}

// Try /api/v1/access with a POST + ssid — this is the actual login API
console.log('\n=== POST /api/v1/access (login API) ===');
const variants = [
  { ssid: `session_id=${TOKEN}` },
  { ssid: TOKEN },
  { session_id: TOKEN },
  { token: TOKEN },
];
for (const body of variants) {
  process.stdout.write(`  ${JSON.stringify(body).slice(0, 60)}`.padEnd(64));
  try {
    const r = await fetch('https://qxbroker.com/api/v1/access', {
      method: 'POST',
      headers: { ...baseHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      redirect: 'manual',
    });
    const respBody = await r.text();
    let summary: string;
    try {
      const j = JSON.parse(respBody);
      summary = `${r.status} — ${JSON.stringify(j).slice(0, 120)}`;
    } catch {
      summary = `${r.status} (HTML)`;
    }
    console.log(summary);
  } catch (e: any) {
    console.log(`ERR ${e.message}`);
  }
}

// Check the Engine.IO sid-based auth — maybe Quotex expects the auth to be sent
// via the polling POST BEFORE the WebSocket upgrade
console.log('\n=== Engine.IO sid-based auth flow ===');
const initResp = await fetch('https://ws.qxbroker.com/socket.io/?EIO=4&transport=polling', {
  headers: { ...baseHeaders, 'Cookie': `session_id=${TOKEN}` },
});
const initBody = await initResp.text();
console.log('  init body:', initBody.slice(0, 200));
const sidMatch = initBody.match(/"sid":"([^"]+)"/);
const sid = sidMatch?.[1];
if (sid) {
  console.log(`  sid: ${sid}`);
  // Try sending auth directly via POST
  const authBody = `42${JSON.stringify(['authorization', {
    ssid: `session_id=${TOKEN}`,
    device_id: 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx',
    user_agent: UA,
    version: '2.7.0',
    language: 'en',
  }])}`;
  const authPost = await fetch(`https://ws.qxbroker.com/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    method: 'POST',
    headers: { ...baseHeaders, 'Content-Type': 'text/plain;charset=UTF-8', 'Cookie': `session_id=${TOKEN}` },
    body: `${authBody.length}:${authBody}`,
  });
  console.log('  auth POST status:', authPost.status, 'body:', (await authPost.text()).slice(0, 100));

  // Then poll for response
  const pollResp = await fetch(`https://ws.qxbroker.com/socket.io/?EIO=4&transport=polling&sid=${sid}`, {
    headers: { ...baseHeaders, 'Cookie': `session_id=${TOKEN}` },
  });
  const pollBody = await pollResp.text();
  console.log('  poll status:', pollResp.status, 'body:', pollBody.slice(0, 250));
}

process.exit(0);

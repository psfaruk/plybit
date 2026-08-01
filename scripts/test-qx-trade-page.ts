// Check if Quotex exposes a fingerprint endpoint, and what /en/trade page contains
// regarding the WebSocket setup. Maybe there's a registration step we're missing.

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

const headers = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml',
  'Cookie': `session_id=${TOKEN}`,
  'Referer': 'https://qxbroker.com/',
};

// Fetch /en/trade and look for the full HTML page content
const r = await fetch('https://qxbroker.com/en/trade', { headers });
const html = await r.text();
console.log('Length:', html.length);

// Find ALL script src URLs
const scriptSrcs = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].map(m => m[1]);
console.log('\nScript sources:');
for (const s of scriptSrcs.slice(0, 15)) console.log('  ', s);

// Find inline scripts that mention "authorization" or "socket" or "subscribe"
const inlineScripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
console.log(`\nFound ${inlineScripts.length} inline scripts. Looking for relevant ones...`);
for (const s of inlineScripts) {
  if (s.includes('socket') || s.includes('authorization') || s.includes('subscribe') ||
      s.includes('device_id') || s.includes('ssid') || s.includes('fingerprint')) {
    console.log('\n--- relevant inline script (excerpt) ---');
    console.log(s.slice(0, 800));
    console.log('...');
  }
}

// Search for any mention of "device_id" or "fpjs" in the full HTML
const fpjsMatches = html.match(/fpjs[^"'<>\s]{0,80}/gi) || [];
console.log('\nfpjs mentions:', fpjsMatches.slice(0, 5));

const deviceIdMatches = html.match(/device_id[^"'<>\s]{0,80}/gi) || [];
console.log('device_id mentions:', deviceIdMatches.slice(0, 5));

// Check the cookies set on the main domain - maybe we need more
console.log('\nCookies set by /en/trade:');
const setCookies = r.headers.getSetCookie?.() || [];
for (const c of setCookies) {
  console.log('  ', c.slice(0, 150));
}

// Try /en/profile — this is a private page that requires auth
console.log('\n=== GET /en/profile ===');
const r2 = await fetch('https://qxbroker.com/en/profile', { headers, redirect: 'manual' });
console.log('status:', r2.status);
const loc = r2.headers.get('location');
if (loc) console.log('redirected to:', loc);
const body2 = await r2.text();
// If it's HTML, check the title to see if we're on the login page or actual profile
const titleMatch = body2.match(/<title>([^<]+)<\/title>/i);
console.log('title:', titleMatch?.[1] || '(no title)');

// Try /en/login to see what the login flow looks like
console.log('\n=== GET /en/login ===');
const r3 = await fetch('https://qxbroker.com/en/login', { headers, redirect: 'manual' });
console.log('status:', r3.status);
const titleMatch3 = (await r3.text()).match(/<title>([^<]+)<\/title>/i);
console.log('title:', titleMatch3?.[1] || '(no title)');

process.exit(0);

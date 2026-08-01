// Extract the Quotex auth token from window.settings.token on /en/trade.
// This is the approach pyquotex uses internally (login.py → get_profile()).

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

console.log('Step 1: Fetch /en/trade to extract window.settings.token');
const r = await fetch('https://market-qx.trade/en/trade', {
  headers: {
    'User-Agent': UA,
    'Accept': 'text/html,application/xhtml+xml',
    'Cookie': COOKIES,
    'Referer': 'https://market-qx.trade/',
  },
});
const html = await r.text();
console.log(`  status=${r.status}, length=${html.length}`);

// Try multiple patterns to extract the token
const patterns = [
  /window\.settings\s*=\s*({[\s\S]*?})\s*;?\s*<\/script>/,
  /window\.settings\s*=\s*({[\s\S]*?})\s*$/m,
  /"token"\s*:\s*"([^"]+)"/,
  /"ssid"\s*:\s*"([^"]+)"/,
  /token["']?\s*[:=]\s*["']([a-zA-Z0-9]{20,})["']/,
];

for (const p of patterns) {
  const m = html.match(p);
  if (m) {
    console.log(`  pattern matched: ${p.toString().slice(0, 60)}`);
    console.log(`  captured: ${m[1]?.slice(0, 100) || '(no capture)'}`);
  }
}

// Look for window.settings specifically
const wsMatch = html.match(/window\.settings\s*=\s*(\{[^<]+?\});/);
if (wsMatch) {
  console.log('  window.settings raw:', wsMatch[1].slice(0, 300));
  try {
    const settings = JSON.parse(wsMatch[1]);
    console.log('  parsed keys:', Object.keys(settings));
    if (settings.token) {
      console.log(`  ✓✓ TOKEN FOUND: ${settings.token.slice(0, 8)}… (${settings.token.length} chars)`);
      console.log(`  full token: ${settings.token}`);
    }
  } catch (e) {
    console.log('  parse error:', e);
  }
}

// Print first 3000 chars of the HTML so we can see the structure
console.log('\n--- HTML head (first 3000 chars) ---');
console.log(html.slice(0, 3000));

// Also search for any token-like values in the page
console.log('\n--- All 40+ char alphanumeric strings in HTML ---');
const longStrings = [...html.matchAll(/["']([a-zA-Z0-9_-]{40,})["']/g)].map(m => m[1]);
for (const s of longStrings.slice(0, 10)) {
  console.log(`  ${s.slice(0, 80)}${s.length > 80 ? '…' : ''} (${s.length} chars)`);
}

process.exit(0);

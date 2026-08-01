// Test BOTH tokens (user's original + session.json's) with the CORRECT pyquotex auth format
// on the correct market-qx.trade domain.
//
// Auth format from quotexpy/ws/channels/ssid.py:
//   42["authorization", {"session": "<token>", "isDemo": 0, "tournamentId": 0}]

import WebSocket from 'ws';

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';

// Two candidate tokens to test
const TOKENS = [
  { name: 'user-provided (mmF8rV...)', value: 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36' },
  { name: 'session.json (Nydjp4h...)', value: 'Nydjp4hzBRXUxig5g9yxxLBLqB7LHj2do3wJ0RbJ' },
];

// Also try with the original cookies from session.json (different from the new ones)
const OLD_COOKIES = 'laravel_session=eyJpdiI6IjNwT3N2bzZwbEdabmRvcW5XNHZDdlE9PSIsInZhbHVlIjoiU0VnM1F5OVBpMTB2cGpUbHpaczVjcDF5dytzYS9UQys5c05xcjRyWjN3MkFicTNzQmtIMGdWWXM4VGJvVWhjWEhxWkszOTM3Q3M2eWFRc1pHOXNyUmtJditQRncwb3AyVmpnUFNuaW50VDFOOTdDSVB0K29GQzFucmJIcnFCY1kiLCJtYWMiOiI1OTc2OTM2ZjYzNDIzNzM3NWJhYWI3MzEzNGE2ZGJmYzA5ZWIzYmNjNTIyNWY0NzNjMTAwZDFkMDNmMGNlZTk5IiwidGFnIjoiIn0%3D; lang=en; remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6ImdqaGVZSytUSTlYSi9pQkRvb29mQ1E9PSIsInZhbHVlIjoieVdVNFMyUVVNaWEzNXNrRlozSFJBZnVoUTBpdTYxVllVa1dPL3JDTitjYzVPaklHejQxc2FVWTZUdFVHRFp1MVBvOVd0RGEyWEJSbjVPZUF1bEJkQXhzSGpoWDUzQlIwWk5ValV5TkllTlpabTF6U3JGenJVQXNlNERGaklVOUdqb2pibnJPUzRCRCtuM2JRbEtPOUVBQTRDZy9IN3ROUXphY003c0JvTHZCUVhvT1dYV3Bod1hwQkVSdTZtSjFVUkJLRjJtazBpL2xQM0Nmb1VPY3lQNERRMW85MjYxdXM5Z085WmNRQjd3QWs3LzJkci9Rd3RWRERTTVM0b3ZhRCIsIm1hYyI6ImIzZmYwOTIwNDg1YmYzNGMxNzkwNjA0ODNlMTZiMWEyMDFiNWVlNzBjMzA3YzQxYTM3NzY5MzIxMmUwZTZlMzQiLCJ0YWciOiIifQ%3D%3D; last_trade=eyJpdiI6Im9KZ05NTHB6V056SzdtSkw5WnVBR2c9PSIsInZhbHVlIjoiTEMraCtqL3JyOThYQXluelBGa3VXWDh1djF4UUdDaFNZRkozaFhmb1h2aHhqM2dKY21pcFdiNnQreVE0cGNZZiIsIm1hYyI6IjM2YjMxMWI0OTBmZTA3NzFjZDkxMGY3YWY2MmMyMzgxZWU1ZDA3N2YxMWYzYWYxMWVlNzc4ZTU2ZWJjZTM3ZmMiLCJ0YWciOiIifQ%3D%3D; referer=https%3A%2F%2Fmarket-qx.trade; __cf_bm=ocN5C5Gkh6DfAZUHDqWVn4aJpQ.E9TBzajk_pdJIMXE-1783654084.8196168-1.0.1.1-K49oBgnazX2utUWF2S8XG2d_mQNFzDNn71bSWiwSi.kyeE_SNL6MWB4el_nZGThyf4dBnyp1G3lfCwa30RB92975Y0c4BVNTZBV.mUGm150BRqhN5Q0a6PHI4yqE0YB3; __vid_l3=ed0ed135-eff4-417c-b529-159a2b852e3a';

// Cookie sets to try
const COOKIE_SETS = [
  { name: 'new cookies (with cf_clearance)', value: COOKIES },
  { name: 'old cookies (no cf_clearance, from session.json)', value: OLD_COOKIES },
];

interface TestResult {
  tokenName: string;
  cookieName: string;
  success: boolean;
  result: string;
}

async function testCombo(token: string, tokenName: string, cookies: string, cookieName: string): Promise<TestResult> {
  return new Promise((resolve) => {
    const ws = new WebSocket(URL, {
      headers: {
        'User-Agent': UA,
        'Origin': 'https://market-qx.trade',
        'Cookie': cookies,
      },
      handshakeTimeout: 6000,
    });

    let sioConnected = false;
    let gotInstrumentList = false;
    let gotAuthResponse = false;
    let result = '';

    const finish = (success: boolean, r: string) => {
      try { ws.close(); } catch {}
      resolve({ tokenName, cookieName, success, result: r });
    };

    const timeout = setTimeout(() => finish(false, result || 'timeout'), 9000);

    ws.on('open', () => {
      ws.send('40');
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      // Only log short snippets to keep output clean
      if (raw === '40' && !sioConnected) {
        sioConnected = true;
        // Send the CORRECT pyquotex auth format
        const payload = {
          session: token,
          isDemo: 0,
          tournamentId: 0,
        };
        ws.send(`42${JSON.stringify(['authorization', payload])}`);
      } else if (raw.startsWith('42')) {
        try {
          const arr = JSON.parse(raw.slice(2));
          if (Array.isArray(arr)) {
            const evt = arr[0];
            const d = arr[1] || {};
            if (evt === 'instruments/list') {
              gotInstrumentList = true;
              result = 'got instruments/list (auth in progress)';
            } else if (evt === 'authorization') {
              gotAuthResponse = true;
              if (d.account_id || d.user_id || d.id) {
                clearTimeout(timeout);
                finish(true, `✓✓✓ AUTH SUCCESS — account: ${d.account_id || d.user_id || d.id}`);
              } else {
                result = `auth response (no account): ${JSON.stringify(d).slice(0, 100)}`;
              }
            } else if (evt === 'authorization/reject') {
              clearTimeout(timeout);
              finish(false, '✗ authorization/reject');
            } else if (evt === 'balance' || evt === 'time-sync' || evt === 'traders-list') {
              // These events only come AFTER successful auth!
              clearTimeout(timeout);
              finish(true, `✓✓✓ AUTH SUCCESS (got post-auth event "${evt}")`);
            } else if (evt === 'candle-generated' || evt === 'candles') {
              clearTimeout(timeout);
              finish(true, `✓✓✓✓ LIVE CANDLES! ${JSON.stringify(d).slice(0, 100)}`);
            }
          }
        } catch {}
      } else if (raw === '41') {
        clearTimeout(timeout);
        finish(false, '✗ DISCONNECT');
      }
    });

    ws.on('error', (e) => {
      clearTimeout(timeout);
      finish(false, `WS error: ${e.message}`);
    });
    ws.on('close', (c) => {
      clearTimeout(timeout);
      if (!gotAuthResponse && result === '') {
        finish(false, `closed (${c}) before auth response`);
      } else if (!result.includes('SUCCESS') && !result.includes('CANDLES')) {
        finish(false, result || `closed (${c})`);
      }
    });
  });
}

console.log(`Cookies available: ${COOKIES ? 'yes' : 'no'} (env QX_COOKIES)`);
console.log('Testing all 4 combinations: 2 tokens × 2 cookie sets\n');

const results: TestResult[] = [];
for (const token of TOKENS) {
  for (const cookies of COOKIE_SETS) {
    if (!cookies.value) continue;
    process.stdout.write(`Testing ${token.name} + ${cookies.name}… `.padEnd(60));
    const r = await testCombo(token.value, token.name, cookies.value, cookies.name);
    console.log(r.result);
    results.push(r);
  }
}

console.log('\n=== Summary ===');
for (const r of results) {
  console.log(`${r.success ? '✓' : '✗'} ${r.tokenName} + ${r.cookieName}`);
}

process.exit(0);

// Try the EXACT auth format from pyquotex's ssid.py:
//   42["authorization", {"session": "<token>", "isDemo": 0, "tournamentId": 0}]
//
// Token comes from session.json (pyquotex caches it there after login).
// Cookies are still needed for the WS handshake (Cloudflare requires them),
// but the auth message uses the token, NOT the cookies.

import WebSocket from 'ws';

// Token from session.json (pyquotex writes this after a successful email/password login)
const TOKEN = 'Nydjp4hzBRXUxig5g9yxxLBLqB7LHj2do3wJ0RbJ';

// Cookies for the WS handshake (Cloudflare requires these — IP+UA bound)
// Try with the older cookies from session.json first
const COOKIES_FROM_SESSION = 'laravel_session=eyJpdiI6IjNwT3N2bzZwbEdabmRvcW5XNHZDdlE9PSIsInZhbHVlIjoiU0VnM1F5OVBpMTB2cGpUbHpaczVjcDF5dytzYS9UQys5c05xcjRyWjN3MkFicTNzQmtIMGdWWXM4VGJvVWhjWEhxWkszOTM3Q3M2eWFRc1pHOXNyUmtJditQRncwb3AyVmpnUFNuaW50VDFOOTdDSVB0K29GQzFucmJIcnFCY1kiLCJtYWMiOiI1OTc2OTM2ZjYzNDIzNzM3NWJhYWI3MzEzNGE2ZGJmYzA5ZWIzYmNjNTIyNWY0NzNjMTAwZDFkMDNmMGNlZTk5IiwidGFnIjoiIn0%3D; lang=en; remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6ImdqaGVZSytUSTlYSi9pQkRvb29mQ1E9PSIsInZhbHVlIjoieVdVNFMyUVVNaWEzNXNrRlozSFJBZnVoUTBpdTYxVllVa1dPL3JDTitjYzVPaklHejQxc2FVWTZUdFVHRFp1MVBvOVd0RGEyWEJSbjVPZUF1bEJkQXhzSGpoWDUzQlIwWk5ValV5TkllTlpabTF6U3JGenJVQXNlNERGaklVOUdqb2pibnJPUzRCRCtuM2JRbEtPOUVBQTRDZy9IN3ROUXphY003c0JvTHZCUVhvT1dYV3Bod1hwQkVSdTZtSjFVUkJLRjJtazBpL2xQM0Nmb1VPY3lQNERRMW85MjYxdXM5Z085WmNRQjd3QWs3LzJkci9Rd3RWRERTTVM0b3ZhRCIsIm1hYyI6ImIzZmYwOTIwNDg1YmYzNGMxNzkwNjA0ODNlMTZiMWEyMDFiNWVlNzBjMzA3YzQxYTM3NzY5MzIxMmUwZTZlMzQiLCJ0YWciOiIifQ%3D%3D; last_trade=eyJpdiI6Im9KZ05NTHB6V056SzdtSkw5WnVBR2c9PSIsInZhbHVlIjoiTEMraCtqL3JyOThYQXluelBGa3VXWDh1djF4UUdDaFNZRkozaFhmb1h2aHhqM2dKY21pcFdiNnQreVE0cGNZZiIsIm1hYyI6IjM2YjMxMWI0OTBmZTA3NzFjZDkxMGY3YWY2MmMyMzgxZWU1ZDA3N2YxMWYzYWYxMWVlNzc4ZTU2ZWJjZTM3ZmMiLCJ0YWciOiIifQ%3D%3D; referer=https%3A%2F%2Fmarket-qx.trade; __cf_bm=ocN5C5Gkh6DfAZUHDqWVn4aJpQ.E9TBzajk_pdJIMXE-1783654084.8196168-1.0.1.1-K49oBgnazX2utUWF2S8XG2d_mQNFzDNn71bSWiwSi.kyeE_SNL6MWB4el_nZGThyf4dBnyp1G3lfCwa30RB92975Y0c4BVNTZBV.mUGm150BRqhN5Q0a6PHI4yqE0YB3; __vid_l3=ed0ed135-eff4-417c-b529-159a2b852e3a';

// Also try with the newer cookies from the previous message
const COOKIES_NEW = process.env.QX_COOKIES || COOKIES_FROM_SESSION;

const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';

console.log(`Token: ${TOKEN.slice(0, 8)}… (${TOKEN.length} chars)`);
console.log(`Cookies: ${COOKIES_NEW.length} chars\n`);

const ws = new WebSocket(URL, {
  headers: {
    'User-Agent': UA,
    'Origin': 'https://market-qx.trade',
    'Cookie': COOKIES_NEW,
  },
  handshakeTimeout: 8000,
});

let sioConnected = false;
let msgCount = 0;

ws.on('open', () => {
  console.log('WS OPEN ✓');
  ws.send('40');
});

ws.on('message', (data) => {
  msgCount++;
  const raw = data.toString();
  console.log(`[${msgCount}] ${raw.slice(0, 250)}`);

  if (raw === '40' && !sioConnected) {
    sioConnected = true;
    console.log('  → Socket.IO CONNECT ack received, sending authorization');

    // EXACT pyquotex format from ssid.py:
    //   42["authorization", {"session": "<token>", "isDemo": 0, "tournamentId": 0}]
    const payload = {
      session: TOKEN,
      isDemo: 0,        // 0 = live account (we saw activeAccount=live in cookies)
      tournamentId: 0,
    };
    const msg = `42${JSON.stringify(['authorization', payload])}`;
    console.log(`  → sending: ${msg.slice(0, 200)}`);
    ws.send(msg);
  }

  if (raw.startsWith('42')) {
    try {
      const arr = JSON.parse(raw.slice(2));
      if (Array.isArray(arr)) {
        console.log(`  EVENT: "${arr[0]}" — ${JSON.stringify(arr[1] || {}).slice(0, 200)}`);
        if (arr[0] === 'authorization' && (arr[1]?.account_id || arr[1]?.id)) {
          console.log('  ✓✓✓ AUTH SUCCESS! Account:', arr[1].account_id || arr[1].id);
        }
        if (arr[0] === 'balance' || arr[0] === 'time-sync' || arr[0] === 'traders-list') {
          console.log('  ✓✓✓ POST-AUTH EVENT (means auth worked!)');
        }
        if (arr[0] === 'candle-generated' || arr[0] === 'candles') {
          console.log('  ✓✓✓✓ CANDLE DATA! Live feed is working!');
          console.log('  candle:', JSON.stringify(arr[1]).slice(0, 300));
        }
      }
    } catch {}
  }
  if (raw === '41') {
    console.log('  ✗ DISCONNECT (auth rejected)');
  }
});

ws.on('error', (e) => console.log('ERR:', e.message));
ws.on('close', (c, r) => {
  console.log(`CLOSE: ${c} ${(r?.toString?.() || '').slice(0, 100)}`);
  console.log(`Total messages: ${msgCount}`);
});

setTimeout(() => { ws.close(); process.exit(0); }, 12000);

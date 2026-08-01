// Hard-coded test with the cookies the user pasted (with cf_clearance)
// and BOTH tokens, using the CORRECT pyquotex auth format.

import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';

// User-provided cookies (from previous message)
const COOKIES = 'cf_clearance=GreD7M.aMYu5zOh8iU6RuzMBRdHtxCBubEYbi9ETEs0-1785501233-1.2.1.1-SP0r6QGdXCgjO3mzfmVYB9zRm6f80dzLz0nZBndWgQF4vF2bZOgAjHNs2fKgqCMMANBzZBUE0qPPUnoDYnxKI.mHCO8tgeWMawmTKLiVO73HGZURrdhOLlh8a0wYT6qFgMSyugdlJZ8ybLh.ScLFICAwJMSRi_31o2mlFkpR7Cn9lkVOi.R05zQXe8gMbHJPdi_BjlbUVAXyKlSTeWdNFcb3g_Hvj2TqVW_w0K8xeIMurDURKs.nuNjPRiHPDFRJSFiw9oC67ahT9hhS4WuDuyhhEKTVtBgJkROaNBfFiJwB1s9HjHvSai.g0eh6CoVxMKdwJogP9QFPdcqdikAar3x9jBFlkVU9Y2ZVqy7eod0; __cf_bm=zXYDjSCsP4mjI_tCimw7NON2dpiorrNxVHGjyaWLByM-1785501233.9697707-1.0.1.1-uhvrM73U5pLDMxayIowTMYf6v0hxeNdhOir.n9wG2sf4MswI2q3KQw4NTC_lyW6YgWqIj84oCxSRfKtvnBQp82Pb7CopLbL0hx0tj54JGb8MXipJ5o5nditRMtiMaWJt; laravel_session=eyJpdiI6IjBTR0R6aGkrU2RjMWt3MGRVTjJFOGc9PSIsInZhbHVlIjoicGtEWkNEYWRDV1BTbk9oYlJQVnhINUJ0Wk1EaXN0b1hyVkpzUkYrM1BDUFM4ajJYZVRnWDFoQ0JpY0RXRHlqL2tnZFJZdENMMHUzQ2MrMkpBVzFvNXQrVUNSSHFPUk9ucUdiS1Y0V2lqR285bnFvUWJoQitBVVlrdzluR1RBK2IiLCJtYWMiOiIwMDgxMGI0MTgyOWM1NTc2MWQ1YWNjYzYwOTM1ZjU2N2FkMjcwNmFjMGJkNWI3OThiMzg0MTM4ZGRjYTgzZDZiIiwidGFnIjoiIn0%3D; remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6IjVDVlpla3NSZE53bFNzSGZKc1FxWWc9PSIsInZhbHVlIjoiZjBwNjdiWjRNQVZGanVsdENUMzN0TkNROVBiS2lpOWZSUHBKdnVUajZUaVVqRUs2WllWQkdLajV1UTFjZDRTQmJOUCsxanN4ZGp2QWlWNDYvamQyQ2MvOTY0WDdxeTJPZENBUVlHSEpNNTQzd3JqUm9od0JzdXpGTGJPMDNiTkpEZStFQmpmbm1adHlYWEtmclI3SjBTb0lkaGcydlV4bjVwR3hJVHdMRmpOS0lvTWl1QzdnNjJJaGVDM0hCTEcyZUlZQ3hJTVVqeGx6U0J3MjcvVm10S0pKV1VKKzFyUTZTdFJ4M0ROMjk1MDNJSzl4TER2WG11RXRvVDhPaWNRaiIsIm1hYyI6Ijg5MjM1MTJkNDYyYTM3NTM3YjE1MzRiMzQzOTgyYzdhZTFlYWJhYTBkNGQ0NTkyNjVhZGM2Nzk0NmZlYTRjNWYiLCJ0YWciOiIifQ%3D%3D; activeAccount=live; lang=en';

const TOKENS = [
  { name: 'user-provided (mmF8rV...)', value: 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36' },
  { name: 'session.json (Nydjp4h...)', value: 'Nydjp4hzBRXUxig5g9yxxLBLqB7LHj2do3wJ0RbJ' },
];

async function testToken(token: string, name: string): Promise<{ ok: boolean; result: string }> {
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
    let gotInstrumentList = false;
    let result = '';

    const finish = (ok: boolean, r: string) => {
      try { ws.close(); } catch {}
      resolve({ ok, result: r });
    };

    const timeout = setTimeout(() => finish(false, result || 'timeout'), 9000);

    ws.on('open', () => {
      ws.send('40');
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      if (raw === '40' && !sioConnected) {
        sioConnected = true;
        // CORRECT pyquotex auth format
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
              result = 'instruments/list received';
            } else if (evt === 'authorization') {
              if (d.account_id || d.user_id || d.id) {
                clearTimeout(timeout);
                finish(true, `✓✓✓ AUTH SUCCESS — account: ${d.account_id || d.user_id || d.id}`);
              } else {
                result = `auth response: ${JSON.stringify(d).slice(0, 100)}`;
              }
            } else if (evt === 'authorization/reject') {
              clearTimeout(timeout);
              finish(false, '✗ authorization/reject');
            } else if (evt === 'balance' || evt === 'time-sync' || evt === 'traders-list') {
              clearTimeout(timeout);
              finish(true, `✓✓✓ AUTH SUCCESS (post-auth event: ${evt})`);
            } else if (evt === 'candle-generated' || evt === 'candles') {
              clearTimeout(timeout);
              finish(true, `✓✓✓✓ LIVE CANDLES! ${JSON.stringify(d).slice(0, 150)}`);
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
      if (!result.includes('SUCCESS') && !result.includes('CANDLES')) {
        finish(false, result || `closed (${c})`);
      }
    });
  });
}

console.log('=== Testing both tokens with user-provided cookies + CORRECT auth format ===\n');

for (const t of TOKENS) {
  process.stdout.write(`Testing ${t.name}… `.padEnd(50));
  const r = await testToken(t.value, t.name);
  console.log(r.result);
}

process.exit(0);

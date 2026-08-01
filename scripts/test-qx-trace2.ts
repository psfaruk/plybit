// More careful test — log EVERY message to see exactly what the server says.

import WebSocket from 'ws';

const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';
const COOKIES = 'cf_clearance=GreD7M.aMYu5zOh8iU6RuzMBRdHtxCBubEYbi9ETEs0-1785501233-1.2.1.1-SP0r6QGdXCgjO3mzfmVYB9zRm6f80dzLz0nZBndWgQF4vF2bZOgAjHNs2fKgqCMMANBzZBUE0qPPUnoDYnxKI.mHCO8tgeWMawmTKLiVO73HGZURrdhOLlh8a0wYT6qFgMSyugdlJZ8ybLh.ScLFICAwJMSRi_31o2mlFkpR7Cn9lkVOi.R05zQXe8gMbHJPdi_BjlbUVAXyKlSTeWdNFcb3g_Hvj2TqVW_w0K8xeIMurDURKs.nuNjPRiHPDFRJSFiw9oC67ahT9hhS4WuDuyhhEKTVtBgJkROaNBfFiJwB1s9HjHvSai.g0eh6CoVxMKdwJogP9QFPdcqdikAar3x9jBFlkVU9Y2ZVqy7eod0; __cf_bm=zXYDjSCsP4mjI_tCimw7NON2dpiorrNxVHGjyaWLByM-1785501233.9697707-1.0.1.1-uhvrM73U5pLDMxayIowTMYf6v0hxeNdhOir.n9wG2sf4MswI2q3KQw4NTC_lyW6YgWqIj84oCxSRfKtvnBQp82Pb7CopLbL0hx0tj54JGb8MXipJ5o5nditRMtiMaWJt; laravel_session=eyJpdiI6IjBTR0R6aGkrU2RjMWt3MGRVTjJFOGc9PSIsInZhbHVlIjoicGtEWkNEYWRDV1BTbk9oYlJQVnhINUJ0Wk1EaXN0b1hyVkpzUkYrM1BDUFM4ajJYZVRnWDFoQ0JpY0RXRHlqL2tnZFJZdENMMHUzQ2MrMkpBVzFvNXQrVUNSSHFPUk9ucUdiS1Y0V2lqR285bnFvUWJoQitBVVlrdzluR1RBK2IiLCJtYWMiOiIwMDgxMGI0MTgyOWM1NTc2MWQ1YWNjYzYwOTM1ZjU2N2FkMjcwNmFjMGJkNWI3OThiMzg0MTM4ZGRjYTgzZDZiIiwidGFnIjoiIn0%3D; remember_web_59ba36addc2b2f9401580f014c7f58ea4e30989d=eyJpdiI6IjVDVlpla3NSZE53bFNzSGZKc1FxWWc9PSIsInZhbHVlIjoiZjBwNjdiWjRNQVZGanVsdENUMzN0TkNROVBiS2lpOWZSUHBKdnVUajZUaVVqRUs2WllWQkdLajV1UTFjZDRTQmJOUCsxanN4ZGp2QWlWNDYvamQyQ2MvOTY0WDdxeTJPZENBUVlHSEpNNTQzd3JqUm9od0JzdXpGTGJPMDNiTkpEZStFQmpmbm1adHlYWEtmclI3SjBTb0lkaGcydlV4bjVwR3hJVHdMRmpOS0lvTWl1QzdnNjJJaGVDM0hCTEcyZUlZQ3hJTVVqeGx6U0J3MjcvVm10S0pKV1VKKzFyUTZTdFJ4M0ROMjk1MDNJSzl4TER2WG11RXRvVDhPaWNRaiIsIm1hYyI6Ijg5MjM1MTJkNDYyYTM3NTM3YjE1MzRiMzQzOTgyYzdhZTFlYWJhYTBkNGQ0NTkyNjVhZGM2Nzk0NmZlYTRjNWYiLCJ0YWciOiIifQ%3D%3D; activeAccount=live; lang=en';

const TOKEN = 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';

console.log(`Token: ${TOKEN.slice(0, 8)}… (${TOKEN.length} chars)`);
console.log(`URL: ${URL}\n`);

const ws = new WebSocket(URL, {
  headers: {
    'User-Agent': UA,
    'Origin': 'https://market-qx.trade',
    'Cookie': COOKIES,
  },
  handshakeTimeout: 6000,
});

let msgCount = 0;
let sioConnected = false;
const allMsgs: string[] = [];

ws.on('open', () => {
  console.log('[1] WS OPEN ✓');
  ws.send('40');
});

ws.on('message', (data, isBinary) => {
  msgCount++;
  const raw = isBinary ? '<binary>' : data.toString();
  allMsgs.push(raw);
  // Only show first 250 chars per message
  console.log(`[${msgCount}${isBinary ? '/bin' : ''}] ${raw.slice(0, 250)}`);

  if (raw === '40' && !sioConnected) {
    sioConnected = true;
    console.log('  → got Socket.IO CONNECT ack, sending auth with CORRECT format');
    const payload = {
      session: TOKEN,
      isDemo: 0,
      tournamentId: 0,
    };
    const msg = `42${JSON.stringify(['authorization', payload])}`;
    console.log(`  → sending: ${msg}`);
    ws.send(msg);
  }

  // Parse Socket.IO events
  if (!isBinary && raw.startsWith('42')) {
    try {
      const arr = JSON.parse(raw.slice(2));
      if (Array.isArray(arr)) {
        console.log(`  → EVENT: "${arr[0]}" — keys: ${arr[1] ? Object.keys(arr[1]).join(',') : '(empty)'}`);
        if (arr[0] === 'authorization' && arr[1]) {
          if (arr[1].account_id || arr[1].id) {
            console.log(`  ✓✓✓ AUTH SUCCESS!`);
          }
        }
      }
    } catch (e) {
      console.log(`  → parse error: ${e}`);
    }
  }
});

ws.on('error', (e) => console.log('[ERR]', e.message));
ws.on('close', (c, r) => {
  console.log(`[CLOSE] code=${c} reason=${(r?.toString?.() || '').slice(0, 100)}`);
  console.log(`Total messages: ${msgCount}`);
});

setTimeout(() => { ws.close(); process.exit(0); }, 12000);

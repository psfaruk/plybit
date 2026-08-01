// Comprehensive auth flow investigation on market-qx.trade.
// Capture EVERY message between connect and disconnect to see what events
// the server sends/requires.

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const COOKIES = process.env.QX_COOKIES || '';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';

console.log('=== Connecting to', URL, '===');
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
const allMessages: string[] = [];

ws.on('open', () => {
  console.log('[t+0ms] OPEN — sending 40 (Socket.IO CONNECT)');
  ws.send('40');
});

ws.on('message', (data) => {
  msgCount++;
  const raw = data.toString();
  allMessages.push(raw);
  console.log(`[t+${Date.now() % 100000}ms msg#${msgCount}] ${raw.slice(0, 250)}`);

  // Socket.IO CONNECT ack — server accepted our namespace
  if (raw === '40' && !sioConnected) {
    sioConnected = true;
    console.log('  → got Socket.IO CONNECT ack, sending auth in 200ms');
    setTimeout(() => {
      // Try the most standard format used by quotex-py library
      const authPayload = {
        ssid: COOKIES,  // full cookie string
        device_id: randomUUID(),
        user_agent: UA,
        version: '2.7.0',
        language: 'en',
      };
      const msg = `42${JSON.stringify(['authorization', authPayload])}`;
      console.log(`  → sending: ${msg.slice(0, 150)}…`);
      ws.send(msg);
    }, 200);
  }

  // Capture any event names we see
  if (raw.startsWith('42')) {
    try {
      const arr = JSON.parse(raw.slice(2));
      if (Array.isArray(arr)) {
        console.log(`    parsed event: "${arr[0]}" data keys: ${arr[1] ? Object.keys(arr[1]).join(',') : '(no data)'}`);
      }
    } catch (e) {
      console.log(`    (failed to parse: ${e})`);
    }
  }
});

ws.on('error', (e) => console.log('[error]', e.message));
ws.on('close', (c, r) => {
  console.log(`[close] code=${c} reason=${(r?.toString?.() || '').slice(0, 150)}`);
  console.log(`Total messages received: ${msgCount}`);
  console.log('All messages:');
  for (let i = 0; i < allMessages.length; i++) {
    console.log(`  ${i+1}: ${allMessages[i].slice(0, 200)}`);
  }
});

setTimeout(() => { ws.close(); process.exit(0); }, 8000);

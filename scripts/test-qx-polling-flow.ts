// Try the standard Socket.IO polling-first flow:
//   1. GET /socket.io/?EIO=4&transport=polling → get sid
//   2. POST /socket.io/?EIO=4&transport=polling&sid=... → send CONNECT (40)
//   3. GET /socket.io/?EIO=4&transport=polling&sid=... → receive 40 (CONNECT ack)
//   4. POST → send auth (42["authorization",...])
//   5. Upgrade to WebSocket with sid
//   6. Continue with WS

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const BASE = 'https://ws.qxbroker.com/socket.io/';

const headers = {
  'User-Agent': UA,
  'Origin': 'https://qxbroker.com',
  'Cookie': `session_id=${TOKEN}`,
  'Accept': '*/*',
  'Referer': 'https://qxbroker.com/',
};

function parseEnginePacket(body: string): { type: string; data?: any } {
  // Engine.IO packets are length-prefixed: "<len>:<payload>"
  // e.g. "96:0{\"sid\":...}2:40"
  const parts: string[] = [];
  let i = 0;
  while (i < body.length) {
    const colon = body.indexOf(':', i);
    if (colon === -1) break;
    const len = parseInt(body.slice(i, colon), 10);
    if (isNaN(len)) break;
    parts.push(body.slice(colon + 1, colon + 1 + len));
    i = colon + 1 + len;
  }
  if (parts.length === 0) {
    // No length prefix
    parts.push(body);
  }
  // Return first packet
  const p = parts[0];
  return { type: p[0], data: p.length > 1 ? p.slice(1) : undefined };
}

async function pollGet(sid?: string): Promise<string> {
  const url = sid ? `${BASE}?EIO=4&transport=polling&sid=${sid}` : `${BASE}?EIO=4&transport=polling`;
  const resp = await fetch(url, { headers });
  return await resp.text();
}

async function pollPost(sid: string | undefined, payload: string): Promise<void> {
  const url = sid ? `${BASE}?EIO=4&transport=polling&sid=${sid}` : `${BASE}?EIO=4&transport=polling`;
  await fetch(url, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'text/plain;charset=UTF-8' },
    body: `${payload.length}:${payload}`,
  });
}

console.log('Step 1: GET initial polling → obtain sid');
const initBody = await pollGet();
console.log('  body:', initBody.slice(0, 200));
const initPacket = parseEnginePacket(initBody);
let sid: string | undefined;
if (initPacket.type === '0') {
  try {
    const cfg = JSON.parse(initPacket.data || '{}');
    sid = cfg.sid;
    console.log(`  ✓ sid = ${sid}`);
  } catch (e: any) {
    console.log('  ✗ failed to parse sid:', e.message);
    process.exit(1);
  }
} else {
  console.log('  ✗ unexpected first packet type:', initPacket.type);
  process.exit(1);
}

console.log('\nStep 2: POST CONNECT (40)');
await pollPost(sid, '40');

console.log('\nStep 3: GET → expect Socket.IO CONNECT ack (40)');
const ack = await pollGet(sid);
console.log('  body:', ack.slice(0, 200));
const ackPacket = parseEnginePacket(ack);
console.log('  packet:', ackPacket.type, ackPacket.data);

console.log('\nStep 4: POST auth message');
const authPayload = {
  ssid: `session_id=${TOKEN}`,
  device_id: randomUUID(),
  user_agent: UA,
  version: '2.7.0',
  language: 'en',
};
const authMsg = `42${JSON.stringify(['authorization', authPayload])}`;
await pollPost(sid, authMsg);

console.log('\nStep 5: GET → expect auth response');
const authResp = await pollGet(sid);
console.log('  body:', authResp.slice(0, 300));
const authRespPacket = parseEnginePacket(authResp);
console.log('  packet type:', authRespPacket.type);
if (authRespPacket.data) {
  console.log('  data:', authRespPacket.data.slice(0, 200));
}

console.log('\nStep 6: Try to upgrade to WebSocket with sid');
const wsUrl = `${BASE.replace('https', 'wss')}?EIO=4&transport=websocket&sid=${sid}`;
console.log('  wsUrl:', wsUrl);
const ws = new WebSocket(wsUrl, {
  headers: {
    'User-Agent': UA,
    'Origin': 'https://qxbroker.com',
    'Cookie': `session_id=${TOKEN}`,
  },
  handshakeTimeout: 6000,
});

await new Promise<void>((resolve) => {
  const t = setTimeout(() => { try { ws.close(); } catch {}; resolve(); }, 8000);
  ws.on('open', () => {
    console.log('  WS OPEN ✓');
    // Send Engine.IO UPGRADE probe
    ws.send('2probe');
  });
  ws.on('message', (d) => {
    const s = d.toString();
    console.log('  WS MSG:', s.slice(0, 200));
    if (s === '3probe') {
      console.log('  → upgrade probe acked, sending UPGRADE (5)');
      ws.send('5');
      // Now try subscribing to an asset
      setTimeout(() => {
        const sub = `42${JSON.stringify(['subscribe', { asset: 'EURUSD_otc', period: 60 }])}`;
        console.log('  → sending subscribe');
        ws.send(sub);
      }, 500);
    }
    if (s.startsWith('42')) {
      // EVENT — check what we got
      const payload = s.slice(2);
      try {
        const arr = JSON.parse(payload);
        console.log('  EVENT:', arr[0], JSON.stringify(arr[1] || {}).slice(0, 200));
      } catch {}
    }
  });
  ws.on('error', (e) => { console.log('  WS ERR:', e.message); clearTimeout(t); resolve(); });
  ws.on('close', (c, r) => { console.log('  WS CLOSE:', c, (r?.toString?.() || '').slice(0, 80)); clearTimeout(t); resolve(); });
});

process.exit(0);

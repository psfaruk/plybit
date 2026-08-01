// Probe Quotex endpoints to see what's currently working.
// Maybe Quotex moved their WS endpoint.

import WebSocket from 'ws';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

const endpoints = [
  // Old endpoints
  'wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket',
  // Possible new endpoints
  'wss://api.qxbroker.com/socket.io/?EIO=4&transport=websocket',
  'wss://qxbroker.com/socket.io/?EIO=4&transport=websocket',
  'wss://socket.qxbroker.com/socket.io/?EIO=4&transport=websocket',
  // Maybe with auth token in URL
  `wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket&session_id=${TOKEN}`,
  // Maybe Engine.IO 3 protocol
  'wss://ws.qxbroker.com/socket.io/?EIO=3&transport=websocket',
  // Maybe without socket.io
  'wss://ws.qxbroker.com/',
];

for (const url of endpoints) {
  console.log(`\n--- ${url.slice(0, 90)}… ---`);
  try {
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': UA,
        'Origin': 'https://qxbroker.com',
        'Cookie': `session_id=${TOKEN}`,
      },
      handshakeTimeout: 5000,
    });
    let opened = false;
    let firstMsg: string | null = null;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => { try { ws.close(); } catch {}; resolve(); }, 4000);
      ws.on('open', () => { opened = true; console.log('  OPEN ✓'); });
      ws.on('message', (d) => {
        const s = d.toString();
        if (!firstMsg) { firstMsg = s.slice(0, 120); console.log('  FIRST MSG:', firstMsg); }
        if (s === '40') {
          console.log('  → got Socket.IO CONNECT ack, sending auth...');
          ws.send(`42["authorization",{"ssid":"session_id=${TOKEN}","device_id":"test-device","user_agent":"${UA}","version":"2.7.0","language":"en"}]`);
        }
        if (s.startsWith('42')) {
          console.log('  EVENT:', s.slice(0, 200));
        }
        if (s === '41') {
          console.log('  ✗ DISCONNECT (server rejected)');
          clearTimeout(t); resolve();
        }
      });
      ws.on('error', (e) => { console.log('  ERR:', e.message); clearTimeout(t); resolve(); });
      ws.on('close', (c, r) => { console.log('  CLOSE:', c, (r?.toString?.() || '').slice(0, 80)); clearTimeout(t); resolve(); });
    });
  } catch (e: any) {
    console.log('  EXC:', e.message);
  }
}
process.exit(0);

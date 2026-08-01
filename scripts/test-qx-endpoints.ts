import WebSocket from 'ws';

// Try a few different Quotex endpoints to see which works
const endpoints = [
  'wss://ws.qxbroker.com/',
  'wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket',
  'wss://qxbroker.com/socket.io/?EIO=4&transport=websocket',
  'wss://socket.qxbroker.com/socket.io/?EIO=4&transport=websocket',
];

for (const url of endpoints) {
  console.log(`\n--- trying ${url} ---`);
  try {
    const ws = new WebSocket(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
        'Origin': 'https://qxbroker.com',
      },
      handshakeTimeout: 4000,
    });
    let opened = false;
    await new Promise<void>((resolve) => {
      const t = setTimeout(() => {
        if (!opened) console.log('  TIMEOUT');
        try { ws.close(); } catch {}
        resolve();
      }, 5000);
      ws.on('open', () => { opened = true; console.log('  OPEN ✓'); clearTimeout(t); setTimeout(() => { ws.close(); resolve(); }, 1500); });
      ws.on('message', d => console.log('  MSG:', d.toString().slice(0, 100)));
      ws.on('error', e => { console.log('  ERR:', e.message); clearTimeout(t); resolve(); });
      ws.on('close', (c, r) => { console.log('  CLOSE:', c, r.toString().slice(0, 100)); clearTimeout(t); resolve(); });
    });
  } catch (e: any) {
    console.log('  EXC:', e.message);
  }
}
process.exit(0);

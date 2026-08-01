import WebSocket from 'ws';

const ws = new WebSocket('wss://qxbroker.com/socket.io/?EIO=4&transport=websocket', {
  headers: {
    'User-Agent': 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0',
    'Origin': 'https://qxbroker.com',
  },
  handshakeTimeout: 5000,
});

ws.on('open', () => { console.log('OPEN'); ws.send('40'); });
ws.on('message', d => console.log('MSG:', d.toString().slice(0, 200)));
ws.on('error', e => console.log('ERR:', e.message));
ws.on('close', (c, r) => console.log('CLOSE:', c, r.toString().slice(0, 200)));

setTimeout(() => { ws.close(); process.exit(0); }, 8000);

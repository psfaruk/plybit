// Diagnostic: try several auth formats + capture full server responses
import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const URL = 'wss://ws.qxbroker.com/socket.io/?EIO=4&transport=websocket';

const ws = new WebSocket(URL, {
  headers: { 'User-Agent': UA, 'Origin': 'https://qxbroker.com' },
  handshakeTimeout: 8000,
});

let msgs: string[] = [];

ws.on('open', () => {
  console.log('OPEN');
  ws.send('40');
});

ws.on('message', (data) => {
  const raw = data.toString();
  console.log('MSG:', raw.slice(0, 300));
  msgs.push(raw);

  // After Socket.IO CONNECT (40), try auth
  if (raw === '40' && msgs.length === 2) {
    setTimeout(() => {
      // Try multiple auth formats
      const authPayloads = [
        // Format 1: standard authorization with full ssid cookie string
        `42["authorization",{"ssid":"session_id=${TOKEN}","device_id":"${randomUUID()}","user_agent":"${UA}","version":"2.7.0","language":"en"}]`,
      ];
      console.log('SENDING AUTH');
      ws.send(authPayloads[0]);
    }, 200);
  }
});

ws.on('error', e => console.log('ERR:', e.message));
ws.on('close', (c, r) => {
  console.log('CLOSE:', c, r.toString().slice(0, 200));
  console.log('Total messages:', msgs.length);
});

setTimeout(() => { ws.close(); process.exit(0); }, 10000);

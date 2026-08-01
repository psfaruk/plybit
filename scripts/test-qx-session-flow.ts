// Session-aware polling flow with cookie jar — keep all cookies from each response.
// This is how a real browser behaves and may be what Quotex requires.

import WebSocket from 'ws';
import { randomUUID } from 'crypto';

const TOKEN = process.env.QX_TOKEN || 'mmF8rV1zTJLY8L2dcIYprACleMhltyU5Qx8wNC36';
const UA = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';
const BASE = 'https://ws.qxbroker.com/socket.io/';
const HOME = 'https://qxbroker.com/';

const cookieJar = new Map<string, string>();
cookieJar.set('session_id', TOKEN);

function cookieHeader(): string {
  return Array.from(cookieJar.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeSetCookies(resp: Response): void {
  const setCookies = resp.headers.getSetCookie?.() || [];
  for (const c of setCookies) {
    const kv = c.split(';')[0];
    const eq = kv.indexOf('=');
    if (eq > 0) {
      const k = kv.slice(0, eq);
      const v = kv.slice(eq + 1);
      if (v !== 'deleted' && v !== '') {
        cookieJar.set(k, v);
      } else {
        cookieJar.delete(k);
      }
    }
  }
}

function baseHeaders(): Record<string, string> {
  return {
    'User-Agent': UA,
    'Origin': 'https://qxbroker.com',
    'Referer': 'https://qxbroker.com/',
    'Accept': '*/*',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cookie': cookieHeader(),
  };
}

console.log('Step 0: warmup GET https://qxbroker.com/');
const homeResp = await fetch(HOME, { headers: baseHeaders(), redirect: 'manual' });
mergeSetCookies(homeResp);
await homeResp.text();
console.log(`  status=${homeResp.status}, cookie jar size=${cookieJar.size}`);
console.log('  cookies:', Array.from(cookieJar.keys()).join(', '));

function parseEnginePacket(body: string): { type: string; data?: string; raw: string }[] {
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
  if (parts.length === 0) parts.push(body);
  return parts.map(p => ({ type: p[0], data: p.length > 1 ? p.slice(1) : undefined, raw: p }));
}

async function pollGet(sid?: string): Promise<Response> {
  const url = sid ? `${BASE}?EIO=4&transport=polling&sid=${sid}` : `${BASE}?EIO=4&transport=polling`;
  const resp = await fetch(url, { headers: baseHeaders(), redirect: 'manual' });
  mergeSetCookies(resp);
  return resp;
}

async function pollPost(sid: string | undefined, payload: string): Promise<Response> {
  const url = sid ? `${BASE}?EIO=4&transport=polling&sid=${sid}` : `${BASE}?EIO=4&transport=polling`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { ...baseHeaders(), 'Content-Type': 'text/plain;charset=UTF-8' },
    body: `${payload.length}:${payload}`,
    redirect: 'manual',
  });
  mergeSetCookies(resp);
  return resp;
}

console.log('\nStep 1: GET initial polling → obtain sid');
const initResp = await pollGet();
const initBody = await initResp.text();
console.log(`  status=${initResp.status}`);
console.log('  body:', initBody.slice(0, 200));
const initPackets = parseEnginePacket(initBody);
let sid: string | undefined;
for (const p of initPackets) {
  if (p.type === '0') {
    try {
      const cfg = JSON.parse(p.data || '{}');
      sid = cfg.sid;
      console.log(`  ✓ sid = ${sid}`);
    } catch {}
  }
}
if (!sid) { console.log('  ✗ no sid found'); process.exit(1); }

console.log('\nStep 2: POST Socket.IO CONNECT (40)');
const postResp1 = await pollPost(sid, '40');
console.log(`  status=${postResp1.status}, body=${(await postResp1.text()).slice(0, 80)}`);

console.log('\nStep 3: GET → expect Socket.IO CONNECT ack (40) or other packets');
const ackResp = await pollGet(sid);
const ackBody = await ackResp.text();
console.log(`  status=${ackResp.status}`);
console.log('  body:', ackBody.slice(0, 200));
const ackPackets = parseEnginePacket(ackBody);
for (const p of ackPackets) {
  console.log(`  packet: type=${p.type}, data=${(p.data || '').slice(0, 100)}`);
}

console.log('\nStep 4: POST auth message');
const authPayload = {
  ssid: `session_id=${TOKEN}`,
  device_id: randomUUID(),
  user_agent: UA,
  version: '2.7.0',
  language: 'en',
};
const authMsg = `42${JSON.stringify(['authorization', authPayload])}`;
const authPost = await pollPost(sid, authMsg);
console.log(`  status=${authPost.status}, body=${(await authPost.text()).slice(0, 80)}`);

console.log('\nStep 5: GET → expect auth response or other data');
const authGet = await pollGet(sid);
const authGetBody = await authGet.text();
console.log(`  status=${authGet.status}`);
console.log('  body:', authGetBody.slice(0, 300));
const authGetPackets = parseEnginePacket(authGetBody);
for (const p of authGetPackets) {
  console.log(`  packet: type=${p.type}, data=${(p.data || '').slice(0, 200)}`);
  if (p.type === '4' && p.data && p.data.startsWith('2')) {
    const arr = JSON.parse(p.data.slice(1));
    console.log('    EVENT:', arr[0], JSON.stringify(arr[1] || {}).slice(0, 200));
  }
}

process.exit(0);

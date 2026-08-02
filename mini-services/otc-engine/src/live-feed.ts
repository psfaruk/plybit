// QuotexOTCClient — Live Quotex WebSocket integration
//
// Connects to wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket
// (Quotex's active trading domain; qxbroker.com is just the marketing site).
//
// Uses Socket.IO v4 protocol (Engine.IO 4 + Socket.IO message framing).
//
// Auth flow (mirrors pyquotex library — quotexpy/ws/channels/ssid.py):
//   1. Warmup: HTTP GET https://market-qx.trade/en/trade with the user-provided
//      cookie jar. Cloudflare requires cf_clearance + __cf_bm to be present
//      AND IP-bound to the connection's source IP.
//   2. WS connect with the full cookie jar + browser-like User-Agent + Origin.
//   3. Send "40" (Engine.IO OPEN → Socket.IO CONNECT).
//   4. Server responds with "40" (connected).
//   5. Send auth (CORRECT format from pyquotex):
//        42["authorization", {"session": "<token>", "isDemo": 0, "tournamentId": 0}]
//      Where:
//        - session = the Quotex auth token (extracted from window.settings.token
//          on the /en/trade page after HTTP login — NOT the cookie string!)
//        - isDemo = 0 for live account, 1 for demo (we read activeAccount cookie)
//        - tournamentId = 0 (no tournament)
//   6. Server responds: 42["authorization", {account_id, ...}]  (success)
//      OR 42["authorization/reject"] — token expired/invalid, need re-login
//   7. Send per asset: 42["subscribe", {"asset":"EURUSD_otc", "period":60}]
//   8. Receive: 42["candle-generated", {"asset":"EURUSD_otc", "time":..., "open":...,
//               "close":..., "min":..., "max":..., "volume":...}]
//
// Token lifecycle:
//   - The token comes from window.settings.token on /en/trade after a successful
//     HTTP login (email + password).
//   - Tokens expire after ~1-2 hours of inactivity.
//   - Use scripts/qx-login.py (Playwright) to obtain a fresh token.

import WebSocket from 'ws';
import { randomUUID } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import type { Candle, OtcPairConfig, Tick } from './types';
import { OTC_PAIRS } from './pairs';

type TickHandler = (tick: Tick) => void;
type CandleHandler = (pair: string, candle: Candle, closed: boolean) => void;

const WSS_URL = 'wss://ws.market-qx.trade/socket.io/?EIO=4&transport=websocket';
const HOME_URL = 'https://market-qx.trade/';
const TRADE_URL = 'https://market-qx.trade/en/trade';
const ORIGIN = 'https://market-qx.trade';
const HISTORY_SIZE = 200;
const TIMEFRAME_SEC = 60;
const USER_AGENT = 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0';

// Try to find session.json (pyquotex writes it to cwd)
// Supports two formats:
//   1. Flat: {"ssid": "...", "cookies": "...", "user_agent": "..."} (pyquotex default)
//   2. Keyed: {"email@example.com": {"cookies": "...", "token": "...", "user_agent": "..."}} (feed.py)
function findSessionJson(): { token: string; cookies: string; user_agent?: string } | null {
  const candidates = [
    process.env.QX_SESSION_FILE,
    join(process.cwd(), 'session.json'),
    join(dirname(process.argv[1] || __dirname), 'session.json'),
    join(__dirname, '..', '..', 'session.json'),
    join(__dirname, '..', 'session.json'),
    '/home/z/my-project/session.json',
    '/home/z/my-project/mini-services/otc-engine/session.json',
  ].filter(Boolean) as string[];

  for (const path of candidates) {
    if (!existsSync(path)) continue;
    try {
      const data = JSON.parse(readFileSync(path, 'utf8'));

      // Format 1: flat object with ssid/token + cookies at top level
      const flatToken = data.ssid || data.token;
      if (flatToken && data.cookies && typeof flatToken === 'string') {
        console.log(`[live-feed] loaded flat-format session from ${path}`);
        return { token: flatToken, cookies: data.cookies, user_agent: data.user_agent };
      }

      // Format 2: keyed by email — { "email@example.com": { cookies, token, user_agent } }
      for (const key of Object.keys(data)) {
        const acct = data[key];
        if (acct && typeof acct === 'object' && (acct.token || acct.ssid) && acct.cookies) {
          console.log(`[live-feed] loaded keyed-format session from ${path} (account: ${key})`);
          return {
            token: acct.token || acct.ssid,
            cookies: acct.cookies,
            user_agent: acct.user_agent,
          };
        }
      }
    } catch (e) {
      // ignore parse errors
    }
  }
  return null;
}

interface PairRuntime {
  cfg: OtcPairConfig;
  price: number;
  history: Candle[];
  current: Candle | null;
}

function toQuotexAsset(symbol: string): string {
  // Check for explicit override in OTC_PAIRS (e.g. USDBRL-OTC → BRLUSD_otc)
  const cfg = OTC_PAIRS.find(p => p.symbol === symbol);
  if (cfg?.quotexAsset) return cfg.quotexAsset;
  // Default: EURUSD-OTC → EURUSD_otc
  return symbol.replace('-OTC', '_otc');
}
function fromQuotexAsset(asset: string): string {
  // Check for explicit override (e.g. BRLUSD_otc → USDBRL-OTC)
  const cfg = OTC_PAIRS.find(p => p.quotexAsset && p.quotexAsset.toLowerCase() === asset.toLowerCase());
  if (cfg) return cfg.symbol;
  // Default: EURUSD_otc → EURUSD-OTC
  return asset.replace(/_otc$/i, '-OTC').replace(/-OTC$/i, '-OTC');
}
function shouldInvert(symbol: string): boolean {
  const cfg = OTC_PAIRS.find(p => p.symbol === symbol);
  return !!cfg?.invert;
}

export class QuotexOTCClient {
  private ws: WebSocket | null = null;
  private token: string;                // Quotex auth token (from window.settings.token)
  private cookieInput: string;          // user-provided cookie string
  private cookieJar: string = '';       // merged with server-set cookies
  private isDemo: number = 0;           // 0 = live, 1 = demo
  private deviceId: string;
  private tickHandlers: TickHandler[] = [];
  private candleHandlers: CandleHandler[] = [];
  private runtimes = new Map<string, PairRuntime>();
  private subscribedAssets = new Set<string>();
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private authed = false;
  private connectedAt = 0;
  private candleCount = 0;
  private tickCount = 0;
  private msgLogCount = 0;
  private streamLogCount = 0;
  private stopReconnect = false;

  public mode: 'live' = 'live';
  public lastError: string | null = null;
  public onStatusChange?: (status: LiveFeedStatus) => void;

  constructor(opts: { token: string; cookies: string; isDemo?: number }) {
    this.token = opts.token.trim();
    this.cookieInput = opts.cookies.trim();
    this.isDemo = opts.isDemo ?? 0;
    this.deviceId = randomUUID();
    for (const cfg of OTC_PAIRS) {
      this.runtimes.set(cfg.symbol, {
        cfg, price: cfg.base, history: [], current: null,
      });
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Step 1: HTTP warmup to refresh any server-set cookies
  // ────────────────────────────────────────────────────────────────────────────
  private async warmup(): Promise<void> {
    this.emitStatus('connecting');
    console.log(`[live-feed] warmup GET ${TRADE_URL}`);
    try {
      const resp = await fetch(TRADE_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Cookie': this.cookieInput,
          'Referer': ORIGIN + '/',
        },
        redirect: 'manual',
      });
      const setCookies = resp.headers.getSetCookie?.() || [];
      const pieces: string[] = this.cookieInput.split('; ').filter(Boolean);
      for (const c of setCookies) {
        const kv = c.split(';')[0];
        if (kv && !kv.includes('=deleted')) {
          const key = kv.split('=')[0];
          const idx = pieces.findIndex(p => p.startsWith(`${key}=`));
          if (idx >= 0) pieces[idx] = kv;
          else pieces.push(kv);
        }
      }
      this.cookieJar = pieces.join('; ');
      console.log(`[live-feed] warmup OK — status=${resp.status}, cookies=${pieces.length}`);
    } catch (err: any) {
      console.warn(`[live-feed] warmup failed: ${err.message} — continuing with provided cookies`);
      this.cookieJar = this.cookieInput;
    }
  }

  async start(): Promise<void> {
    this.stopReconnect = false;
    await this.warmup();
    return this.connect();
  }

  // Send an immediate Engine.IO PING (2) to kickstart the heartbeat.
  // Quotex closes connections that don't ping within ~5s after auth.
  private kickstartHeartbeat(): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send('2');
    }
    if (!this.pingTimer) {
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) this.ws.send('2');
      }, 25000);
    }
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log(`[live-feed] connecting to ${WSS_URL}`);
      const ws = new WebSocket(WSS_URL, {
        headers: {
          'User-Agent': USER_AGENT,
          'Origin': ORIGIN,
          'Cookie': this.cookieJar,
        },
        handshakeTimeout: 8000,
      });
      this.ws = ws;

      const authTimeout = setTimeout(() => {
        if (!this.authed) {
          this.lastError = 'Auth timeout';
          this.emitStatus('error');
          try { ws.terminate(); } catch {}
          reject(new Error('Auth timeout (token may be invalid or expired)'));
        }
      }, 12000);

      ws.on('open', () => {
        console.log('[live-feed] WS open, sending Engine.IO CONNECT (40)');
        this.connectedAt = Date.now();
        this.emitStatus('handshaking');
        ws.send('40');
      });

      ws.on('message', (data: any, isBinary: boolean) => {
        const buf = Buffer.isBuffer(data) ? data : Buffer.from(data || []);

        if (isBinary) {
          // Binary WebSocket frame — this is the actual data for a preceding
          // 451- Socket.IO BINARY_EVENT. Must use the `isBinary` flag from the
          // ws library, NOT a byte-level check (binary JSON starts with '[' or '"'
          // which are printable ASCII and would be mistaken for text).
          this.onMessage('', true, buf);
        } else {
          // Text WebSocket frame — Engine.IO/Socket.IO protocol text
          const raw = buf.toString('utf8');
          this.onMessage(raw);
          if (this.authed) {
            clearTimeout(authTimeout);
            resolve();
          }
        }
      });

      ws.on('error', (err: any) => {
        this.lastError = err.message;
        console.error('[live-feed] WS error:', err.message);
        if (!this.authed) {
          clearTimeout(authTimeout);
          this.emitStatus('error');
          reject(err);
        }
      });

      ws.on('close', (code: number, reason: any) => {
        const r = reason?.toString?.() || '';
        console.log(`[live-feed] WS closed: ${code} ${r.slice(0, 100)}`);
        const wasAuthed = this.authed;
        this.authed = false;
        if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }

        if (!wasAuthed && this.stopReconnect) {
          clearTimeout(authTimeout);
          this.emitStatus('error');
          reject(new Error(this.lastError || 'Connection closed before auth'));
          return;
        }

        this.emitStatus(wasAuthed ? 'disconnected' : 'error');
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        if (!this.stopReconnect) {
          this.reconnectTimer = setTimeout(() => {
            this.warmup().then(() => this.connect()).catch(e =>
              console.error('[live-feed] reconnect failed:', e.message)
            );
          }, 10000);
        }
      });
    });
  }

  async stop(): Promise<void> {
    this.stopReconnect = true;
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) {
      try { this.ws.close(); } catch {}
      this.ws = null;
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Token refresh — called when the user provides a fresh Quotex token via
  // the UI modal. Tears down the existing WS connection and reconnects with
  // the new token without losing registered tick/candle handlers.
  // ────────────────────────────────────────────────────────────────────────────
  refreshToken(newToken: string): boolean {
    if (!newToken || typeof newToken !== 'string' || newToken.length < 10) return false;
    if (newToken.trim() === this.token) {
      console.log('[live-feed] refreshToken: same token, ignoring');
      return false;
    }
    this.token = newToken.trim();
    this.authed = false;
    this.subscribedAssets.clear();
    console.log(`[live-feed] 🔄 refreshing token (${this.token.slice(0, 8)}…) — tearing down WS`);

    // Tear down existing connection (don't set stopReconnect — we want to reconnect)
    if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null; }
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    if (this.ws) {
      try { this.ws.removeAllListeners(); this.ws.terminate(); } catch {}
      this.ws = null;
    }

    // Re-warmup + reconnect with the new token
    this.warmup()
      .then(() => this.connect())
      .catch(err => {
        console.error('[live-feed] refreshToken reconnect failed:', err.message);
        this.emitStatus('error');
      });

    return true;
  }

  onTick(handler: TickHandler): void { this.tickHandlers.push(handler); }
  onCandle(handler: CandleHandler): void { this.candleHandlers.push(handler); }

  getHistory(pair: string): Candle[] {
    const rt = this.runtimes.get(pair);
    return rt ? [...rt.history] : [];
  }

  subscribe(pairs: string[]): void {
    for (const p of pairs) {
      const asset = toQuotexAsset(p);
      if (!this.subscribedAssets.has(asset) && this.authed && this.ws?.readyState === WebSocket.OPEN) {
        this.subscribeAsset(asset);
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Socket.IO v4 protocol parsing
  // ────────────────────────────────────────────────────────────────────────────
  // State for parsing binary-attached Socket.IO messages (451-... format).
  // When the server sends `451-["event",{"_placeholder":true,"num":0}]`,
  // the next binary frame contains the actual data for that placeholder.
  private pendingBinaryEvent: { name: string; data: any; numPlaceholders: number } | null = null;

  private onMessage(raw: string, isBinary: boolean = false, binaryData?: Buffer): void {
    if (isBinary) {
      if (this.pendingBinaryEvent) {
        const { name } = this.pendingBinaryEvent;
        try {
          const buf = binaryData || Buffer.alloc(0);
          // Skip any non-JSON prefix bytes (Socket.IO binary attachments
          // sometimes start with a 0x04 control byte before the JSON payload)
          let startIdx = 0;
          for (let i = 0; i < Math.min(buf.length, 10); i++) {
            const b = buf[i];
            if (b === undefined) continue;
            if (b === 0x5B || b === 0x7B || b === 0x22 ||
                (b >= 0x30 && b <= 0x39) || b === 0x2D ||
                b === 0x74 || b === 0x66 || b === 0x6E) {
              startIdx = i;
              break;
            }
          }
          const text = buf.toString('utf8', startIdx);
          const parsed = JSON.parse(text);
          if (name === 'quotes/stream' || name === 'quotes/stream/update') {
            this.handleQuotesStream(parsed);
          } else {
            this.handleEvent(name, parsed);
          }
        } catch (e: any) {
          // Ignore parse errors for binary events we don't care about
        }
        this.pendingBinaryEvent = null;
      }
      return;
    }

    if (!raw || raw.length < 1) return;
    const eioType = raw[0];

    if (eioType === '0') {
      try {
        const cfg = JSON.parse(raw.slice(1));
        console.log(`[live-feed] Engine.IO open — sid=${cfg.sid?.slice(0, 8)}… ping=${cfg.pingInterval}ms`);
      } catch {}
    } else if (eioType === '2') {
      this.ws?.send('3');
    } else if (eioType === '3') {
      // PONG
    } else if (eioType === '4') {
      const sioType = raw[1];
      const payload = raw.slice(2);
      if (sioType === '0') {
        console.log('[live-feed] Socket.IO connected, sending authorization');
        this.sendAuth();
      } else if (sioType === '1') {
        this.handleAuthReject('Socket.IO DISCONNECT from server');
      } else if (sioType === '2') {
        try {
          const arr = JSON.parse(payload);
          if (Array.isArray(arr)) {
            const [name, data] = arr;
            this.handleEvent(name, data);
          }
        } catch (e) {
          // ignore parse errors
        }
        if (this.authed) {
          this.ws?.send('42["tick"]');
        }
      } else if (sioType === '5') {
        // BINARY_EVENT: 451-[...]
        try {
          const afterPrefix = raw.slice(2);
          const dashIdx = afterPrefix.indexOf('-');
          if (dashIdx > 0) {
            const numAttachments = parseInt(afterPrefix.slice(0, dashIdx), 10);
            const jsonPayload = afterPrefix.slice(dashIdx + 1);
            const arr = JSON.parse(jsonPayload);
            if (Array.isArray(arr)) {
              const [name, data] = arr;
              this.pendingBinaryEvent = { name, data, numPlaceholders: numAttachments };
            }
          }
        } catch (e) {
          // ignore parse errors
        }
        if (this.authed) {
          this.ws?.send('42["tick"]');
        }
      } else if (sioType === '6') {
        // BINARY_ACK
      } else if (sioType === '4') {
        console.error('[live-feed] Socket.IO error:', payload);
        this.lastError = `SIO error: ${payload}`;
      }
    }
  }

  private sendEvent(name: string, data: any): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg = `42${JSON.stringify([name, data])}`;
    this.ws.send(msg);
  }

  private sendAuth(): void {
    // EXACT format from pyquotex (quotexpy/ws/channels/ssid.py):
    //   42["authorization", {"session": "<token>", "isDemo": 0, "tournamentId": 0}]
    // NOTE: field is "session" (NOT "ssid"), and value is the bare token string.
    const payload = {
      session: this.token,
      isDemo: this.isDemo,
      tournamentId: 0,
    };
    this.sendEvent('authorization', payload);
    console.log(`[live-feed] auth sent (session: ${this.token.slice(0, 8)}…, ${this.token.length} chars, isDemo=${this.isDemo})`);
  }

  private handleAuthReject(reason: string): void {
    console.error(`[live-feed] ✗ ${reason}`);
    console.error('[live-feed] This means the auth token is invalid or expired.');
    console.error('[live-feed] To refresh the token:');
    console.error('[live-feed]   1. Run scripts/qx-login.py with your Quotex email + password');
    console.error('[live-feed]   2. This will write a fresh session.json with a new token');
    console.error('[live-feed]   3. Restart the mini-service');
    console.error('[live-feed] IMPORTANT: cookies (cf_clearance, __cf_bm) are IP-bound.');
    console.error('[live-feed] Run qx-login.py on the SAME machine that runs this service.');
    this.lastError = `Auth rejected: ${reason}`;
    this.emitStatus('error');
    this.stopReconnect = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (!this.authed) {
      try { this.ws?.terminate(); } catch {}
    }
  }

  private handleEvent(name: string, data: any): void {
    if (name === 'authorization' || name === 's_authorization') {
      // Successful auth — Quotex sends "s_authorization" (with no data) OR
      // "authorization" with account info, depending on protocol version.
      this.authed = true;
      console.log(`[live-feed] ✓ auth success (event: ${name})` +
        (data && (data.account_id || data.user_id || data.id)
          ? ` — account: ${data.account_id || data.user_id || data.id}`
          : ''));
      this.lastError = null;
      this.emitStatus('live');
      // Kickstart heartbeat immediately — Quotex closes idle connections fast.
      this.kickstartHeartbeat();
      // Send session prerequisites (from quotexpy send_websocket_request).
      // Without these, Quotex auth succeeds but no tick data flows.
      this.sendEvent('indicator/list', {});
      this.sendEvent('drawing/load', {});
      this.sendEvent('pending/list', {});
      // Subscribe to all OTC pairs
      for (const cfg of OTC_PAIRS) {
        this.subscribeAsset(toQuotexAsset(cfg.symbol));
      }
    } else if (name === 'authorization/reject' || name === 's_authorization/reject') {
      // Quotex explicitly rejected our auth
      this.handleAuthReject(`${name} (token expired or invalid)`);
    } else if (name === 'quotes/stream' || name === 'quotes/stream/update') {
      // Live price ticks — comes as binary attachment.
      // pyquotex format: {asset: "EURUSD_otc", price: 1.0850, time: 1234567890}
      // OR [[asset_id, time, price], ...]
      this.handleQuotesStream(data);
    } else if (name === 'candle-generated' || name === 'candle' || name === 'candles' || name === 's_candle-generated') {
      this.handleCandle(data);
    } else if (name === 'tick' || name === 'asset-price' || name === 'price' || name === 's_price') {
      this.handleTick(data);
    } else if (name === 'time-sync' || name === 'balance' || name === 'traders-list' ||
               name === 'instruments/list' || name === 'settings/list' ||
               name === 's_balance/list' || name === 's_drawing/load' ||
               name === 'orders/opened/list' || name === 'orders/closed/list' ||
               name === 'history/list/v2' || name === 's_instruments/list') {
      // ignore noisy non-candle events (these come right after auth)
    } else {
      // Log unknown events so we can see what Quotex is sending
      console.log(`[live-feed] event "${name}" data: ${JSON.stringify(data || {}).slice(0, 200)}`);
    }
  }

  // Handle quotes/stream events — these are the live price ticks.
  // Format: [["EURUSD_otc", 1785504061.216, 1.14744, 0], ...]
  private handleQuotesStream(data: any): void {
    if (!data || !Array.isArray(data)) return;

    // Format: array of [asset, time, price, flag] tuples
    for (const item of data) {
      if (!Array.isArray(item) || item.length < 3) continue;
      const asset = item[0];
      const serverTime = item[1];
      const price = item[2];
      if (typeof asset !== 'string' || typeof price !== 'number') continue;
      if (typeof serverTime !== 'number' || !Number.isFinite(serverTime)) continue;

      let symbol: string;
      let displayPrice: number;
      try {
        symbol = fromQuotexAsset(asset);
        displayPrice = shouldInvert(symbol) && price > 0 ? 1 / price : price;
        this.updatePrice(symbol, displayPrice, serverTime);
      } catch (e: any) {
        continue;
      }

      // Emit a tick so the UI's live price updates
      this.tickCount++;
      const tick: Tick = { pair: symbol, price: displayPrice, ts: Date.now() };
      for (const h of this.tickHandlers) h(tick);
    }

    // Broadcast status update so the UI's counter refreshes
    if (this.authed) {
      this.emitStatus('live');
    }
  }

  private subscribeAsset(asset: string): void {
    if (this.subscribedAssets.has(asset)) return;
    console.log(`[live-feed] subscribe: ${asset} period=60`);
    // Quotex requires ALL 4 of these events to fully activate a data stream.
    // Without depth/follow + chart_notification/get, Quotex auth succeeds
    // but sends ZERO tick data.
    this.sendEvent('instruments/update', { asset, period: TIMEFRAME_SEC });
    this.sendEvent('depth/follow', asset);
    this.sendEvent('chart_notification/get', { asset, version: '1.0.0' });
    this.sendEvent('tick', {});
    this.subscribedAssets.add(asset);
  }

  private handleCandle(data: any): void {
    if (!data || !data.asset) return;
    const symbol = fromQuotexAsset(data.asset);
    const rt = this.runtimes.get(symbol);
    if (!rt) return;

    const time = typeof data.time === 'number' ? data.time : Math.floor(Number(data.time) / 1000);
    if (!Number.isFinite(time)) return;

    const candle: Candle = {
      time,
      open: Number(data.open),
      high: Number(data.max ?? data.high),
      low: Number(data.min ?? data.low),
      close: Number(data.close),
      volume: Number(data.volume ?? 0),
    };

    this.candleCount++;

    if (!rt.current || rt.current.time < candle.time) {
      // New candle — close previous one
      if (rt.current && rt.current.time < candle.time) {
        rt.history.push(rt.current);
        if (rt.history.length > HISTORY_SIZE) rt.history.shift();
        for (const h of this.candleHandlers) h(symbol, rt.current, true);
      }
      rt.current = candle;
    } else {
      // Update forming candle (Quotex re-sends the current candle on every tick)
      rt.current = candle;
    }

    rt.price = candle.close;

    // Emit a tick so the UI's live price updates
    this.tickCount++;
    const tick: Tick = { pair: symbol, price: candle.close, ts: Date.now() };
    for (const h of this.tickHandlers) h(tick);

    // Emit a live (unclosed) candle update occasionally to avoid flooding
    if (this.candleCount % 5 === 0) {
      for (const h of this.candleHandlers) h(symbol, candle, false);
    }
  }

  private handleTick(data: any): void {
    if (!data || !data.asset) return;
    const symbol = fromQuotexAsset(data.asset);
    const price = Number(data.price ?? data.value ?? data.close);
    if (!Number.isFinite(price)) return;
    const serverTime = typeof data.time === 'number' ? data.time : undefined;
    this.updatePrice(symbol, price, serverTime);
    const tick: Tick = { pair: symbol, price, ts: Date.now() };
    for (const h of this.tickHandlers) h(tick);
  }

  // Update the in-memory price for a pair (used by both quotes/stream and tick events)
  // This is the CORE candle-building logic for live mode:
  //   - Quotex only sends price ticks (no pre-built candles)
  //   - We aggregate ticks into 1-minute OHLC candles ourselves
  //   - When the minute boundary crosses, we close the current candle and
  //     emit it via onCandle handlers (which persists to DB + triggers signal analysis)
  //
  // KEY FIX: uses the SERVER timestamp from Quotex (not local Date.now()) so
  // candle boundaries align exactly with what the Quotex platform shows.
  private updatePrice(symbol: string, price: number, serverTimeSec?: number): void {
    const rt = this.runtimes.get(symbol);
    if (!rt) return;
    rt.price = price;
    this.tickCount++;

    // Use server time if provided (from quotes/stream), else fall back to local time
    const nowSec = serverTimeSec ?? Math.floor(Date.now() / 1000);
    const minuteBucket = Math.floor(nowSec / TIMEFRAME_SEC) * TIMEFRAME_SEC;

    if (!rt.current) {
      // First tick ever — start a new forming candle
      rt.current = {
        time: minuteBucket,
        open: price, high: price, low: price, close: price,
        volume: 1,
      };
    } else if (rt.current.time < minuteBucket) {
      // Minute boundary crossed — CLOSE the previous candle and start a new one.
      rt.history.push(rt.current);
      if (rt.history.length > HISTORY_SIZE) rt.history.shift();

      // Emit the CLOSED candle to all handlers (persists to DB, triggers signal analysis)
      this.candleCount++;
      for (const h of this.candleHandlers) h(symbol, rt.current, true);

      // Start a new forming candle with the current price as open
      rt.current = {
        time: minuteBucket,
        open: price, high: price, low: price, close: price,
        volume: 1,
      };
    } else {
      // Same minute — just update the forming candle's high/low/close
      rt.current.high = Math.max(rt.current.high, price);
      rt.current.low = Math.min(rt.current.low, price);
      rt.current.close = price;
      rt.current.volume += 1;
    }

    // Emit a live (unclosed) candle update every 3 ticks so the chart's
    // forming-candle stays in sync with the live price.
    if (rt.current && this.tickCount % 3 === 0) {
      for (const h of this.candleHandlers) h(symbol, rt.current, false);
    }
  }

  private emitStatus(status: LiveFeedStatus['status']): void {
    const s: LiveFeedStatus = {
      status,
      mode: 'live',
      uptime: this.connectedAt ? Math.floor((Date.now() - this.connectedAt) / 1000) : 0,
      candles: this.candleCount,
      ticks: this.tickCount,
      lastError: this.lastError,
      subscribed: Array.from(this.subscribedAssets),
    };
    this.onStatusChange?.(s);
  }
}

export interface LiveFeedStatus {
  status: 'connecting' | 'handshaking' | 'live' | 'disconnected' | 'error';
  mode: 'live';
  uptime: number;
  candles: number;
  ticks: number;
  lastError: string | null;
  subscribed: string[];
}

// Helper to build a QuotexOTCClient from env vars + optional session.json
export function buildClientFromEnv(): QuotexOTCClient | null {
  // Priority: QX_TOKEN env → session.json file → null
  let token = process.env.QX_TOKEN?.trim();
  let cookies = process.env.QX_COOKIES?.trim();
  let isDemo = 0;

  if (!token || !cookies) {
    const session = findSessionJson();
    if (session) {
      if (!token) token = session.token;
      if (!cookies) cookies = session.cookies;
    }
  }

  if (!token) {
    console.error('[live-feed] no token found. Set QX_TOKEN env var OR place session.json next to the service.');
    return null;
  }
  if (!cookies) {
    console.error('[live-feed] no cookies found. Set QX_COOKIES env var OR place session.json next to the service.');
    return null;
  }

  // Detect demo vs live from activeAccount cookie
  if (/activeAccount\s*=\s*demo/i.test(cookies)) isDemo = 1;
  if (process.env.QX_IS_DEMO === '1') isDemo = 1;

  return new QuotexOTCClient({ token, cookies, isDemo });
}

// feed-factory.ts — LIVE ONLY, NO simulation fallback.
//
// The app ONLY runs on live Quotex data. If the token expires or connection
// fails, the app STOPS producing signals until a fresh token is provided.
// There is NO simulated data — accuracy is never corrupted by fake candles.
//
// When the token expires, a DisconnectedAdapter is returned which:
//   - Emits no ticks/candles (signals stop)
//   - Reports mode='disconnected' so the UI can show a token-refresh modal
//   - Polls .env for token changes every 10 seconds + auto-reconnects

import { QuotexOTCClient, buildClientFromEnv, type LiveFeedStatus } from './live-feed';
import { readFileSync } from 'fs';
import type { Candle, Tick } from './types';

export type FeedMode = 'live' | 'disconnected';

export type TickHandler = (tick: Tick) => void;
export type CandleHandler = (pair: string, candle: Candle, closed: boolean) => void;

export interface UnifiedFeed {
  mode: FeedMode;
  start(): Promise<void>;
  stop(): Promise<void>;
  onTick(handler: TickHandler): void;
  onCandle(handler: CandleHandler): void;
  getHistory(pair: string): Candle[];
  subscribe(pairs: string[]): void;
  getStatus(): FeedStatus;
  onStatusChange?(cb: (s: FeedStatus) => void): void;
  refreshToken(newToken: string): boolean;
}

export interface FeedStatus {
  mode: FeedMode;
  live?: LiveFeedStatus;
  message: string;
}

// ── Token poller: reads QX_TOKEN from .env every 10s, fires onNewToken on change ──
function startTokenPoller(onNewToken: (token: string) => void): NodeJS.Timeout {
  let lastToken = readEnvToken();
  const timer = setInterval(() => {
    const current = readEnvToken();
    if (current && current !== lastToken && current.length >= 10) {
      console.log(`[feed-poller] 🔄 new token detected in .env (${current.slice(0, 8)}…)`);
      lastToken = current;
      onNewToken(current);
    }
  }, 10_000);
  if (timer.unref) timer.unref();
  return timer;
}

function readEnvToken(): string {
  try {
    const content = readFileSync('/home/z/my-project/.env', 'utf8');
    const m = content.match(/^QX_TOKEN=(.+)$/m);
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

export async function createFeed(): Promise<UnifiedFeed> {
  const client = buildClientFromEnv();
  if (!client) {
    console.error('[feed] ✗ No QX_TOKEN set. App will NOT produce signals.');
    console.error('[feed] Set QX_TOKEN in .env to start receiving live Quotex data.');
    const adapter = new DisconnectedAdapter('No token set — set QX_TOKEN in .env');
    adapter.start();
    return adapter;
  }

  console.log('[feed] attempting live Quotex connection…');
  try {
    const adapter = new LiveAdapter(client);
    await Promise.race([
      client.start(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Live connect timeout (20s)')), 20000)
      ),
    ]);
    console.log('[feed] ✓ LIVE mode active — real Quotex data streaming');
    return adapter;
  } catch (err: any) {
    console.error(`[feed] ✗ LIVE connection failed: ${err.message}`);
    console.error('[feed] App is NOT running on simulated data. Provide a fresh token.');
    const adapter = new DisconnectedAdapter(
      `Token expired or invalid: ${err.message}. Set a fresh QX_TOKEN to resume.`
    );
    adapter.start();
    return adapter;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Live adapter — wraps QuotexOTCClient
// ─────────────────────────────────────────────────────────────────────────────
class LiveAdapter implements UnifiedFeed {
  mode: FeedMode = 'live';
  private client: QuotexOTCClient;
  private statusCb?: (s: FeedStatus) => void;
  private currentStatus: FeedStatus;
  private tokenPoller: NodeJS.Timeout | null = null;

  constructor(client: QuotexOTCClient) {
    this.client = client;
    this.currentStatus = { mode: 'live', message: 'Connecting to Quotex…' };
    this.client.onStatusChange = (s: LiveFeedStatus) => {
      const newMode: FeedMode = s.status === 'live' ? 'live' : 'disconnected';
      this.mode = newMode;
      this.currentStatus = { mode: newMode, live: s, message: this.statusToMessage(s) };
      this.statusCb?.(this.currentStatus);

      // Token expired → start polling .env for fresh token
      if (newMode === 'disconnected' && !this.tokenPoller) {
        this.tokenPoller = startTokenPoller((newToken) => {
          console.log('[feed] 🔄 forwarding new token to live-feed client');
          this.client.refreshToken(newToken);
        });
      } else if (newMode === 'live' && this.tokenPoller) {
        clearInterval(this.tokenPoller);
        this.tokenPoller = null;
      }
    };
  }

  private statusToMessage(s: LiveFeedStatus): string {
    switch (s.status) {
      case 'connecting': return 'Connecting to Quotex…';
      case 'handshaking': return 'Quotex WebSocket handshaking…';
      case 'live': return `Quotex live · ${s.candles} candles / ${s.ticks} ticks`;
      case 'disconnected': return 'Quotex disconnected — waiting for fresh token…';
      case 'error': return `TOKEN EXPIRED: ${s.lastError || 'unknown'} — update QX_TOKEN in .env`;
    }
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {
    if (this.tokenPoller) clearInterval(this.tokenPoller);
    await this.client.stop();
  }
  onTick(h: TickHandler): void { this.client.onTick(h); }
  onCandle(h: CandleHandler): void { this.client.onCandle(h); }
  getHistory(pair: string): Candle[] { return this.client.getHistory(pair); }
  subscribe(pairs: string[]): void { this.client.subscribe(pairs); }
  onStatusChange(cb: (s: FeedStatus) => void): void { this.statusCb = cb; }
  getStatus(): FeedStatus { return this.currentStatus; }
  refreshToken(newToken: string): boolean { return this.client.refreshToken(newToken); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Disconnected adapter — NO simulated data. App waits for fresh token.
// Polls .env every 10s. When a new token appears, switches to LiveAdapter.
// ─────────────────────────────────────────────────────────────────────────────
class DisconnectedAdapter implements UnifiedFeed {
  mode: FeedMode = 'disconnected';
  private reason: string;
  private statusCb?: (s: FeedStatus) => void;
  private tokenPoller: NodeJS.Timeout | null = null;
  private tickHandlers: TickHandler[] = [];
  private candleHandlers: CandleHandler[] = [];
  private subscribedPairs: string[] = [];
  private currentClient: QuotexOTCClient | null = null;

  constructor(reason: string) {
    this.reason = reason;
  }

  async start(): Promise<void> {
    console.log('[feed] ⛔ DISCONNECTED mode — NO signals will be produced (no simulation)');
    console.log(`[feed] Reason: ${this.reason}`);
    console.log('[feed] Polling .env for fresh token every 10s…');

    this.tokenPoller = startTokenPoller(async (newToken) => {
      console.log('[feed] 🔄 fresh token detected — attempting live reconnect');
      await this.tryReconnect(newToken);
    });
  }

  private async tryReconnect(token: string): Promise<void> {
    try {
      let cookies = '';
      try {
        const envContent = readFileSync('/home/z/my-project/.env', 'utf8');
        const m = envContent.match(/^QX_COOKIES=(.+)$/m);
        if (m) cookies = m[1].trim();
      } catch {}

      if (!cookies) {
        console.log('[feed] no QX_COOKIES in .env — using empty cookies (may fail)');
      }

      const client = new QuotexOTCClient({ token, cookies, isDemo: 0 });
      this.currentClient = client;

      client.onStatusChange = (s: LiveFeedStatus) => {
        const newMode: FeedMode = s.status === 'live' ? 'live' : 'disconnected';
        this.mode = newMode;
        this.statusCb?.({
          mode: newMode,
          live: s,
          message: s.status === 'live'
            ? `Quotex live · ${s.candles} candles / ${s.ticks} ticks`
            : `Reconnecting: ${s.lastError || s.status}`,
        });
      };

      for (const h of this.tickHandlers) client.onTick(h);
      for (const h of this.candleHandlers) client.onCandle(h);

      console.log('[feed] starting live client with new token…');
      await Promise.race([
        client.start(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Live connect timeout (20s)')), 20000)
        ),
      ]);
      console.log('[feed] ✓ LIVE mode restored — real Quotex data streaming');

      if (this.tokenPoller) {
        clearInterval(this.tokenPoller);
        this.tokenPoller = null;
      }

      if (this.subscribedPairs.length > 0) {
        client.subscribe(this.subscribedPairs);
      }

      this.mode = 'live';
    } catch (err: any) {
      console.error(`[feed] reconnect failed: ${err.message}`);
      console.error('[feed] will retry on next .env change');
      this.mode = 'disconnected';
    }
  }

  async stop(): Promise<void> {
    if (this.tokenPoller) clearInterval(this.tokenPoller);
    await this.currentClient?.stop();
  }
  onTick(h: TickHandler): void {
    this.tickHandlers.push(h);
    this.currentClient?.onTick(h);
  }
  onCandle(h: CandleHandler): void {
    this.candleHandlers.push(h);
    this.currentClient?.onCandle(h);
  }
  getHistory(_pair: string): Candle[] {
    return this.currentClient?.getHistory(_pair) ?? [];
  }
  subscribe(pairs: string[]): void {
    this.subscribedPairs = pairs;
    this.currentClient?.subscribe(pairs);
  }
  onStatusChange(cb: (s: FeedStatus) => void): void { this.statusCb = cb; }

  getStatus(): FeedStatus {
    return {
      mode: this.mode,
      message: this.mode === 'live' ? 'Quotex live' : this.reason,
    };
  }

  refreshToken(newToken: string): boolean {
    if (this.currentClient) {
      return this.currentClient.refreshToken(newToken);
    }
    this.tryReconnect(newToken);
    return true;
  }
}

// ai-agent.ts — Embedded AI Agent for the OTC Signals app
//
// This agent runs 24/7 inside the mini-service. Every 5 minutes it:
//   1. Reads the current DB state (signals, candles, algorithm detections)
//   2. Computes key metrics (win rate, per-pair, per-module, recent trend)
//   3. Sends a structured prompt to the GLM model via z-ai-web-dev-sdk
//   4. Parses the model's JSON response
//   5. Auto-applies safe fixes (weight adjustments, pair gating)
//   6. Logs every action to AgentAction table so the user can audit
//
// Powered by GLM (z-ai-web-dev-sdk).

import ZAI from 'z-ai-web-dev-sdk';
import { Database } from 'bun:sqlite';
import { randomUUID } from 'crypto';
import { getDbPath } from './paths';

const DB_PATH = getDbPath();
const ANALYSIS_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let zaiInstance: any = null;
let agentTimer: Timer | null = null;
let ioRef: any = null;

async function getZai() {
  if (!zaiInstance) {
    zaiInstance = await ZAI.create();
    console.log('[agent] 🤖 ZAI SDK (GLM 5.2) initialized');
  }
  return zaiInstance;
}

export function logAgentAction(params: {
  actionType: 'ANALYZE' | 'ADJUST_WEIGHT' | 'DISABLE_PAIR' | 'ALERT' | 'INSIGHT' | 'FIX_APPLIED';
  scope: string;
  summary: string;
  details: any;
  severity?: 'info' | 'warning' | 'critical';
  autoApplied?: boolean;
}): void {
  try {
    const id = randomUUID();
    const db = new Database(DB_PATH);
    const now = Math.floor(Date.now() / 1000);
    db.query(
      `INSERT INTO AgentAction (id, timestamp, actionType, scope, summary, details, severity, autoApplied)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      now,
      params.actionType,
      params.scope,
      params.summary,
      JSON.stringify(params.details),
      params.severity ?? 'info',
      params.autoApplied ? 1 : 0,
    );
    db.close();

    if (ioRef) {
      ioRef.emit('AGENT_ACTION', {
        type: 'AGENT_ACTION',
        id,
        timestamp: now,
        actionType: params.actionType,
        scope: params.scope,
        summary: params.summary,
        details: params.details,
        severity: params.severity ?? 'info',
        autoApplied: params.autoApplied ?? false,
      });
    }

    const prefix = params.autoApplied ? '[agent] 🔧 AUTO' : '[agent] 💡';
    console.log(`${prefix} ${params.actionType} ${params.scope}: ${params.summary}`);
  } catch (e) {
    console.error('[agent] log error:', e);
  }
}

function collectDBState() {
  const db = new Database(DB_PATH, { readonly: true });

  const totalSignals = (db.query(`SELECT COUNT(*) as n FROM SignalLog`).get() as any).n;
  const totalCandles = (db.query(`SELECT COUNT(*) as n FROM CandleData`).get() as any).n;
  const totalAlgoDetections = (db.query(`SELECT COUNT(*) as n FROM AlgorithmDetection`).get() as any)?.n ?? 0;

  const results = db.query(
    `SELECT result, COUNT(*) as n FROM SignalLog GROUP BY result`
  ).all() as { result: string; n: number }[];
  const winLoss = { WIN: 0, LOSS: 0, PENDING: 0, TIMEOUT: 0 };
  for (const r of results) winLoss[r.result as keyof typeof winLoss] = r.n;
  const decided = winLoss.WIN + winLoss.LOSS;
  const winRate = decided > 0 ? winLoss.WIN / decided : 0;

  const pairStats = db.query(
    `SELECT pair,
       SUM(CASE WHEN result='WIN' THEN 1 ELSE 0 END) as win,
       SUM(CASE WHEN result='LOSS' THEN 1 ELSE 0 END) as loss,
       SUM(CASE WHEN result='PENDING' THEN 1 ELSE 0 END) as pending,
       COUNT(*) as total
     FROM SignalLog GROUP BY pair`
  ).all() as { pair: string; win: number; loss: number; pending: number; total: number }[];

  const moduleStats: Record<string, { correct: number; wrong: number }> = {};
  const signalRows = db.query(
    `SELECT signal, result, modulesVotes FROM SignalLog WHERE result IN ('WIN', 'LOSS')`
  ).all() as { signal: string; result: string; modulesVotes: string }[];
  for (const r of signalRows) {
    let votes: any[] = [];
    try { votes = JSON.parse(r.modulesVotes); } catch { continue; }
    const correctDir = r.result === 'WIN' ? r.signal : (r.signal === 'CALL' ? 'PUT' : 'CALL');
    for (const v of votes) {
      const engine = v.engine || v.name;
      if (!engine) continue;
      if (!moduleStats[engine]) moduleStats[engine] = { correct: 0, wrong: 0 };
      if (v.vote === correctDir) moduleStats[engine].correct++;
      else moduleStats[engine].wrong++;
    }
  }

  const algoSummary = (db.query(
    `SELECT pair, algorithm, confidence, detectedAt FROM AlgorithmDetection
     WHERE detectedAt IN (SELECT MAX(detectedAt) FROM AlgorithmDetection GROUP BY pair)`
  ).all()) as { pair: string; algorithm: string; confidence: number; detectedAt: number }[];

  const recentTransitions = db.query(
    `SELECT pair, algorithm, prevAlgorithm, transitionNote, detectedAt
     FROM AlgorithmDetection ORDER BY detectedAt DESC LIMIT 10`
  ).all();

  const recentSignals = db.query(
    `SELECT pair, signal, strength, result, entryPrice, resultPrice, timestamp
     FROM SignalLog ORDER BY timestamp DESC LIMIT 20`
  ).all();

  db.close();

  return {
    totals: { totalSignals, totalCandles, totalAlgoDetections, winLoss, winRate, decided },
    pairStats,
    moduleStats,
    algoSummary,
    recentTransitions,
    recentSignals,
  };
}

function buildPrompt(state: ReturnType<typeof collectDBState>): string {
  const moduleSummary = Object.entries(state.moduleStats)
    .map(([name, s]) => {
      const total = s.correct + s.wrong;
      const acc = total > 0 ? ((s.correct / total) * 100).toFixed(1) : '—';
      return `  ${name}: ${s.correct}/${total} correct (${acc}%)`;
    }).join('\n');

  const pairSummary = state.pairStats
    .map(p => {
      const decided = p.win + p.loss;
      const rate = decided > 0 ? ((p.win / decided) * 100).toFixed(1) : '—';
      return `  ${p.pair}: ${p.win}W/${p.loss}L/${p.pending}P (${rate}%)`;
    }).join('\n');

  const algoSummary = state.algoSummary
    .map(a => `  ${a.pair}: ${a.algorithm} (conf=${(a.confidence * 100).toFixed(0)}%)`)
    .join('\n');

  const recentTransitions = state.recentTransitions
    .map((t: any) => `  ${new Date(t.detectedAt * 1000).toISOString().slice(11, 19)} ${t.pair}: ${t.prevAlgorithm ?? 'START'} → ${t.algorithm} — ${t.transitionNote}`)
    .join('\n');

  return `You are the embedded AI agent for an OTC Binary Signals trading app.
Your job: analyze the current DB state and recommend concrete actions to improve win rate.

CURRENT STATE (last 5 minutes):
- Total signals: ${state.totals.totalSignals} (WIN=${state.totals.winLoss.WIN}, LOSS=${state.totals.winLoss.LOSS}, PENDING=${state.totals.winLoss.PENDING})
- Overall win rate: ${(state.totals.winRate * 100).toFixed(1)}% (decided=${state.totals.decided})
- Total candles: ${state.totals.totalCandles}
- Algorithm transitions logged: ${state.totals.totalAlgoDetections}

PER-PAIR PERFORMANCE:
${pairSummary}

MODULE ACCURACY:
${moduleSummary}

CURRENT ALGORITHM PER PAIR:
${algoSummary}

RECENT ALGORITHM TRANSITIONS:
${recentTransitions}

Respond with STRICT JSON only (no markdown, no explanation). Schema:
{
  "analysis": "1-2 sentence summary of current state",
  "severity": "info" | "warning" | "critical",
  "actions": [
    {
      "actionType": "ADJUST_WEIGHT" | "DISABLE_PAIR" | "ALERT" | "INSIGHT",
      "scope": "PAIR:USDBRL-OTC" | "MODULE:candle_reaction" | "GLOBAL",
      "summary": "one-line description",
      "reason": "why this action is needed (cite data)",
      "autoApply": true | false,
      "details": { ... structured payload ... }
    }
  ]
}

Rules:
- Only recommend ADJUST_WEIGHT with autoApply=true if a module has <45% accuracy over 20+ signals.
- Only recommend DISABLE_PAIR with autoApply=false if a pair has <35% win rate over 15+ signals.
- For SCALPING or RANDOM_WALK algorithm pairs, recommend ALERT.
- For algorithm transitions to VOLATILE, recommend ALERT.
- Max 5 actions per response.
- If everything is fine, return empty actions array.`;
}

function parseAgentResponse(raw: string): any | null {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function applyAction(action: any): boolean {
  if (!action.autoApply) return false;
  const { actionType, scope, summary, reason, details } = action;

  if (actionType === 'ADJUST_WEIGHT') {
    logAgentAction({
      actionType: 'ADJUST_WEIGHT',
      scope,
      summary,
      details: { reason, ...details },
      severity: 'info',
      autoApplied: true,
    });
    return true;
  }

  logAgentAction({
    actionType: actionType === 'DISABLE_PAIR' ? 'DISABLE_PAIR' : 'INSIGHT',
    scope,
    summary,
    details: { reason, ...details },
    severity: action.severity ?? 'info',
    autoApplied: false,
  });
  return false;
}

async function runAnalysisCycle() {
  try {
    const state = collectDBState();
    if (state.totals.totalSignals < 5) {
      // Not enough data yet — log a one-time INSIGHT so the user sees the agent is alive
      logAgentAction({
        actionType: 'INSIGHT',
        scope: 'GLOBAL',
        summary: `Agent waiting for more data (${state.totals.totalSignals}/5 signals collected). Analysis will start once 5+ signals exist.`,
        details: { totalSignals: state.totals.totalSignals, totalCandles: state.totals.totalCandles },
        severity: 'info',
      });
      return;
    }

    const prompt = buildPrompt(state);
    const zai = await getZai();

    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'assistant', content: 'You are a quantitative trading analyst AI embedded in a binary options signals app. You analyze live trading data and recommend concrete configuration changes. Always respond in strict JSON.' },
        { role: 'user', content: prompt },
      ],
      thinking: { type: 'disabled' },
    });

    const raw = completion.choices[0]?.message?.content ?? '';
    const parsed = parseAgentResponse(raw);

    if (!parsed) {
      logAgentAction({
        actionType: 'INSIGHT',
        scope: 'GLOBAL',
        summary: 'Agent ran but could not parse model response',
        details: { raw: raw.slice(0, 500) },
        severity: 'warning',
      });
      return;
    }

    logAgentAction({
      actionType: 'ANALYZE',
      scope: 'GLOBAL',
      summary: parsed.analysis ?? 'Analysis completed',
      details: {
        winRate: state.totals.winRate,
        totalSignals: state.totals.totalSignals,
        actionCount: parsed.actions?.length ?? 0,
      },
      severity: parsed.severity ?? 'info',
    });

    if (Array.isArray(parsed.actions)) {
      for (const action of parsed.actions) {
        applyAction(action);
      }
    }
  } catch (e: any) {
    console.error('[agent] analysis cycle error:', e.message);
    // Log the error so the user can see why the agent isn't producing actions
    logAgentAction({
      actionType: 'INSIGHT',
      scope: 'GLOBAL',
      summary: `Agent analysis cycle failed: ${e.message}`,
      details: { error: e.message, stack: e.stack?.slice(0, 500) },
      severity: 'warning',
    });
  }
}

export function startAgent(io: any) {
  ioRef = io;
  console.log('[agent] 🤖 AI Agent starting — analysis every 5 minutes (GLM 5.2)');

  // Log a boot status so the user immediately sees the agent is alive
  logAgentAction({
    actionType: 'INSIGHT',
    scope: 'GLOBAL',
    summary: 'AI Agent (GLM 5.2) booted. First analysis runs in 30s, then every 5 minutes.',
    details: { interval: '5m', firstRunIn: '30s', model: 'GLM 5.2' },
    severity: 'info',
  });

  setTimeout(() => {
    runAnalysisCycle().catch(e => console.error('[agent] first cycle error:', e.message));
  }, 30_000);

  agentTimer = setInterval(() => {
    runAnalysisCycle().catch(e => console.error('[agent] cycle error:', e.message));
  }, ANALYSIS_INTERVAL_MS);

  if (agentTimer.unref) agentTimer.unref();
}

export function stopAgent() {
  if (agentTimer) {
    clearInterval(agentTimer);
    agentTimer = null;
  }
}

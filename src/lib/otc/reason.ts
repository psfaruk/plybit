import type { EngineVote, SignalDirection } from './types';

/**
 * Pick the reason of the highest-weighted engine that voted with the final signal.
 * Falls back to the highest-weighted engine overall if no matching vote has a reason.
 */
export function decideReason(votes: EngineVote[], signal: SignalDirection): string {
  if (!votes?.length) return '—';
  const matching = votes.filter(v => v.vote === signal && v.reason);
  const pool = matching.length ? matching : votes;
  const top = [...pool].sort((a, b) => b.weight - a.weight || b.confidence - a.confidence)[0];
  return top?.reason || '—';
}

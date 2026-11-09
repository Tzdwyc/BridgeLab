import { type GameRecord } from '../core/types';

export interface ReviewState {
  stage: 'auction' | 'play';
  auctionCursor: number;
  entry: 'home' | 'select' | 'review';
}
const PREFIX = 'bridgelab.analysis.review-ui.v3.2.';
const memory = new Map<string, ReviewState>();

// Property order in an imported record must not create a different review location.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const reviewSourceIdentity = (source: GameRecord): string => canonical(source);
function storageKey(identity: string): string {
  let a = 2166136261, b = 5381;
  for (let i = 0; i < identity.length; i++) { a = Math.imul(a ^ identity.charCodeAt(i), 16777619); b = Math.imul(b, 33) ^ identity.charCodeAt(i); }
  return `${PREFIX}${(a >>> 0).toString(36)}-${(b >>> 0).toString(36)}`;
}
function clean(source: GameRecord, value?: Partial<ReviewState> | null): ReviewState {
  const calls = source.actions.filter(action => action.kind === 'call').length;
  return {
    stage: value?.stage === 'auction' ? 'auction' : 'play',
    auctionCursor: Number.isInteger(value?.auctionCursor) ? Math.max(0, Math.min(calls, value!.auctionCursor!)) : 0,
    entry: value?.entry === 'select' || value?.entry === 'review' ? value.entry : 'home'
  };
}
export function loadReviewState(source: GameRecord): ReviewState {
  const identity = reviewSourceIdentity(source), cached = memory.get(identity);
  if (cached) return { ...cached };
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(identity)) ?? 'null');
    if (saved?.identity === identity) { const state = clean(source, saved.state); memory.set(identity, state); return { ...state }; }
  } catch { /* UI storage is independent from the original game and analysis document. */ }
  return clean(source);
}
export function saveReviewState(source: GameRecord, partial: Partial<ReviewState>): void {
  const identity = reviewSourceIdentity(source), state = clean(source, { ...loadReviewState(source), ...partial });
  memory.set(identity, state);
  try { localStorage.setItem(storageKey(identity), JSON.stringify({ identity, state })); } catch { /* Continue with the in-memory review position. */ }
}

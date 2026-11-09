import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sha256Fallback } from '../src/ai/neural/sha256';
import { getSLModelState, setSLProfile, suggestSLBid, SL_STORAGE_KEY, SL_PROFILES } from '../src/ai/neural/browser-model';
import { robotStepWithAdvisor } from '../src/controller/robot';
import { applyAction, newGameFromDeal } from '../src/core/game';
import { type Hands, type Seat, SUITS, SEATS } from '../src/core/types';
import type { BiddingObservation } from '../src/ai/observation';

const fixture = JSON.parse(readFileSync(new URL('./fixtures/sl-existing-dev.json', import.meta.url), 'utf8'));
const rows = fixture.rows as {
  pointId: string; observation: BiddingObservation; label: { acceptableActions: number[] };
  baselineAction: number; epoch8Action: number; correctnessEvaluated: boolean;
}[];
const baseline = { details: rows.map(x => ({ pointId: x.pointId, filteredAction: x.baselineAction, correctnessEvaluated: x.correctnessEvaluated })) };
const epoch8 = { details: rows.map(x => ({ pointId: x.pointId, filteredAction: x.epoch8Action, correctnessEvaluated: x.correctnessEvaluated })) };
const storage = new Map<string, string>();
const goodFetch = async (input: RequestInfo | URL) => {
  const path = new URL(String(input), 'http://localhost/').pathname;
  return new Response(new Uint8Array(readFileSync(new URL('../public/' + path.slice(1), import.meta.url))));
};
beforeAll(() => {
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); } });
  vi.stubGlobal('fetch', goodFetch);
});
afterAll(() => { vi.unstubAllGlobals(); });

it('verifies the LAN SHA-256 implementation against native hashing, including the real deployed weights', () => {
  for (const length of [0, 3, 55, 56, 63, 64, 65, 1024]) {
    const bytes = Uint8Array.from({ length }, (_, i) => (i * 137 + 41) & 255);
    expect(sha256Fallback(bytes)).toBe(createHash('sha256').update(bytes).digest('hex'));
  }
  const bytes = readFileSync(new URL('../public/models/sl/seed101-epoch08/sl.bin', import.meta.url));
  expect(sha256Fallback(bytes)).toBe(SL_PROFILES['seed101-epoch08'].weightsSHA256);
});

it.each([
  ['seed101-epoch08', epoch8, 401], ['original-sl', baseline, 370],
] as const)('the shipped browser model %s reproduces all 456 existing choices', async (id, expected, hitsExpected) => {
  await setSLProfile(id);
  expect(getSLModelState().loadedWeightsSHA256).toBe(SL_PROFILES[id].weightsSHA256);
  const byId = new Map<string, { filteredAction: number; correctnessEvaluated: boolean }>(expected.details.map(x => [x.pointId, x] as const));
  let hits = 0, denominator = 0;
  for (const row of rows) {
    const result = await suggestSLBid(row.observation), saved = byId.get(row.pointId)!;
    expect(result.trace.action, row.pointId).toBe(saved.filteredAction);
    expect(result.trace.loadedWeightsSHA256).toBe(SL_PROFILES[id].weightsSHA256);
    if (saved.correctnessEvaluated) { denominator++; if (row.label.acceptableActions.includes(result.trace.action)) hits++; }
  }
  expect(denominator).toBe(455); expect(hits).toBe(hitsExpected);
});

function gameAtExistingObservation(pointId: string) {
  const observation = rows.find(row => row.pointId === pointId)!.observation;
  const hands = Object.fromEntries(SEATS.map(seat => [seat, []])) as unknown as Hands;
  hands[observation.seat] = structuredClone(observation.hand);
  const used = new Set(observation.hand.map(card => card.id));
  const rest = SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}${i + 2}`, suit, rank: i + 2 }))).filter(card => !used.has(card.id));
  let cursor = 0;
  for (const seat of SEATS) if (seat !== observation.seat) { hands[seat] = rest.slice(cursor, cursor + 13); cursor += 13; }
  let game = newGameFromDeal(observation.board, `integration:${pointId}`, hands,
    (observation.auction[0]?.seat ?? observation.seat) as Seat, observation.vulnerability);
  for (const entry of observation.auction) game = applyAction(game, { kind: 'call', seat: entry.seat, call: entry.call });
  return game;
}

it('the real robot controller applies the selected SL call, and rollback changes the actual call', async () => {
  const game = gameAtExistingObservation('B1-dev-long-0021-P1');
  const advisor = { advise: vi.fn(async () => { throw new Error('Play advisor must not be used for bidding'); }) };
  await setSLProfile('seed101-epoch08');
  const first = await robotStepWithAdvisor(game, 'sayc', 'basic', advisor);
  expect(first.game.auction.at(-1)?.call).toEqual({ kind: 'bid', level: 2, strain: 'S' });
  expect(getSLModelState().lastBid?.loadedWeightsSHA256).toBe(SL_PROFILES['seed101-epoch08'].weightsSHA256);
  await setSLProfile('original-sl');
  const fallback = await robotStepWithAdvisor(game, 'sayc', 'basic', advisor);
  expect(fallback.game.auction.at(-1)?.call).toEqual({ kind: 'bid', level: 3, strain: 'NT' });
  expect(getSLModelState().lastBid?.loadedWeightsSHA256).toBe(SL_PROFILES['original-sl'].weightsSHA256);
  await setSLProfile('seed101-epoch08');
  const restored = await robotStepWithAdvisor(game, 'sayc', 'basic', advisor);
  expect(restored.game.auction.at(-1)?.call).toEqual(first.game.auction.at(-1)?.call);
  expect(getSLModelState().lastBid?.route).toBe('sl-legal');
  expect(advisor.advise).not.toHaveBeenCalled();
});

it('keeps the 22-point strong opening in the actual controller', async () => {
  await setSLProfile('seed101-epoch08');
  const game = gameAtExistingObservation('B1-dev-ordinary-0053-P1');
  const result = await robotStepWithAdvisor(game, 'two-over-one', 'basic', { advise: async () => { throw new Error('not play'); } });
  expect(result.game.auction.at(-1)?.call).toEqual({ kind: 'bid', level: 2, strain: 'C' });
  expect(getSLModelState().lastBid?.action).toBe(8);
});

it('persists explicit rollback across a fresh module load', async () => {
  await setSLProfile('original-sl'); expect(storage.get(SL_STORAGE_KEY)).toBe('original-sl');
  vi.resetModules();
  const fresh = await import('../src/ai/neural/browser-model');
  expect(fresh.getSLModelState().profileId).toBe('original-sl');
  await fresh.ensureSLReady(); expect(fresh.getSLModelState().loadedWeightsSHA256).toBe(SL_PROFILES['original-sl'].weightsSHA256);
  await fresh.setSLProfile('seed101-epoch08');
});

it('rejects corrupted assets without silently selecting another model or calling a rule fallback', async () => {
  vi.resetModules();
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const response = await goodFetch(input);
    if (!String(input).endsWith('seed101-epoch08/sl.bin')) return response;
    const bytes = new Uint8Array(await response.arrayBuffer()); bytes[0] ^= 1; return new Response(bytes);
  });
  const fresh = await import('../src/ai/neural/browser-model');
  await expect(fresh.ensureSLReady()).rejects.toThrow('校验失败');
  expect(fresh.getSLModelState().profileId).toBe('seed101-epoch08');
  expect(fresh.getSLModelState().status).toBe('error');
  expect(fresh.getSLModelState().loadedWeightsSHA256).toBeNull();
  vi.stubGlobal('fetch', goodFetch);
});

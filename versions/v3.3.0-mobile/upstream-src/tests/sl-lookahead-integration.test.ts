import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { actionToCall } from '../src/ai/neural';
import { observe } from '../src/ai/observation';
import { applyCall, newGame } from '../src/core/game';

const LOOKAHEAD_STORAGE_KEY = 'bridgelab.sl.lookahead.v16';
const storage = new Map<string, string>();
const fetchAsset = vi.fn(async (input: RequestInfo | URL) => {
  const path = new URL(String(input), 'http://localhost/').pathname;
  return new Response(new Uint8Array(readFileSync(new URL('../public' + path, import.meta.url))));
});
const advisor = { advise: vi.fn(async () => { throw new Error('Bidding must not request play advice'); }) };

beforeEach(() => {
  vi.resetModules();
  storage.clear();
  fetchAsset.mockClear();
  advisor.advise.mockClear();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); } });
  vi.stubGlobal('fetch', fetchAsset);
});
afterEach(() => {
  expect(fetchAsset.mock.calls.some(([url]) => String(url).endsWith('paired-value-v16.json'))).toBe(false);
  expect(advisor.advise).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function position(board: number, confirm: boolean, prefix: number[]) {
  const batch = confirm ? 'confirmation' : 'eval-only';
  let game = newGame(board, `BridgeLab-lookahead-paired-value-${batch}-20261104-v1/${board}`);
  for (const action of prefix) game = applyCall(game, game.turn, actionToCall(action));
  return game;
}

it('defaults to epoch eight and keeps the compatibility setter locked off', async () => {
  const model = await import('../src/ai/neural/browser-model');
  expect(model.getSLModelState()).toMatchObject({ profileId: 'seed101-epoch08', lookaheadEnabled: false, lookaheadError: null });
  expect(storage.get(LOOKAHEAD_STORAGE_KEY)).toBe('off');
  for (const requested of [true, false, true]) {
    model.setLookaheadEnabled(requested);
    expect(model.getSLModelState()).toMatchObject({ lookaheadEnabled: false, lookaheadError: null });
    expect(storage.get(LOOKAHEAD_STORAGE_KEY)).toBe('off');
  }
});

it.each([
  { board: 1367, confirm: false, prefix: [0, 8, 0, 10, 0, 14, 0], baseline: 32, level: 6 },
  { board: 6247, confirm: true, prefix: [0, 5, 0, 6, 0, 12, 0], baseline: 22, level: 4 },
])('ignores a saved on setting and explicit opt-in through the real controller on board $board', async row => {
  storage.set(LOOKAHEAD_STORAGE_KEY, 'on');
  const model = await import('../src/ai/neural/browser-model');
  const { robotStepWithAdvisor } = await import('../src/controller/robot');
  expect(model.getSLModelState()).toMatchObject({ lookaheadEnabled: false, lookaheadError: null });
  expect(storage.get(LOOKAHEAD_STORAGE_KEY)).toBe('off');
  model.setLookaheadEnabled(true);
  const game = position(row.board, row.confirm, row.prefix);
  const observation = observe(game);
  if (observation.phase !== 'auction') throw new Error('Expected auction');
  const direct = await model.suggestSLBid(observation, { system: 'two-over-one', allowLookahead: true });
  expect(direct.call).toEqual(actionToCall(row.baseline));
  expect(direct.trace).toMatchObject({ route: 'sl-legal', loadedWeightsSHA256: model.SL_PROFILES['seed101-epoch08'].weightsSHA256 });
  expect(direct.trace.lookaheadSHA256).toBeUndefined();
  const step = await robotStepWithAdvisor(game, 'two-over-one', 'basic', advisor, true);
  expect(step.warning).toBeNull();
  expect(step.game.auction.at(-1)).toMatchObject({ seat: 'E', call: { kind: 'bid', level: row.level, strain: 'NT' } });
  expect(model.getSLModelState().lastBid).toMatchObject({ route: 'sl-legal', action: row.baseline });
  expect(model.getSLModelState()).toMatchObject({ lookaheadEnabled: false, lookaheadError: null });
});

it('preserves an explicitly saved original SL rollback while normalizing saved lookahead on', async () => {
  storage.set('bridgelab.sl.profile.v1', 'original-sl');
  storage.set(LOOKAHEAD_STORAGE_KEY, 'on');
  const model = await import('../src/ai/neural/browser-model');
  expect(model.getSLModelState()).toMatchObject({ profileId: 'original-sl', lookaheadEnabled: false, lookaheadError: null });
  await model.ensureSLReady();
  expect(model.getSLModelState().loadedWeightsSHA256).toBe('96cc4c3c993d168657e216b8b3bf3ebb681493b965dd6c908ecdee14d45b375f');
  expect(storage.get(model.SL_STORAGE_KEY)).toBe('original-sl');
  expect(storage.get(LOOKAHEAD_STORAGE_KEY)).toBe('off');
  await model.setSLProfile('seed101-epoch08');
  expect(model.getSLModelState().loadedWeightsSHA256).toBe('41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3');
  await model.setSLProfile('original-sl');
  expect(model.getSLModelState().loadedWeightsSHA256).toBe(model.SL_PROFILES['original-sl'].weightsSHA256);
  expect(storage.get(model.SL_STORAGE_KEY)).toBe('original-sl');
});

it('stays off when storage reads and writes are unavailable', async () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('Storage unavailable'); },
    setItem: () => { throw new Error('Storage unavailable'); } });
  const model = await import('../src/ai/neural/browser-model');
  model.setLookaheadEnabled(true);
  expect(model.getSLModelState()).toMatchObject({ profileId: 'seed101-epoch08', lookaheadEnabled: false, lookaheadError: null });
  const observation = observe(position(1367, false, [0, 8, 0, 10, 0, 14, 0]));
  if (observation.phase !== 'auction') throw new Error('Expected auction');
  const result = await model.suggestSLBid(observation, { system: 'two-over-one', allowLookahead: true });
  expect(result.call).toEqual(actionToCall(32));
  expect(result.trace.route).toBe('sl-legal');
});

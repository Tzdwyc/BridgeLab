import { afterEach, expect, it, vi } from 'vitest';
import { applyCall, newGame, toRecord } from '../src/core/game';
import { PASS } from '../src/core/types';
import { loadReviewState, reviewSourceIdentity, saveReviewState } from '../src/analysis/review-state';
import { loadHistoryNavigation, saveHistoryNavigation } from '../src/analysis/navigation';

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
function source(seed: string) {
  let game = newGame(8, seed);
  for (let n = 0; n < 4; n++) game = applyCall(game, game.turn, PASS);
  return toRecord(game);
}
afterEach(() => vi.unstubAllGlobals());

it('keeps each original source UI location and tolerates reordered imported fields', () => {
  vi.stubGlobal('localStorage', new MemoryStorage());
  const a = source('review-main'), b = source('review-reference'), before = JSON.stringify(a);
  saveReviewState(a, { stage: 'auction', auctionCursor: 3, entry: 'review' });
  saveReviewState(b, { stage: 'play', auctionCursor: 1, entry: 'select' });
  const reordered = { actions: a.actions.map(action => ({ ...action })), seed: a.seed, board: a.board };
  expect(loadReviewState(reordered)).toEqual({ stage: 'auction', auctionCursor: 3, entry: 'review' });
  expect(loadReviewState(b)).toEqual({ stage: 'play', auctionCursor: 1, entry: 'select' });
  expect(JSON.stringify(a)).toBe(before);
});

it('retains UI changes in memory when browser storage fails and bounds call positions', () => {
  vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('full'); } });
  const record = source('review-no-storage');
  expect(() => saveReviewState(record, { stage: 'auction', auctionCursor: 99 })).not.toThrow();
  expect(loadReviewState(record)).toEqual({ stage: 'auction', auctionCursor: 4, entry: 'home' });
});

it('keeps list filtering and pagination while restoring each match detail separately', () => {
  vi.stubGlobal('sessionStorage', new MemoryStorage());
  saveHistoryNavigation(undefined, { filter: 'imp', page: 2 });
  saveHistoryNavigation('roundtrip / ? # 八', { boardIndex: 7, view: 'reference' });
  saveHistoryNavigation('other-match', { boardIndex: 1, view: 'main' });
  expect(loadHistoryNavigation('roundtrip / ? # 八')).toEqual({ filter: 'imp', page: 2, boardIndex: 7, view: 'reference' });
  expect(loadHistoryNavigation('other-match')).toEqual({ filter: 'imp', page: 2, boardIndex: 1, view: 'main' });
  expect(loadHistoryNavigation()).toEqual({ filter: 'imp', page: 2, boardIndex: 0, view: 'result' });
});

it('restores a source-bound external return while unrelated sources return to the analysis home', async () => {
  const storage = new MemoryStorage(), record = source('return-history-eight');
  storage.setItem('bridgelab.analysis.return.v3.2', '#/history/roundtrip-eight');
  storage.setItem('bridgelab.analysis.return-source.v3.2', reviewSourceIdentity(record));
  vi.stubGlobal('sessionStorage', storage);
  vi.resetModules();
  const navigation = await import('../src/analysis/navigation');
  expect(navigation.analysisReturnHash()).toBe('#/history/roundtrip-eight');
  expect(navigation.analysisReturnHash(structuredClone(record))).toBe('#/history/roundtrip-eight');
  expect(navigation.analysisReturnHash(source('unrelated-example'))).toBe('#/analysis');
});

import { beforeEach, expect, it, vi } from 'vitest';
import { useGame, migrationReady } from '../src/controller/store';
import { applyCall, newGame, toRecord } from '../src/core/game';
import { PASS } from '../src/core/types';
import { emptySession, decodeSession, STORAGE_KEY } from '../src/persistence/session';
import { agreementVersionFor } from '../src/ai/bid-strategy';

class MemoryStorage {
  values = new Map<string, string>(); get length() { return this.values.size; }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
}
beforeEach(async () => {
  await migrationReady; useGame.getState().setPaused(true);
  vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('indexedDB', undefined);
  useGame.setState({ ...emptySession(), activeMatch: null, thinking: false, referenceThinking: false, paused: true, notice: null, pendingRobotClaim: null });
});
it('persists the next-board preference separately and stamps new, restart and next-board actions', async () => {
  const store = useGame.getState(); store.setBiddingSystem('precision'); await store.start('lifecycle');
  expect(useGame.getState().game).toMatchObject({ biddingSystem: 'precision', agreementVersion: agreementVersionFor('precision') });
  store.setBiddingSystem('sayc');
  expect(useGame.getState().gameSystem).toBe('precision');
  let game = useGame.getState().game!;
  for (let i = 0; i < 4; i++) game = applyCall(game, game.turn, PASS);
  useGame.setState({ game }); store.nextBoard();
  expect(useGame.getState().history[0].biddingSystem).toBe('precision');
  expect(useGame.getState().game).toMatchObject({ board: 2, biddingSystem: 'sayc' });
  store.setBiddingSystem('precision'); store.restart();
  expect(useGame.getState().game).toMatchObject({ board: 2, biddingSystem: 'precision', actions: [] });
  const loaded = decodeSession(localStorage.getItem(STORAGE_KEY)!);
  expect(loaded.game?.biddingSystem).toBe('precision'); expect(loaded.history[0].biddingSystem).toBe('precision');
});
it('stamps custom deals and match exports while frozen settings survive restart', async () => {
  const store = useGame.getState(); store.setBiddingSystem('precision');
  await store.startCustom({ id: 'custom-precision', name: 'custom', dealer: 'N', vulnerability: 'None', hands: newGame(1, 'custom').initialHands } as Parameters<typeof store.startCustom>[0]);
  expect(toRecord(useGame.getState().game!)).toMatchObject({ biddingSystem: 'precision', agreementVersion: agreementVersionFor('precision'), customSetup: { dealer: 'N' } });
  await store.startMatch({ mode: 'total', biddingSystem: 'precision' });
  store.setBiddingSystem('sayc'); store.restart();
  const match = useGame.getState().activeMatch!;
  expect(useGame.getState().game?.biddingSystem).toBe('precision'); expect(match.config.agreementVersion).toBe(agreementVersionFor('precision'));
  const file = JSON.parse(await store.exportMatches());
  expect(file.matches.find((row: { id: string }) => row.id === match.id).boards[0].main.biddingSystem).toBe('precision');
  const archivedCustom = file.matches.find((row: { legacy?: boolean }) => row.legacy);
  expect(archivedCustom.softwareVersion).toBe('3.0.0');
  expect(archivedCustom.boards[0].main.biddingSystem).toBe('precision');
  store.setPaused(true);
});

import { beforeEach, expect, it, vi } from 'vitest';
import { canReviewGame, eligibleCompletedGames, migrationReady, useGame } from '../src/controller/store';
import { robotStepWithAdvisor } from '../src/controller/robot';
import { applyCall, newGame, playCard, replay } from '../src/core/game';
import { PASS, type GameState } from '../src/core/types';
import { emptySession } from '../src/persistence/session';
import { createMatch, updateMatchTable } from '../src/match/engine';
import * as claimController from '../src/controller/claim';

vi.mock('../src/controller/robot', async original => {
  const real = await original<typeof import('../src/controller/robot')>();
  return { ...real, robotStepWithAdvisor: vi.fn(async (state: GameState) => ({ ...real.robotStep(state), decision: null })) };
});
class MemoryStorage {
  values = new Map<string, string>(); get length() { return this.values.size; }
  key(i: number) { return [...this.values.keys()][i] ?? null; }
  getItem(k: string) { return this.values.get(k) ?? null; }
  setItem(k: string, v: string) { this.values.set(k, v); }
  removeItem(k: string) { this.values.delete(k); }
}
const config = { biddingSystem: 'sayc' as const, playStrength: 'basic' as const };
function passOut(game: GameState) { for (let i = 0; i < 4; i++) game = applyCall(game, game.turn, PASS); return game; }
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 5));
beforeEach(async () => {
  vi.restoreAllMocks();
  await migrationReady;
  useGame.getState().setPaused(true);
  vi.stubGlobal('localStorage', new MemoryStorage()); vi.stubGlobal('indexedDB', undefined);
  useGame.setState({ ...emptySession(), activeMatch: null, thinking: false, referenceThinking: false, referenceError: null, paused: false, notice: null, pendingRobotClaim: null });
  vi.mocked(robotStepWithAdvisor).mockClear();
});

it('freezes settings, blocks normal-match undo/restart, and preserves unfinished matches on new start', async () => {
  await useGame.getState().startMatch({ mode: 'imp', boardCount: 8, seed: 'old' });
  const old = useGame.getState().activeMatch!;
  useGame.getState().setBiddingSystem('precision'); useGame.getState().setPlayStrength('basic');
  expect(useGame.getState().gameSystem).toBe(old.config.biddingSystem); expect(useGame.getState().playStrength).toBe(old.config.playStrength);
  const game = useGame.getState().game!;
  useGame.getState().restart(); useGame.getState().undoDecision();
  expect(useGame.getState().game).toBe(game);
  await useGame.getState().startMatch({ mode: 'total', seed: 'new' });
  const archive = await useGame.getState().getMatch(old.id);
  expect(archive?.status).toBe('unfinished'); expect(archive?.boards[0].main).toEqual(old.boards[0].main);
  expect(useGame.getState().activeMatch?.id).not.toBe(old.id);
  expect(useGame.getState().activeMatch?.boardCount).toBeNull();
});

it('resumes a saved match as a new identity and keeps the archived result immutable', async () => {
  await useGame.getState().startMatch({ mode: 'imp', seed: 'resume' });
  const old = useGame.getState().activeMatch!;
  await useGame.getState().finishMatch();
  const archived = await useGame.getState().getMatch(old.id);
  await useGame.getState().resumeMatch(old.id);
  expect(useGame.getState().activeMatch?.id).not.toBe(old.id);
  expect(useGame.getState().activeMatch?.resumedFrom).toBe(old.id);
  expect(useGame.getState().game).toEqual(replay(old.boards[0].main));
  expect(await useGame.getState().getMatch(old.id)).toEqual(archived);
});

it('discards delayed main-table actions after restarting the exact same seed and action count', async () => {
  useGame.setState({ game: newGame(1, 'race-main') });
  let complete!: (value: Awaited<ReturnType<typeof robotStepWithAdvisor>>) => void;
  vi.mocked(robotStepWithAdvisor).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  const before = useGame.getState().game!, pending = useGame.getState().stepAI();
  useGame.getState().restart();
  complete({ game: applyCall(before, before.turn, PASS), warning: null, decision: null });
  await pending;
  expect(useGame.getState().game?.actions).toHaveLength(0);
  expect(useGame.getState().thinking).toBe(false);
});

it('discards delayed reference actions when a new match replaces the same deal', async () => {
  let match = createMatch('old-ref', { mode: 'imp', seed: 'identical' }, config);
  const main = passOut(replay(match.boards[0].main)); match = updateMatchTable(match, 'main', main);
  let complete!: (value: Awaited<ReturnType<typeof robotStepWithAdvisor>>) => void;
  vi.mocked(robotStepWithAdvisor).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  useGame.setState({ activeMatch: match, game: main, gameSystem: config.biddingSystem, playStrength: config.playStrength, paused: true });
  useGame.getState().setPaused(false); await flush(); expect(useGame.getState().referenceThinking).toBe(true);
  await useGame.getState().startMatch({ mode: 'imp', seed: 'identical' });
  const replacement = useGame.getState().activeMatch!;
  const reference = replay(match.boards[0].reference!);
  complete({ game: applyCall(reference, reference.turn, PASS), warning: null, decision: null });
  await flush();
  expect(useGame.getState().activeMatch?.id).toBe(replacement.id);
  expect(useGame.getState().activeMatch?.boards[0].reference?.actions).toHaveLength(0);
  expect(useGame.getState().referenceThinking).toBe(false);
});

it('recovers a completed main table, plays all four reference seats without claims, and pauses off-table', async () => {
  let match = createMatch('recover-ref', { mode: 'imp', seed: 'recover' }, config);
  const main = passOut(replay(match.boards[0].main)); match = updateMatchTable(match, 'main', main);
  vi.mocked(robotStepWithAdvisor).mockImplementation(async state => ({ game: applyCall(state, state.turn, PASS), warning: null, decision: null }));
  useGame.setState({ activeMatch: match, game: main, gameSystem: config.biddingSystem, playStrength: config.playStrength, paused: true });
  await flush(); expect(vi.mocked(robotStepWithAdvisor)).not.toHaveBeenCalled();
  useGame.getState().setPaused(false);
  for (let i = 0; i < 20 && useGame.getState().activeMatch?.completedBoards === 0; i++) await flush();
  const board = useGame.getState().activeMatch!.boards[0];
  expect(board.reference?.actions.map(action => action.seat)).toEqual(['N', 'E', 'S', 'W']);
  expect(board.imps).toBe(0); expect(useGame.getState().pendingRobotClaim).toBeNull();
  useGame.getState().nextBoard(); expect(useGame.getState().activeMatch?.currentBoard).toBe(2);
});

it('blocks analysis until both IMP tables finish, including assisted play, and allows unrelated examples', () => {
  let match = createMatch('review', { mode: 'imp', assisted: true }, config);
  const main = passOut(replay(match.boards[0].main)); match = updateMatchTable(match, 'main', main);
  useGame.setState({ activeMatch: match, game: main, paused: true });
  expect(canReviewGame(main)).toBe(false); expect(eligibleCompletedGames()).toEqual([]);
  expect(canReviewGame(newGame(1, 'example'))).toBe(true);
  match = updateMatchTable(match, 'reference', passOut(replay(match.boards[0].reference!)));
  useGame.setState({ activeMatch: match }); expect(canReviewGame(main)).toBe(true); expect(eligibleCompletedGames()).toHaveLength(1);
});

it('archives a previous ordinary practice before starting another one', async () => {
  await useGame.getState().start('practice-one');
  await useGame.getState().start('practice-two');
  const history = await useGame.getState().listMatches();
  expect(history).toHaveLength(1); expect(history[0].status).toBe('unfinished');
  const archived = await useGame.getState().getMatch(history[0].id);
  expect(archived?.boards[0].main.seed).toBe('practice-one'); expect(useGame.getState().game?.seed).toBe('practice-two');
});

function claimPosition() {
  let game = newGame(3, 'human-claim');
  game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'NT' });
  for (let i = 0; i < 3; i++) game = applyCall(game, game.turn, PASS);
  return playCard(game, game.turn, game.hands[game.turn][0].id);
}
it('accepts a user claim while the claim dialog intentionally pauses robots', async () => {
  vi.spyOn(claimController, 'adjudicateClaim').mockResolvedValue(0);
  useGame.setState({ game: claimPosition(), paused: true });
  expect((await useGame.getState().claim(0)).accepted).toBe(true);
  expect(useGame.getState().game?.phase).toBe('complete');
});
it('discards an in-flight claim when navigation pauses an already-paused dialog', async () => {
  let complete!: (value: number) => void;
  vi.spyOn(claimController, 'adjudicateClaim').mockImplementation(() => new Promise(resolve => { complete = resolve; }));
  useGame.setState({ game: claimPosition(), paused: true });
  const pending = useGame.getState().claim(0);
  useGame.getState().setPaused(true); complete(0);
  expect((await pending).accepted).toBe(false); expect(useGame.getState().game?.phase).toBe('play');
});
it('includes current matches in history and backups without allowing import to overwrite live progress', async () => {
  await useGame.getState().startMatch({ mode: 'imp', seed: 'backup-active' });
  const active = useGame.getState().activeMatch!;
  expect((await useGame.getState().listMatches('imp'))[0].id).toBe(active.id);
  const backup = await useGame.getState().exportMatches();
  expect(JSON.parse(backup).matches[0]).toEqual(active);
  expect(await useGame.getState().importMatches(backup)).toBe(0);
  const conflict = JSON.parse(backup); conflict.matches[0].assisted = true;
  await expect(useGame.getState().importMatches(JSON.stringify(conflict))).rejects.toThrow('当前比赛冲突');
  expect(useGame.getState().activeMatch).toEqual(active);
});

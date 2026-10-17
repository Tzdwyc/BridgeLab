import { describe, expect, it, vi } from 'vitest';
import { appendBoard, createMatch, IMP_THRESHOLDS, reconcileMatch, scoreToImps, updateMatchTable, validateMatch } from '../src/match/engine';
import { applyCall, applyClaim, controllerFor, newGame, replay } from '../src/core/game';
import { PASS, type GameState } from '../src/core/types';
import { decodeSession, emptySession, encodeSession } from '../src/persistence/session';
import * as bidding from '../src/ai/bidding';

const config = { biddingSystem: 'sayc' as const, playStrength: 'challenge' as const };
function passOut(game: GameState) { for (let i = 0; i < 4; i++) game = applyCall(game, game.turn, PASS); return game; }
function claimResult(game: GameState, tricks: number) {
  game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'NT' });
  for (let i = 0; i < 3; i++) game = applyCall(game, game.turn, PASS);
  return applyClaim(game, controllerFor(game), tricks);
}
describe('v0.3.6 duplicate IMP engine', () => {
  it('uses every standard IMP boundary symmetrically and never converts the cumulative raw score', () => {
    expect(scoreToImps(0)).toBe(0); expect(scoreToImps(19)).toBe(0);
    IMP_THRESHOLDS.forEach((threshold, i) => {
      expect(scoreToImps(threshold - 1)).toBe(i);
      expect(scoreToImps(threshold)).toBe(i + 1);
      expect(scoreToImps(-threshold)).toBe(-i - 1);
    });
    expect(scoreToImps(90000)).toBe(24); expect(() => scoreToImps(NaN)).toThrow();
  });
  it('defaults to 16 and preserves identical hands, dealer, vulnerability, seats and seeds without rotation', () => {
    const match = createMatch('same-deal', { mode: 'imp', seed: 'seed' }, config);
    expect(match.boardCount).toBe(16);
    for (const count of [8, 16, 24] as const) {
      let candidate = createMatch('same-deal', { mode: 'imp', boardCount: count, seed: 'seed' }, config);
      for (let i = 1; i <= count; i++) {
        const board = candidate.boards[i - 1];
        expect(replay(board.reference!)).toEqual(replay(board.main));
        expect(board.reference).not.toBe(board.main);
        if (i < count) candidate = appendBoard(candidate);
      }
    }
    expect(replay(match.boards[0].main).initialHands).toEqual(newGame(1, 'seed:board:1').initialHands);
  });
  it('recovers either table completed first, computes mainNS minus referenceNS, and scores claims exactly once', () => {
    const initial = createMatch('claims', { mode: 'imp' }, config);
    const main = claimResult(replay(initial.boards[0].main), 2);
    const reference = claimResult(replay(initial.boards[0].reference!), 5);
    for (const first of ['main', 'reference'] as const) {
      let match = updateMatchTable(initial, first, first === 'main' ? main : reference);
      expect(match.boards[0].imps).toBeNull(); expect(match.completedBoards).toBe(0);
      // A refresh reconstructs the table that finished and the other untouched table.
      const session = decodeSession(encodeSession({ ...emptySession(), game: replay(match.boards[0].main), gameSystem: 'sayc', activeMatch: match }));
      match = updateMatchTable(session.activeMatch!, first === 'main' ? 'reference' : 'main', first === 'main' ? reference : main);
      const difference = main.result!.scoreNS - reference.result!.scoreNS;
      expect(match.boards[0].difference).toBe(difference); expect(match.totalImps).toBe(scoreToImps(difference));
      expect(match.completedBoards).toBe(1);
      expect(reconcileMatch(reconcileMatch(match))).toEqual(match);
      const corrupted = { ...match, totalScore: 9000, totalImps: 99, completedBoards: 24 };
      expect(validateMatch(corrupted).totalImps).toBe(scoreToImps(difference));
    }
  });
  it('handles all-pass at both tables and auto-completes exactly the configured IMP length', () => {
    let match = createMatch('all-pass', { mode: 'imp', boardCount: 8 }, config);
    for (let i = 0; i < 8; i++) {
      const board = match.boards[i];
      match = updateMatchTable(match, 'main', passOut(replay(board.main)));
      match = updateMatchTable(match, 'reference', passOut(replay(board.reference!)));
      if (i < 7) match = appendBoard(match);
    }
    expect(match.status).toBe('completed'); expect(match.totalImps).toBe(0); expect(match.completedBoards).toBe(8);
    expect(appendBoard(match).boards).toHaveLength(8);
    expect(() => updateMatchTable(match, 'main', replay(match.boards[7].main))).toThrow();
  });
  it('keeps cumulative matches continuous beyond 24 boards', () => {
    let match = createMatch('continuous', { mode: 'total' }, config);
    for (let i = 0; i < 26; i++) {
      match = updateMatchTable(match, 'main', passOut(replay(match.boards[i].main)));
      if (i < 25) match = appendBoard(match);
    }
    expect(match.boardCount).toBeNull(); expect(match.status).toBe('active'); expect(match.completedBoards).toBe(26);
    expect(validateMatch(match)).toEqual(match);
  });
  it('rejects malformed/mismatched tables and frozen-session settings', () => {
    const match = createMatch('bad', { mode: 'imp' }, config);
    expect(() => updateMatchTable(match, 'main', newGame(1, 'other-match'))).toThrow();
    const bad = structuredClone(match); bad.boards[0].reference!.seed = 'other';
    expect(() => validateMatch(bad)).toThrow('不一致');
    expect(() => decodeSession(encodeSession({ ...emptySession(), game: replay(match.boards[0].main), gameSystem: 'precision', activeMatch: match }))).toThrow('冻结');
    const future = appendBoard(match); future.currentBoard = 1;
    expect(() => validateMatch(future)).toThrow('格式无效');
  });
  it('freezes exact call-prefix explanations across round trips, rule changes, undo and restart', () => {
    const descriptor = vi.spyOn(bidding, 'describeCall').mockImplementation((auction, _seat, _call, system) => `old:${system}:${auction.length}`);
    try {
      let match = createMatch('frozen-explanations', { mode: 'imp', assisted: true }, config);
      expect(match.softwareVersion).toBe('0.3.7'); expect(match.boards[0].mainExplanations).toEqual([]);
      let game = replay(match.boards[0].main);
      game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'NT' }); match = updateMatchTable(match, 'main', game);
      game = applyCall(game, game.turn, PASS); match = updateMatchTable(match, 'main', game);
      expect(descriptor.mock.calls.map(call => call[0].length)).toEqual([0, 1]);
      expect(match.boards[0].mainExplanations).toEqual(['old:sayc:0', 'old:sayc:1']);
      const raw = encodeSession({ ...emptySession(), game, activeMatch: match });
      descriptor.mockImplementation(auction => `new:${auction.length}`);
      match = decodeSession(raw).activeMatch!;
      expect(validateMatch(reconcileMatch(match)).boards[0].mainExplanations).toEqual(['old:sayc:0', 'old:sayc:1']);
      expect(descriptor).toHaveBeenCalledTimes(2);
      game = applyCall(game, game.turn, PASS); match = updateMatchTable(match, 'main', game);
      expect(match.boards[0].mainExplanations).toEqual(['old:sayc:0', 'old:sayc:1', 'new:2']);
      expect(descriptor).toHaveBeenCalledTimes(3);
      // Undo reuses the unchanged prefix, then changing a call recomputes only its suffix.
      game = replay({ ...match.boards[0].main, actions: game.actions.slice(0, 1) });
      match = updateMatchTable(match, 'main', game);
      expect(match.boards[0].mainExplanations).toEqual(['old:sayc:0']); expect(descriptor).toHaveBeenCalledTimes(3);
      game = applyCall(game, game.turn, { kind: 'bid', level: 2, strain: 'C' }); match = updateMatchTable(match, 'main', game);
      expect(match.boards[0].mainExplanations).toEqual(['old:sayc:0', 'new:1']);
      game = replay({ ...match.boards[0].main, actions: [] }); match = updateMatchTable(match, 'main', game);
      expect(match.boards[0].mainExplanations).toEqual([]);
      game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'S' }); match = updateMatchTable(match, 'main', game);
      expect(match.boards[0].mainExplanations).toEqual(['new:0']);
      const reference = applyCall(replay(match.boards[0].reference!), 'N', PASS);
      match = updateMatchTable(match, 'reference', reference);
      expect(match.boards[0].referenceExplanations).toEqual(['new:0']);
      expect(match.boards[0].mainExplanations).toEqual(['new:0']);
    } finally { descriptor.mockRestore(); }
  });
  it('validates optional snapshots and leaves missing historical meanings unknown', () => {
    let match = createMatch('missing-explanations', { mode: 'imp' }, config);
    let game = replay(match.boards[0].main); game = applyCall(game, game.turn, PASS); match = updateMatchTable(match, 'main', game);
    const badLength = structuredClone(match); badLength.boards[0].mainExplanations = [];
    expect(() => validateMatch(badLength)).toThrow('释义快照无效');
    const badText = structuredClone(match); badText.boards[0].mainExplanations = ['x'.repeat(2001)];
    expect(() => validateMatch(badText)).toThrow('释义快照无效');
    delete match.boards[0].mainExplanations;
    expect(validateMatch(match).boards[0].mainExplanations).toBeUndefined();
    game = applyCall(game, game.turn, PASS); match = updateMatchTable(match, 'main', game);
    expect(match.boards[0].mainExplanations).toBeUndefined();
  });
});

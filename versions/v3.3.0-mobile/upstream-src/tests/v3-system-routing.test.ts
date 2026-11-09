import { beforeEach, describe, expect, it, vi } from 'vitest';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { decidePrecisionBid } from '../src/ai/precision';
import { agreementVersionFor, chooseSystemBid, suggestSystemBid } from '../src/ai/bid-strategy';
import { robotStep, robotStepWithAdvisor, strategyFor } from '../src/controller/robot';
import { applyCall, newGame, replay, toRecord } from '../src/core/game';
import { PASS } from '../src/core/types';
import { createMatch, updateMatchTable, validateMatch } from '../src/match/engine';
import { decodeSession, emptySession, encodeSession } from '../src/persistence/session';
import { openDocument, replayLine } from '../src/analysis/model';
import { decodeDocument } from '../src/analysis/persistence';
import { suggestSLBid, recordAppliedSLBid } from '../src/ai/neural/browser-model';

vi.mock('../src/ai/neural/browser-model', () => ({ suggestSLBid: vi.fn(), recordAppliedSLBid: vi.fn() }));
const agreement = { biddingSystem: 'precision' as const, agreementVersion: agreementVersionFor('precision') };
const observation = () => observe(newGame(1, 'precision-routing', agreement)) as BiddingObservation;
beforeEach(() => { vi.resetAllMocks(); vi.mocked(suggestSLBid).mockRejectedValue(new Error('SL files unavailable')); });

describe('v3 actual system dispatcher', () => {
  it('uses dedicated Precision in hints and the sync fallback without requesting SL', async () => {
    const obs = observation(), expected = decidePrecisionBid(obs);
    expect(chooseSystemBid(obs, 'precision')).toEqual(expected);
    expect(strategyFor('precision').bid(obs)).toEqual(expected);
    expect(await suggestSystemBid(obs, { system: 'precision', allowLookahead: true })).toEqual({ call: expected, trace: null });
    expect(suggestSLBid).not.toHaveBeenCalled();
  });
  it('routes normal and reference robot actions through Precision despite unavailable SL', async () => {
    const match = createMatch('routing-imp', { mode: 'imp', biddingSystem: 'precision' }, { biddingSystem: 'sayc', playStrength: 'basic' });
    for (const record of [match.boards[0].main, match.boards[0].reference!]) {
      const game = replay(record), obs = observe(game) as BiddingObservation;
      const result = await robotStepWithAdvisor(game, 'precision', 'basic', { advise: vi.fn() });
      expect(result.game.auction[0].call).toEqual(decidePrecisionBid(obs));
      expect(result.game.biddingSystem).toBe('precision');
    }
    expect(suggestSLBid).not.toHaveBeenCalled(); expect(recordAppliedSLBid).not.toHaveBeenCalled();
  });
  it('preserves the explicitly requested system after strategy failure and ignores mutation', () => {
    const game = newGame(1, 'precision-routing', agreement), expected = decidePrecisionBid(observe(game) as BiddingObservation);
    const result = robotStep(game, { bid: obs => { obs.hand.length = 0; throw new Error('injected'); }, play: () => { throw new Error('unused'); } }, 'precision');
    expect(result.game.auction[0].call).toEqual(expected); expect(result.warning).toContain('injected');
    expect(game.auction).toHaveLength(0); expect(game.hands.N).toHaveLength(13);
    expect(robotStep(game).game.auction[0].call).toEqual(expected);
  });
  it('uses the shared loader and disables lookahead on the frozen Natural route', async () => {
    for (const system of ['sayc', 'two-over-one'] as const) {
      const obs = observation();
      await expect(suggestSystemBid(obs, { system, allowLookahead: true })).rejects.toThrow('SL files unavailable');
      expect(suggestSLBid).toHaveBeenLastCalledWith(obs, system === 'two-over-one'
        ? { system: 'sayc', allowLookahead: false, postprocess: false } : { system, allowLookahead: true });
    }
  });
});

describe('v3 per-board agreement persistence', () => {
  it('roundtrips board records, session history, analysis exports and all replay positions', () => {
    let game = newGame(1, 'metadata', agreement);
    for (let i = 0; i < 4; i++) game = applyCall(game, game.turn, PASS);
    const record = toRecord(game); expect(replay(record)).toEqual(game);
    const session = decodeSession(encodeSession({ ...emptySession(), history: [game], game: newGame(2, 'next', agreement), gameSystem: 'precision' }));
    expect(session.history[0].biddingSystem).toBe('precision'); expect(session.game?.agreementVersion).toBe(agreement.agreementVersion);
    const doc = decodeDocument(JSON.stringify(openDocument(game)));
    expect(doc.source).toEqual(record);
    expect(replayLine(doc.source, doc.analysisContract).states.every(state => state.biddingSystem === 'precision')).toBe(true);
  });
  it('keeps missing historical metadata unknown despite a current Precision preference', () => {
    const game = newGame(1, 'old');
    const session = decodeSession(encodeSession({ ...emptySession(), game, biddingSystem: 'precision', gameSystem: 'two-over-one' }));
    expect(toRecord(session.game!)).not.toHaveProperty('biddingSystem');
    expect(toRecord(session.game!)).not.toHaveProperty('agreementVersion');
    expect(session.gameSystem).toBe('two-over-one');
  });
  it('freezes match metadata, rejects contradictions, and retains old matches without inventing metadata', () => {
    const match = createMatch('metadata-imp', { mode: 'imp', biddingSystem: 'precision' }, { biddingSystem: 'sayc', playStrength: 'basic' });
    expect(match.boards[0].main).toMatchObject(agreement); expect(match.boards[0].reference).toMatchObject(agreement);
    const bad = structuredClone(match); bad.boards[0].main.biddingSystem = 'sayc';
    expect(() => validateMatch(bad)).toThrow('冻结配置');
    expect(() => updateMatchTable(match, 'main', { ...replay(match.boards[0].main), biddingSystem: 'sayc' })).toThrow('冻结配置');
    const old = structuredClone(match);
    for (const record of [old.boards[0].main, old.boards[0].reference!]) { delete record.biddingSystem; delete record.agreementVersion; }
    expect(validateMatch(old).config.biddingSystem).toBe('precision');
    expect(validateMatch(old).boards[0].main.biddingSystem).toBeUndefined();
  });
});

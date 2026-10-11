import { expect, test } from 'vitest';
import { observe, type PlayObservation } from '../src/ai/observation';
import { robotStepWithAdvisor } from '../src/controller/robot';
import { exampleGame, replayLine } from '../src/analysis/model';
import { toRecord } from '../src/core/game';
import { chooseCard } from '../src/ai/playing';
import { type PlayDecision } from '../src/ai/play-advisor-types';
import { suggestRobotClaim } from '../src/controller/claim';
import { controllerFor } from '../src/core/game';
import { sideOf } from '../src/core/types';
import { playCard } from '../src/core/game';
import { useGame } from '../src/controller/store';

const playState = () => replayLine(toRecord(exampleGame('v03-controller-advisor', 'NT', 'S'))).states[0];

test('async robot path applies a sampled advisor card and exposes the decision', async () => {
  const state = playState();
  const obs = observe(state) as PlayObservation;
  const cardId = obs.legalCards.at(-1)!.id;
  const decision: PlayDecision = { cardId, candidates: [], sampleCount: 8, attemptedSamples: 8, elapsedMs: 1,
    engine: 'sampled-dds', fallback: false, reasonTags: ['test'], publicKey: 'public' };
  const result = await robotStepWithAdvisor(state, 'two-over-one', 'standard', { advise: async () => decision } as never);
  expect(result.game.actions.at(-1)).toEqual({ kind: 'play', seat: state.turn, cardId });
  expect(result.decision).toBe(decision);
  expect(result.warning).toBeNull();
});

test('async robot failure falls back through the deterministic safety layer', async () => {
  const state = playState();
  const obs = observe(state) as PlayObservation;
  const expected = chooseCard(obs, 'two-over-one');
  const result = await robotStepWithAdvisor(state, 'two-over-one', 'challenge', { advise: async () => { throw new Error('fixture failure'); } } as never);
  expect(result.game.actions.at(-1)).toEqual({ kind: 'play', seat: state.turn, cardId: expected });
  expect(result.warning).toContain('安全打法');
  expect(result.decision).toBeNull();
});

test('robot proposes a full claim only when every public-information DDS sample agrees', () => {
  const state = playState();
  const obs = observe(state) as PlayObservation;
  const cardId = obs.legalCards[0].id;
  const claimantIsDeclarer = sideOf(controllerFor(state)) === sideOf(state.contract!.declarer);
  const declarerTricks = claimantIsDeclarer ? 13 : 0;
  const decision: PlayDecision = {
    cardId,
    candidates: [{ cardId, expectedDeclarerTricks: declarerTricks, makeRate: 1, support: 8,
      worstDeclarerTricks: declarerTricks, bestDeclarerTricks: declarerTricks }],
    sampleCount: 8, attemptedSamples: 8, elapsedMs: 1, engine: 'sampled-dds', fallback: false,
    reasonTags: ['stable-claim'], publicKey: 'public-only'
  };

  expect(suggestRobotClaim(state, decision)).toEqual({
    seat: controllerFor(state), tricks: 13, remainingTricks: 13, publicKey: 'public-only'
  });
});

test('robot does not propose a claim from fallback, incomplete, or disagreeing samples', () => {
  const state = playState();
  const obs = observe(state) as PlayObservation;
  const cardId = obs.legalCards[0].id;
  const base: PlayDecision = {
    cardId,
    candidates: [{ cardId, expectedDeclarerTricks: 6.5, makeRate: 0.5, support: 8,
      worstDeclarerTricks: 6, bestDeclarerTricks: 7 }],
    sampleCount: 8, attemptedSamples: 8, elapsedMs: 1, engine: 'sampled-dds', fallback: false,
    reasonTags: [], publicKey: 'public-only'
  };

  expect(suggestRobotClaim(state, base)).toBeNull();
  expect(suggestRobotClaim(state, { ...base, fallback: true })).toBeNull();
  expect(suggestRobotClaim(state, { ...base, candidates: [{ ...base.candidates[0], support: 7,
    worstDeclarerTricks: 6, bestDeclarerTricks: 6 }] })).toBeNull();
});

test('accepting or rejecting a robot proposal either settles or applies its prepared continuation', () => {
  const state = playState();
  const obs = observe(state) as PlayObservation;
  const continuation = playCard(state, state.turn, obs.legalCards[0].id);
  const proposal = { seat: controllerFor(state), tricks: 13, remainingTricks: 13, publicKey: 'public-only',
    sourceSeed: state.seed, sourceActions: state.actions.length, continuation };

  useGame.setState({ game: state, undo: [], paused: true, thinking: false, pendingRobotClaim: proposal });
  useGame.getState().rejectRobotClaim();
  expect(useGame.getState().game?.actions).toHaveLength(state.actions.length + 1);
  expect(useGame.getState().game?.phase).toBe('play');
  expect(useGame.getState().pendingRobotClaim).toBeNull();

  useGame.setState({ game: state, undo: [], paused: true, thinking: false, pendingRobotClaim: proposal });
  useGame.getState().acceptRobotClaim();
  expect(useGame.getState().game?.phase).toBe('complete');
  expect(useGame.getState().game?.claim).toMatchObject({ seat: controllerFor(state), tricks: 13 });
  expect(useGame.getState().undo).toEqual([state.actions.length]);
  expect(useGame.getState().pendingRobotClaim).toBeNull();
});

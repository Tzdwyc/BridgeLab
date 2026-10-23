import { expect, test } from 'vitest';
import { observe, type PlayObservation } from '../src/ai/observation';
import { buildPublicPlayModel, publicPlayKey } from '../src/ai/play-public-model';
import { sampleDeals } from '../src/ai/play-sampler';
import { robotStep } from '../src/controller/robot';
import { newGame, toRecord } from '../src/core/game';
import { SEATS } from '../src/core/types';
import { exampleGame, replayLine } from '../src/analysis/model';
import { advisePlay } from '../src/ai/play-advisor-core';
import { DDS_SUITS } from '../src/analysis/adapter';
import { type DdsEngine } from '../src/analysis/engine';

function playObservation(seed = 'v03-public-sampling'): PlayObservation {
  let game = newGame(1, seed);
  for (let guard = 0; guard < 100 && game.phase === 'auction'; guard++) game = robotStep(game).game;
  for (let guard = 0; guard < 9 && game.phase === 'play'; guard++) game = robotStep(game).game;
  if (game.phase !== 'play') throw new Error('fixture did not reach play');
  return observe(game) as PlayObservation;
}

test('public model and seed exclude the board seed and all hidden hands', () => {
  const obs = playObservation();
  const clone = structuredClone(obs) as PlayObservation & { seed?: string; hidden?: unknown };
  clone.seed = 'must-not-cross-boundary'; clone.hidden = { E: ['S14'] };
  expect(publicPlayKey(clone)).toBe(publicPlayKey(obs));
  expect(publicPlayKey(obs)).not.toContain('v03-public-sampling');
});

test('sampler creates complete unique remaining deals and preserves every public void', () => {
  const obs = playObservation('v03-sampler-integrity');
  const model = buildPublicPlayModel(obs);
  const { samples } = sampleDeals(obs, 'two-over-one', 6);
  expect(samples).toHaveLength(6);
  for (const sample of samples) {
    const ids = SEATS.flatMap(seat => sample.hands[seat].map(card => card.id));
    expect(new Set([...ids, ...model.playedIds]).size).toBe(52);
    for (const seat of SEATS) {
      expect(sample.hands[seat]).toHaveLength(obs.handSizes[seat]);
      expect(sample.hands[seat].some(card => model.voids[seat].includes(card.suit))).toBe(false);
      for (const card of model.knownHands[seat] ?? []) expect(sample.hands[seat].some(candidate => candidate.id === card.id)).toBe(true);
    }
  }
});

test('sampling is exactly reproducible from the same public observation', () => {
  const obs = playObservation('v03-sampler-repeat');
  expect(sampleDeals(obs, 'two-over-one', 5).samples).toEqual(sampleDeals(structuredClone(obs), 'two-over-one', 5).samples);
});

test('sampled DDS ranks every legal card and returns a reviewable decision', async () => {
  const state = replayLine(toRecord(exampleGame('v03-advisor-fixed', 'NT', 'S'))).states[0];
  const obs = observe(state) as PlayObservation;
  const fake = {
    raw: () => ({
      nodes: 1, cards: obs.legalCards.length,
      suit: obs.legalCards.map(card => DDS_SUITS.indexOf(card.suit)),
      rank: obs.legalCards.map(card => card.rank),
      equals: obs.legalCards.map(() => 0),
      score: obs.legalCards.map(card => Math.min(13, Math.max(0, card.rank - 2)))
    })
  } as unknown as DdsEngine;
  const decision = await advisePlay({ observation: obs, system: 'two-over-one', strength: 'standard' }, fake);
  expect(decision.engine).toBe('sampled-dds');
  expect(decision.sampleCount).toBe(8);
  expect(decision.candidates.map(candidate => candidate.cardId).sort()).toEqual(obs.legalCards.map(card => card.id).sort());
  expect(obs.legalCards.some(card => card.id === decision.cardId)).toBe(true);
  expect(decision.publicKey).toBe(publicPlayKey(obs));
});

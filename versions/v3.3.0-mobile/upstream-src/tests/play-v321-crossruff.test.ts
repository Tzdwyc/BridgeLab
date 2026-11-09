import { describe, expect, it } from 'vitest';
import { chooseCard } from '../src/ai/playing';
import { choosePublicEndgameCard } from '../src/ai/play-safety';
import { advisePlay } from '../src/ai/play-advisor-core';
import { type DdsEngine } from '../src/analysis/engine';
import { DDS_SUITS } from '../src/analysis/adapter';
import { observe, type PlayObservation } from '../src/ai/observation';
import { playCard, replay, toRecord } from '../src/core/game';
import { type Card, type Suit } from '../src/core/types';
import { deck } from '../src/core/deal';
import { robotStep, robotStepWithAdvisor, strategyFor } from '../src/controller/robot';
import { crossruffCard, syntheticCrossruffObservation, syntheticCrossruffState } from './fixtures/v321-crossruff';

function finish(first?: string) {
  let state = syntheticCrossruffState();
  if (first) state = playCard(state, state.turn, first);
  while (state.phase === 'play') {
    state = playCard(state, state.turn, chooseCard(observe(state) as PlayObservation));
  }
  return state;
}

function replacePublicCard(obs: PlayObservation, from: string, to: string) {
  for (const trick of obs.completedTricks) for (const play of trick.plays) {
    if (play.card.id === from) { play.card = crossruffCard(to); return; }
  }
  throw new Error(`Missing public card ${from}`);
}

describe('v3.2.1 public crossruff protection', () => {
  it('preserves separate trump tricks and legally completes 4S doubled', () => {
    const obs = syntheticCrossruffObservation();
    const before = JSON.stringify(obs);
    expect(choosePublicEndgameCard(obs, 'S9')?.id).toBe('D13');
    expect(chooseCard(obs)).toBe('D13');
    expect(finish().tricksWon).toEqual({ NS: 10, EW: 3 });
    // Forced old lead merges S9 and S8; even the repaired continuation cannot recover it.
    expect(finish('S9').tricksWon).toEqual({ NS: 9, EW: 4 });
    expect(JSON.stringify(obs)).toBe(before);
    expect(obs).not.toHaveProperty('seed');
    expect(obs).not.toHaveProperty('hands');
  });

  it('reaches basic, synchronous fallback, and the shared LAN playing strategy', async () => {
    const state = syntheticCrossruffState();
    const obs = syntheticCrossruffObservation();
    expect(strategyFor('two-over-one').play(obs)).toBe('D13');
    expect(robotStep(state).game.actions.at(-1)).toMatchObject({ cardId: 'D13' });
    const fallback = robotStep(state, { bid: () => { throw new Error('unused'); }, play: () => { throw new Error('failure'); } });
    expect(fallback.game.actions.at(-1)).toMatchObject({ cardId: 'D13' });
    const asynchronous = await robotStepWithAdvisor(state, 'two-over-one', 'challenge', {
      advise: async () => { throw new Error('failure'); }
    });
    expect(asynchronous.game.actions.at(-1)).toMatchObject({ cardId: 'D13' });
    const basic = await advisePlay({ observation: obs, system: 'two-over-one', strength: 'basic' });
    expect(basic.cardId).toBe('D13');
    expect(basic.engine).toBe('safety');
  });

  it('certifies the earlier three-trick ending without merging the trumps', () => {
    const record = toRecord(syntheticCrossruffState());
    record.actions = record.actions.slice(0, -4);
    let state = replay(record);
    const obs = observe(state) as PlayObservation;
    expect(obs.completedTricks).toHaveLength(10);
    expect(choosePublicEndgameCard(obs, 'S8')?.suit).toBe('C');
    while (state.phase === 'play') state = playCard(state, state.turn, chooseCard(observe(state) as PlayObservation));
    expect(state.tricksWon.NS).toBe(10);
  });

  it('applies the same proof after renaming all four suits', () => {
    const obs = syntheticCrossruffObservation();
    const suits: Record<Suit, Suit> = { S: 'H', H: 'D', D: 'C', C: 'S' };
    const rename = (card: Card): Card => ({ ...card, suit: suits[card.suit], id: `${suits[card.suit]}${card.rank}` });
    obs.hand = obs.hand.map(rename);
    obs.actingHand = obs.actingHand.map(rename);
    obs.legalCards = obs.legalCards.map(rename);
    obs.dummy!.cards = obs.dummy!.cards.map(rename);
    for (const trick of obs.completedTricks) for (const play of trick.plays) play.card = rename(play.card);
    obs.contract.strain = 'H';
    expect(chooseCard(obs)).toBe('C13');
    expect(choosePublicEndgameCard(obs, 'H9')?.id).toBe('C13');
  });

  it('continues certifying after dummy has used its last trump', () => {
    // Isolated public continuation: discard C4 under S9, retain DA to win D2.
    // The 44 public cards below represent the known-card set, not a replay.
    const obs = syntheticCrossruffObservation();
    obs.hand = [crossruffCard('D2')];
    obs.actingSeat = 'S';
    obs.actingHand = obs.legalCards = [crossruffCard('D14'), crossruffCard('C4')];
    obs.dummy!.cards = obs.actingHand;
    obs.currentTrick = [{ seat: 'N', card: crossruffCard('S9') }, { seat: 'E', card: crossruffCard('D11') }];
    obs.handSizes = { N: 1, E: 1, S: 2, W: 2 };
    const remaining = new Set(['D2', 'D14', 'C4', 'S9', 'D11', 'D13', 'D12', 'D10']);
    const publicCards = deck().filter(card => !remaining.has(card.id));
    obs.completedTricks = Array.from({ length: 11 }, (_, index) => ({
      leader: 'N', winner: 'N', plays: publicCards.slice(index * 4, index * 4 + 4)
        .map((card, position) => ({ seat: (['N', 'E', 'S', 'W'] as const)[position], card }))
    }));
    expect(choosePublicEndgameCard(obs, 'D14')?.id).toBe('C4');
    expect(chooseCard(obs)).toBe('C4');
  });

  it.each(['standard', 'challenge'] as const)('protects %s even if sampled advice favors the merging trump', async strength => {
    const obs = syntheticCrossruffObservation();
    const fake = { raw: () => ({
      nodes: 1, cards: 2, suit: obs.legalCards.map(card => DDS_SUITS.indexOf(card.suit)),
      rank: obs.legalCards.map(card => card.rank), equals: [0, 0],
      score: obs.legalCards.map(card => card.id === 'S9' ? 2 : 1)
    }) } as unknown as DdsEngine;
    const decision = await advisePlay({ observation: obs, system: 'two-over-one', strength }, fake);
    expect(decision.engine).toBe('sampled-dds');
    expect(decision.candidates[0].cardId).toBe('S9');
    expect(decision.cardId).toBe('D13');
    expect(decision.reasonTags).toContain('公开信息保证拿下全部余墩');
  });

  it('leaves the ordinary decision intact when a defender can still hold a trump', () => {
    // Isolated public-observation gate test: release one trump into the unseen pool.
    const obs = syntheticCrossruffObservation();
    replacePublicCard(obs, 'S4', 'D11');
    expect(choosePublicEndgameCard(obs, 'S9')).toBeNull();
    expect(chooseCard(obs)).toBe('S9');
  });

  it('does not invent a crossruff when dummy must follow the side suit', () => {
    const obs = syntheticCrossruffObservation();
    replacePublicCard(obs, 'D4', 'C4');
    obs.dummy!.cards = [crossruffCard('S8'), crossruffCard('D4')];
    expect(choosePublicEndgameCard(obs, 'S9')).toBeNull();
    expect(chooseCard(obs)).toBe('S9');
  });

  it('keeps a winning trump cash when the side winner supplies the other trick', () => {
    const obs = syntheticCrossruffObservation();
    replacePublicCard(obs, 'C14', 'D13');
    obs.hand = obs.actingHand = obs.legalCards = [crossruffCard('S9'), crossruffCard('C14')];
    expect(choosePublicEndgameCard(obs, 'S9')).toBeNull();
    expect(chooseCard(obs)).toBe('S9');
  });

  it('does not apply a ruffing proof to no-trump contracts', () => {
    const obs = syntheticCrossruffObservation();
    obs.contract.strain = 'NT';
    expect(choosePublicEndgameCard(obs, 'S9')).toBeNull();
    expect(chooseCard(obs)).toBe('S9');
  });
});

import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { PASS, partnerOf, type Call, type Card, type Suit, type Strain } from '../src/core/types';
import { publicPlayerConstraints } from '../src/ai/bidding-semantics';
const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
function position(sequence: string, holding: string): BiddingObservation {
  let game = newGame(1, 'release10-competition');
  for (const token of sequence.split(' ').filter(Boolean)) game = applyCall(game, game.turn,
    token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : bid(Number(token[0]), token.slice(1) as Strain));
  const obs = observe(game) as BiddingObservation;
  obs.hand = holding.split('.').flatMap((cards, index) => cards === '-' ? [] : [...cards].map(rank => ({
    id: `${index}${rank}`, suit: (['S', 'H', 'D', 'C'] as Suit[])[index], rank: '23456789TJQKA'.indexOf(rank) + 2,
  } as Card)));
  expect(obs.hand).toHaveLength(13);
  return obs;
}
describe('release10 competition public sources and counterexamples', () => {
  it.each([
    ['1S P', 'KJ7.AT5.KJ862.A8', bid(2, 'D')],
    ['P 1S P', 'QJ2.Q872.AK.J732', bid(2, 'C')],
    ['1S P', 'QT94.AJ6.K3.AQT5', bid(2, 'NT')],
  ])('preserves the initial major response protocol before generic game support: %s', (prefix, hand, response) => {
    const obs = position(prefix, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toBeUndefined();
    expect(chooseBid(obs, 'sayc')).toEqual(response);
  });
  it.each([
    ['2H 3D P', 'AT963.A.J75.AT84', 'H'],
    ['P 2H 3C P', 'A3.KQ6.9753.Q876', 'H'],
  ])('shows constructive first minor support through the safe cue: %s', (prefix, hand, cue) => {
    const obs = position(prefix, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, cue as Suit));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, cue as Suit));
  });
  it('accepts the public constructive cue at a real twenty-nine minor threshold', () => {
    const obs = position('2H 3D P 3H P', 'K5.J873.AKQ982.J');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(5, 'D'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(5, 'D'));
  });
  it('does not force a five-minor reply below twenty-nine when the cue is too high', () => {
    expect(chooseCompetitiveCall(position('3H 4D P', 'AT963.A.J75.AT84'), 'sayc')).not.toEqual(bid(4, 'H'));
  });
  it('does not promote twenty-eight Michaels minor support to game', () => {
    // Major-opening Michaels is 10+, not the 8+ double-major cue over a minor.
    // Own 9 + singleton 3 + ninth trump 1 = 13; partner 10 + shape 4 + extra 1 = 15.
    const obs = position('P P 1S 2S P 2NT P 3C 3S', 'Q976.5.QJ74.A752');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'C'));
    const game = position('P P 1S 2S P 2NT P 3C 3S', 'K976.5.KJ74.A752');
    expect(chooseCompetitiveCall(game, 'sayc')).toEqual(bid(5, 'C'));
    expect(chooseBid(game, 'sayc')).toEqual(bid(5, 'C'));
  });
  it('does not send a negative-double opener to five unsupported clubs after enemy four spades', () => {
    const obs = position('P 1C 2S X 4S', 'A.Q5.KT98.KQJ985');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('defines only the seven-raw eight-card honor-rich first-advancer major exception', () => {
    const obs = position('1C 1D 2C', 'KQT98753.Q8.54.6');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'S'));
    for (const hand of ['KQT98753.J8.54.6', 'KQ987653.Q8.54.6', 'KQT9875.Q8.543.6', 'QJT98753.K8.54.6']) {
      expect(chooseCompetitiveCall(position('1C 1D 2C', hand), 'sayc')).not.toEqual(bid(2, 'S'));
      expect(chooseBid(position('1C 1D 2C', hand), 'sayc')).not.toEqual(bid(2, 'S'));
    }
  });
  it.each([
    ['P P P 1S 2D 2H P', 'AT732.KQ6.KJ973.-'],
    ['P P 1D 1S 2H P', 'A852.AJ64.Q96.J2'],
    ['1D 1S X 2S 3H 3S', '9.J986.KJ65.AJ32'],
    ['P 1C 2S X P 3H P', 'A53.KQ973.8.QT62'],
    ['P P 2D X P 2S P 3H 4D', 'QJ7542.9854.-.K87'],
  ])('accepts a real known major game before NF or weak-band refusal: %s', (prefix, hand) => {
    const obs = position(prefix, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'H'));
  });
  it('does not add technical-double heart length to a weak long-heart hand', () => {
    const obs = position('1C X 4S', '7.KJ854.Q963.J42');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('does not force twenty raw into NT game opposite a zero-floor three-spade reply', () => {
    const obs = position('P 3C X P 3S P', 'AQJ84.AT5.AQ4.K8');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('retains a genuine eighteen-twenty stopped NT description when the lower space exists', () => {
    // Lowest 1NT is 18–20; jumping 2NT would falsely announce 21–22.
    expect(chooseCompetitiveCall(position('1C X P 1S P', 'AQJ84.AT5.AQ4.K8'), 'sayc')).toEqual(bid(1, 'NT'));
  });
  it('keeps the approved eight-point six-club defense to natural NT', () => {
    const obs = position('1NT', '9.963.K92.AJT976');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'C'));
  });
  it('shows a ten-point exceptionally strong five-card major against natural NT', () => {
    expect(chooseBid(position('P 1NT', 'K72.KQJT7.J.9743'), 'sayc')).toEqual(bid(2, 'H'));
    expect(chooseCompetitiveCall(position('P 1NT', 'K72.QJ987.J.A743'), 'sayc')).not.toEqual(bid(2, 'H'));
  });
  it('keeps the defined weak minor escape after a natural NT overcall is interrupted', () => {
    const obs = position('1D 1NT 2D', '653.986.8.KQJ642');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'C'));
    expect(chooseCompetitiveCall(position('1D 1NT 2D', '653.986.82.KQJ64'), 'sayc')).not.toEqual(bid(3, 'C'));
  });
  it('bounds original minor opener late NT to nineteen-twenty-one with own stops and declared shape', () => {
    for (const [prefix, hand] of [['1D 1NT P P', 'KJ7.AT.AJT53.AQ8'], ['1C 1NT P P', 'KQJ.A7.K2.KQJ987']]) {
      const obs = position(prefix, hand);
      expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'NT'));
      expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'NT'));
      expect(describeCall(obs.auction, obs.seat, bid(2, 'NT'), 'sayc')).toContain('19–21');
    }
    for (const [prefix, hand] of [['1D 1NT P P', 'KJ5.AQ7.KJ76.KJ7'], ['1D 1NT P P', 'J95.AK7.KJ76.AK7'], ['1C 1NT P P', 'KJ87.KQ82.A.AQ32'], ['1D P P 1NT', 'J95.AK7.KJ76.AQ7']]) {
      expect(chooseCompetitiveCall(position(prefix, hand), 'sayc')).not.toEqual(bid(2, 'NT'));
      expect(chooseBid(position(prefix, hand), 'sayc')).not.toEqual(bid(2, 'NT'));
    }
  });
  it.each([
    ['1H P P 1S', '-.AKQ83.AK865.AJ9'],
    ['P 1S X P 2C', 'AKQJ3.T3.KQT87.A'],
  ])('first describes a strong opener real second suit rather than a minimum original repeat: %s', (prefix, hand) => {
    const obs = position(prefix, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'D'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'D'));
  });
  it('retains a strong technical source after its partner natural NT reply', () => {
    const obs = position('1S P P X P 1NT P', 'JT.98.AKQJT.AQT9');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'D'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'D'));
  });
  it('keeps original negative-double inquiry despite a later enemy spade advance', () => {
    const obs = position('1D 1H X 1S', 'A94.KJ83.9732.A9');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(2, 'H'));
    expect(chooseBid(obs, 'sayc')).not.toEqual(bid(2, 'H'));
    const constraints = publicPlayerConstraints(obs.auction, partnerOf(obs.seat), 'sayc');
    expect(constraints.suitMinimums.S).toBe(4);
    expect(constraints.suitMinimums.H).toBe(0);
  });
  it('answers a support cue with a real four-card second major and prefers known eight back over seven', () => {
    const answer = position('P P 1D P P 1S 2D 3D P', 'KJT63.KT42.A4.76');
    expect(chooseBid(answer, 'sayc')).toEqual(bid(3, 'H'));
    expect(describeCall(answer.auction, answer.seat, bid(3, 'H'), 'sayc')).not.toContain('未约定');
    const preference = position('P P 1D P P 1S 2D 3D P 3H P', 'Q75.A75.K72.Q832');
    expect(chooseCompetitiveCall(preference, 'sayc')).toEqual(bid(3, 'S'));
    expect(chooseBid(preference, 'sayc')).toEqual(bid(3, 'S'));
  });
  it('rejects a naked four-diamond competitive return after the one-round cue is fulfilled', () => {
    const obs = position('1S P P X P 2S P 3D 3S P P', 'A.JT32.Q8743.K43');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('does not compete a minimum five-heart source at three without support', () => {
    const obs = position('1H P P 2D P 2H P 3D', 'K75.AJ983.Q9.Q93');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
    expect(chooseCompetitiveCall(position('1H P P 2D P 2H P 3D', 'K75.AKJ983.Q9.Q3'), 'sayc')).toEqual(bid(3, 'H'));
  });
  it('does not punish with just KJ-four trumps and two side aces', () => {
    const obs = position('1C 1D P 1H', 'A72.KJ65.J.AJ762');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('defends a genuine one-NT answer with actual defensive strength rather than a false capped overcall', () => {
    const obs = position('1H P 1NT', 'K92.K72.A7.AKT97');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).toEqual({ kind: 'double' });
  });
  it('does not use a two-level major weak jump while holding four in the other major', () => {
    const obs = position('1C', 'K987.AK985432.-.2');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(1, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(1, 'H'));
  });
});

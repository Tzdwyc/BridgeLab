import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics, isTakeoutDoubleAt } from '../src/ai/bidding-semantics';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, PASS } from '../src/core/types';

const b = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const parse = (value: string): Call => value === 'P' ? PASS : value === 'X' ? { kind: 'double' }
  : value === 'XX' ? { kind: 'redouble' } : b(Number(value[0]), value.slice(1) as Strain);
function position(sequence: string, holding: string): BiddingObservation {
  let game = newGame(1, 'model-findings');
  for (const token of sequence.split(' ').filter(Boolean)) game = applyCall(game, game.turn, parse(token));
  const obs = observe(game) as BiddingObservation;
  obs.hand = holding.split('.').flatMap((cards, index) => cards === '-' ? [] : [...cards].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { id: `${suit}${rank}`, suit, rank } as Card;
  }));
  expect(obs.hand).toHaveLength(13);
  return obs;
}
const decision = (sequence: string, holding: string) => chooseBid(position(sequence, holding), 'sayc');

// The bridge expectations below were chosen by GPT from actual auction
// records. These regressions retain those decisions; they are not a random
// auction correctness validator or an independent expert oracle.
describe('model-reviewed systemic findings', () => {
  it('does not forget the game force after a positive response to a strong suit rebid', () => {
    const obs = position('2C P 2D P 3D P 3S P', '-.KQ6.AKQJT9.AK32');
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc').forcing).toBe('game');
    expect(chooseBid(obs, 'sayc')).not.toEqual(PASS);
  });
  it('does not treat artificial Unusual 2NT as a natural NT transfer platform', () => {
    expect(decision('1H 2NT P 3D P', 'T.-.AKQJT2.KQT876')).toEqual(PASS);
    expect(decision('1C 2NT X 3D 3H', 'Q6.KT952.T8763.5')).toEqual(PASS);
  });
  it('shows strong point ranges after a negative double rather than rebidding cheap NT', () => {
    expect(decision('1C 1H X P', 'AQ5.AK76.8.AK965')).toEqual(b(3, 'NT'));
    expect(decision('1D 2S X P', 'AQ.K2.AJT76.AQ43')).toEqual(b(3, 'NT'));
  });
  it('accepts a late public 18-19 NT invitation with ten points', () => {
    expect(decision('P P P 1C P 1D P 1S P 1NT P 2NT P', '976.K8.QJT54.A73')).toEqual(b(3, 'NT'));
  });
  it('chooses the available major game rather than cueing past it after a preempt double', () => {
    expect(decision('3S X P', '3.KT43.AQ3.QJT73')).toEqual(b(4, 'H'));
  });
  it('continues a constructive passed-hand 2-level response with a 21-point opener', () => {
    expect(decision('P P 1S P 2D P', 'AKJ65.AQ.J6.AQT3')).toEqual(b(3, 'NT'));
  });
  it('does not abandon a 23-point takeout double after a weak suit response to a preempt', () => {
    expect(decision('P P 2D X P 2S P', 'AK4.A976.K.AKQ65')).toEqual(b(3, 'C'));
  });
  it('balances over a preempt with a strong hand rather than silently passing', () => {
    expect(decision('3C P P', 'AKQJ.T.AKQT763.A')).toEqual({ kind: 'double' });
  });
  it('uses an artificial second negative rather than showing a three-card suit after strong 3D', () => {
    expect(decision('2C P 2D P 3D P', 'T763.743.J95.T74')).toEqual(b(3, 'NT'));
  });
  it('rebids the original minor after the second negative without inventing a fit', () => {
    expect(decision('2C P 2D P 3D P 3NT P', 'AKQJ.Q2.AKQ83.K9')).toEqual(b(4, 'D'));
    expect(decision('2C P 2D P 3C P 3D P', 'AJ83.AJ9.K.AKQ87')).toEqual(b(4, 'C'));
  });
  it('explains a second negative as artificial rather than natural diamonds', () => {
    const obs = position('2C P 2D P 3C P', '96.T8643.J653.T6');
    expect(describeCall(obs.auction, obs.seat, b(3, 'D'), 'sayc')).toContain('二次负');
  });
  it('does not cue the enemy diamond suit with a weak free advancer', () => {
    expect(decision('1D X 2C', '872.84.T9742.Q42')).toEqual(PASS);
  });
  it('answers a doubled Michaels inquiry with the real five-card minor', () => {
    expect(decision('1H 2H X 2NT P', 'KJ874.92.AQT86.4')).toEqual(b(3, 'D'));
  });
  it('answers a forcing overcall cue even when opener doubles it', () => {
    const obs = position('1C 1H P 2C X', 'T8.AQJ76.KJ92.64');
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc').convention).toBe('overcall-cue');
    expect(chooseBid(obs, 'sayc')).toEqual(b(2, 'D'));
  });
  it('does not describe an enemy second suit as its own natural second suit', () => {
    // Twelve HCP and five hearts do not justify a jump solely because a
    // cue forced a reply. Repeat minimally when the other suit is enemy's.
    expect(decision('1C 1H P 2C 2D', 'T8.AQJ76.KJ92.64')).toEqual(b(2, 'H'));
  });
  it('uses a transfer for a weak five-card major after a 1NT overcall', () => {
    expect(decision('1C 1NT P', 'J86432.-.652.J753')).toEqual(b(2, 'H'));
  });
  it('uses a low-minor relay rather than pretending a weak club hand is Stayman', () => {
    expect(decision('1D 1NT P', '87.53.T94.J87654')).toEqual(b(2, 'S'));
  });
  it('records the NT-overcall transfer as an artificial forcing obligation', () => {
    const obs = position('1C 1NT P 2H X', 'AJ3.KQ8.AJ5.Q764');
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc').convention).toBe('overcall-transfer');
    expect(chooseBid(obs, 'sayc')).toEqual(b(2, 'S'));
  });
  it('does not mistake strong 2C and Stayman 3C for a club fit', () => {
    expect(decision('2C P 2D P 2NT P 3C P', 'A2.KQ5.AKQ.AQ652')).toEqual(b(3, 'D'));
  });
  it('does not ask keycards with three points after finding a heart fit', () => {
    expect(decision('P P P 2C P 2D P 2NT P 3C P 3H P', '9.7653.85.QJ8743')).toEqual(b(4, 'H'));
  });
  it('stops after game with seven points opposite a strong NT transfer sequence', () => {
    expect(decision('P P 2C P 2D P 2NT P 3H P 3S P 3NT P 4S P', 'QJ963.J96.QJ6.T9')).toEqual(PASS);
  });
  it('accepts a late 2NT invitation with a 19-point 5-4 opener', () => {
    expect(decision('1H P 1S P 2D P 2NT P', 'AJ5.AQJ96.AJ87.Q')).toEqual(b(3, 'NT'));
  });
  it('does not invite rather than force game with seventeen points', () => {
    // GPT re-review: seventeen HCP and three hearts may place the confirmed eight-card major game.
    expect(decision('1H P 1S P 2C P', 'AQT98.AQ3.KQ6.43')).toEqual(b(4, 'H'));
  });
  it('continues to game after a fourth-suit answer with eighteen points', () => {
    expect(decision('1H P 1S P 2C P 2D P 2NT P', 'AK982.A6.KQ84.Q2')).toEqual(b(3, 'NT'));
  });
  it('shows the extras instead of passing a minimum response to a reverse', () => {
    expect(decision('1C P 1S P 2H P 2S P', '8.AKJ6.K62.AKQJ8')).toEqual(b(3, 'NT'));
  });
  it('continues naturally after a weak jump when the opener has 21 points', () => {
    expect(decision('1D 2H P P', 'A.AQ3.AQ876.KQ73')).toEqual(b(3, 'C'));
  });
  it('distinguishes a direct takeout double from a later negative double', () => {
    const obs = position('1D 1S X P', 'Q2.AK74.AJ953.86');
    expect(isTakeoutDoubleAt(obs.auction, 2)).toBe(false);
    expect(chooseBid(obs, 'sayc')).toEqual(b(2, 'H'));
  });
  it('explains a two-card false preference as a nonforcing preference', () => {
    const obs = position('1S P 1NT P 2C P', '84.742.T974.KQ52');
    const explanation = describeCall(obs.auction, obs.seat, b(2, 'S'), 'sayc');
    expect(explanation).toContain('可仅两张');
    expect(explanation).not.toContain('新花色');
  });
  it('explains a direct NT-overcall transfer by its target suit', () => {
    const obs = position('1C 1NT P', 'J86432.-.652.J753');
    expect(describeCall(obs.auction, obs.seat, b(2, 'H'), 'sayc')).toContain('黑桃');
    expect(describeCall(obs.auction, obs.seat, b(2, 'H'), 'sayc')).not.toContain('Michaels');
  });
  it('does not invent four-card NT support in a natural NT raise explanation', () => {
    const obs = position('1NT P 2NT P', 'AT92.Q72.K83.AK3');
    const explanation = describeCall(obs.auction, obs.seat, b(3, 'NT'), 'sayc');
    expect(explanation).not.toContain('张NT');
    expect(explanation).not.toContain('支持应叫花色');
  });
});

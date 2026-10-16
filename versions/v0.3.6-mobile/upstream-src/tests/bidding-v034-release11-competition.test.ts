import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { analyzeAuctionSemantics, noTrumpRangeAt, publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { PASS, type Call, type Card, type Suit, type Strain } from '../src/core/types';
const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
function position(sequence: string, holding: string): BiddingObservation {
  let game = newGame(1, 'release11-competition');
  for (const token of sequence.split(' ').filter(Boolean)) game = applyCall(game, game.turn,
    token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : bid(Number(token[0]), token.slice(1) as Strain));
  const obs = observe(game) as BiddingObservation;
  obs.hand = holding.split('.').flatMap((cards, index) => cards === '-' ? [] : [...cards].map(rank => ({
    id: `${index}${rank}`, suit: (['S', 'H', 'D', 'C'] as Suit[])[index], rank: '23456789TJQKA'.indexOf(rank) + 2,
  } as Card)));
  expect(obs.hand).toHaveLength(13);
  return obs;
}

describe('release11 competition GPT findings', () => {
  it('chooses the known nine-card club fit after a cue receives an unsupported heart description', () => {
    const obs = position('1D 2C P 2D P 2H P', 'AJT984.A.93.JT76');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'C'));
  });
  it('does not advertise a fragile KJ-four as a good lead against an artificial fourth suit', () => {
    const obs = position('1D P 1S P 2C P 2H', 'K83.KJ95.95.KQ43');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it.each(['K83.KQT9.95.KJ43', 'K83.AK95.95.QJ43', 'K83.QJT9.95.KJ43', 'K83.AJT95.95.Q43'])('retains a real honor sequence for a lead double: %s', hand => {
    const obs = position('1D P 1S P 2C P 2H', hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
  });
  it.each([
    ['K83.AQ975.95.Q43', { kind: 'double' }],
    ['K83.AQ95.95.QJ43', PASS],
  ] as const)('requires five cards for the AQ lead holding: %s', (hand, expected) => {
    const obs = position('1D P 1S P 2C P 2H', hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(expected);
    expect(chooseBid(obs, 'sayc')).toEqual(expected);
  });
  it('retains the first seven-card weak jump after opener and responder have both bid', () => {
    const obs = position('1D P 1S', '643.AKQ8643.9.72');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'H'));
  });
  it('does not extend that seven-card delayed preempt to six cards', () => {
    const obs = position('1D P 1S', '643.AKQ864.93.72');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(3, 'H'));
  });
  it('requires a queen or better for a seven-card delayed weak jump', () => {
    const queen = position('1D P 1S', 'K32.Q987542.A.64');
    const noQueen = position('1D P 1S', 'K32.J987542.A.64');
    expect(chooseCompetitiveCall(queen, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(queen, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseCompetitiveCall(noQueen, 'sayc')).not.toEqual(bid(3, 'H'));
    expect(chooseBid(noQueen, 'sayc')).not.toEqual(bid(3, 'H'));
  });
  it('keeps two ten-or-higher honors including a queen for a six-card weak jump', () => {
    const queenTen = position('1C', 'K32.QT8754.A6.42');
    const jackTen = position('1C', 'K32.JT8754.A6.42');
    expect(chooseCompetitiveCall(queenTen, 'sayc')).toEqual(bid(2, 'H'));
    expect(chooseCompetitiveCall(jackTen, 'sayc')).not.toEqual(bid(2, 'H'));
  });
  it.each([
    ['1H 1NT P 2C 2H', 'Q52.Q976.AQ63.AJ', bid(2, 'NT')],
    ['1H 1NT P 2C 2H', 'QJ52.K976.AQ6.AJ', bid(2, 'S')],
    ['1D 1NT P 2C 2H', 'AQ2.976.AQ63.KJ2', PASS],
  ] as const)('answers interrupted Stayman safely: %s / %s', (auction, hand, expected) => {
    const obs = position(auction, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(expected);
    expect(chooseBid(obs, 'sayc')).toEqual(expected);
  });
  it('does not turn a support cue into a forced five-level sacrifice after enemy game', () => {
    const obs = position('1D 1H X 2D 4S', 'QJ72.JT8752.95.A');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('keeps the interrupted Stayman answer range, stopper and released obligation coherent', () => {
    const obs = position('1H 1NT P 2C 2H', 'Q52.Q976.AQ63.AJ');
    const ntAuction = [...obs.auction, { seat: obs.seat, call: bid(2, 'NT') }];
    expect(noTrumpRangeAt(ntAuction, ntAuction.length - 1, 'sayc')).toEqual({ min: 15, max: 18 });
    const ntMeaning = publicCallMeaningAt(ntAuction, ntAuction.length - 1, 'sayc');
    expect(ntMeaning.role).toBe('natural-nt');
    expect(ntMeaning.forcing).toBe('none');
    expect(ntMeaning.stopperSources.some(source => source.suit === 'H' && source.seat === obs.seat)).toBe(true);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc').mustBid).toBe(false);
    const spadeAuction = [...obs.auction, { seat: obs.seat, call: bid(2, 'S') }];
    const spadeMeaning = publicCallMeaningAt(spadeAuction, spadeAuction.length - 1, 'sayc');
    expect(spadeMeaning.suitMinimum).toBe(4);
    expect(spadeMeaning.hcpRange).toEqual({ min: 15, max: 18 });
    expect(spadeMeaning.artificial).toBe(false);
  });
});

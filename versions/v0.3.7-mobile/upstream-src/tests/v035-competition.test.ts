import { describe, expect, it } from 'vitest';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
import { type BiddingObservation } from '../src/ai/observation';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { classifyDoubleAt, publicCallMeaningAt } from '../src/ai/bidding-semantics';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function observation(start: Seat, text: string, holding: string): BiddingObservation {
  const auction: AuctionEntry[] = text.split(' ').map((token, index) => ({ seat: seats[(seats.indexOf(start) + index) % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : bid(Number(token[0]), token.slice(1) as Strain) }));
  const suitNames: Suit[] = ['S', 'H', 'D', 'C'];
  const hand: Card[] = holding.split('.').flatMap((cards, i) => [...cards.replace('-', '')].map(symbol => ({
    id: `${suitNames[i]}${symbol}`, suit: suitNames[i], rank: '23456789TJQKA'.indexOf(symbol) + 2,
  })));
  if (hand.length !== 13) throw new Error('Each reviewed holding must contain thirteen cards');
  const seat = seats[(seats.indexOf(start) + auction.length) % 4];
  return { board: 1, phase: 'auction', seat, actingSeat: seat, auction, hand,
    legalCalls: legalCalls(auction, seat), vulnerability: 'None' };
}

describe('v0.3.5 technical competitive decisions', () => {
  it('reopens the user opener example with both majors and diamond shortness', () => {
    const obs = observation('S', '1C 2D P 3D', 'AKT5.Q643.4.AKT3');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).toEqual({ kind: 'double' });
    const completed = [...obs.auction, { seat: obs.seat, call: { kind: 'double' } as Call }];
    expect(classifyDoubleAt(completed, completed.length - 1, 'sayc')).toBe('takeout');
    expect(publicCallMeaningAt(completed, completed.length - 1, 'sayc').description).toContain('技术');
  });
  it('does not reopen with high cards alone and no requested major shape', () => {
    const obs = observation('S', '1C 2D P 3D', 'AK5.Q64.432.AKQ3');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('keeps the three-level reopening strength floor as well as the shape', () => {
    const obs = observation('S', '1C 2D P 3D', 'KJ85.Q643.4.AQ73');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('allows a minimum short opener to reopen at the two level', () => {
    const obs = observation('S', '1C 1D P 2D', 'KJ85.Q643.4.AQ73');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).toEqual({ kind: 'double' });
  });
  it('answers opener reopening X with a weak real major instead of defending the artificial decision', () => {
    const obs = observation('S', '1C 2D P 3D X P', '764.T9876.984.76');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'H'));
  });
  it('returns to a real long opening-suit fit when neither requested major is playable', () => {
    const obs = observation('S', '1C 2D P 3D X P', '76.98.4.QJT98763');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'C'));
  });
  it('uses a responsive double over a raise with both unbid majors', () => {
    const obs = observation('W', '1D X 2D', 'K875.Q864.32.J73');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).toEqual({ kind: 'double' });
  });
  it('uses a responsive double over hearts with both minors and spade tolerance', () => {
    const obs = observation('W', '1H X 2H', '875.32.KJ84.Q763');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).toEqual({ kind: 'double' });
  });
  it('answers responsive X by choosing a major instead of starting a fresh strong cue cycle', () => {
    const obs = observation('W', '1D X 2D X P', 'KJ85.Q643.4.AQ73');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'S'));
  });
  it('answers responsive X over a major by choosing its longer real minor', () => {
    const obs = observation('W', '1H X 2H X P', 'K87.4.AQ85.KJ763');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'C'));
  });
  it('prefers the cheaper four-card major to a five-card minor with a weak takeout response', () => {
    const obs = observation('E', '2H X P', 'QT65.T32.KT874.2');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'S'));
  });
  it('retains the genuine six-card minor source instead of forcing the cheaper four-card major', () => {
    const obs = observation('E', '2H X P', 'QT65.T3.KT8742.2');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'D'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'D'));
  });
  it('does not use responsive X for only one unbid major', () => {
    const obs = observation('W', '1D X 2D', 'K875.Q86.32.J763');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('does not use responsive X below its free-action floor', () => {
    const obs = observation('W', '1D X 2D', 'J875.Q864.32.J73');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('does not convert technical X on enemy length and scattered queens without outside defense', () => {
    const obs = observation('S', 'P P P 1H P P X P', 'QJ3.AQ9876.QJ3.4');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(PASS);
  });
  it('retains a real partner fit ahead of a responsive request for the other suits', () => {
    const obs = observation('W', '1D 1H 2D', 'K875.Q864.3.J732');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('uses a sandwich double to show the two genuinely unbid suits', () => {
    const obs = observation('N', '1C P 1H', 'KQ74.5.AJ85.K764');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    expect(chooseBid(obs, 'sayc')).toEqual({ kind: 'double' });
  });
  it('keeps the usual direct takeout and natural overcall distinctions', () => {
    expect(chooseCompetitiveCall(observation('W', '1D', 'KJ85.Q643.4.AQ73'), 'sayc')).toEqual({ kind: 'double' });
    expect(chooseCompetitiveCall(observation('W', '1D', 'A85.KQJT64.4.K73'), 'sayc')).toEqual(bid(1, 'H'));
  });
  it.each([
    ['S', 'P P P 1H P P X P', 'KQJ.AQ87532.Q63.-', PASS],
    ['N', 'P 2H X P 3C', 'Q53.QJT763.732.3', PASS],
    ['E', 'P P P 1C 2C X 2H P', 'Q96542.KT873.AT.-', PASS],
    ['S', '1S 1NT P 2D 2S', 'QJ3.AQ94.53.AK62', bid(3, 'H')],
    ['S', '1S 1NT P 2D 2S', 'QJ3.AQ.953.AK642', PASS],
    ['N', 'P 1D X P 1S 2C', 'AKT4.AK97.T.8632', bid(2, 'S')],
    ['E', 'P 2D P', 'K82.A752.AK642.2', bid(5, 'D')],
    ['E', 'P 1D P P', 'Q876543.KQT7.T.4', bid(1, 'S')],
    ['W', '1C 1D 1S P 2C', '92.AK.AKJ7653.54', bid(2, 'D')],
    ['N', 'P 1NT', 'K.AQ987652.J3.K9', bid(2, 'H')],
  ] as const)('repairs fresh full-prefix competition finding %s %s', (start, text, holding, expected) => {
    const obs = observation(start, text, holding);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(expected);
    expect(chooseBid(obs, 'sayc')).toEqual(expected);
  });
});

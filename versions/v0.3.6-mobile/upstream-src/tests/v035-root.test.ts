import { describe, it, expect } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Suit, type Strain, type Seat, type AuctionEntry, PASS } from '../src/core/types';
const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
function obs(seat: Seat, holding: string, prefix: string): BiddingObservation {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const hand: Card[] = holding.split('.').flatMap((text, i) => [...text.replace('-', '')]
    .map(v => ({ id: `${suits[i]}${v}`, suit: suits[i], rank: '23456789TJQKA'.indexOf(v) + 2 })));
  const auction: AuctionEntry[] = prefix.split(' ').map(t => {
    const [seat, value] = t.split(':');
    return { seat: seat as Seat, call: value === 'P' ? PASS : value === 'X' ? {kind: 'double'} : bid(Number(value[0]), value.slice(1) as Strain) };
  });
  expect(hand).toHaveLength(13);
  return { phase: 'auction', board: 1, seat, actingSeat: seat, hand, auction, legalCalls: legalCalls(auction, seat), vulnerability: 'None' };
}
describe('v035 full-prefix core and hover integration', () => {
  it('does not discard a passed balanced eleven-point response to a third-seat major', () => {
    const o = obs('W', '84.A986.KT9.AT83', 'W:P N:P E:1S S:P');
    expect(chooseBid(o, 'sayc')).toEqual(bid(1, 'NT'));
  });
  it('answers fourth-suit forcing with the actual long major before a shorter last-mentioned minor', () => {
    const o = obs('E', '42.AQJ9832.AK84.-', 'N:P E:1H S:P W:1S N:P E:2D S:P W:3C N:P');
    expect(chooseBid(o, 'sayc')).toEqual(bid(3, 'H'));
  });
  it('escapes a penalized semi-forcing 1NT in the actual seven-card opening major', () => {
    const o = obs('W', 'AKJT732.AT7.T84.-', 'W:1S N:P E:1NT S:X');
    expect(chooseBid(o, 'sayc')).toEqual(bid(2, 'S'));
  });
  it('does not create a weak reverse after a passed-hand two-club response', () => {
    const o = obs('W', 'A7.AQ86.QT8652.4', 'E:P S:P W:1D N:P E:2C S:P');
    expect(chooseBid(o, 'sayc')).not.toEqual(bid(2, 'H'));
    expect(publicCallMeaningAt([...o.auction, {seat: o.seat, call: bid(2, 'H')}], o.auction.length, 'sayc').hcpRange?.min).toBe(17);
  });
  it('keeps a passed response distinct from a genuine game-forcing two-over-one', () => {
    const o = obs('W', 'A7.AQ86.QT8652.4', 'W:1D N:P E:2C S:P');
    expect(publicCallMeaningAt([...o.auction, {seat: o.seat, call: bid(2, 'H')}], o.auction.length, 'sayc').hcpRange?.min).toBeLessThan(17);
  });
  it('explains an interfered transfer using its legal competitive response', () => {
    const o = obs('W', 'QJ3.AQ94.53.AK62', 'S:1S W:1NT N:P E:2D S:2S');
    expect(chooseBid(o, 'sayc')).toEqual(bid(3, 'H'));
    const text = describeCall(o.auction, o.seat, bid(3, 'H'), 'sayc');
    expect(text).toContain('3');
    expect(text).not.toContain('应先按约定作出2H');
    expect(text).not.toContain('须接受到2H');
  });
});

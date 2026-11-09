import { describe, expect, it } from 'vitest';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
import { type BiddingObservation } from '../src/ai/observation';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { publicPlayerConstraints } from '../src/ai/bidding-semantics';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
function observation(start: Seat, prefix: string, holding: string): BiddingObservation {
  const seats: Seat[] = ['N', 'E', 'S', 'W'];
  const auction: AuctionEntry[] = prefix.split(' ').map((token, index) => ({
    seat: seats[(seats.indexOf(start) + index) % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : bid(Number(token[0]), token.slice(1) as Strain),
  }));
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const hand: Card[] = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(rank => ({
    id: `${suits[index]}${rank}`, suit: suits[index], rank: '23456789TJQKA'.indexOf(rank) + 2,
  })));
  if (hand.length !== 13) throw new Error('Adjudicated fixture must contain thirteen cards');
  const seat = seats[(seats.indexOf(start) + auction.length) % 4];
  return { board: 1, phase: 'auction', seat, actingSeat: seat, hand, auction,
    legalCalls: legalCalls(auction, seat), vulnerability: 'None' };
}

describe('release7 public strength and legal-space competition routes', () => {
  it.each([
    ['E', 'P 1D 1H 1S', '3.AJ73.42.AT9876', bid(2, 'D')],
    ['W', '1D 2C P', 'T74.4.KQJ54.8643', bid(2, 'D')],
  ] as const)('uses a fit-aware support cue with low raw HCP: %s %s', (start, prefix, hand, expected) => {
    const obs = observation(start, prefix, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(expected);
    expect(chooseBid(obs, 'sayc')).toEqual(expected);
  });

  it('804: lowest support stays nonforcing when the higher cue would require an unsupported game', () => {
    const obs = observation('N', '1S 2H 2S', '-.654.KJT642.A763');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(3, 'S'));
  });

  it('does not count a void as support strength before eight public trumps', () => {
    const obs = observation('N', '1S 1H P', '-.74.AJT962.KT865');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(2, 'S'));
  });

  it('4089: a stopped strong NT rebid remains possible after a zero-floor reply and interference', () => {
    const obs = observation('E', '1H X P 1S 2D', 'A986.K8.AQ53.AQ7');
    expect(publicPlayerConstraints(obs.auction, 'N', 'sayc').hcpRange?.min).toBe(0);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(2, 'NT'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'NT'));
    expect(chooseCompetitiveCall(observation('E', '1H X P 1S 2D', 'A986.98.AK53.AQ7'), 'sayc')).not.toEqual(bid(2, 'NT'));
  });

  it('4186: a strong delayed doubler can first describe its suit when advancer was free to pass', () => {
    const obs = observation('S', '1C P 1S X 2C P 2S', '3.AJ4.AKQJ764.K2');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'D'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'D'));
    expect(chooseCompetitiveCall(observation('S', '1C P 1S X 2C P 2S', '3.KJ4.AKQJ764.92'), 'sayc')).not.toEqual(bid(3, 'D'));
  });

  it.each([
    ['W', 'P 1H 1S 3H 3S', 'Q5.AK752.A63.AJ5'],
    ['N', 'P P P 1D 1H P 2H 2S 3H 3S P', 'AQ63.J2.AK765.A8'],
    ['W', '1H P P X P 2C P 2S P 3S P', 'KQ853.Q.K53.AK43'],
  ] as const)('does not discard known major game after response duties end: %s %s', (start, prefix, hand) => {
    const obs = observation(start, prefix, hand);
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, hand.includes('AK752') ? 'H' : 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, hand.includes('AK752') ? 'H' : 'S'));
  });

  it('7810: a weak-jump support hand places its known game before later competition', () => {
    const obs = observation('S', 'P 1C 2S X', '9842.AJT73.Q.A62');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'S'));
  });

  it('7805: strong cue advancer describes its real major after the compelled answer leaves a poor fit', () => {
    const obs = observation('E', '1C X P 2C P 2S P', '64.KQ543.J94.AQ3');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'H'));
    expect(chooseCompetitiveCall(observation('E', '1C X P 2C P 2S P', '64.KJ543.J94.AQ3'), 'sayc')).not.toEqual(bid(3, 'H'));
  });

  it('7373: a good six-card source can make a constructive three-level advance after interference', () => {
    const obs = observation('E', '1H 1S 2H', 'J8.T7.AKQ732.T72');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'D'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'D'));
    expect(chooseCompetitiveCall(observation('E', '1H 1S 2H', 'J8.T7.KQJ732.T72'), 'sayc')).not.toEqual(bid(3, 'D'));
  });

  it('7588: a minimum cue answer must not conceal game known from its own long-suit support values', () => {
    const obs = observation('N', '2H 2S P 3H P', 'AKJT98.764.KQT.2');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'S'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'S'));
  });

  it('7759: twenty-three support opposite a forced zero floor invites naturally without RKCB', () => {
    const obs = observation('W', 'P P 2D X P 3C P', 'AJ94.A.A86.AQJ73');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'C'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'C'));
    expect(publicPlayerConstraints(obs.auction, 'N', 'sayc').hcpRange?.min).toBe(0);
  });

  it('accepts the broad minor invitation with real five-HCP support, while a zero hand can reject', () => {
    const prefix = 'P P 2D X P 3C P 4C P';
    const constructive = observation('W', prefix, 'K.Q8.9752.T98642');
    const minimum = observation('W', prefix, '7.98.9752.T98642');
    expect(chooseCompetitiveCall(constructive, 'sayc')).toEqual(bid(5, 'C'));
    expect(chooseBid(constructive, 'sayc')).toEqual(bid(5, 'C'));
    expect(chooseCompetitiveCall(minimum, 'sayc')).toEqual(PASS);
    expect(chooseBid(minimum, 'sayc')).toEqual(PASS);
  });

  it('does not convert an enemy four-level raise into an unsupported five-heart reply', () => {
    const obs = observation('N', '1D 1S X 4S', '2.KQJ4.AJ83.QT92');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
});

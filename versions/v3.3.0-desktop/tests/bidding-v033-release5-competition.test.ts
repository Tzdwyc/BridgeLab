import { describe, expect, it } from 'vitest';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
import { type BiddingObservation } from '../src/ai/observation';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { isNaturalNoTrumpAt } from '../src/ai/bidding-semantics';

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
  if (hand.length !== 13) throw new Error('Explicitly adjudicated fixture must have thirteen cards');
  const seat = seats[(seats.indexOf(start) + auction.length) % 4];
  return { board: 1, phase: 'auction', seat, actingSeat: seat, hand, auction,
    legalCalls: legalCalls(auction, seat), vulnerability: 'None' };
}
const competitive = (start: Seat, prefix: string, hand: string) => chooseCompetitiveCall(observation(start, prefix, hand), 'sayc');

describe('release5 explicit GPT competition findings and mechanism counterexamples', () => {
  it('7313: honest delayed five-card suit beats an unstopped NT intervention', () => {
    expect(competitive('E', '1C P 1S', 'Q85.A74.AKQT3.92')).toEqual(bid(2, 'D'));
    expect(competitive('E', '1C P 1S', 'Q85.A74.AJ753.92')).not.toEqual(bid(1, 'NT'));
  });
  it('7316,7358,7534,7629: known nine-plus fit permits four-minor competition below game strength', () => {
    for (const [start, prefix, hand] of [
      ['N', 'P 1H X P 3C 3H', 'AQJ9.4.QT6.AJ974'],
      ['S', '1C 1D 1H 1S 2C 2S 3C 3S', '4.Q5.AJ75.AQT986'],
      ['S', 'P P 1C 2C 3C 3S', 'KQT.J854.Q3.A986'],
      ['E', '1D P 1H 2C 2H 3C 3H', '85.4.A84.AKQ7643'],
    ] as const) {
      const obs = observation(start, prefix, hand);
      expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(4, 'C'));
      expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'C'));
    }
  });
  it('7597: a flat nine-point hand with only public eight-fit does not compete four-minor', () => {
    expect(competitive('E', 'P 1S 2C 3S', 'A92.AT76.T95.J73')).toEqual(PASS);
  });
  it('7395: a penalty conversion is kept; a takeout request still receives a natural answer', () => {
    expect(competitive('W', '1D P 1S 2H X P', 'KQT7642.3.7.KJ43')).toEqual(PASS);
    expect(competitive('N', '1D X P', 'QT83.J743.92.864')).not.toEqual(PASS);
  });
  it('7437: enemy intervention does not erase a balancing NT invitation', () => {
    expect(competitive('E', '1H P P 1NT 2H', 'KT9.KJ4.K93.J654')).toEqual(bid(2, 'NT'));
    expect(competitive('E', '1H P P 1NT 2H', 'KT9.J74.K93.J654')).not.toEqual(bid(2, 'NT'));
  });
  it('7656: a long-minor semibalanced invitation can have the enemy stopper', () => {
    expect(competitive('N', '1C 1D P', 'Q84.A6.J2.AJ9863')).toEqual(bid(2, 'NT'));
    expect(competitive('N', '1C 1D P', 'Q84.A6.J2.JT9863')).not.toEqual(bid(2, 'NT'));
  });
  it('7541: a previously public strong six-card suit can compete at three without inventing a game', () => {
    expect(competitive('E', 'P 1H X 2H P P 2S 3H P P', 'AKJ973.A6.AT3.K9')).toEqual(bid(3, 'S'));
  });
  it('7700: strict17 free longest five-card suit precedes unsupported seven-fit raising', () => {
    expect(competitive('N', '1H X P 2C P', 'J94.A.AKJT6.AT62')).toEqual(bid(2, 'D'));
    expect(competitive('N', '1H X P 2C P', 'T94.A.AKJT6.AT62')).not.toEqual(bid(2, 'D'));
  });
  it('7738: genuine jump-invitation NT game precedes a no-fit five-card major at game level', () => {
    const obs = observation('S', 'P P 2D X P 3S P', '65.AKQ64.KJ.KJT5');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'NT'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'NT'));
    // QJ doubleton is not a diamond stopper; a five-card heart suit still
    // cannot manufacture an unsupported four-heart game from raw strength.
    expect(competitive('S', 'P P 2D X P 3S P', '65.AKQ64.QJ.AJT5')).not.toEqual(bid(3, 'NT'));
    expect(competitive('S', 'P P 2D X P 3S P', '65.AKQ64.QJ.AJT5')).not.toEqual(bid(4, 'H'));
  });
  it('7654,7570,7406: absolute four-level bids are not compulsory when a lower reply is legal', () => {
    expect(competitive('S', 'P 3C X P', '7653.J942.873.72')).toEqual(bid(3, 'S'));
    expect(competitive('S', '3D P P X P', '863.J9632.84.A52')).toEqual(bid(3, 'H'));
    expect(competitive('S', '2S P P X P', '63.K7543.AT6.Q42')).toEqual(bid(3, 'H'));
    expect(competitive('S', '3S P P X P', '863.J9632.84.A52')).toEqual(bid(4, 'H'));
  });
  it('7721: a stopped, publicly justified NT game precedes a cue forcing high no-fit replies', () => {
    expect(competitive('E', '2S X P', 'AJ542.QJ4.KQ.T82')).toEqual(bid(3, 'NT'));
    expect(competitive('E', '2S X P', 'J9542.QJ4.KQ.T82')).not.toEqual(bid(3, 'NT'));
  });
  it('7588: a natural overcall range cannot be inflated just because the enemy opened weak two', () => {
    expect(competitive('N', '2H 2S P', 'Q43.AQ53.9.QJ874')).toEqual(bid(3, 'H'));
  });
  it('7434,7657: cheapest competitive support cannot manufacture four-major game strength', () => {
    expect(competitive('S', 'P 2S 3H 3S', '2.K72.K842.97642')).toEqual(PASS);
    expect(competitive('E', 'P 1H 1S 3H 3S 4H', 'AJT63.8.KJ9875.3')).toEqual(PASS);
  });
  it('7452: the cheap support-cue answer completes F1 without manufacturing a major game', () => {
    const obs = observation('N', '1C 1H 2C 3C X 3H P', 'J53.J86.AQT764.K');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('7611: a four-level new suit that forces game needs public game strength', () => {
    expect(competitive('W', 'P 1S 3H', 'T8.T2.K875.AKQ96')).toEqual(PASS);
    expect(competitive('W', 'P 1S 3H', 'T8.T2.KJ75.AKQ96')).toEqual(bid(4, 'C'));
    expect(chooseBid(observation('W', 'P 1S 3H', 'T8.T2.K875.AKQ96'), 'sayc')).toEqual(PASS);
  });
  it('7789: a negative double showing both minors gives an honest eight-card minor fit', () => {
    expect(competitive('E', 'P 1H 1S X 2S', 'K9.AQJ42.AT.JT97')).toEqual(bid(3, 'C'));
  });
  it('7337: negative-double minor support uses the same29 public floor, not an unsupported major game', () => {
    expect(competitive('E', 'P P P 1H 1S X 3S', '-.QJ652.AQ8753.A2')).toEqual(bid(5, 'D'));
    expect(competitive('E', 'P P P 1H 1S X 3S', '-.QJ652.AQ8753.K2')).toEqual(bid(4, 'D'));
  });
  it('7791: a genuinely cashable six-card minor receives the natural three-level quality exception', () => {
    expect(competitive('W', 'P P 1H P 2H', '-.8632.T96.AKQJT9')).toEqual(bid(3, 'C'));
    expect(competitive('W', 'P P 1H P 2H', '-.8632.T96.AKQ974')).not.toEqual(bid(3, 'C'));
    expect(competitive('W', 'P P 1H P 2H', '-.8632.T96.KQJ974')).not.toEqual(bid(3, 'C'));
  });
  it('7665: clean weak-two new suits retain13+ forcing strength, even with a long bad-fit escape', () => {
    expect(competitive('E', '2D P', 'K6.KQT2.-.QT97632')).not.toEqual(bid(3, 'C'));
    expect(competitive('E', '2D P', 'K6.KQT2.9.QT9763')).not.toEqual(bid(3, 'C'));
    expect(competitive('E', '2D P', 'K6.KQT2.92.QT976')).not.toEqual(bid(3, 'C'));
    expect(competitive('E', '2D P', 'K6.KQT2.9.J98763')).not.toEqual(bid(3, 'C'));
    expect(chooseBid(observation('E', '2D P', 'K6.KQT2.9.AQ9763'), 'sayc')).toEqual(bid(3, 'C'));
  });
  it('weak six-plus minor escape requires its publicly defined nonpreempt background', () => {
    expect(competitive('N', '1D P 1S P 2D P', 'KJ74.96.-.QT98632')).toEqual(bid(3, 'C'));
    expect(competitive('N', '1D P 1S P 2D P', 'KJ74.9.873.QT963')).not.toEqual(bid(3, 'C'));
  });
  it('7707: enemy natural NT permits a constructive five-card NF response to weak two', () => {
    expect(competitive('W', '2D 2NT', 'KQJ95.A.64.AJT43')).toEqual(bid(3, 'S'));
    expect(competitive('W', '2D 2NT', 'KQ975.6.64.AJT43')).toEqual(bid(3, 'S'));
    expect(competitive('W', '2D 2NT', 'QJ975.6.64.KT943')).not.toEqual(bid(3, 'S'));
  });
  it('takeout invitations distinguish cheapest one-level and weak-two forced replies', () => {
    expect(competitive('N', '1H X P 1S P', 'KQ74.A92.A83.KJ6')).toEqual(bid(2, 'S'));
    expect(competitive('N', '2H X P 2S P', 'KQ74.A92.A83.KJ6')).not.toEqual(bid(3, 'S'));
    expect(competitive('N', '2H X P 2S P', 'KQ74.A92.AK3.QT6')).toEqual(bid(3, 'S'));
    // Four spades opposite a three-card forced reply do not establish a fit;
    // a private diamond void must not turn raw16 into an18+ invitation.
    expect(chooseBid(observation('W', 'P 2D X P 2S P', 'A532.A43.-.AKJ852'), 'sayc')).toEqual(PASS);
  });
  it('weak correction is blocked by an existing eight-fit or game force', () => {
    expect(competitive('N', '1H P 1NT P 2H P', '64.832.7.KQJT963')).not.toEqual(bid(3, 'C'));
    expect(competitive('N', '1S P 2D P 2H P', '4.6.AQJT975.KT32')).not.toEqual(bid(3, 'D'));
  });
  it('7741: artificial Michaels inquiry never becomes a natural NT platform', () => {
    const artificial = observation('E', 'P P 1S 2S P 2NT P', 'K976.5.KJ74.A752');
    expect(isNaturalNoTrumpAt(artificial.auction, 5, 'sayc')).toBe(false);
    const natural = observation('N', '1D 1NT P', 'K976.5.KJ74.A752');
    expect(isNaturalNoTrumpAt(natural.auction, 1, 'sayc')).toBe(true);
  });
  it('the full chooser retains the adjudicated competitive contracts and weak passes', () => {
    for (const [start, prefix, hand, expected] of [
      ['E', '1C P 1S', 'Q85.A74.AKQT3.92', bid(2, 'D')],
      ['E', 'P 1S 2C 3S', 'A92.AT76.T95.J73', PASS],
      ['W', '1D P 1S 2H X P', 'KQT7642.3.7.KJ43', PASS],
      ['E', '1H P P 1NT 2H', 'KT9.KJ4.K93.J654', bid(2, 'NT')],
      ['N', '1C 1D P', 'Q84.A6.J2.AJ9863', bid(2, 'NT')],
      ['E', 'P 1H X 2H P P 2S 3H P P', 'AKJ973.A6.AT3.K9', bid(3, 'S')],
      ['N', '1H X P 2C P', 'J94.A.AKJT6.AT62', bid(2, 'D')],
      ['S', 'P 3C X P', '7653.J942.873.72', bid(3, 'S')],
      ['S', '3D P P X P', '863.J9632.84.A52', bid(3, 'H')],
      ['S', '2S P P X P', '63.K7543.AT6.Q42', bid(3, 'H')],
      ['E', '2S X P', 'AJ542.QJ4.KQ.T82', bid(3, 'NT')],
      ['N', '2H 2S P', 'Q43.AQ53.9.QJ874', bid(3, 'H')],
      ['S', 'P 2S 3H 3S', '2.K72.K842.97642', PASS],
      ['E', 'P 1H 1S 3H 3S 4H', 'AJT63.8.KJ9875.3', PASS],
      ['E', 'P 1H 1S X 2S', 'K9.AQJ42.AT.JT97', bid(3, 'C')],
      ['W', 'P P 1H P 2H', '-.8632.T96.AKQJT9', bid(3, 'C')],
      ['E', '2D P', 'K6.KQT2.-.QT97632', PASS],
      ['W', '2D 2NT', 'KQJ95.A.64.AJT43', bid(3, 'S')],
    ] as const) expect(chooseBid(observation(start, prefix, hand), 'sayc'), prefix).toEqual(expected);
  });
});

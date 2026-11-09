import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';

const call = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +text[0], strain: text.slice(1) as Strain };
function observe(seat: Seat, holding: string, prefix: string): BiddingObservation {
  const hand: Card[] = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map(token => {
    const [actor, text] = token.split(':'); return { seat: actor as Seat, call: call(text) };
  });
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat, hand, auction, legalCalls: legalCalls(auction, seat) };
}

// Authored from these hands and public prefixes, with no hidden partner cards.
describe('v033 approved readonly audit mechanisms', () => {
  it.each([
    ['Stayman denial with only four hearts invites in NT', 'S', 'J54.JT87.AJ.JT85', 'N:1NT E:P S:2C W:P N:2D E:P', '2NT'],
    ['minimum NT declines that invitation', 'N', 'A7.A54.KT872.A62', 'N:1NT E:P S:2C W:P N:2D E:P S:2NT W:P', 'P'],
    ['maximum NT accepts other four-card major without inventing eight fit', 'W', '942.AQ95.A54.AK2', 'N:P E:P S:P W:1NT N:P E:2C S:P W:2H N:P E:2S S:P', '3NT'],
    ['minimum NT declines other four-card major in NT rather than seven trumps', 'W', '942.AQ95.A54.KQ2', 'W:1NT N:P E:2C S:P W:2H N:P E:2S S:P', '2NT'],
    ['published game floor cannot remain a refuseable invitation', 'E', 'AQT964.AQT5.-.KQ8', 'W:P N:P E:1S S:P W:2S N:P', '4S'],
    // Partner's3H promises three, so ownfour establishes only seven hearts.
    ['fulfilled F1 preserves a truthful five-spade description without inventing eighth heart', 'S', 'AKT72.Q953.6.KJ5', 'W:P N:1D E:P S:1S W:P N:2D E:P S:2H W:P N:3H E:P', '3S'],
    ['fourth suit stopper reply discloses eighteen points', 'E', 'K.AJ.K9863.AQJT4', 'N:P E:1D S:P W:1S N:P E:2C S:P W:2H N:P', '3NT'],
    ['fourth suit minimum stopper reply stays below game', 'E', 'K.AJ.K9863.QJT74', 'N:P E:1D S:P W:1S N:P E:2C S:P W:2H N:P', '2NT'],
    ['passed natural new suit NF still receives a sensible seven-heart preference', 'N', 'KQT6.K64.A.QJ873', 'S:P W:P N:1C E:P S:1H W:P N:1S E:P S:2D W:P', '2H'],
    ['strong redouble remains public game strength', 'E', 'AJ76.95.A95.A762', 'W:1D N:X E:XX S:P W:P N:2C', '3NT'],
    ['sixteen-point good six-heart hand directly overcalls instead of false strong double', 'E', 'KQ4.KQT854.Q94.A', 'W:P N:1C', '1H'],
    ['competitive opener three-card raise allows seven-fit partscore, not manufactured game', 'W', 'KJ75.A5.T4.QJ952', 'W:P N:P E:1C S:1D W:1S N:2D E:2S S:3D', '3S'],
    ['minimum competitive three-spade raise is not a ten-point invitation', 'N', 'AQJ3.KT52.T.AT85', 'N:1C E:P S:1S W:2D N:2S E:3D S:3S W:P', 'P'],
    ['eighteen after false preference describes NT extras rather than repeating four clubs', 'E', 'AQJ83.KJ.Q9.KQ73', 'N:P E:1S S:P W:1NT N:P E:2C S:P W:2S N:P', '2NT'],
    ['redouble lower limit alone does not force twenty-five', 'E', 'AJ76.95.A95.Q762', 'W:1D N:X E:XX S:P W:P N:2C', 'P'],
    ['good six-club eleven-point escape has distinct invitation', 'S', 'KQ65.J52.-.KQ9852', 'N:1D E:P S:1S W:P N:2D E:P', '4C'],
    ['weak six-club escape remains natural nonforcing', 'S', 'Q965.J52.-.KQ9852', 'N:1D E:P S:1S W:P N:2D E:P', '3C'],
    ['fast Jacoby game does not make Jxxxx a slam ask', 'S', 'AQ2.J9732.Q.AKT9', 'E:P S:1H W:P N:2NT E:P S:3D W:P N:4H E:P', 'P'],
    ['ambiguous zero-three reply signs off before trump queen', 'W', '9.AJ65.K.QJ97642', 'W:P N:P E:1D S:P W:1H N:P E:3H S:P W:4NT N:P E:5D S:P', '5H'],
    ['five hearts signoff is never a queen request', 'E', 'AJT3.Q983.AT85.A', 'W:P N:P E:1D S:P W:1H N:P E:3H S:P W:4NT N:P E:5D S:P W:5H N:P', 'P'],
    ['a safe below-spade queen ask retains five spades without the queen', 'S', 'KJT98.Q97.QT3.J2', 'N:1S E:P S:3S W:P N:4NT E:P S:5C W:P N:5D E:P', '5S'],
    ['king reply adds one control without accepting grand slam', 'N', 'A53.AQ974.JT754.-', 'S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P N:3NT E:P S:4H W:P N:4NT E:P S:5D W:P N:5NT E:P S:6C W:P', '6H'],
    ['king above safe six-heart contract is not shown', 'S', 'KQJ8.AQ9.AQ8.A87', 'S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P N:3NT E:P S:4H W:P N:4NT E:P S:5D W:P N:5NT E:P', '6H'],
  ])('%s', (_name, seat, hand, prefix, expected) => {
    const obs = observe(seat as Seat, hand, prefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call(expected));
  });
  it.each(['sayc', 'two-over-one'] as const)('semi-forcing NT does not invent a three-card minor in %s', system => {
    expect(chooseBid(observe('N', 'KQ98.AJ876.K32.4', 'N:1H E:P S:1NT W:P'), system)).toEqual(PASS);
  });
  it.each(['sayc', 'two-over-one'] as const)('both identifiers allow the agreed five-point semi-forcing response in %s', system => {
    expect(chooseBid(observe('S', 'T9.Q76.K954.T763', 'N:1S E:P'), system)).toEqual(call('1NT'));
  });
  it.each(['sayc', 'two-over-one'] as const)('unbalanced sixteen may pass only when its four-card suit would require an understrength reverse in %s', system => {
    expect(chooseBid(observe('N', 'AK98.AK876.Q32.4', 'N:1H E:P S:1NT W:P'), system)).toEqual(PASS);
  });
  it.each(['sayc', 'two-over-one'] as const)('seventeen shows the actual four-spade reverse rather than using the semi-forcing escape in %s', system => {
    expect(chooseBid(observe('N', 'AK98.AK876.K32.4', 'N:1H E:P S:1NT W:P'), system)).toEqual(call('2S'));
  });
});

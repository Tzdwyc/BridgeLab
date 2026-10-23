import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { analyzeAuctionSemantics, publicPlayerConstraints, publicCallMeaningAt, publicStrongMinorTrialAt } from '../src/ai/bidding-semantics';
import { feasiblePublicKeycardCounts, publicSupportMinimum } from '../src/ai/suit-evaluation';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS, partnerOf } from '../src/core/types';

const call = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
function position(seat: Seat, holding: string, prefix: string): BiddingObservation {
  const hand: Card[] = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map(token => {
    const [actor, text] = token.split(':'); return { seat: actor as Seat, call: call(text) };
  });
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat,
    hand, auction, legalCalls: legalCalls(auction, seat) };
}
describe('release14 real sources and public misfits', () => {
  it.each([
    ['3NT Stayman answer survives missing fit', 'W', 'AK5.AQ742.KQJ.AQ', 'S:P W:3NT N:P E:4C S:P', '4H'],
    ['six AQ strong balanced-minor source', 'S', 'AKQ.J8.AT.AQ8742', 'E:P S:1C W:P N:1H E:P', '3NT'],
    ['strong double shows real second long suit', 'E', 'AJ5.AKQJT.AKQ63.-', 'S:P W:P N:3C E:X S:P W:3S N:P', '4D'],
    ['seven card king-jack source needs only two honors', 'W', 'A.KT6.KQ.KJ98752', 'W:1C N:1S E:X S:2S', '3C'],
    ['other major invitation accepted with public support floor', 'W', 'AT53.98.KJ983.63', 'W:P N:P E:1NT S:P W:2C N:P E:2H S:P W:2S N:P E:3S S:P', '4S'],
    ['seventeen double describes seven clubs', 'W', 'A6.J52.K.AKQT942', 'S:3D W:X N:P E:3S S:P', '4C'],
    ['strong minor NT does not bypass real major fit', 'W', 'AT85.AJ83.AK.KT7', 'W:1C N:P E:1S S:P', '4S'],
    ['heart source escapes diamond void', 'E', 'T964.AQJ7642.-.KQ', 'W:2D N:P E:P S:2NT W:P N:P E:3H S:P W:4D N:P', '4H'],
    ['strong preempt responder escapes own trump void', 'W', '-.AKT862.A64.KQJ2', 'E:3S S:P', '4H'],
    ['six-six responder escapes own trump void', 'W', '-.KQ9765.J.AKJ863', 'N:P E:3S S:P', '4C'],
    ['known singleton rejects another weak spade repeat', 'E', 'KQT765.AJ4.3.J72', 'E:2S S:P W:3D N:P E:3S S:P W:4C N:P', 'P'],
    ['stopped minimum NT does not trigger a redundant enemy cue', 'W', 'Q95.K3.642.AQ976', 'S:P W:P N:P E:1D S:1S W:2C N:P E:2NT S:P', 'P'],
    ['known raw game with own enemy stopper prefers NT to a cue', 'N', 'AJ542.QJ4.KQ.T82', 'E:2S S:X W:P', '3NT'],
  ])('%s', (_name, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat as Seat, holding, prefix), 'sayc')).toEqual(call(expected));
  });
});

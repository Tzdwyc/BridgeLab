import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { naturalSuitMinimum } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
const parse = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +text[0], strain: text.slice(1) as Strain };
function position(seat: Seat, holding: string, prefix: string): BiddingObservation {
  const hand: Card[] = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map(token => {
    const [actor, text] = token.split(':'); return { seat: actor as Seat, call: parse(text) };
  });
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat, hand, auction, legalCalls: legalCalls(auction, seat) };
}
// Expectations individually authored from the holding and public promises.
describe('v033 final confirmed common repairs', () => {
 it.each([
  ["560/10", "E", "KQ876.7.T2.AQ853", "N:2H E:P S:P W:2NT N:P E:3H S:P W:3S N:P", "3NT"],
  ["573/7", "W", "Q95.AJT52.KJ5.74", "E:P S:1S W:2H N:2S E:3S S:X", "3H"],
  ["712/5", "N", "7.AJ83.K986.Q943", "N:P E:2S S:2NT W:3S", "3NT"],
  ["723/6", "N", "JT7.AQ76.A2.QT52", "W:P N:1C E:1S S:2D W:P", "2NT"],
  ["825/9", "E", "K976.AJT97.52.Q6", "E:P S:P W:1D N:2S E:X S:P W:3C N:P", "3H"],
  ["832/10", "E", "J963.J653.65.K92", "N:P E:P S:1C W:X N:1H E:P S:2C W:P N:P", "P"],
  ["840/9", "N", "T32.T8653.J7.A72", "N:P E:1D S:X W:P N:1H E:P S:3H W:P", "4H"],
  ["869/9", "E", "J3.KT53.T3.AK754", "E:P S:P W:1D N:1S E:X S:P W:1NT N:P", "2NT"],
  ["938/7", "N", "7.KJ85.K9.AJT876", "S:1D W:1S N:X E:P S:1NT W:P", "2NT"],
  ["947/10", "N", "K852.J7543.984.J", "W:P N:P E:P S:1C W:P N:P E:1D S:1H W:P", "2H"],
  ["972/4", "W", "QJ9.987542.-.AJ93", "N:P E:1H S:X", "4H"],
  ["979/3", "E", "83.T.AQ8542.AQ32", "W:1D N:P", "5D"],
  ["984/8", "W", "AQT32.K9863.7.32", "N:P E:1D S:P W:1S N:P E:2C S:P", "2H"],
  ["999/5", "W", "A4.K.AQ962.AQ742", "W:1D N:P E:1NT S:P", "3C"],
  ["1012/1", "N", "JT2.K.A9.T876532", "", "P"],
  ["1069/7", "W", "K.KQ98.AK832.KJ3", "E:P S:2H W:X N:P E:3D S:P", "4D"],
  ["1087/8", "S", "AKT72.Q953.6.KJ5", "W:P N:1D E:P S:1S W:P N:2D E:P", "2H"],
  ["1090/5", "S", "AK3.4.AK5.QT8643", "S:1C W:2H N:2NT E:P", "3NT"],
  ["1117/8", "N", "QT74.AK8.AQJ8.K3", "E:P S:P W:P N:1D E:1S S:P W:P", "2NT"],
  ["1131/6", "N", "K2.KQ5.KQJT65.A2", "W:P N:1D E:2H S:X W:P", "3NT"],
  ["4607/7", "E", "KQ4.KQT854.Q94.A", "W:P N:1C E:X S:P W:1D N:P", "1H"],
  ["4682/7", "N", "AJT98752.43.Q.Q9", "S:1H W:P N:1S E:P S:3C W:P", "3S"],
  ["7411/10", "N", "T9864.T8.A96.QJ2", "W:1D N:P E:1S S:P W:2C N:P E:P S:X W:P", "2H"],
  ["7672/5", "N", "JT9.AKQ75.QT2.AQ", "N:1H E:2D S:P W:3D", "3H"],
  ["7738/8", "E", "65.AKQ64.KJ.KJT5", "S:P W:P N:2D E:X S:P W:3S N:P", "3NT"],
  ["7774/8", "E", "Q97.T987.JT43.96", "S:1C W:X N:1S E:P S:2C W:P N:P", "P"],
  ["7781/13", "E", "84.KJT6.64.QJT74", "E:P S:P W:1D N:P E:1H S:P W:1S N:P E:1NT S:P W:2NT N:P", "P"],
])('%s', (_name,seat,hand,prefix,expected) => { expect(chooseBid(position(seat as Seat,hand,prefix),'sayc')).toEqual(parse(expected)); });
});

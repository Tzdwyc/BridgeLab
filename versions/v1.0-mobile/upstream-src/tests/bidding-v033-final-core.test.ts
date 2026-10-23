import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { naturalSuitMinimum, noTrumpRangeAt, publicCallMeaningAt } from '../src/ai/bidding-semantics';
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
  ["573/7 cue has consumed three hearts so lowest heart answer is four", "W", "Q95.AJT52.KJ5.74", "E:P S:1S W:2H N:2S E:3S S:X", "4H"],
  ["712/5", "N", "7.AJ83.K986.Q943", "N:P E:2S S:2NT W:3S", "3NT"],
  ["723/6 thirteen points give the minimum club answer without a fifteen-point unsupported cue", "N", "JT7.AQ76.A2.QT52", "W:P N:1C E:1S S:2D W:P", "3C"],
  ["825/9", "E", "K976.AJT97.52.Q6", "E:P S:P W:1D N:2S E:X S:P W:3C N:P", "3H"],
  ["832/10", "E", "J963.J653.65.K92", "N:P E:P S:1C W:X N:1H E:P S:2C W:P N:P", "P"],
  ["840/9", "N", "T32.T8653.J7.A72", "N:P E:1D S:X W:P N:1H E:P S:3H W:P", "4H"],
  ["869/9", "E", "J3.KT53.T3.AK754", "E:P S:P W:1D N:1S E:X S:P W:1NT N:P", "2NT"],
  // A singleton is unsuitable for the old NT invitation; the approved genuine-NT long-minor invitation shows six clubs and11 raw.
  ["938/7", "N", "7.KJ85.K9.AJT876", "S:1D W:1S N:X E:P S:1NT W:P", "3C"],
  ["947/10", "N", "K852.J7543.984.J", "W:P N:P E:P S:1C W:P N:P E:1D S:1H W:P", "2H"],
  ["972/4", "W", "QJ9.987542.-.AJ93", "N:P E:1H S:X", "4H"],
  ["979/3", "E", "83.T.AQ8542.AQ32", "W:1D N:P", "5D"],
  // The new bounded weak five-spade return avoids both a false ten-point fourth-suit inquiry and a false sixth spade.
  ["984/8 nine HCP uses the approved five-spade weak return", "W", "AQT32.K9863.7.32", "N:P E:1D S:P W:1S N:P E:2C S:P", "2S"],
  ["999/5", "W", "A4.K.AQ962.AQ742", "W:1D N:P E:1NT S:P", "3C"],
  ["1012/1", "N", "JT2.K.A9.T876532", "", "P"],
  // Lowest forced3D publishes three cards and zero HCP, not a ten-point
  // invitation. Strong own support can invite4D without inventing33 combined.
  ["1069 forced zero-point diamond reply permits an honest strong four-diamond invitation", "W", "K.KQ98.AK832.KJ3", "E:P S:2H W:X N:P E:3D S:P", "4D"],
  ["1087/8", "S", "AKT72.Q953.6.KJ5", "W:P N:1D E:P S:1S W:P N:2D E:P", "2H"],
  ["1090/5", "S", "AK3.4.AK5.QT8643", "S:1C W:2H N:2NT E:P", "3NT"],
  ["1117/8", "N", "QT74.AK8.AQJ8.K3", "E:P S:P W:P N:1D E:1S S:P W:P", "2NT"],
  ["1131/6", "N", "K2.KQ5.KQJT65.A2", "W:P N:1D E:2H S:X W:P", "3NT"],
  ["4607/7 prior wrong double cannot turn sixteen into strict seventeen-plus rebid", "E", "KQ4.KQT854.Q94.A", "W:P N:1C E:X S:P W:1D N:P", "P"],
  // Own eight spades already confirms eight without hidden partner support.
  // Own9 + strong jump's19 raw gives28; missing public side control prevents
  // RKCB, but retaining game below3S would ignore the real own-long source.
  ["4682/7", "N", "AJT98752.43.Q.Q9", "S:1H W:P N:1S E:P S:3C W:P", "4S"],
  ["7411/10", "N", "T9864.T8.A96.QJ2", "W:1D N:P E:1S S:P W:2C N:P E:P S:X W:P", "2H"],
  ["7672/5", "N", "JT9.AKQ75.QT2.AQ", "N:1H E:2D S:P W:3D", "3H"],
  ["7738/8", "E", "65.AKQ64.KJ.KJT5", "S:P W:P N:2D E:X S:P W:3S N:P", "3NT"],
  ["7774/8", "E", "Q97.T987.JT43.96", "S:1C W:X N:1S E:P S:2C W:P N:P", "P"],
  ["7781/13", "E", "84.KJT6.64.QJT74", "E:P S:P W:1D N:P E:1H S:P W:1S N:P E:1NT S:P W:2NT N:P", "3NT"],
  ["895/11 competitive heart raise has no ten-point invitation", "E", "A4.AQJ532.T5.K63", "W:P N:P E:1H S:X W:2H N:P E:P S:2S W:3H N:P", "P"],
  ["976/10 ten HCP use a natural maximum one NT", "E", "762.KJ642.A9.Q62", "N:P E:P S:P W:1C N:1D E:1H S:P W:1S N:P", "1NT"],
  ["1073/5 weak two raise remains preemptive", "E", "AT9832.9.KT632.A", "E:2S S:P W:3S N:P", "P"],
  ["7265 the newly defined natural five-heart GF supplies eight hearts and game", "W", "AK96.K65.Q9.K953", "E:P S:P W:1NT N:P E:2C S:X W:2S N:P E:3H S:P", "4H"],
  ["7468/12 nineteen plus real nine diamonds retains slam exploration", "W", "AQ4.AKQT.AT942.6", "N:P E:1C S:P W:1H N:P E:2C S:P W:2D N:P E:3D S:P", "4NT"],
  ["4244/11 eighteen points prefer original clubs to weak four-card second repeat", "S", "AKT8.J7.AJ.KQ963", "N:P E:P S:1C W:P N:1H E:P S:1S W:P N:2C E:P", "3C"],
  ["4390/12 twelve points invite after fourth-suit response", "E", "KT.AJ87.64.A9543", "S:P W:1D N:P E:1H S:P W:1S N:P E:2C S:P W:2S N:P", "2NT"],
  ["7185 three spades with all stoppers can place known twenty-six in NT", "N", "QJ5.AT.KT7542.A5", "E:P S:1C W:P N:1D E:P S:1H W:P", "3NT"],
  ["7453/7 singleton spade cannot be a natural one-spade probe", "W", "Q.J43.KQJ983.KJ2", "E:1C S:P W:1D N:P E:1H S:P", "2S"],
  ["2720/5 negative double counts as a partner action", "W", "AKQ8.T74.A8.AJ96", "W:1C N:1H E:X S:P", "4S"],
  ["7777/6 Jacoby two NT remains an artificial support question", "S", "AQ2.J9732.Q.AKT9", "E:P S:1H W:P N:2NT E:P", "3D"],
  ["976/12 nineteen accepts a later natural one NT instead of releasing known game", "W", "AKJ8.AT9.532.AK7", "N:P E:P S:P W:1C N:1D E:1H S:P W:1S N:P E:1NT S:P", "3NT"],
  ["4390/14 fourteen accepts a natural NT invitation after fulfilled fourth-suit answer", "W", "AQJ5.Q3.AJT53.82", "S:P W:1D N:P E:1H S:P W:1S N:P E:2C S:P W:2S N:P E:2NT S:P", "3NT"],
])('%s', (_name,seat,hand,prefix,expected) => { expect(chooseBid(position(seat as Seat,hand,prefix),'sayc')).toEqual(parse(expected)); });
 it('separates the same-price unsupported cue at fifteen raw from a minimum four-club answer', () => {
   const prefix='W:P N:1C E:1S S:2D W:P';
   const minimum=position('N','JT7.AQ76.A2.QT52',prefix);
   const stronger=position('N','JT7.AQ76.A2.KJ52',prefix);
   expect(chooseBid(minimum,'sayc')).toEqual(parse('3C'));
   expect(chooseBid(stronger,'sayc')).toEqual(parse('2S'));
   expect(publicCallMeaningAt([...minimum.auction,{seat:'N',call:parse('2S')}],minimum.auction.length,'sayc'))
     .toMatchObject({role:'cue',hcpRange:{min:15,max:21}});
   expect(publicCallMeaningAt([...minimum.auction,{seat:'N',call:parse('3C')}],minimum.auction.length,'sayc'))
     .toMatchObject({role:'natural-repeat',suitMinimum:4,forcing:'none'});
 });
 it('retains responder NT public ranges through long natural and answered inquiry sequences', () => {
   const first=position('W','AKJ8.AT9.532.AK7','N:P E:P S:P W:1C N:1D E:1H S:P W:1S N:P E:1NT S:P');
   expect(noTrumpRangeAt(first.auction,9,'sayc')).toEqual({min:6,max:10});
   const second=position('W','AQJ5.Q3.AJT53.82','S:P W:1D N:P E:1H S:P W:1S N:P E:2C S:P W:2S N:P E:2NT S:P');
   expect(noTrumpRangeAt(second.auction,11,'sayc')).toEqual({min:11,max:12});
 });
});

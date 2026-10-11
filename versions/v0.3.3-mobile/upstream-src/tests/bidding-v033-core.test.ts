import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { naturalSuitMinimum } from '../src/ai/bidding-semantics';
import { evaluateSuitFit } from '../src/ai/suit-evaluation';
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
// These concrete expected calls were authored from the acting hand and public
// sequence. They are regression contracts, not an automated quality scorer.
describe('v0.3.3 public fit, invitations and released one-round forces', () => {
  it.each([
    ['557 Stayman eight-fit earns shortness', 'W', 'K763.52.Q6.QJT85', 'E:1NT S:P W:2C N:P E:2S S:P', '4S'],
    ['557 opener accepts with adjusted support', 'E', 'AT982.AKT.J73.A7', 'E:1NT S:P W:2C N:P E:2S S:P W:3S N:P', '4S'],
    ['591 seven-card major invites instead of passing two clubs', 'S', 'KQT9532.32.KQ.J3', 'W:P N:1D E:P S:1S W:P N:2C E:P', '3S'],
    ['705 weak six-card response escapes the second minor', 'W', 'J87532.A72.Q9.82', 'E:1D S:P W:1S N:P E:2C S:P', '2S'],
    ['700 accepts strong major repeat at public25', 'E', '74.KQ763.QT53.JT', 'N:P E:P S:P W:1S N:P E:1NT S:P W:3S N:P', '4S'],
    ['710 ten points retain invitation after natural1NT', 'E', 'KJ4.K7542.4.K864', 'S:P W:1D N:P E:1H S:P W:1NT N:P', '2NT'],
    ['858 released ordinaryF1 does not swallow independent game values', 'N', '9.AQ974.AJ96.K63', 'S:1C W:P N:1H E:1S S:P W:P', '2S'],
    ['858 inquiry gives opener an honest stopped NT rebid', 'S', 'AT7.KJ2.K43.QJT7', 'S:1C W:P N:1H E:1S S:P W:P N:2S E:P', '2NT'],
    ['858 responder completes its public game after the inquiry answer', 'N', '9.AQ974.AJ96.K63', 'S:1C W:P N:1H E:1S S:P W:P N:2S E:P S:2NT W:P', '3NT'],
    ['910 stopped enemy suit supplies game route', 'E', 'AKT.KQJ43.942.97', 'S:P W:1D N:P E:1H S:1S W:P N:P', '3NT'],
    ['928 stopped enemy suit supplies game route', 'W', 'KT62.QJ85.Q.KQ98', 'N:P E:1D S:P W:1H N:1S E:P S:P', '3NT'],
    ['951 lead double leaves transfer continuation seven-fit invitation', 'S', 'A75.QT976.5.QJT9', 'W:P N:1NT E:P S:2D W:X N:2H E:P', '2NT'],
    ['976 three-card original minor cannot jump-shift; unblocked spades remain honest', 'W', 'AKJ8.AT9.532.AK7', 'N:P E:P S:P W:1C N:1D E:1H S:P', '1S'],
    ['nineteen balanced with a diamond stop can show natural2NT', 'W', 'AK98.AT9.Q32.AQ7', 'N:P E:P S:P W:1C N:1D E:1H S:P', '2NT'],
    ['1144 opener jump support promises invitation strength', 'W', 'JT75.543.AJT.AJ2', 'N:P E:1D S:P W:1S N:P E:3S S:P', '4S'],
    ['1161 repeated four-card side clubs cannot manufacture fit', 'N', 'K952.3.AKQ64.Q76', 'E:P S:1H W:P N:1S E:P S:2C W:P N:2D E:P S:3C W:P', '3NT'],
    ['1199 strong original-major jump is an invitation', 'S', 'K543.Q87.K86.K84', 'W:P N:1H E:P S:1S W:P N:3H E:P', '4H'],
    ['7687 natural2NT rebid publicly supplies18minimum', 'E', 'T2.J873.Q874.A87', 'W:1S N:P E:1NT S:P W:2NT N:P', '3NT'],
    ['7712 fit game is reached before minimum stop handler', 'S', 'A642.Q72.KQ.K765', 'N:P E:P S:1C W:P N:1H E:P S:1S W:P N:3S E:P', '4S'],
    ['7744 known four-four spades invite in the fit', 'S', 'K985.Q853.JT.A86', 'N:1C E:P S:1H W:P N:1S E:P', '3S'],
    ['7772 distribution supplies acceptance strength', 'N', 'QJ742.5.QJ86.874', 'N:P E:P S:1H W:P N:1S E:P S:3S W:P', '4S'],
    ['7776 semiNT invitation is accepted from actualopener strength', 'N', 'AK93.AKQT6.95.98', 'N:1H E:P S:1NT W:P N:2H E:P S:2NT W:P', '3NT'],
    ['7784 original minor opener has established spade game', 'W', 'AQ76.Q2.AKJ763.Q', 'N:P E:P S:P W:1D N:P E:1H S:P W:1S N:P E:2S S:P', '4S'],
    ['weaktwo minimum answer does not promise game', 'S', 'K6.AQ73.K52.AJ93', 'E:P N:2S W:P S:2NT E:P N:3S W:P', 'P'],
    ['weaktwo feature with public9 supports actual game', 'S', 'K6.AQ73.K52.AJ93', 'E:P N:2S W:P S:2NT E:P N:3C W:P', '4S'],
    ['1D2C GF reaches NT game without pretending seven diamonds is a fit', 'S', 'KQ97.AK8.84.Q876', 'N:1D E:P S:2C W:P N:2D E:P', '3NT'],
    ['GF originalmajor repeat still promises only five, so two-card support selectsNT', 'S', 'KQ97.84.AK8.Q876', 'N:1H E:P S:2C W:P N:2H E:P', '3NT'],
    ['minor invitation at28 adjusted points remains below this card game threshold', 'N', 'A8.AQ5.AQT632.42', 'N:1D E:P S:1S W:P N:2D E:P S:3D W:P', 'P'],
    ['minor invitation at29 adjusted points accepts game', 'N', 'A8.AK5.AQT632.42', 'N:1D E:P S:1S W:P N:2D E:P S:3D W:P', '5D'],
  ] as const)('%s', (_, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat, holding, prefix), 'sayc')).toEqual(parse(expected));
  });
  it('public secondary repeat remains four cards, so three-card support is seven-fit', () => {
    const obs = position('N', 'K952.3.AKQ64.Q76', 'E:P S:1H W:P N:1S E:P S:2C W:P N:2D E:P S:3C W:P');
    const minimum = naturalSuitMinimum(obs.auction, 'S', 'C', 'sayc');
    expect(minimum).toBe(4);
    expect(evaluateSuitFit(obs.hand, 'C', minimum).adjustmentPoints).toBe(0);
  });
  it('waiting and Stayman diamond answer do not promise a natural diamond suit', () => {
    expect(naturalSuitMinimum(position('N', 'K952.3.AKQ64.Q76', 'S:2C W:P N:2D E:P').auction, 'N', 'D', 'sayc')).toBe(0);
    expect(naturalSuitMinimum(position('N', 'K952.3.AKQ64.Q76', 'S:1NT W:P N:2C E:P S:2D W:P').auction, 'S', 'D', 'sayc')).toBe(0);
  });
  it('1D2C GF does not upgrade the opener original minor to six cards', () => {
    const obs = position('S', 'KQ97.AK8.84.Q876', 'N:1D E:P S:2C W:P N:2D E:P');
    expect(naturalSuitMinimum(obs.auction, 'N', 'D', 'sayc')).toBe(5);
    expect(evaluateSuitFit(obs.hand, 'D', 5).knownCombinedTrumps).toBe(7);
    expect(evaluateSuitFit(obs.hand, 'D', 5).adjustmentPoints).toBe(0);
  });
});

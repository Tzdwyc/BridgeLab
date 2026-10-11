import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
const parse = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' } : { kind: 'bid', level: +text[0], strain: text.slice(1) as Strain };
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
// GPT-selected expectations use only the acting hand and public prefix.
describe('v0.3.3 RKCB stop and strong-opening lead-double routing', () => {
  it.each([
    ['7777 no trump queen, reply is already five hearts', 'S', 'AQ2.J9732.Q.AKT9', 'E:P S:1H W:P N:2NT E:P S:4NT W:P N:5H E:P', 'P'],
    ['holding queen can choose six hearts with four keys', 'S', 'AQ2.Q9732.J.AKT9', 'E:P S:1H W:P N:2NT E:P S:4NT W:P N:5H E:P', '6H'],
    ['missing two keys, five spades response is itself the safe contract', 'N', 'KJ876.Q32.KQ3.K9', 'N:1S E:P S:3S W:P N:4NT E:P S:5S W:P', 'P'],
    ['club keycard reply can coincide with the safe five clubs contract', 'N', 'KQ2.KJ4.A73.AQ86', 'N:1C E:P S:3C W:P N:4NT E:P S:5C W:P', 'P'],
    ['diamond keycard reply can coincide with the safe five diamonds contract', 'N', 'KQ2.KJ4.AQ86.A73', 'N:1D E:P S:3D W:P N:4NT E:P S:5D W:P', 'P'],
    ['four known keys and no queen cannot force six diamonds when the answer is already five diamonds', 'N', 'A2.A2.KJT874.A32', 'N:1D E:P S:3D W:P N:4NT E:P S:5D W:P', 'P'],
    ['4579 public NT strength rules out zero keys using only remaining honor points', 'E', 'KQ952.AKQ32.92.4', 'W:1NT N:P E:2H S:P W:2S N:P E:3NT S:P W:4S N:P E:4NT S:P W:5D N:P', '6S'],
    ['a lower point asker cannot resolve zero-or-three from the same NT opening', 'E', 'KQ952.AJ732.92.4', 'W:1NT N:P E:2H S:P W:2S N:P E:3NT S:P W:4S N:P E:4NT S:P W:5D N:P', '5S'],
    ['keycard deduction uses partner NT strength rather than the asker own earlier invitation', 'E', 'KQ952.AKQ32.92.4', 'W:1NT N:P E:2H S:P W:2S N:P E:2NT S:P W:4S N:P E:4NT S:P W:5D N:P', '6S'],
    ['1008 lead double does not turn artificial clubs into support', 'E', 'J42.J8543.62.K76', 'N:P E:P S:P W:2C N:X', '2D'],
    ['waiting after lead double retains a natural NT rebid', 'W', 'AK7.AK72.AQT8.A8', 'N:P E:P S:P W:2C N:X E:2D S:P', '2NT'],
  ] as const)('%s', (_, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat, holding, prefix), 'sayc')).toEqual(parse(expected));
  });
});

import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { publicSupportMinimum } from '../src/ai/suit-evaluation';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';

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

describe('release7 original-board core priority and public-point repairs', () => {
  it.each([
    ['586 first four-major NT response searches before raw game', 'W', 'AJT4.AQ2.T72.J73', 'S:P W:P N:P E:1NT S:P', '2C'],
    ['579 weak seven diamonds use the declared minor relay', 'E', 'A.64.QJT9875.T86', 'W:1NT N:P', '2S'],
    ['904 first response to strong NT transfers five hearts', 'N', 'QJ3.Q7654.Q8.T72', 'N:P E:P S:2C W:P N:2D E:P S:2NT W:P', '3D'],
    ['817 two four-card majors search over two NT', 'N', 'JT64.AT93.J83.92', 'E:P S:2NT W:P', '3C'],
    ['647 known three-card spade support retains a real two-over-one', 'E', 'KJ7.AT5.KJ862.A8', 'W:1S N:P', '2D'],
    ['814 triple spade support and a real club GF describe before NT', 'E', 'QJ2.Q872.AK.J732', 'S:P W:1S N:P', '2C'],
    ['4200 four-spade GF support uses Jacoby rather than raw NT', 'S', 'QT94.AJ6.K3.AQT5', 'N:1S E:P', '2NT'],
    ['4221 very low raw HCP still reaches publicly known heart game', 'E', 'J76.JT9852.-.6542', 'E:P S:P W:1H N:1S', '4H'],
    ['807 Rule20 constrains the minor opener support floor', 'E', '762.J9.AKQT85.Q6', 'W:1D N:P', '5D'],
    ['1030 initial four-spade support does not wait below known game', 'S', 'AT84.AJ865.82.65', 'S:P W:P N:1S E:3C', '4S'],
    ['1022 forced status is not a reason to lose known spade game', 'E', 'Q762.J2.5.AKQT65', 'S:P W:P N:1D E:2C S:P W:2S N:P', '4S'],
    ['947 responder cannot borrow the opener seventeen points', 'N', 'K852.J7543.984.J', 'W:P N:P E:P S:1C W:P N:P E:1D S:1H W:2C', '2H'],
    ['947 opener owns its extras after truthful weak heart support', 'S', 'A63.QT98.Q.AKQT4', 'W:P N:P E:P S:1C W:P N:P E:1D S:1H W:2C N:2H E:3D', '4H'],
    ['7756 raw game chooses NT without borrowing the hidden fourth heart', 'S', '94.AJ72.A9.AJ962', 'N:1C E:P S:1H W:P N:1S E:P S:2D W:P N:2H E:P', '3NT'],
    ['7588 support cue is answered in publicly known spade game', 'E', 'AKJT98.764.KQT.2', 'N:2H E:2S S:P W:3H N:P', '4S'],
    ['7312 a five-spade return does not silently promise six', 'S', 'KT942.T.AQ83.KJ8', 'N:P E:P S:1S W:P N:2H E:P', '2S'],
    ['592 a prior voluntary correction stops the weak two-suit loop', 'S', 'J86.QJ6543.AT7.5', 'N:1C E:P S:1H W:P N:2C E:P S:2H W:P N:3C E:P', 'P'],
    ['638 fresh enemy pressure does not justify a subsequent silent weak loop', 'E', 'AQJ9.Q98765.762.-', 'S:P W:1C N:X E:1H S:P W:2C N:2D E:2H S:P W:3C N:P', 'P'],
    ['659 six diamonds already described cannot alternate against six spades', 'E', '8.K76.JT9743.KQ4', 'W:1S N:P E:1NT S:P W:2S N:P E:3D S:P W:3S N:P', 'P'],
    ['782 a void in the penalty-doubled escape uses a real unbid four clubs', 'S', '-.J63.T86543.J975', 'S:P W:1D N:X E:XX S:P W:P N:1S E:X', '2C'],
    ['570 missing club control starts a truthful below-game diamond control try', 'N', 'A6543.-.AKQJ96.J5', 'S:1H W:P N:1S E:P S:3S W:P', '4D'],
    ['570 public diamond control completes the receivers controls for keycards', 'S', 'QJT9.AQJ632.7.K3', 'S:1H W:P N:1S E:P S:3S W:P N:4D E:P', '4NT'],
    ['610 six hearts retain a truthful support floor before the club control try', 'N', 'AK9.AKQ853.73.KJ', 'S:P W:P N:1H E:P S:3H W:P', '4C'],
    ['721 missing club control probes a real diamond control below heart game', 'W', 'AK8.QT7532.K7.87', 'E:1H S:P W:2NT N:P E:3S S:P', '4D'],
    ['721 disclosed diamond control combines with own controls before asking', 'E', '5.KJ864.J4.AKQT4', 'E:1H S:P W:2NT N:P E:3S S:P W:4D N:P', '4NT'],
    ['7344 opener seventeen and a sound five hearts competes affordably', 'N', 'KJT.AKT76.4.AQ75', 'N:1H E:X S:P W:2D', '2H'],
    ['7408 triple spades are an honest seven-card preference without shortness inflation', 'E', 'K85.AJ53.A.98765', 'N:P E:1C S:1D W:1S N:2D', '2S'],
    ['7393 unbalanced opener describes the original five diamonds over minimum NT', 'N', 'KT74.A84.AQT75.A', 'E:P S:P W:P N:1D E:P S:1H W:P N:1S E:P S:1NT W:P', '2D'],
    ['7481 a four-card third suit is honest over minimum NT', 'E', 'AQ73.J.KJ72.AJ43', 'E:1D S:P W:1H N:P E:1S S:P W:1NT N:P', '2C'],
    // SK3+DJ1 is four raw, outside the approved0–3negativePass. Real five
    // diamonds can use the defined4+positive/GF source without penaltyX.
    ['7535 four-point five-diamond positive avoids invented penalty defense', 'S', 'K73.86.J9832.743', 'N:2C E:2H', '3D'],
    ['club keycards need a legal stop when public partner zero is still possible', 'S', 'A2.A2.K.KQJT9876', 'N:1C E:P', '5C'],
    ['743 strong NT hears the real seven-diamond second suit before a private fit ask', 'E', '-.AKT72.QJT8643.Q', 'W:1C N:P E:1H S:P W:2NT N:P', '3D'],
    ['551 twenty-one and six spades do not hide in a minimum competitive repeat', 'W', 'AKJ764.AK8.A.Q83', 'W:1S N:P E:P S:2D', '4S'],
    ['552 strong six-card minor source and outside entry reach raw NT game', 'N', 'AK9.AK6.KQJ653.7', 'N:1D E:P S:1H W:P', '3NT'],
    ['strong preempt responder reaches known minor game before unsupported own-major game', 'S', 'AQ.KQJ543.K5.AT2', 'N:3D E:P S:3H W:P N:4D E:P', '5D'],
    ['seventeen with a real affordable second major does not hide behind a five-card return', 'S', 'AKJ95.AKQ8.4.987', 'N:P E:P S:1S W:P N:2D E:P', '2H'],
  ] as const)('%s', (_, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat, holding, prefix), 'sayc')).toEqual(call(expected));
  });
  it('Rule20 raises only the conditional support floor, not the raw NT promise', () => {
    const obs = position('E', '762.J9.AKQT85.Q6', 'W:1D N:P');
    const publicPartner = publicPlayerConstraints(obs.auction, 'W', 'sayc');
    expect(publicPartner.hcpRange?.min).toBe(12);
    expect(publicPartner.ruleOf20Opening).toBe(true);
    expect(publicSupportMinimum('D', 6, publicPartner)).toBe(14);
  });
});

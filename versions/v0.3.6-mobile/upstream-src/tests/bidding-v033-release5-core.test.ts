import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { publicSupportMinimum } from '../src/ai/suit-evaluation';
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

describe('release5 personally audited core mechanisms', () => {
  it('public five-four shape guarantees two shortness points with three-card support', () => {
    expect(publicSupportMinimum('H', 3, { hcpRange: { min: 12, max: 18 }, supportRanges: {},
      suitMinimums: { C: 4, D: 0, H: 5, S: 0 } })).toBe(14);
  });
  it('published support is not added a second time and seven trumps earn no shape allowance', () => {
    const constraints = { hcpRange: { min: 10, max: 12 }, supportRanges: { H: { min: 15, max: 18 } },
      suitMinimums: { C: 4, D: 0, H: 4, S: 0 } };
    expect(publicSupportMinimum('H', 4, constraints)).toBe(15);
    expect(publicSupportMinimum('H', 3, { ...constraints, supportRanges: {} })).toBe(10);
  });
  it.each([
    ['931 known five-four shape establishes heart game', 'E', 'A9832.K96.K6.J42', 'W:1H N:P E:1S S:P W:2C N:P', '4H'],
    ['7301 negative-double fit and seventeen cannot hide behind minimum three spades', 'E', 'AKT4.6.AKQJ72.75', 'E:1D S:1H W:X N:3H', '4S'],
    ['896 three-card transfer fit includes partner unavoidable shortness', 'N', 'KQJ.AQ654.32.K83', 'N:1NT E:P S:2H W:P N:2S E:P S:2NT W:P', '4S'],
    ['4231 seven HCP and two doubletons remain below ten-support invitation', 'S', '96.AK6543.54.972', 'W:P N:1NT E:P S:2D W:P N:2H E:P', 'P'],
    ['1118 good six diamonds still respond over two-level interference', 'N', 'J2.J94.KQ7432.K8', 'S:1C W:2S', '3D'],
    ['907 good six clubs respond over spade interference', 'E', 'Q863.3.K2.KQJ854', 'W:1H N:2S', '3C'],
    ['1156 negative doubler retains independent known no-trump game', 'W', 'K8.KQT8.A8.K8763', 'N:P E:1C S:2S W:X N:P E:2NT S:P', '3NT'],
    ['1120 natural eleven-point invitation plus fourteen is game', 'N', 'KJ764.AJ3.A8.J32', 'N:1S E:2C S:2D W:P N:2S E:P S:2NT W:P', '3NT'],
    ['7395 converted penalty double precedes long-spade correction', 'E', 'KQT7642.3.7.KJ43', 'W:1D N:P E:1S S:2H W:X N:P', 'P'],
    ['2718 shown two minors need stoppers before defending NT in game', 'E', 'QT3.AKJ65.982.83', 'S:P W:1NT N:2NT', '3H'],
    ['4223 minimum original diamonds do not reopen a weak six-club escape', 'N', 'T97.AK3.KQ9643.K', 'W:P N:1D E:P S:1H W:P N:2D E:P S:3C W:P', 'P'],
    ['4049 weak seven hearts escape singleton partner spades', 'S', 'J.JT87632.J65.64', 'E:1D S:P W:P N:X E:P S:1H W:P N:1S E:P', '2H'],
    ['7311 ten trumps all five keys and controls allow small-slam queen risk', 'E', 'AQ84.A8.5.AKJT98', 'W:1D N:P E:1S S:P W:2C N:P E:4NT S:P W:5C N:P', '6C'],
    ['nine trumps do not use the ten-trump missing-queen exception', 'S', 'AQ84.A8.5.AKJT98', 'N:1C E:P S:4NT W:P N:5C E:P', 'P'],
    ['ten trumps with two missing keys still sign off', 'E', 'KQ84.K8.5.AKJT98', 'W:1D N:P E:1S S:P W:2C N:P E:4NT S:P W:5C N:P', 'P'],
    ['held trump queen is not asked again when diamond control remains unproved', 'N', 'AKQ2.AKJ.QJ9.KJ9', 'N:1S E:P S:2NT W:P N:4NT E:P S:5C W:P', '5S'],
    ['natural quantitative five NT commits minimum to six NT', 'N', 'KQ98.A75.Q32.KJ7', 'N:1NT E:P S:5NT W:P', '6NT'],
    ['natural quantitative five NT accepts grand at maximum and implied public thirty-seven', 'N', 'AK98.A75.Q32.KJ7', 'N:1NT E:P S:5NT W:P', '7NT'],
    ['balanced twenty invites grand while committing the small slam opposite fifteen-seventeen', 'S', 'AK3.AK4.KQJ3.987', 'N:1NT E:P', '5NT'],
    ['balanced nineteen cannot invite a grand that public maximum cannot reach', 'S', 'AK3.AK4.KQT3.987', 'N:1NT E:P', '6NT'],
    ['7741 competitive Michaels minor fit still answers outstanding RKCB', 'S', 'K976.5.KJ74.A752', 'E:P S:P W:1S N:2S E:P S:2NT W:P N:3C E:3S S:4C W:P N:4NT E:P', '5C'],
    ['Stayman four hearts after spade answer invites in NT', 'S', 'J54.JT87.AJ.JT85', 'N:1NT E:P S:2C W:P N:2S E:P', '2NT'],
    ['Stayman five hearts four spades and ten points may place the confirmed spade game', 'S', 'QJ54.KT875.AJ.85', 'N:1NT E:P S:2C W:P N:2S E:P', '4S'],
    ['sixteen scattered honors without cash source decline eight-point NT invitation', 'N', 'KQJ.AQ65.K32.J87', 'N:1NT E:P S:2NT W:P', 'P'],
    ['sixteen with AKQT five-card source and outside ace accept NT invitation', 'N', 'A43.K62.73.AKQT5', 'N:1NT E:P S:2NT W:P', '3NT'],
    ['first-seat weak two does not conceal another four-card major', 'N', 'KJ92.AQT876.7.42', '', 'P'],
    ['third-seat weak two may contain another four-card major', 'N', 'KJ92.QJT876.7.42', 'S:P W:P', '2H'],
    ['third-seat weak two does not conceal another five-card major', 'N', 'KJ932.QJT876.7.4', 'S:P W:P', 'P'],
    ['fourth seat does not weak-preempt', 'W', 'KJ9.QJT876.7.432', 'N:P E:P S:P', 'P'],
    ['7505 balanced opener still shows available four spades', 'E', 'AK73.72.JT2.KJ86', 'E:1C S:P W:1H N:P', '1S'],
    ['3690 first four-card major response precedes public twenty-six NT game shortcut', 'S', 'AKT4.QJ5.KT8.J98', 'N:1C E:1D', '1S'],
    ['3439 first strong opener rebid describes real reverse before minimum long-suit correction', 'N', 'T.AK85.AKQJ76.54', 'S:P W:P N:1D E:P S:1S W:P', '2H'],
    ['major game takes priority over simultaneous eight-club minor game after strong NT Stayman', 'E', '9.7653.85.QJ8743', 'N:P E:P S:P W:2C N:P E:2D S:P W:2NT N:P E:3C S:P W:3H N:P', '4H'],
    ['7520 singleton adjusts nine raw points to club invitation', 'E', 'T64.A.KJ76.JT543', 'N:P E:P S:P W:1C N:1H', '3C'],
    ['7549 original diamond minimum does not become five just by showing clubs', 'N', '98732.J82.AT4.A9', 'E:P S:1D W:1H N:1S E:P S:2C W:P', '2D'],
    // A lowest original-major return after a passed-hand natural new suit
    // retains five cards. Two-card support is seven, without shortness points.
    ['7567 two spades opposite the public five retain the real six clubs', 'N', 'AJ.863.T9.AJ9864', 'W:P N:P E:P S:1S W:P N:2C E:P S:2S W:P', '3C'],
    ['7577 quiet seven-point support cannot make invitation', 'E', '876.J643.A963.Q4', 'E:P S:P W:1C N:1S E:X S:P W:2H N:P', 'P'],
    ['7589 seven public hearts do not turn eleven raw into major game', 'E', 'AK6.J9.QT95.JT97', 'E:P S:P W:1H N:P E:2D S:P W:2H N:P', '2NT'],
    ['7598 Jacoby public heart shortness enters spade support floor', 'N', 'AT62.KT975.AKT.8', 'S:1S W:P N:2NT E:P S:3H W:P', '4NT'],
    ['public club shortness supplies a second-round control for RKCB entry', 'S', 'AQJ98.K42.AK2.J7', 'N:1S E:P S:2NT W:P N:3C E:P', '4NT'],
    ['unshown club control cannot be borrowed from hidden partner holding', 'S', 'AQJ98.K42.AK2.J7', 'N:1S E:P S:2NT W:P N:4S E:P', 'P'],
    ['7666 singleton plus secondary four-card spade fit is opener support invitation', 'S', 'AJT9.3.Q83.AK754', 'S:1C W:P N:1H E:P S:1S W:P N:2S E:P', '3S'],
    ['7669 nine raw plus doubleton in known eight hearts invites', 'E', 'K9852.A54.Q3.T52', 'E:P S:P W:1H N:P E:1S S:P W:2D N:P', '3H'],
    ['7690 public five-four shape and ten diamonds reach minor game', 'N', 'J93.32.AKJT74.96', 'S:1H W:P N:1NT E:P S:2D W:P', '5D'],
    ['7769 known five clubs four diamonds promise unavoidable shortness for diamond game', 'W', 'A2.KT9853.KJ63.8', 'E:1C S:P W:1H N:P E:2C S:P W:2D N:P E:3D S:P', '5D'],
    ['7771 real eight clubs take precedence over four diamonds in GF response', 'E', '-.K.KJ72.AKJT9853', 'W:1S N:P', '2C'],
    ['7792 positive responder support uses weak-two unavoidable shape floor', 'S', 'AKT7.A73.AT952.5', 'N:2H E:P S:3D W:P N:3H E:P', '4H'],
    ['7810 public negative-double two-suit shape retains independent diamond game over competition', 'W', 'A.Q5.KT98.KQJ985', 'S:P W:1C N:2S E:X S:P W:3C N:P E:3D S:3S', '5D'],
    ['4194 three-card original clubs cannot justify jumping available four spades', 'E', 'AJ63.AKJ9.Q7.K63', 'S:P W:P N:P E:1C S:1D W:P N:P', '1S'],
    ['4110 cheapest competitive club raise is not a ten-point invitation', 'N', 'A97.AQJ8.J4.AQT9', 'S:P W:P N:1C E:2D S:3C W:P', 'P'],
    ['872 strong original major is not passed over four clubs', 'N', 'AQJT86.AK965.AT.-', 'N:1S E:3C S:P W:4C', '4S'],
  ])('%s', (_name, seat, hand, prefix, expected) => {
    expect(chooseBid(observe(seat as Seat, hand, prefix), 'sayc')).toEqual(call(expected));
  });
});

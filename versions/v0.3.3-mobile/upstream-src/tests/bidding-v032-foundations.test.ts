import { describe, expect, it } from 'vitest';
import { chooseBid } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const suits: Suit[] = ['S', 'H', 'D', 'C'];
function call(token: string): Call {
  return token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : bid(Number(token[0]), token.slice(1) as Strain);
}
function position(seat: Seat, handText: string, publicText: string): BiddingObservation {
  const hand: Card[] = handText.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { id: `${suits[index]}${rank}`, suit: suits[index], rank };
  }));
  expect(hand).toHaveLength(13);
  const auction: AuctionEntry[] = publicText.split(' ').filter(Boolean).map(token => {
    const [seatText, callText] = token.split(':'); return { seat: seatText as Seat, call: call(callText) };
  });
  return { phase: 'auction', board: 1, seat, actingSeat: seat, vulnerability: 'None', auction, hand, legalCalls: legalCalls(auction, seat) };
}

// Every expected call below was chosen from the acting hand and public prefix
// by the current chat GPT reviewer. No other hand or generated deal is loaded.
describe('v0.3.2 reviewed public-context foundations', () => {
  it.each([
    ['2600/9 forced 2NT gives no guaranteed eighteen-point floor', 'N', 'K5.AJ964.952.J54', 'N:P E:P S:1S W:2C N:X E:P S:2NT W:P', 'P'],
    ['2623/3 thirteen-plus real six-card clubs cannot disappear over a weak jump', 'E', 'A9.KJ8.74.AKQ852', 'W:1D N:2S', '3C'],
    ['3993/8 strong opener jumps in the actual four-card second suit', 'N', 'QJ94.Q.KQ.AKQ976', 'E:P S:P W:P N:1C E:P S:1H W:P', '2S'],
    ['3993/10 balanced passed hand chooses NT rather than guessing spade support', 'S', 'T32.KJ42.A742.JT', 'E:P S:P W:P N:1C E:P S:1H W:P N:1S E:P', '1NT'],
    ['2600 fresh strong jump six spades plus two-card support place game', 'N', 'K5.AJ964.952.J54', 'N:P E:P S:1S W:2C N:X E:P S:3S W:P', '4S'],
    ['forced three spades over three hearts does not promise sixteen', 'N', 'K5.AJ964.952.J54', 'N:P E:P S:1S W:3H N:X E:P S:3S W:P', 'P'],
    ['2631 eleven-point six hearts remain an invitation', 'E', 'KJ9.QJT976.98.AT', 'W:1C N:P E:1H S:P W:2C N:P', '3H'],
    ['2631 twelve-point six hearts remain an invitation', 'E', 'KJ9.KJT976.98.AT', 'W:1C N:P E:1H S:P W:2C N:P', '3H'],
    ['3867 fifteen-point balancing hand cannot misuse eleven-fourteen NT', 'S', 'T986.42.AQJ.AKJ9', 'W:1C N:P E:P', 'P'],
    ['balancing fourteen balanced with a club stop can use 1NT', 'S', 'K98.AJ4.Q72.AT85', 'W:1C N:P E:P', '1NT'],
    ['2687 strong actual second suit survives enemy free intervention', 'W', 'AKQ3.A943.-.AQT73', 'W:1C N:P E:1D S:1H', '2S'],
    ['3916 strong opener describes four hearts after opposing takeout and spade answer', 'E', '-.AQT6.AKQJ98.K84', 'E:1D S:X W:P N:1S', '2H'],
    ['seventeen-point reverse retains four hearts after opposing takeout', 'E', '-.AJT6.AKQ984.K84', 'E:1D S:X W:P N:1S', '2H'],
    ['2694 negative-double hand knows game after natural minor repeat', 'E', 'AKQ3.Q32.K98.954', 'W:1D N:2H E:X S:P W:3D N:P', '3NT'],
    ['2720 invitation retains the four-card fit shown by negative double', 'W', 'AKQ8.T74.A8.AJ96', 'W:1C N:1H E:X S:P W:1S N:P E:3S S:P', '4S'],
    ['7010 waiting diamonds cannot manufacture a phantom game fit', 'S', 'AKJ542.AQ.AT75.A', 'S:2C W:P N:2D E:P S:2S W:P N:4C E:P', '4S'],
    ['3832 natural NT game ends the weak opener initial-response feature route', 'E', '-.T82.AQT984.KJ62', 'N:P E:2D S:P W:2S N:P E:3D S:P W:3NT N:P', 'P'],
    ['374/5 support points survive raw four HCP', 'S', 'T432.T764.A754.7', 'S:P W:P N:1H E:X', '2H'],
    ['494/5 five hearts and two short suits support', 'S', '9652.JT952.A9.92', 'S:P W:P N:1H E:2D', '2H'],
    ['507/6 constructive three-card overcall support', 'N', 'A74.J864.8543.T7', 'W:P N:P E:1C S:1S W:P', '2S'],
    ['518/7 twenty-one and seven hearts show game', 'N', 'KQ9.AKJT932.A9.A', 'S:P W:P N:1H E:P S:1NT W:P', '4H'],
    ['426/5 strong jump shift instead of minimum six hearts', 'S', 'KQ.AKQ975.Q.AJ73', 'S:1H W:P N:1S E:P', '3C'],
    ['355/8 ten HCP and the public four-card spade fit invite', 'S', 'K764.QT853.J3.A8', 'W:P N:1C E:1D S:X W:P N:1S E:P', '3S'],
    ['436/8 thirteen-plus unbalanced responder describes six diamonds', 'W', 'J.AK54.AQ9863.T8', 'N:P E:1C S:P W:1H N:P E:2C S:P', '2D'],
    ['480/7 nineteen unbalanced points cannot conceal extras in 1NT', 'S', 'AQ97.AK2.AQT62.6', 'N:P E:P S:1D W:P N:1NT E:P', '2S'],
    ['491/7 reverse plus twelve points describes four spades', 'E', 'KQ54.QJT94.J62.K', 'W:1C N:P E:1H S:P W:2D N:P', '2S'],
    ['2628/6 strong opener jump shifts with nineteen', 'E', 'AKQT5.A862.-.AQT9', 'N:P E:1S S:P W:1NT N:P', '3H'],
    ['2631/7 six-card hearts and game values continue', 'E', 'KJ9.AJT976.98.AT', 'W:1C N:P E:1H S:P W:2C N:P', '4H'],
    ['2641/8 six spades and a void place game opposite public two-card balanced support', 'N', 'AK8763.A73.-.7652', 'E:P S:1D W:P N:1S E:P S:1NT W:P', '4S'],
    ['2641 manual invitation is accepted by maximum balanced opener with two spades', 'S', 'Q9.KJ6.QT92.AQJ4', 'E:P S:1D W:P N:1S E:P S:1NT W:P N:3S E:P', '4S'],
    ['2631 manual heart invitation accepted with genuine six-two fit and support points', 'W', '8.KQ.AJ72.QJ8653', 'W:1C N:P E:1H S:P W:2C N:P E:3H S:P', '4H'],
    // GPT v0.3.3 re-review: invitation is real, but the public total still falls below minor-game 29.
    ['2668 minor invitation is declined below the revised public game threshold', 'N', 'A8.AT5.AQT632.42', 'N:1D E:P S:1S W:P N:2D E:P S:3D W:P', 'P'],
    ['2680 minimum club raise after enemy heart advance does not invent ten invitation points', 'E', '54.QJ.A532.AKJ92', 'N:P E:1C S:1H W:X N:P E:2C S:P W:P N:2H E:P S:P W:3C N:3H', 'P'],
    ['thirteen-point minor opener declines invitation below twenty-eight support points', 'N', 'A8.AT5.KQT632.42', 'N:1D E:P S:1S W:P N:2D E:P S:3D W:P', 'P'],
    ['2687 strong jump force survives subsequent enemy natural heart bid', 'W', 'AKQ3.A943.-.AQT73', 'W:1C N:P E:1D S:1H W:2S N:3H E:P S:P', '3NT'],
    ['2687 responder has real eight-club fit with strong-jump original minor minimum four', 'E', '87.2.KT7432.K984', 'W:1C N:P E:1D S:1H W:2S N:3H', '5C'],
    ['forced lowest two spades over enemy two hearts does not manufacture a nineteen-point game force', 'W', 'AKJ3.K943.-.AQT73', 'W:1C N:P E:1D S:2H W:2S N:3H E:P S:P', 'P'],
    ['2695 minimum balanced opener escapes a passed-hand natural club response with poor fit', 'E', 'KJ97.AQ62.JT6.JT', 'W:P N:P E:1D S:P W:2C N:P', '2NT'],
    ['passed-hand natural club response opposite strong balanced opener reaches NT game', 'E', 'KJ97.AQ62.KT6.AJ', 'W:P N:P E:1D S:P W:2C N:P', '3NT'],
    ['2686/8 confirmed eight hearts and support points place game', 'E', '5.KJ96.A73.QJT54', 'S:P W:1S N:P E:1NT S:P W:2H N:P', '4H'],
    ['2688/6 negative double plus eighteen six-card hearts shows extras', 'E', 'Q4.AQ9632.KQ.AJ4', 'N:P E:1H S:1S W:X N:P', '3H'],
    ['2632/8 low-card support cannot supply phantom HCP for NT', 'W', 'AQT9.AQ.KQJ3.943', 'N:P E:P S:P W:1D N:P E:2D S:P', '3D'],
    ['minimum six-heart rebid opposite weak two hearts may stop', 'S', 'A73.Q8.T852.T843', 'S:P W:P N:1H E:P S:1NT W:P N:2H E:P', 'P'],
    ['minimum second suit with a weak two-heart false preference', 'S', 'A743.Q8.T852.T83', 'N:1H E:P S:1NT W:P N:2C E:P', '2H'],
    ['seven-card heart preference does not imply game', 'N', 'KQ9.AKJ93.A9.A64', 'N:1H E:P S:1NT W:P N:2C E:P S:2H W:P', '2NT'],
  ])('%s', (_name, seat, hand, prefix, expected) => {
    const obs = position(seat as Seat, hand, prefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call(expected));
  });

  it.each([
    ['2727/6', 'N', 'Q2.K82.AKJ65.QJ3', 'W:P N:1NT E:P S:2H W:P', '2S'],
    ['2737/5', 'E', 'AK.JT64.A96.KJ94', 'E:1NT S:P W:2C N:P', '2H'],
    ['2748/6', 'E', 'AK9.A96.Q432.KT6', 'N:P E:1NT S:P W:2D N:P', '2H'],
    ['spade transfer doubled', 'N', 'Q2.K82.AKJ65.QJ3', 'N:1NT E:P S:2H W:X', '2S'],
    ['heart transfer doubled', 'E', 'AK9.A96.Q432.KT6', 'E:1NT S:P W:2D N:X', '2H'],
    ['Stayman doubled with hearts', 'E', 'AK.JT64.A96.KJ94', 'E:1NT S:P W:2C N:X', '2H'],
    ['Stayman doubled denying a major', 'N', 'Q2.K82.AKJ65.QJ3', 'N:1NT E:P S:2C W:X', '2D'],
    ['2NT heart transfer doubled', 'N', 'AKQ.A96.A432.KT6', 'N:2NT E:P S:3D W:X', '3H'],
    ['2NT spade transfer doubled', 'N', 'AKQ.A96.A432.KT6', 'N:2NT E:P S:3H W:X', '3S'],
    ['2NT Stayman doubled denial', 'N', 'AKQ.A96.A432.KT6', 'N:2NT E:P S:3C W:X', '3D'],
    ['strong 2C natural NT platform transfer doubled', 'N', 'AKQ.AK6.A432.KT6', 'N:2C E:P S:2D W:P N:2NT E:P S:3H W:X', '3S'],
  ])('answers artificial NT request before strength shortcuts: %s', (_name, seat, hand, prefix, expected) => {
    expect(chooseBid(position(seat as Seat, hand, prefix), 'sayc')).toEqual(call(expected));
  });
  it.each([
    ['7010 seven clubs cannot masquerade as a second negative', 'N', '98.K5.84.KQJ9642', 'S:2C W:P N:2D E:P S:2S W:P', '4C'],
    ['four-point five clubs are positive after strong natural spades', 'S', '98.854.J72.QJ964', 'N:2C E:P S:2D W:P N:2S E:P', '4C'],
    ['natural diamonds avoid the reserved second negative over 3C', 'S', '98.K5.KJ9842.742', 'N:2C E:P S:2D W:P N:3C E:P', '4D'],
    ['3832 five unsupported spades do not justify a spade game', 'W', 'AKJ83.AQJ7.K.AQ5', 'N:P E:2D S:P W:2S N:P E:3D S:P', '3NT'],
    ['3887 strong minor and full side stops show game rather than minimum', 'W', 'A.KT7.AK8643.AQJ', 'W:1D N:P E:1H S:P', '3NT'],
    ['2635 strong doubler shows five spades and three-card support accepts', 'W', '964.A5.J7653.K65', 'W:P N:2H E:X S:P W:3D N:P E:3S S:P', '4S'],
  ])('describes real strength and suits: %s', (_name, seat, hand, prefix, expected) => {
    expect(chooseBid(position(seat as Seat, hand, prefix), 'sayc')).toEqual(call(expected));
  });
  it('a weak six-card spade suit is described before a two-heart preference', () => {
    const obs = position('S', 'KJT743.86.974.Q8', 'N:1H E:P S:1NT W:P N:2C E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'S'));
  });
  it('keeps an established eight-card club fit above a five-two heart preference', () => {
    const obs = position('S', 'A73.Q8.T85.T8432', 'N:1H E:P S:1NT W:P N:2C E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('invites with two hearts rather than pretending ten points are a weak preference', () => {
    const obs = position('S', 'AQJ7.K8.T852.T83', 'N:1H E:P S:1NT W:P N:2C E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'NT'));
  });
  it('does not jump-raise a repeated major when responder is void in it', () => {
    const obs = position('S', 'AKT7.-.QT9863.J83', 'N:1H E:P S:1NT W:P N:2H E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'D'));
  });
  it('recognizes a public six-card major fit before giving a minimum invitation', () => {
    const obs = position('N', 'JT874.43.AKJ9.Q9', 'S:1H W:P N:1S E:P S:2H W:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'H'));
  });
  it('places game after a simple major raise when the public floor already suffices', () => {
    const obs = position('S', 'KQ87.AQ4.A97.852', 'N:1C E:P S:1S W:P N:2S E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, 'S'));
  });
  it('shows an invitation after a minimum original-minor rebid with a true fit', () => {
    const obs = position('S', 'KQ873.AJ54.9.T85', 'N:1C E:P S:1S W:P N:2C E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'C'));
  });
  it('a reverse plus twelve balanced points reaches game without assuming partner actual cards', () => {
    const obs = position('S', 'KJ87.AJ4.K97.852', 'N:1C E:P S:1S W:P N:2H E:P');
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'NT'));
  });
  it.each([
    ['KQ7.AJ4.9762.J53', '2NT'],
    ['KQ7.AJ4.T762.Q53', '2NT'],
    ['KQ7.AJ4.Q762.J53', '3NT'],
    ['KQ7.AJ4.K762.J53', '3NT'],
    ['KQ7.AJ4.A762.J53', '3NT'],
    ['KQ7.AJ4.97.AJT85', '3NT'],
  ])('minor-opening balanced range: %s -> %s', (hand, expected) => {
    expect(chooseBid(position('S', hand, 'N:1D E:P'), 'sayc')).toEqual(call(expected));
  });
  it('a twelve-point Rule20 opener can decline the new 11–12 2NT invitation', () => {
    expect(chooseBid(position('N', 'KQ7.AJ4.Q9762.85', 'N:1D E:P S:2NT W:P'), 'sayc')).toEqual(PASS);
  });
  it('fourteen raw points accept the 11–12 2NT invitation', () => {
    expect(chooseBid(position('N', 'KQ7.AJ4.A9762.85', 'N:1D E:P S:2NT W:P'), 'sayc')).toEqual(bid(3, 'NT'));
  });
});

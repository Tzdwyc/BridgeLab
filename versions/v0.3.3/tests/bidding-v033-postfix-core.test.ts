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
// GPT-authored expectations from actual hands/public prefixes. No aggregate
// scoring or mechanically inferred correctness is performed by these tests.
describe('v033 manually adjudicated postfix core repairs', () => {
  it.each([
    ['554 NT interference does not create a negative double', 'E', '74.5432.AJT.KT53', 'S:P W:1NT N:2S', 'P'],
    ['556 no penalty strength against accepted spade transfer', 'W', '95.KQ5.K643.AQ65', 'N:P E:P S:1NT W:P N:2H E:P S:2S', 'P'],
    ['642 singleton heart cannot make a penalty double', 'E', 'Q986.J.A876.AK53', 'S:P W:P N:1NT E:P S:2D W:P N:2H', 'P'],
    ['920 late singleton spade does not become a takeout double', 'E', '9.A65.JT875.AKQ6', 'N:1D E:P S:1H W:P N:1S', 'P'],
    ['695 nonbalanced eleven points can show the real second major', 'S', 'Q765.AT95.8.KQ95', 'W:P N:1D E:P S:1H W:P N:2D E:P', '2S'],
    ['722 six-three diamonds with adjusted fifteen plus sixteen reaches minor game', 'E', 'AJ875.8.QT8.KJ74', 'S:P W:1D N:P E:1S S:P W:3D N:P', '5D'],
    ['770 major invitation with sixteen minimum plus nine accepts', 'E', 'J54.Q97.AQ86.653', 'S:P W:1S N:P E:2S S:P W:3S N:P', '4S'],
    ['975 strong4441 shows a genuine four-card minor', 'E', 'AK92.4.AKQ5.AQT5', 'W:P N:P E:2C S:P W:2D N:P', '3D'],
    ['1095 twenty-six points retain force by showing diamonds', 'W', 'K.AKQJ8.AQJ4.AQ5', 'W:2C N:P E:2D S:P W:2H N:P E:3C S:P', '3D'],
    ['1109 delayed three-card heart support is not an eight-fit', 'W', 'T6.AK52.KJ.AT762', 'E:1D S:P W:1H N:P E:1S S:P W:2C N:P E:2H S:P', '3NT'],
    ['4637 void in minimum original minor escapes in own six clubs', 'N', 'QT542.J5.-.AT8764', 'E:P S:1D W:P N:1S E:P S:2D W:P', '3C'],
    ['4656 six-spade adjusted values accept NT invitation in the fit', 'N', 'AKQ642.Q94.-.JT95', 'N:1S E:P S:1NT W:P N:2C E:P S:2NT W:P', '4S'],
    ['7261 eight raw points do not claim ten-point rebid invitation', 'W', 'J98.KT5432.A.T95', 'E:1C S:P W:1H N:P E:1NT S:P', '2H'],
    ['7279 nonbalanced seven accepts natural eighteen minimum NT', 'N', 'T6.T2.J92.AQT543', 'W:P N:P E:P S:1D W:P N:1NT E:P S:2NT W:P', '3NT'],
    ['7366 minimum sixteen plus ten reaches game without mispassing strong jump', 'N', 'AKT8.QT93.75.J32', 'S:1D W:P N:1H E:P S:3D W:P', '3NT'],
    ['7380 four clubs opposite minimum three is not a minor jump fit', 'S', 'A84.982.KQ9.J953', 'N:1C E:P', '1NT'],
    ['7429 strong competitive responder uses enemy cue with no stopper', 'W', 'AK987.874.T92.AQ', 'E:1C S:2H W:2S N:P E:3C S:P', '3H'],
    ['7457 no heart fit still reaches public twenty-five in NT', 'N', 'JT85.6.AJ43.A765', 'E:P S:1H W:P N:1S E:P S:3H W:P', '3NT'],
    ['7466 fifteen points use fourth-suit force before weak preference', 'N', '-.KJ653.K65.AQ984', 'S:1C W:P N:1H E:P S:1S W:P', '2D'],
    ['7601 negative-double jump support sixteen plus adjusted nine', 'W', 'K964.T9.Q532.K96', 'E:1H S:2C W:X N:P E:3S S:P', '4S'],
    ['7638 long original hearts avoid singleton club contract', 'E', 'K96.KJT9653.K4.A', 'S:P W:P N:P E:1H S:P W:1S N:P E:2H S:P W:3C N:P', '3H'],
    ['7662 prior competition does not release NT invitation acceptance', 'S', 'AJ32.AQ8.J74.AQ2', 'S:1C W:1D N:1H E:P S:1S W:P N:2NT E:P', '3NT'],
    ['7691 completed fourth-suit inquiry remains live at public game', 'E', 'AJ652.AT8.AT84.J', 'W:1D N:P E:1S S:P W:2C N:P E:2H S:X W:3C N:P', '3NT'],
    ['7708 fourteen accepts eleven-point natural NT invitation', 'N', 'AT64.AK9.842.KT7', 'N:1C E:P S:1H W:P N:1S E:P S:2NT W:P', '3NT'],
    ['7717 long heart suit plus natural NT minimum reaches fit game', 'N', 'KJ3.AT76532.62.A', 'E:P S:1C W:2D N:2H E:P S:2NT W:P', '4H'],
    ['7719 minimum six-card minor rebids over natural one NT', 'W', '875.AK.AJT643.T8', 'W:1D N:P E:1NT S:P', '2D'],
    ['7750 six-card original minor survives a weak doubleton preference', 'S', 'K7.J97.AKJT53.J6', 'S:1D W:X N:2C E:P', '2D'],
    ['7756 strong club support uses fourth-suit force', 'S', '94.AJ72.A9.AJ962', 'N:1C E:P S:1H W:P N:1S E:P', '2D'],
    ['7767 passed eight points escape club void in real six-card diamonds', 'W', 'QT9.KT84.K87632.-', 'W:P N:P E:1C S:P W:1H N:P E:1S S:P', '2D'],
    ['1166 opener six clubs keep their natural description in competition', 'N', 'T.K53.AKT.AJ9752', 'S:P W:P N:1C E:P S:1H W:1S', '2C'],
    ['1187 fifteen-point responder explores game without heart stopper', 'S', 'AK4.J87.KQ8.QT64', 'W:P N:1D E:2H', '3H'],
    ['1203 six spades compete without creating a game force', 'W', 'AK8763.Q2.K543.K', 'W:1S N:P E:1NT S:2D', '2S'],
    ['4076 negative-double fit invitation uses singleton adjusted nine', 'S', 'Q532.K.87643.Q53', 'N:1C E:1H S:X W:P N:3S E:P', '4S'],
    ['4081 passed responder hearts need a real diamond answer', 'N', 'A9863.-.AQ8753.Q2', 'E:P S:P W:P N:1S E:P S:2H W:P', '3D'],
    ['4153 available heart support survives enemy cuebid', 'E', 'Q942.A852.74.AQ8', 'E:1C S:1D W:1H N:2C', '2H'],
    ['4172 real second five-card minor survives competition', 'S', '-.K73.AK752.KQJ64', 'N:P E:P S:1D W:P N:1H E:1S', '2C'],
    ['4177 public sixteen plus twelve accepts long-club jump in NT', 'W', 'KQ863.AK2.432.97', 'E:1C S:P W:1S N:P E:3C S:P', '3NT'],
    ['4180 nine-card second-major fit supplies adjusted invitation', 'S', '43.KT973.AJ93.32', 'N:1S E:P S:1NT W:P N:2H E:P', '3H'],
    ['4190 eighteen points with nine diamonds invites minor game', 'E', 'AKT8.K85.KJ43.A3', 'S:P W:P N:P E:1D S:2C W:2D N:P', '3D'],
    ['4201 support ninth trump supplies game against sixteen invitation', 'W', 'Q96.Q864.KT4.J94', 'E:1H S:P W:2H N:P E:3H N:P', '4H'],
    ['4210 diamond doubleton supplies ninth support point for game', 'N', 'J86.KJT5.JT.Q986', 'S:1S W:P N:2S E:P S:3S W:P', '4S'],
    ['4215 lowest competitive heart raise does not guarantee ten-point invitation', 'E', 'KQ4.9762.AJ943.K', 'W:P N:P E:1D S:P W:1H N:1S E:2H S:2S W:3H N:3S', 'P'],
    ['4220 public sixteen plus eleven accepts minor jump in NT', 'S', 'A94.QJT6.KJ94.85', 'N:1C E:P S:1H W:P N:3C E:P', '3NT'],
    ['4238 support doubleton supplies game against sixteen invitation', 'E', '942.Q98.94.KQJ82', 'S:P W:1S N:P E:2S S:P W:3S N:P', '4S'],
    ['4244 eighteen-point opener continues with actual four spades', 'S', 'AKT8.J7.AJ.KQ963', 'N:P E:P S:1C W:P N:1H E:P S:1S W:P N:2C E:P', '2S'],
    ['4255 real lower five-card second suit remains available', 'E', '3.A4.AKT85.QJT75', 'W:P N:P E:1D S:1S W:P N:P', '2C'],
    ['4283 game forcing no-fit hand must not invent four spades', 'E', 'KJ.AKQ85.KQ42.KJ', 'W:P N:P E:2C S:P W:2D N:P E:2H S:P W:4C N:P', '4H'],
    ['4321 double-five opener describes clubs over enemy NT', 'N', '76.A7543.Q.AKJ94', 'E:P S:P W:P N:1H E:1S S:P W:1NT', '2C'],
    ['4333 eighteen-point six-spade rebid is an invitation', 'E', 'AKJ542.K8.KJ2.K6', 'E:1S S:2D W:P N:P', '3S'],
    ['4345 eighteen-point opener retains real four clubs after seven-heart preference', 'N', '52.AKJ86.AT.AQ82', 'E:P S:P W:P N:1H E:P S:1S W:P N:2C E:P S:2H W:P', '3C'],
    ['4348 ten-card diamond fit reaches adjusted minor game', 'W', 'KJ3.Q8762.9873.A', 'N:P E:1D S:P W:1H N:P E:3D S:P', '5D'],
    ['4364 six-three diamonds and singleton support reach minor twenty-nine', 'W', '763.6.J83.AKQT72', 'N:P E:1D S:P W:1NT N:P E:3D S:P', '5D'],
    ['4395 upper invitation chooses NT before weak club preference', 'E', 'K.QJT53.J65.KQT5', 'W:1C N:P E:1H S:P W:1S N:P', '2NT'],
    ['4398 four clubs cannot jump raise a public three-card suit', 'W', 'A76.AT7.543.Q654', 'S:P W:P N:P E:1C S:P', '1NT'],
    ['4415 seven spades return naturally over opposing diamonds', 'E', 'KQT6542.K.87.942', 'W:1C N:1D E:1S S:2D W:P N:P', '2S'],
    ['4422 responder six spades continue through opposing hearts', 'N', 'KQJ853.-.A986.J97', 'S:1D W:1H N:1S E:2H S:P W:P', '2S'],
    ['4424 three-card response-major support chooses minimum natural NT', 'E', 'T73.AQ65.Q9.A965', 'N:P E:1C S:1D W:1S N:P', '1NT'],
    ['4426 fifteen opposite six-heart invitation reaches public NT game', 'S', 'AK862.4.KJT63.AT', 'S:1S W:P N:1NT E:P S:2D W:P N:3H E:P', '3NT'],
    ['4444 eight diamonds with support thirteen invites', 'W', 'AKJ.QJ74.98762.8', 'N:P E:1D S:P W:1H N:P E:1S S:P', '3D'],
    ['4447 upper responder shows real four hearts over bad diamond fit', 'E', 'QT842.AJ93.A.J96', 'W:1D N:P E:1S S:P W:2D N:P', '2H'],
    ['4452 real nine-card second-minor fit invites with support sixteen', 'W', 'KJ32.6.KJ8.KJT96', 'N:P E:1H S:P W:1S N:P E:2C S:P', '3C'],
    ['4466 lower four-card clubs remain a natural continuation', 'W', 'Q4.72.AQT62.AK54', 'S:P W:1D N:1H E:P S:P', '2C'],
    ['4513 six hearts escape the short second minor', 'W', 'T9432.AK9753.-.A9', 'E:1D S:1S W:2H N:P E:3C S:P', '3H'],
    ['4526 fourteen accepts eleven-point NT invitation after minor repeat', 'S', 'A98.AKT5.K6532.4', 'S:1D W:P N:1S E:P S:2D W:P N:2NT E:P', '3NT'],
    ['4575 support doubleton accepts public sixteen heart invitation', 'E', 'QT5.K97.KT762.82', 'W:1H N:P E:2H S:P W:3H N:P', '4H'],
    ['4589 fourteen accepts eleven-point NT invitation after side major', 'S', 'A864.65.KT5.AK86', 'E:P S:1C W:P N:1H E:P S:1S W:P N:2NT E:P', '3NT'],
    ['4549 cheapest competitive major support can contain only three cards', 'W', 'AJ94.642.AJ.A742', 'E:P S:P W:1C N:1D E:1H S:2D', '2H'],
  ] as const)('%s', (_, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat, holding, prefix), 'sayc')).toEqual(parse(expected));
  });
  it('Stayman other-major rebid shows only four cards, not five', () => {
    const obs = position('E', 'AKQ4.AJ65.K98.72', 'E:1NT S:P W:2C N:P E:2H S:P W:2S N:P');
    expect(naturalSuitMinimum(obs.auction, 'W', 'S', 'sayc')).toBe(4);
  });
});

import { describe, it, expect } from 'vitest';
import { type Call, type Seat, type Card, SEATS, STRAINS, PASS, nextSeat, sideOf } from '../src/core/types';
import { deck, deal, boardInfo } from '../src/core/deal';
import { legalCalls, sameCall, finalContract, auctionStatus } from '../src/core/auction';
import { newGame, applyCall, playCard, controllerFor, assertGameIntegrity, isFinished, replay, toRecord } from '../src/core/game';
import { legalCards, trickWinner } from '../src/core/play';
import { scoreContract } from '../src/core/scoring';

const bid = (level: number, strain: typeof STRAINS[number]): Call => ({ kind: 'bid', level, strain });
const card = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}${rank}`, suit, rank });
const auction = (...calls: Call[]) => {
  let g = newGame(1, 'rules'); for (const call of calls) g = applyCall(g, g.turn, call); return g;
};
const contains = (calls: Call[], call: Call) => calls.some(c => sameCall(c, call));

describe('52 cards, deals, board cycles', () => {
  it('has exactly 52 unique valid cards and 13 of each suit', () => {
    expect(deck()).toHaveLength(52); expect(new Set(deck().map(c => c.id)).size).toBe(52);
    for (const strain of STRAINS.slice(0, 4)) expect(deck().filter(c => c.suit === strain)).toHaveLength(13);
  });
  it('deals 13 cards per seat with no repetitions across 100 seeds', () => {
    for (let i = 0; i < 100; i++) {
      const hands = deal(`deal-${i}`); for (const seat of SEATS) expect(hands[seat]).toHaveLength(13);
      expect(new Set(SEATS.flatMap(s => hands[s].map(c => c.id))).size).toBe(52);
    }
  });
  it('reproduces identical seeds and varies different seeds', () => {
    expect(deal('alpha')).toEqual(deal('alpha')); expect(deal('alpha')).not.toEqual(deal('beta'));
  });
  it('cycles duplicate dealer and vulnerability over all 16 boards', () => {
    const expected = ['None', 'NS', 'EW', 'Both', 'NS', 'EW', 'Both', 'None', 'EW', 'Both', 'None', 'NS', 'Both', 'None', 'NS', 'EW'];
    for (let i = 0; i < 32; i++) { expect(boardInfo(i + 1)).toEqual({ dealer: SEATS[i % 4], vulnerability: expected[i % 16] }); }
    expect(() => boardInfo(0)).toThrow(); expect(() => boardInfo(1.5)).toThrow();
  });
});

describe('auction legality and declarer', () => {
  it('offers all 35 opening bids and Pass, no X or XX', () => {
    const calls = legalCalls([], 'N'); expect(calls).toHaveLength(36);
    expect(contains(calls, { kind: 'double' })).toBe(false); expect(contains(calls, { kind: 'redouble' })).toBe(false);
  });
  it('orders bids by level and clubs, diamonds, hearts, spades, NT', () => {
    for (const [i, strain] of STRAINS.entries()) {
      const g = auction(bid(3, strain)); const legal = legalCalls(g.auction, 'E');
      expect(contains(legal, bid(3, strain))).toBe(false);
      for (const [j, other] of STRAINS.entries()) expect(contains(legal, bid(3, other))).toBe(j > i);
      expect(contains(legal, bid(2, 'NT'))).toBe(false); expect(contains(legal, bid(4, 'C'))).toBe(true);
    }
  });
  it('rejects wrong turns, invalid levels and lower bids without mutating state', () => {
    const g = auction(bid(1, 'S')); const before = structuredClone(g);
    expect(() => applyCall(g, 'S', PASS)).toThrow('轮到');
    expect(() => applyCall(g, 'E', bid(1, 'H'))).toThrow('不合法');
    expect(() => applyCall(g, 'E', bid(8, 'NT'))).toThrow('不合法');
    expect(g).toEqual(before);
  });
  it('permits opponents to double, own side to redouble, including intervening passes', () => {
    let g = auction(bid(1, 'H'), PASS, PASS);
    expect(contains(legalCalls(g.auction, 'W'), { kind: 'double' })).toBe(true);
    g = applyCall(g, 'W', { kind: 'double' }); g = applyCall(g, 'N', PASS); g = applyCall(g, 'E', PASS);
    expect(contains(legalCalls(g.auction, 'S'), { kind: 'redouble' })).toBe(true);
    g = applyCall(g, 'S', { kind: 'redouble' });
    expect(auctionStatus(g.auction).doubled).toBe(2);
    expect(contains(legalCalls(g.auction, 'W'), { kind: 'double' })).toBe(false);
  });
  it('forbids own-side double and opponents redouble', () => {
    const g = auction(bid(1, 'H'), PASS);
    expect(() => applyCall(g, 'S', { kind: 'double' })).toThrow();
    const doubled = auction(bid(1, 'H'), { kind: 'double' }, PASS);
    expect(() => applyCall(doubled, 'W', { kind: 'redouble' })).toThrow();
    expect(() => applyCall(doubled, 'W', { kind: 'double' })).toThrow();
  });
  it('higher bids cancel previous doubles/redoubles', () => {
    const g = auction(bid(1, 'H'), { kind: 'double' }, { kind: 'redouble' }, bid(1, 'S'));
    expect(auctionStatus(g.auction).doubled).toBe(0);
    expect(contains(legalCalls(g.auction, 'N'), { kind: 'double' })).toBe(true);
  });
  it('four passes produce a zero-score passed-out board, not play', () => {
    const g = auction(PASS, PASS, PASS, PASS); expect(g.phase).toBe('passedOut'); expect(g.contract).toBeNull(); expect(g.result?.scoreNS).toBe(0);
    expect(() => applyCall(g, g.turn, bid(1, 'C'))).toThrow();
  });
  it('three passes after a double end the auction with doubled contract', () => {
    const g = auction(bid(3, 'NT'), { kind: 'double' }, PASS, PASS, PASS);
    expect(g.phase).toBe('play'); expect(g.contract?.doubled).toBe(1); expect(g.turn).toBe('E');
  });
  it('the first final-strain bidder on the winning side declares, not the last bidder', () => {
    const g = auction(bid(1, 'S'), bid(2, 'H'), bid(2, 'S'), bid(3, 'H'), PASS, PASS, bid(4, 'S'), PASS, PASS, PASS);
    expect(g.contract).toMatchObject({ declarer: 'N', dummy: 'S', leader: 'E', level: 4, strain: 'S' });
    expect(g.turn).toBe('E'); expect(controllerFor(g)).toBe('E');
  });
  it('excludes the opposing first bidder of the same strain', () => {
    let g = newGame(2, 'other-side');
    for (const call of [bid(1, 'NT'), bid(2, 'C'), PASS, bid(2, 'NT'), PASS, PASS, PASS]) g = applyCall(g, g.turn, call);
    expect(g.contract).toMatchObject({ declarer: 'N', dummy: 'S', leader: 'E', strain: 'NT' });
  });
  it('ends only after three consecutive passes after the last non-pass', () => {
    const g = auction(bid(1, 'C'), PASS, PASS, bid(1, 'D'), PASS, PASS);
    expect(g.phase).toBe('auction'); expect(auctionStatus(g.auction).passes).toBe(2);
    expect(finalContract([...g.auction, { seat: g.turn, call: PASS }])?.declarer).toBe('W');
    expect(() => finalContract(g.auction)).toThrow();
  });
});

describe('play, follow-suit and trick winners', () => {
  it('must follow led suit if possible, may discard or ruff when void', () => {
    const lead = [{ seat: 'N' as Seat, card: card('H', 4) }];
    expect(legalCards([card('H', 2), card('S', 14)], lead)).toEqual([card('H', 2)]);
    expect(legalCards([card('C', 2), card('S', 14)], lead)).toHaveLength(2);
  });
  it('NT ignores high off-suit cards', () => {
    expect(trickWinner([{ seat: 'N', card: card('H', 4) }, { seat: 'E', card: card('S', 14) }, { seat: 'S', card: card('H', 13) }, { seat: 'W', card: card('D', 14) }], 'NT')).toBe('S');
  });
  it('trumps beat even the ace of the led suit, highest trump wins', () => {
    expect(trickWinner([{ seat: 'N', card: card('H', 14) }, { seat: 'E', card: card('S', 2) }, { seat: 'S', card: card('H', 13) }, { seat: 'W', card: card('S', 3) }], 'S')).toBe('W');
  });
  it('highest card wins when trump itself is led', () => {
    expect(trickWinner([{ seat: 'N', card: card('S', 14) }, { seat: 'E', card: card('S', 2) }, { seat: 'S', card: card('S', 13) }, { seat: 'W', card: card('C', 14) }], 'S')).toBe('N');
  });
  it('reveals dummy only after the opening lead and declarer controls it', () => {
    let g = auction(bid(1, 'NT'), PASS, PASS, PASS);
    expect(g.dummyRevealed).toBe(false); g = playCard(g, 'E', g.hands.E[0].id);
    expect(g.dummyRevealed).toBe(true); expect(g.turn).toBe('S'); expect(controllerFor(g)).toBe('N');
  });
  it('rejects out-of-turn, unavailable and revoked cards', () => {
    let g = auction(bid(1, 'NT'), PASS, PASS, PASS);
    expect(() => playCard(g, 'N', g.hands.N[0].id)).toThrow('轮到');
    expect(() => playCard(g, 'E', 'invalid')).toThrow('没有');
    const suit = g.hands.E.find(c => g.hands.S.some(s => s.suit === c.suit) && g.hands.S.some(s => s.suit !== c.suit))!.suit;
    g = playCard(g, 'E', g.hands.E.find(c => c.suit === suit)!.id);
    expect(() => playCard(g, 'S', g.hands.S.find(c => c.suit !== suit)!.id)).toThrow('跟牌');
  });
  it('winner leads the next trick and 13 tricks produce authentic scoring', () => {
    let g = auction(bid(1, 'NT'), PASS, PASS, PASS);
    for (let i = 0; i < 52; i++) {
      g = playCard(g, g.turn, legalCards(g.hands[g.turn], g.currentTrick)[0].id);
      if (i % 4 === 3) expect(g.turn).toBe(g.completedTricks.at(-1)?.winner);
      assertGameIntegrity(g);
    }
    expect(g.phase).toBe('complete'); expect(g.tricksWon.NS + g.tricksWon.EW).toBe(13); expect(SEATS.flatMap(s => g.hands[s])).toHaveLength(0);
    expect(g.result?.scoreNS).toBe(scoreContract(g.contract!, g.tricksWon.NS, false).total);
    expect(replay(toRecord(g))).toEqual(g); expect(isFinished(g)).toBe(true);
  });
  it('detects duplicated cards and corrupted trick counts', () => {
    const g = newGame(1, 'broken'); const bad = structuredClone(g); bad.hands.N[0] = bad.hands.E[0]; expect(() => assertGameIntegrity(bad)).toThrow();
    const wrongCount = { ...g, tricksWon: { NS: 1, EW: 0 } }; expect(() => assertGameIntegrity(wrongCount)).toThrow();
  });
});

describe('duplicate score golden cases', () => {
  const cases: [number, typeof STRAINS[number], 0 | 1 | 2, number, boolean, number][] = [
    [1,'C',0,7,false,70],[1,'D',0,8,false,90],[1,'H',0,7,false,80],[1,'NT',0,7,false,90],[1,'NT',0,8,false,120],
    [2,'H',0,8,false,110],[2,'NT',0,8,false,120],[3,'NT',0,9,false,400],[3,'NT',0,9,true,600],[4,'S',0,10,false,420],[4,'S',0,10,true,620],
    [5,'C',0,11,false,400],[5,'D',0,11,true,600],[6,'NT',0,12,false,990],[6,'NT',0,12,true,1440],[7,'NT',0,13,false,1520],[7,'NT',0,13,true,2220],
    [6,'S',0,12,false,980],[6,'H',0,12,true,1430],[7,'S',0,13,false,1510],[7,'H',0,13,true,2210],[6,'C',0,12,false,920],[6,'D',0,12,true,1370],
    [7,'C',0,13,false,1440],[7,'D',0,13,true,2140],[4,'S',1,10,false,590],[4,'S',1,10,true,790],[4,'S',1,11,false,690],[4,'S',1,11,true,990],
    [1,'NT',1,7,false,180],[1,'NT',2,7,false,560],[1,'C',1,7,false,140],[1,'C',2,7,false,230],[2,'C',2,8,false,560],
    [2,'H',1,8,false,470],[2,'H',1,9,false,570],[2,'H',1,9,true,870],[2,'H',2,8,false,640],[2,'H',2,9,false,840],[2,'H',2,9,true,1240],
    [6,'NT',1,12,false,1230],[6,'NT',1,12,true,1680],[1,'D',2,9,false,630],[1,'D',2,9,true,1030]
  ];
  it.each(cases)('%i %s doubled=%i tricks=%i vulnerable=%s gives %i', (level,strain,doubled,tricks,vulnerable,score) => {
    expect(scoreContract({ level,strain,doubled }, tricks, vulnerable).total).toBe(score);
  });
  for (const vulnerable of [false, true]) for (const doubled of [0, 1, 2] as const) {
    it(`all 13 undertrick penalties: vulnerable=${vulnerable}, doubled=${doubled}`, () => {
      const doubledNonVul = [100,300,500,800,1100,1400,1700,2000,2300,2600,2900,3200,3500];
      for (let down=1; down<=13; down++) {
        const penalty = doubled === 0 ? down*(vulnerable?100:50) : (vulnerable ? 200+(down-1)*300 : doubledNonVul[down-1])*(doubled === 2 ? 2:1);
        const result = scoreContract({ level:7,strain:'NT',doubled },13-down,vulnerable);
        expect(result.total).toBe(-penalty); expect(result.contractPoints + result.gameBonus + result.slamBonus + result.insultBonus).toBe(0);
      }
    });
  }
  it('uses multiplied contract points to decide game; overtricks never create game', () => {
    expect(scoreContract({ level:1,strain:'NT',doubled:0 },13,false).gameBonus).toBe(50);
    expect(scoreContract({ level:2,strain:'H',doubled:1 },8,false).gameBonus).toBe(300);
    expect(scoreContract({ level:1,strain:'C',doubled:2 },7,false).gameBonus).toBe(50);
  });
  it('rejects invalid scoring inputs', () => {
    expect(() => scoreContract({level:8,strain:'NT',doubled:0},13,false)).toThrow();
    expect(() => scoreContract({level:1,strain:'C',doubled:0},14,false)).toThrow();
  });
});

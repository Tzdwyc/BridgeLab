import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { applyCall, newGame, newGameFromDeal } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Hands, type Seat, type Strain, type Suit, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const ranks = '23456789TJQKA';

function holding(spades: string, hearts: string, diamonds: string, clubs: string): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const cards = [spades, hearts, diamonds, clubs].flatMap((text, suitIndex) => [...text].map(symbol => ({
    id: `${suits[suitIndex]}${ranks.indexOf(symbol) + 2}`,
    suit: suits[suitIndex],
    rank: ranks.indexOf(symbol) + 2
  })));
  if (cards.length !== 13 || cards.some(card => card.rank < 2)) throw new Error('Bad test holding');
  return cards;
}

function shapedHand(shape: [number, number, number, number], target: number): Card[] {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === suits.length) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((sum, rank) => sum + rank - 10, 0);
      const lowCount = shape[index] - honors.length;
      if (lowCount < 0 || lowCount > 9 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (!rest) continue;
      const cards = [...honors, ...Array.from({ length: lowCount }, (_, offset) => 10 - offset)]
        .map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank }));
      return [...cards, ...rest];
    }
    return null;
  };
  const cards = visit(0, target);
  if (!cards || cards.length !== 13) throw new Error(`Bad test shape ${shape.join('-')} / ${target} HCP`);
  return cards;
}

function observationAfterAuction(calls: Call[], shape: [number, number, number, number], hcp: number): BiddingObservation {
  let game = newGame(1, 'v031-auction-matrix');
  for (const call of calls) game = applyCall(game, game.turn, call);
  const observation = observe(game) as BiddingObservation;
  observation.hand = shapedHand(shape, hcp);
  return observation;
}

function northAfterOneSpadeOneNt(hand: Card[]): BiddingObservation {
  let game = newGame(2, 'v031-one-spade-one-nt');
  for (const call of [PASS, PASS, PASS, bid(1, 'S'), PASS, bid(1, 'NT'), PASS]) game = applyCall(game, game.turn, call);
  const observation = observe(game) as BiddingObservation;
  observation.hand = hand;
  expect(observation.seat).toBe('N');
  return observation;
}

describe('v0.3.1 SAYC+2/1 opener rebid after a semi-forcing 1NT response', () => {
  it('rebids 2C with the reported 15-HCP 5-1-3-4 hand', () => {
    const north = holding('AQJT2', '2', 'AJ3', 'QJ95');
    expect(evaluateHand(north)).toMatchObject({ hcp: 15, balanced: false });
    expect(chooseBid(northAfterOneSpadeOneNt(north), 'sayc')).toEqual(bid(2, 'C'));
  });

  it.each([
    { hand: holding('AKQJ2', 'KQ76', '32', '54'), expected: bid(2, 'H'), label: 'four-card heart side suit' },
    { hand: holding('AKQJ98', 'K76', '32', '54'), expected: bid(2, 'S'), label: 'six-card opener suit' },
    { hand: holding('AKQJ2', 'K76', 'Q32', '54'), expected: PASS, label: 'balanced minimum without a side suit' }
  ])('uses the natural $label continuation', ({ hand, expected }) => {
    expect(chooseBid(northAfterOneSpadeOneNt(hand), 'sayc')).toEqual(expected);
  });
});

describe('v0.3.1 chooses the publicly known eight-card fit', () => {
  it('uses spades rather than the seven-card heart fit in the reported deal', () => {
    const hands: Hands = {
      N: holding('QT8', 'KQ6', 'AJ84', 'QT8'),
      E: holding('A54', '832', 'K72', '6432'),
      S: holding('KJ762', 'AJ54', '9', 'AKJ'),
      W: holding('93', 'T97', 'QT653', '975')
    };
    let game = newGameFromDeal(3, 'v031-known-fit', hands, 'S', 'Both');
    for (const call of [bid(1, 'S'), PASS, bid(2, 'D'), PASS, bid(2, 'H'), PASS]) game = applyCall(game, game.turn, call);
    const northCall = chooseBid(observe(game) as BiddingObservation, 'sayc');
    expect(northCall).toEqual(bid(4, 'S'));
    expect(describeCall(game.auction, game.turn, northCall, 'sayc')).toContain('至少8张配合');
    game = applyCall(game, game.turn, northCall);
    while (game.phase === 'auction') game = applyCall(game, game.turn, game.turn === 'E' || game.turn === 'W' ? PASS : chooseBid(observe(game) as BiddingObservation, 'sayc'));
    expect(game.contract?.strain).toBe('S');
    expect(game.contract?.level).toBeGreaterThanOrEqual(4);
  });

  it('does not pass the reported 1S-2H-3C auction and chooses the known 5-3 spade fit', () => {
    const hands: Hands = {
      N: holding('J982', '64', 'J54', 'K962'),
      E: holding('AQ543', '53', 'Q3', 'AJT3'),
      S: holding('7', 'Q82', 'K9762', '8754'),
      W: holding('KT6', 'AKJT97', 'AT8', 'Q')
    };
    const calls = [bid(1, 'S'), PASS, bid(2, 'H'), PASS, bid(3, 'C'), PASS];
    let game = newGameFromDeal(1, 'v031-sayc-two-over-one-rebid', hands, 'E', 'None');
    for (const call of calls) game = applyCall(game, game.turn, call);
    const observation = observe(game) as BiddingObservation;
    expect(evaluateHand(hands.W)).toMatchObject({ hcp: 17 });
    expect(analyzeAuctionSemantics(game.auction, game.turn, 'sayc')).toMatchObject({
      forcing: 'game',
      convention: 'none',
      mustBid: true
    });
    const call = chooseBid(observation, 'sayc');
    expect(call).toEqual(bid(4, 'S'));
    expect(describeCall(game.auction, game.turn, call, 'sayc')).toContain('公开点力下限');
    game = applyCall(game, game.turn, call);
    while (game.phase === 'auction') {
      const call = game.turn === 'E' || game.turn === 'W' ? PASS : chooseBid(observe(game) as BiddingObservation, 'sayc');
      game = applyCall(game, game.turn, call);
    }
    expect(game.contract).toMatchObject({ level: 4, strain: 'S' });
  });

  it.each([
    { rebid: bid(3, 'C'), label: 'three-level clubs' },
    { rebid: bid(3, 'D'), label: 'three-level diamonds' },
    { rebid: bid(2, 'S'), label: 'opener suit' },
    { rebid: bid(2, 'NT'), label: 'notrump rebid' }
  ])('keeps every SAYC 2/1 continuation alive after $label', ({ rebid }) => {
    for (let hcp = 10; hcp <= 17; hcp++) {
      const observation = observationAfterAuction([bid(1, 'S'), PASS, bid(2, 'H'), PASS, rebid, PASS], [3, 5, 3, 2], hcp);
      expect(analyzeAuctionSemantics(observation.auction, observation.seat, 'sayc').mustBid).toBe(true);
      expect(chooseBid(observation, 'sayc').kind).not.toBe('pass');
    }
  });

  it('forbids the reported 1S-2D-2S-Pass ending under the default game-force agreement', () => {
    const observation = observationAfterAuction([bid(1, 'S'), PASS, bid(2, 'D'), PASS, bid(2, 'S'), PASS], [2, 3, 5, 3], 13);
    expect(analyzeAuctionSemantics(observation.auction, observation.seat, 'sayc')).toMatchObject({ forcing: 'game', mustBid: true });
    const call = chooseBid(observation, 'sayc');
    expect(call).not.toEqual(PASS);
    expect(call.kind === 'bid' && (call.strain === 'NT' ? call.level >= 3 : call.strain === 'H' || call.strain === 'S' ? call.level >= 4 : call.level >= 5)).toBe(true);
  });
});

describe('v0.3.1 contextual bid explanations', () => {
  const pass = (seat: Seat): AuctionEntry => ({ seat, call: PASS });
  const openingAuction = [pass('E'), pass('S'), pass('W')];
  const responseAuction: AuctionEntry[] = [...openingAuction, { seat: 'N', call: bid(1, 'S') }, pass('E')];
  const rebidAuction: AuctionEntry[] = [...responseAuction, { seat: 'S', call: bid(1, 'NT') }, pass('W')];

  it('states actual ranges and shape instead of referring to the system card', () => {
    const opening = describeCall(openingAuction, 'N', bid(1, 'S'), 'sayc');
    const response = describeCall(responseAuction, 'S', bid(1, 'NT'), 'sayc');
    const rebid = describeCall(rebidAuction, 'N', bid(2, 'C'), 'sayc');
    expect(opening).toContain('5+张');
    expect(opening).toContain('Rule of 20');
    expect(response).toContain('5–12 HCP');
    expect(response).toContain('半逼叫');
    expect(rebid).toContain('5张开叫高花');
    expect(rebid).toContain('4张第二套');
  });

  it('places 3NT with the reported five-club 15-HCP balanced response in the revised card', () => {
    const hands: Hands = {
      N: holding('A2', 'QT4', 'Q32', 'AQJ52'),
      E: holding('KQJ86', '87', 'JT76', '73'),
      S: holding('754', 'AKJ2', 'K98', 'KT4'),
      W: holding('T93', '9653', 'A54', '986')
    };
    let game = newGameFromDeal(15, 'v031-reported-minor-two-nt', hands, 'S', 'Both');
    game = applyCall(game, game.turn, bid(1, 'C'));
    game = applyCall(game, game.turn, PASS);
    expect(game.turn).toBe('N');
    expect(evaluateHand(hands.N)).toEqual({
      hcp: 15,
      lengths: { C: 5, D: 3, H: 3, S: 2 },
      balanced: true
    });

    const response = chooseBid(observe(game) as BiddingObservation, 'sayc');
    expect(response).toEqual(bid(3, 'NT'));
    const explanation = describeCall(game.auction, game.turn, response, 'sayc');
    expect(explanation).toContain('13+ HCP');
    expect(explanation).toContain('均型');
    expect(explanation).toContain('无四张高花');
    expect(explanation).toContain('原则上止叫');

    game = applyCall(game, game.turn, response);
    game = applyCall(game, game.turn, PASS);
    expect(game.turn).toBe('S');
    expect(chooseBid(observe(game) as BiddingObservation, 'sayc')).toEqual(PASS);
  });

  it.each([
    { auction: openingAuction, seat: 'N' as const },
    { auction: responseAuction, seat: 'S' as const },
    { auction: rebidAuction, seat: 'N' as const },
    { auction: [{ seat: 'N' as const, call: bid(1, 'D') }, { seat: 'E' as const, call: bid(1, 'H') }], seat: 'S' as const }
  ])('never emits the former placeholder for any legal call', ({ auction, seat }) => {
    for (const system of ['sayc', 'two-over-one', 'precision'] as const) {
      for (const call of legalCalls(auction, seat)) {
        const explanation = describeCall(auction, seat, call, system);
        expect(explanation.length).toBeGreaterThan(8);
        expect(explanation).not.toContain('范围详见体系卡');
        expect(explanation).not.toContain('自然叫牌／加叫');
        expect(explanation).not.toContain('当前序列没有定义更窄');
        expect(explanation).not.toContain('当前序列没有人工含义');
      }
    }
  });

  it('gives concrete fallback meanings in long natural and competitive sequences', () => {
    const cases: { auction: AuctionEntry[]; seat: Seat; call: Call; expected: string[] }[] = [
      {
        auction: [
          { seat: 'N', call: bid(1, 'C') }, { seat: 'E', call: bid(1, 'H') },
          { seat: 'S', call: bid(2, 'C') }, { seat: 'W', call: bid(2, 'H') },
          { seat: 'N', call: bid(3, 'C') }, { seat: 'E', call: PASS }
        ],
        seat: 'S', call: bid(3, 'NT'), expected: ['自然3NT', '止张', '无将成局']
      },
      {
        auction: [
          { seat: 'N', call: bid(1, 'D') }, { seat: 'E', call: bid(1, 'S') },
          { seat: 'S', call: bid(2, 'D') }, { seat: 'W', call: bid(2, 'S') },
          { seat: 'N', call: PASS }, { seat: 'E', call: PASS }
        ],
        // Opening 1D publicly guarantees only three diamonds. A competitive
        // repeat is not an additional four-card-support promise.
        seat: 'S', call: bid(3, 'D'), expected: ['自然支持', '公开3+张', '5+张支持', '竞争性或邀请性']
      },
      {
        auction: [
          { seat: 'N', call: bid(1, 'C') }, { seat: 'E', call: bid(1, 'H') },
          { seat: 'S', call: bid(1, 'S') }, { seat: 'W', call: bid(2, 'H') },
          { seat: 'N', call: bid(2, 'S') }, { seat: 'E', call: PASS }
        ],
        seat: 'S', call: bid(4, 'S'), expected: ['四张支持', '已确认高花配合', '成局']
      }
    ];
    for (const sample of cases) {
      const explanation = describeCall(sample.auction, sample.seat, sample.call, 'sayc');
      for (const phrase of sample.expected) expect(explanation).toContain(phrase);
      expect(explanation).not.toMatch(/范围详见体系卡|当前序列没有定义更窄|当前序列没有人工含义/);
    }
  });
});

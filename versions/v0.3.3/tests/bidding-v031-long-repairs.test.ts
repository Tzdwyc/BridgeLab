import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics, noTrumpRangeAt } from '../src/ai/bidding-semantics';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, PASS } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const suits: Suit[] = ['S', 'H', 'D', 'C'];
function parse(token: string): Call {
  if (token === 'P') return PASS;
  if (token === 'X') return { kind: 'double' };
  if (token === 'XX') return { kind: 'redouble' };
  return bid(Number(token[0]), token.slice(1) as Strain);
}
function holding(text: string): Card[] {
  const cards = text.split('.').flatMap((suit, index) => [...suit].map(symbol => {
    const rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { id: `${suits[index]}${rank}`, suit: suits[index], rank };
  }));
  expect(cards.length).toBe(13); return cards;
}
function shaped(shape: readonly number[], target: number): Card[] {
  const visit = (index: number, remaining: number): Card[] | null => {
    if (index === 4) return remaining === 0 ? [] : null;
    for (let mask = 0; mask < 16; mask++) {
      const honors = [14, 13, 12, 11].filter((_, bit) => mask & (1 << bit));
      const points = honors.reduce((n, rank) => n + rank - 10, 0);
      const low = shape[index] - honors.length;
      if (low < 0 || low > 9 || points > remaining) continue;
      const rest = visit(index + 1, remaining - points);
      if (rest) return [...honors, ...Array.from({ length: low }, (_, n) => 10 - n)]
        .map(rank => ({ id: `${suits[index]}${rank}`, suit: suits[index], rank })).concat(rest);
    }
    return null;
  };
  const cards = visit(0, target); if (!cards) throw new Error('Cannot build matrix hand');
  expect(evaluateHand(cards).hcp).toBe(target); return cards;
}
function position(text: string, hand?: Card[], board = 1): BiddingObservation {
  let game = newGame(board, `v031-long-repair-${board}`);
  for (const token of text.split(' ').filter(Boolean)) game = applyCall(game, game.turn, parse(token));
  expect(game.phase).toBe('auction');
  return { ...(observe(game) as BiddingObservation), ...(hand ? { hand } : {}) };
}
function meaning(prefix: string, token: string) {
  const obs = position(prefix); return describeCall(obs.auction, obs.seat, parse(token), 'sayc');
}

describe('v0.3.1 long-sequence root-cause regressions', () => {
  it.each(Array.from({ length: 16 }, (_, index) => index + 1))('does not promote a natural club overcall into 22+ on board %i', board => {
    const obs = position('1H 2C P 2H P 3C P', holding('AT742.5.AKT8.754'), board);
    expect(chooseBid(obs, 'sayc')).not.toEqual(bid(4, 'NT'));
    const second = position('1H P 1S 2C 2S 3C 3S P P', holding('75.K6.J963.Q9865'), board);
    expect(chooseBid(second, 'sayc')).not.toEqual(bid(4, 'NT'));
  });

  it.each(Array.from({ length: 16 }, (_, index) => index + 1))('keeps the weak-two new-suit force through interference on board %i', board => {
    const obs = position('2D 2H 2S P', holding('A.J7.KT8743.KT96'), board);
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc')).toMatchObject({ convention: 'preempt-new-suit', mustBid: true });
    expect(chooseBid(obs, 'sayc')).toEqual(bid(3, 'D'));
  });

  it('does not label a takeout cue response as Michaels', () => {
    const obs = position('1S P P X P 2S P', holding('A4.AQ5.JT96.A975'));
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc').convention).toBe('takeout-cue');
    expect(chooseBid(obs, 'sayc').kind).not.toBe('pass');
    expect(meaning('1S P P X P', '2S')).toContain('技术性加倍后的扣叫');
  });

  it('does not read a keycard signoff as Stayman and invent 5NT', () => {
    const obs = position('1S P 3S P 4NT P 5C P 5S P', holding('984.83.542.AKQT8'));
    expect(analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc').mustBid).toBe(false);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });

  it('stops in the agreed trump after a negative queen answer instead of proposing a different slam', () => {
    const obs = position('1H P 2D P 2H P 4NT P 5C P 5D P 5H P', holding('AJ7.AKQ.KQJ863.7'));
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });

  it('does not inflate a transfer acceptance and later raise into six-card support', () => {
    const obs = position('1NT P 2H P 2S P 3NT P 4S P', holding('KQJT3.K63.54.AQ8'));
    expect(evaluateHand(obs.hand).hcp).toBe(15);
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });

  it('answers RKCB for the declared long-heart fit even with only two hearts', () => {
    const obs = position('1NT P 2D P 2H P 3H P 4H P 4NT P', holding('KQJ52.K4.A32.A98'));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(5, 'D'));
  });

  it.each([12, 13, 14, 15, 16])('does not reverse 1H-1NT-2S with %i HCP', hcp => {
    const obs = position('1H P 1NT P', shaped([4, 5, 2, 2], hcp));
    expect(chooseBid(obs, 'sayc')).not.toEqual(bid(2, 'S'));
  });

  it.each([12, 13, 14])('minimum %i-HCP opener shows a four-card heart rather than rebidding 1NT', hcp => {
    expect(chooseBid(position('1C P 1D P', shaped([3, 4, 2, 4], hcp)), 'sayc')).toEqual(bid(1, 'H'));
  });

  it.each([10, 11, 12])('does not use an understrength %i-HCP 1D-2C game force', hcp => {
    expect(chooseBid(position('1D P', shaped([2, 3, 3, 5], hcp)), 'sayc')).not.toEqual(bid(2, 'C'));
  });

  it.each([13, 14, 15, 16, 17])('does not raise a five-card GF rebid with only two trumps at %i HCP', hcp => {
    const obs = position('1S P 2D P 2S P', shaped([2, 3, 6, 2], hcp));
    expect(chooseBid(obs, 'sayc')).not.toEqual(bid(4, 'S'));
    expect(chooseBid(obs, 'sayc').kind).not.toBe('pass');
  });

  it('shows minimum versus extra-strength support consistently in the default card', () => {
    for (const hcp of [12, 13, 14, 15, 16, 17]) {
      const obs = position('1S P 2H P', shaped([5, 3, 3, 2], hcp));
      expect(chooseBid(obs, 'sayc')).toEqual(bid(hcp < 15 ? 4 : 3, 'H'));
    }
  });

  it('uses a descriptive 12-21 GF 2NT rather than inventing an 18-19 jump range', () => {
    const obs = position('1S P 2D P', shaped([5, 3, 2, 3], 13));
    expect(chooseBid(obs, 'sayc')).toEqual(bid(2, 'NT'));
    expect(noTrumpRangeAt([...obs.auction, { seat: obs.seat, call: bid(2, 'NT') }], obs.auction.length, 'sayc')).toEqual({ min: 12, max: 21 });
  });

  it.each(['C', 'D', 'H', 'S'] as const)('places a publicly certain game after Michaels over 1%s', opened => {
    const hand = opened === 'S' ? shaped([2, 4, 4, 3], 17) : shaped([4, 2, 4, 3], 17);
    const obs = position(`1${opened} 2${opened} P`, hand);
    expect(chooseBid(obs, 'sayc')).toEqual(bid(4, opened === 'S' ? 'H' : 'S'));
  });
});

describe('v0.3.1 independently specified contextual tooltip meanings', () => {
  it.each([
    ['1S', '2C', '二阶自然争叫', '22+'],
    ['1S P P', '1NT', '11–14 HCP', 'SAYC 1NT争叫：15'],
    ['1H X P', '1S', '最低花色应叫', '5+张'],
    ['1H X P', '2H', '人工逼叫', 'Michaels'],
    ['1H 2C P', '2H', '支持性扣叫', '自然新花色'],
    ['2C P', '2D', '等待应叫', '4+张'],
    ['2C P 2D P', '2NT', '22–24 HCP', '18–19'],
    ['2C P 2D P 2H P', '3C', '第二次负应叫', '自然新花色'],
    ['1NT P 2C P', '2D', '否认四张高花', '4+张D'],
    ['1NT P 2C P', '2H', '4+张H', '5+张H'],
    ['1NT P 2H P', '2S', '转移接受', '自然再叫第二套'],
    ['2NT P 3D P', '3H', '转移接受', '5+张自然套'],
    ['2C P 2D P 2NT P 3H P', '3S', '转移接受', '自然竞争叫'],
    ['1NT P 2H P 2S P', '3NT', '转移后的3NT', '止张'],
    ['1NT P 2H P 2S P 3NT P', '4S', '3+张支持', '6+张'],
    ['1C P 1H P 1S P', '2D', '第四花色逼叫', '4+张D'],
    ['1H P 1NT P', '2S', '逆叫', '最低限'],
    ['1S P 2D P', '2S', '保证开叫时的5+张', '通常6+张'],
    ['1S P 2D P', '2NT', '12–21 HCP', '跳再叫2NT'],
    ['1S P 2H P', '3H', '慢到局', '最低限12–14'],
    ['1S P 2H P', '4H', '快到局', '15+ HCP'],
    ['2S P', '2NT', '特征问叫', '自然2NT'],
    ['2S P 2NT P', '3C', '旁门', '4+张C'],
    ['2D 2H', '2S', '逼叫一轮', '止叫'],
    ['1S P 3S P', '4NT', '约定S为将牌', '定量邀请'],
    ['1NT P 2NT P 3NT P', '4NT', '定量4NT', '1430'],
    ['1S P 3S P 4NT P', '5D', '0或3', '自然竞争'],
    ['1S P 3S P 4NT P 5C P', '5D', '将牌Q询问', '4+张'],
    ['1S P 3S P 4NT P 5C P 5D P', '5S', '否认Q', '六张'],
    ['1S P 3S P 4NT P 5C P 5D P', '6H', '将牌Q', '自然新花色'],
    ['1S P 3S P 4NT P 5C P', '5S', '签约', '有将牌Q'],
    ['1S P 3S P 4NT P 5S P', '5NT', '问K', '自然5NT'],
    ['1S P 3S P 4NT P 5S P 5NT P', '6C', 'CK', '自然竞争'],
    ['1S P 3S P 4NT P 5S P 5NT P', '6S', '没有旁门K', '6+张'],
    ['1C P', '2C', '5+张支持', '3+张支持'],
  ])('%s -> %s: correct role and promise', (prefix, token, required, forbidden) => {
    const text = meaning(prefix, token);
    expect(text).toContain(required); expect(text).not.toContain(forbidden);
  });
});

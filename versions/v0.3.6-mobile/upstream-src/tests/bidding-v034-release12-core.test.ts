import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { publicPlayerConstraints, publicCallMeaningAt, publicStrongMinorTrialAt } from '../src/ai/bidding-semantics';
import { feasiblePublicKeycardCounts, publicSupportMinimum } from '../src/ai/suit-evaluation';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS, partnerOf } from '../src/core/types';

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

describe('release12 public obligations and constructive continuations', () => {
  it.each([["773/7", "W", "Q7.KQT984.KQ86.4", "E:P S:1D W:1H N:1S E:2D S:4S", "P"], ["7301/6", "S", "QJ72.JT8752.95.A", "E:1D S:1H W:X N:2D E:4S", "P"], ["7535/9", "W", "K73.86.J9832.743", "W:P N:P E:2C S:2H W:3D N:P E:5D S:P", "P"], ["1017/11", "W", "KT.AKQJ643.QT8.4", "E:P S:P W:1H N:2H E:X S:2S W:3H N:3S E:P S:P", "4H"], ["958/10", "W", "AKJT7.3.AKQJ743.-", "S:P W:1S N:P E:1NT S:P W:2D N:P E:2S S:P", "3D"], ["4343/10", "N", "JT98.7632.AQJ5.7", "W:P N:P E:P S:1NT W:P N:2C E:P S:2D W:P", "2NT"], ["7268/7", "S", "6.KT84.6432.AJ43", "N:1NT E:P S:2C W:P N:2S E:P", "2NT"], ["4426/7", "N", "4.AKT8765.A.J863", "S:1S W:P N:1NT E:P S:2D W:P", "3H"], ["4487/8", "S", "AQ.KQJT432.974.9", "W:P N:1D E:P S:1H W:P N:1S E:P", "3H"], ["7771/11", "E", "-.K.KJ72.AKJT9853", "W:1S N:P E:2C S:P W:2S N:P E:3C S:P W:4S N:P", "5C"], ["7728/7", "S", "-.AKQT5.QJ93.KJT8", "N:1S E:P S:2H W:P N:3S E:P", "3NT"], ["818/12", "E", "AQ53.A854.642.76", "S:1C W:P N:P E:X S:P W:2C N:P E:2S S:P W:3D N:P", "3H"]])('%s respects strain, level and public game evidence', (_ref, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat as Seat, holding, prefix), 'sayc')).toEqual(call(expected));
  });
  it.each([["1187/6", "N", "QJ52.A.T975.AKJ8", "W:P N:1D E:2H S:3H W:P", "3NT"], ["615/7", "E", "43.KQ62.9.AQT742", "W:1NT N:P E:2C S:P W:2S N:P", "3C"], ["7702/11", "N", "A53.AQ974.JT754.-", "S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P", "4D"], ["7703/7", "E", "KQJT.3.4.AJT9742", "W:2NT N:P E:3C S:P W:3H N:P", "5C"], ["4534/11", "N", "AK982.A6.KQ84.Q2", "S:1H W:P N:1S E:P S:2C W:P N:2D E:P S:3NT W:P", "6NT"], ["4117/6", "S", "82.AKQ976.J642.6", "E:3C S:3H W:P N:3S E:P", "4H"], ["4125/12", "N", "KQJT95.AKQ98.8.A", "E:P S:P W:P N:1S E:P S:1NT W:P N:3H E:P S:4D W:P", "4S"], ["4167/11", "E", "AQT.JT.5.AJT8763", "W:P N:P E:1C S:1D W:1NT N:2C E:X S:2D W:P N:P", "3C"], ["4194/10 passed twelve cannot use the thirteen-point no-fit cue", "W", "K75.Q32.843.AQJ2", "S:P W:P N:P E:1C S:1D W:P N:P E:1S S:P", "P"]])( '%s keeps the reviewed public continuation', (_ref, seat, holding, prefix, expected) => {
    const obs = position(seat as Seat, holding, prefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call(expected));
  });
  it('keeps the bounded double-minor invitation separate from an ordinary five-card club suit', () => {
    const prefix = 'E:1H S:P W:1NT N:P E:2H S:P';
    const obs = position('W', 'KT.6.A9862.AJ762', prefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call('3C'));
    const partner = publicPlayerConstraints([...obs.auction, { seat: 'W', call: call('3C') }], 'W', 'sayc');
    expect(partner.suitMinimums.C).toBe(5);
    expect(partner.pointSources.some(source => !!source.minorInvitationShape)).toBe(true);
    expect(publicSupportMinimum('C', 3, partner)).toBeGreaterThanOrEqual(12);
    expect(chooseBid(position('W', 'K.96.A9862.AJ762', prefix), 'sayc')).not.toEqual(call('3C'));
  });
  it('does not use a thirteen-point unsupported diamond cue with a passed twelve-point hand', () => {
    const obs=position('W','K75.Q32.843.AQJ2','S:P W:P N:P E:1C S:1D W:P N:P E:1S S:P');
    expect(chooseBid(obs,'sayc')).toEqual(PASS);
    const cue=publicCallMeaningAt([...obs.auction,{seat:'W',call:call('2D')}],obs.auction.length,'sayc');
    expect(cue).toMatchObject({role:'cue',hcpRange:{min:13,max:40},forcing:'one-round'});
    expect(cue.supportRange).toBeUndefined();
    expect(publicPlayerConstraints(obs.auction,'E','sayc').hcpRange?.min).toBe(12);
  });
  it('keeps completed strong-NT denial in a truthful weak minor escape', () => {
    const obs = position('W', 'T8.Q543.A.K98432', 'N:2S E:2NT S:P W:3C N:P E:3D S:P');
    expect(chooseBid(obs, 'sayc')).toEqual(call('4C'));
    expect(publicCallMeaningAt([...obs.auction, { seat: 'W', call: call('4C') }], obs.auction.length, 'sayc'))
      .toMatchObject({ role: 'weak-minor-escape', forcing: 'none', suitMinimums: { C: 6 } });
  });
  it('keeps a good six-card NT defense when an outside honor raises HCP', () => {
    const prefix = 'N:1NT';
    for (const holding of ['8.K83.AJT6532.94', '8.K83.AJT6532.Q4']) {
      const obs = position('E', holding, prefix);
      expect(chooseBid(obs, 'sayc')).toEqual(call('2D'));
    }
    for (const holding of ['9.963.K92.AJT976', 'Q.963.K92.AJT976']) {
      const obs = position('E', holding, prefix);
      expect(chooseBid(obs, 'sayc')).toEqual(call('2C'));
    }
    const poor = position('E', 'Q.963.K92.A98654', prefix);
    expect(chooseBid(poor, 'sayc')).not.toEqual(call('2C'));
  });
  it('does not turn Unusual into a private NT or independent-major answer', () => {
    const obs = position('N', 'AJT3.T3.T7.AJ874', 'W:P N:P E:1C S:2NT W:P');
    const answer = chooseBid(obs, 'sayc');
    expect(answer.kind).toBe('bid');
    if (answer.kind === 'bid') expect(['D', 'H']).toContain(answer.strain);
    expect(chooseBid(position('S', 'QJT9875.T9.93.65', 'S:P W:1C N:2NT E:X'), 'sayc')).not.toEqual(call('3S'));
  });
  it('declines unsafe club keycards despite 33 support and all side controls', () => {
    const obs = position('E', 'AT7.KQT8.6.AKQ92', 'S:P W:1C N:P E:1H S:P W:1S N:P');
    expect(chooseBid(obs, 'sayc')).toEqual(call('5C'));
  });
});

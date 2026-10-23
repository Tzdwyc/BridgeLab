import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
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

describe('release8 public protocol and core priority', () => {
  it.each([
    ['known five-three hearts precede generic raw NT game', 'S', 'AQT98.AQ3.KQ6.43', 'N:1H E:P S:1S W:P N:2C E:P', '4H'],
    ['lead double does not abandon weak-minor relay', 'S', 'K85.Q765.AK.K976', 'S:1NT W:P N:2S E:X', '3C'],
    ['weak diamond requester corrects accepted club relay', 'N', '97.T9.JT7532.J85', 'S:1NT W:P N:2S E:X S:3C W:P', '3D'],
    ['weak club requester can stop accepted relay', 'N', '97.T9.J85.JT7532', 'S:1NT W:P N:2S E:X S:3C W:P', 'P'],
    ['natural NT overcaller answers actual Jacoby transfer', 'S', 'AQ8.KJ7.AJ4.QT93', 'E:1C S:1NT W:P N:2D E:P', '2H'],
    ['natural NT overcaller answers Stayman', 'S', 'AQ83.KJ7.AJ4.QT9', 'E:1C S:1NT W:P N:2C E:P', '2S'],
    ['seven-HCP Stayman responder must not promise eight-nine invite', 'S', 'Q653.J53.K96.J93', 'E:P S:P W:1C N:1NT E:P S:2C W:P N:2S E:P', 'P'],
    ['eleven-HCP Stayman fit reaches game instead of eight-nine invite', 'N', 'K85.T972.K85.AJ7', 'N:P E:P S:1NT W:P N:2C E:P S:2H W:P', '4H'],
    ['technical NT invitation is not a fresh Stayman platform', 'E', '853.AK62.AJ32.QT', 'N:1C E:X S:P W:2NT N:P', '3NT'],
    ['minimum technical doubler does not accept the same NT invitation', 'E', '852.AK62.AJ32.98', 'N:1C E:X S:P W:2NT N:P', 'P'],
    ['forced response cannot hide a known stopped raw NT game', 'S', 'Q985.Q8.AJ.AQJ72', 'S:1C W:2S N:3D E:P', '3NT'],
    ['NF after redouble does not mean stopping known raw26', 'S', '53.AK84.AJT75.QT', 'N:1S E:X S:XX W:P N:P E:2C S:2D W:P N:2NT E:P', '3NT'],
    ['eleven raw points with enemy club stop retain an NT invitation', 'E', 'J9.K752.A976.QJ4', 'E:P S:P W:1D N:P E:1H S:2C W:2H N:P', '2NT'],
    ['passed four clubs do not issue a five-club response', 'E', 'J54.K42.KQ4.J954', 'E:P S:P W:1D N:P', '1NT'],
    ['five spades do not claim quiet six instead of known seven-heart partscore', 'S', 'A6532.9.JT32.K74', 'E:P S:P W:P N:1H E:P S:1S W:P N:2H E:P', 'P'],
    ['GF raw floor resolves zero-three without an earlier NT', 'W', 'A9865.KQJ6.Q.KQ7', 'W:1S N:P E:2D S:P W:2H N:P E:4S S:P W:4NT N:P E:5D S:P', '5H'],
    ['queen answer uses responder own hand rather than future hidden Q', 'E', 'KJ7.AT5.KJ862.A8', 'W:1S N:P E:2D S:P W:2H N:P E:4S S:P W:4NT N:P E:5D S:P W:5H N:P', '5S'],
    ['confirmed queen denial stops five-spade contract', 'W', 'A9865.KQJ6.Q.KQ7', 'W:1S N:P E:2D S:P W:2H N:P E:4S S:P W:4NT N:P E:5D S:P W:5H N:P E:5S S:P', 'P'],
    ['support33 cannot resolve zero-three without a raw HCP floor', 'W', 'AQT3.5.AT92.K963', 'S:P W:1D N:P E:1S S:P W:3S N:P E:4C S:P W:4NT N:P E:5D S:P', '5S'],
    ['four own club keys without queen cannot cross safe stop on zero reply', 'S', 'A2.K72.A.AKJT987', 'N:1C E:P', '5C'],
    ['four own keys with queen safely ask despite zero being possible', 'S', 'A2.A2.A2.AQJT987', 'N:1C E:P', '4NT'],
    ['all five keys still need ten trumps for unknown-queen exception', 'S', 'A.A2.A432.AKJ986', 'N:1C E:P', '5C'],
    ['six trumps rebase the technical minor invitation and accept known30', 'N', 'K2.62.J75.T98642', 'W:P N:P E:2D S:X W:P N:3C E:P S:4C W:P', '5C'],
    ['accepted explicit minor invitation retains inviter own five-point surplus', 'S', 'AJ94.A.A86.AQJ73', 'W:P N:P E:2D S:X W:P N:3C E:P S:4C W:P N:5C E:P', '6C'],
    ['acceptance without a trump queen does not authorize a direct small slam', 'S', 'AJ94.A.AQ6.AJT73', 'W:P N:P E:2D S:X W:P N:3C E:P S:4C W:P N:5C E:P', 'P'],
    ['true five-five GF minors are described while retaining NT space', 'N', 'K8.5.KJT32.AKJT8', 'E:P S:1S W:P N:2D E:P S:2S W:P', '3C'],
    ['weak GF five-five hand returns five spades without crossing three NT', 'W', 'Q9642.2.A4.75432', 'E:1H S:P W:1S N:P E:3D S:P', '3S'],
    ['opener sixteen adjusted with confirmed four-four fit invites before second suit', 'W', '9.KQJ9.KT85.KJ74', 'S:P W:1D N:P E:1H S:1S', '3H'],
    ['strong cue advancer describes an honest four-card minor after minimum answer', 'W', 'K76.Q.AT73.AK852', 'S:1C W:P N:P E:X S:P W:2C N:P E:2S S:P', '3D'],
    ['natural six-point four-heart third suit precedes a six-card club misfit pass', 'N', 'KT762.K652.832.7', 'E:P S:1C W:P N:1S E:P S:2C W:P', '2H'],
    ['strong first response can correct a weak-preempt void to a real four-card minor', 'W', '-.AK954.Q874.AKJ4', 'N:P E:2S S:P W:3H N:P E:3S S:P', '4C'],
    ['conditional playing-source public floor retains known minor game', 'W', 'AKJ5.AKT7.Q43.32', 'N:2S E:3D S:P', '5D'],
  ] as const)('%s', (_, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat, holding, prefix), 'sayc')).toEqual(call(expected));
  });

  it('confirmed-fit support cue hover uses support points while preserving HCP', () => {
    const obs = position('S', 'J87.K653.QT8.A64', 'N:1H E:2D');
    const text = describeCall(obs.auction, 'S', call('3D'), 'sayc');
    expect(text).toContain('支持');
    expect(text).not.toContain('通常10+ HCP');
  });
  it('Precision shape answer uses its public singleton with a real four-four major', () => {
    const obs = position('S', 'QJ97.Q85.A76.Q64', 'N:2D E:P S:2NT W:P N:3H E:P');
    // Acting11 plus the published four-spade/short-diamond opener's14
    // supports is25. No actual opener hand is used by this decision.
    expect(chooseBid(obs, 'precision')).toEqual(call('4S'));
  });

  it('new partner length rebases a support source without repeating its shortness', () => {
    const source = { index: 5, type: 'support' as const, trump: 'C' as const,
      range: { min: 18, max: 40 }, sourceTrumpMinimum: 5, sourcePartnerTrumpMinimum: 3 };
    const constraints = { hcpRange: { min: 12, max: 40 }, supportRanges: { C: source.range },
      suitMinimums: { C: 5, D: 0, H: 0, S: 0 }, pointSources: [source] };
    expect(publicSupportMinimum('C', 3, constraints)).toBe(18);
    expect(publicSupportMinimum('C', 6, constraints)).toBe(21);
    expect(publicSupportMinimum('C', 6, { ...constraints, suitMinimums: { ...constraints.suitMinimums, C: 6 } })).toBe(21);
    expect(publicSupportMinimum('C', 6, { ...constraints, pointSources: undefined })).toBe(18);
  });
  it('a prior seventeen-HCP five-five description dominates a bare eighteen support declaration', () => {
    const own = { hcpRange: { min: 17, max: 40 }, supportRanges: { C: { min: 18, max: 40 } },
      suitMinimums: { S: 5, C: 5, H: 0, D: 0 } };
    // Even with only three partner clubs, any public five-five shape has
    // at least four shortness points, so the source floor is21, not18.
    expect(publicSupportMinimum('C', 3, own)).toBe(21);
  });
  it('a long-suit HCP alternative cannot borrow the ordinary five-card shape', () => {
    const compensation = { normalHcpMinimum: 10, minHcp: 7, suit: 'D' as const, minLength: 8 };
    const constraints = { hcpRange: { min: 7, max: 16 }, supportRanges: {},
      suitMinimums: { C: 0, D: 5, H: 0, S: 0 },
      pointSources: [{ index: 1, type: 'hcp' as const, range: { min: 7, max: 16 }, playingSourceCompensation: compensation }] };
    expect(publicSupportMinimum('D', 3, constraints)).toBe(11);
    expect(publicSupportMinimum('D', 2, constraints)).toBe(7);
    // A later genuine second five also constrains the same conditional
    // source. The normal five-five branch gives14; the eight-five weak
    // branch gives15. No partner cards choose between those possibilities.
    expect(publicSupportMinimum('H', 3, { ...constraints, suitMinimums: { ...constraints.suitMinimums, H: 5 } })).toBe(14);
  });
});

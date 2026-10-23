import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicControlCueAt, publicPlayerConstraints, noTrumpRangeAt } from '../src/ai/bidding-semantics';
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token, index) => ({ seat: seats[index % 4], call: token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));

describe('release15 completed strong-doubler NT transfer Pass explanation', () => {
  it('defines the seven-point Precision invitation without erasing the earlier negative upper bound', () => {
    const a = auction('1C P 1D P 1NT P 2NT');
    expect(noTrumpRangeAt(a, 6, 'precision')).toEqual({ min: 7, max: 7 });
    expect(publicCallMeaningAt(a, 6, 'precision')).toMatchObject({ defined: true, role: 'natural-nt', invitation: true, forcing: 'none', hcpRange: { min: 7, max: 7 } });
    expect(publicPlayerConstraints(a, 'S', 'precision').hcpRange).toEqual({ min: 7, max: 7 });
  });
  it('defines only the bounded spade-control try immediately after a real eight-card heart game', () => {
    const text = '2C P 2D P 2NT P 3D P 3H P 4D P 4H P 4S';
    const a = auction(text), m = publicCallMeaningAt(a, 14);
    expect(publicControlCueAt(a, 14)).toMatchObject({ trump: 'H', suit: 'S', postHeartGame: true, supportMinimum: 11 });
    expect(m).toMatchObject({ role: 'control-cue', artificial: true, forcing: 'one-round', agreedTrump: 'H', controlSuits: { S: 'first-or-second-round' } });
    expect(publicPlayerConstraints(a, 'S').suitMinimums).toMatchObject({ H: 5, D: 5 });
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ mustBid: true, forcing: 'one-round' });
    expect(analyzeAuctionSemantics(auction(text + ' P 5H'), 'S', 'sayc').mustBid).toBe(false);
    expect(publicControlCueAt(auction('1H P 1S P 2S P 4H P 4S'), 8)).toBeUndefined();
    expect(publicControlCueAt(auction('1H P 4H 4S'), 3)).toBeUndefined();
  });
  it('describes the actor as free to pass the completed natural transfer contract', () => {
    const a = auction('1D P P X 1H P P 1NT P 2D P 2H P');
    expect(analyzeAuctionSemantics(a, 'E', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    const m = publicCallMeaningAt([...a, { seat: 'E', call: { kind: 'pass' } }], a.length);
    expect(m).toMatchObject({ role: 'pass', forcing: 'none' });
    expect(m.description).toContain('本轮转移义务已完成');
    expect(describeCall(a, 'E', { kind: 'pass' }, 'sayc')).toContain('允许弱转移手停在自然高花部分定约');
  });
  it('still forbids an unanswered transfer and an independent game-force Pass', () => {
    const unanswered = auction('1D P P X 1H P P 1NT P 2D P');
    expect(describeCall(unanswered, 'W', { kind: 'pass' }, 'sayc')).toContain('不叫不符合当前逼叫状态');
    const game = auction('1H P 2D P 2H P');
    expect(describeCall(game, 'S', { kind: 'pass' }, 'sayc')).toContain('不叫不符合当前逼叫状态');
  });
});

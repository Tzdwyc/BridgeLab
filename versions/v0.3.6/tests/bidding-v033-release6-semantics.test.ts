import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, clearPublicMeaningCaches, isArtificialBidAt, naturalSuitMinimum,
  noTrumpRangeAt, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function auction(text: string): AuctionEntry[] {
  return text.split(' ').map((token, index) => ({ seat: seats[index % 4], call: token === 'P' ? { kind: 'pass' }
    : token === 'X' ? { kind: 'double' } : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
}
function meaning(text: string) {
  const calls = auction(text);
  return publicCallMeaningAt(calls, calls.length - 1);
}

describe('release6 exact-prefix semantic repairs', () => {
  it('Precision 13–15 NT opener receives a ten-to-eleven invitation while SAYC retains eight-to-nine', () => {
    const calls = auction('1NT P 2NT P');
    expect(noTrumpRangeAt(calls, 2, 'precision')).toEqual({ min: 10, max: 11 });
    expect(publicCallMeaningAt(calls, 2, 'precision')).toMatchObject({ hcpRange: { min: 10, max: 11 },
      invitation: true, intent: 'invitation', forcing: 'none' });
    expect(publicPlayerConstraints(calls, 'S', 'precision').hcpRange).toEqual({ min: 10, max: 11 });
    expect(noTrumpRangeAt(calls, 2, 'sayc')).toEqual({ min: 8, max: 9 });
    expect(publicCallMeaningAt(calls, 2, 'sayc')).toMatchObject({ hcpRange: { min: 8, max: 9 }, invitation: true });
  });
  it('Precision 1D retains its two-card opening promise without inventing an eight-card fit for five-card support', () => {
    const calls = auction('1D P');
    expect(naturalSuitMinimum(calls, 'N', 'D', 'precision')).toBe(2);
    expect(publicCallMeaningAt(calls, 0, 'precision')).toMatchObject({ suitMinimum: 2, suitMinimums: { D: 2 } });
    const constraints = publicPlayerConstraints(calls, 'N', 'precision');
    expect(constraints.suitMinimums.D).toBe(2);
    expect(constraints.lengthSources).toContainEqual({ index: 0, suit: 'D', minimum: 2 });
    expect(constraints.suitMinimums.D + 5).toBe(7);
    expect(naturalSuitMinimum(calls, 'N', 'D', 'sayc')).toBe(3);
    expect(publicCallMeaningAt(calls, 0, 'sayc').suitMinimum).toBe(3);
  });
  it.each(['1C P 3NT', '1D P 3NT'])('first minor-opening 3NT response retains the uncapped stronger NT-suitable fallback: %s', prefix => {
    const calls = auction(prefix), call = meaning(prefix);
    expect(noTrumpRangeAt(calls, 2, 'sayc')).toEqual({ min: 13, max: 40 });
    expect(call).toMatchObject({ role: 'natural-nt', hcpRange: { min: 13, max: 40 },
      suitMaximums: { H: 3, S: 3 }, intent: 'signoff', forcing: 'none' });
    expect(call.suitMinimums).toEqual({});
    expect(call.description).toContain('通常13–15、无四张高花');
    expect(publicPlayerConstraints(calls, 'S')).toMatchObject({ hcpRange: { min: 13, max: 40 },
      suitMinimums: { H: 0, S: 0 }, suitMaximums: { H: 3, S: 3 } });
  });
  it('7677: technical doubler accepts a jump invitation without a weak overcall-raise range', () => {
    const calls = auction('1S P P X P 3H P 4H');
    expect(publicCallMeaningAt(calls, 5)).toMatchObject({ role: 'takeout-minimum-response',
      hcpRange: { min: 9, max: 11 }, suitMinimum: 4, invitation: true });
    const acceptance = publicCallMeaningAt(calls, 7);
    expect(acceptance).toMatchObject({ role: 'natural-support', intent: 'signoff', forcing: 'none' });
    expect(acceptance.supportRange).toBeUndefined();
    expect(acceptance.hcpRange).toBeUndefined();
    expect(acceptance.description).toContain('接受同伴9–11 HCP自然跳应叫邀请');
    expect(publicPlayerConstraints(calls, 'W').hcpRange).toEqual({ min: 9, max: 40 });
  });
  it('a genuine simple overcall raise retains its own six-to-nine support range', () => {
    expect(meaning('1D 1H P 2H')).toMatchObject({ supportRange: { trump: 'H', min: 6, max: 9 } });
  });
  it('7521: Stayman answer in the enemy opening suit remains a natural four-card contract', () => {
    const calls = auction('1H 1NT P 2C X 2H P');
    expect(isArtificialBidAt(calls, 5)).toBe(false);
    expect(publicCallMeaningAt(calls, 5)).toMatchObject({ role: 'stayman-answer', artificial: false,
      suitMinimum: 4, forcing: 'none' });
    expect(analyzeAuctionSemantics(calls, 'W', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none', currentContractArtificial: false });
    expect(meaning('1H 1NT P 2C X 2H P 3H')).toMatchObject({ suitMinimum: 4, hcpRange: { min: 8, max: 9 },
      invitation: true, forcing: 'none' });
    expect(publicPlayerConstraints(calls, 'E').suitMinimums.H).toBe(4);
  });
  it.each(['P P 1H P 2D P', 'P P 1D P 2C P'])('4559/2695: passed-hand new suit gives opener distinct minimum and stronger NT ranges: %s', prefix => {
    const minimum = auction(`${prefix} 2NT`), game = auction(`${prefix} 3NT`);
    expect(noTrumpRangeAt(minimum, 6, 'sayc')).toEqual({ min: 12, max: 14 });
    expect(noTrumpRangeAt(game, 6, 'sayc')).toEqual({ min: 15, max: 21 });
    expect(publicCallMeaningAt(game, 6)).toMatchObject({ hcpRange: { min: 15, max: 21 }, forcing: 'none' });
    expect(publicPlayerConstraints(game, 'S').hcpRange).toEqual({ min: 15, max: 21 });
  });
  it('7170: competitive opener supports a five-card free response with three cards; quiet support promises four', () => {
    const calls = auction('1C 2H 2S P 3S');
    expect(publicCallMeaningAt(calls, 2)).toMatchObject({ suitMinimum: 5 });
    expect(naturalSuitMinimum(calls, 'N', 'S', 'sayc')).toBe(3);
    expect(publicCallMeaningAt(calls, 4)).toMatchObject({ suitMinimum: 3, forcing: 'none' });
    expect(publicPlayerConstraints(calls, 'N').suitMinimums.S).toBe(3);
    expect(meaning('1C P 1S P 3S')).toMatchObject({ suitMinimum: 4, supportRange: { trump: 'S', min: 16, max: 18 } });
  });
  it.each([
    ['1D X P 1H P 2H', 16, 18, false],
    ['1D X P 1H P 3H', 19, 21, false],
    ['2D X P 2H P 3H', 18, 20, false],
    ['1D X 1S 2H P 3H', 16, 18, true],
  ] as const)('technical-double support invitations retain band and public point type: %s', (prefix, min, max, fit) => {
    const call = meaning(prefix);
    expect(call).toMatchObject({ role: 'takeout-support-invitation', suitMinimum: 4, invitation: true, forcing: 'none' });
    expect(call.hcpRange).toEqual(fit ? undefined : { min, max });
    expect(call.supportRange).toEqual(fit ? { trump: 'H', min, max } : undefined);
  });
  it('cached prefixes reproduce the same repaired semantics and are independent of later calls', () => {
    const calls = auction('1H 1NT P 2C X 2H P 3H');
    clearPublicMeaningCaches();
    const cold = calls.map((_, index) => publicCallMeaningAt(calls, index));
    expect(calls.map((_, index) => publicCallMeaningAt(calls, index))).toEqual(cold);
    expect(publicCallMeaningAt([...calls, { seat: 'N', call: { kind: 'bid', level: 4, strain: 'H' } }], 5)).toEqual(cold[5]);
  });
});

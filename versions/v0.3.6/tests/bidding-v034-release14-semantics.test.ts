import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token, index) => ({ seat: seats[index % 4], call: token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
const meaning = (text: string) => { const a = auction(text); return publicCallMeaningAt(a, a.length - 1); };

describe('release14 forcing scope and natural-answer sources', () => {
  it('ends a strong-doubler transfer round when the natural NT platform accepts it', () => {
    const a = auction('1D P P X 1H P P 1NT P 2D P 2H P');
    expect(analyzeAuctionSemantics(a, 'E', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
  });
  it('retains four cards when the Stayman other-major inviter raises genuine four-card support to game', () => {
    const a = auction('1NT P 2C P 2H P 2S P 3S P 4S');
    expect(publicCallMeaningAt(a, 10).suitMinimum).toBe(4);
    expect(publicPlayerConstraints(a, 'S').suitMinimums.S).toBe(4);
  });
  it('publishes the bounded weak-two four-card correction with original-major shortness', () => {
    const a = auction('2S P 3D P 3S P 4C');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ suitMinimum: 4, suitMaximums: { S: 1 }, forcing: 'none' });
    expect(publicPlayerConstraints(a, 'S')).toMatchObject({ suitMinimums: { C: 4, D: 5 }, suitMaximums: { S: 1 } });
  });
  it('defines the first natural minor after a strength double under an independent game force', () => {
    const a = auction('1H 2H X 2S 3S X 4D');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ defined: true, role: 'responder-second-suit', suitMinimum: 5, hcpRange: { min: 10, max: 40 }, forcing: 'game' });
    expect(publicPlayerConstraints(a, 'S').suitMinimums.D).toBe(5);
    expect(analyzeAuctionSemantics(a, 'N', 'sayc').forcing).toBe('game');
  });
  it('releases an ordinary support-cue round when intervention raises the minimum trump answer to game', () => {
    const a = auction('P 1D P 1S 2H P 3D 3S');
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    expect(analyzeAuctionSemantics(auction('P 1D P 1S 2H P 3D'), 'N', 'sayc').forcing).toBe('one-round');
    expect(analyzeAuctionSemantics(auction('1H 2H X 2S 3S 4C'), 'S', 'sayc').forcing).toBe('game');
  });
  it('never assigns the other partnership the strong-club negative Pass obligation', () => {
    const a = auction('2C P 2D P 2H 2S P P 3D');
    expect(analyzeAuctionSemantics(a, 'E', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    expect(meaning('2C P 2D P 2H 2S P P 3D 3S').description).not.toContain('履行本轮应叫义务');
  });
  it('does not reinterpret a minimum answer to a stopper cue as an opener reverse', () => {
    const a = auction('1C 1D 2D P 2S P');
    expect(analyzeAuctionSemantics(a, 'S', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    expect(meaning('1C 1D 2D P 2S P 3C').description).not.toContain('17+逆叫');
    expect(meaning('1C 1D 2D P 2S').hcpRange?.min).toBe(12);
  });
  it('shows extra support strength for a voluntary four-minor jump even while answering a one-round cue', () => {
    expect(meaning('1H 2C P 2H X 4C')).toMatchObject({ supportRange: { trump: 'C', min: 16, max: 40 }, invitation: true, forcing: 'none' });
    expect(meaning('1H 2C P 2H X 3C').invitation).toBe(false);
  });
  it('keeps one public forcing state for bounded long-minor compensation opposite a three-major preempt', () => {
    const m = meaning('3S P 4C');
    expect(m).toMatchObject({ hcpRange: { min: 13, max: 40 }, suitMinimum: 5, forcing: 'one-round',
      playingSourceCompensation: { normalHcpMinimum: 15, minHcp: 13, minLength: 6,
        maxOtherSuitLength: { suit: 'S', max: 1 } } });
    expect(m.suitMaximums).toBeUndefined();
    expect(meaning('3S P 5C').playingSourceCompensation).toBeUndefined();
    expect(meaning('3D P 4C').playingSourceCompensation).toBeUndefined();
    expect(analyzeAuctionSemantics(auction('3S P 4C P 4S'), 'S', 'sayc').mustBid).toBe(false);
  });
});

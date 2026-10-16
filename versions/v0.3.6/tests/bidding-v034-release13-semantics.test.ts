import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints, publicNoTrumpQuestionAt } from '../src/ai/bidding-semantics';
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token, index) => ({ seat: seats[index % 4], call: token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
const meaning = (text: string) => { const a = auction(text); return publicCallMeaningAt(a, a.length - 1); };
describe('release13 public source and obligation continuity', () => {
  it('minimum original-minor response to a reverse is a weak preference, not five-card support', () => {
    const a = auction('1D P P 1S 2H P 3D');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ suitMinimum: 2, forcing: 'none', hcpRange: { min: 0, max: 40 } });
    expect(publicPlayerConstraints(a, 'S').suitMinimums.D).toBe(2);
  });
  it('negative-double four-card support has a real voluntary jump invitation, not a minimum raise', () => {
    expect(meaning('1D 1H X P 1S P 3S')).toMatchObject({ suitMinimum: 4,
      supportRange: { trump: 'S', min: 10, max: 12 }, invitation: true, forcing: 'none' });
    expect(meaning('1D 1H X P 1S P 2S').invitation).toBe(false);
  });
  it('bounds the quiet second-minor repeat to an honest sixteen-to-eighteen five-five invitation', () => {
    const m = meaning('1D P 1S P 2C P 2S P 3C');
    expect(m).toMatchObject({ hcpRange: { min: 16, max: 18 }, suitMinimums: { C: 5, D: 5 }, forcing: 'none', invitation: true });
    expect(meaning('1D P 1S 2H 3C P 3S P 4C').invitation).toBe(false);
  });
  it('keeps a forced weak reverse NT answer separate from an invitational point window', () => {
    const m = meaning('1D X P 1NT 2S P 2NT');
    expect(m).toMatchObject({ hcpRange: { min: 0, max: 40 }, forcing: 'none', intent: 'answer' });
    expect(m.description).toContain('不是Ingberman');
  });
  it('bounds the opener cue after a two-suit-strength double to fifteen raw and game forcing', () => {
    expect(meaning('1H 2H X 2S 3S')).toMatchObject({ hcpRange: { min: 15, max: 21 }, forcing: 'game' });
  });
  it('does not mistake an enemy-suit cue answer for a capped fourth-suit minimum', () => {
    // Unsupported3S now promises13 raw; opener12 may give the requested stopper
    // and place3NT without inventing a15-point voluntary-jump minimum.
    expect(meaning('1D P 1H 1S 2C 2S 3S')).toMatchObject({role:'cue',hcpRange:{min:13,max:40}});
    expect(meaning('1D P 1H 1S 2C 2S 3S P 3NT').hcpRange).toEqual({ min: 12, max: 21 });
    expect(meaning('1D P 1S P 2C P 2H P 2NT').hcpRange).toEqual({ min: 12, max: 14 });
  });
  it('keeps the three-card support cue rather than a weak two-card preference', () => {
    const m = meaning('1D 2C P 2D P 2H P 3C');
    expect(m.role).toBe('support-cue-continuation'); expect(m.suitMinimum).toBeGreaterThanOrEqual(3);
    expect(m.description).toContain('10+调整支持点');
  });
  it('reads a preceding four-minor six-card source when describing game support', () => {
    const a = auction('1C 2NT P 3H 4C P 5C');
    expect(publicPlayerConstraints(a.slice(0, 6), 'N').suitMinimums.C).toBe(6);
    expect(meaning('1C 2NT P 3H 4C P 5C').description).toContain('搭档公开6张');
  });
  it('combines five-card responder clubs with the retained original three-card opening rather than requiring six', () => {
    expect(meaning('1C P 1H P 1NT P 5C')).toMatchObject({ suitMinimum: 5, forcing: 'none' });
    expect(meaning('1NT P 2C P 2D P 5C').suitMinimum).toBe(6);
  });
  it('retains the original-seven alternative after an intermediate competitive repeat', () => {
    expect(meaning('1C P 1S 2D 3C 3D 3S P 4C').playingSourceCompensation).toMatchObject({ normalHcpMinimum: 16, minHcp: 12, minLength: 7 });
  });
  it('lets a weak waiting responder make the agreed negative Pass after interference', () => {
    const a = auction('2C P 2D P 3D 3H P');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'strong-club-negative-pass', hcpRange: { min: 0, max: 3 } });
    expect(analyzeAuctionSemantics([...a, { seat: 'W', call: { kind: 'pass' } }], 'N', 'sayc').mustBid).toBe(true);
    expect(analyzeAuctionSemantics(auction('2C P 2D P 3D 3H P P 4D P'), 'S', 'sayc').mustBid).toBe(false);
  });
  it('requires four-card support when declining the other-major Stayman invitation', () => {
    expect(meaning('1NT P 2C P 2H P 2S P 3S')).toMatchObject({ suitMinimum: 4, forcing: 'none' });
  });
  it('uses true strong-doubler NT as a new platform, but not the forced 6–10 NT answer', () => {
    const a = auction('1D P P X 1H P P 1NT P 2D');
    expect(publicNoTrumpQuestionAt(a, 9)?.kind).toBe('transfer');
    expect(publicNoTrumpQuestionAt(auction('1S X P 1NT P 2D'), 5)).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, isArtificialBidAt, isBalancedNoTrumpAt, naturalSuitMinimum,
  noTrumpRangeAt, publicCallMeaningAt, publicControlCueAt, publicKeycardTrumpAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function auction(text: string): AuctionEntry[] {
  return text.split(' ').map((token, index) => ({ seat: seats[index % 4], call: token === 'P' ? { kind: 'pass' }
    : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
}
const meaning = (text: string) => { const a = auction(text); return publicCallMeaningAt(a, a.length - 1); };

describe('release7 public context distinctions', () => {
  it.each([
    ['1H P 1S P 2H', 5, 6], ['1C P 1S P 2C', 3, 5], ['1C P 1S P 2C P 2S', 4, 5],
    ['1C 1D 1S P 2C', 3, 4],
  ] as const)('first repeat separates previous and new length: %s', (prefix, previous, current) => {
    const m = meaning(prefix);
    expect(m).toMatchObject({ priorSuitMinimum: previous, suitMinimum: current });
    expect(m.description).toContain(`本次进一步显示${current}+张`);
    expect(m.description).not.toContain(`保留此前公开${current}张`);
  });
  it('later minimum repeat retains the already shown length', () => {
    expect(meaning('1C P 1S P 2C P 2H P 3C').description).toContain('保留此前公开5张');
  });
  it.each(['1NT P 2H P 2S P 3NT', '1NT P 2D P 2H P 3NT'])('transferer game offer preserves its five-major source: %s', prefix => {
    const m = meaning(prefix);
    expect(m.role).toBe('natural-nt');
    expect(m.suitMinimums[prefix.includes('2S') ? 'S' : 'H']).toBe(5);
    expect(m.description).toContain('同伴有三张以上');
  });
  it.each(['1NT P 2H P 2S P 3NT P 4S', '1NT P 2D P 2H P 3NT P 4H'])('NT return to transferred major is support, not own long suit: %s', prefix => {
    const m = meaning(prefix);
    expect(m).toMatchObject({ role: 'natural-support', suitMinimum: 3, intent: 'signoff', forcing: 'none' });
    expect(m.description).toContain('本次进一步显示三张以上支持');
    expect(m.description).not.toContain('自己的长套');
  });
  it('cheapest competitive 3H and genuine jump 3H have different strength promises', () => {
    const minimum = meaning('1H 2S 3H'), jump = meaning('1H 1S 3H');
    expect(minimum).toMatchObject({ invitation: false, supportRange: { trump: 'H', min: 6, max: 40 } });
    expect(jump).toMatchObject({ invitation: true, supportRange: { trump: 'H', min: 10, max: 12 } });
  });
  it('Michaels plus enemy 2S makes 3H the minimum natural choice', () => {
    const m = meaning('1C 2C 2S 3H');
    expect(m).toMatchObject({ role: 'two-suit-choice', suitMinimum: 1, invitation: false });
    expect(m.supportRange).toBeUndefined();
    expect(m.description).toContain('当前最低合法支持回答');
  });
  it('other-major Stayman invitation has explicit NT rejection and acceptance ranges', () => {
    const low = auction('1NT P 2C P 2H P 2S P 2NT'), high = auction('1NT P 2C P 2H P 2S P 3NT');
    expect(noTrumpRangeAt(low, 8, 'sayc')).toEqual({ min: 15, max: 16 });
    expect(noTrumpRangeAt(high, 8, 'sayc')).toEqual({ min: 17, max: 17 });
    expect(publicCallMeaningAt(low, 8)).toMatchObject({ invitation: false, intent: 'signoff', forcing: 'none' });
    expect(publicCallMeaningAt(low, 8).description).toContain('拒绝邀请');
    expect(publicCallMeaningAt(high, 8).description).toContain('接受邀请');
  });
  it('semiNT second-suit quantitative continuation never becomes a 20-HCP opening', () => {
    const a = auction('1H P 1NT P 2D P 2NT P 3NT');
    expect(noTrumpRangeAt(a, 6, 'sayc')).toEqual({ min: 10, max: 12 });
    expect(noTrumpRangeAt(a, 8, 'sayc')).toEqual({ min: 15, max: 21 });
    expect(publicPlayerConstraints(a, 'N').hcpRange).toEqual({ min: 15, max: 21 });
  });
  it.each(['1NT P 2NT P 3NT', '1NT P 2C P 2S P 2NT P 3NT'])('NT invitation acceptance retains actual opening upper limit: %s', prefix => {
    const a = auction(prefix);
    expect(noTrumpRangeAt(a, a.length - 1, 'sayc')).toEqual({ min: 17, max: 17 });
    expect(meaning(prefix).description).toContain('保留此前均型');
  });
  it('weak-two feature denial is a minimum/no-feature answer, not an invitation', () => {
    const m = meaning('2D P 2NT P 3D');
    expect(m).toMatchObject({ role: 'natural-repeat', suitMinimum: 6, forcing: 'none', invitation: false });
    expect(m.description).toContain('没有可展示的旁门A/K特征');
  });
  it('weak-two feature answer shows a high-limit honor, not a natural four-card side suit', () => {
    expect(meaning('2D P 2NT P 3H')).toMatchObject({ role: 'weak-feature-answer', artificial: true,
      hcpRange: { min: 9, max: 11 }, controlSuits: { H: 'first-or-second-round' } });
    expect(meaning('2D P 2NT P 3H').suitMinimums.H).toBeUndefined();
  });
  it('weak-two opener supports a forcing new major with three, not quiet four', () => {
    const a = auction('2D P 2H P 3H');
    expect(naturalSuitMinimum(a, 'N', 'H', 'sayc')).toBe(3);
    expect(meaning('2D P 2H P 3H')).toMatchObject({ role: 'natural-support', suitMinimum: 3, invitation: false });
  });
  it('weak-two minor raise does not inherit ordinary one-minor five-card support', () => {
    expect(meaning('2D P 3D')).toMatchObject({ suitMinimum: 3, invitation: false });
    expect(meaning('2D P 5D').suitMinimum).toBe(2);
    expect(meaning('2H P 4H').suitMinimum).toBe(2);
    expect(meaning('1D P 3D')).toMatchObject({ suitMinimum: 5, invitation: true, supportRange: { trump: 'D', min: 10, max: 12 } });
  });
  it('three-level preempt raw point floor survives its original-suit repeat', () => {
    const a = auction('3D P 3H P 4D P');
    expect(publicCallMeaningAt(a, 0)).toMatchObject({ hcpRange: { min: 5, max: 10 }, suitMinimum: 7 });
    expect(publicPlayerConstraints(a, 'N')).toMatchObject({ hcpRange: { min: 5, max: 10 }, suitMinimums: { D: 7 } });
    expect(publicPlayerConstraints(a, 'N').pointSources).toContainEqual({ index: 0, type: 'hcp', range: { min: 5, max: 10 } });
  });
  it('four-level SAYC preempt uses its actual five-to-ten opening promise', () => {
    expect(meaning('4H')).toMatchObject({ hcpRange: { min: 5, max: 10 }, suitMinimum: 8 });
    expect(publicPlayerConstraints(auction('4H'), 'N').hcpRange).toEqual({ min: 5, max: 10 });
    expect(publicCallMeaningAt(auction('3D'), 0, 'precision').hcpRange).toEqual({ min: 6, max: 10 });
  });
  it('latest natural heart game overrides an earlier spade fit for RKCB', () => {
    const a = auction('1S P 2H P 3H P 3S P 4H P 4NT P');
    expect(publicControlCueAt(a, 8)).toBeUndefined();
    expect(isArtificialBidAt(a, 8)).toBe(false);
    expect(publicKeycardTrumpAt(a, 10, 'sayc')).toBe('H');
    expect(publicCallMeaningAt(a, 10)).toMatchObject({ role: 'keycard-ask', agreedTrump: 'H' });
  });
  it('enemy heart game does not erase our artificial three-spade support cue of five hearts', () => {
    const a = auction('1S 2H 3H 3S 4H 4NT');
    expect(publicCallMeaningAt(a, 3)).toMatchObject({ role: 'cue', artificial: true, suitMinimums: { H: 3 } });
    expect(isArtificialBidAt(a, 5)).toBe(true);
    expect(publicKeycardTrumpAt(a, 5, 'sayc')).toBe('H');
    expect(publicCallMeaningAt(a, 5)).toMatchObject({ role: 'keycard-ask', agreedTrump: 'H' });
  });
  it('successive artificial controls retain the supported major for the keycard question', () => {
    const a = auction('1H P 2C P 2H P 3H P 4C P 4D P 4NT');
    expect(publicKeycardTrumpAt(a, 12, 'sayc')).toBe('H');
    expect(publicCallMeaningAt(a, 12).agreedTrump).toBe('H');
  });
  it('minor jump invitation floor survives later competitive support', () => {
    const a = auction('1C 1D 3C 3D 4C');
    expect(publicCallMeaningAt(a, 2)).toMatchObject({ invitation: true, supportRange: { trump: 'C', min: 10, max: 12 } });
    expect(publicPlayerConstraints(a, 'S').supportRanges.C).toEqual({ min: 10, max: 12 });
  });
  it('post-RKCB six-club contract is a small slam', () => {
    expect(meaning('1D P 1S P 2C P 4NT P 5C P 6C').description).toContain('小满贯');
  });
  it('first six-major support after 2/1 keycards is not a minimum twelve-to-fourteen fast arrival', () => {
    const m = meaning('1S P 2H P 4NT P 5C P 6H');
    expect(m.description).toContain('小满贯');
    expect(m.hcpRange).toBeUndefined();
    expect(meaning('1S P 2H P 4NT P 5C P 7H').description).toContain('大满贯');
  });
  it('explicit minor slam try establishes RKCB ahead of earlier natural NT', () => {
    const a = auction('1C 3S 3NT P 4C P 4NT');
    expect(publicCallMeaningAt(a, 4)).toMatchObject({ role: 'minor-slam-try', hcpRange: { min: 16, max: 21 }, suitMinimum: 6 });
    expect(naturalSuitMinimum(a.slice(0, 5), 'N', 'C', 'sayc')).toBe(6);
    expect(publicKeycardTrumpAt(a, 6, 'sayc')).toBe('C');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'keycard-ask', agreedTrump: 'C', suitMinimums: { C: 2 } });
    expect(meaning('1C 3S 3NT P 4C P 4NT P 5D').role).toBe('keycard-answer');
  });
  it('natural new minor over a strong balanced NT rebid has its own four-card game-force context', () => {
    const a = auction('1C P 1H P 2NT P 3D');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'responder-second-suit', suitMinimum: 4,
      hcpRange: { min: 10, max: 40 }, forcing: 'game', artificial: false });
    expect(naturalSuitMinimum(a, 'S', 'D', 'sayc')).toBe(4);
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ forcing: 'game', mustBid: true });
  });
  it('technical doubler answering a forcing cue announces three natural cards without free-17 extras', () => {
    const a = auction('2D X P 3D P 3S');
    expect(publicCallMeaningAt(a, 5)).toMatchObject({ suitMinimum: 3, intent: 'answer' });
    expect(publicCallMeaningAt(a, 5).hcpRange).toEqual({ min: 12, max: 40 });
    expect(publicPlayerConstraints(a, 'E').suitMinimums.S).toBe(3);
  });
  it('technical minimum-four-minor invitation publishes a broad support floor and separate HCP', () => {
    const a = auction('2S X P 3C P 4C');
    expect(publicCallMeaningAt(a, 5)).toMatchObject({ role: 'takeout-minor-invitation', suitMinimum: 5,
      supportRange: { trump: 'C', min: 18, max: 40 }, invitation: true, forcing: 'none' });
    // Approved short-enemy/all-unbid-four compensation is a real 12-HCP
    // alternative to the ordinary 13-HCP weak-two takeout shape.
    expect(publicPlayerConstraints(a, 'E')).toMatchObject({ hcpRange: { min: 12, max: 40 },
      supportRanges: { C: { min: 18, max: 40 } } });
  });
  it('ordinary quiet opener strong NT rebid after minor response is explicitly balanced', () => {
    const a = auction('1D P 1NT P 2NT');
    expect(isBalancedNoTrumpAt(a, 4)).toBe(true);
    expect(publicCallMeaningAt(a, 4).suitMinimums).toEqual({ C: 2, D: 2, H: 2, S: 2 });
  });
  it('Rule20 is an opening-shape constraint, not a fabricated 13-HCP NT floor', () => {
    expect(publicPlayerConstraints(auction('1D P'), 'N')).toMatchObject({ ruleOf20Opening: true, hcpRange: { min: 12, max: 21 } });
    expect(publicPlayerConstraints(auction('1D P'), 'N', 'precision').ruleOf20Opening).toBeUndefined();
  });
  it('ordinary overcall advance retains normal eight but publishes conservative seven for the bounded eight-card compensation', () => {
    const a = auction('P P 1D 2C P 2S');
    expect(publicPlayerConstraints(a, 'E')).toMatchObject({ hcpRange: { min: 7, max: 40 }, suitMinimums: { S: 5 } });
    expect(publicCallMeaningAt(a, 5).playingSourceCompensation).toMatchObject({ normalHcpMinimum: 8, minHcp: 7, minLength: 8 });
  });
  it.each([
    ['P P P 1C P P 1D 1H 2C 2H', 4, 9],
    ['P P P 1D 1H P 2H 2S 3H 3S', 4, 40],
    ['1H P P X P 2C P 2S P 3S', 3, 40],
  ] as const)('first constructive natural support exposes a real point floor: %s', (prefix, length, upper) => {
    const m = meaning(prefix);
    expect(m).toMatchObject({ suitMinimum: length, invitation: false, supportRange: { min: 6, max: upper } });
  });
  it('strength X of Unusual 2NT does not become a negative-double 17-HCP opener answer', () => {
    const a = auction('1S 2NT X 3C 3NT');
    expect(publicCallMeaningAt(a, 2).hcpRange?.min).toBe(10);
    expect(noTrumpRangeAt(a, 4, 'sayc')).toBeUndefined();
    expect(publicCallMeaningAt(a, 4).hcpRange?.min).toBe(15);
  });
  it('enemy game removes an ordinary negative-X answer obligation without erasing the asked major', () => {
    const a = auction('P 1D 1S X 4S');
    expect(analyzeAuctionSemantics(a, 'E', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    expect(publicPlayerConstraints(a, 'W').suitMinimums.H).toBe(4);
    expect(analyzeAuctionSemantics(auction('P 1D 1S X P'), 'E', 'sayc')).toMatchObject({ mustBid: true, convention: 'negative-double' });
  });
  it('enemy game releases ordinary fourth-suit F1 but retains an existing 2/1 game force', () => {
    const ordinary = auction('1C P 1H P 1S P 2D 3NT');
    expect(analyzeAuctionSemantics(ordinary, 'N', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none', currentContractArtificial: false });
    const priorGF = auction('1S P 2H P 3C P 3D 4S');
    expect(analyzeAuctionSemantics(priorGF, 'N', 'sayc')).toMatchObject({ mustBid: true, forcing: 'game' });
  });
  it('passed-hand new major is NF and permits a five-card original-major return', () => {
    const a = auction('P P 1S P 2H P 2S');
    expect(meaning('P P 1S P 2H')).toMatchObject({ hcpRange: { min: 10, max: 12 }, forcing: 'none' });
    expect(naturalSuitMinimum(a, 'S', 'S', 'sayc')).toBe(5);
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ suitMinimum: 5, priorSuitMinimum: 5, forcing: 'none' });
  });
  it('weak escape after a redoubled takeout auction carries no ordinary eight-point new-suit promise', () => {
    const a = auction('P 1D X XX P P 1S X 2C');
    expect(publicCallMeaningAt(a, 8)).toMatchObject({ role: 'weak-doubled-escape', suitMinimum: 4,
      hcpRange: { min: 0, max: 40 }, forcing: 'none', artificial: false });
    expect(publicPlayerConstraints(a, 'N').suitMinimums.C).toBe(4);
    expect(publicPlayerConstraints(a, 'S').suitMinimums.C).toBe(0);
  });
  it('below-game control cue retains agreed major and no natural side-suit length', () => {
    const a = auction('1H P 2C P 2H P 3H P 4C');
    expect(publicControlCueAt(a, 8)).toMatchObject({ trump: 'H', suit: 'C', continuation: false });
    expect(isArtificialBidAt(a, 8)).toBe(true);
    const m = publicCallMeaningAt(a, 8);
    expect(m).toMatchObject({ role: 'control-cue', agreedTrump: 'H', forcing: 'game', controlSuits: { C: 'first-or-second-round' } });
    expect(m.suitMinimums.C).toBeUndefined();
    expect(analyzeAuctionSemantics(a, 'S', 'sayc')).toMatchObject({ mustBid: true, convention: 'control-cue', forcing: 'game' });
    const reply = auction('1H P 2C P 2H P 3H P 4C P 4D');
    expect(publicControlCueAt(reply, 10)).toMatchObject({ trump: 'H', continuation: true });
    expect(publicPlayerConstraints(reply, 'S').controlSuits).toEqual({ D: 'first-or-second-round' });
  });
  it('late three-card heart preference does not fabricate the eighth trump for control cue', () => {
    const a = auction('1C P 1H P 2S P 2NT P 3H P 4C');
    expect(publicPlayerConstraints(a.slice(0, 10), 'N').suitMinimums.H).toBe(3);
    expect(publicControlCueAt(a, 10)).toBeUndefined();
  });
  it('Jacoby shortness retains the original major for a different side-suit control', () => {
    const a = auction('1H P 2NT P 3S P 4D');
    expect(publicControlCueAt(a, 6)).toMatchObject({ trump: 'H', suit: 'D', supportMinimum: 17 });
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'control-cue', agreedTrump: 'H',
      supportRange: { trump: 'H', min: 17, max: 40 } });
    expect(publicPlayerConstraints(a, 'N').controlSuits).toEqual({ S: 'first-or-second-round' });
  });
  it('confirmed-fit support cue retains adjusted floor without manufacturing ten HCP', () => {
    const a = auction('1D 1H P 2D P 2H P 3H');
    const cue = publicCallMeaningAt(a, 3);
    expect(cue).toMatchObject({ supportRange: { trump: 'H', min: 10, max: 40 }, suitMinimums: { H: 3 } });
    expect(cue.hcpRange).toBeUndefined();
    expect(publicPlayerConstraints(a, 'W').supportRanges.H?.min).toBe(10);
    expect(publicPlayerConstraints(a, 'W').hcpRange).toBeUndefined();
  });
  it('control route is unavailable without prior fit/force or after RKCB', () => {
    expect(publicControlCueAt(auction('1H P 2H P 4C'), 4)).toBeUndefined();
    expect(publicControlCueAt(auction('1H P 3H P 4NT P 5C'), 6)).toBeUndefined();
    expect(meaning('1H P 3H P 4C').role).toBe('control-cue');
  });
  it.each([
    '1H P 2NT P 3C P 3H P 4C',
    '2C P 2D P 3C P 3H P 4C',
    '1C P 1D P 1S P 3H P 4C',
    '1C 2C 2S 3S P 4C',
  ])('shortness, strong-club suit, fourth-suit inquiry and Michaels do not create a new control route: %s', prefix => {
    const a = auction(prefix);
    expect(publicControlCueAt(a, a.length - 1)).toBeUndefined();
    expect(publicCallMeaningAt(a, a.length - 1).role).not.toBe('control-cue');
  });
});

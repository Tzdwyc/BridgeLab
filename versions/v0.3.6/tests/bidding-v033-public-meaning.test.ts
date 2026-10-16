import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Seat, type Strain, PASS } from '../src/core/types';
import { analyzeAuctionSemantics, isArtificialBidAt, naturalSuitMinimum, noTrumpRangeAt,
  publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { isBalancedNoTrumpAt, isNaturalNoTrumpAt } from '../src/ai/bidding-semantics';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function auction(text: string, start: Seat = 'N'): AuctionEntry[] {
  return text.split(' ').map((token, index) => ({ seat: seats[(seats.indexOf(start) + index) % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain } }));
}
function meaning(text: string, start: Seat = 'N') {
  const calls = auction(text, start);
  return publicCallMeaningAt(calls, calls.length - 1, 'sayc');
}

describe('v0.3.5 canonical public call meanings', () => {
  it('binds meanings to the call prefix, independent of later choices', () => {
    const calls = auction('1NT P 2C P 2S P 3H P 3NT P P P');
    expect(publicCallMeaningAt(calls, 6)).toEqual(publicCallMeaningAt(calls.slice(0, 7), 6));
    expect(publicCallMeaningAt(calls, 6)).toMatchObject({ role: 'stayman-other-major-game-force',
      hcpRange: { min: 10, max: 40 }, suitMinimums: { H: 5, S: 4 }, invitation: false, forcing: 'game' });
  });
  it('does not invent five cards or an eight-card fit after Stayman denial', () => {
    const calls = auction('1NT P 2C P 2D P 2H');
    expect(meaning('1NT P 2C P 2D P 2H')).toMatchObject({ role: 'unmapped-stayman-major', defined: false });
    expect(naturalSuitMinimum(calls, 'S', 'H', 'sayc')).toBe(0);
    expect(publicPlayerConstraints(calls, 'S').suitMinimums.H).toBe(0);
    expect(publicPlayerConstraints(auction('1NT P 2C P 2D P 2H P 4H'), 'N').suitMinimums.H).toBe(2);
  });
  it('does not reinterpret a delayed free answer in enemy responder suit as a cue', () => {
    const calls = auction('P P 1H X 1S P 2H P P 2S');
    expect(isArtificialBidAt(calls, 9)).toBe(false);
    expect(meaning('P P 1H X 1S P 2H P P 2S')).toMatchObject({
      role: 'takeout-free-response', hcpRange: { min: 6, max: 40 }, suitMinimums: { S: 4 }, forcing: 'none' });
    expect(analyzeAuctionSemantics([...calls, { seat: 'S', call: PASS }], 'W', 'sayc').mustBid).toBe(false);
    expect(noTrumpRangeAt(auction('P P 1H X 1S P 2H P P 2S P 2NT'), 11, 'sayc')).toEqual({ min: 18, max: 20 });
  });
  it('distinguishes an actual cue from the delayed natural free answer', () => {
    const calls = auction('1H X P 2H');
    expect(isArtificialBidAt(calls, 3)).toBe(true);
    expect(analyzeAuctionSemantics([...calls, { seat: 'N', call: PASS }], 'E', 'sayc').mustBid).toBe(true);
    expect(noTrumpRangeAt(auction('1H X P 2H P 2NT'), 5, 'sayc')).toBeUndefined();
  });
  it('a balancing natural 2C is not a strong opening allowing four-card 4441 minors', () => {
    const calls = auction('1S P P 2C P 2S P 3D');
    expect(meaning('1S P P 2C')).toMatchObject({ role: 'natural-overcall', artificial: false, suitMinimum: 5 });
    expect(naturalSuitMinimum(calls, 'W', 'D', 'sayc')).toBe(4);
    expect(meaning('2C P 2D P 3D')).toMatchObject({ suitMinimum: 4 });
  });
  it('separates forced minimum answers, voluntary jump invitations, and free responses', () => {
    expect(meaning('2H X P 3D')).toMatchObject({ role: 'takeout-minimum-response', hcpRange: { min: 0, max: 40 }, invitation: false });
    expect(meaning('2H X P 4D')).toMatchObject({ hcpRange: { min: 9, max: 11 }, invitation: true });
    expect(meaning('2H X P 4D').description).toContain('更低合法自然答叫');
    const threeSuits = auction('1C P 1S P 2D X P 2H');
    expect(publicCallMeaningAt(threeSuits, 7)).toMatchObject({ hcpRange: { min: 0, max: 40 } });
    expect(publicPlayerConstraints(threeSuits, 'W').suitMinimums.H).toBe(0);
  });
  it('retains strong technical double history through later preferences', () => {
    const calls = auction('1D X P 1H P 3C P 3D P 4C');
    expect(publicCallMeaningAt(calls, 5)).toMatchObject({ role: 'takeout-strong-rebid', hcpRange: { min: 17, max: 40 }, suitMinimum: 5 });
    const constraints = publicPlayerConstraints(calls, 'E');
    expect(constraints.hcpRange?.min).toBe(17);
    expect(constraints.suitMinimums.C).toBe(5);
    expect(constraints.pointSources.some(source => source.index === 5 && source.range.min === 17)).toBe(true);
  });
  it('direct self-sufficient major game after technical double does not promise extra 17 HCP', () => {
    const calls = auction('1D X P 1NT P 4S');
    expect(publicCallMeaningAt(calls, 5)).toMatchObject({ role: 'takeout-long-major-game', suitMinimum: 6, intent: 'signoff' });
    expect(publicCallMeaningAt(calls, 5).hcpRange).toBeUndefined();
    expect(publicPlayerConstraints(calls, 'E').hcpRange?.min).toBe(12);
    expect(naturalSuitMinimum(calls, 'E', 'S', 'sayc')).toBe(6);
  });
  it('does not assume strong free rebid after partner already made a jump invitation', () => {
    const calls = auction('1D X P 3C P 3S');
    expect(publicCallMeaningAt(calls, 5)).toMatchObject({ role: 'natural-second-suit', suitMinimum: 4 });
    expect(publicPlayerConstraints(calls, 'E').hcpRange?.min).toBe(12);
  });
  it('negative double contributes four unbid major cards to the shared constraints', () => {
    const constraints = publicPlayerConstraints(auction('1C 1S X'), 'S');
    expect(constraints.suitMinimums.H).toBe(4);
    expect(constraints.hcpRange).toEqual({ min: 6, max: 40 });
  });
  it('keeps Jacoby support points separate from HCP and promises four trumps', () => {
    const constraints = publicPlayerConstraints(auction('1H P 2NT'), 'S');
    expect(constraints.hcpRange).toBeUndefined();
    expect(constraints.supportRanges.H).toEqual({ min: 13, max: 40 });
    expect(constraints.suitMinimums.H).toBe(4);
  });
  it('passed 1NT and passed 2NT do not acquire semi-forcing or Jacoby obligations', () => {
    expect(meaning('P P 1H P 1NT')).toMatchObject({ role: 'passed-hand-nt', forcing: 'none', hcpRange: { min: 5, max: 12 } });
    const calls = auction('P P 1H P 2NT');
    expect(isArtificialBidAt(calls, 4)).toBe(false);
    expect(publicCallMeaningAt(calls, 4)).toMatchObject({ role: 'natural-nt', invitation: true, hcpRange: { min: 11, max: 12 } });
  });
  it('2/1 C3 D4 H5 remain exact conservative floors on repeats', () => {
    expect(publicPlayerConstraints(auction('1D P 2C P 2D P 3C'), 'S').suitMinimums.C).toBe(3);
    expect(publicPlayerConstraints(auction('1S P 2D P 2S P 3D'), 'S').suitMinimums.D).toBe(4);
    expect(publicPlayerConstraints(auction('1S P 2H'), 'S').suitMinimums.H).toBe(5);
  });
  it('fourth suit asks one round and NT answers distinguish minimum from extras', () => {
    expect(meaning('1D P 1H P 1S P 2C')).toMatchObject({ role: 'fourth-suit', artificial: true,
      hcpRange: { min: 10, max: 40 }, forcing: 'one-round' });
    expect(meaning('1D P 1H P 1S P 2C P 2NT')).toMatchObject({ role: 'fourth-suit-nt-answer',
      hcpRange: { min: 12, max: 14 }, forcing: 'none' });
    expect(meaning('1D P 1H P 1S P 2C P 3NT')).toMatchObject({ hcpRange: { min: 15, max: 21 } });
    expect(meaning('1D P 1H P 1S P 2C P 2NT').stopperSources).toContainEqual({ suit: 'C', index: 8, seat: 'N' });
  });
  it('ordinary 1NT rebid new minor is five-card natural NF, including passed hands', () => {
    const calls = auction('P P 1D P 1S P 1NT P 2C');
    expect(publicCallMeaningAt(calls, 8)).toMatchObject({ role: 'natural-nt-minor-correction', suitMinimum: 5, forcing: 'none', artificial: false });
    expect(naturalSuitMinimum(calls, 'N', 'C', 'sayc')).toBe(5);
    expect(analyzeAuctionSemantics([...calls, { seat: 'E', call: PASS }], 'S', 'sayc').mustBid).toBe(false);
    expect(meaning('1H P 1S P 1NT P 2D')).toMatchObject({ role: 'natural-nt-minor-correction', suitMinimum: 5, forcing: 'none' });
  });
  it('passed second suit outside the NT correction retains four cards and NF', () => {
    expect(meaning('P P 1D P 1H P 1S P 2C')).toMatchObject({ role: 'passed-second-suit', suitMinimum: 4, forcing: 'none' });
    expect(meaning('P P 1D P 1H P 1S P 3C')).toMatchObject({ role: 'passed-second-suit', hcpRange: { min: 10, max: 12 }, suitMinimum: 5, forcing: 'none' });
  });
  it('precise original-minor rebid route distinguishes weak escape from long-minor invitation', () => {
    // The nominal weak escape is 5–9, but this actor already promised 6+
    // with the natural 1S response; a continuation cannot erase that floor.
    expect(meaning('1D P 1S P 2D P 3C')).toMatchObject({ role: 'weak-minor-escape', hcpRange: { min: 6, max: 9 }, suitMinimum: 6, forcing: 'none', invitation: false });
    expect(meaning('1D P 1S P 2D P 4C')).toMatchObject({ role: 'long-minor-invitation', hcpRange: { min: 10, max: 12 }, suitMinimum: 6, forcing: 'none', invitation: true });
    expect(meaning('1D 1H 1S P 2D P 3C').role).not.toBe('weak-minor-escape');
    expect(analyzeAuctionSemantics(auction('1D P 1S P 2D P 3C P'), 'N', 'sayc').mustBid).toBe(false);
  });
  it('late responder NT invitations keep the same 11–12 range after an ordinary NT rebid', () => {
    expect(meaning('1D P 1S P 1NT P 2NT')).toMatchObject({ role: 'natural-nt', hcpRange: { min: 11, max: 12 }, invitation: true });
  });
  it('competitive support can be three while quiet support of responder second major is four', () => {
    expect(meaning('1C 2H 2S P 3S')).toMatchObject({ suitMinimum: 3 });
    expect(meaning('1C 1H 1S P 2S')).toMatchObject({ suitMinimum: 3 });
    expect(meaning('1C P 1S P 2S')).toMatchObject({ suitMinimum: 4 });
    expect(naturalSuitMinimum(auction('1C 1D 1H 2D 2H'), 'N', 'H', 'sayc')).toBe(3);
    // A delayed minimum preference is three; it must not create an eighth trump.
    expect(naturalSuitMinimum(auction('1D P 1S P 2D P 2H P 3H'), 'N', 'H', 'sayc')).toBe(3);
    expect(naturalSuitMinimum(auction('1D P 1H P 1S P 2C P 2H'), 'N', 'H', 'sayc')).toBe(3);
    expect(meaning('1C 1D 1H 2D 2H')).toMatchObject({ role: 'competitive-support', invitation: false });
    expect(meaning('2S P 3S').supportRange).toBeUndefined();
  });
  it('secondary repeats retain four cards and genuine original long suits retain six', () => {
    expect(publicPlayerConstraints(auction('1D P 1S P 2C P 2D P 3C'), 'N').suitMinimums.C).toBe(4);
    expect(publicPlayerConstraints(auction('1S P 1NT P 2S P 3C P 3S'), 'N').suitMinimums.S).toBe(6);
  });
  it('voluntary original-major jump rebids preserve their invitation strength', () => {
    expect(meaning('1S P 1NT P 3S')).toMatchObject({ role: 'natural-repeat', hcpRange: { min: 16, max: 20 }, suitMinimum: 6, invitation: true });
    expect(meaning('1H P 1S P 3H')).toMatchObject({ hcpRange: { min: 16, max: 20 }, invitation: true });
    expect(meaning('1C P 1H P 1S P 3H')).toMatchObject({ hcpRange: { min: 10, max: 12 }, suitMinimum: 6, invitation: true });
  });
  it('retains NT enemy stopper provenance through transfer and final NT by the partner', () => {
    const calls = auction('1S 1NT P 2D P 2H P 3NT');
    expect(publicCallMeaningAt(calls, 7).stopperSources).toContainEqual({ suit: 'S', index: 1, seat: 'E' });
    expect(publicCallMeaningAt(calls, 7).stopperSources).not.toContainEqual({ suit: 'S', index: 7, seat: 'W' });
  });
  it('strong-club fixed second negative stays artificial and the genuine minor floor is four', () => {
    expect(meaning('2C P 2D P 3H P 3C')).toMatchObject({ artificial: true, hcpRange: { min: 0, max: 3 } });
    expect(meaning('2C P 2D P 3D P 3NT')).toMatchObject({ artificial: true, hcpRange: { min: 0, max: 3 } });
    expect(naturalSuitMinimum(auction('2C P 2D P 3D P 3NT P 4D'), 'N', 'D', 'sayc')).toBe(4);
  });
  it('five-level trump is signoff before any queen inquiry interpretation', () => {
    const calls = auction('1H P 3H P 4NT P 5C P 5H P');
    expect(publicCallMeaningAt(calls, 8)).toMatchObject({ role: 'keycard-signoff', artificial: false, forcing: 'none' });
    expect(analyzeAuctionSemantics(calls, 'S', 'sayc').mustBid).toBe(false);
    expect(meaning('1H P 3H P 4NT P 5C P 5D')).toMatchObject({ role: 'queen-ask', artificial: true });
    expect(meaning('1H P 3H P 4NT P 5D P 5S').role).not.toBe('queen-ask');
  });
  it('specific side king answer is information, not a grand-slam acceptance', () => {
    expect(meaning('1S P 3S P 4NT P 5C P 5NT P 6D')).toMatchObject({ role: 'king-answer', artificial: true });
    expect(meaning('1S P 3S P 4NT P 5C P 5NT P 6D').description).toContain('不保证十三墩');
    expect(meaning('1H P 3H P 4NT P 5C P 5NT P 6H').description).toContain('不否认更高花色K');
  });
  it('minor jump rebids and negative-double major jumps retain distinct point types', () => {
    expect(meaning('1D P 1H P 3D')).toMatchObject({ hcpRange: { min: 16, max: 18 }, suitMinimum: 6, invitation: true });
    expect(meaning('1S 2C X P 3S')).toMatchObject({ hcpRange: { min: 16, max: 20 }, suitMinimum: 6, invitation: true });
    expect(meaning('1C 1H X P 3S')).toMatchObject({ supportRange: { trump: 'S', min: 16, max: 18 }, suitMinimum: 4, invitation: true });
    expect(meaning('1C 1H X P 3S').hcpRange).toBeUndefined();
  });
  it('raises and repeated fit invitations retain strength without growing trumps', () => {
    expect(meaning('1D P 1S P 3S')).toMatchObject({ supportRange: { trump: 'S', min: 16, max: 18 }, suitMinimum: 4, invitation: true });
    expect(meaning('1D P 1H P 2H P 3H')).toMatchObject({ supportRange: { trump: 'H', min: 10, max: 12 }, suitMinimum: 4, invitation: true });
    expect(meaning('1S P 2S P 3S')).toMatchObject({ supportRange: { trump: 'S', min: 16, max: 18 }, suitMinimum: 5, invitation: true });
    expect(meaning('1C P 1H P 1S P 3S')).toMatchObject({ supportRange: { trump: 'S', min: 10, max: 12 }, suitMinimum: 4, invitation: true });
    expect(meaning('1S P 2S 3D 3S').invitation).toBe(false);
  });
  it('semiNT weak preference promises two while a voluntary long-major jump invites', () => {
    expect(meaning('1S P 1NT P 2C P 2S')).toMatchObject({ suitMinimum: 2, invitation: false });
    expect(meaning('1S P 1NT P 2D P 3H')).toMatchObject({ hcpRange: { min: 10, max: 12 }, suitMinimum: 6, invitation: true, forcing: 'none' });
    expect(meaning('1H P 1NT').description).toContain('12–16 HCP');
  });
  it('strong jump preserves original-minor four cards in its actual evidence source', () => {
    const calls = auction('1C P 1D 1H 2S');
    const constraints = publicPlayerConstraints(calls, 'N');
    expect(constraints.hcpRange?.min).toBe(19);
    expect(constraints.suitMinimums.C).toBe(4);
    expect(constraints.lengthSources).toContainEqual({ index: 4, suit: 'C', minimum: 4 });
    expect(publicPlayerConstraints(auction('1D P 2C P 2D'), 'N').suitMinimums.D).toBe(4);
  });
  it('natural overcall support and Precision positives preserve declared public strength', () => {
    expect(meaning('1C 1H P 2H')).toMatchObject({ supportRange: { trump: 'H', min: 6, max: 9 }, suitMinimum: 3 });
    const calls = auction('1C P 1S');
    expect(publicCallMeaningAt(calls, 2, 'precision')).toMatchObject({ hcpRange: { min: 8, max: 40 }, suitMinimum: 5 });
    expect(publicPlayerConstraints(calls, 'N', 'precision').hcpRange?.min).toBe(16);
  });
  it('keeps the only other-major four-card invitation where a 2NT decline remains legal', () => {
    expect(meaning('1NT P 2C P 2H P 2S')).toMatchObject({ role: 'stayman-other-major-invitation',
      hcpRange: { min: 8, max: 9 }, suitMinimum: 4, forcing: 'none', invitation: true });
    expect(analyzeAuctionSemantics(auction('1NT P 2C P 2S P 3H P'), 'N', 'sayc').forcing).toBe('game');
    expect(naturalSuitMinimum(auction('1NT P 2C P 2S P 3H'), 'S', 'H', 'sayc')).toBe(5);
    expect(meaning('2NT P 3C P 3S P 4H')).toMatchObject({ role: 'stayman-other-major-game-force', suitMinimum: 4 });
  });
  it('uses only natural NT platforms and rejects every artificial 2NT request', () => {
    for (const text of ['1H 2H P 2NT', '1H 2NT', '1H P 2NT', '2D P 2NT']) {
      const calls = auction(text);
      expect(isNaturalNoTrumpAt(calls, calls.length - 1)).toBe(false);
    }
    expect(isNaturalNoTrumpAt(auction('1S 1NT'), 1)).toBe(true);
    expect(isNaturalNoTrumpAt(auction('2C P 2D P 2NT'), 4)).toBe(true);
    expect(meaning('1H 2H P 2NT P 3C').role).toBe('michaels-minor-answer');
    expect(naturalSuitMinimum(auction('1H 2H P 2NT P 3C'), 'E', 'C', 'sayc')).toBe(5);
  });
  it('preserves support-cue length through natural support without converting it into a two-card preference', () => {
    const calls = auction('1D 1S P 2D P 2S P 3S');
    expect(publicCallMeaningAt(calls, 7)).toMatchObject({ role: 'support-cue-continuation', suitMinimum: 3, invitation: false });
    expect(publicPlayerConstraints(calls, 'W').suitMinimums.S).toBe(3);
    expect(publicPlayerConstraints(calls, 'W').supportRanges.S?.min).toBe(10);
    expect(publicPlayerConstraints(calls, 'W').hcpRange).toBeUndefined();
    expect(naturalSuitMinimum(calls, 'W', 'S', 'sayc')).toBe(3);
  });
  it('Jacoby continuation keeps four responder trumps and does not add six opener trumps', () => {
    const calls = auction('1H P 2NT P 3H P 4H');
    expect(publicCallMeaningAt(calls, 4)).toMatchObject({ role: 'jacoby-rebid', hcpRange: { min: 18, max: 21 }, suitMinimums: { H: 5 } });
    expect(publicCallMeaningAt(calls, 6)).toMatchObject({ role: 'jacoby-continuation', suitMinimums: { H: 4 } });
    expect(publicPlayerConstraints(calls, 'S').suitMinimums.H).toBe(4);
    expect(naturalSuitMinimum(calls, 'N', 'H', 'sayc')).toBe(5);
    expect(meaning('1H P 2NT P 3NT')).toMatchObject({ role: 'jacoby-rebid', hcpRange: { min: 15, max: 17 } });
    expect(meaning('P P 1H P 2NT').role).toBe('natural-nt');
  });
  it('a natural side-minor invitation guarantees a real fit, not a two-card preference', () => {
    const calls = auction('1H P 1NT P 2D P 3D');
    expect(meaning('1H P 1NT P 2D P 3D')).toMatchObject({ role: 'natural-support',
      supportRange: { trump: 'D', min: 10, max: 12 }, suitMinimum: 4, invitation: true });
    expect(naturalSuitMinimum(calls, 'S', 'D', 'sayc')).toBe(4);
    expect(meaning('1S P 1NT P 2C P 2S')).toMatchObject({ role: 'natural-preference', suitMinimum: 2, invitation: false });
    expect(meaning('1H P 1S P 2C P 2H')).toMatchObject({ role: 'natural-preference', suitMinimum: 2, invitation: false });
  });
  it('a minimum forced support answer never gains an invitation from its absolute level', () => {
    expect(meaning('1C 2H 2S P 3S')).toMatchObject({ role: 'natural-support', intent: 'answer', invitation: false });
    expect(meaning('1C 2H 2S P 3S').description).toContain('最低合法支持回答');
    expect(meaning('1C 2H 2S P 3S').supportRange).toBeUndefined();
    expect(meaning('2H X P 3D')).toMatchObject({ intent: 'answer', invitation: false, hcpRange: { min: 0, max: 40 } });
  });
  it('negative double with both majors already bid publicly shows four of each minor', () => {
    const calls = auction('1H 1S X');
    expect(publicPlayerConstraints(calls, 'S').suitMinimums).toMatchObject({ C: 4, D: 4, H: 0, S: 0 });
    expect(naturalSuitMinimum(calls, 'S', 'C', 'sayc')).toBe(4);
    expect(naturalSuitMinimum(calls, 'S', 'D', 'sayc')).toBe(4);
    expect(publicPlayerConstraints(auction('1D 1S X'), 'S').suitMinimums.C).toBe(0);
  });
  it('a blocked fourth-suit NT minimum stays minimum even when only 3NT is legal', () => {
    const calls = auction('1D P 1H P 1S P 2C 3D 3NT');
    expect(noTrumpRangeAt(calls, 8, 'sayc')).toEqual({ min: 12, max: 14 });
    expect(publicCallMeaningAt(calls, 8)).toMatchObject({ role: 'fourth-suit-nt-answer', hcpRange: { min: 12, max: 14 }, invitation: false });
    expect(publicCallMeaningAt(calls, 8).description).toContain('最低限回答');
    expect(meaning('1D P 1H P 1S P 2C P 3NT').hcpRange).toEqual({ min: 15, max: 21 });
    const reverse = auction('1D P 1S P 2H P 3C P 3NT');
    expect(noTrumpRangeAt(reverse, 8, 'sayc')).toEqual({ min: 17, max: 21 });
    expect(publicPlayerConstraints(reverse, 'N').hcpRange).toEqual({ min: 17, max: 21 });
  });
  it('2/1 slow and fast major supports retain typed strength and three-card support', () => {
    // Opener's earlier 12–21 bound persists through the slow-arrival raise.
    expect(meaning('1S P 2H P 3H')).toMatchObject({ suitMinimum: 3, hcpRange: { min: 15, max: 21 }, forcing: 'game', invitation: false });
    expect(meaning('1S P 2H P 4H')).toMatchObject({ suitMinimum: 3, hcpRange: { min: 12, max: 14 }, forcing: 'none' });
    expect(meaning('1S P 2H P 3C P 4S')).toMatchObject({ suitMinimum: 3, hcpRange: { min: 13, max: 40 }, forcing: 'none' });
    expect(publicPlayerConstraints(auction('1S P 2H P 3C P 4S'), 'S').hcpRange).toEqual({ min: 13, max: 40 });
  });
  it('high overcall support cue keeps its game intent through a natural side-suit answer', () => {
    const calls = auction('1S 2H P 3S');
    expect(publicCallMeaningAt(calls, 3)).toMatchObject({ role: 'cue', forcing: 'game',
      supportRange: { trump: 'H', min: 14, max: 40 }, suitMinimums: { H: 3 } });
    expect(publicCallMeaningAt(calls, 3).hcpRange).toBeUndefined();
    expect(analyzeAuctionSemantics(auction('1S 2H P 3S P 4C P'), 'W', 'sayc').forcing).toBe('game');
    expect(analyzeAuctionSemantics(auction('1S 2H P 3S P 4H P'), 'W', 'sayc').mustBid).toBe(false);
    expect(analyzeAuctionSemantics(auction('1D 1S P 2D P'), 'E', 'sayc').forcing).toBe('one-round');
  });
  it('canonical natural competitive and preempt responses keep their exact point floors', () => {
    // Usually 10+, with the explicitly bounded 9-HCP/eight-card quality
    // exception. The public minimum is conservative; the private gate must
    // check the entire alternative, not accept every nine-point five-card suit.
    expect(meaning('1C 2H 2S')).toMatchObject({ role: 'natural-response', hcpRange: { min: 9, max: 40 }, suitMinimum: 5, forcing: 'one-round',
      playingSourceCompensation: { normalHcpMinimum: 10, minHcp: 9, minLength: 8 } });
    expect(meaning('2D P 3C')).toMatchObject({ hcpRange: { min: 13, max: 40 }, suitMinimum: 5 });
    expect(meaning('3D P 3H')).toMatchObject({ hcpRange: { min: 15, max: 40 }, suitMinimum: 5 });
    expect(meaning('1H P 1NT P 3H').description).toContain('半逼叫背景中真实六张');
    expect(meaning('1NT 2NT 3H')).toMatchObject({ hcpRange: { min: 10, max: 40 }, suitMinimum: 5, forcing: 'game' });
    expect(meaning('1NT 2NT 3H').description).not.toContain('无干扰');
    expect(meaning('1D 2H 3C')).toMatchObject({ hcpRange: { min: 10, max: 40 }, suitMinimum: 5, forcing: 'one-round' });
  });
  it('five-card overcalls allow three support, six-card original jumps allow two game support', () => {
    expect(meaning('1H 2D P 3D')).toMatchObject({ suitMinimum: 3 });
    expect(meaning('1S 2C X P 3S P 4S')).toMatchObject({ suitMinimum: 2 });
    expect(meaning('P 2H X P 3D P 3S P 4S')).toMatchObject({ suitMinimum: 3 });
  });
  it('RKCB replies are information and cannot manufacture a new natural fit', () => {
    const calls = auction('1H P 1S P 2C P 4NT P 5S');
    expect(publicCallMeaningAt(calls, 8)).toMatchObject({ role: 'keycard-answer', intent: 'answer', suitMinimums: {} });
    expect(naturalSuitMinimum(calls, 'N', 'S', 'sayc')).toBe(0);
    expect(meaning('1H P 2NT P 4NT P 5H')).toMatchObject({ role: 'keycard-answer', forcing: 'none', artificial: false });
  });
  it('only explicit balanced NT keeps a two-card floor in all suits with the original source', () => {
    for (const text of ['1NT', '1H 1NT', '2C P 2D P 2NT', '1C P 1H P 1NT', '1D P 1H P 2NT', '1H X P 1S P 2NT', '1D X P 1H P 1NT']) {
      const calls = auction(text), index = calls.length - 1, seat = calls[index].seat;
      expect(isBalancedNoTrumpAt(calls, index)).toBe(true);
      for (const suit of ['C', 'D', 'H', 'S'] as const) {
        expect(naturalSuitMinimum(calls, seat, suit, 'sayc')).toBeGreaterThanOrEqual(2);
        expect(publicPlayerConstraints(calls, seat).lengthSources).toContainEqual({ index, suit, minimum: 2 });
      }
    }
    for (const text of ['1H P 1NT', '1C P 2NT', '1D 2NT', '1D P 1H P 1S P 2C P 2NT', '1C 2H X P 2NT', '1D X P 1H P 3C P 3D P 3NT']) {
      const calls = auction(text); expect(isBalancedNoTrumpAt(calls, calls.length - 1)).toBe(false);
    }
  });
  it('distinguishes technical doubler invitation bands and publicly confirmed fit', () => {
    expect(meaning('1D X P 1H P 2H')).toMatchObject({ role: 'takeout-support-invitation', suitMinimum: 4,
      hcpRange: { min: 16, max: 18 }, invitation: true, forcing: 'none' });
    expect(meaning('2D X P 2H P 3H')).toMatchObject({ role: 'takeout-support-invitation', suitMinimum: 4,
      hcpRange: { min: 18, max: 20 }, invitation: true });
    expect(meaning('1D X 1S 2H P 3H')).toMatchObject({ role: 'takeout-support-invitation', suitMinimum: 4,
      supportRange: { trump: 'H', min: 16, max: 18 }, invitation: true });
    expect(meaning('1D X 1S 2H P 3H').hcpRange).toBeUndefined();
    expect(meaning('2H X P 3D')).toMatchObject({ invitation: false, hcpRange: { min: 0, max: 40 } });
  });
  it('weak-two NT intervention is a public construction exception, not a hidden weak escape', () => {
    expect(meaning('2D 2NT 3S')).toMatchObject({ role: 'preempt-nt-competitive-response', hcpRange: { min: 10, max: 40 },
      suitMinimum: 5, forcing: 'none', intent: 'competitive' });
    expect(analyzeAuctionSemantics(auction('2D 2NT 3S P'), 'N', 'sayc').mustBid).toBe(false);
    expect(meaning('2D P 3C')).toMatchObject({ role: 'natural-response', hcpRange: { min: 13, max: 40 }, forcing: 'one-round' });
    expect(meaning('2D 2H 3S').role).not.toBe('preempt-nt-competitive-response');
  });
  it('a low support cue is fulfilled by the available three-major reply despite competition', () => {
    expect(analyzeAuctionSemantics(auction('1C 1H 2C 3C X 3H P'), 'W', 'sayc').mustBid).toBe(false);
    expect(meaning('1C 1H 2C 3C').supportRange).toEqual({ trump: 'H', min: 10, max: 40 });
    expect(analyzeAuctionSemantics(auction('1S 2H 3H P'), 'N', 'sayc').forcing).toBe('one-round');
    expect(analyzeAuctionSemantics(auction('1S 2H 3H P 3S P'), 'S', 'sayc').mustBid).toBe(false);
    // A 12-point Rule20 opening with these fit lengths necessarily has a
    // short side suit; a 13-point flat opening has the same 13 support floor.
    expect(meaning('1H 2S 3S')).toMatchObject({ role: 'cue', forcing: 'game', supportRange: { trump: 'H', min: 12, max: 40 } });
    // A three-card minor opening does not turn an enemy-suit stopper inquiry
    // into five-card support or a game force merely by crossing three diamonds.
    // With no fit, this strong inquiry needs 13 raw opposite the opening's
    // public 12; the confirmed-fit ten-support-point cue above stays distinct.
    expect(meaning('1D 2H 3H')).toMatchObject({ role: 'cue', forcing: 'one-round', hcpRange: { min: 13, max: 40 } });
    expect(meaning('1D 2H 3H').supportRange).toBeUndefined();
    expect(naturalSuitMinimum(auction('1D 2H 3H'), 'S', 'D', 'sayc')).toBe(0);
  });
  it('game support uses the public fit rather than adding six cards on a jump', () => {
    expect(meaning('1C 1H 1S 2H 2S P 4S')).toMatchObject({ suitMinimum: 5 });
    expect(meaning('1C P 1S P 2S P 4S')).toMatchObject({ suitMinimum: 4 });
    expect(meaning('1C P 1H P 2C P 2D P 3C P 5C')).toMatchObject({ suitMinimum: 3 });
    expect(meaning('1C P 1H P 2C P 4H')).toMatchObject({ suitMinimum: 6, hcpRange: { min: 13, max: 40 } });
    expect(meaning('1C P 1H P 2NT P 4H').hcpRange).toBeUndefined();
    expect(meaning('3H P 4H')).toMatchObject({ suitMinimum: 1 });
    expect(naturalSuitMinimum(auction('3H P 4H'), 'S', 'H', 'sayc')).toBe(1);
  });
  it('a voluntary competitive responder NT continuation preserves its invitation', () => {
    expect(meaning('1S 2C 2D P 2S P 2NT')).toMatchObject({ role: 'natural-nt', hcpRange: { min: 11, max: 12 }, invitation: true });
    // The approved minimum natural reverse answer retains the earlier 6+ response, without a new ten-point cap.
    expect(meaning('1D P 1S P 2H P 2NT').hcpRange).toEqual({ min: 6, max: 40 });
    expect(meaning('1C 2H 2NT')).toMatchObject({ hcpRange: { min: 11, max: 12 }, invitation: true, forcing: 'none' });
    expect(isBalancedNoTrumpAt(auction('1C 2H 2NT'), 2)).toBe(false);
  });
  it('Jacoby shortness persists as a public maximum rather than a hidden extra', () => {
    const calls = auction('1S P 2NT P 3H P 3S');
    expect(publicCallMeaningAt(calls, 4).suitMaximums).toEqual({ H: 1 });
    expect(publicPlayerConstraints(calls, 'N').suitMaximums).toEqual({ H: 1 });
    expect(publicPlayerConstraints(calls, 'N').suitMinimums.S).toBe(5);
  });
  it('natural NT distinguishes quantitative invitations from games and slam contracts', () => {
    for (const text of ['1NT P 4NT']) {
      expect(meaning(text)).toMatchObject({ role: 'natural-nt', intent: 'invitation', invitation: true });
      expect(meaning(text).description).toContain('接受或Pass');
      expect(meaning(text).description).not.toContain('选择无将成局');
    }
    expect(meaning('1NT P 5NT')).toMatchObject({ role: 'natural-nt', intent: 'grand-inv', invitation: true, forcing: 'one-round' });
    expect(meaning('1NT P 5NT').hcpRange).toEqual({ min: 20, max: 40 });
    expect(meaning('2NT P 5NT').hcpRange).toEqual({ min: 16, max: 40 });
    expect(meaning('2C P 2D P 2NT P 5NT').hcpRange).toEqual({ min: 13, max: 40 });
    expect(meaning('1NT P 5NT').description).toContain('不能Pass停在5NT');
    expect(analyzeAuctionSemantics(auction('1NT P 5NT P'), 'N', 'sayc')).toMatchObject({ convention: 'quantitative-grand-invitation', mustBid: true });
    expect(analyzeAuctionSemantics(auction('1NT P 5NT P P'), 'S', 'sayc').mustBid).toBe(true);
    expect(analyzeAuctionSemantics(auction('1NT P 5NT P 6NT P'), 'S', 'sayc').mustBid).toBe(false);
    const kings = auction('1S P 3S P 4NT P 5C P 5NT P 6C P');
    expect(publicCallMeaningAt(kings, 8).role).toBe('king-ask');
    expect(publicCallMeaningAt(kings, 10).role).toBe('king-answer');
    expect(analyzeAuctionSemantics(kings, 'N', 'sayc').convention).not.toBe('quantitative-grand-invitation');
    expect(meaning('1NT P 6NT').description).toContain('小满贯签约');
    expect(meaning('1NT P 7NT').description).toContain('大满贯签约');
    expect(meaning('1H P 2NT P 4NT').role).not.toBe('natural-nt');
    expect(meaning('1H P 1NT P 2C P 4NT').invitation).toBe(false);
    expect(meaning('1NT').description).toContain('明确均型，四套均至少两张');
    expect(meaning('1C 2H 2NT').description).toContain('不自动承诺四套均两张');
    expect(meaning('1C 2H 2NT').description).toContain('红心H止张由本次');
    expect(meaning('1H 1NT P 2H P 2S P 3NT').description).toContain('红心H止张依此前E第2步');
    expect(meaning('1H 1NT P 2H P 2S P 3NT').description).toContain('来自同伴');
  });
  it('negative-double later new minor keeps public length and strength after enemy intervention', () => {
    const calls = auction('P 1C 2S X P 3C P 3D 3S', 'S');
    expect(publicCallMeaningAt(calls, 7)).toMatchObject({ role: 'responder-second-suit', defined: true,
      hcpRange: { min: 10, max: 40 }, suitMinimum: 5, forcing: 'one-round' });
    expect(publicPlayerConstraints(calls, 'E')).toMatchObject({ hcpRange: { min: 10, max: 40 }, suitMinimums: { D: 5, H: 4 } });
    expect(analyzeAuctionSemantics(calls, 'W', 'sayc').mustBid).toBe(false);
  });
  it('responder six-card original major invitation over balanced 1NT uses support points only', () => {
    const calls = auction('1C P 1H P 1NT P 3H');
    expect(publicCallMeaningAt(calls, 6)).toMatchObject({ role: 'natural-repeat', suitMinimum: 6,
      supportRange: { trump: 'H', min: 10, max: 12 }, invitation: true });
    expect(publicCallMeaningAt(calls, 6).hcpRange).toBeUndefined();
    expect(publicPlayerConstraints(calls, 'S').hcpRange?.min).toBe(6);
    expect(meaning('1C P 1H P 2C P 3H')).toMatchObject({ hcpRange: { min: 10, max: 12 }, suitMinimum: 6 });
  });
  it('high-space free new suit has thirteen HCP game intent while keeping F1', () => {
    expect(meaning('1S 3H 4C')).toMatchObject({ hcpRange: { min: 13, max: 40 }, suitMinimum: 5, forcing: 'one-round' });
    expect(meaning('1S 2H 3C')).toMatchObject({ hcpRange: { min: 10, max: 40 }, forcing: 'one-round' });
    expect(meaning('1H 3S 4C')).toMatchObject({ hcpRange: { min: 13, max: 40 }, forcing: 'one-round' });
    expect(meaning('P P 1S 3H 4C')).toMatchObject({ defined: false, suitMinimum: 5 });
    expect(meaning('P P 1S 3H 4C').hcpRange).toBeUndefined();
    expect(meaning('P P 1S 3H 4C').description).toContain('不采用未Pass手牌的13+');
  });
  it('negative-double jump supports are four-card support points, never five-card HCP extras', () => {
    expect(meaning('1H 2C X P 3S')).toMatchObject({ suitMinimum: 4, supportRange: { trump: 'S', min: 16, max: 18 } });
    expect(meaning('1H 2C X P 3S').hcpRange).toBeUndefined();
    expect(meaning('1D X 1H P 3H')).toMatchObject({ suitMinimum: 4, supportRange: { trump: 'H', min: 16, max: 18 } });
    expect(meaning('1D X 1H P 3H').hcpRange).toBeUndefined();
  });
  it('technical doubler jump raise is nineteen to twenty-one, separate from a simple raise', () => {
    expect(meaning('1D X P 1H P 3H')).toMatchObject({ role: 'takeout-support-invitation', suitMinimum: 4,
      hcpRange: { min: 19, max: 21 }, invitation: true });
    expect(meaning('1D X P 1H P 3H').supportRange).toBeUndefined();
    expect(meaning('1D X P 1H')).toMatchObject({ suitMinimum: 3, hcpRange: { min: 0, max: 40 } });
    expect(meaning('1D X P 1H P 2H').hcpRange).toEqual({ min: 16, max: 18 });
  });
  it('transfer then NT opener major game establishes RKCB trump without a responder natural major bid', () => {
    const calls = auction('2C P 2D P 2NT P 3D P 3H P 3NT P 4H P 4NT P 5D P 5NT');
    expect(publicCallMeaningAt(calls, 18)).toMatchObject({ role: 'king-ask', intent: 'inquiry' });
    expect(publicCallMeaningAt(calls, 18).hcpRange).toBeUndefined();
    expect(publicPlayerConstraints(calls.slice(0, 13), 'N').suitMinimums.H).toBe(3);
    expect(publicPlayerConstraints(calls.slice(0, 13), 'S').suitMinimums.H).toBe(5);
  });
});

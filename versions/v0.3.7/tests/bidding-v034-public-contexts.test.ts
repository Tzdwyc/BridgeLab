import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, naturalSuitMinimum, publicCallMeaningAt,
  publicNegativeDoubleMajorsAt, publicPlayerConstraints, publicStrictNTTwoMajorAt,
  publicStrongMinorTrialAt, publicThreeLevelOvercallAdvanceAt, noTrumpRangeAt, latestNoTrumpRange } from '../src/ai/bidding-semantics';
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token, index) => ({ seat: seats[index % 4],
  call: token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
const meaning = (text: string) => { const a = auction(text); return publicCallMeaningAt(a, a.length - 1); };

describe('v034 public context contracts', () => {
  it('strict balanced platform remains a shape constraint after subsequent natural calls', () => {
    const a = auction('1D P 1S P 1NT P 3H P 4S');
    expect(publicPlayerConstraints(a, 'N').strictBalancedShapeFamily).toEqual(['4333', '4432', '5332']);
    expect(publicPlayerConstraints(auction('1D P 1NT'), 'S').strictBalancedShapeFamily).toBeUndefined();
  });
  it('five-five majors over a strict minimum balanced rebid establish a persistent game force', () => {
    const a = auction('1D P 1S P 1NT P 3H');
    expect(publicStrictNTTwoMajorAt(a, 6)).toMatchObject({ platform: { index: 4 } });
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'strict-nt-two-major-game-force',
      suitMinimums: { H: 5, S: 5 }, hcpRange: { min: 11 }, forcing: 'game' });
    expect(naturalSuitMinimum(a, 'S', 'H', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(a, 'S', 'S', 'sayc')).toBe(5);
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ forcing: 'game', mustBid: true });
    expect(analyzeAuctionSemantics(auction('1D P 1S P 1NT P 3H P 4S'), 'S', 'sayc')).toMatchObject({ forcing: 'none', mustBid: false });
  });
  it.each(['1H P 1NT P 2C P 3H', '1NT P 2H P 2S P 3H', '1C P 1S P 2NT P 3H'])
    ('does not borrow the strict minimum-rebid five-five protocol: %s', text => {
      const a = auction(text); expect(publicStrictNTTwoMajorAt(a, a.length - 1)).toBeUndefined();
    });
  it('negative double majors come from the overcall at X rather than a later enemy suit', () => {
    const a = auction('1D 1H X 1S 2H');
    expect(publicNegativeDoubleMajorsAt(a, 2)).toEqual(['S']);
    // The original X still shows spades and only six raw points. Opener's
    // unsupported heart cue therefore needs 19+ to reach the new public 25.
    expect(publicCallMeaningAt(a, 4)).toMatchObject({ role: 'cue', artificial: true, hcpRange: { min: 19 } });
    expect(publicCallMeaningAt(a, 4).suitMinimums.H).toBeUndefined();
  });
  it('a low-point natural reply to a cue fulfils its round without creating ten raw points or another force', () => {
    const a = auction('1D 1H X 1S 2H P 3C');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'natural-second-suit',
      suitMinimum: 5, hcpRange: { min: 6 }, forcing: 'none' });
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ forcing: 'none', mustBid: false });
  });
  it('responder invitation after a three-card major preference announces the fifth trump', () => {
    expect(meaning('1D X 1H 2C 2H P 3H')).toMatchObject({ role: 'natural-repeat',
      suitMinimum: 5, supportRange: { trump: 'H', min: 10, max: 12 }, invitation: true });
  });
  it('natural NT promises stoppers in both publicly declared Unusual minor suits', () => {
    expect(meaning('1S 2NT X P 3NT').stopperSources.map(source => source.suit).sort()).toEqual(['C', 'D']);
  });
  it('strong waiting positive is five-card and four raw, unlike a second negative', () => {
    expect(meaning('2C P 2D P 3C P 3S')).toMatchObject({ role: 'natural-response',
      suitMinimum: 5, hcpRange: { min: 4 }, forcing: 'game' });
  });
  it('high natural minor after a public game force describes five without six or extra raw points', () => {
    expect(meaning('P 1S P 1NT P 3H P 4D')).toMatchObject({ role: 'responder-second-suit',
      suitMinimum: 5, hcpRange: { min: 5 }, forcing: 'game' });
  });
  it('redoubled technical bidder can escape in its actual four-card suit', () => {
    const a = auction('P P 1D X XX P P 1H');
    expect(publicCallMeaningAt(a, 7)).toMatchObject({ role: 'weak-takeout-redoubled-escape',
      suitMinimum: 4, hcpRange: { min: 12 }, forcing: 'none' });
    expect(naturalSuitMinimum(a, 'W', 'H', 'sayc')).toBe(4);
  });
  it('strong natural NT platform completed at game retains a three-point response minimum', () => {
    expect(meaning('2C P 2D P 2NT P 3C P 3D P 3NT').hcpRange?.min).toBe(3);
  });
  it('minimum strong-takeout game support has no weak nine-point ceiling', () => {
    expect(meaning('1D X P 1H P 2S P 4S').supportRange?.max).not.toBe(9);
  });
  it('weak jump support retains six without a constructive support floor', () => {
    const m = meaning('1C 2S P 3S');
    expect(m.supportRange).toBeUndefined();
    expect(m.hcpRange).toBeUndefined();
    expect(m.description).toContain('公开6+张');
  });
  it('initial overcaller can give a four-card later natural suit retaining original raw', () => {
    expect(meaning('1D 1S P 2D P 2H')).toMatchObject({ role: 'natural-second-suit',
      suitMinimum: 4, hcpRange: { min: 8, max: 16 }, forcing: 'none' });
  });
  it.each([
    ['1D 1NT P P 2NT', 19, 21],
    ['1C 1S P 2S 2NT', 18, 19],
  ])('extra opener NT band follows enemy source: %s', (text, min, max) => {
    expect(meaning(text).hcpRange).toEqual({ min, max });
  });
  it('late invitation opposite a newly announced sixth major permits two-card support', () => {
    const a = auction('1S P 1NT P 2S P 3S');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ suitMinimum: 2,
      supportRange: { trump: 'S', min: 10, max: 12 }, invitation: true });
    expect(naturalSuitMinimum(a, 'S', 'S', 'sayc')).toBe(2);
  });
  it('NT competition major game declares fit-based support rather than fabricated ten raw', () => {
    expect(meaning('1NT 2D 4S')).toMatchObject({ role: 'nt-competitive-major-game',
      suitMinimum: 6, supportRange: { trump: 'S' }, hcpRange: { min: 0 }, forcing: 'none' });
  });
  it('natural NT overcaller also has the defined six-card weak-minor escape', () => {
    expect(meaning('1H 1NT 2D 3C')).toMatchObject({ role: 'nt-competitive-minor-escape',
      hcpRange: { min: 5, max: 9 }, suitMinimum: 6, forcing: 'none' });
  });
  it('lowest NT after competitive two-club response is a minimum rebid rather than an eighteen-point jump', () => {
    expect(meaning('1D 1S 2C P 2NT').hcpRange).toEqual({ min: 12, max: 14 });
  });
  it('already-forced original minor over a genuine balanced NT has a distinct controlled trial', () => {
    const a = auction('1C P 1H P 2NT P 3D P 3NT P 4D');
    expect(publicStrongMinorTrialAt(a, 10)).toMatchObject({ trump: 'D', ownMinimum: 6,
      partnerMinimum: 2, controlSuits: ['C', 'H', 'S'] });
    expect(publicCallMeaningAt(a, 10)).toMatchObject({ role: 'strong-minor-control-trial',
      suitMinimum: 6, forcing: 'one-round', controlSuits: { C: 'first-or-second-round', H: 'first-or-second-round', S: 'first-or-second-round' } });
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ mustBid: true });
  });
  it('ordinary four-club weak invitation is not silently replaced by strong F1', () => {
    const a = auction('1D P 1H P 2C P 4C');
    expect(publicStrongMinorTrialAt(a, 6)).toBeUndefined();
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'stronger-minor-invitation',
      supportRange: { min: 13, max: 16 }, forcing: 'none' });
  });
  it('weak negative Pass over strong-club interference creates only an opener description obligation', () => {
    const a = auction('2C 2H P P');
    expect(publicCallMeaningAt(a, 2)).toMatchObject({ role: 'strong-club-negative-pass', hcpRange: { min: 0, max: 3 } });
    expect(analyzeAuctionSemantics(a, 'N', 'sayc')).toMatchObject({ mustBid: true, forcing: 'one-round' });
    expect(analyzeAuctionSemantics(auction('2C 2H P P 2NT'), 'S', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
  });
  it('Michaels unknown-minor inquiry has no natural NT point or stopper promise', () => {
    expect(meaning('1H 2H P 2NT')).toMatchObject({ role: 'michaels-inquiry', defined: true,
      artificial: true, forcing: 'one-round', hcpRange: { min: 0 }, stopperSources: [], suitMinimums: {} });
  });
  it('normal competitive original-major game publishes nineteen and six, even at the cheapest game', () => {
    expect(meaning('1S P P 2D 4S')).toMatchObject({ role: 'natural-repeat',
      hcpRange: { min: 19, max: 21 }, suitMinimum: 6, selfLongGameQualification: { allowEighteenException: false } });
  });
  it('enemy four-minor allows an explicit conditional eighteen-point two-major playing source', () => {
    const m = meaning('1S 3C P 4C 4S');
    expect(m).toMatchObject({ hcpRange: { min: 18, max: 21 }, suitMinimum: 6,
      selfLongGameQualification: { primarySuit: 'S', secondarySuit: 'H', minSecondaryLength: 5,
        minQuickTricks: 4, maxLosingTricks: 3, allowEighteenException: true } });
    expect(m.suitMinimums.H).toBeUndefined();
    expect(m.playingSourceCompensation).toMatchObject({ normalHcpMinimum: 19, minHcp: 18, suit: 'H', minLength: 5 });
  });
  it('semiNT then original-six return gives the lowest legal new-six-major escape without invitation', () => {
    const a = auction('1S P 1NT P 2S P 3H');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'semi-nt-major-escape',
      hcpRange: { min: 5, max: 12 }, suitMinimum: 6, suitMaximums: { S: 1 },
      invitation: false, artificial: false, forcing: 'none' });
    expect(publicPlayerConstraints(a, 'S').suitMinimums.H).toBe(6);
    expect(publicPlayerConstraints(a, 'S').suitMaximums?.S).toBe(1);
    expect(naturalSuitMinimum(a, 'S', 'H', 'sayc')).toBe(6);
    expect(meaning('1S P 1NT P 2C P 3H')).toMatchObject({ role: 'semi-nt-new-major-invitation',
      hcpRange: { min: 10, max: 12 }, suitMinimum: 6, invitation: true, forcing: 'none' });
    expect(meaning('1S P 1NT P 2C P 2H')).toMatchObject({ role: 'semi-nt-new-major',
      hcpRange: { min: 5, max: 12 }, suitMinimum: 5, forcing: 'none' });
  });
  it('semiNT then original-six return permits a real new-six-minor NF invitation', () => {
    const a = auction('1H P 1NT P 2H P 3D');
    expect(publicCallMeaningAt(a, 6)).toMatchObject({ role: 'semi-nt-new-minor-invitation',
      hcpRange: { min: 10, max: 12 }, suitMinimum: 6, artificial: false, forcing: 'none' });
    expect(naturalSuitMinimum(a, 'S', 'D', 'sayc')).toBe(6);
  });
  it('genuine enemy NT plus two passes publishes all own stoppers and the bounded NT shape family', () => {
    const m = meaning('1D 1NT P P 2NT');
    expect(m.stopperSources.map(source => source.suit).sort()).toEqual(['C', 'D', 'H', 'S']);
    expect(m.allowedShapeFamily).toEqual(['4333', '4432', '5332', '6322']);
    expect(m.strictBalancedShapeFamily).toBeUndefined();
  });
  it('the approved eight-card response compensation is really a nine raw source', () => {
    expect(meaning('P 1H 2D 2S')).toMatchObject({ hcpRange: { min: 9 },
      playingSourceCompensation: { normalHcpMinimum: 10, minHcp: 9, minLength: 8 } });
  });
  it.each(['1NT P 2C P 2D P', '1C 1NT P 2C X 2D P'])('completed one-NT Stayman denial releases the requester: %s', text => {
    const a = auction(text), requester: Seat = text.startsWith('1NT') ? 'S' : 'W';
    expect(analyzeAuctionSemantics(a, requester, 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    const answerIndex = a.findLastIndex(entry => entry.call.kind === 'bid');
    expect(publicCallMeaningAt(a, answerIndex)).toMatchObject({ role: 'stayman-answer', forcing: 'none' });
    expect(publicCallMeaningAt(a, answerIndex).description).toContain('不额外承诺方块长度');
  });
  it('unanswered Stayman and high-NT denial retain their natural-completion obligations', () => {
    expect(analyzeAuctionSemantics(auction('1NT P 2C P'), 'N', 'sayc')).toMatchObject({ mustBid: true });
    expect(analyzeAuctionSemantics(auction('2NT P 3C P 3D P'), 'S', 'sayc')).toMatchObject({ mustBid: true });
    expect(meaning('1NT P 2C')).toMatchObject({ hcpRange: { min: 8 }, forcing: 'one-round' });
  });
  it('semiNT after a minor description has a bounded ten-to-twelve invitation and fifteen-point acceptance', () => {
    expect(meaning('1H P 1NT P 2C P 2NT')).toMatchObject({ role: 'natural-nt', invitation: true,
      hcpRange: { min: 10, max: 12 }, forcing: 'none',
      allowedShapeFamily: ['4333', '4432', '5332', '5422', '6322'] });
    expect(meaning('1H P 1NT P 2C P 2NT P 3NT')).toMatchObject({ hcpRange: { min: 15, max: 21 } });
    expect(meaning('1C P 1H P 2C P 2NT')).toMatchObject({ hcpRange: { min: 11, max: 12 } });
  });
  it.each(['3C 3H P 3S', '2S 3C P 3H'])('first higher same-level major after a natural three-level overcall is strong F1: %s', text => {
    const a = auction(text);
    expect(publicThreeLevelOvercallAdvanceAt(a, 3)).toMatchObject({ minHcp: 13, minLength: 5 });
    expect(publicCallMeaningAt(a, 3)).toMatchObject({ role: 'natural-response', artificial: false,
      hcpRange: { min: 13 }, suitMinimum: 5, forcing: 'one-round' });
    expect(naturalSuitMinimum(a, 'W', text.endsWith('3S') ? 'S' : 'H', 'sayc')).toBe(5);
    expect(analyzeAuctionSemantics(a, 'E', 'sayc')).toMatchObject({ mustBid: true, forcing: 'one-round', currentContractArtificial: false });
    expect(analyzeAuctionSemantics(auction(`${text} P 4${text.endsWith('3S') ? 'S' : 'H'} P`), 'W', 'sayc'))
      .toMatchObject({ mustBid: false, forcing: 'none' });
  });
  it.each(['1D 2H P 3S', '1C 3H P 3S', '1C 2C P 3H', '1C X P 1S P 3H P 3S', '1H P 1S P 3C P 3S'])
    ('does not extend the three-level overcall contract to other same-call contexts: %s', text => {
      const a = auction(text);
      expect(publicThreeLevelOvercallAdvanceAt(a, a.length - 1)).toBeUndefined();
    });
  it('a normal first two-major advance keeps its original low constructive NF contract', () => {
    expect(meaning('1D 1S P 2H')).toMatchObject({ role: 'natural-response', forcing: 'none',
      hcpRange: { min: 7 }, playingSourceCompensation: { normalHcpMinimum: 8 } });
    expect(meaning('1D 2H P 3S')).toMatchObject({ hcpRange: { min: 8 }, forcing: 'none' });
  });
  it('unanswered Stayman followed by invalid three NT does not announce high-limit invitation acceptance', () => {
    const a = auction('1NT P 2C P 3NT P');
    expect(noTrumpRangeAt(a, 4, 'sayc')).toBeUndefined();
    expect(latestNoTrumpRange(a, 'N', 'sayc')).toEqual({ min: 15, max: 17 });
    expect(publicPlayerConstraints(a, 'N').hcpRange).toEqual({ min: 15, max: 17 });
    const valid = auction('1NT P 2C P 2D P 2NT P 3NT');
    expect(noTrumpRangeAt(valid, 8, 'sayc')).toEqual({ min: 17, max: 17 });
  });
  it('original opener reverse after enemy takeout and advance keeps seventeen raw and both real four-card suits', () => {
    const a = auction('1D X P 1S 2H P');
    expect(publicCallMeaningAt(a, 4)).toMatchObject({ hcpRange: { min: 17, max: 21 },
      suitMinimums: { H: 4, D: 4 }, forcing: 'one-round' });
    expect(analyzeAuctionSemantics(a, 'S', 'sayc')).toMatchObject({ forcing: 'one-round', mustBid: true });
    expect(publicPlayerConstraints(auction('1D X P 1S 2H P 2NT'), 'N').hcpRange).toEqual({ min: 17, max: 21 });
    expect(meaning('1C X P 1D 1H')).toMatchObject({ hcpRange: { min: 12, max: 21 } });
    expect(meaning('1D X P 2S 3H')).toMatchObject({ hcpRange: { min: 12, max: 21 } });
  });
  it('completed negative double permits a real first lowest five-card minor without another force', () => {
    const a = auction('P P P 1C 1H X P 2C P 2D');
    expect(publicCallMeaningAt(a, 9)).toMatchObject({ role: 'passed-second-suit', artificial: false,
      suitMinimum: 5, hcpRange: { min: 6, max: 12 }, forcing: 'none', intent: 'descriptive' });
    expect(naturalSuitMinimum(a, 'E', 'D', 'sayc')).toBe(5);
    expect(publicPlayerConstraints(a, 'W').suitMinimums.D).toBe(0);
    expect(analyzeAuctionSemantics(a, 'W', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none' });
    expect(analyzeAuctionSemantics(auction('1C 1H X P'), 'N', 'sayc')).toMatchObject({ mustBid: true, forcing: 'one-round' });
    expect(meaning('1C 1H X P 2C P 2D')).toMatchObject({ role: 'responder-second-suit',
      hcpRange: { min: 6 }, suitMinimum: 5, forcing: 'none' });
  });
});

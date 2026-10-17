import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, classifyDoubleAt, isTakeoutDoubleAt, naturalSuitMinimum,
  publicCallMeaningAt, publicPlayerConstraints, publicTakeoutDoubleAt, publicPenaltyConversionBefore } from '../src/ai/bidding-semantics';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token, index) => ({ seat: seats[index % 4],
  call: token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
const finalMeaning = (text: string) => { const a = auction(text); return publicCallMeaningAt(a, a.length - 1); };

describe('v0.3.5 public double contexts', () => {
  it.each([
    ['1C 2D P 3D X', 'reopening', 'D', ['H', 'S']],
    ['P 1C 2D P 3D X', 'reopening', 'D', ['H', 'S']],
    ['1C 1H P P X', 'reopening', 'H', ['D', 'S']],
    ['1D 1S 2D P P X', 'reopening', 'D', ['C', 'H']],
    ['1D X 2D X', 'responsive', 'D', ['H', 'S']],
    ['1D X 3D X', 'responsive', 'D', ['H', 'S']],
    ['1D 1H 2D X', 'responsive', 'D', ['C', 'S']],
    ['1H X 2H X', 'responsive', 'H', ['C', 'D']],
    ['1C P 1H X', 'sandwich', 'H', ['D', 'S']],
    ['1D P P X', 'balancing', 'D', ['H', 'S']],
    ['1C X 2C P P X', 'repeat', 'C', ['H', 'S']],
    ['1S P 1NT P 2H X', 'direct', 'H', ['C', 'D']],
  ] as const)('recognizes %s from its public prefix', (text, kind, target, preferredSuits) => {
    const a = auction(text), index = a.length - 1;
    expect(publicTakeoutDoubleAt(a, index)).toMatchObject({ kind, target, preferredSuits });
    expect(classifyDoubleAt(a, index)).toBe('takeout');
    expect(finalMeaning(text).roleLabel).toBe('takeout');
  });

  it.each([
    '1C P 1NT X', // Natural enemy NT, irrespective of earlier suit opening.
    '1NT P 2D P 2H P P X', // Failed natural NT defense does not reopen as takeout.
    '1C 1D 1NT 2D P P X', // Doubler has publicly shown a natural NT hand.
    '1C 1D 2C 2D P P X', // Our side already agreed a natural fit.
    '1D 1H 2D 3H 3D X', // Own raised major fit remains a defensive context.
    '1C X P P 1D X', // Partner converted an earlier takeout double to penalty.
    '1C X P P 2C X', // The same penalty decision survives an escape in the original suit.
    '1C X XX P 1D X', // A redoubled escape is not a fresh low-level request.
    '1C 2D P 4D X', // No invented high-level reopening agreement.
    '1D X 4D X',
    '1C 1H P 2H 3C P P 3H X', // Multiple prior natural descriptions, not a sole-opener reopening.
  ])('does not widen the technical agreement into %s', text => {
    const a = auction(text);
    expect(classifyDoubleAt(a, a.length - 1)).toBe('penalty');
    expect(isTakeoutDoubleAt(a, a.length - 1)).toBe(false);
  });

  it('keeps negative, two-suit strength and lead doubles distinct', () => {
    for (const [text, meaning] of [
      ['1C 1D X', 'negative'], ['1C 2D X', 'negative'],
      ['1C 2C X', 'two-suit-strength'], ['1S 2NT X', 'two-suit-strength'],
      ['1NT P 2C X', 'lead-directing'], ['1C 1H 2H X', 'lead-directing'],
    ] as const) {
      const a = auction(text);
      expect(classifyDoubleAt(a, a.length - 1)).toBe(meaning);
    }
  });

  it('publishes a low-limit opener reopening shape without a fabricated strong-rebid range', () => {
    const a = auction('1C 2D P 3D X');
    expect(publicCallMeaningAt(a, 4)).toMatchObject({ roleLabel: 'takeout', hcpRange: { min: 12, max: 21 },
      suitMinimums: { H: 3, S: 3 }, suitMaximums: { D: 2 } });
    expect(publicPlayerConstraints(a, 'N')).toMatchObject({ hcpRange: { min: 12, max: 21 },
      suitMinimums: { C: 3, H: 3, S: 3 }, suitMaximums: { D: 2 } });
    expect(naturalSuitMinimum(a, 'N', 'H', 'sayc')).toBe(3);
    expect(naturalSuitMinimum(a, 'N', 'S', 'sayc')).toBe(3);
    expect(publicCallMeaningAt(a, 4).description).toContain('普通低限');
  });

  it('responsive doubles show their actual requested suits and level-dependent point floor', () => {
    expect(finalMeaning('1D X 2D X')).toMatchObject({ hcpRange: { min: 6, max: 40 },
      suitMinimums: { H: 4, S: 4 }, suitMaximums: { D: 2 } });
    expect(finalMeaning('1D X 3D X').hcpRange?.min).toBe(8);
    expect(finalMeaning('1H X 2H X')).toMatchObject({ suitMinimums: { C: 4, D: 4 }, suitMaximums: { H: 2 } });
  });

  it.each(['sayc', 'two-over-one'] as const)('requires an answer after reopening in %s, releasing it after an enemy bid', system => {
    expect(analyzeAuctionSemantics(auction('1C 2D P 3D X P'), 'S', system))
      .toMatchObject({ mustBid: true, convention: 'takeout-response' });
    expect(analyzeAuctionSemantics(auction('1C 2D P 3D X 4D'), 'S', system).mustBid).toBe(false);
    expect(analyzeAuctionSemantics(auction('1D X 2D X P'), 'E', system))
      .toMatchObject({ mustBid: true, convention: 'takeout-response' });
  });

  it('keeps a passed responder natural and weak when answering opener reopening X', () => {
    const m = finalMeaning('1C 2D P 3D X P 3H');
    expect(m).toMatchObject({ role: 'takeout-minimum-response', hcpRange: { min: 0, max: 40 },
      suitMinimum: 3, forcing: 'none' });
  });

  it('treats an opening-suit fallback as a weak natural answer rather than a new cue or invitation', () => {
    expect(finalMeaning('1C 2D P 3D X P 4C')).toMatchObject({ role: 'takeout-minimum-response',
      hcpRange: { min: 0, max: 40 }, forcing: 'none', invitation: false });
  });

  it('does not turn an ordinary responsive-double answer into a fresh strength-showing cue', () => {
    expect(finalMeaning('1D X 2D X P 2S')).toMatchObject({ role: 'takeout-minimum-response',
      hcpRange: { min: 12, max: 40 }, suitMinimum: 4, forcing: 'none', invitation: false });
    expect(naturalSuitMinimum(auction('1D X 2D X P 2S'), 'E', 'S', 'sayc')).toBe(4);
  });

  it('does not change the original X when a later player names a different suit', () => {
    const short = auction('1C 2D P 3D X'), long = auction('1C 2D P 3D X P 3H 3S');
    expect(publicTakeoutDoubleAt(long, 4)).toEqual(publicTakeoutDoubleAt(short, 4));
    expect(publicCallMeaningAt(long, 4)).toEqual(publicCallMeaningAt(short, 4));
  });

  it.each(['sayc', 'two-over-one'] as const)('requires reverse extras after a passed-hand two-level response in %s', system => {
    for (const text of ['P P 1D P 2C P 2H', 'P P 1H P 2D P 2S']) {
      const a = auction(text), m = publicCallMeaningAt(a, 6, system);
      expect(m).toMatchObject({ role: 'natural-second-suit', hcpRange: { min: 17, max: 21 },
        suitMinimum: 4, forcing: 'one-round' });
      expect(m.description).toContain('逆叫');
      expect(analyzeAuctionSemantics(a, 'N', system)).toMatchObject({ mustBid: true, convention: 'reverse' });
    }
    for (const text of ['1D P 2C P 2H', '1H P 2D P 2S']) {
      const a = auction(text), m = publicCallMeaningAt(a, 4, system);
      expect(m.hcpRange?.min).toBe(12);
      expect(m.forcing).toBe('game');
      expect(m.description).not.toContain('17+逆叫');
    }
  });

  it('releases a transfer acceptance made illegal by natural interference', () => {
    const a = auction('1S 1NT P 2D 2S');
    expect(analyzeAuctionSemantics(a, 'E', 'sayc')).toMatchObject({ mustBid: false, forcing: 'none',
      currentContractArtificial: false });
    expect(finalMeaning('1S 1NT P 2D 2S P').description).toContain('原最低2H转移接叫不合法');
    expect(finalMeaning('1S 1NT P 2D 2S 3H')).toMatchObject({ role: 'transfer-acceptance', artificial: false,
      hcpRange: { min: 15, max: 18 }, suitMinimum: 3, forcing: 'none' });
    expect(finalMeaning('1S 1NT P 2D 2S 2NT')).toMatchObject({ defined: false, artificial: false, forcing: 'none' });
    expect(finalMeaning('1S 1NT P 2D 2S 2NT').description).not.toContain('应先按约定作出2H');
    expect(analyzeAuctionSemantics(auction('1NT P 2D X'), 'N', 'sayc')).toMatchObject({ mustBid: true,
      convention: 'overcall-transfer' });
  });

  it('distinguishes a cheap competitive raise after takeout from an unopposed invitation', () => {
    const a = auction('P 1D X P 1S 2C 2S');
    expect(finalMeaning('P 1D X P 1S 2C 2S')).toMatchObject({ role: 'competitive-support',
      hcpRange: { min: 12, max: 40 }, suitMinimum: 4, invitation: false, forcing: 'none' });
    expect(naturalSuitMinimum(a, 'S', 'S', 'sayc')).toBe(4);
    expect(finalMeaning('1D X P 1S P 2S')).toMatchObject({ role: 'takeout-support-invitation',
      hcpRange: { min: 16, max: 18 }, suitMinimum: 4, invitation: true, forcing: 'none' });
    expect(finalMeaning('1C X P 1S 2C 2H')).toMatchObject({ role: 'takeout-strong-rebid',
      hcpRange: { min: 17, max: 40 }, suitMinimum: 5 });
  });

  it('publishes a real conversion of partner takeout to penalty without making all response passes automatic', () => {
    const a = auction('P P P 1H P P X P');
    expect(publicPenaltyConversionBefore(a, 'N')).toMatchObject({ doubleIndex: 6, target: 'H', targetIndex: 3 });
    // The response is still required unless the hand makes the exceptional defensive conversion.
    expect(analyzeAuctionSemantics(a, 'N', 'sayc').mustBid).toBe(true);
    const converted = [...a, { seat: 'N' as Seat, call: { kind: 'pass' as const } }];
    expect(publicCallMeaningAt(converted, 8)).toMatchObject({ role: 'pass', roleLabel: '把同伴技术X转作惩罚', forcing: 'none' });
    expect(publicCallMeaningAt(converted, 8).description).toContain('后续不再要求技术应叫');
    expect(analyzeAuctionSemantics(converted, 'N', 'sayc').mustBid).toBe(false);
    expect(publicPenaltyConversionBefore(auction('1C X 2C'), 'W')).toBeUndefined();
  });

  it('requires strong Michaels extras for a voluntary raise after the minimum choice', () => {
    expect(finalMeaning('P P P 1C 2C X 2H P 3H')).toMatchObject({ role: 'natural-repeat',
      hcpRange: { min: 17, max: 40 }, suitMinimum: 6, invitation: true, forcing: 'none' });
    expect(naturalSuitMinimum(auction('P P P 1C 2C X 2H P 3H'), 'N', 'H', 'sayc')).toBe(6);
    expect(finalMeaning('1C 2C P 2H 3C 3H').hcpRange?.min).toBeLessThan(17);
  });

  it('publishes actual balancing reductions without lowering the direct overcall floor', () => {
    expect(finalMeaning('P 1D P P 1S')).toMatchObject({ role: 'natural-overcall',
      hcpRange: { min: 6, max: 16 }, suitMinimum: 5 });
    expect(finalMeaning('1D 1S')).toMatchObject({ hcpRange: { min: 8, max: 16 } });
  });

  it('keeps natural defense to enemy NT and bounds the eight-card source separately', () => {
    expect(finalMeaning('P 1NT 2H')).toMatchObject({ role: 'natural-overcall', artificial: false,
      hcpRange: { min: 8, max: 16 }, suitMinimum: 5, playingSourceCompensation: {
        minLength: 6, minTenOrHigher: 3, normalMinTenOrHigher: 3,
        extraLongAlternative: { minHcp: 12, minLength: 8, minKingOrAce: 1, minQueenOrHigher: 2, minTenOrHigher: 2 },
      } });
  });

  it('separates strong unsupported cues from ten-point support cues or a publicly strong NT partner', () => {
    expect(finalMeaning('P P P 1C 2C X 2H P P 3H')).toMatchObject({ role: 'cue',
      hcpRange: { min: 13, max: 40 }, forcing: 'one-round' });
    expect(finalMeaning('P P P 1C 2C X 2H P P 3H').supportRange).toBeUndefined();
    expect(finalMeaning('1C 1D P 2C')).toMatchObject({ role: 'cue', supportRange: { trump: 'D', min: 10, max: 40 } });
    expect(finalMeaning('1H 1NT P 3H')).toMatchObject({ role: 'cue', hcpRange: { min: 10, max: 40 } });
  });

  it('shows a sixth original-major card in the first answer after two suits and fourth-suit inquiry', () => {
    const text = '1H P 1S P 2D P 3C P 3H', a = auction(text);
    expect(finalMeaning(text)).toMatchObject({ role: 'natural-repeat', suitMinimum: 6, hcpRange: { min: 12, max: 21 } });
    expect(naturalSuitMinimum(a, 'N', 'H', 'sayc')).toBe(6);
    expect(naturalSuitMinimum(auction('1H P 1S P 2D P 3C P 3D'), 'N', 'H', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('1H P 1S P 2D P 3C P 3D'), 'N', 'D', 'sayc')).toBe(4);
    expect(naturalSuitMinimum(auction('1H P 2C P 2D P 2S P 3H'), 'N', 'H', 'sayc')).toBe(5);
    expect(naturalSuitMinimum(auction('1H P 2D P 2H'), 'N', 'H', 'sayc')).toBe(5);
  });

  it('keeps an enemy limited response separate from a genuinely strong NT and preserves actual redouble history', () => {
    expect(analyzeAuctionSemantics(auction('1S P 1NT P 2H X P'), 'W', 'sayc'))
      .toMatchObject({ mustBid: true, convention: 'takeout-response' });
    expect(finalMeaning('1S P 1NT X').roleLabel).toBe('penalty');
    expect(finalMeaning('1D P 1H X').description).not.toContain('再加倍后');
    expect(finalMeaning('1S X XX P P 2H X').description).toContain('再加倍后');
  });
});

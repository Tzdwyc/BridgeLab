import { type Call, type Card, type Suit } from '../core/types';

export interface SuitFitEvaluation {
  hcp: number;
  shortnessPoints: number;
  extraTrumpPoints: number;
  adjustmentPoints: number;
  totalPoints: number;
  knownCombinedTrumps: number;
}

const highCardPoints = (hand: Card[]) => hand.reduce((sum, card) => sum + Math.max(0, card.rank - 10), 0);

/**
 * Support-point valuation used only after an eight-card-or-better fit is known.
 * Doubletons count 1, singletons count 2 (3 with four-card support), voids count 4,
 * and every publicly known trump beyond the eighth counts 1.
 */
export function evaluateSuitFit(hand: Card[], trump: Suit, partnerTrumpMinimum: number): SuitFitEvaluation {
  const trumpLength = hand.filter(card => card.suit === trump).length;
  const knownCombinedTrumps = trumpLength + Math.max(0, partnerTrumpMinimum);
  const hcp = highCardPoints(hand);
  if (knownCombinedTrumps < 8) return { hcp, shortnessPoints: 0, extraTrumpPoints: 0, adjustmentPoints: 0, totalPoints: hcp, knownCombinedTrumps };

  const shortnessPoints = (['C', 'D', 'H', 'S'] as Suit[])
    .filter(suit => suit !== trump)
    .reduce((sum, suit) => {
      const length = hand.filter(card => card.suit === suit).length;
      if (length === 0) return sum + 4;
      if (length === 1) return sum + (trumpLength >= 4 ? 3 : 2);
      if (length === 2) return sum + 1;
      return sum;
    }, 0);
  const extraTrumpPoints = Math.max(0, knownCombinedTrumps - 8);
  const adjustmentPoints = shortnessPoints + extraTrumpPoints;
  return { hcp, shortnessPoints, extraTrumpPoints, adjustmentPoints, totalPoints: hcp + adjustmentPoints, knownCombinedTrumps };
}

export interface PublicSupportConstraints {
  strictBalancedShapeFamily?: Array<'4333' | '4432' | '5332'>;
  allowedShapeFamily?: Array<'4333' | '4432' | '5332' | '6322' | '5422'>;
  controlSuits?: Partial<Record<Suit, 'first-or-second-round'>>;
  hcpRange?: { min: number; max: number };
  supportRanges: Partial<Record<Suit, { min: number; max: number }>>;
  suitMinimums: Record<Suit, number>;
  suitMaximums?: Partial<Record<Suit, number>>;
  ruleOf20Opening?: boolean;
  pointSources?: Array<{
    index: number;
    type: 'hcp' | 'support';
    range: { min: number; max: number };
    trump?: Suit;
    sourceTrumpMinimum?: number;
    sourcePartnerTrumpMinimum?: number;
    playingSourceCompensation?: { normalHcpMinimum: number; minHcp: number; suit: Suit; minLength: number };
    minorInvitationShape?: { primary: Suit; ordinaryLength: number; secondary: Suit; secondaryMinimum: number;
      originalMajor: Suit; maxOriginal: number };

  }>;
}

/** Feasibility of a keycard reply, using only the caller's own cards and the
 * responder's pre-question public contracts. Honor locations and shape remain
 * correlated: a raw floor that consumes every remaining non-key honor cannot
 * simultaneously invent a void in a suit containing those required honors. */
export function feasiblePublicKeycardCounts(hand: Card[], trump: Suit, constraints: PublicSupportConstraints,
  counts: number[]): number[] {
  const suits: Suit[] = ['C', 'D', 'H', 'S'];
  const ownKeys = countKeycards(hand, trump);
  const ownLengths = suits.map(suit => hand.filter(card => card.suit === suit).length);
  const availableSpots = suits.map(suit => 9 - hand.filter(card => card.suit === suit && card.rank <= 10).length);
  const options = suits.map(suit => {
    const honors = [11, 12, 13, 14].filter(rank => !hand.some(card => card.suit === suit && card.rank === rank));
    return Array.from({ length: 1 << honors.length }, (_, mask) => {
      const ranks = honors.filter((_, at) => (mask & (1 << at)) !== 0);
      return { length: ranks.length, hcp: ranks.reduce((sum, rank) => sum + rank - 10, 0),
        keys: ranks.filter(rank => rank === 14 || suit === trump && rank === 13).length,
        control: ranks.includes(14) || ranks.includes(13) };
    });
  });
  const supportSources = (constraints.pointSources ?? []).filter(source => source.type === 'support' && source.trump);
  const sources = supportSources.length ? supportSources : Object.entries(constraints.supportRanges)
    .map(([suit, range]) => ({ trump: suit as Suit, range: range!, sourcePartnerTrumpMinimum: hand.filter(card => card.suit === suit).length }));
  const feasible = new Set<number>();
  for (let c = constraints.suitMinimums.C; c <= 13 - ownLengths[0]; c++)
    for (let d = constraints.suitMinimums.D; d <= 13 - c && d <= 13 - ownLengths[1]; d++)
      for (let h = constraints.suitMinimums.H; h <= 13 - c - d && h <= 13 - ownLengths[2]; h++) {
        const shape = [c, d, h, 13 - c - d - h];
        if (shape[3] < constraints.suitMinimums.S || shape[3] > 13 - ownLengths[3]
          || suits.some((suit, at) => shape[at] > (constraints.suitMaximums?.[suit] ?? 13))) continue;
        const family = [...shape].sort((a, b) => b - a).join('');
        if (constraints.strictBalancedShapeFamily && !constraints.strictBalancedShapeFamily.some(value => value === family)) continue;
        if (constraints.allowedShapeFamily && !constraints.allowedShapeFamily.some(value => value === family)) continue;
        if ((constraints.pointSources ?? []).some(source => {
          const q = source.minorInvitationShape;
          return q && !(shape[suits.indexOf(q.primary)] >= q.ordinaryLength
            || shape[suits.indexOf(q.primary)] >= 5 && shape[suits.indexOf(q.secondary)] >= q.secondaryMinimum
              && shape[suits.indexOf(q.originalMajor)] <= q.maxOriginal);
        })) continue;

        let minimum = constraints.hcpRange?.min ?? 0, maximum = constraints.hcpRange?.max ?? 40;
        if (constraints.ruleOf20Opening && minimum === 12
          && [...shape].sort((a, b) => b - a).slice(0, 2).reduce((sum, value) => sum + value, 0) < 8) minimum = 13;
        for (const source of sources) {
          const at = suits.indexOf(source.trump!), len = shape[at];
          const partnerLength = source.sourcePartnerTrumpMinimum ?? ownLengths[at];
          const adjustment = len + partnerLength < 8 ? 0 : shape.reduce((sum, value, index) => index === at ? sum
            : sum + (value === 0 ? 4 : value === 1 ? len >= 4 ? 3 : 2 : value === 2 ? 1 : 0), 0)
            + Math.max(0, len + partnerLength - 8);
          minimum = Math.max(minimum, source.range.min - adjustment);
          maximum = Math.min(maximum, source.range.max - adjustment);
        }
        if (minimum > maximum) continue;
        // DP over allowed, physically distinct honor subsets. It does not
        // enumerate or consult an actual hidden responder hand.
        let states = new Set<number>([0]);
        for (let at = 0; at < suits.length && states.size; at++) {
          const next = new Set<number>();
          for (const option of options[at]) {
            if (option.length > shape[at] || shape[at] - option.length > availableSpots[at]
              || constraints.controlSuits?.[suits[at]] && shape[at] > 1 && !option.control) continue;
            for (const state of states) {
              const points = Math.floor(state / 6) + option.hcp, keys = state % 6 + option.keys;
              if (points <= maximum && keys + ownKeys <= 5) next.add(points * 6 + keys);
            }
          }
          states = next;
        }
        for (const state of states) if (Math.floor(state / 6) >= minimum && counts.includes(state % 6)) feasible.add(state % 6);
        if (counts.every(value => feasible.has(value))) return counts;
      }
  return counts.filter(value => feasible.has(value));
}

/** Public support floor, never an HCP estimate. No partner cards are inputs.
 * Enumerate possible thirteen-card shapes to retain unavoidable shortness.
 * Extra trumps follow the existing per-hand convention; a published support
 * range already includes its shortness and source-time extra trumps. Only
 * newly known length in the source's partner hand increases that source floor;
 * later increases in the source actor's own public length are not added again.
 */
export function publicSupportMinimum(trump: Suit, ownTrumpLength: number, constraints: PublicSupportConstraints): number {
  const hcp = constraints.hcpRange?.min ?? 0;
  const shown = Math.max(constraints.supportRanges[trump]?.min ?? 0,
    ...(constraints.pointSources ?? []).filter(source => source.type === 'support' && source.trump === trump)
      .map(source => source.range.min + (source.sourceTrumpMinimum !== undefined
        && source.sourcePartnerTrumpMinimum !== undefined
        && source.sourceTrumpMinimum + source.sourcePartnerTrumpMinimum >= 8
        ? Math.max(0, ownTrumpLength - source.sourcePartnerTrumpMinimum) : 0)));
  if (ownTrumpLength + constraints.suitMinimums[trump] < 8) return Math.max(hcp, shown);
  const suits: Suit[] = ['C', 'D', 'H', 'S'];
  const minimums = suits.map(suit => Math.max(0, constraints.suitMinimums[suit]));
  let minimumAdjustment = Infinity;
  for (let c = minimums[0]; c <= 13; c++) for (let d = minimums[1]; d <= 13 - c; d++) {
    for (let h = minimums[2]; h <= 13 - c - d; h++) {
      const s = 13 - c - d - h;
      if (s < minimums[3]) continue;
      const shape = [c, d, h, s], trumpLength = shape[suits.indexOf(trump)];
      if (constraints.strictBalancedShapeFamily && !constraints.strictBalancedShapeFamily
        .some(family => family === [...shape].sort((a, b) => b - a).join(''))) continue;
      if (constraints.allowedShapeFamily && !constraints.allowedShapeFamily
        .some(family => family === [...shape].sort((a, b) => b - a).join(''))) continue;
      if (suits.some((suit, index) => shape[index] > (constraints.suitMaximums?.[suit] ?? 13))) continue;
      if ((constraints.pointSources ?? []).some(source => {
        const q = source.minorInvitationShape;
        return q && !(shape[suits.indexOf(q.primary)] >= q.ordinaryLength
          || shape[suits.indexOf(q.primary)] >= 5 && shape[suits.indexOf(q.secondary)] >= q.secondaryMinimum
            && shape[suits.indexOf(q.originalMajor)] <= q.maxOriginal);
      })) continue;

      const shortness = shape.reduce((sum, length, index) => suits[index] === trump ? sum
        : sum + (length === 0 ? 4 : length === 1 ? trumpLength >= 4 ? 3 : 2 : length === 2 ? 1 : 0), 0);
      // A SAYC twelve-point opening cannot have an arbitrary flat shape:
      // its two longest suits must sum to eight. Shapes failing that test
      // require thirteen HCP, while the auction's raw HCP floor stays twelve.
      const shapeHcpExtra = constraints.ruleOf20Opening && hcp === 12
        && [...shape].sort((a, b) => b - a).slice(0, 2).reduce((sum, length) => sum + length, 0) < 8 ? 1 : 0;
      // The public call may be ordinary ten-point strength OR a bounded
      // weaker eight-card playing source. A five-card possible shape cannot
      // combine the weak branch's HCP with the ordinary branch's length.
      const conditionalHcp = Math.max(hcp + shapeHcpExtra,
        ...(constraints.pointSources ?? []).flatMap(source => source.playingSourceCompensation
          ? [shape[suits.indexOf(source.playingSourceCompensation.suit)] < source.playingSourceCompensation.minLength
            ? source.playingSourceCompensation.normalHcpMinimum : source.playingSourceCompensation.minHcp] : []));
      minimumAdjustment = Math.min(minimumAdjustment,
        conditionalHcp - hcp + shortness + Math.max(0, ownTrumpLength + trumpLength - 8));
    }
  }
  // Contradictory observations must not invent support points.
  return Math.max(shown, hcp + (Number.isFinite(minimumAdjustment) ? minimumAdjustment : 0));
}

export function countKeycards(hand: Card[], trump: Suit): number {
  return hand.filter(card => card.rank === 14 || (card.suit === trump && card.rank === 13)).length;
}

export const hasTrumpQueen = (hand: Card[], trump: Suit): boolean => hand.some(card => card.suit === trump && card.rank === 12);

/** RKCB 1430 response requested by the project: 1/4, 0/3, 2/5 without Q, 2/5 with Q. */
export function rkcb1430Response(keycards: number, trumpQueen: boolean): Extract<Call, { kind: 'bid' }> {
  if (keycards === 1 || keycards === 4) return { kind: 'bid', level: 5, strain: 'C' };
  if (keycards === 0 || keycards === 3) return { kind: 'bid', level: 5, strain: 'D' };
  return { kind: 'bid', level: 5, strain: trumpQueen ? 'S' : 'H' };
}

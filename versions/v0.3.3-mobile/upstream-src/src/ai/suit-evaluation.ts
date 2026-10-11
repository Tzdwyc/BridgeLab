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

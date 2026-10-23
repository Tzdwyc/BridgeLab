import { sideOf, type GameState, type Seat } from '../core/types';
import { controllerFor } from '../core/game';
import { analysisPosition } from '../analysis/adapter';
import { AnalysisClient } from '../analysis/client';
import { type PlayDecision } from '../ai/play-advisor-types';

const claimAnalysis = new AnalysisClient();

export function guaranteedClaimTricks(game: GameState, claimant: Seat, declarerTricks: number): number {
  if (game.phase !== 'play' || !game.contract || controllerFor(game) !== claimant) throw new Error('当前不能声称');
  if (!Number.isInteger(declarerTricks) || declarerTricks < 0 || declarerTricks > 13) throw new Error('DDS 声称结果无效');
  const claimantSide = sideOf(claimant);
  const finalForClaimant = sideOf(game.contract.declarer) === claimantSide ? declarerTricks : 13 - declarerTricks;
  const guaranteed = finalForClaimant - game.tricksWon[claimantSide];
  const remaining = 13 - game.completedTricks.length;
  if (!Number.isInteger(guaranteed) || guaranteed < 0 || guaranteed > remaining) throw new Error('DDS 声称结果超出剩余墩数');
  return guaranteed;
}

/** Exact four-hand adjudication is isolated from normal limited-information robot strategy. */
export async function adjudicateClaim(game: GameState, claimant: Seat): Promise<number> {
  const result = await claimAnalysis.solve(analysisPosition(game));
  return guaranteedClaimTricks(game, claimant, result.declarerTricks);
}

export interface RobotClaimSuggestion { seat: Seat; tricks: number; remainingTricks: number; publicKey: string }

/** Robot proposals use only the sampled public-information decision, never the real hidden hands. */
export function suggestRobotClaim(game: GameState, decision: PlayDecision | null): RobotClaimSuggestion | null {
  if (game.phase !== 'play' || !game.contract || !decision || decision.engine !== 'sampled-dds' || decision.fallback || decision.sampleCount < 8) return null;
  const selected = decision.candidates.find(candidate => candidate.cardId === decision.cardId);
  if (!selected || selected.support !== decision.sampleCount || selected.worstDeclarerTricks !== selected.bestDeclarerTricks) return null;
  const seat = controllerFor(game); const claimantSide = sideOf(seat); const declaringSide = sideOf(game.contract.declarer);
  const finalForClaimant = claimantSide === declaringSide ? selected.worstDeclarerTricks : 13 - selected.bestDeclarerTricks;
  const tricks = finalForClaimant - game.tricksWon[claimantSide];
  const remainingTricks = 13 - game.completedTricks.length;
  if (!Number.isInteger(tricks) || tricks < 0 || tricks > remainingTricks) return null;
  // Avoid noisy early claims: either the robot can take everything, or five or fewer tricks remain.
  if (tricks !== remainingTricks && remainingTricks > 5) return null;
  return { seat, tricks, remainingTricks, publicKey: decision.publicKey };
}

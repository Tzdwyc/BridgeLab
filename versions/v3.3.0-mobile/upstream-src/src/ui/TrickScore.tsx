import { sideOf, type Contract, type GameState } from '../core/types';
import { ContractDisplay } from './SuitGlyph';
import { seatName } from './format';
import styles from './TrickScore.module.css';

export type TrickScoreSummary = {
  ns: number; ew: number; remaining: number; target: number | null;
  declarerSide: 'NS' | 'EW' | null; settled: boolean; outcome: string;
};

/** Short phone wording uses only public awarded tricks and the contract target. */
export function compactTrickOutcome(score: TrickScoreSummary) {
  if (score.target === null || score.declarerSide === null) return '';
  const won = score.declarerSide === 'NS' ? score.ns : score.ew;
  const difference = won - score.target;
  if (score.settled) return difference === 0 ? '成约' : difference > 0 ? `超 ${difference} 墩` : `宕 ${-difference} 墩`;
  if (difference >= 0) return '已够墩';
  const unavoidable = score.target - won - score.remaining;
  return unavoidable > 0 ? `至少宕 ${unavoidable} 墩` : `还差 ${-difference} 墩`;
}

const boundedTricks = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(13, Math.round(value))) : 0;

/** Only awarded public tricks, or the final settlement, determine the outcome. */
export function trickScoreState(game: GameState) {
  const declarerSide = game.contract ? sideOf(game.contract.declarer) : null;
  const target = game.contract ? game.contract.level + 6 : null;
  let ns = boundedTricks(game.tricksWon.NS);
  let ew = boundedTricks(game.tricksWon.EW);
  const settled = game.phase === 'complete' && !!game.result && !!declarerSide;
  if (settled) {
    const won = boundedTricks(game.result!.declarerTricks);
    ns = declarerSide === 'NS' ? won : 13 - won;
    ew = 13 - ns;
  }
  const remaining = settled ? 0 : Math.max(0, 13 - ns - ew);
  const won = declarerSide === 'NS' ? ns : ew;
  const outcome = target === null ? '' : won >= target ? '已确保成约'
    : won + remaining < target ? '已确定宕约' : `还需 ${target - won} 墩成约`;
  return { ns, ew, remaining, target, declarerSide, settled, outcome };
}

export function TrickScore({ game }: { game: GameState }) {
  const score = trickScoreState(game);
  if (!game.contract) return null;
  return <TrickScoreMeter score={score} contract={game.contract} statusLabel={score.settled ? game.claim ? '声称已结算' : '本副已完成' : undefined} />;
}

/** Presentation accepts public awarded-trick totals, including LAN summaries. */
export function TrickScoreMeter({ score, contract, statusLabel }: { score: TrickScoreSummary; contract?: Contract; statusLabel?: string }) {
  if (score.target === null) return null;
  return <section className={styles.trickScore} aria-label="已得墩数" data-testid="trick-score" data-remaining={score.remaining} data-settled={score.settled || undefined} data-contract={!!contract || undefined}>
    <div className={styles.scoreHeader}>
      {contract && <div className={styles.scoreContract} data-testid="score-contract"><strong><ContractDisplay contract={contract} /></strong><span>{seatName[contract.declarer]}家庄</span></div>}
      <span className={styles.scoreTargetCaption} data-testid="score-target-caption">目标 {score.target} 墩</span>
      <div className={styles.scoreOutcome} aria-live="polite"><span className={styles.fullOutcome}>{score.outcome}</span><span className={styles.compactOutcome}>{compactTrickOutcome(score)}</span><small>{statusLabel ?? (score.settled ? '本副已完成' : `剩余 ${score.remaining} 墩`)}</small></div>
    </div>
    <div className={styles.scoreSides}>
      {(['NS', 'EW'] as const).map(side => {
        const value = side === 'NS' ? score.ns : score.ew;
        const declarer = score.declarerSide === side;
        return <div key={side} className={styles.scoreSide} data-side={side} data-declarer={declarer || undefined} role="meter" aria-label={`${side === 'NS' ? '南北' : '东西'}已得墩数${declarer ? `，成约目标 ${score.target} 墩` : ''}`} aria-valuemin={0} aria-valuemax={13} aria-valuenow={value}>
          <span>{side === 'NS' ? '南北' : '东西'}{declarer && <small>庄</small>}</span><strong>{value}</strong>
        </div>;
      })}
    </div>
    <div className={styles.scoreTrack} data-testid="score-horizontal-bar" aria-hidden="true">
      {Array.from({ length: 13 }, (_, index) => <span className={styles.scoreSegment} data-side={index < score.ns ? 'NS' : index >= 13 - score.ew ? 'EW' : undefined} key={index} />)}
      {score.declarerSide && <span className={styles.scoreTarget} data-testid="score-target" data-target={score.target} style={{ left: `${(score.declarerSide === 'NS' ? score.target : 13 - score.target) / 13 * 100}%` }} />}
    </div>
  </section>;
}

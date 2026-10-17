import type { CSSProperties } from 'react';
import { sideOf, type GameState } from '../core/types';
import styles from './App.module.css';

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
  return <section className={styles.trickScore} aria-label="已得墩数" data-testid="trick-score" data-remaining={score.remaining} data-settled={score.settled || undefined}>
    <div className={styles.scoreColumns}>
      {(['NS', 'EW'] as const).map(side => {
        const value = side === 'NS' ? score.ns : score.ew;
        const declarer = score.declarerSide === side;
        return <div key={side} className={styles.scoreColumn} data-side={side} data-declarer={declarer || undefined}>
          <div className={styles.scoreColumnTrack} role="meter" aria-label={`${side === 'NS' ? '南北' : '东西'}已得墩数${declarer ? `，成约目标 ${score.target} 墩` : ''}`} aria-valuemin={0} aria-valuemax={13} aria-valuenow={value}>
            <div className={styles.scoreColumnFill} style={{ height: `${value / 13 * 100}%` }} />
            <span className={styles.scoreColumnValue} style={{ '--achieved': value / 13 } as CSSProperties}>{value}</span>
            {declarer && <span className={styles.scoreColumnTarget} data-testid="score-target" data-target={score.target} style={{ bottom: `${score.target! / 13 * 100}%` }}><span>目标 {score.target}</span></span>}
          </div>
          <span className={styles.scoreColumnLabel}>{side === 'NS' ? '南北' : '东西'}{declarer && <small>庄</small>}</span>
        </div>;
      })}
    </div>
    <div className={styles.scoreOutcome} aria-live="polite"><span>{score.outcome}</span><small>{score.settled ? game.claim ? '声称已结算' : '本副已完成' : `剩余 ${score.remaining} 墩`}</small></div>
  </section>;
}

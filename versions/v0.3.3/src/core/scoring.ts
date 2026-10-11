import { type Contract, type ScoreBreakdown } from './types';

/** Standard duplicate raw score, viewed from declarer's partnership. */
export function scoreContract(contract: Pick<Contract, 'level' | 'strain' | 'doubled'>, tricks: number, vulnerable: boolean): ScoreBreakdown {
  const { level, strain, doubled } = contract;
  if (!Number.isInteger(level) || level < 1 || level > 7 || !['C', 'D', 'H', 'S', 'NT'].includes(strain) || ![0, 1, 2].includes(doubled) || !Number.isInteger(tricks) || tricks < 0 || tricks > 13) throw new Error('计分参数不合法');
  const score: ScoreBreakdown = { contractPoints: 0, overtrickPoints: 0, gameBonus: 0, slamBonus: 0, insultBonus: 0, penalty: 0, total: 0 };
  const difference = tricks - level - 6;
  if (difference < 0) {
    const down = -difference;
    if (!doubled) score.penalty = down * (vulnerable ? 100 : 50);
    else {
      const doubledPenalty = vulnerable ? 200 + (down - 1) * 300 : 100 + Math.min(down - 1, 2) * 200 + Math.max(down - 3, 0) * 300;
      score.penalty = doubledPenalty * (doubled === 2 ? 2 : 1);
    }
    score.total = -score.penalty; return score;
  }
  const unit = strain === 'C' || strain === 'D' ? 20 : 30;
  score.contractPoints = (level * unit + (strain === 'NT' ? 10 : 0)) * (2 ** doubled);
  score.overtrickPoints = difference * (doubled ? (vulnerable ? 200 : 100) * (doubled === 2 ? 2 : 1) : unit);
  score.gameBonus = score.contractPoints >= 100 ? (vulnerable ? 500 : 300) : 50;
  score.slamBonus = level === 6 ? (vulnerable ? 750 : 500) : level === 7 ? (vulnerable ? 1500 : 1000) : 0;
  score.insultBonus = doubled === 1 ? 50 : doubled === 2 ? 100 : 0;
  score.total = score.contractPoints + score.overtrickPoints + score.gameBonus + score.slamBonus + score.insultBonus;
  return score;
}

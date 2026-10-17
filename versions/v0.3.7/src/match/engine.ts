import { isFinished, newGame, replay, toRecord } from '../core/game';
import type { GameRecord, GameState } from '../core/types';
import { BIDDING_SYSTEM_IDS, type BiddingSystem } from '../ai/systems';
import type { PlayStrength } from '../ai/play-advisor-types';
import { describeCall } from '../ai/bidding';

export type MatchMode = 'total' | 'imp';
export interface MatchOptions { mode: MatchMode; boardCount?: 8 | 16 | 24; assisted?: boolean; seed?: string; biddingSystem?: BiddingSystem; playStrength?: PlayStrength }
export interface MatchBoard {
  number: number; main: GameRecord; reference: GameRecord | null;
  mainExplanations?: string[]; referenceExplanations?: string[];
  scoreNS: number | null; referenceScoreNS: number | null; difference: number | null; imps: number | null;
}
export interface Match {
  version: 1; id: string; mode: MatchMode; boardCount: number | null; assisted: boolean;
  status: 'active' | 'completed' | 'unfinished'; createdAt: string; updatedAt: string; endedAt?: string;
  seed: string; currentBoard: number; config: { biddingSystem: BiddingSystem; playStrength: PlayStrength };
  boards: MatchBoard[]; totalScore: number; totalImps: number; completedBoards: number;
  legacy?: boolean; resumedFrom?: string; softwareVersion?: string;
}
export type MatchSummary = Omit<Match, 'boards'>;
/** Inclusive lower limits of the standard WBF 1..24 IMP bands. */
export const IMP_THRESHOLDS = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000] as const;
export function scoreToImps(difference: number): number {
  if (!Number.isFinite(difference)) throw new Error('分差无效');
  const points = IMP_THRESHOLDS.filter(limit => Math.abs(difference) >= limit).length;
  return points === 0 ? 0 : Math.sign(difference) * points;
}
export function createMatch(id: string, options: MatchOptions, config: Match['config']): Match {
  if (!['total', 'imp'].includes(options.mode) || ![8, 16, 24].includes(options.boardCount ?? 16)) throw new Error('比赛模式或副数无效');
  config = { biddingSystem: options.biddingSystem ?? config.biddingSystem, playStrength: options.playStrength ?? config.playStrength };
  if (!BIDDING_SYSTEM_IDS.includes(config.biddingSystem) || !['basic', 'standard', 'challenge'].includes(config.playStrength)) throw new Error('比赛配置无效');
  const now = new Date().toISOString();
  const match: Match = { version: 1, id, mode: options.mode, boardCount: options.mode === 'total' ? null : options.boardCount ?? 16, assisted: options.assisted ?? false,
    seed: (options.seed?.trim() || id).slice(0, 160), status: 'active', createdAt: now, updatedAt: now, currentBoard: 1,
    config: { ...config }, boards: [], totalScore: 0, totalImps: 0, completedBoards: 0, softwareVersion: '0.3.7' };
  return appendBoard(match);
}
export function appendBoard(match: Match): Match {
  if (match.boardCount !== null && match.boards.length >= match.boardCount) return match;
  if (match.boards.length >= 5000) throw new Error('本次累计分已达 5000 副，请结束存档后开始新场');
  const number = match.boards.length + 1;
  const record = toRecord(newGame(number, `${match.seed}:board:${number}`));
  return { ...match, currentBoard: number, boards: [...match.boards, { number, main: record, reference: match.mode === 'imp' ? structuredClone(record) : null,
    mainExplanations: [], ...(match.mode === 'imp' ? { referenceExplanations: [] } : {}),
    scoreNS: null, referenceScoreNS: null, difference: null, imps: null }] };
}
/** All derived results are recomputed from replayed actions; recovery never adds a score twice. */
export function reconcileMatch(match: Match): Match {
  let totalScore = 0, totalImps = 0, completedBoards = 0;
  const boards = match.boards.map(board => {
    const main = replay(board.main), reference = board.reference ? replay(board.reference) : null;
    const scoreNS = isFinished(main) ? main.result!.scoreNS : null;
    const referenceScoreNS = reference && isFinished(reference) ? reference.result!.scoreNS : null;
    const difference = scoreNS !== null && referenceScoreNS !== null ? scoreNS - referenceScoreNS : null;
    const imps = difference === null ? null : scoreToImps(difference);
    totalScore += scoreNS ?? 0; totalImps += imps ?? 0;
    if (scoreNS !== null && (match.mode === 'total' || referenceScoreNS !== null)) completedBoards++;
    return { ...board, scoreNS, referenceScoreNS, difference, imps };
  });
  const completed = match.mode === 'imp' && completedBoards === match.boardCount;
  return { ...match, boards, totalScore, totalImps, completedBoards,
    status: completed ? 'completed' : match.status, ...(completed ? { endedAt: match.endedAt ?? new Date().toISOString() } : {}) };
}
export function updateMatchTable(match: Match, table: 'main' | 'reference', game: GameState): Match {
  if (match.status !== 'active') throw new Error('已归档比赛不能修改');
  const board = match.boards[match.currentBoard - 1];
  if (!board || game.seed !== board.main.seed || game.board !== board.number || (table === 'reference' && match.mode !== 'imp')) throw new Error('比赛牌局标识不匹配');
  const key = table === 'main' ? 'mainExplanations' : 'referenceExplanations';
  const previousRecord = board[table]!;
  const previousCalls = previousRecord.actions.filter(action => action.kind === 'call');
  const frozen = board[key];
  // Missing historical snapshots stay explicitly unknown; never fabricate past meanings.
  let explanations: string[] | undefined;
  if (frozen !== undefined || previousCalls.length === 0 || game.auction.length === 0) {
    let unchanged = 0;
    while (unchanged < game.auction.length && unchanged < previousCalls.length && frozen?.[unchanged] !== undefined) {
      const old = previousCalls[unchanged], current = game.auction[unchanged];
      if (old.seat !== current.seat || JSON.stringify(old.call) !== JSON.stringify(current.call)) break;
      unchanged++;
    }
    explanations = game.auction.map((entry, i) => i < unchanged ? frozen![i]
      : describeCall(game.auction.slice(0, i), entry.seat, entry.call, match.config.biddingSystem));
  }
  const boards = match.boards.map(item => item.number === board.number ? { ...item, [table]: toRecord(game), [key]: explanations } : item);
  return reconcileMatch({ ...match, boards, updatedAt: new Date().toISOString() });
}
export function validateMatch(value: unknown): Match {
  const m = value as Match;
  if (!m || m.version !== 1 || typeof m.id !== 'string' || !m.id || m.id.length > 240 || !['total', 'imp'].includes(m.mode)
    || !['active', 'completed', 'unfinished'].includes(m.status) || typeof m.assisted !== 'boolean'
    || (m.mode === 'imp' ? ![8, 16, 24].includes(m.boardCount!) : m.boardCount !== null && (!m.legacy || !Number.isInteger(m.boardCount) || m.boardCount < 1 || m.boardCount > 5001))
    || typeof m.seed !== 'string' || typeof m.createdAt !== 'string' || typeof m.updatedAt !== 'string'
    || (m.softwareVersion !== undefined && (typeof m.softwareVersion !== 'string' || !m.softwareVersion.length || m.softwareVersion.length > 80))
    || !m.config || !BIDDING_SYSTEM_IDS.includes(m.config.biddingSystem) || !['basic', 'standard', 'challenge'].includes(m.config.playStrength)
    || !Array.isArray(m.boards) || !m.boards.length || m.boards.length > 5001 || (m.boardCount !== null && m.boards.length > m.boardCount)
    || !Number.isInteger(m.currentBoard) || m.currentBoard < 1 || m.currentBoard > m.boards.length || (!m.legacy && m.currentBoard !== m.boards.length)) throw new Error('比赛存档格式无效');
  m.boards.forEach((board, i) => {
    if (board.number !== i + 1 || board.main.board !== board.number) throw new Error('比赛局号不连续');
    const main = replay(board.main);
    const validateExplanations = (explanations: unknown, length: number) => {
      if (explanations !== undefined && (!Array.isArray(explanations) || explanations.length !== length
        || explanations.some(text => typeof text !== 'string' || !text.length || text.length > 2000))) throw new Error('历史叫牌释义快照无效');
    };
    validateExplanations(board.mainExplanations, main.auction.length);
    if (m.mode === 'imp') {
      if (!board.reference) throw new Error('缺少参考桌');
      const ref = replay(board.reference);
      validateExplanations(board.referenceExplanations, ref.auction.length);
      if (ref.board !== main.board || ref.seed !== main.seed || ref.dealer !== main.dealer || ref.vulnerability !== main.vulnerability
        || JSON.stringify(ref.initialHands) !== JSON.stringify(main.initialHands)) throw new Error('双桌牌例不一致');
    } else if (board.reference !== null || board.referenceExplanations !== undefined) throw new Error('累计分比赛含参考桌');
    if (i < m.currentBoard - 1 && (!isFinished(main) || (board.reference && !isFinished(replay(board.reference))))) throw new Error('之前的牌局未完成');
  });
  const reconciled = reconcileMatch(structuredClone(m));
  if (m.status === 'completed' && reconciled.completedBoards !== (m.mode === 'imp' ? m.boardCount : m.boards.length)) throw new Error('已完成比赛缺少结果');
  return reconciled;
}
export function matchSummary(match: Match): MatchSummary { const { boards: _boards, ...summary } = match; return summary; }

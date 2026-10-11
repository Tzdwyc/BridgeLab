import { type GameState, type GameRecord } from '../core/types';
import { controllerFor, isFinished, replay, toRecord } from '../core/game';
import { BIDDING_SYSTEM_IDS, type BiddingSystem } from '../ai/systems';
import { type PlayStrength } from '../ai/play-advisor-types';

export const STORAGE_KEY = 'bridgelab.session.v3.3';
export interface Session { game: GameState | null; undo: number[]; history: GameState[]; delay: number; biddingSystem: BiddingSystem; gameSystem: BiddingSystem; playStrength: PlayStrength }
interface SaveFile { version: 1; current: GameRecord | null; undo: number[]; history: GameRecord[]; delay: number; biddingSystem?: BiddingSystem; gameSystem?: BiddingSystem; playStrength?: PlayStrength }
export const emptySession = (): Session => ({ game: null, undo: [], history: [], delay: 650, biddingSystem: 'sayc', gameSystem: 'sayc', playStrength: 'challenge' });

export function encodeSession(session: Session): string {
  const file: SaveFile = { version: 1, current: session.game ? toRecord(session.game) : null, undo: session.undo, history: session.history.map(toRecord), delay: session.delay, biddingSystem: session.biddingSystem, gameSystem: session.gameSystem, playStrength: session.playStrength };
  return JSON.stringify(file);
}

export function decodeSession(raw: string): Session {
  const file = JSON.parse(raw) as SaveFile;
  if (!file || file.version !== 1 || !Array.isArray(file.undo) || !Array.isArray(file.history) || file.history.length > 5000 || ![0, 250, 650, 1100].includes(file.delay)) throw new Error('存档版本或格式不受支持');
  const game = file.current === null ? null : replay(file.current);
  if ((file.biddingSystem !== undefined && !BIDDING_SYSTEM_IDS.includes(file.biddingSystem)) || (file.gameSystem !== undefined && !BIDDING_SYSTEM_IDS.includes(file.gameSystem))) throw new Error('叫牌体系无效');
  if (file.playStrength !== undefined && !['basic', 'standard', 'challenge'].includes(file.playStrength)) throw new Error('打牌强度无效');
  const history = file.history.map(record => {
    const state = replay(record);
    if (!isFinished(state)) throw new Error('历史牌局未结束');
    return state;
  });
  if (file.undo.length > 100 || (!game && file.undo.length)) throw new Error('悔牌记录损坏');
  let last = -1;
  for (const point of file.undo) {
    if (!game || !Number.isInteger(point) || point <= last || point < 0 || point >= game.actions.length) throw new Error('悔牌位置无效');
    const snapshot = replay({ ...toRecord(game), actions: game.actions.slice(0, point) });
    if (isFinished(snapshot) || controllerFor(snapshot) !== 'S') throw new Error('悔牌记录不是玩家决策点');
    last = point;
  }
  if (history.some((state, i) => state.board !== i + 1) || (game && game.board !== history.length + 1)) throw new Error('连续牌局的局号不一致');
  return { game, undo: file.undo, history, delay: file.delay, biddingSystem: file.biddingSystem ?? 'sayc', gameSystem: file.gameSystem ?? (game && !isFinished(game) ? 'natural-lite' : 'sayc'), playStrength: file.playStrength ?? 'challenge' };
}

export function loadSession(storage: Pick<Storage, 'getItem' | 'setItem'>): { session: Session; notice: string | null } {
  try {
    const selectedKey = STORAGE_KEY;
    const raw = storage.getItem(selectedKey);
    if (!raw) return { session: emptySession(), notice: null };
    try { return { session: decodeSession(raw), notice: null }; }
    catch {
      // Preserve the rejected save before a new session ever replaces it.
      storage.setItem(`${selectedKey}.rejected.${Date.now()}`, raw);
      return { session: emptySession(), notice: '存档损坏或版本不兼容，已保留原始备份。可开始新牌局。' };
    }
  } catch { return { session: emptySession(), notice: '浏览器暂不允许保存数据。本次仍可游戏，请保持页面打开。' }; }
}

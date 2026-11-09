import { type GameState, type GameRecord } from '../core/types';
import { controllerFor, isFinished, replay, toRecord } from '../core/game';
import { BIDDING_SYSTEM_IDS, type BiddingSystem } from '../ai/systems';
import { agreementVersionFor } from '../ai/bid-strategy';
import { type PlayStrength } from '../ai/play-advisor-types';
import { validateMatch, type Match } from '../match/engine';

export const STORAGE_KEY = 'bridgelab.session.v3.6';
export const LEGACY_STORAGE_KEY = 'bridgelab.session.v3.5';
export interface Session { game: GameState | null; undo: number[]; history: GameState[]; delay: number; biddingSystem: BiddingSystem; gameSystem: BiddingSystem; playStrength: PlayStrength; activeMatch?: Match | null }
const SYSTEM_SCHEMA = 'v330-natural-default';
interface SaveFile { version: 1; systemSchema?: typeof SYSTEM_SCHEMA; current: GameRecord | null; undo: number[]; history: GameRecord[]; delay: number; biddingSystem?: BiddingSystem; gameSystem?: BiddingSystem; playStrength?: PlayStrength; activeMatch?: Match | null }
export const emptySession = (): Session => ({ game: null, undo: [], history: [], delay: 650, biddingSystem: 'two-over-one', gameSystem: 'two-over-one', playStrength: 'challenge' });

export function encodeSession(session: Session): string {
  const file: SaveFile = { version: 1, systemSchema: SYSTEM_SCHEMA, current: session.game ? toRecord(session.game) : null, undo: session.undo, history: session.history.map(toRecord), delay: session.delay, biddingSystem: session.biddingSystem, gameSystem: session.gameSystem, playStrength: session.activeMatch?.config.playStrength ?? 'challenge', ...(session.activeMatch !== undefined ? { activeMatch: session.activeMatch } : {}) };
  return JSON.stringify(file);
}

export function decodeSession(raw: string): Session {
  const file = JSON.parse(raw) as SaveFile;
  if (!file || file.version !== 1 || !Array.isArray(file.undo) || !Array.isArray(file.history) || file.history.length > 5000 || ![0, 250, 650, 1100].includes(file.delay)) throw new Error('存档版本或格式不受支持');
  if (file.systemSchema !== undefined && file.systemSchema !== SYSTEM_SCHEMA) throw new Error('叫牌体系存档版本不受支持');
  const game = file.current === null ? null : replay(file.current);
  if ((file.biddingSystem !== undefined && !BIDDING_SYSTEM_IDS.includes(file.biddingSystem)) || (file.gameSystem !== undefined && !BIDDING_SYSTEM_IDS.includes(file.gameSystem))) throw new Error('叫牌体系无效');
  if (game?.biddingSystem && file.gameSystem && game.biddingSystem !== file.gameSystem) throw new Error('牌局体系与保存的冻结设置不一致');
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
  const activeMatch = file.activeMatch ? validateMatch(file.activeMatch) : file.activeMatch;
  if (activeMatch) {
    const current = activeMatch.boards[activeMatch.currentBoard - 1].main;
    if (!game || JSON.stringify(toRecord(game)) !== JSON.stringify(current)) throw new Error('当前牌局与比赛进度不一致');
    if (file.gameSystem !== activeMatch.config.biddingSystem || file.playStrength !== activeMatch.config.playStrength) throw new Error('比赛设置与冻结配置不一致');
  }
  if (file.systemSchema === undefined) {
    // Validate the original first; migrate only metadata, never the recorded deals or actions.
    const migrated = structuredClone(file);
    migrated.systemSchema = SYSTEM_SCHEMA;
    migrated.biddingSystem = file.biddingSystem === undefined || file.biddingSystem === 'sayc' ? 'two-over-one' : file.biddingSystem;
    const frozenSystem = game?.biddingSystem ?? file.gameSystem ?? (game && !isFinished(game) ? 'natural-lite' : 'sayc');
    migrated.gameSystem = frozenSystem === 'sayc' ? 'two-over-one' : frozenSystem;
    const mapAgreement = (record: { biddingSystem?: BiddingSystem; agreementVersion?: string }) => {
      if (record.biddingSystem === 'sayc') {
        record.biddingSystem = 'two-over-one';
        record.agreementVersion = agreementVersionFor('two-over-one');
      }
    };
    if (migrated.current) mapAgreement(migrated.current);
    if (migrated.activeMatch) {
      mapAgreement(migrated.activeMatch.config);
      for (const board of migrated.activeMatch.boards) {
        mapAgreement(board.main);
        if (board.reference) mapAgreement(board.reference);
      }
    }
    return decodeSession(JSON.stringify(migrated));
  }
  return { game, undo: file.undo, history, delay: file.delay, biddingSystem: file.biddingSystem ?? 'two-over-one', gameSystem: game?.biddingSystem ?? file.gameSystem ?? (game && !isFinished(game) ? 'natural-lite' : 'two-over-one'), playStrength: 'challenge', ...(activeMatch !== undefined ? { activeMatch } : {}) };
}

export function loadSession(storage: Pick<Storage, 'getItem' | 'setItem'>): { session: Session; notice: string | null } {
  try {
    const selectedKey = storage.getItem(STORAGE_KEY) ? STORAGE_KEY : LEGACY_STORAGE_KEY;
    const raw = storage.getItem(selectedKey);
    if (!raw) return { session: emptySession(), notice: null };
    try {
      if (JSON.parse(raw).systemSchema === undefined) {
        const backupKey = `${selectedKey}.backup.v3.3.0`;
        if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
      }
      const session = decodeSession(raw);
      if (selectedKey === LEGACY_STORAGE_KEY) storage.setItem(`${LEGACY_STORAGE_KEY}.backup.v3.6`, raw);
      return { session, notice: null };
    }
    catch {
      // Preserve the rejected save before a new session ever replaces it.
      storage.setItem(`${selectedKey}.rejected.${Date.now()}`, raw);
      return { session: emptySession(), notice: '存档损坏或版本不兼容，已保留原始备份。可开始新牌局。' };
    }
  } catch { return { session: emptySession(), notice: '浏览器暂不允许保存数据。本次仍可游戏，请保持页面打开。' }; }
}

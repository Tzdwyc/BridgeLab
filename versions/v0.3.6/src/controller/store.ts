import { create } from 'zustand';
import { type Call, type GameState } from '../core/types';
import { applyCall, applyClaim, playCard, controllerFor, isFinished, newGame, newGameFromDeal, replay, toRecord } from '../core/game';
import { type Session, emptySession, encodeSession, loadSession, STORAGE_KEY } from '../persistence/session';
import { robotStepWithAdvisor } from './robot';
import { type BiddingSystem } from '../ai/systems';
import { type DealDefinition } from '../deal-editor/model';
import { type PlayDecision, type PlayStrength } from '../ai/play-advisor-types';
import { playAdvisor } from './play-advisor';
import { adjudicateClaim, suggestRobotClaim, type RobotClaimSuggestion } from './claim';
import { PlayAdvisorClient } from '../ai/play-advisor-client';
import { appendBoard, createMatch, matchSummary, updateMatchTable, validateMatch, type Match, type MatchOptions } from '../match/engine';
import * as library from '../persistence/library';
import { LEGACY_STORAGE_KEY } from '../persistence/session';

export function randomSeed(): string {
  // randomUUID requires HTTPS; getRandomValues also works on a local LAN HTTP page.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
}
export const cumulativeScore = (session: Session): number => session.history.reduce((n, g) => n + (g.result?.scoreNS ?? 0), 0) + (session.game?.result?.scoreNS ?? 0);

export interface GameStore extends Session {
  activeMatch: Match | null; referenceThinking: boolean; referenceError: string | null;
  startMatch: (options: MatchOptions) => Promise<void>;
  finishMatch: () => Promise<void>; archiveMatch: () => Promise<void>; resumeMatch: (id: string) => Promise<void>;
  listMatches: typeof library.listMatches; getMatch: typeof library.getMatch;
  exportMatches: typeof library.exportMatches; importMatches: typeof library.importMatches;
  notice: string | null; paused: boolean; thinking: boolean; lastDecision: PlayDecision | null;
  pendingRobotClaim: (RobotClaimSuggestion & { sourceSeed: string; sourceActions: number; continuation: GameState }) | null;
  start: (seed?: string) => Promise<void>; startCustom: (deal: DealDefinition) => Promise<void>; restart: () => void; nextBoard: () => void;
  call: (call: Call) => void; play: (cardId: string) => void;
  claim: (tricks: number) => Promise<{ accepted: boolean; message: string }>;
  acceptRobotClaim: () => void; rejectRobotClaim: () => void;
  undoDecision: () => void; stepAI: () => Promise<void>;
  setDelay: (delay: number) => void; setPaused: (paused: boolean) => void; clearNotice: () => void;
  setBiddingSystem: (system: BiddingSystem) => void;
  setPlayStrength: (strength: PlayStrength) => void;
}

function initial() {
  try { return loadSession(localStorage); }
  catch { return { session: emptySession(), notice: '当前浏览器不能保存牌局，本次仍可游戏。' }; }
}
const loaded = initial();
// Separate workers prevent reference-table beliefs/cancellation from sharing a user-hint context.
const referenceAdvisor = new PlayAdvisorClient();
let epoch = 0;
let referenceRun = 0;
let lifecycleBusy = false;
export const useGame = create<GameStore>((set, get) => {
  let referenceScheduled = false;
  const scheduleReference = () => {
    if (referenceScheduled) return;
    referenceScheduled = true;
    queueMicrotask(() => { referenceScheduled = false; void runReference(); });
  };
  const invalidate = (clearProposal = true) => { epoch++; referenceRun++; referenceAdvisor.cancel(); set({ thinking: false, referenceThinking: false, ...(clearProposal ? { pendingRobotClaim: null } : {}) }); };
  const positionMatches = (snapshot: GameState, token: number) => {
    const current = get();
    return epoch === token && !lifecycleBusy && !!current.game && current.game.seed === snapshot.seed && current.game.actions.length === snapshot.actions.length;
  };
  const save = (patch: Partial<GameStore>) => {
    const state = get();
    if (patch.game && state.activeMatch && patch.activeMatch === undefined) {
      patch.activeMatch = updateMatchTable(state.activeMatch, 'main', patch.game);
    }
    const next = { ...state, ...patch }; let notice = patch.notice === undefined ? next.notice : patch.notice;
    try { localStorage.setItem(STORAGE_KEY, encodeSession(next)); }
    catch { notice = '自动保存失败（存储被禁用或空间不足）。游戏仍可继续，请保持页面打开。'; }
    set({ ...patch, notice });
    if (next.activeMatch?.status === 'completed' && state.activeMatch?.status !== 'completed') {
      void library.putMatch(next.activeMatch).catch(() => set({ notice: '比赛已完成，但档案保存失败。请导出备份后再离开。' }));
    }
    scheduleReference();
  };
  const runReference = async () => {
    const state = get(), match = state.activeMatch;
    const board = match?.boards[(match?.currentBoard ?? 1) - 1];
    if (!match || match.status !== 'active' || match.mode !== 'imp' || !board?.reference || state.paused || lifecycleBusy || state.referenceThinking || !state.game || !isFinished(state.game) || isFinished(replay(board.reference))) return;
    const token = epoch, run = ++referenceRun, id = match.id, boardNumber = match.currentBoard;
    set({ referenceThinking: true, referenceError: null });
    try {
      while (true) {
        const current = get(), active = current.activeMatch;
        if (token !== epoch || run !== referenceRun || lifecycleBusy || current.paused || active?.id !== id || active.currentBoard !== boardNumber || active.status !== 'active') break;
        const record = active.boards[boardNumber - 1].reference!;
        const snapshot = replay(record);
        if (isFinished(snapshot)) break;
        const result = await robotStepWithAdvisor(snapshot, active.config.biddingSystem, active.config.playStrength, referenceAdvisor);
        const latest = get(), live = latest.activeMatch;
        if (token !== epoch || run !== referenceRun || lifecycleBusy || latest.paused || live?.id !== id || live.currentBoard !== boardNumber || live.status !== 'active'
          || live.boards[boardNumber - 1].reference?.actions.length !== snapshot.actions.length) break;
        // Reference robots always play out; no claim dialog or actual hidden-card adjudication.
        save({ activeMatch: updateMatchTable(live, 'reference', result.game) });
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (token === epoch && run === referenceRun) set({ referenceError: error instanceof Error ? error.message : '参考桌暂不可用，请重新进入牌桌重试。' });
    } finally { if (token === epoch && run === referenceRun) set({ referenceThinking: false }); }
  };
  const archiveCurrent = async () => {
    await migrationReady;
    const state = get();
    if (state.activeMatch) {
      const match = state.activeMatch;
      const completed = match.status === 'completed' || (match.mode === 'total' && match.completedBoards === match.boards.length);
      const archived: Match = match.status === 'completed' ? match : { ...match, status: completed ? 'completed' : 'unfinished', endedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await library.putMatch(archived);
    } else await library.archiveLegacySession(state);
  };
  const finishMatch = async () => {
    if (lifecycleBusy) return;
    lifecycleBusy = true; invalidate();
    try { await archiveCurrent(); save({ activeMatch: null, game: null, history: [], undo: [], paused: false }); }
    catch (error) { set({ notice: `存档失败，当前比赛已保留：${error instanceof Error ? error.message : '浏览器存储不可用'}` }); throw error; }
    finally { lifecycleBusy = false; }
  };
  const restricted = () => get().activeMatch?.mode === 'imp' && !get().activeMatch!.assisted;
  const humanAction = (advance: (game: GameState) => GameState) => {
    const state = get(); const game = state.game;
    if (lifecycleBusy || state.activeMatch?.status === 'completed' || state.pendingRobotClaim || state.thinking) return;
    if (!game || isFinished(game) || controllerFor(game) !== 'S') { set({ notice: '请等待轮到你行动。' }); return; }
    try { save({ game: advance(game), undo: [...state.undo, game.actions.length], notice: null, paused: false }); }
    catch (error) { set({ notice: error instanceof Error ? error.message : '操作失败，请重试。' }); }
  };
  return {
    ...loaded.session, activeMatch: loaded.session.activeMatch ?? null, referenceThinking: false, referenceError: null,
    notice: loaded.notice, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null,
    listMatches: async mode => {
      await migrationReady;
      const rows = await library.listMatches(mode), active = get().activeMatch;
      return active && (!mode || active.mode === mode) ? [matchSummary(structuredClone(active)), ...rows.filter(row => row.id !== active.id)] : rows;
    },
    getMatch: async id => { await migrationReady; const active = get().activeMatch; return active?.id === id ? structuredClone(active) : library.getMatch(id); },
    exportMatches: async () => {
      await migrationReady;
      const rows = await library.allMatches(), active = get().activeMatch;
      return JSON.stringify({ format: 'bridgelab.matches', version: 1, matches: active ? [structuredClone(active), ...rows.filter(row => row.id !== active.id)] : rows }, null, 2);
    },
    importMatches: async raw => {
      if (raw.length > 50_000_000) throw new Error('导入文件过大');
      const file = JSON.parse(raw), active = get().activeMatch;
      if (active && Array.isArray(file?.matches)) {
        for (const value of file.matches) if (value?.id === active.id && JSON.stringify(validateMatch(value)) !== JSON.stringify(active)) throw new Error('导入文件与当前比赛冲突，已保留当前进度');
        file.matches = file.matches.filter((value: { id?: string }) => value?.id !== active.id);
      }
      return library.importMatches(JSON.stringify(file));
    },
    finishMatch, archiveMatch: finishMatch,
    startMatch: async options => {
      if (lifecycleBusy) return;
      const match = createMatch(randomSeed(), options, { biddingSystem: get().biddingSystem, playStrength: get().playStrength });
      lifecycleBusy = true; invalidate();
      try {
        await archiveCurrent();
        save({ activeMatch: match, game: replay(match.boards[0].main), history: [], undo: [], gameSystem: match.config.biddingSystem,
          biddingSystem: match.config.biddingSystem, playStrength: match.config.playStrength, notice: null, paused: false, lastDecision: null, referenceError: null });
      } catch (error) { set({ notice: '旧比赛存档失败，尚未开始新比赛。请先备份。' }); throw error; }
      finally { lifecycleBusy = false; }
    },
    resumeMatch: async id => {
      if (lifecycleBusy) return;
      lifecycleBusy = true; invalidate();
      try {
        const archived = await library.getMatch(id);
        if (!archived || archived.status === 'completed' || archived.legacy) throw new Error('此比赛只能查看复盘');
        await archiveCurrent();
        const match: Match = { ...archived, id: randomSeed(), resumedFrom: archived.id, status: 'active', endedAt: undefined, updatedAt: new Date().toISOString() };
        save({ activeMatch: match, game: replay(match.boards[match.currentBoard - 1].main), history: match.boards.slice(0, match.currentBoard - 1).map(board => replay(board.main)),
          undo: [], gameSystem: match.config.biddingSystem, playStrength: match.config.playStrength, notice: null, paused: false, lastDecision: null, referenceError: null });
      } catch (error) { set({ notice: error instanceof Error ? error.message : '恢复比赛失败' }); throw error; }
      finally { lifecycleBusy = false; scheduleReference(); }
    },
    start: async seed => {
      if (lifecycleBusy || get().activeMatch) { set({ notice: '请先结束并保存当前比赛，再开始练习。' }); return; }
      lifecycleBusy = true; invalidate();
      try {
        await archiveCurrent();
        save({ activeMatch: null, game: newGame(1, seed?.trim().slice(0, 200) || randomSeed()), gameSystem: get().biddingSystem, undo: [], history: [], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null });
      } catch (error) { set({ notice: '旧牌局存档失败，当前练习已保留。' }); throw error; }
      finally { lifecycleBusy = false; }
    },
    startCustom: async deal => {
      if (lifecycleBusy || get().activeMatch) { set({ notice: '请先结束并保存当前比赛，再开始牌例练习。' }); return; }
      lifecycleBusy = true; invalidate();
      try {
        await archiveCurrent();
        save({ activeMatch: null, game: newGameFromDeal(1, `custom:${deal.id}`.slice(0, 200), deal.hands, deal.dealer, deal.vulnerability), gameSystem: get().biddingSystem, undo: [], history: [], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null });
      } catch (error) { set({ notice: '旧牌局存档失败，当前练习已保留。' }); throw error; }
      finally { lifecycleBusy = false; }
    },
    restart: () => {
      const state = get(), game = state.game;
      if (lifecycleBusy || restricted() || state.activeMatch?.status === 'completed' || (state.activeMatch && isFinished(game!) && state.activeMatch.boards[state.activeMatch.currentBoard - 1].referenceScoreNS !== null)) { set({ notice: '本场比赛不允许重打已结算牌局。' }); return; }
      invalidate(); if (game) save({ game: replay({ ...toRecord(game), actions: [] }), gameSystem: state.activeMatch?.config.biddingSystem ?? state.biddingSystem, undo: [], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null });
    },
    nextBoard: () => {
      const state = get(); if (!state.game || !isFinished(state.game)) return;
      if (lifecycleBusy) return;
      if (state.activeMatch) {
        const match = state.activeMatch;
        if (match.status === 'completed') return;
        if (match.mode === 'imp' && match.boards[match.currentBoard - 1].imps === null) { set({ notice: '参考桌尚未结束，请等待双桌结算。' }); scheduleReference(); return; }
        invalidate();
        const next = appendBoard(match);
        save({ activeMatch: next, game: replay(next.boards[next.currentBoard - 1].main), gameSystem: next.config.biddingSystem,
          history: [...state.history, state.game], undo: [], notice: null, paused: false, lastDecision: null, referenceError: null }); return;
      }
      invalidate();
      save({ game: newGame(state.game.board + 1, randomSeed()), gameSystem: state.biddingSystem, undo: [], history: [...state.history, state.game], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null });
    },
    call: call => humanAction(game => applyCall(game, game.turn, call)),
    play: cardId => humanAction(game => playCard(game, game.turn, cardId)),
    claim: async tricks => {
      const state = get(); const game = state.game;
      if (!game || game.phase !== 'play' || controllerFor(game) !== 'S' || state.thinking) return { accepted: false, message: '当前不能声称，请等待轮到你方行动。' };
      if (!Number.isInteger(tricks) || tricks < 0 || tricks > 13 - game.completedTricks.length) return { accepted: false, message: '声称墩数不合法。' };
      if (lifecycleBusy || state.activeMatch?.status === 'completed') return { accepted: false, message: '比赛已结算。' };
      const snapshot = game, token = epoch; set({ thinking: true });
      try {
        const guaranteed = await adjudicateClaim(snapshot, 'S');
        const current = get();
        if (!positionMatches(snapshot, token) || current.game?.phase !== 'play') {
          if (token === epoch) set({ thinking: false }); return { accepted: false, message: '牌局位置已经变化，请重新声称。' };
        }
        if (tricks > guaranteed) {
          set({ thinking: false });
          return { accepted: false, message: 'DDS 无法确认你方能保证取得所声称的墩数。声称未成立，可减少墩数或继续打牌。' };
        }
        const remaining = 13 - snapshot.completedTricks.length;
        save({ game: applyClaim(snapshot, 'S', tricks), undo: [...state.undo, snapshot.actions.length], thinking: false, paused: false, lastDecision: null, notice: `DDS 接受声称：南北再得 ${tricks} 墩，其余 ${remaining - tricks} 墩归东西。` });
        return { accepted: true, message: '声称已接受并完成结算。' };
      } catch (error) {
        if (token === epoch) set({ thinking: false });
        return { accepted: false, message: `声称裁定失败：${error instanceof Error ? error.message : '本地 DDS 暂不可用'}。牌局未改变。` };
      }
    },
    acceptRobotClaim: () => {
      const state = get(); const proposal = state.pendingRobotClaim; const game = state.game;
      if (!proposal || !game || game.seed !== proposal.sourceSeed || game.actions.length !== proposal.sourceActions || game.phase !== 'play') { set({ pendingRobotClaim: null, paused: false }); return; }
      try {
        const claimantSide = proposal.seat === 'N' || proposal.seat === 'S' ? '南北' : '东西';
        save({ game: applyClaim(game, proposal.seat, proposal.tricks), undo: [...state.undo, game.actions.length], pendingRobotClaim: null, paused: false, thinking: false, notice: `你已同意${claimantSide}方机器人声称再得 ${proposal.tricks} 墩。` });
      } catch (error) { set({ pendingRobotClaim: null, paused: false, thinking: false, notice: error instanceof Error ? error.message : '机器人声称结算失败。' }); }
    },
    rejectRobotClaim: () => {
      const state = get(); const proposal = state.pendingRobotClaim; const game = state.game;
      if (!proposal || !game || game.seed !== proposal.sourceSeed || game.actions.length !== proposal.sourceActions) { set({ pendingRobotClaim: null, paused: false }); return; }
      save({ game: proposal.continuation, pendingRobotClaim: null, paused: false, thinking: false, notice: '你不同意机器人声称，牌局继续。' });
    },
    undoDecision: () => {
      const state = get(); const point = state.undo.at(-1); if (!state.game || point === undefined) return;
      if (lifecycleBusy || restricted() || state.activeMatch?.status === 'completed' || (state.activeMatch && state.activeMatch.boards[state.activeMatch.currentBoard - 1].referenceScoreNS !== null)) { set({ notice: '本场比赛不允许悔牌。' }); return; }
      invalidate();
      try { save({ game: replay({ ...toRecord(state.game), actions: state.game.actions.slice(0, point) }), undo: state.undo.slice(0, -1), notice: '已回到上一个玩家决策点。', paused: false, thinking: false, lastDecision: null }); }
      catch { set({ notice: '悔牌记录异常。当前牌局已保留，可重打本副。' }); }
    },
    stepAI: async () => {
      const state = get(); if (lifecycleBusy || !state.game || state.paused || state.thinking || state.pendingRobotClaim || isFinished(state.game) || controllerFor(state.game) === 'S') return;
      const snapshot = state.game, token = epoch; set({ thinking: true });
      try {
        const result = await robotStepWithAdvisor(snapshot, state.gameSystem, state.playStrength, playAdvisor);
        const current = get();
        if (!positionMatches(snapshot, token) || current.paused) { if (token === epoch) set({ thinking: false }); return; }
        const suggestion = suggestRobotClaim(snapshot, result.decision);
        if (suggestion) {
          set({ pendingRobotClaim: { ...suggestion, sourceSeed: snapshot.seed, sourceActions: snapshot.actions.length, continuation: result.game }, thinking: false, paused: true, lastDecision: result.decision });
          return;
        }
        save({ game: result.game, thinking: false, lastDecision: result.decision, ...(result.warning ? { notice: result.warning } : {}) });
      } catch { if (token === epoch) set({ notice: '牌局出现异常，已暂停。请重新进入牌桌重试。', paused: true, thinking: false }); }
    },
    setDelay: delay => { if ([0, 250, 650, 1100].includes(delay)) save({ delay }); },
    setBiddingSystem: system => { if (!get().activeMatch && (system === 'sayc' || system === 'two-over-one' || system === 'precision')) save({ biddingSystem: system }); },
    setPlayStrength: strength => { if (!get().activeMatch && ['basic', 'standard', 'challenge'].includes(strength)) save({ playStrength: strength }); },
    setPaused: paused => { if (paused) invalidate(false); set({ paused }); if (!paused) scheduleReference(); }, clearNotice: () => set({ notice: null })
  };
});

/** Route-level guard also covers direct analysis URLs while a competition is underway. */
export function canReviewGame(game: GameState): boolean {
  const match = useGame.getState().activeMatch;
  if (!match) return true;
  const matching = match.boards.find(board => {
    const main = replay(board.main);
    return (main.seed === game.seed && main.board === game.board) || (main.dealer === game.dealer && main.vulnerability === game.vulnerability && JSON.stringify(main.initialHands) === JSON.stringify(game.initialHands));
  });
  if (!matching) return true;
  if (match.mode === 'imp') return matching.scoreNS !== null && matching.referenceScoreNS !== null;
  return match.assisted || matching.scoreNS !== null;
}
export function eligibleCompletedGames(): GameState[] {
  const state = useGame.getState();
  const games = [...state.history, ...(state.game && isFinished(state.game) ? [state.game] : [])];
  return games.filter(game => isFinished(game) && canReviewGame(game));
}

// Migration never rewrites the old raw key, nor the independent analysis/editor libraries.
export const migrationReady: Promise<void> = (async () => {
  try {
    const raw = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (raw) {
      const { decodeSession } = await import('../persistence/session');
      const old = decodeSession(raw);
      localStorage.setItem(`${LEGACY_STORAGE_KEY}.backup.v3.6`, raw);
      await library.archiveLegacySession(old);
    }
  } catch { useGame.setState({ notice: '旧牌局迁移未完成，原始存档已保留；可稍后重试。' }); }
})();

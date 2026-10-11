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

export function randomSeed(): string {
  // randomUUID requires HTTPS; getRandomValues also works on a local LAN HTTP page.
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('');
}
export const cumulativeScore = (session: Session): number => session.history.reduce((n, g) => n + (g.result?.scoreNS ?? 0), 0) + (session.game?.result?.scoreNS ?? 0);

interface GameStore extends Session {
  notice: string | null; paused: boolean; thinking: boolean; lastDecision: PlayDecision | null;
  pendingRobotClaim: (RobotClaimSuggestion & { sourceSeed: string; sourceActions: number; continuation: GameState }) | null;
  start: (seed?: string) => void; startCustom: (deal: DealDefinition) => void; restart: () => void; nextBoard: () => void;
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
export const useGame = create<GameStore>((set, get) => {
  const save = (patch: Partial<GameStore>) => {
    const next = { ...get(), ...patch }; let notice = patch.notice === undefined ? next.notice : patch.notice;
    try { localStorage.setItem(STORAGE_KEY, encodeSession(next)); }
    catch { notice = '自动保存失败（存储被禁用或空间不足）。游戏仍可继续，请保持页面打开。'; }
    set({ ...patch, notice });
  };
  const humanAction = (advance: (game: GameState) => GameState) => {
    const state = get(); const game = state.game;
    if (!game || isFinished(game) || controllerFor(game) !== 'S') { set({ notice: '请等待轮到你行动。' }); return; }
    try { save({ game: advance(game), undo: [...state.undo, game.actions.length], notice: null, paused: false }); }
    catch (error) { set({ notice: error instanceof Error ? error.message : '操作失败，请重试。' }); }
  };
  return {
    ...loaded.session, notice: loaded.notice, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null,
    start: seed => save({ game: newGame(1, seed?.trim().slice(0, 200) || randomSeed()), gameSystem: get().biddingSystem, undo: [], history: [], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null }),
    startCustom: deal => save({ game: newGameFromDeal(1, `custom:${deal.id}`.slice(0, 200), deal.hands, deal.dealer, deal.vulnerability), gameSystem: get().biddingSystem, undo: [], history: [], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null }),
    restart: () => { const game = get().game; if (game) save({ game: replay({ ...toRecord(game), actions: [] }), gameSystem: get().biddingSystem, undo: [], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null }); },
    nextBoard: () => {
      const state = get(); if (!state.game || !isFinished(state.game)) return;
      save({ game: newGame(state.game.board + 1, randomSeed()), gameSystem: state.biddingSystem, undo: [], history: [...state.history, state.game], notice: null, paused: false, thinking: false, lastDecision: null, pendingRobotClaim: null });
    },
    call: call => humanAction(game => applyCall(game, game.turn, call)),
    play: cardId => humanAction(game => playCard(game, game.turn, cardId)),
    claim: async tricks => {
      const state = get(); const game = state.game;
      if (!game || game.phase !== 'play' || controllerFor(game) !== 'S' || state.thinking) return { accepted: false, message: '当前不能声称，请等待轮到你方行动。' };
      if (!Number.isInteger(tricks) || tricks < 0 || tricks > 13 - game.completedTricks.length) return { accepted: false, message: '声称墩数不合法。' };
      const snapshot = game; set({ thinking: true });
      try {
        const guaranteed = await adjudicateClaim(snapshot, 'S');
        const current = get();
        if (!current.game || current.game.seed !== snapshot.seed || current.game.actions.length !== snapshot.actions.length || current.game.phase !== 'play') {
          set({ thinking: false }); return { accepted: false, message: '牌局位置已经变化，请重新声称。' };
        }
        if (tricks > guaranteed) {
          set({ thinking: false });
          return { accepted: false, message: 'DDS 无法确认你方能保证取得所声称的墩数。声称未成立，可减少墩数或继续打牌。' };
        }
        const remaining = 13 - snapshot.completedTricks.length;
        save({ game: applyClaim(snapshot, 'S', tricks), undo: [...state.undo, snapshot.actions.length], thinking: false, paused: false, lastDecision: null, notice: `DDS 接受声称：南北再得 ${tricks} 墩，其余 ${remaining - tricks} 墩归东西。` });
        return { accepted: true, message: '声称已接受并完成结算。' };
      } catch (error) {
        set({ thinking: false });
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
      try { save({ game: replay({ ...toRecord(state.game), actions: state.game.actions.slice(0, point) }), undo: state.undo.slice(0, -1), notice: '已回到上一个玩家决策点。', paused: false, thinking: false, lastDecision: null }); }
      catch { set({ notice: '悔牌记录异常。当前牌局已保留，可重打本副。' }); }
    },
    stepAI: async () => {
      const state = get(); if (!state.game || state.paused || state.thinking || isFinished(state.game) || controllerFor(state.game) === 'S') return;
      const snapshot = state.game; set({ thinking: true });
      try {
        const result = await robotStepWithAdvisor(snapshot, state.gameSystem, state.playStrength, playAdvisor);
        const current = get();
        if (!current.game || current.paused || current.game.seed !== snapshot.seed || current.game.actions.length !== snapshot.actions.length) { set({ thinking: false }); return; }
        const suggestion = suggestRobotClaim(snapshot, result.decision);
        if (suggestion) {
          set({ pendingRobotClaim: { ...suggestion, sourceSeed: snapshot.seed, sourceActions: snapshot.actions.length, continuation: result.game }, thinking: false, paused: true, lastDecision: result.decision });
          return;
        }
        save({ game: result.game, thinking: false, lastDecision: result.decision, ...(result.warning ? { notice: result.warning } : {}) });
      } catch { set({ notice: '牌局出现异常，已暂停。可悔牌或重打本副恢复。', paused: true, thinking: false }); }
    },
    setDelay: delay => { if ([0, 250, 650, 1100].includes(delay)) save({ delay }); },
    setBiddingSystem: system => { if (system === 'sayc' || system === 'two-over-one' || system === 'precision') save({ biddingSystem: system }); },
    setPlayStrength: strength => { if (['basic', 'standard', 'challenge'].includes(strength)) save({ playStrength: strength }); },
    setPaused: paused => set({ paused }), clearNotice: () => set({ notice: null })
  };
});

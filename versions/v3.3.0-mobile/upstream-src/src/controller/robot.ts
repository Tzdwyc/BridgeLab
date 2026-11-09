import { type GameAction, type GameState } from '../core/types';
import { applyAction } from '../core/game';
import { observe, type BiddingObservation, type PlayObservation } from '../ai/observation';
import { chooseBid } from '../ai/bidding';
import { chooseCard } from '../ai/playing';
import { type BiddingSystem } from '../ai/systems';
import { type PlayAdvisorClient } from '../ai/play-advisor-client';
import { type PlayDecision, type PlayStrength } from '../ai/play-advisor-types';
import { chooseSystemBid, suggestSystemBid, recordAppliedSystemBid } from '../ai/bid-strategy';

export interface Strategy {
  bid: (obs: BiddingObservation) => ReturnType<typeof chooseBid>;
  play: (obs: PlayObservation) => string;
}
export const naturalStrategy: Strategy = { bid: chooseBid, play: chooseCard };
export const strategyFor = (system: BiddingSystem): Strategy => ({ bid: obs => chooseSystemBid(obs, system), play: obs => chooseCard(obs, system) });

export function robotStep(state: GameState, strategy: Strategy | undefined = undefined, system: BiddingSystem = state.biddingSystem ?? 'two-over-one'): { game: GameState; warning: string | null } {
  strategy ??= strategyFor(system);
  const obs = observe(state);
  const fallbackObservation = structuredClone(obs);
  try {
    const strategyObservation = structuredClone(obs);
    const action: GameAction = strategyObservation.phase === 'auction'
      ? { kind: 'call', seat: state.turn, call: strategy.bid(strategyObservation) }
      : { kind: 'play', seat: state.turn, cardId: strategy.play(strategyObservation) };
    return { game: applyAction(state, action), warning: null };
  } catch (error) {
    let fallback: GameAction;
    if (fallbackObservation.phase === 'auction') {
      let call: ReturnType<typeof chooseBid> | undefined;
      try { call = chooseSystemBid(fallbackObservation, system); }
      catch { call = system === 'precision'
        ? fallbackObservation.legalCalls.find(candidate => candidate.kind === 'pass') ?? fallbackObservation.legalCalls[0]
        : fallbackObservation.legalCalls.find(candidate => candidate.kind !== 'pass') ?? fallbackObservation.legalCalls[0]; }
      if (!call) throw error;
      fallback = { kind: 'call', seat: state.turn, call };
    } else fallback = { kind: 'play', seat: state.turn, cardId: chooseCard(fallbackObservation, system) };
    return { game: applyAction(state, fallback), warning: `机器人已使用安全备用动作：${error instanceof Error ? error.message : '策略异常'}` };
  }
}

export async function robotStepWithAdvisor(
  state: GameState,
  system: BiddingSystem,
  strength: PlayStrength,
  advisor: Pick<PlayAdvisorClient, 'advise'>,
  freePlay = false
): Promise<{ game: GameState; warning: string | null; decision: PlayDecision | null }> {
  const obs = observe(state);
  if (obs.phase === 'auction') {
    const selected = await suggestSystemBid(obs, { system, allowLookahead: false });
    const { baselineCall, reason } = selected.trace ?? { baselineCall: selected.call, reason: undefined };
    const game = applyAction(state, { kind: 'call', seat: state.turn, call: selected.call,
      ...(reason ? { robotBid: { baselineCall, reason } } : {}) });
    recordAppliedSystemBid(selected.trace);
    return { game, warning: null, decision: null };
  }
  try {
    const decision = await advisor.advise({ observation: obs, system, strength: 'challenge' });
    if (!obs.legalCards.some(card => card.id === decision.cardId)) throw new Error('实战分析返回了不合法的牌');
    return { game: applyAction(state, { kind: 'play', seat: state.turn, cardId: decision.cardId }), warning: decision.fallback ? decision.reasonTags.join('；') : null, decision };
  } catch (error) {
    const cardId = chooseCard(obs, system);
    const game = applyAction(state, { kind: 'play', seat: state.turn, cardId });
    return { game, decision: null, warning: `本地 DDS 暂不可用，已使用安全打法：${error instanceof Error ? error.message : '未知错误'}` };
  }
}

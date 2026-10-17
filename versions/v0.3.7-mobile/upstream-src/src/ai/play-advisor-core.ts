import { DdsEngine } from '../analysis/engine';
import { DDS_SUITS, pbnRank, normalizeResult } from '../analysis/adapter';
import { type AnalysisPosition } from '../analysis/types';
import { SEATS, sideOf, type Hands } from '../core/types';
import { chooseCard } from './playing';
import { type PlayObservation } from './observation';
import { buildPublicPlayModel } from './play-public-model';
import { sampleDeals } from './play-sampler';
import { type PlayAdviceRequest, type PlayCandidateEvaluation, type PlayDecision } from './play-advisor-types';

const sampleBudget = { basic: 0, standard: 8, challenge: 24 } as const;

function handsPbn(hands: Hands): string {
  return 'N:' + SEATS.map(seat => DDS_SUITS.map(suit => hands[seat]
    .filter(card => card.suit === suit).sort((a, b) => b.rank - a.rank).map(card => pbnRank(card.rank)).join('')).join('.')).join(' ');
}

function sampledPosition(obs: PlayObservation, hands: Hands, sampleKey: string): AnalysisPosition {
  const declaringSide = sideOf(obs.contract.declarer);
  const remainingTricks = 13 - obs.completedTricks.length;
  const leader = obs.currentTrick[0]?.seat ?? obs.actingSeat;
  const deal = {
    trump: obs.contract.strain === 'NT' ? 4 : DDS_SUITS.indexOf(obs.contract.strain),
    first: SEATS.indexOf(leader),
    currentTrickSuit: obs.currentTrick.map(play => DDS_SUITS.indexOf(play.card.suit)),
    currentTrickRank: obs.currentTrick.map(play => play.card.rank),
    remainCards: handsPbn(hands)
  };
  return {
    key: sampleKey, deal, actor: obs.actingSeat, declaringSide,
    wonByDeclarer: obs.tricksWon[declaringSide], remainingTricks,
    legalCards: obs.legalCards, terminalTricks: null
  };
}

function safetyDecision(obs: PlayObservation, system: PlayAdviceRequest['system'], started: number, reason: string, publicKey: string): PlayDecision {
  return { cardId: chooseCard(obs, system), candidates: [], sampleCount: 0, attemptedSamples: 0,
    elapsedMs: performance.now() - started, engine: 'safety', fallback: reason !== '基础安全层', reasonTags: [reason], publicKey };
}

export async function advisePlay(request: PlayAdviceRequest, suppliedEngine?: DdsEngine): Promise<PlayDecision> {
  const started = performance.now();
  const { observation: obs } = request;
  const publicKey = buildPublicPlayModel(obs).key;
  if (obs.legalCards.length === 1) return safetyDecision(obs, request.system, started, '只有一张合法牌', publicKey);
  const budget = sampleBudget[request.strength];
  if (!budget) return safetyDecision(obs, request.system, started, '基础安全层', publicKey);
  try {
    const { samples, attempts } = sampleDeals(obs, request.system, budget);
    const engine = suppliedEngine ?? await DdsEngine.create();
    const byCard = new Map<string, number[]>();
    for (const card of obs.legalCards) byCard.set(card.id, []);
    for (const sample of samples) {
      if (request.timeoutMs && performance.now() - started > request.timeoutMs) break;
      const position = sampledPosition(obs, sample.hands, JSON.stringify([publicKey, sample.key]));
      const result = normalizeResult(position, engine.raw(position.deal));
      for (const candidate of result.candidates) byCard.get(candidate.cardId)!.push(candidate.declarerTricks);
    }
    const completed = Math.min(...[...byCard.values()].map(values => values.length));
    if (!completed) throw new Error('DDS 未在时限内完成样本');
    const target = obs.contract.level + 6;
    const candidates: PlayCandidateEvaluation[] = obs.legalCards.map(card => {
      const values = byCard.get(card.id)!.slice(0, completed);
      return {
        cardId: card.id, support: values.length,
        expectedDeclarerTricks: values.reduce((sum, value) => sum + value, 0) / values.length,
        makeRate: values.filter(value => value >= target).length / values.length,
        worstDeclarerTricks: Math.min(...values), bestDeclarerTricks: Math.max(...values)
      };
    });
    const actorDeclares = sideOf(obs.actingSeat) === sideOf(obs.contract.declarer);
    const preferred = chooseCard(obs, request.system);
    candidates.sort((a, b) => {
      const make = actorDeclares ? b.makeRate - a.makeRate : a.makeRate - b.makeRate;
      const tricks = actorDeclares ? b.expectedDeclarerTricks - a.expectedDeclarerTricks : a.expectedDeclarerTricks - b.expectedDeclarerTricks;
      return make || tricks || Number(b.cardId === preferred) - Number(a.cardId === preferred) || a.cardId.localeCompare(b.cardId);
    });
    return { cardId: candidates[0].cardId, candidates, sampleCount: completed, attemptedSamples: attempts,
      elapsedMs: performance.now() - started, engine: 'sampled-dds', fallback: completed < budget,
      reasonTags: [actorDeclares ? '优先提高成约率' : '优先提高击宕率', `公开信息样本 ${completed} 个`, completed < budget ? '达到时间或一致性上限' : '完成设定样本'], publicKey };
  } catch (error) {
    return safetyDecision(obs, request.system, started, `DDS 回退：${error instanceof Error ? error.message : '未知错误'}`, publicKey);
  }
}

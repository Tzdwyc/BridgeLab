import { DdsEngine } from '../analysis/engine';
import { DDS_SUITS, pbnRank, normalizeResult } from '../analysis/adapter';
import { type AnalysisPosition, type PositionResult } from '../analysis/types';
import { SEATS, sideOf, type Hands } from '../core/types';
import { chooseCard } from './playing';
import { choosePublicEndgameCard } from './play-safety';
import { buildPublicPlayModel } from './play-public-model';
import { sampleDeals, samplePhysicalDeals, CONSTRAINED_EMPTY } from './play-sampler';
import { type PlayObservation } from './observation';
import { type PlayAdviceRequest, type PlayCandidateEvaluation, type PlayDecision, type EmptyRecoveryDiagnostics } from './play-advisor-types';

const sampleBudget = { basic: 0, standard: 8, challenge: 24 } as const;
export type RuntimeEngine = Pick<DdsEngine, 'raw'>;
export type SampleEvaluation = Pick<PositionResult, 'candidates'>;
export interface RuntimeDebug {
  /** Public-observation-derived sampled keys only; no actual deal or game seed. */
  sampleKeys: string[];
  evaluatedSampleKeys: string[];
}
export interface PlayAdvisorRuntime {
  deadlineMs?: number;
  now?: () => number;
  getEngine?: () => Promise<RuntimeEngine>;
  onProgress?: (decision: PlayDecision) => void;
  sampleDeals?: typeof sampleDeals;
  evaluate?: (position: AnalysisPosition, engine: RuntimeEngine) => SampleEvaluation;
  debug?: RuntimeDebug;
}

/** One instance per Worker: cache only DDS initialization, never hidden-hand beliefs. */
export function createPlayAdvisorRuntime(): PlayAdvisorRuntime {
  let enginePromise: Promise<RuntimeEngine> | undefined;
  return { getEngine: () => enginePromise ??= DdsEngine.create().catch(error => {
    enginePromise = undefined;
    throw error;
  }) };
}

export function sampledPosition(obs: PlayObservation, hands: Hands, sampleKey: string): AnalysisPosition {
  const remainCards = 'N:' + SEATS.map(seat => DDS_SUITS.map(suit => hands[seat]
    .filter(card => card.suit === suit).sort((a, b) => b.rank - a.rank).map(card => pbnRank(card.rank)).join('')).join('.')).join(' ');
  return {
    key: sampleKey,
    deal: {
      trump: obs.contract.strain === 'NT' ? 4 : DDS_SUITS.indexOf(obs.contract.strain),
      first: SEATS.indexOf(obs.currentTrick[0]?.seat ?? obs.actingSeat),
      currentTrickSuit: obs.currentTrick.map(play => DDS_SUITS.indexOf(play.card.suit)),
      currentTrickRank: obs.currentTrick.map(play => play.card.rank), remainCards
    },
    actor: obs.actingSeat, declaringSide: sideOf(obs.contract.declarer),
    wonByDeclarer: obs.tricksWon[sideOf(obs.contract.declarer)], remainingTricks: 13 - obs.completedTricks.length,
    legalCards: obs.legalCards, terminalTricks: null
  };
}

/** A sample is accepted only when it covers each legal card once, before any commit. */
export function assertAtomicEvaluation(obs: PlayObservation, evaluation: SampleEvaluation): void {
  const legal = new Set(obs.legalCards.map(card => card.id));
  const seen = new Set<string>();
  if (evaluation.candidates.length !== legal.size) throw new Error('DDS 候选结果未覆盖全部合法牌');
  for (const candidate of evaluation.candidates) {
    if (!legal.has(candidate.cardId) || seen.has(candidate.cardId)) throw new Error('DDS 返回了重复或不合法的牌');
    if (!Number.isInteger(candidate.declarerTricks) || candidate.declarerTricks < obs.tricksWon[sideOf(obs.contract.declarer)] ||
      candidate.declarerTricks > obs.tricksWon[sideOf(obs.contract.declarer)] + 13 - obs.completedTricks.length) {
      throw new Error('DDS 返回的赢墩值无效');
    }
    seen.add(candidate.cardId);
  }
}

/** The v3.2.1 arithmetic and comparison order, over complete equal-weight samples. */
export function aggregateOldCandidates(obs: PlayObservation, system: PlayAdviceRequest['system'], evaluations: readonly SampleEvaluation[]): PlayCandidateEvaluation[] {
  if (!evaluations.length) throw new Error('DDS 未在时限内完成样本');
  evaluations.forEach(evaluation => assertAtomicEvaluation(obs, evaluation));
  const byCard = new Map(obs.legalCards.map(card => [card.id, [] as number[]]));
  for (const evaluation of evaluations) for (const candidate of evaluation.candidates) byCard.get(candidate.cardId)!.push(candidate.declarerTricks);
  const target = obs.contract.level + 6;
  const candidates: PlayCandidateEvaluation[] = obs.legalCards.map(card => {
    const values = byCard.get(card.id)!;
    return { cardId: card.id, support: values.length,
      expectedDeclarerTricks: values.reduce((sum, value) => sum + value, 0) / values.length,
      makeRate: values.filter(value => value >= target).length / values.length,
      worstDeclarerTricks: Math.min(...values), bestDeclarerTricks: Math.max(...values) };
  });
  const actorDeclares = sideOf(obs.actingSeat) === sideOf(obs.contract.declarer);
  const preferred = chooseCard(obs, system);
  return candidates.sort((a, b) => {
    const make = actorDeclares ? b.makeRate - a.makeRate : a.makeRate - b.makeRate;
    const tricks = actorDeclares ? b.expectedDeclarerTricks - a.expectedDeclarerTricks : a.expectedDeclarerTricks - b.expectedDeclarerTricks;
    return make || tricks || Number(b.cardId === preferred) - Number(a.cardId === preferred) || a.cardId.localeCompare(b.cardId);
  });
}

/** Only runtime mechanics differ: legacy one-shot sampler, old ranking and certificate. */
async function adviseRuntime(request: PlayAdviceRequest, suppliedEngine?: RuntimeEngine, runtime: PlayAdvisorRuntime = {}): Promise<PlayDecision> {
  const now = runtime.now ?? (() => performance.now());
  const started = now();
  const { observation: obs } = request;
  const publicKey = buildPublicPlayModel(obs).key;
  const budget = sampleBudget[request.strength];
  const deadline = Math.min(runtime.deadlineMs ?? Infinity, started + (request.timeoutMs ?? (request.strength === 'challenge' ? 2500 : 1200)));
  const expired = () => now() >= deadline;
  let attempts = 0;
  let latest: PlayDecision | undefined;
  if (runtime.debug) { runtime.debug.sampleKeys = []; runtime.debug.evaluatedSampleKeys = []; }
  const safety = (reason: string): PlayDecision => ({ cardId: chooseCard(obs, request.system), candidates: [], sampleCount: 0,
    attemptedSamples: attempts, elapsedMs: now() - started, engine: 'safety', fallback: reason !== '基础安全层', reasonTags: [reason], publicKey,
    diagnostics: { status: 'safety', requestedSamples: budget, completedSamples: 0, stopReason: reason } });
  const partial = (reason: string): PlayDecision => latest ? {
    ...latest, attemptedSamples: attempts, elapsedMs: now() - started, fallback: true,
    reasonTags: [...latest.reasonTags.filter(tag => tag !== '完成设定样本'), reason],
    diagnostics: { ...latest.diagnostics!, status: 'partial', stopReason: reason }
  } : safety(reason);
  if (obs.legalCards.length === 1) return safety('只有一张合法牌');
  if (!budget) return safety('基础安全层');
  try {
    if (expired()) return safety('实战分析截止前没有完成样本');
    // Intentionally one call with 8/24: even a count=1 loop changes the old stream.
    const batch = (runtime.sampleDeals ?? sampleDeals)(obs, request.system, budget);
    attempts = batch.attempts;
    if (runtime.debug) runtime.debug.sampleKeys = batch.samples.map(sample => sample.key);
    if (expired()) return safety('采样达到统一分析时限');
    const engine = suppliedEngine ?? await (runtime.getEngine?.() ?? DdsEngine.create());
    if (expired()) return safety('DDS 初始化达到时限');
    const evaluate = runtime.evaluate ?? ((position: AnalysisPosition, dds: RuntimeEngine) => normalizeResult(position, dds.raw(position.deal)));
    const evaluations: SampleEvaluation[] = [];
    const certifiedChoices = new Map<string, string | null>();
    const actorDeclares = sideOf(obs.actingSeat) === sideOf(obs.contract.declarer);
    for (const sample of batch.samples) {
      if (expired()) break;
      const position = sampledPosition(obs, sample.hands, JSON.stringify([publicKey, sample.key]));
      const evaluation = evaluate(position, engine);
      assertAtomicEvaluation(obs, evaluation);
      evaluations.push(evaluation);
      runtime.debug?.evaluatedSampleKeys.push(sample.key);
      const candidates = aggregateOldCandidates(obs, request.system, evaluations);
      const bestId = candidates[0].cardId;
      // Keep the old public-ending certificate even if this indivisible DDS call crossed the deadline.
      if (!certifiedChoices.has(bestId)) certifiedChoices.set(bestId, choosePublicEndgameCard(obs, bestId)?.id ?? null);
      const certified = certifiedChoices.get(bestId);
      const complete = evaluations.length === budget;
      latest = { cardId: certified ?? bestId, candidates, sampleCount: evaluations.length, attemptedSamples: attempts,
        elapsedMs: now() - started, engine: 'sampled-dds', fallback: !complete,
        reasonTags: [actorDeclares ? '优先提高成约率' : '优先提高击宕率', `公开信息样本 ${evaluations.length} 个`,
          complete ? '完成设定样本' : '达到时间或一致性上限', ...(certified ? ['公开信息保证拿下全部余墩'] : [])], publicKey,
        diagnostics: { status: complete ? 'complete' : 'partial', requestedSamples: budget, completedSamples: evaluations.length,
          effectiveSampleCount: evaluations.length } };
      runtime.onProgress?.(structuredClone(latest));
    }
    return latest?.sampleCount === budget ? latest : partial(expired() ? '达到统一分析时限，保留已完成样本' : '一致样本已用尽，保留已完成样本');
  } catch (error) {
    return partial(`DDS 回退：${error instanceof Error ? error.message : '未知错误'}`);
  }
}

/** Rescue only a constrained-empty legacy sampler; leave every nonempty legacy stream intact. */
export async function advisePlay(request: PlayAdviceRequest, suppliedEngine?: RuntimeEngine,
  runtime: PlayAdvisorRuntime = {}): Promise<PlayDecision> {
  const now = runtime.now ?? (() => performance.now());
  const started = now();
  const deadline = Math.min(runtime.deadlineMs ?? Infinity,
    started + (request.timeoutMs ?? (request.strength === 'challenge' ? 2500 : 1200)));
  const diagnostic: EmptyRecoveryDiagnostics = {
    version: 'legacy-empty-only-v1', triggered: false, source: 'legacy', recoveredSamples: 0,
    legacyAttemptCountUnavailable: false
  };
  const source = runtime.sampleDeals ?? sampleDeals;
  const decision = await adviseRuntime(request, suppliedEngine, { ...runtime, now, deadlineMs: deadline,
    onProgress: runtime.onProgress ? progress => runtime.onProgress!({ ...progress, emptyRecovery: { ...diagnostic } }) : undefined,
    sampleDeals(observation, system, count) {
      try { return source(observation, system, count); }
      catch (error) {
        if (!(error instanceof Error) || error.message !== CONSTRAINED_EMPTY || now() >= deadline) throw error;
        diagnostic.triggered = true;
        diagnostic.legacyAttemptCountUnavailable = true;
        const batch = samplePhysicalDeals(observation, count, { deadlineMs: deadline, now });
        if (!batch.samples.length) throw error;
        diagnostic.source = 'physical-unweighted';
        diagnostic.recoveredSamples = batch.samples.length;
        return batch;
      }
    }
  });
  return { ...decision, emptyRecovery: { ...diagnostic } };
}

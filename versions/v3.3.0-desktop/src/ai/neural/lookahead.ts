import { callToAction, encodeObservation } from './index';
import type { BiddingObservation } from '../observation';

export const LOOKAHEAD_SHA256 = '6bb521e44145b85d99b3ee66b82d671fd692224c745b40420dd19a88da9d814f';
const FEATURE_COUNT = 560;
const MIN_EXPECTED_IMP = 0.75;
const MIN_SEVERE_GAP = 0.05;

export interface LookaheadHead { weights: number[][]; bias: number[] }
export interface LookaheadChoice { action: number; meanImp: number; severeGap: number }

export function parseLookaheadHead(bytes: ArrayBuffer): LookaheadHead {
  const head = JSON.parse(new TextDecoder().decode(bytes));
  if (head?.schema !== 'paired-ridge-imp-and-tail-v16' || head.inputFeatures !== FEATURE_COUNT ||
      head.minExpectedImp !== MIN_EXPECTED_IMP || head.minSevereGap !== MIN_SEVERE_GAP ||
      !Array.isArray(head.weights) || head.weights.length !== 3 ||
      !head.weights.every((row: unknown) => Array.isArray(row) && row.length === FEATURE_COUNT && row.every(Number.isFinite)) ||
      !Array.isArray(head.bias) || head.bias.length !== 3 || !head.bias.every(Number.isFinite)) {
    throw new Error('叫牌前瞻文件格式不正确');
  }
  return { weights: head.weights, bias: head.bias };
}

type RankedCall = { action: number; logit: number };

function candidatesFor(observation: BiddingObservation, logits: Float32Array): RankedCall[] {
  if (observation.auction.filter(entry => entry.call.kind === 'bid').length < 2) return [];
  const ranked = observation.legalCalls.map(callToAction).map(action => ({ action, logit: logits[action] }))
    .sort((a, b) => b.logit - a.logit || a.action - b.action);
  const candidates = ranked.slice(0, 3).filter(entry => ranked[0].logit - entry.logit <= 3.5);
  return candidates.length >= 2 && candidates.some(entry => entry.action >= 18) ? candidates : [];
}

export function canUseLookahead(observation: BiddingObservation, logits: Float32Array): boolean {
  return candidatesFor(observation, logits).length > 0;
}

export function chooseWithLookahead(head: LookaheadHead, observation: BiddingObservation, logits: Float32Array): LookaheadChoice | null {
  const [top, ...alternatives] = candidatesFor(observation, logits);
  if (!top) return null;
  const inputs = new Float32Array(FEATURE_COUNT);
  inputs.set(encodeObservation(observation));
  inputs[480 + top.action] = 1;
  inputs[558] = Math.tanh(top.logit / 10);
  const probability = (value: number) => Math.max(0, Math.min(1, Math.fround(value)));
  let chosen: LookaheadChoice | null = null;

  for (const [index, alternative] of alternatives.entries()) {
    inputs[518 + alternative.action] = 1;
    inputs[556] = (top.logit - alternative.logit) / 3.5;
    inputs[557] = (index + 1) / 2;
    inputs[559] = Math.tanh(alternative.logit / 10);
    const [mean, save, loss] = head.weights.map((weights, output) => {
      let value = head.bias[output];
      for (let i = 0; i < inputs.length; i++) value += weights[i] * inputs[i];
      return value;
    });
    inputs[518 + alternative.action] = 0;
    const meanImp = Math.fround(Math.fround(mean) * 10);
    const severeGap = Math.fround(probability(save) - probability(loss));
    if (meanImp > MIN_EXPECTED_IMP && severeGap >= MIN_SEVERE_GAP && (!chosen || meanImp > chosen.meanImp)) {
      chosen = { action: alternative.action, meanImp, severeGap };
    }
  }
  return chosen;
}

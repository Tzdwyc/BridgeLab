import { type Card, type Hands, type Seat, type Suit } from '../core/types';
import { type BiddingSystem } from './systems';
import { type PlayObservation } from './observation';

export type PlayStrength = 'basic' | 'standard' | 'challenge';

export interface PublicPlayModel {
  key: string;
  knownHands: Partial<Hands>;
  playedIds: string[];
  playedBySeat: Record<Seat, Card[]>;
  voids: Record<Seat, Suit[]>;
  remainingCounts: Record<Seat, number>;
}

export interface SampledDeal {
  hands: Hands;
  key: string;
}

export interface PlayCandidateEvaluation {
  cardId: string;
  expectedDeclarerTricks: number;
  makeRate: number;
  support: number;
  worstDeclarerTricks: number;
  bestDeclarerTricks: number;
}

export interface PlayDecision {
  cardId: string;
  candidates: PlayCandidateEvaluation[];
  sampleCount: number;
  attemptedSamples: number;
  elapsedMs: number;
  engine: 'safety' | 'sampled-dds';
  fallback: boolean;
  reasonTags: string[];
  publicKey: string;
}

export interface PlayAdviceRequest {
  observation: PlayObservation;
  system: BiddingSystem;
  strength: PlayStrength;
  timeoutMs?: number;
}

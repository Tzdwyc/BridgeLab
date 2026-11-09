import type { Call, Card, GameState, Seat } from '../core/types';
import { agreementVersionFor } from '../ai/bid-strategy';
import { BIDDING_SYSTEM_IDS, type BiddingSystem } from '../ai/systems';

/** Versions are advertised explicitly; an older client must not guess a card. */
export const LAN_SUPPORTED_AGREEMENTS: Record<BiddingSystem, string> = Object.fromEntries(
  BIDDING_SYSTEM_IDS.map(system => [system, agreementVersionFor(system)]),
) as Record<BiddingSystem, string>;

export interface RoomCapabilities {
  supportedAgreements?: Partial<Record<BiddingSystem, string>>;
}

export type RoomAction =
  | { kind: 'ready'; ready: boolean }
  | { kind: 'startWithRobots' }
  | { kind: 'call'; call: Call }
  | { kind: 'play'; cardId: string }
  | { kind: 'nextBoard' };

export type RoomRequest =
  | ({ kind: 'join'; roomCode: string; seat: Seat; nonce: string } & RoomCapabilities)
  | ({ kind: 'resume' | 'poll' | 'leave'; token: string } & RoomCapabilities)
  | ({ kind: 'action'; token: string; id: string; revision: number; action: RoomAction } & RoomCapabilities);

export interface RoomSnapshot extends Pick<GameState,
  'board' | 'dealer' | 'vulnerability' | 'phase' | 'auction' | 'turn' | 'contract' |
  'dummyRevealed' | 'currentTrick' | 'completedTricks' | 'tricksWon' | 'result'> {
  roomCode: string;
  biddingSystem: BiddingSystem;
  agreementVersion: string;
  revision: number;
  seat: Seat;
  seats: Record<Seat, 'empty' | 'connected' | 'disconnected' | 'robot'>;
  readiness: Record<Seat, boolean>;
  status: 'waiting' | 'active' | 'paused';
  controller: Seat;
  hand: Card[];
  dummy: { seat: Seat; hand: Card[] } | null;
  handCounts: Record<Seat, number>;
  legalCalls: Call[];
  legalCardIds: string[];
  canNextBoard: boolean;
}

export type RoomResponse =
  | { ok: true; snapshot: RoomSnapshot; token?: string }
  | { ok: false; code: string; message: string; snapshot?: RoomSnapshot };

export function createJoinNonce(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
}

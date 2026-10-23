export const SEATS = ['N', 'E', 'S', 'W'] as const;
export type Seat = typeof SEATS[number];
export const SUITS = ['C', 'D', 'H', 'S'] as const;
export type Suit = typeof SUITS[number];
export const STRAINS = [...SUITS, 'NT'] as const;
export type Strain = typeof STRAINS[number];
export type Side = 'NS' | 'EW';
export type Vulnerability = 'None' | Side | 'Both';
export interface Card { id: string; suit: Suit; rank: number }
export type Hands = Record<Seat, Card[]>;
export type Call = { kind: 'pass' } | { kind: 'double' } | { kind: 'redouble' } | { kind: 'bid'; level: number; strain: Strain };
export interface AuctionEntry { seat: Seat; call: Call }
export interface Contract { level: number; strain: Strain; doubled: 0 | 1 | 2; declarer: Seat; dummy: Seat; leader: Seat }
export interface PlayedCard { seat: Seat; card: Card }
export interface Trick { leader: Seat; plays: PlayedCard[]; winner: Seat }
export interface ClaimSettlement { seat: Seat; tricks: number; remainingTricks: number }
export type GameAction = { kind: 'call'; seat: Seat; call: Call } | { kind: 'play'; seat: Seat; cardId: string } | { kind: 'claim'; seat: Seat; tricks: number };
export interface ScoreBreakdown {
  contractPoints: number; overtrickPoints: number; gameBonus: number;
  slamBonus: number; insultBonus: number; penalty: number; total: number;
}
export interface Result { declarerTricks: number; scoreNS: number; breakdown: ScoreBreakdown }
export interface GameState {
  board: number; seed: string; dealer: Seat; vulnerability: Vulnerability;
  phase: 'auction' | 'play' | 'complete' | 'passedOut';
  initialHands: Hands; hands: Hands; auction: AuctionEntry[];
  turn: Seat; contract: Contract | null; dummyRevealed: boolean;
  trickLeader: Seat; currentTrick: PlayedCard[]; completedTricks: Trick[];
  tricksWon: Record<Side, number>; claim: ClaimSettlement | null; result: Result | null; actions: GameAction[];
  customSetup?: DealSetup;
}
export interface DealSetup { dealer: Seat; vulnerability: Vulnerability; hands: Hands }
export interface GameRecord { board: number; seed: string; actions: GameAction[]; customSetup?: DealSetup }
export const PASS: Call = { kind: 'pass' };
export const sideOf = (seat: Seat): Side => seat === 'N' || seat === 'S' ? 'NS' : 'EW';
export const nextSeat = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 1) % 4];
export const partnerOf = (seat: Seat): Seat => SEATS[(SEATS.indexOf(seat) + 2) % 4];
export const isVulnerable = (v: Vulnerability, seat: Seat): boolean => v === 'Both' || v === sideOf(seat);
export class BridgeError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'BridgeError'; }
}

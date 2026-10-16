import { type Card, type Seat, type Side, type Strain } from '../core/types';

// Four-hand analysis data never passes through the normal AI Observation interface.
export interface DdsDeal {
  trump: number; first: number; currentTrickSuit: number[]; currentTrickRank: number[]; remainCards: string;
}
export interface RawFutureTricks { nodes: number; cards: number; suit: number[]; rank: number[]; equals: number[]; score: number[] }
export interface AnalysisPosition {
  key: string; deal: DdsDeal; actor: Seat; declaringSide: Side;
  wonByDeclarer: number; remainingTricks: number; legalCards: Card[];
  terminalTricks: number | null;
}
export interface Candidate { cardId: string; declarerTricks: number; loss: number; optimal: boolean }
export interface PositionResult {
  key: string; declarerTricks: number; candidates: Candidate[]; nodes: number;
  elapsedMs: number; heapBytes: number; engine: string;
}
export type DoubleDummyTable = Record<Seat, Record<Strain, number>>;
export interface DoubleDummyTableRequest { key: string; cards: string }
export interface DoubleDummyTableResult {
  key: string; engine: string; table: DoubleDummyTable;
  elapsedMs: number; heapBytes: number;
}
export const ENGINE = 'DDS-WASM/bridge-dds-1.4.0/normalize-1';

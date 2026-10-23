import { type Contract, type GameAction, type GameRecord, type GameState, type Seat, type Strain, PASS, nextSeat, partnerOf, sideOf } from '../core/types';
import { applyAction, applyCall, newGame, newGameFromDeal, playCard, replay, toRecord } from '../core/game';
import { robotStep } from '../controller/robot';
import { analysisPosition } from './adapter';
import { type PositionResult } from './types';

export type PlayAction = Extract<GameAction, { kind: 'play' }>;
export interface ReplayLine { states: GameState[]; plays: PlayAction[] }
export interface Branch { id: string; name: string; start: number; cards: string[]; cursor: number }
export interface AnalysisDocument { version: 2; source: GameRecord; name: string; cursor: number; activeBranch: string | null; branches: Branch[]; analysisContract: Contract | null }

function initialGame(record: GameRecord): GameState {
  return record.customSetup
    ? newGameFromDeal(record.board, record.seed, record.customSetup.hands, record.customSetup.dealer, record.customSetup.vulnerability)
    : newGame(record.board, record.seed);
}

export function replayLine(record: GameRecord, analysisContract: Contract | null = null): ReplayLine {
  const complete = replay(record);
  if (complete.phase === 'passedOut') {
    if (!analysisContract) throw new Error('四家 Pass 的牌局需要先选择假设定约');
    const state: GameState = {
      ...complete,
      phase: 'play',
      contract: structuredClone(analysisContract),
      result: null,
      turn: analysisContract.leader,
      trickLeader: analysisContract.leader,
      dummyRevealed: false
    };
    return { states: [state], plays: [] };
  }
  if (complete.phase !== 'complete' || !complete.contract) throw new Error('分析室只接收已结束的牌局');
  let state = initialGame(record); const states: GameState[] = []; const plays: PlayAction[] = [];
  for (const action of record.actions) {
    if (action.kind === 'play') {
      if (!states.length) states.push(state);
      plays.push(action); state = applyAction(state, action); states.push(state);
    } else if (action.kind === 'call') {
      if (states.length) throw new Error('打牌期间存在叫牌动作');
      state = applyAction(state, action);
    } else {
      if (!states.length || action !== record.actions.at(-1) || !complete.claim) throw new Error('声称记录位置不合法');
      // Keep the last actually played position analyzable. The claim itself is a
      // settlement marker and must not invent the unplayed cards or tricks.
    }
  }
  if (complete.claim) {
    if (states.length !== plays.length + 1 || plays.length >= 52) throw new Error('声称前的打牌记录不完整');
  } else if (states.length !== 53 || plays.length !== 52) throw new Error('打牌记录不完整');
  return { states, plays };
}
export function branchLine(original: ReplayLine, branch: Branch): ReplayLine {
  let state = original.states[branch.start];
  if (!state) throw new Error('试打起点无效');
  const states = original.states.slice(0, branch.start + 1); const plays = original.plays.slice(0, branch.start);
  for (const cardId of branch.cards) {
    const action: PlayAction = { kind: 'play', seat: state.turn, cardId };
    state = playCard(state, state.turn, cardId); plays.push(action); states.push(state);
  }
  return { states, plays };
}
export function openDocument(game: GameState, name = `第 ${game.board} 副`): AnalysisDocument {
  const source = toRecord(game);
  const analysisContract = game.phase === 'passedOut' ? makeAnalysisContract(1, 'NT', 'S') : null;
  replayLine(source, analysisContract);
  return { version: 2, source, name, cursor: 0, activeBranch: null, branches: [], analysisContract };
}
export function activeLine(document: AnalysisDocument): ReplayLine {
  const original = replayLine(document.source, document.analysisContract);
  const branch = document.branches.find(b => b.id === document.activeBranch);
  return branch ? branchLine(original, branch) : original;
}
export function makeAnalysisContract(level: number, strain: Strain, declarer: Seat): Contract {
  if (!Number.isInteger(level) || level < 1 || level > 7) throw new Error('假设定约阶数不合法');
  return { level, strain, doubled: 0, declarer, dummy: partnerOf(declarer), leader: nextSeat(declarer) };
}
export function changeAnalysisContract(document: AnalysisDocument, level: number, strain: Strain, declarer: Seat): AnalysisDocument {
  const complete = replay(document.source);
  if (complete.phase !== 'passedOut') return document;
  const analysisContract = makeAnalysisContract(level, strain, declarer);
  replayLine(document.source, analysisContract);
  return { ...document, analysisContract, cursor: 0, activeBranch: null, branches: [] };
}
export function activeCursor(document: AnalysisDocument): number {
  return document.branches.find(b => b.id === document.activeBranch)?.cursor ?? document.cursor;
}
export function moveCursor(document: AnalysisDocument, cursor: number): AnalysisDocument {
  const max = activeLine(document).states.length - 1;
  const next = Math.max(0, Math.min(max, Math.round(cursor)));
  return document.activeBranch ? { ...document, branches: document.branches.map(b => b.id === document.activeBranch ? { ...b, cursor: next } : b) } : { ...document, cursor: next };
}
export function tryCard(document: AnalysisDocument, cardId: string, id: string): AnalysisDocument {
  const cursor = activeCursor(document); const line = activeLine(document); const state = line.states[cursor];
  playCard(state, state.turn, cardId); // Validate before altering any branch.
  const active = document.branches.find(b => b.id === document.activeBranch);
  // Changing a pre-branch position creates a new line instead of modifying its shared prefix.
  if (!active || cursor < active.start) {
    if (document.branches.length >= 12) throw new Error('最多保存 12 条试打分支，请先删除一条');
    const branch: Branch = { id, name: `试打 ${document.branches.length + 1}`, start: cursor, cards: [cardId], cursor: cursor + 1 };
    return { ...document, activeBranch: id, branches: [...document.branches, branch] };
  }
  return { ...document, branches: document.branches.map(b => b.id === active.id ? { ...b, cards: [...b.cards.slice(0, cursor - b.start), cardId], cursor: cursor + 1 } : b) };
}
export function undoBranch(document: AnalysisDocument): AnalysisDocument {
  const active = document.branches.find(b => b.id === document.activeBranch);
  if (!active || !active.cards.length) return document;
  const keep = Math.max(0, active.cursor - active.start - 1);
  return { ...document, branches: document.branches.map(b => b.id === active.id ? { ...b, cards: b.cards.slice(0, keep), cursor: b.start + keep } : b) };
}
export function actualLoss(line: ReplayLine, index: number, results: Record<string, PositionResult>): number | null {
  const before = line.states[index]; const after = line.states[index + 1]; const action = line.plays[index];
  if (!before || !after || !action || !before.contract) return null;
  const result = results[analysisPosition(before).key];
  const candidate = result?.candidates.find(c => c.cardId === action.cardId);
  if (candidate) return candidate.loss;
  const next = results[analysisPosition(after).key];
  if (!result || !next) return null;
  return sideOf(action.seat) === sideOf(before.contract.declarer) ? result.declarerTricks - next.declarerTricks : next.declarerTricks - result.declarerTricks;
}

// Reproducible practice boards use the same rules and limited-information robots.
export function exampleGame(seed: string, strain: Strain, declarer: Seat, board = 1): GameState {
  let state = newGame(board, seed);
  while (state.turn !== declarer) state = applyCall(state, state.turn, PASS);
  state = applyCall(state, declarer, { kind: 'bid', level: strain === 'NT' ? 3 : strain === 'H' || strain === 'S' ? 4 : 3, strain });
  for (let n = 0; n < 3; n++) state = applyCall(state, state.turn, PASS);
  for (let n = 0; n < 52; n++) state = robotStep(state).game;
  if (state.phase !== 'complete') throw new Error('示例牌局生成失败');
  return state;
}
export const EXAMPLES = [
  { id: 'nt', name: '示例牌 · 3NT 南家庄', seed: 'v03-example-nt', strain: 'NT' as const, declarer: 'S' as const, board: 1 },
  { id: 'spades', name: '示例牌 · 4♠ 北家庄', seed: 'v03-example-spades', strain: 'S' as const, declarer: 'N' as const, board: 2 },
  { id: 'hearts', name: '示例牌 · 4♥ 东家庄', seed: 'v03-example-hearts', strain: 'H' as const, declarer: 'E' as const, board: 3 }
];

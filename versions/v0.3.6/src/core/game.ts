import { type GameState, type GameAction, type Call, type Seat, type GameRecord, type Hands, type Side, type Vulnerability, SEATS, BridgeError, nextSeat, sideOf, isVulnerable } from './types';
import { deal, boardInfo, deck } from './deal';
import { auctionStatus, legalCalls, sameCall, finalContract } from './auction';
import { legalCards, trickWinner } from './play';
import { scoreContract } from './scoring';

export function newGame(board: number, seed: string): GameState {
  const info = boardInfo(board); const hands = deal(seed);
  return { board, seed, ...info, phase: 'auction', initialHands: hands, hands,
    auction: [], turn: info.dealer, contract: null, dummyRevealed: false,
    trickLeader: info.dealer, currentTrick: [], completedTricks: [], tricksWon: { NS: 0, EW: 0 }, claim: null, result: null, actions: [] };
}

export function newGameFromDeal(board: number, seed: string, hands: Hands, dealer: Seat, vulnerability: Vulnerability): GameState {
  if (!SEATS.includes(dealer) || !['None', 'NS', 'EW', 'Both'].includes(vulnerability)) throw new BridgeError('INVALID_DEAL', '发牌人或局况不合法');
  const initialHands = structuredClone(hands);
  const state: GameState = { board, seed, dealer, vulnerability, phase: 'auction', initialHands, hands: structuredClone(initialHands),
    auction: [], turn: dealer, contract: null, dummyRevealed: false, trickLeader: dealer, currentTrick: [], completedTricks: [],
    tricksWon: { NS: 0, EW: 0 }, claim: null, result: null, actions: [], customSetup: { dealer, vulnerability, hands: structuredClone(initialHands) } };
  assertGameIntegrity(state); return state;
}

export function applyCall(state: GameState, seat: Seat, call: Call): GameState {
  if (state.phase !== 'auction') throw new BridgeError('WRONG_PHASE', '当前不在叫牌阶段');
  if (seat !== state.turn) throw new BridgeError('NOT_TURN', '还没有轮到此位置叫牌');
  if (!legalCalls(state.auction, seat).some(legal => sameCall(legal, call))) throw new BridgeError('INVALID_CALL', '此叫品不合法');
  const auction = [...state.auction, { seat, call: structuredClone(call) }];
  const result: GameState = { ...state, auction, turn: nextSeat(seat), actions: [...state.actions, { kind: 'call', seat, call: structuredClone(call) }] };
  if (auctionStatus(auction).ended) {
    const contract = finalContract(auction);
    if (!contract) return { ...result, phase: 'passedOut', result: { declarerTricks: 0, scoreNS: 0, breakdown: { contractPoints: 0, overtrickPoints: 0, gameBonus: 0, slamBonus: 0, insultBonus: 0, penalty: 0, total: 0 } } };
    return { ...result, contract, phase: 'play', turn: contract.leader, trickLeader: contract.leader };
  }
  return result;
}

export function playCard(state: GameState, seat: Seat, cardId: string): GameState {
  if (state.phase !== 'play' || !state.contract) throw new BridgeError('WRONG_PHASE', '当前不在打牌阶段');
  if (seat !== state.turn) throw new BridgeError('NOT_TURN', '还没有轮到此位置出牌');
  const card = state.hands[seat].find(c => c.id === cardId);
  if (!card) throw new BridgeError('NO_CARD', '此位置没有这张牌');
  if (!legalCards(state.hands[seat], state.currentTrick).some(c => c.id === cardId)) throw new BridgeError('REVOKE', '手中有首引花色，必须跟牌');
  const plays = [...state.currentTrick, { seat, card }];
  let result: GameState = {
    ...state, hands: { ...state.hands, [seat]: state.hands[seat].filter(c => c.id !== cardId) },
    currentTrick: plays, dummyRevealed: true, turn: nextSeat(seat),
    actions: [...state.actions, { kind: 'play', seat, cardId }]
  };
  if (plays.length === 4) {
    const winner = trickWinner(plays, state.contract.strain);
    const completedTricks = [...state.completedTricks, { leader: state.trickLeader, plays, winner }];
    const tricksWon = { ...state.tricksWon, [sideOf(winner)]: state.tricksWon[sideOf(winner)] + 1 };
    result = { ...result, completedTricks, tricksWon, turn: winner, trickLeader: winner, currentTrick: [] };
    if (completedTricks.length === 13) {
      const declarerTricks = tricksWon[sideOf(state.contract.declarer)];
      const breakdown = scoreContract(state.contract, declarerTricks, isVulnerable(state.vulnerability, state.contract.declarer));
      result = { ...result, phase: 'complete', result: { declarerTricks, breakdown, scoreNS: breakdown.total * (sideOf(state.contract.declarer) === 'NS' ? 1 : -1) } };
    }
  }
  return result;
}

/** Apply an already-adjudicated claim. DDS verification stays outside the pure rules core. */
export function applyClaim(state: GameState, seat: Seat, tricks: number): GameState {
  if (state.phase !== 'play' || !state.contract) throw new BridgeError('WRONG_PHASE', '当前不在打牌阶段');
  if (controllerFor(state) !== seat) throw new BridgeError('NOT_CONTROLLER', '只有当前行动方的控制者可以声称');
  const remainingTricks = 13 - state.completedTricks.length;
  if (!Number.isInteger(tricks) || tricks < 0 || tricks > remainingTricks) throw new BridgeError('INVALID_CLAIM', '声称墩数不合法');
  const claimantSide = sideOf(seat); const otherSide: Side = claimantSide === 'NS' ? 'EW' : 'NS';
  const tricksWon = { ...state.tricksWon };
  tricksWon[claimantSide] += tricks; tricksWon[otherSide] += remainingTricks - tricks;
  const declarerTricks = tricksWon[sideOf(state.contract.declarer)];
  const breakdown = scoreContract(state.contract, declarerTricks, isVulnerable(state.vulnerability, state.contract.declarer));
  return {
    ...state, phase: 'complete', tricksWon, claim: { seat, tricks, remainingTricks },
    result: { declarerTricks, breakdown, scoreNS: breakdown.total * (sideOf(state.contract.declarer) === 'NS' ? 1 : -1) },
    actions: [...state.actions, { kind: 'claim', seat, tricks }]
  };
}

export function applyAction(state: GameState, action: GameAction): GameState {
  if (!action || !SEATS.includes(action.seat)) throw new BridgeError('INVALID_ACTION', '动作位置不合法');
  if (action.kind === 'call') return applyCall(state, action.seat, action.call);
  if (action.kind === 'play') return playCard(state, action.seat, action.cardId);
  if (action.kind === 'claim') return applyClaim(state, action.seat, action.tricks);
  throw new BridgeError('INVALID_ACTION', '未知动作');
}

export const controllerFor = (state: GameState): Seat => state.phase === 'play' && state.turn === state.contract?.dummy ? state.contract.declarer : state.turn;
export const isFinished = (state: GameState): boolean => state.phase === 'complete' || state.phase === 'passedOut';
export const toRecord = (state: GameState): GameRecord => ({ board: state.board, seed: state.seed, actions: structuredClone(state.actions), ...(state.customSetup ? { customSetup: structuredClone(state.customSetup) } : {}) });

export function replay(record: GameRecord): GameState {
  if (!record || typeof record.seed !== 'string' || !record.seed.length || record.seed.length > 200 || !Array.isArray(record.actions) || record.actions.length > 400) throw new Error('存档牌局格式不正确');
  let state = record.customSetup ? newGameFromDeal(record.board, record.seed, record.customSetup.hands, record.customSetup.dealer, record.customSetup.vulnerability) : newGame(record.board, record.seed);
  for (const action of record.actions) state = applyAction(state, action);
  assertGameIntegrity(state); return state;
}

export function assertGameIntegrity(state: GameState): void {
  const played = [...state.completedTricks.flatMap(t => t.plays), ...state.currentTrick];
  const remaining = SEATS.flatMap(s => state.hands[s]);
  const cards = [...remaining, ...played.map(p => p.card)];
  const allIds = new Set(deck().map(c => c.id));
  if (cards.length !== 52 || new Set(cards.map(c => c.id)).size !== 52 || cards.some(c => !allIds.has(c.id) || c.id !== `${c.suit}${c.rank}`)) throw new BridgeError('CORRUPT_STATE', '牌张重复、缺失或不合法');
  for (const seat of SEATS) {
    if (state.hands[seat].length + played.filter(p => p.seat === seat).length !== 13) throw new BridgeError('CORRUPT_STATE', '各家牌张数不一致');
    if (state.hands[seat].some(c => !state.initialHands[seat].some(initial => initial.id === c.id)) || played.filter(p => p.seat === seat).some(p => !state.initialHands[seat].some(initial => initial.id === p.card.id))) throw new BridgeError('CORRUPT_STATE', '牌张归属不一致');
  }
  if (state.completedTricks.some(t => t.plays.length !== 4 || !state.contract || trickWinner(t.plays, state.contract.strain) !== t.winner)) throw new BridgeError('CORRUPT_STATE', '墩记录不一致');
  const completedWon = { NS: state.completedTricks.filter(t => sideOf(t.winner) === 'NS').length, EW: state.completedTricks.filter(t => sideOf(t.winner) === 'EW').length };
  if (state.claim) {
    const claim = state.claim; const claimantSide = sideOf(claim.seat); const otherSide: Side = claimantSide === 'NS' ? 'EW' : 'NS';
    if (state.phase !== 'complete' || claim.remainingTricks !== 13 - state.completedTricks.length || !Number.isInteger(claim.tricks) || claim.tricks < 0 || claim.tricks > claim.remainingTricks) throw new BridgeError('CORRUPT_STATE', '声称记录不一致');
    completedWon[claimantSide] += claim.tricks; completedWon[otherSide] += claim.remainingTricks - claim.tricks;
  }
  if (state.tricksWon.NS !== completedWon.NS || state.tricksWon.EW !== completedWon.EW) throw new BridgeError('CORRUPT_STATE', '赢墩数不一致');
  if (state.phase === 'complete' && !state.claim && (remaining.length !== 0 || state.completedTricks.length !== 13)) throw new BridgeError('CORRUPT_STATE', '牌局未完成 13 墩');
  if (state.phase === 'complete' && state.contract && (!state.result || state.result.declarerTricks !== state.tricksWon[sideOf(state.contract.declarer)] || state.tricksWon.NS + state.tricksWon.EW !== 13)) throw new BridgeError('CORRUPT_STATE', '结算结果不一致');
}

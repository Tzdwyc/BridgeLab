import { type GameState, type Hands, type Suit, SEATS, sideOf } from '../core/types';
import { legalCards } from '../core/play';
import { type AnalysisPosition, type DoubleDummyTableRequest, type PositionResult, type RawFutureTricks, ENGINE } from './types';

export const DDS_SUITS: Suit[] = ['S', 'H', 'D', 'C'];
export const pbnRank = (rank: number) => '23456789TJQKA'[rank - 2];
function handsPbn(hands: Hands): string {
  return 'N:' + SEATS.map(seat => DDS_SUITS.map(suit => hands[seat]
    .filter(c => c.suit === suit).sort((a, b) => b.rank - a.rank).map(c => pbnRank(c.rank)).join('')).join('.')).join(' ');
}
export function doubleDummyTableRequest(game: GameState): DoubleDummyTableRequest {
  const cards = SEATS.flatMap(seat => game.initialHands[seat]);
  if (SEATS.some(seat => game.initialHands[seat].length !== 13) || cards.length !== 52 || new Set(cards.map(card => card.id)).size !== 52) {
    throw new Error('双明手总表只能根据完整的原始四家手牌计算');
  }
  const pbn = handsPbn(game.initialHands);
  return { key: JSON.stringify([ENGINE, 'table', pbn]), cards: pbn };
}
export function analysisPosition(game: GameState): AnalysisPosition {
  if (!game.contract || !['play', 'complete'].includes(game.phase)) throw new Error('只有已确定定约的打牌位置可分析');
  const declaringSide = sideOf(game.contract.declarer);
  const deal = {
    trump: game.contract.strain === 'NT' ? 4 : DDS_SUITS.indexOf(game.contract.strain),
    // first is the trick LEADER, including when one to three cards have been played.
    first: SEATS.indexOf(game.trickLeader),
    currentTrickSuit: game.currentTrick.map(p => DDS_SUITS.indexOf(p.card.suit)),
    currentTrickRank: game.currentTrick.map(p => p.card.rank),
    remainCards: handsPbn(game.hands)
  };
  const wonByDeclarer = game.tricksWon[declaringSide];
  const remainingTricks = 13 - game.completedTricks.length;
  const terminalTricks = game.phase === 'complete' ? wonByDeclarer : null;
  const key = JSON.stringify([ENGINE, deal, declaringSide, wonByDeclarer, remainingTricks]);
  return { key, deal, actor: game.turn, declaringSide, wonByDeclarer, remainingTricks,
    legalCards: terminalTricks === null ? legalCards(game.hands[game.turn], game.currentTrick) : [], terminalTricks };
}

export function normalizeResult(position: AnalysisPosition, raw: RawFutureTricks, elapsedMs = 0, heapBytes = 0): PositionResult {
  if (position.terminalTricks !== null) return { key: position.key, declarerTricks: position.terminalTricks, candidates: [], nodes: 0, elapsedMs, heapBytes, engine: ENGINE };
  const actorDeclares = sideOf(position.actor) === position.declaringSide;
  const values = new Map<string, number>();
  if (!Number.isInteger(raw.cards) || raw.cards < 1 || raw.cards > 13) throw new Error('DDS 返回的候选牌数量无效');
  for (let i = 0; i < raw.cards; i++) {
    const suit = DDS_SUITS[raw.suit[i]]; const score = raw.score[i];
    if (!suit || !Number.isInteger(score) || score < 0 || score > position.remainingTricks) throw new Error('DDS 返回的赢墩值无效');
    const total = position.wonByDeclarer + (actorDeclares ? score : position.remainingTricks - score);
    const ranks = [raw.rank[i], ...Array.from({ length: 13 }, (_, n) => n + 2).filter(rank => (raw.equals[i] & (1 << rank)) !== 0)];
    for (const rank of ranks) {
      const id = `${suit}${rank}`;
      if (!position.legalCards.some(c => c.id === id) || values.has(id)) throw new Error('DDS 返回了重复或不合法的牌');
      values.set(id, total);
    }
  }
  if (values.size !== position.legalCards.length) throw new Error('DDS 候选结果未覆盖全部合法牌');
  const best = (actorDeclares ? Math.max : Math.min)(...values.values());
  const candidates = position.legalCards.map(card => {
    const declarerTricks = values.get(card.id)!;
    const loss = actorDeclares ? best - declarerTricks : declarerTricks - best;
    return { cardId: card.id, declarerTricks, loss, optimal: loss === 0 };
  }).sort((a, b) => a.loss - b.loss || a.cardId.localeCompare(b.cardId));
  return { key: position.key, declarerTricks: best, candidates, nodes: raw.nodes, elapsedMs, heapBytes, engine: ENGINE };
}

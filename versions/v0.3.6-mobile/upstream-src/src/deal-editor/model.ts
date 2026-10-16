import { deck, sortCards } from '../core/deal';
import { type Card, type Hands, type Seat, type Vulnerability, SEATS } from '../core/types';

export const DEAL_LIBRARY_KEY = 'bridgelab.deal-editor.library.v3.6';
export interface DealDefinition {
  id: string;
  name: string;
  hands: Hands;
  dealer: Seat;
  vulnerability: Vulnerability;
}
export type CardAssignments = Record<string, Seat | undefined>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const validCards = new Map(deck().map(card => [card.id, card]));
const vulnerabilities: Vulnerability[] = ['None', 'NS', 'EW', 'Both'];

export function validateHands(hands: Hands): Hands {
  if (!hands || SEATS.some(seat => !Array.isArray(hands[seat]) || hands[seat].length !== 13)) throw new Error('四家必须各有 13 张牌');
  const cards = SEATS.flatMap(seat => hands[seat]);
  const ids = new Set(cards.map(card => card?.id));
  if (cards.length !== 52 || ids.size !== 52) throw new Error('52 张牌必须全部分配且不能重复');
  for (const card of cards) {
    const expected = card && validCards.get(card.id);
    if (!expected || card.suit !== expected.suit || card.rank !== expected.rank) throw new Error('牌例中含有不合法牌张');
  }
  return Object.fromEntries(SEATS.map(seat => [seat, sortCards(hands[seat].map(card => ({ ...card })))])) as Hands;
}

export function validateDeal(value: DealDefinition): DealDefinition {
  if (!value || typeof value.id !== 'string' || !value.id.trim() || value.id.length > 100) throw new Error('牌例编号无效');
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  if (!name || name.length > 80) throw new Error('牌例名称需为 1 至 80 个字符');
  if (!SEATS.includes(value.dealer) || !vulnerabilities.includes(value.vulnerability)) throw new Error('发牌人或局况无效');
  return { id: value.id, name, dealer: value.dealer, vulnerability: value.vulnerability, hands: validateHands(value.hands) };
}

export function emptyAssignments(): CardAssignments {
  return Object.fromEntries(deck().map(card => [card.id, undefined]));
}

export function assignmentsFromHands(hands: Hands): CardAssignments {
  const assignments = emptyAssignments();
  for (const seat of SEATS) for (const card of validateHands(hands)[seat]) assignments[card.id] = seat;
  return assignments;
}

export function handsFromAssignments(assignments: CardAssignments): Hands {
  const hands = Object.fromEntries(SEATS.map(seat => [seat, [] as Card[]])) as Hands;
  for (const card of deck()) {
    const seat = assignments[card.id];
    if (!seat || !SEATS.includes(seat)) throw new Error('请先把 52 张牌全部分配给四家');
    hands[seat].push(card);
  }
  return validateHands(hands);
}

export function loadDealLibrary(storage: Pick<Storage, 'getItem'>): DealDefinition[] {
  const raw = storage.getItem(DEAL_LIBRARY_KEY) ?? storage.getItem('bridgelab.deal-editor.library.v3.5'); if (!raw) return [];
  if (raw.length > 2_000_000) throw new Error('牌例库超过 2 MB');
  const file = JSON.parse(raw) as { version?: number; deals?: DealDefinition[] };
  if (file?.version !== 1 || !Array.isArray(file.deals) || file.deals.length > 50) throw new Error('牌例库格式不受支持');
  const deals = file.deals.map(validateDeal);
  if (new Set(deals.map(deal => deal.id)).size !== deals.length) throw new Error('牌例编号重复');
  return deals;
}

export function saveDeal(storage: StorageLike, deal: DealDefinition): DealDefinition[] {
  const clean = validateDeal(deal); const current = loadDealLibrary(storage);
  const next = [...current.filter(item => item.id !== clean.id), clean].slice(-50);
  storage.setItem(DEAL_LIBRARY_KEY, JSON.stringify({ version: 1, deals: next })); return next;
}

export function deleteDeal(storage: StorageLike, id: string): DealDefinition[] {
  const next = loadDealLibrary(storage).filter(deal => deal.id !== id);
  storage.setItem(DEAL_LIBRARY_KEY, JSON.stringify({ version: 1, deals: next })); return next;
}

export function newDealId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `deal-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

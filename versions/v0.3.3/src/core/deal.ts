import { type Card, type Hands, type Seat, type Vulnerability, SEATS, SUITS } from './types';

export function deck(): Card[] {
  return SUITS.flatMap(suit => Array.from({ length: 13 }, (_, i) => ({ id: `${suit}${i + 2}`, suit, rank: i + 2 })));
}

/** Seeded Fisher–Yates: repeatable on every supported JS platform. */
export function seededRandom(seed: string): () => number {
  let value = 2166136261;
  for (let i = 0; i < seed.length; i++) value = Math.imul(value ^ seed.charCodeAt(i), 16777619);
  return () => {
    value += 0x6D2B79F5;
    let t = Math.imul(value ^ (value >>> 15), 1 | value);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const sortCards = (cards: Card[]): Card[] => [...cards].sort((a, b) => SUITS.indexOf(b.suit) - SUITS.indexOf(a.suit) || b.rank - a.rank);

export function deal(seed: string): Hands {
  const cards = deck(); const random = seededRandom(seed);
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return Object.fromEntries(SEATS.map((seat, i) => [seat, sortCards(cards.filter((_, index) => index % 4 === i))])) as Hands;
}

const VUL_CYCLE: Vulnerability[] = ['None', 'NS', 'EW', 'Both', 'NS', 'EW', 'Both', 'None', 'EW', 'Both', 'None', 'NS', 'Both', 'None', 'NS', 'EW'];
export function boardInfo(board: number): { dealer: Seat; vulnerability: Vulnerability } {
  if (!Number.isSafeInteger(board) || board < 1) throw new Error('局号必须为正整数');
  return { dealer: SEATS[(board - 1) % 4], vulnerability: VUL_CYCLE[(board - 1) % 16] };
}

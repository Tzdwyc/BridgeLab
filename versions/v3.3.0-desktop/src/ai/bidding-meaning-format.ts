import type { Suit } from '../core/types';
import type { PointRange } from './bidding-semantics';

const suits: Suit[] = ['S', 'H', 'D', 'C'];
const names: Record<Suit, string> = { S: '黑桃', H: '红心', D: '方块', C: '梅花' };

/** Render an existing public promise, without deriving or rounding a new range. */
export function formatPointRange(value: PointRange | undefined, unit: '大牌点' | '支持点' = '大牌点'): string | undefined {
  if (!value || !Number.isInteger(value.min) || !Number.isInteger(value.max)
    || value.min < 0 || value.max > 40 || value.min > value.max || value.min === 0 && value.max === 40) return undefined;
  if (value.max === 40) return `${value.min}个${unit}以上`;
  return `${value.min === value.max ? value.min : `${value.min}~${value.max}`}个${unit}`;
}

export function formatSuitPromises(minimums: Partial<Record<Suit, number>>, maximums?: Partial<Record<Suit, number>>): string | undefined {
  const promised = suits.filter(suit => (minimums[suit] ?? 0) > 0 || maximums?.[suit] !== undefined);
  if (promised.length > 1 && promised.every(suit => Number.isInteger(minimums[suit]) && minimums[suit]! > 0
    && minimums[suit]! <= 13 && maximums?.[suit] === undefined && minimums[suit] === minimums[promised[0]]))
    return `${promised.map(suit => names[suit]).join('、')}各${minimums[promised[0]]}张以上`;
  const parts = suits.flatMap(suit => {
    const min = minimums[suit], max = maximums?.[suit], name = names[suit];
    if (min !== undefined && (!Number.isInteger(min) || min < 0 || min > 13)) return [];
    if (max !== undefined && (!Number.isInteger(max) || max < 0 || max > 13 || min !== undefined && min > max)) return [];
    if (max === 0) return [`无${name}`];
    if (min !== undefined && min === max) return [`恰好${min}张${name}`];
    if (min && max !== undefined) return [`${min}~${max}张${name}`];
    if (min) return [`${min}张以上${name}`];
    return max !== undefined ? [`最多${max}张${name}`] : [];
  });
  return parts.join('、') || undefined;
}

/** Select complete clauses; never shorten by cutting an explanation mid-sentence. */
export function joinBidMeaning(...parts: Array<string | undefined | false>): string {
  const clauses = parts.filter((part): part is string => typeof part === 'string' && !!part)
    .map(part => part.trim().replace(/[，。；]+$/u, '')).filter(Boolean);
  return [...new Set(clauses)].join('，') + '。';
}

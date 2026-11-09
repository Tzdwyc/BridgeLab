import { expect, it } from 'vitest';
import { auction, call, obs } from './precision-fixtures';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { enforceBiddingConsistency } from '../src/ai/bidding-consistency';
import { SEATS } from '../src/core/types';

it.each(['sayc', 'two-over-one'] as const)('%s retains the natural 1NT overcall platform for transfers and doubled acceptance', system => {
  for (const [prefix, next, role] of [['1C 1NT P', '2H', 'transfer'], ['1C 1NT P 2H X', '2S', 'transfer-acceptance']] as const) {
    const a = auction(prefix), seat = SEATS[a.length % 4];
    const meaning = publicCallMeaningAt([...a, { seat, call: call(next) }], a.length, system);
    expect(meaning.role).toBe(role);
    expect(meaning.artificial).toBe(role === 'transfer');
    if (role === 'transfer') expect(meaning.suitMinimums.S).toBe(5);
  }
});

it.each(['sayc', 'two-over-one'] as const)('%s reuses the existing weak-two suit-quality check without capturing the deferred third-seat five-card style', system => {
  const poor = obs('', { S: 'AKQ', H: '987654', D: '32', C: '98' });
  expect(enforceBiddingConsistency(poor, call('2H'), system)).toMatchObject({
    family: 'weak-two-quality', source: 'existing-rule', call: call('P'),
  });
  const deferred = obs('P P', { S: 'AQ52', H: 'KT984', D: 'J42', C: 'T' });
  expect(enforceBiddingConsistency(deferred, call('2H'), system)).toBeUndefined();
});

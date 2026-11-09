import { expect, it } from 'vitest';
import { auction, call, obs } from './precision-fixtures';
import { presentCall } from '../src/ai/bidding-presentation';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import type { BiddingSystem } from '../src/ai/systems';
import { SEATS } from '../src/core/types';

function shown(prefix: string, next: string, system: BiddingSystem) {
  const before = auction(prefix), seat = SEATS[before.length % 4], selected = call(next);
  return {
    meaning: publicCallMeaningAt([...before, { seat, call: selected }], before.length, system),
    text: presentCall(before, seat, selected, system),
  };
}

it('explains the actual Precision waiting Pass and the retained opener obligation', async () => {
  const observation = obs('1C 1NT', { S: '4', H: '5432', D: 'AQ65', C: 'K872' });
  const selected = await suggestSystemBid(observation, { system: 'precision', allowLookahead: false });
  expect(selected.call).toEqual(call('P'));
  expect(selected.trace).toBeNull();
  const result = shown('1C 1NT', 'P', 'precision');
  expect(result.meaning).toMatchObject({ role: 'precision-waiting-pass', forcing: 'one-round' });
  expect(result.text).toContain('同伴须再自然描述');
  expect(result.text).not.toMatch(/0~7|均型|5张以上/);
});

it('does not invent an opener obligation after natural game-level NT interference', () => {
  const result = shown('1C 3NT', 'P', 'precision');
  expect(result.meaning).toMatchObject({ role: 'precision-waiting-pass', forcing: 'none' });
  expect(result.text).not.toMatch(/同伴须|逼叫一轮|仍须/);
});

it('states a complete Precision 4405 answer once, including the diamond void', () => {
  const result = shown('2D P 2NT P', '3D', 'precision');
  expect(result.meaning.role).toBe('precision-answer');
  expect(result.text).toContain('黑桃/红心/方块/梅花为4=4=0=5');
  expect(result.text).not.toMatch(/4张以上黑桃|4张以上红心|无方块|恰好5张梅花/);
});

it.each(['sayc', 'two-over-one'] as const)('keeps %s jump-overcall feature answers distinct from a minimum rebid', system => {
  const result = shown('1D 2H P 2NT P', '3D', system);
  expect(result.meaning.role).toBe('weak-feature-answer');
  expect(result.meaning.controlSuits?.D).toBe('first-or-second-round');
  expect(result.text).toContain('显示方块A或K');
  expect(result.text).not.toMatch(/最低限|无可显示|无可展示|张以上方块/);
});

it.each(['sayc', 'two-over-one'] as const)('preserves %s quiet weak-two feature and original-suit answers', system => {
  const feature = shown('2H P 2NT P', '3D', system);
  expect(feature.text).toContain('显示方块A或K');
  const original = shown('2H P 2NT P', '3H', system);
  expect(original.meaning.role).toBe('natural-repeat');
  expect(original.text).not.toContain('显示红心A或K');
  expect(original.text).toContain('6张以上红心');
});

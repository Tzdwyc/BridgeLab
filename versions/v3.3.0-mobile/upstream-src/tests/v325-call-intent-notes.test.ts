import { expect, it } from 'vitest';
import { auction, call } from './precision-fixtures';
import { SEATS } from '../src/core/types';
import { presentCall } from '../src/ai/bidding-presentation';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import type { BiddingSystem } from '../src/ai/systems';

function shown(prefix: string, next: string, system: BiddingSystem = 'sayc') {
  const before = auction(prefix), seat = SEATS[before.length % 4], selected = call(next);
  return { text: presentCall(before, seat, selected, system),
    meaning: publicCallMeaningAt([...before, { seat, call: selected }], before.length, system) };
}

it.each(['sayc', 'two-over-one'] as const)('%s separates permission to continue, invitation, and choosing a game', system => {
  const descriptive = shown('1C P 1H P', '2C', system);
  expect(descriptive.meaning.forcing).toBe('none');
  expect(descriptive.text).toContain('不逼叫');
  expect(descriptive.text).not.toMatch(/成局，可止叫|止叫建议/);
  const invitation = shown('1NT P', '2NT', system);
  expect(invitation.meaning.invitation).toBe(true);
  expect(invitation.text).toContain('邀请，不逼叫，低限可停');
  const game = shown('1NT P', '3NT', system);
  expect(game.text).toContain('成局止叫');
  expect(game.text).not.toContain('邀请');
  const accepted = shown('1NT P 2NT P', '3NT', system);
  expect(accepted.text).toContain('接受');
  expect(accepted.text).toMatch(/成局止叫|自然成局，可止叫/);
});

it.each(['sayc', 'two-over-one'] as const)('%s retains forcing and semi-forcing obligations', system => {
  expect(shown('1S P', '1NT', system).text).toContain('半逼叫');
  expect(shown('1S P', '2D', system).text).toContain('逼叫进局');
  expect(shown('1NT P', '2D', system).text).toContain('逼叫一轮');
  expect(shown('1NT P', '2D', system).text).not.toMatch(/止叫建议|成局，可止叫/);
});

it.each(['sayc', 'two-over-one'] as const)('%s distinguishes preemptive openings from natural strength and game placement', system => {
  for (const [next, label] of [['2H', '弱二阻击'], ['3S', '三阶阻击'], ['4H', '四阶阻击']] as const) {
    const result = shown('', next, system);
    expect(result.text).toContain(label);
    expect(result.text).not.toContain('自然成局');
  }
  expect(shown('', '2C', system).text).toContain('人工强开叫');
  expect(shown('', '2C', system).text).not.toContain('阻击');
  expect(shown('', '1H', system).text).toBe('1♥：12~21个大牌点，5张以上红心。');
});

it('a transfer-then-3NT choice permits a major-fit correction and does not demand a Pass', () => {
  const result = shown('1NT P 2H P 2S P', '3NT');
  expect(result.meaning.intent).toBe('signoff');
  expect(result.text).toContain('成局提议，可止叫或改选高花');
  expect(result.text).not.toMatch(/必须不叫|必须Pass|同伴不得|不得继续/);
});

it('a natural weak escape is a stop suggestion rather than a new forcing suit', () => {
  const result = shown('1C P 1S P 2C P', '3D');
  expect(result.meaning.intent).toBe('signoff');
  expect(result.text).toContain('止叫建议，不逼叫');
  expect(result.text).not.toContain('逼叫一轮');
});

it.each(['sayc', 'two-over-one'] as const)('%s does not describe artificial opening 4NT as a natural stop', system => {
  const request = shown('', '4NT', system);
  expect(request.meaning.artificial).toBe(true);
  expect(request.text).toContain('人工双低花选择');
  expect(request.text).toContain('选择5♣或5♦');
  expect(request.text).toContain('逼叫一轮');
  expect(request.text).not.toMatch(/自然成局|止叫|均型|定量/);
  const choice = shown('4NT P', '5C', system);
  expect(choice.meaning.intent).toBe('answer');
  expect(choice.text).toContain('选择');
  expect(choice.text).toContain('完成低花选择，可停');
  expect(choice.text).not.toMatch(/关键张|邀请/);
});

it('display changes do not mutate the structured public promises or prefix', () => {
  const before = auction('1NT P 2NT P'), frozen = structuredClone(before), selected = call('3NT');
  const full = [...before, { seat: 'N' as const, call: selected }];
  const meaning = structuredClone(publicCallMeaningAt(full, before.length, 'sayc'));
  presentCall(before, 'N', selected, 'sayc');
  expect(publicCallMeaningAt(full, before.length, 'sayc')).toEqual(meaning);
  expect(before).toEqual(frozen);
});

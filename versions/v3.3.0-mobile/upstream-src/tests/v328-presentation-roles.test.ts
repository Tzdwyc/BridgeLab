import { expect, it } from 'vitest';
import { SEATS, type AuctionEntry, type Call, type Strain } from '../src/core/types';
import type { BiddingSystem } from '../src/ai/systems';
import { presentCall } from '../src/ai/bidding-presentation';
import { formatPointRange, joinBidMeaning } from '../src/ai/bidding-meaning-format';
const call = (token: string): Call => token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' }
  : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain };
function text(prefix: string, next: string, system: BiddingSystem = 'sayc') {
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map((t, i) => ({ seat: SEATS[i % 4], call: call(t) }));
  return presentCall(auction, SEATS[auction.length % 4], call(next), system);
}

// These explicit promises come from the existing system cards/approved public
// test positions. Expectations do not call the meaning formatter under test.
it.each(['sayc', 'two-over-one', 'precision'] as const)('%s limited/natural opening and NT promises use their own card', system => {
  const major = text('', '1H', system), nt = text('', '1NT', system);
  expect(major).toContain(system === 'precision' ? '11~15个大牌点' : '12~21个大牌点');
  expect(major).toContain('5张以上红心'); expect(major.length).toBeLessThan(45);
  expect(nt).toContain(system === 'precision' ? '13~15个大牌点' : '15~17个大牌点');
  expect(nt).toContain('均型');
});

it.each(['sayc', 'two-over-one'] as const)('%s public feature answer does not borrow the weak preempt range or side-suit length', system => {
  const feature = text('1H 2S P 2NT P', '3C', system);
  expect(feature).toContain('梅花A或K'); expect(feature).toContain('9~11个大牌点');
  expect(feature).not.toMatch(/5~11|6~10|张以上梅花|均型|未约定/);
  const minimum = text('1H 2S P 2NT P', '3S', system);
  expect(minimum).not.toContain('显示黑桃A或K'); expect(minimum).toContain('6张以上黑桃');
});

it.each(['sayc', 'two-over-one'] as const)('%s independent cue response completes F1 without fake fit or invented point ceiling', system => {
  const answer = text('1C 1H P 2C X', '2D', system);
  expect(answer).toContain('4张以上方块'); expect(answer).toContain('原套5张以上红心');
  expect(answer).toContain('不逼叫'); expect(answer).not.toMatch(/支持点|逼叫进局|均型|Michaels/);
  const forcing = text('1H P 2C P', '2H', system);
  expect(forcing).toContain('逼叫进局'); expect(forcing).not.toMatch(/不逼叫|可止叫/);
});

it('uses one support-point total and retains a support-cue floor only as an explicitly earlier promise', () => {
  const game = text('2C P 2D P 2NT P 3C P 3D P', '5D');
  expect(game).toContain('支持点'); expect(game).not.toContain('大牌点');
  const continuation = text('1H 1S P 2H P 2S P', '3S');
  expect(continuation).toContain('此前10个支持点以上'); expect(continuation).not.toContain('大牌点');
});

it('keeps artificial shortness and keycards distinct from natural long suits', () => {
  const shortness = text('1S P 2NT P', '3C');
  expect(shortness).toContain('最多1张梅花'); expect(shortness).toContain('逼叫进局');
  expect(shortness).not.toMatch(/张以上梅花|12~21|均型/);
  const keys = text('1H P 3H P 4NT P', '5H');
  expect(keys).toContain('2或5个关键张'); expect(keys).toContain('无将牌Q');
  expect(keys).toContain('可停在约定将牌'); expect(keys).not.toMatch(/张以上|自然成局|大牌点|支持点/);
});

it('distinguishes an invitation, a selected game and a transfer game proposal', () => {
  const invitation = text('1H P', '3H');
  expect(invitation).toContain('邀请'); expect(invitation).toContain('不逼叫');
  const game = text('1H P', '4H'); expect(game).toContain('成局止叫');
  const correction = text('1NT P 2D P 2H P', '3NT');
  expect(correction).toContain('可止叫或改选高花'); expect(correction).not.toContain('逼叫进局');
});

it('states Precision 4405 once, and does not confuse strong clubs with natural clubs', () => {
  const shape = text('2D P 2NT P', '3D', 'precision');
  expect(shape).toContain('4=4=0=5'); expect(shape).not.toMatch(/张以上|恰好|无方块/);
  const strong = text('', '1C', 'precision');
  expect(strong).toContain('16个大牌点以上'); expect(strong).toContain('不承诺梅花套');
  expect(strong).not.toMatch(/张以上梅花|均型/);
});

it('does not attach natural weak-long-minor prose to Precision strong-club NT positives', () => {
  for (const prefix of ['1C P', 'P P 1C P']) {
    const positive = text(prefix, '1NT', 'precision');
    expect(positive).toContain(prefix.startsWith('P') ? '8~12个大牌点' : '8~13个大牌点');
    expect(positive).toContain('逼叫进局');
    expect(positive).not.toMatch(/长低花弱牌|不保证均型/);
  }
  const weakNatural = text('1D P', '1NT', 'sayc');
  expect(weakNatural).toContain('可含长低花弱牌');
  const actualEscape = text('1NT 2S', '3C', 'sayc');
  expect(actualEscape).toContain('6张以上梅花'); expect(actualEscape).toContain('5~9个大牌点');
  expect(actualEscape).toContain('不逼叫');
});

it('keeps unsupported candidates, known pending obligations and ordinary Pass separate', () => {
  expect(text('1NT P 2C P', '3NT')).toContain('不是本轮约定回答');
  expect(text('1NT P 2C P', '3NT')).toContain('仍须完成');
  expect(text('', '3NT', 'precision')).toContain('此处未约定');
  expect(text('', 'P')).toBe('不叫：不承诺具体点力或牌型。');
});

it('normalizes whole clauses without truncating or changing the promised point interval', () => {
  expect(joinBidMeaning('自然回答。', '自然回答', '不逼叫，')).toBe('自然回答，不逼叫。');
  expect(formatPointRange({ min: 12, max: 21 })).toBe('12~21个大牌点');
});

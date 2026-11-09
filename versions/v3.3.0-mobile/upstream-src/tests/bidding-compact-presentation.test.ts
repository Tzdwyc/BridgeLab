import { expect, it } from 'vitest';
import type { AuctionEntry, Call, Seat, Strain } from '../src/core/types';
import type { BiddingSystem } from '../src/ai/systems';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { presentCall } from '../src/ai/bidding-presentation';
import { formatPointRange, formatSuitPromises, joinBidMeaning } from '../src/ai/bidding-meaning-format';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function parse(value: string): Call {
  return value === 'P' ? { kind: 'pass' } : value === 'X' ? { kind: 'double' } : value === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: Number(value[0]), strain: value.slice(1) as Strain };
}
function fixture(prefix: string, next: string, system: BiddingSystem = 'sayc') {
  const auction: AuctionEntry[] = prefix ? prefix.split(' ').map((value, i) => ({ seat: seats[i % 4], call: parse(value) })) : [];
  const seat = seats[auction.length % 4], call = parse(next);
  return { auction, seat, call, text: presentCall(auction, seat, call, system) };
}

it('formats only defined point ranges and distinguishes HCP from support points', () => {
  expect(formatPointRange({ min: 12, max: 21 })).toBe('12~21个大牌点');
  expect(formatPointRange({ min: 13, max: 40 })).toBe('13个大牌点以上');
  expect(formatPointRange({ min: 4, max: 4 })).toBe('4个大牌点');
  expect(formatPointRange({ min: 10, max: 40 }, '支持点')).toBe('10个支持点以上');
  for (const range of [undefined, { min: 0, max: 40 }, { min: 16, max: 15 }, { min: NaN, max: 20 }])
    expect(formatPointRange(range)).toBeUndefined();
});

it('preserves exact, minimum, maximum and zero suit promises without inventing a length', () => {
  expect(formatSuitPromises({ H: 5 })).toBe('5张以上红心');
  expect(formatSuitPromises({ S: 4 }, { S: 4 })).toBe('恰好4张黑桃');
  expect(formatSuitPromises({}, { D: 0 })).toBe('无方块');
  expect(formatSuitPromises({ H: 3 }, { H: 4 })).toBe('3~4张红心');
  expect(formatSuitPromises({ H: 5, S: 5 })).toBe('黑桃、红心各5张以上');
  expect(formatSuitPromises({})).toBeUndefined();
  expect(formatSuitPromises({ C: 6 }, { C: 5 })).toBeUndefined();
});

it('joins complete distinct clauses rather than truncating or publishing missing values', () => {
  expect(joinBidMeaning('13个大牌点以上', undefined, false, '逼叫进局', '逼叫进局')).toBe('13个大牌点以上，逼叫进局。');
});

it('gives the requested short natural-major opening without redundant Rule20 or default nonforcing prose', () => {
  const { text } = fixture('', '1H');
  expect(text).toBe('1♥：12~21个大牌点，5张以上红心。');
  expect(text).not.toMatch(/二十法则|不逼叫|此前|同伴/);
});

it('retains the relevant SAYC minor-opening qualification without attaching it to two-over-one', () => {
  expect(fixture('', '1D', 'sayc').text).toContain('12个大牌点开叫须符合二十法则');
  expect(fixture('', '1D', 'two-over-one').text).not.toContain('二十法则');
});

it('keeps Precision limited majors and artificial strong club distinct', () => {
  const major = fixture('', '1H', 'precision').text;
  expect(major).toContain('11~15个大牌点'); expect(major).toContain('5张以上红心');
  const club = fixture('', '1C', 'precision').text;
  expect(club).toContain('16个大牌点以上'); expect(club).toContain('人工'); expect(club).toContain('不承诺梅花套');
  expect(club).not.toMatch(/\d张以上梅花|均型/);
});

it.each(['sayc', 'two-over-one'] as const)('shows the existing project two-over-one game force in %s', system => {
  const text = fixture('1S P', '2D', system).text;
  expect(text).toContain('13个大牌点以上'); expect(text).toContain('4张以上方块'); expect(text).toContain('逼叫进局');
});

it('keeps transfers and artificial Stayman denial separate from natural called-suit lengths', () => {
  const transfer = fixture('1NT P', '2D').text;
  expect(transfer).toContain('转移'); expect(transfer).toContain('5张以上红心');
  expect(transfer).toContain('不承诺方块长度'); expect(transfer).not.toContain('5张以上方块');
  const answer = fixture('1NT P 2C P', '2D').text;
  expect(answer).toContain('无四张高花'); expect(answer).toContain('不承诺方块套');
});

it('retains the selected strong-diamond artificial negative and natural positive, without a false balanced promise', () => {
  const negative = fixture('2C P 2D P 3D P', '3H').text;
  expect(negative).toContain('0~3个大牌点'); expect(negative).toContain('人工二次负应');
  expect(negative).toContain('不承诺红心长度'); expect(negative).toContain('逼叫一轮');
  const positive = fixture('2C P 2D P 3D P', '3NT').text;
  expect(positive).toContain('4个大牌点以上'); expect(positive).toContain('自然'); expect(positive).toContain('成局止叫');
  expect(positive).not.toMatch(/均型|负应/);
});

it('does not label an opponent Pass as accepting our strong-2C partnership contract', () => {
  expect(fixture('2C P 2D P 3D P 3NT', 'P').text).toContain('对方3NT');
  expect(fixture('2C P 2D P 3D P 3NT', 'P').text).not.toContain('本方');
  expect(fixture('2C P 2D P 3D P 3NT P', 'P').text).toContain('本方3NT');
});

it('distinguishes negative, penalty and lead-directing doubles with their actual requirements', () => {
  const negative = fixture('1D 1S', 'X').text;
  expect(negative).toContain('负加倍'); expect(negative).toContain('4张以上红心');
  const penalty = fixture('1NT', 'X').text;
  expect(penalty).toContain('惩罚性加倍'); expect(penalty).toContain('3个快速赢墩');
  const lead = fixture('1NT P 2D', 'X').text;
  expect(lead).toContain('首攻指示'); expect(lead).not.toContain('技术性加倍');
});

it('preserves support-point units and the natural two-card preference caveat', () => {
  expect(fixture('1H 1S P 2H P 2S P', '3S').text).toContain('支持点');
  const preference = fixture('1H P 1NT P 2C P', '2H').text;
  expect(preference).toContain('可仅两张'); expect(preference).toContain('不保证八张配合'); expect(preference).toContain('不逼叫');
});

it('retains natural one-level fourth-suit forcing and the passed-hand exception', () => {
  expect(fixture('1C P 1D P 1H P', '1S').text).toContain('自然第四花色，逼叫一轮');
  expect(fixture('P P 1C P 1D P 1H P', '1S').text).toContain('不逼叫');
});

it('keeps Precision shape replies explicit and the short-diamond opening artificial', () => {
  const reply = fixture('2D P 2NT P', '3D', 'precision').text;
  expect(reply).toContain('4=4=0=5'); expect(reply).toContain('逼叫一轮');
  const opening = fixture('', '2D', 'precision').text;
  expect(opening).toContain('人工短方块'); expect(opening).toContain('最多1张方块'); expect(opening).not.toContain('6张以上方块');
});

it('does not fabricate an agreement for unavailable, undefined or legacy calls', () => {
  expect(fixture('1NT', '1S').text).toContain('不可叫');
  const undefinedCall = fixture('', '3NT', 'precision').text;
  expect(undefinedCall).toContain('未约定'); expect(undefinedCall).not.toMatch(/25|赌博/);
  const legacy = fixture('1NT P', '2D', 'natural-lite').text;
  expect(legacy).toContain('旧版简化自然制'); expect(legacy).not.toMatch(/转移|Stayman|RKCB/);
});

it('leaves canonical structured meanings and auction prefixes unchanged', () => {
  for (const [prefix, next, system] of [['', '1H', 'sayc'], ['1NT P', '2D', 'two-over-one'], ['1C P', '1D', 'precision']] as const) {
    const { auction, seat, call } = fixture(prefix, next, system), frozenAuction = structuredClone(auction);
    const full = [...auction, { seat, call }], before = publicCallMeaningAt(full, auction.length, system);
    const text = presentCall(auction, seat, call, system);
    expect(publicCallMeaningAt(full, auction.length, system)).toEqual(before); expect(auction).toEqual(frozenAuction);
    expect(text).not.toMatch(/undefined|NaN|公共前缀|模型|roleLabel/);
  }
});

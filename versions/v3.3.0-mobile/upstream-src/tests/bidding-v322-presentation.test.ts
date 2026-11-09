import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { presentCall } from '../src/ai/bidding-presentation';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Seat, type Strain, partnerOf } from '../src/core/types';
import { type BiddingSystem } from '../src/ai/systems';
import { historicalCallExplanation, historicalBidAdjustment } from '../src/ai/historical-bidding-presentation';
import { newGame } from '../src/core/game';
import { agreementVersionFor } from '../src/ai/bid-strategy';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function parse(token: string): Call {
  return token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
}
const auction = (text: string): AuctionEntry[] => text ? text.split(' ').map((token, index) => ({ seat: seats[index % 4], call: parse(token) })) : [];
function position(prefix: string, next: string, system: BiddingSystem = 'sayc') {
  const a = auction(prefix), seat = seats[a.length % 4], call = parse(next);
  return { a, seat, call, system, text: describeCall(a, seat, call, system), meaning: publicCallMeaningAt([...a, { seat, call }], a.length, system) };
}

describe('v3.2.2 public bidding presentation', () => {
  it('does not read private cards or claim a Pass proves insufficient strength', () => {
    const p = position('', 'P');
    expect(p.text).toContain('不承诺具体点力');
    expect(p.text).not.toContain('没有达到');
  });
  it.each([
    ['2C P 2D P', '2H', ['4张以上红心', '5张以上梅花', '不逼叫'], ['2NT为', '3C为']],
    ['2C P 2D P', '2NT', ['14~15个大牌点', '无四张高花', '6张以上梅花'], ['3C为']],
    ['2C P 2D P', '3C', ['11~13个大牌点', '无四张高花', '6张以上梅花'], ['2NT为']],
    ['2D P 2NT P', '3C', ['4=4=1=4', '逼叫一轮'], ['3D=4405', '3H=4315']],
    ['2D P 2NT P', '3D', ['4=4=0=5'], ['3C=4414']],
    ['1C P', '1D', ['0~7个大牌点', '人工负应', '不承诺方块长度'], ['五张', '5张']],
    ['1C P 1D P', '1H', ['16个大牌点以上', '4张以上红心'], ['17个大牌点以上']],
    ['1NT P', '2C', ['10个大牌点以上', 'Stayman'], ['8个大牌点以上']],
  ] as const)('selects only the actual Precision answer: %s / %s', (prefix, next, yes, no) => {
    const p = position(prefix, next, 'precision');
    for (const phrase of yes) expect(p.text).toContain(phrase);
    for (const phrase of no) expect(p.text).not.toContain(phrase);
    // The compact shape reply need not repeat its zero diamond count in prose.
    if (prefix === '2D P 2NT P' && next === '3D') {
      expect(p.meaning.suitMinimums.D ?? 0).toBe(0); expect(p.meaning.suitMaximums?.D).toBe(0);
    }
  });
  it('keeps forcing, passed-hand, and interference distinctions', () => {
    expect(position('1H P', '2D').text).toContain('逼叫进局');
    expect(position('P P 1H P', '2D').text).not.toContain('逼叫进局');
    expect(position('1NT 2H', '2S').text).toContain('自然');
    expect(position('1NT 2H', '2S').text).toContain('不逼叫');
    expect(position('1H P 2D P 2H P', 'P').text).toContain('仍须完成');
    expect(position('1NT P 2D P 2H P', 'P').text).not.toContain('仍须完成');
    expect(position('1NT P 2D X P P', 'P').text).toContain('仍须完成');
    expect(position('1NT P 2C P 2D P', 'P').text).not.toContain('仍须完成');
    expect(position('1C P 1D P 1H P', '1S').text).toContain('逼叫一轮');
    expect(position('P P 1C P 1D P 1H P', '1S').text).toContain('不逼叫');
  });
  it('keeps transfers separate from natural suits and artificial answers from natural lengths', () => {
    expect(position('1NT P', '2D').text).toContain('5张以上红心');
    expect(position('1NT P', '2D').text).toContain('高花转移');
    expect(position('1NT P 2D P', '2H').text).toContain('2张以上红心');
    expect(position('1NT P 2C P', '2D').text).toContain('不承诺方块套');
    expect(position('1NT P 2C P', '3NT').meaning.defined).toBe(false);
    expect(position('1NT P 2C P', '3NT').text).toContain('不是本轮约定回答');
  });
  it.each(['sayc', 'two-over-one'] as const)('retains prior two-over-one game force through natural and fourth-suit continuations in %s', system => {
    for (const [prefix, next] of [
      ['1S P 2C P 2D P', '2S'],
      ['1H P 2C P', '2H'],
      ['1H P 2C P 2D P 2S P', '3H'],
      ['1S P 2C P 2D P 2S P', '3D'],
    ]) {
      const p = position(prefix, next, system);
      expect(p.meaning.forcing).toBe('game');
      expect(p.text).toContain('逼叫进局');
      expect(p.text).not.toContain('不逼叫');
    }
  });
  it.each(['sayc', 'two-over-one'] as const)('uses the approved 3H negative / 3NT natural answer card after strong 3D in %s', system => {
    expect(position('2C P 2D P 3D P', '3H', system).text).toContain('0~3个大牌点');
    expect(position('2C P 2D P 3D P', '3H', system).text).toContain('不承诺红心长度');
    expect(position('2C P 2D P 3D P', '3NT', system).text).toContain('4个大牌点以上');
    expect(position('2C P 2D P 3D P', '3NT', system).text).not.toContain('负应');
    const naturalGame = position('2C P 2D P 3D P', '4H', system);
    expect(naturalGame.text).toContain('4个大牌点以上');
    expect(naturalGame.meaning.artificial).toBe(false); expect(naturalGame.meaning.hcpRange?.min).toBeGreaterThanOrEqual(4);
    const negative = position('2C P 2D P 3D P', '3H', system).meaning;
    expect(negative.artificial).toBe(true); expect(negative.hcpRange).toEqual({ min: 0, max: 3 });
    expect(position('2C P 2D P 3D P 3H P', '4D', system).text).toContain('不逼叫');
    expect(position('2C P 2D P 3D P 3NT P', 'P', system).text).toContain('自然成局');
  });
  it('distinguishes takeout, negative, lead-directing, strength and penalty doubles', () => {
    expect(position('1D', 'X').text).toContain('技术性加倍');
    expect(position('1D 1S', 'X').text).toContain('负加倍');
    expect(position('1D 1S', 'X').text).toContain('4张以上红心');
    expect(position('1NT P 2D', 'X').text).toContain('首攻指示');
    expect(position('1H 2H', 'X').text).toContain('实力加倍');
    expect(position('1NT', 'X').text).toContain('惩罚性加倍');
    expect(position('1NT', 'X').text).toContain('3个快速赢墩');
    expect(position('1D P P', 'X').text).toContain('技术性加倍');
    expect(position('1D X 2D', 'X').text).toContain('响应性技术性加倍');
    expect(position('1C 1H P P', 'X').text).toContain('再开叫技术性加倍');
    expect(position('2S P 2NT', 'X').text).toContain('具体首攻方向未约定');
  });
  it('keeps Precision strength redoubles distinct from general redoubles', () => {
    const p = position('1C X', 'XX', 'precision');
    expect(p.meaning.role).toBe('precision-positive');
    expect(p.text).toContain('人工实力正应');
    expect(p.text).toContain('8个大牌点以上');
    expect(p.text).toContain('逼叫进局');
    expect(p.text).not.toContain('后续惩罚');
    expect(position('1C X', 'XX').text).toContain('实力再加倍');
  });
  it('distinguishes enemy-suit cues, Michaels and natural preferences', () => {
    expect(position('1D', '2D').text).toContain('Michaels');
    expect(position('1D 1S P', '2D').text).toContain('敌套扣叫');
    expect(position('1H P 1NT P 2C P', '2H').text).toContain('可仅两张');
    expect(position('1H P 1NT P 2C P', '2H').text).not.toContain('八张配合已确认');
  });
  it('retains inherited support strength, invitation decisions and the source of forced replies', () => {
    expect(position('1H 1S P 2H P 2S P', '3S').text).toContain('10个支持点以上');
    expect(position('2H P P', '2S').text).toContain('平衡位');
    expect(position('1D P', '1NT').text).toContain('长低花');
    expect(position('1S P P X P 3H P', '4H').text).toContain('接受同伴');
    expect(position('2S P', '3S').text).toContain('延长阻击，非邀请');
    expect(position('2S P', '3S').meaning.invitation).toBe(false);
    expect(position('1D P 1S P 2C P P X P', '2H').text).toContain('不保证四张');
    const positive = position('2C P 2D P 3C P', '4D');
    expect(positive.text).toContain('4个大牌点以上'); expect(positive.meaning.artificial).toBe(false);
    expect(positive.meaning.hcpRange?.min).toBeGreaterThanOrEqual(4);
    const secondNegative = position('2C P 2D P 3C P', '3D').meaning;
    expect(secondNegative.artificial).toBe(true); expect(secondNegative.hcpRange).toEqual({ min: 0, max: 3 });
    const required = position('1D P 1H P', '2D');
    expect(analyzeAuctionSemantics(required.a, required.seat, required.system).mustBid).toBe(true);
    expect(required.meaning.forcing).toBe('none'); expect(required.text).toContain('不逼叫');
    const free = position('P P 1D P 1H P', '2D');
    expect(analyzeAuctionSemantics(free.a, free.seat, free.system).mustBid).toBe(false);
    expect(free.meaning.role).toBe('natural-repeat'); expect(free.text).toContain('不逼叫');
    const twoSuits = position('P P 1S P 1NT P', '2C').text;
    expect(twoSuits).toContain('4张以上梅花');
    expect(twoSuits).toContain('原套5张以上黑桃');
    const jacobyFit = position('1S P 2NT P 3C P', '4S');
    expect(jacobyFit.text).toContain('4张以上黑桃');
    expect(publicPlayerConstraints(jacobyFit.a, partnerOf(jacobyFit.seat), jacobyFit.system).suitMinimums.S).toBe(5);
  });
  it('distinguishes RKCB answers, quantitative invitations and king asks', () => {
    expect(position('1S P 3S P', '4NT').text).toContain('RKCB 1430');
    expect(position('1S P 3S P 4NT P', '5D').text).toContain('0或3个关键张');
    expect(position('1NT P', '4NT').text).toContain('定量');
    expect(position('1NT P', '4NT').text).toContain('邀请，不逼叫');
    expect(position('1NT P', '4NT').meaning.invitation).toBe(true);
    expect(position('1NT P', '4NT').meaning.forcing).toBe('none');
    expect(position('1NT P', '5NT').text).toContain('至少叫到6NT');
  });
  it('states the selected queen answer and keeps higher side kings possible on a king-denial return', () => {
    expect(position('1S P 3S P 4NT P 5C P 5D P', '5S').text).toContain('否认Q');
    expect(position('1S P 3S P 4NT P 5C P 5D P', '6S').text).toContain('有将牌Q');
    const queenAndKing = position('1S P 3S P 4NT P 5C P 5D P', '6H').text;
    expect(queenAndKing).toContain('有将牌Q');
    expect(queenAndKing).toContain('红心K');
    expect(position('1H P 3H P 4NT P 5S P 5NT P', '6H').text).toContain('不否认更高花色K');
    expect(position('1H P 3H P 4NT P 5S P 5NT P', '6C').text).toContain('不保证十三墩');
  });
  it('never assigns newer artificial conventions to legacy natural saves', () => {
    const p = position('1NT P', '2D', 'natural-lite');
    expect(p.text).toContain('旧版简化自然制');
    expect(p.text).not.toMatch(/Stayman|转移|RKCB|逼叫进局/);
    expect(position('', '2C', 'natural-lite').text).not.toContain('强2♣');
    for (const next of ['4NT', '6NT']) {
      expect(position('', next, 'natural-lite').text).toContain('未约定');
      expect(position('', next, 'natural-lite').text).not.toMatch(/23个大牌点以上|均型/);
    }
  });
  it('labels unavailable and unagreed calls without inventing promises', () => {
    expect(position('1NT', '1S').text).toContain('不可叫');
    expect(position('', 'X').text).toContain('不可叫');
    const p = position('', '3NT', 'precision');
    expect(p.meaning.defined).toBe(false);
    expect(p.text).toContain('未约定');
    expect(p.text).not.toMatch(/25|赌博/);
  });
  it('refreshes archived text only for the exact recorded agreement and preserves unknown historical explanations', () => {
    const game = newGame(1, 'presentation-archive', { biddingSystem: 'sayc', agreementVersion: agreementVersionFor('sayc') });
    game.auction = [{ seat: 'N', call: parse('1H') }];
    expect(historicalCallExplanation(game, 0, '旧说明')).toBe(describeCall([], 'N', parse('1H'), 'sayc'));
    const old = { ...game, agreementVersion: 'sayc-old' };
    expect(historicalCallExplanation(old, 0, '旧说明')).toBe('原约定：旧说明');
    expect(historicalCallExplanation(old, 0)).toBe(`按当前SAYC/2/1：${describeCall([], 'N', parse('1H'), 'sayc')}`);
    expect(historicalCallExplanation({ ...game, biddingSystem: undefined, agreementVersion: undefined }, 0)).toBe('原叫牌体系未记录。');
    expect(historicalBidAdjustment('前瞻估计增加 2.1 IMP，且严重得失倾向支持改叫')).not.toMatch(/前瞻|IMP|模型/);
  });
  it.each(['sayc', 'two-over-one'] as const)('preserves frozen %s-v2.1 explanations when the shifted 3H agreement changes', system => {
    const game = newGame(1, 'old-strong-diamond', { biddingSystem: system, agreementVersion: `${system}-v2.1` });
    game.auction = auction('2C P 2D P 3D P 3NT');
    const frozen = '原约定3NT为人工二次负应，不承诺自然无将成局';
    expect(historicalCallExplanation(game, 6, frozen)).toBe(`原约定：${frozen}`);
    expect(historicalCallExplanation(game, 6)).toBe(`按当前${system === 'sayc' ? 'SAYC/2/1' : '2/1'}：${describeCall(game.auction.slice(0, 6), game.auction[6].seat, game.auction[6].call, system)}`);
    expect(game.agreementVersion).toBe(`${system}-v2.1`);
    const current = { ...game, agreementVersion: agreementVersionFor(system) };
    expect(historicalCallExplanation(current, 6)).toContain('自然');
    expect(historicalCallExplanation(current, 6)).toContain('成局止叫');
  });
  it('leaves structured meanings unchanged and uses the same public boundary', () => {
    for (const system of ['sayc', 'two-over-one', 'precision', 'natural-lite'] as const) {
      for (const prefix of ['', '1H P', '1NT P', '1D 1S', '2C P 2D P', '1H P 1NT P 2C P']) {
        const a = auction(prefix), seat = seats[a.length % 4];
        for (const call of legalCalls(a, seat)) {
          const before = publicCallMeaningAt([...a, { seat, call }], a.length, system);
          const text = describeCall(a, seat, call, system);
          expect(text).toBe(presentCall(a, seat, call, system));
          expect(publicCallMeaningAt([...a, { seat, call }], a.length, system)).toEqual(before);
          expect(text).not.toMatch(/undefined|NaN|未分类|roleLabel|公共前缀|模型|NF|\bGF\b/);
          expect(text.length).toBeGreaterThan(5);
        }
      }
    }
  });
});

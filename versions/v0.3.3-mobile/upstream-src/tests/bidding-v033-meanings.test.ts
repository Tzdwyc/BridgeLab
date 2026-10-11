import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { SHARED_CONVENTIONS, SYSTEMS } from '../src/ai/systems';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';

// Authored from individually inspected public auction prefixes. These are
// convention/hover assertions, not an automatic oracle for bidding quality.
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function parse(token: string): Call {
  if (token === 'P') return { kind: 'pass' };
  if (token === 'X') return { kind: 'double' };
  if (token === 'XX') return { kind: 'redouble' };
  return { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
}
function context(prefix: string) {
  const tokens = prefix.split(' ').filter(Boolean);
  const auction: AuctionEntry[] = tokens.map((token, index) => ({ seat: seats[index % 4], call: parse(token) }));
  return { auction, seat: seats[tokens.length % 4] };
}
function meaning(prefix: string, token: string) {
  const { auction, seat } = context(prefix);
  return describeCall(auction, seat, parse(token), 'sayc');
}

describe('v0.3.3 public meanings and Pass availability', () => {
  it.each([
    ['4527 first two-level overcall after enemy response', '1D P 1S', '2C', '首次2阶自然争叫'],
    ['7163 first overcall has a natural five-card suit', '1D P 1H', '2C', '5+张C'],
    ['7209 balancing overcall', '2H P P', '2S', '平衡位'],
    ['680 natural interference over NT', '1NT', '2D', '首次2阶自然争叫'],
    ['7170 competitive support is not own second suit', '1C 2H 2S P', '3S', '3+张支持'],
    ['7272 natural five-card response over NT interference', '1NT 2D 3H P', '4H', '同伴公开5+张'],
    ['7293 genuine second-suit repeat retains four cards', '1D P 1H P 2C P 2S P', '3C', '4+张承诺'],
    ['540 responder repeated original major publicly shows six', '1H P 1S P 2D P 2S P', '4S', '同伴公开6+张'],
    ['540 only two supports needed for public six-card major', '1H P 1S P 2D P 2S P', '4S', '2+张支持'],
    ['7273 repeated responder major over NT invites', '1D P 1S P 1NT P', '3S', '10–12 HCP'],
    ['7320 Michaels answer describes asked minor', '1S 2S P 2NT P', '3C', 'Michaels 2NT询问后的低花答叫'],
    ['7320 Michaels minor has five cards', '1S 2S P 2NT P', '3C', '5+张C'],
    ['7174 low-minor escape relay completed', '1C 1NT P 2S P 3C P', '3D', '不逼叫'],
    ['1008 strong two-club waiting after lead double', '2C X', '2D', '不承诺方块长度'],
    ['7234 correct second negative after natural clubs', '2C P 2D P 3C P', '4D', '本轮固定负应叫为3♦'],
    ['7213 low-minor second-negative answer names actual suit', '2C P 2D P 3D P 3NT P', '4D', '原低花D'],
    ['7352 negative double jump uses support points', '1D 2H X P', '3S', '16–18调整支持点'],
    ['7260 negative double game uses support context', '1D 1S X P', '4H', '高花成局答叫'],
    ['844 four diamonds is a jump over available three', '2H X P', '4D', '最低可叫3D'],
    ['7259 delayed support can be three', '1D P 1H P 1S P 2C P', '2H', '可仅3张支持'],
    ['7524 major preference does not assert exactly two', '1H P 1S P 2C P', '2H', '也可有三张'],
    ['7478 restricted NT response permits long minor', '1D P', '1NT', '长低花牌'],
    ['7777 Jacoby requires thirteen adjusted points', '1H P', '2NT', '13+调整支持点'],
    ['7368 minor preference does not guarantee eight-card fit', '1D P', '2D', '确认八张配合需5+张支持'],
    ['7521 Stayman four-card support invitation', '1H 1NT P 2C X 2H P', '3H', '同伴公开4+张'],
  ])('%s', (_label, prefix, token, expected) => {
    expect(meaning(prefix, token)).toContain(expected);
  });

  it.each([
    ['7426 natural original-minor preference', '1D P 1S P 1NT P 2D P'],
    ['7491 passed-hand natural new minor', 'P P P 1H P 1S P 1NT P 2C P'],
    ['Stayman natural major answer', '1NT P 2C P 2H P'],
    ['accepted transfer', '1NT P 2D P 2H P'],
    ['4072 natural strong NT after technical double', '1C P P X P 1H P 2NT P'],
  ])('%s allows Pass in UI when no continuing force exists', (_label, prefix) => {
    const { auction, seat } = context(prefix);
    expect(analyzeAuctionSemantics(auction, seat, 'sayc').mustBid).toBe(false);
    expect(meaning(prefix, 'P')).not.toContain('保持禁用');
  });

  it('requires an answer to an artificial inquiry before allowing Pass', () => {
    expect(meaning('1NT P 2D X', 'P')).toContain('保持禁用');
    expect(meaning('1NT P 2C P 2D P', 'P')).toContain('保持禁用');
  });

  it('does not invent a redouble history in penalty hover', () => {
    expect(meaning('1D P 1H', 'X')).not.toContain('再加倍后');
    expect(meaning('1S X XX P P 2H', 'X')).toContain('再加倍后');
  });

  it('shares context-specific natural NT ranges with the hover', () => {
    expect(meaning('1H P 1S P 2C P 2D P', '2NT')).not.toContain('18–19');
    expect(meaning('1D P P', '1NT')).toContain('11–14');
    expect(meaning('1D X P 1H P', '2NT')).toContain('21–22');
  });

  it('does not reuse artificial club inquiry as a natural long-suit promise', () => {
    const text = meaning('2S 2NT P 3C P 3D P', '4C');
    expect(text).toContain('此前同花色叫品属于人工');
    expect(text).not.toContain('保证之前显示的5+张');
  });

  it('does not turn the enemy Michaels call into our game force', () => {
    expect(meaning('1S 2S', '3S')).not.toContain('进局逼叫仍继续');
    expect(meaning('1C 2C', '3C')).not.toContain('进局逼叫仍继续');
  });

  it('keeps the declared custom card consistent with support and HCP distinctions', () => {
    const card = SYSTEMS.sayc.rules.join('\n');
    expect(card).toContain('确认八张低花配合需五张支持');
    expect(card).toContain('自然第二套重复不自动从四张变成六张');
    expect(card).toContain('第四花色为人工询问');
    expect(SHARED_CONVENTIONS.join('\n')).toContain('最低二阶另一高花为四张自然邀请');
  });

  it.each([
    ['700 accepted original-major jump invitation', 'P P P 1S P 1NT P 3S P', '4S', '成局'],
    ['951 NT opener accepts transfer invitation in known major', '1NT P 2D X 2H P 2NT P', '4H', '3+张支持搭档已示的五张高花'],
    ['1098 weak-two repeat preserves six', '2S P 3H P', '3S', '不降为五张例外'],
    ['4118 competition does not turn six points into ten', '1D P 1H X 2H 3C', '3H', '竞争性加叫'],
    ['7519 responder jump over second suit invites', '1D P 1S P 2C P', '3S', '10–12 HCP'],
    ['NT other-major four-card invitation', '1NT P 2C P 2H P', '2S', '4+张所叫高花'],
    ['NT overcall other-major four-card invitation', '1D 1NT P 2C P 2H P', '2S', '4+张所叫高花'],
    ['NT overcall transfer invitation accepts known major', '1D 1NT P 2H P 2S P 2NT P', '4S', '3+张支持搭档已示的五张高花'],
    ['unagreed NT other-major jump stays unagreed', '1NT P 2C P 2S P', '3H', '未约定固定长度'],
    ['4441 strong minor can be four cards', '2C P 2D P', '3D', '允许自然四张低花'],
    ['fourth-suit NT answer has a response role', '1H P 1S P 2C P 2D P', '2NT', '自然回答第四花色询问'],
  ])('%s', (_label, prefix, token, expected) => {
    expect(meaning(prefix, token)).toContain(expected);
  });

  it('keeps playable same-trump keycard answers separate from artificial side suits', () => {
    for (const prefix of ['1H P 2NT P 4NT P 5H P', '1D P 1H P 2C P 4NT P 5C P']) {
      const { auction, seat } = context(prefix);
      expect(meaning(prefix, 'P')).not.toContain('保持禁用');
      expect(analyzeAuctionSemantics(auction, seat, 'sayc').mustBid).toBe(false);
    }
    expect(meaning('1S P 2NT P 4NT P 5C P', 'P')).toContain('保持禁用');
  });

  it('does not demand a second personal enemy-suit stopper after partner has shown one', () => {
    expect(meaning('1C P 1H 1S P P 2S X 2NT P', '3NT')).toContain('可依赖同伴自然无将已公开的敌套止张');
  });

  it.each([
    ['7638 passed responder natural three-level continuation', 'P P P 1H P 1S P 2H P', '3C', '已Pass手牌限制实力，不逼叫'],
    ['7810 later natural suit after negative double', 'P 1C 2S X P 3C P', '3D', '通常10+ HCP、5+张自然套'],
    ['4581 later natural suit after double response is F1', '1H 1S X P 2H X', '3D', '未Pass手牌逼叫一轮'],
    ['1189 transferred five-five continuation is GF', '1NT P 2H P 2S P', '3H', '5+张H及此前转移所示的5+张S'],
    ['4579 transferred second major is GF', '1NT P 2H P 2S P', '3H', '建立进局逼叫'],
    ['NT-overcall transfer second major is GF', '1D 1NT P 2H P 2S P', '3H', '双高花进局逼叫'],
    ['7677 technical-double jump advance is not weak overcall', '1S P P X P 3H P', '4H', '技术性加倍方加叫同伴'],
    ['4082 balancing takeout forced cue answer', '1D P P X P 2D P', '2S', '平衡位技术X通常9+'],
    ['4692 technical doubler accepts partner NT without 18+ promise', 'P P 2H X P 2NT P', '3NT', '不额外承诺18+ HCP或均型'],
    ['7283 strong reverse permits equal four-card suits', '1D P 1S P', '2H', '强4-4-4-1手牌可两套等长'],
    ['4229 competitive responder jump retains invitation range', '1D 1H 1S P 2C P', '3S', '10–12 HCP'],
    ['726 natural two-level response over NT interference', '1NT 2C', '2H', '5+张自己的长套，竞争性不逼叫'],
    ['4227 lowest major return can also be real support', '1H P 1S P 2C P', '2H', '三张或更多支持'],
    ['4478 lowest minor return can also be real support', '1C P 1D P 1H P', '2C', '也可有四张或更多支持'],
    ['4559 strong NT game opposite passed responder covers 20–21', 'P P 1H P 2D P', '3NT', '18–21 HCP'],
  ])('%s', (_label, prefix, token, expected) => {
    expect(meaning(prefix, token)).toContain(expected);
  });

  it('does not classify a nonjump natural overcall as a weak jump', () => {
    expect(meaning('1H P 2H 2S 3H', '3S')).not.toContain('弱跳争叫');
  });

  it('does not invent a universal eight-point threshold for later three-level new suits', () => {
    expect(meaning('P 1C 2S X P 3C P', '3D')).not.toContain('8+');
    expect(SYSTEMS.sayc.rules.join('\n')).toContain('不另设8+普遍门槛');
  });

  it('4549 describes competitive three-card support without claiming an eight-card fit', () => {
    const text = meaning('1C 1D 1H 2D', '2H');
    expect(text).toContain('可仅3张支持');
    expect(text).toContain('仍可能只有七张配合');
    expect(text).not.toContain('四张支持承诺；');
  });

  it('Michaels advancer selection does not turn into a five-card natural overcall', () => {
    const text = meaning('1D 2D X 2S 3D', '4S');
    expect(text).toContain('同伴公开3+张自然套');
    expect(text).not.toContain('同伴公开5+张');
  });

  it('shared conservative lengths and passed-hand force drive the same hover', () => {
    expect(meaning('P P 1D 1H 1S P', '2D')).toContain('四张原低花的竞争性回套例外');
    expect(meaning('P P 1D P 1H P 1S P', '3C')).toContain('已Pass手牌限制实力，不逼叫');
    expect(meaning('1C 1D 1H 2D', '2H')).toContain('可仅3张支持');
  });

  it('forced cue answers and replies to jump invitations do not borrow free strong-rebid promises', () => {
    expect(meaning('P 1H 2D 2H 3H P', '4D')).toContain('空间抬高后的最便宜回套');
    const cueNt = meaning('P P 1H X 1S P 2H P P 2S P', '2NT');
    expect(cueNt).toContain('不额外承诺18+');
    expect(cueNt).not.toContain('强牌无将再叫');
    expect(meaning('1H P P X P 3C P', '3S')).toContain('回应同伴的跳应叫邀请');
    expect(meaning('1H P P X P 3C P', '3S')).not.toContain('通常17+');
    expect(meaning('1D X P 1NT P', '4S')).toContain('选择自己的长高花');
    expect(meaning('1D X P 1NT P', '4S')).not.toContain('通常17+');
  });
});

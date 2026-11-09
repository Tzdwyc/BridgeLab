import { expectReviewedPromise, publicReview } from './v328-reviewed-promise-assertions';
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

describe('v0.3.5 public meanings and Pass availability', () => {
  it.each([
    ['4527 first two-level overcall after enemy response', '1D P 1S', '2C', ["2♣：首次自然争叫", "梅花5+张"]],
    ['7163 first overcall has a natural five-card suit', '1D P 1H', '2C', '梅花5+张'],
    ['7209 balancing overcall', '2H P P', '2S', '平衡位'],
    ['680 natural interference over NT', '1NT', '2D', ["2♦：首次自然争叫", "方块5+张"]],
    ['7170 competitive support is not own second suit', '1C 2H 2S P', '3S', '黑桃3+张'],
    ['7272 natural five-card response over NT interference', '1NT 2D 3H P', '4H', '同伴已示红心5+张'],
    ['7293 genuine second-suit repeat retains four cards', '1D P 1H P 2C P 2S P', '3C', ["梅花4+张", "保留原套长度"]],
    ['540 responder repeated original major publicly shows six', '1H P 1S P 2D P 2S P', '4S', '同伴已示黑桃6+张'],
    ['540 only two supports needed for public six-card major', '1H P 1S P 2D P 2S P', '4S', '黑桃2+张'],
    ['7273 repeated responder major over balanced NT invites with known six-two fit', '1D P 1S P 1NT P', '3S', '10–12支持点'],
    ['7320 Michaels answer describes asked minor', '1S 2S P 2NT P', '3C', 'Michaels询问后的自然低花'],
    ['7320 Michaels minor has five cards', '1S 2S P 2NT P', '3C', '梅花5+张'],
    ['7174 low-minor escape relay completed', '1C 1NT P 2S P 3C P', '3D', '不逼叫'],
    ['1008 strong two-club waiting after lead double', '2C X', '2D', '不承诺方块长度'],
    ['7234 correct second negative after natural clubs', '2C P 2D P 3C P', '4D', ['4+点', '方块5+张', '进局逼叫']],
    ['7213 low-minor second-negative answer names actual suit', '2C P 2D P 3D P 3H P', '4D', ["4♦：二次负应后的最低原套回答", "保留强开叫的点力和已示方块长度"]],
    ['7352 negative double jump uses support points', '1D 2H X P', '3S', '16–18支持点'],
    ['7260 negative double game uses support context', '1D 1S X P', '4H', '高花成局答叫'],
    ['844 four diamonds is a jump over available three', '2H X P', '4D', '9–11点'],
    ['7259 delayed support can be three', '1D P 1H P 1S P 2C P', '2H', '红心3+张'],
    ['7524 major preference does not assert exactly two', '1H P 1S P 2C P', '2H', '最低偏好可仅两张，也可更多'],
    ['7478 restricted NT response permits long minor', '1D P', '1NT', '长低花'],
    ['7777 Jacoby requires thirteen adjusted points', '1H P', '2NT', '13+支持点'],
    ['7368 natural minor raise guarantees five-card support of a three-card opening', '1D P', '2D', '方块5+张'],
    ['7521 Stayman four-card support invitation', '1H 1NT P 2C X 2H P', '3H', '同伴已示红心4+张'],
  ])('%s', (_label, prefix, token, expected) => {
    expectReviewedPromise(prefix, token, expected);
    if (_label === '7234 correct second negative after natural clubs') expectReviewedPromise(prefix, '3D', ['第二次负应叫', '0–3点']);
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
    expect(meaning(prefix, 'P')).not.toContain('仍须完成问叫或逼叫义务');
  });

  it('requires an answer to an artificial inquiry before allowing Pass', () => {
    expectReviewedPromise('1NT P 2D X', 'P', '仍须完成问叫或逼叫义务');
    // The current frozen card explicitly releases the 1NT Stayman denial.
    const { auction, seat } = context('1NT P 2C P 2D P');
    expect(analyzeAuctionSemantics(auction, seat, 'sayc').mustBid).toBe(false);
    expect(meaning('1NT P 2C P 2D P', 'P')).not.toContain('仍须完成问叫或逼叫义务');
  });

  it('does not invent a redouble history in penalty hover', () => {
    expect(meaning('1D P 1H', 'X')).not.toContain('再加倍后');
    expectReviewedPromise('1S X XX P P 2H', 'X', '再加倍后');
  });

  it('shares context-specific natural NT ranges with the hover', () => {
    expect(meaning('1H P 1S P 2C P 2D P', '2NT')).not.toContain('18–19');
    expectReviewedPromise('1D P P', '1NT', '11–14');
    expectReviewedPromise('1D X P 1H P', '2NT', '21–22');
  });

  it('does not reuse artificial club inquiry as a natural long-suit promise', () => {
    const text = meaning('2S 2NT P 3C P 3D P', '4C');
    expect(publicReview('2S 2NT P 3C P 3D P', '4C').partner.hcpRange).toEqual({ min: 15, max: 18 });
    expectReviewedPromise('2S 2NT P 3C P 3D P', '4C', '9+点');
    expectReviewedPromise('2S 2NT P 3C P 3D P', '4C', '梅花6+张');
    expect(text).not.toContain('同伴已示梅花5+张');
  });

  it('does not turn the enemy Michaels call into our game force', () => {
    expect(meaning('1S 2S', '3S')).not.toContain('进局逼叫');
    expect(meaning('1C 2C', '3C')).not.toContain('进局逼叫');
  });

  it('keeps the declared custom card consistent with support and HCP distinctions', () => {
    const card = SYSTEMS.sayc.rules.join('\n');
    expect(card).toContain('确认八张低花配合需五张支持');
    expect(card).toContain('自然第二套重复不自动从四张变成六张');
    expect(card).toContain('第四花色为人工询问');
    expect(SHARED_CONVENTIONS.join('\n')).toContain('2S表示四张黑桃及8–9 HCP邀请');
  });

  it.each([
    ['700 accepted original-major jump invitation', 'P P P 1S P 1NT P 3S P', '4S', '接受同伴16–20点的进局邀请'],
    ['951 NT opener accepts transfer invitation in known major', '1NT P 2D X 2H P 2NT P', '4H', '红心3+张'],
    ['1098 weak-two repeat preserves six', '2S P 3H P', '3S', ["黑桃6+张", "保留原套长度"]],
    ['4118 competition does not turn six points into ten', '1D P 1H X 2H 3C', '3H', ["6+点（此前已示）", "保留原套长度"]],
    ['7519 responder jump over second suit invites', '1D P 1S P 2C P', '3S', '10–12点'],
    ['NT other-major four-card invitation', '1NT P 2C P 2H P', '2S', '黑桃4+张'],
    ['NT overcall other-major four-card invitation', '1D 1NT P 2C P 2H P', '2S', '黑桃4+张'],
    ['NT overcall transfer invitation accepts known major', '1D 1NT P 2H P 2S P 2NT P', '4S', '黑桃3+张'],
    ['NT other-major three hearts is five-four game force', '1NT P 2C P 2S P', '3H', ["黑桃4+张", "红心5+张"]],
    ['4441 strong minor can be four cards', '2C P 2D P', '3D', '方块4+张'],
    ['fourth-suit NT answer has a response role', '1H P 1S P 2C P 2D P', '2NT', ["2NT：第四花色无将回答", "方块止张"]],
  ])('%s', (_label, prefix, token, expected) => {
    expectReviewedPromise(prefix, token, expected);
  });

  it('keeps playable same-trump keycard answers separate from artificial side suits', () => {
    for (const prefix of ['1H P 2NT P 4NT P 5H P', '1D P 1H P 2C P 4NT P 5C P']) {
      const { auction, seat } = context(prefix);
      expect(meaning(prefix, 'P')).not.toContain('仍须完成问叫或逼叫义务');
      expect(analyzeAuctionSemantics(auction, seat, 'sayc').mustBid).toBe(false);
    }
    expectReviewedPromise('1S P 2NT P 4NT P 5C P', 'P', '仍须完成问叫或逼叫义务');
  });

  it('does not demand a second personal enemy-suit stopper after partner has shown one', () => {
    expectReviewedPromise('1C P 1H 1S P P 2S X 2NT P', '3NT', '来自同伴');
    expectReviewedPromise('1C P 1H 1S P P 2S X 2NT P', '3NT', '黑桃止张');
  });

  it.each([
    ['7638 passed responder natural three-level continuation', 'P P P 1H P 1S P 2H P', '3C', '不逼叫'],
    ['7810 later natural suit after negative double', 'P 1C 2S X P 3C P', '3D', ["10+点", "方块5+张"]],
    ['4581 later natural suit after double response is F1', '1H 1S X P 2H X', '3D', '逼叫一轮'],
    ['1189 transferred five-five continuation is GF', '1NT P 2H P 2S P', '3H', ["黑桃5+张", "红心5+张"]],
    ['4579 transferred second major is GF', '1NT P 2H P 2S P', '3H', '进局逼叫'],
    ['NT-overcall transfer second major is GF', '1D 1NT P 2H P 2S P', '3H', '双高花进局逼叫'],
    ['7677 technical-double jump advance is not weak overcall', '1S P P X P 3H P', '4H', ["同伴9–11点", "接受"]],
    ['4082 balancing takeout forced cue answer', '1D P P X P 2D P', '2S', ["被迫回答同伴强扣叫", "9+点"]],
    ['4692 technical doubler accepts partner NT without 18+ promise', 'P P 2H X P 2NT P', '3NT', '14+点'],
    ['7283 strong reverse permits equal four-card suits', '1D P 1S P', '2H', '强4441牌型允许两套等长'],
    ['4229 competitive responder jump retains invitation range', '1D 1H 1S P 2C P', '3S', '10–12点'],
    ['726 natural two-level response over NT interference', '1NT 2C', '2H', ["红心5+张", "不逼叫"]],
    ['4227 lowest major return can also be real support', '1H P 1S P 2C P', '2H', '最低偏好可仅两张，也可更多'],
    ['4478 lowest minor return can also be real support', '1C P 1D P 1H P', '2C', '最低偏好可仅两张，也可更多'],
    ['4559 strong NT game opposite passed responder covers 20–21', 'P P 1H P 2D P', '3NT', '15–21点'],
  ])('%s', (_label, prefix, token, expected) => {
    expectReviewedPromise(prefix, token, expected);
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
    expectReviewedPromise('1C 1D 1H 2D', '2H', '红心3+张');
    expectReviewedPromise('1C 1D 1H 2D', '2H', '同伴已示红心4+张');
    expectReviewedPromise('1C 1D 1H 2D', '2H', '未确认八张配合，不另加短门支持点');
    expect(text).not.toContain('；红心4+张；');
  });

  it('Michaels advancer selection does not turn into a five-card natural overcall', () => {
    const text = meaning('1D 2D X 2S 3D', '4S');
    expectReviewedPromise('1D 2D X 2S 3D', '4S', '同伴已示黑桃1+张');
    expect(text).not.toContain('同伴已示黑桃5+张');
  });

  it('shared conservative lengths and passed-hand force drive the same hover', () => {
    expectReviewedPromise('P P 1D 1H 1S P', '2D', '此前已示3+张');
    expectReviewedPromise('P P 1D 1H 1S P', '2D', '本次进一步显示4+张');
    expectReviewedPromise('P P 1D P 1H P 1S P', '3C', '不逼叫');
    expectReviewedPromise('1C 1D 1H 2D', '2H', '红心3+张');
  });

  it('forced cue answers and replies to jump invitations do not borrow free strong-rebid promises', () => {
    expectReviewedPromise('P 1H 2D 2H 3H P', '4D', '回答');
    // This is an actual forcing cue response. The delayed natural 2S in
    // the former prefix is free and cannot be used as a cue oracle.
    const cueNt = meaning('1H X P 2H P', '2NT');
    expectReviewedPromise('1H X P 2H P', '2NT', '12+点');
    expect(cueNt).not.toContain('0+点');
    expectReviewedPromise('1H X P 2H P', '2NT', '不新增18点或均型承诺');
    expect(cueNt).not.toContain('强牌无将再叫');
    expectReviewedPromise('P P 1H X 1S P 2H P P 2S P', '2NT', '18–20点');
    expectReviewedPromise('1H P P X P 3C P', '3S', '回答自然跳应叫邀请');
    expect(meaning('1H P P X P 3C P', '3S')).not.toContain('通常17+');
    expectReviewedPromise('1D X P 1NT P', '4S', '黑桃6+张');
    expect(meaning('1D X P 1NT P', '4S')).not.toContain('通常17+');
  });

  it.each([
    ['623 natural weak clubs after opener NT', 'P 1D P 1S P 1NT P', '2C', '梅花5+张'],
    ['7767 passed natural weak diamonds after opener NT', 'P P 1C P 1H P 1NT P', '2D', '不逼叫'],
    ['ordinary unpassed natural weak minor', '1H P 1S P 1NT P', '2C', '不逼叫'],
    ['7185 one-level fourth suit remains natural', '1C P 1D P 1H P', '1S', ["黑桃4+张", "自然第四花色", "逼叫一轮"]],
    ['7194 weak-two positive minor supports with three', 'P 2D P 3C P', '4C', '梅花3+张'],
    ['4463 cheap one-level overcall advance can show four', '1C 1D P', '1S', '4+张'],
    ['583 Michaels lowest forced choice may need a singleton', 'P P P 1H 2H 3H', '3S', ["黑桃1+张", "同伴已示黑桃5+张"]],
    ['7265 Stayman spade answer then five-four GF', '1NT P 2C P 2S P', '3H', ["黑桃4+张", "红心5+张"]],
    ['NT overcall Stayman spade answer then five-four GF', '1D 1NT P 2C P 2S P', '3H', ["黑桃4+张", "红心5+张"]],
    ['858 responder game follows competitive three-card support', '1C P 1H 1S 2H P', '4H', '同伴已示红心3+张'],
    ['7411 delayed double natural enemy spade choice', '1D P 1S P 2C P P X P', '2S', '不保证四张'],
    ['7411 three enemy suits force remaining hearts without four', '1D P 1S P 2C P P X P', '2H', '不新增点力'],
    // The frozen card's long-suit discount applies to later new-suit responses;
    // this prefix is an initial two-level overcall with a 10–16 point promise.
    ['long quality overcall can reduce usual strength', '1D P 1S', '2H', ["10–16点", "红心5+张"]],
  ])('%s', (_label, prefix, token, expected) => {
    expectReviewedPromise(prefix, token, expected);
  });

  it('actual Stayman jump still remains unspecified and passed semi-NT is not forced', () => {
    expectReviewedPromise('1NT P 2C P 2S P', '4H', '本体系未约定');
    expectReviewedPromise('P P P 1S P 1NT P', '3S', '自主再叫');
  });
  it('Stayman spade answer uses five-four hearts GF and keeps four-heart invitations in NT', () => {
    expectReviewedPromise('1NT P 2C P 2S P', '3H', '黑桃4+张、红心5+张');
    expectReviewedPromise('1NT P 2C P 2S P', '3H', '进局逼叫');
    const invite = meaning('1NT P 2C P 2S P', '2NT');
    expectReviewedPromise('1NT P 2C P 2S P', '2NT', '8–9点'); expectReviewedPromise('1NT P 2C P 2S P', '2NT', '邀请，不逼叫');
    const { auction, seat } = context('1NT P 2C P 2S P 3H P');
    expect(analyzeAuctionSemantics(auction, seat, 'sayc').mustBid).toBe(true);
  });

  it('strong two-club five-card major does not grow to six after a space-forced game return', () => {
    const text = meaning('P P 2C P 2D P 2H P 4C P', '4H');
    expectReviewedPromise('P P 2C P 2D P 2H P 4C P', '4H', '红心5+张');
    expect(text).not.toContain('红心6+张');
  });

  it('final strength hovers do not overstate negative-double game or takeout continuations', () => {
    expectReviewedPromise('P 1D 2H X P', '3NT', '17–21点');
    expectReviewedPromise('P 1D 2H X P', '3NT', '红心止张由本手自然无将叫品显示');
    // The reviewed card now separates a 16-HCP good-suit overcall from
    // the publicly 17+ free suit rebid after takeout; no hidden point is added.
    expectReviewedPromise('P 1C X P 1D P', '1H', '17+点');
    expect(meaning('P 1C X P 1D P', '1H')).not.toContain('酌减至16点');
    const acceptedJump = meaning('P P 2D X P 3S P', '3NT');
    expectReviewedPromise('P P 2D X P 3S P', '3NT', '接受同伴9–11点的进局邀请');
    expectReviewedPromise('P P 2D X P 3S P', '3NT', '不新增18点或均型承诺');
    expect(acceptedJump).not.toContain('强牌无将再叫：18+');
  });
});

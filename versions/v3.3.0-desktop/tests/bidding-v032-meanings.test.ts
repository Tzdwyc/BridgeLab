import { expectReviewedPromise, publicReview } from './v328-reviewed-promise-assertions';
import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { SYSTEMS } from '../src/ai/systems';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';

// These expected meanings were individually judged from the public prefixes.
// No deal, unseen partner holding, or automatic bidding-quality scorer is used.
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function parse(token: string): Call {
  if (token === 'P') return { kind: 'pass' };
  if (token === 'X') return { kind: 'double' };
  if (token === 'XX') return { kind: 'redouble' };
  return { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
}
function meaning(prefix: string, token: string, dealer: Seat = 'N'): string {
  const tokens = prefix.split(' ').filter(Boolean);
  const offset = seats.indexOf(dealer);
  const auction: AuctionEntry[] = tokens.map((item, index) => ({ seat: seats[(offset + index) % 4], call: parse(item) }));
  return describeCall(auction, seats[(offset + tokens.length) % 4], parse(token), 'sayc');
}

describe('v0.3.2 public-prefix meanings from individually reviewed cases', () => {
  it.each([
    ['board 2630 passed one-over-one', 'P P 1D P', '1H', '不逼叫'],
    ['board 2674 passed two-level response', 'P P P 1H P', '2D', '不逼叫'],
    ['board 2695 passed two-level club', 'P P 1D P', '2C', '不逼叫'],
    ['board 2707 passed response', 'P P 1C P', '1H', '不逼叫'],
    ['passed one-level response after double', 'P P 1C X', '1H', '不逼叫'],
    ['board 7010 fixed second negative', '2C P 2D P 2S P', '3C', '0–3点'],
    ['board 7010 second negative answered', '2C P 2D P 2S P 3C P', '3S', '不逼叫'],
    ['board 7010 natural positive avoids artificial three clubs', '2C P 2D P 2S P', '4C', '梅花5+张'],
    ['board 2680 negative double original-suit answer', '1C 1H X P', '2C', '梅花4+张'],
    ['board 2688 negative double original major', '1H 1S X P', '2H', '红心5+张'],
    ['board 2694 negative double high original suit', '1D 2H X P', '3D', '方块4+张'],
    ['board 2687 competitive opener second suit', '1C P 1D 1H', '1S', '4+张'],
    ['board 2636 unusual advance', '1C 2NT P', '3D', '自然选择'],
    ['board 2718 unusual over NT advance', 'P 1NT 2NT P', '3C', '选择'],
    ['support cuebid answer does not promise six', '1H 1S P 2H X', '2S', ["黑桃5+张", "保留原套长度"]],
    ['support cuebid stays constructive', '1H 1S P 2H P 2S P', '3S', '10+支持点（此前已示）'],
    ['weak two raise is nonforcing', '2S P', '3S', '不表示进局邀请'],
    ['weak jump raise is nonforcing', '1D 2S P', '3S', '不逼叫'],
    ['minimum two-card preference', '1S P 1NT P 2H P', '2S', ["黑桃2+张", "同伴已示黑桃5+张"]],
    ['minimum minor preference', '1D P 1H P 1S P', '2D', '偏好'],
    ['Jacoby shortness', '1S P 2NT P', '3C', '梅花至多1张'],
    ['Jacoby minimum fast arrival', '1S P 2NT P', '4S', '12–14'],
    ['ordinary reverse', '1C P 1S P', '2H', '17–21点'],
    ['strong takeout then suit', '1H X P 1S P', '2C', '17+'],
    ['free advance is not a forced zero-point answer', '1H X 2H', '2S', '自由'],
    ['board 7034 escape after redouble', '1S X XX P P', '2H', '逃叫'],
    ['board 7034 late double after own redouble', '1S X XX P P 2H', 'X', '惩罚'],
    ['board 2661 lead double of transfer after NT overcall', '1D 1NT P 2D', 'X', '首攻'],
    ['board 7124 lead double of transfer', '1NT P 2D', 'X', '首攻'],
    ['board 2604 double of supportive cue', '1H 1S P 2H', 'X', '首攻'],
    ['board 7124 transfer remains artificial after double', '1NT P 2D X', '2H', '接受高花转移'],
    ['board 7124 opener cannot stop on transfer', '1NT P 2D X', 'P', '仍须完成问叫或逼叫义务'],
    ['board 7124 responder cannot leave own transfer', '1NT P 2D X P P', 'P', '仍须完成问叫或逼叫义务'],
    ['board 2736 actual six not three NT', '2NT P', '6NT', '6NT'],
    ['board 2737 Stayman must be answered', '1NT P 2C P', '3NT', ["本体系未约定", "问叫或逼叫仍须按约定处理"]],
    ['unsupported transfer jump is not a natural six-card suit', '1NT P 2H P', '3S', '本体系未约定'],
    ['NT overcall Stayman still needs a defined answer', 'P 1H 1NT P 2C P', '3NT', ["本体系未约定", "问叫或逼叫仍须按约定处理"]],
    ['NT overcall transfer accepts the target', 'P 1H 1NT P 2H P', '2S', '接受高花转移'],
    ['NT overcall six NT remains a slam', 'P 1H 1NT P', '6NT', '6NT'],
    ['ordinary one-round force is answered', '1C P 1H P', '1S', '4+张'],
    ['minor invitation gap', '1D P', '2NT', '11–12'],
    ['minor game response', '1C P', '3NT', '13+']
  ])('%s', (_label, prefix, call, expected) => {
    expectReviewedPromise(prefix, call, expected);
  });

  it.each([
    ['426 strong three-level club jump shift', '1H P 1S P', '3C', '19–21点'],
    ['491 strong three-level diamond jump shift', '1C P 1H P', '3D', '进局逼叫'],
    ['518 opener own long hearts choose game', '1H P 1NT P', '4H', ["4♥：自然回套", "19–21点", "红心6+张"]],
    ['436 responder second natural suit', '1C P 1H P 2C P', '2D', '4+张'],
    ['436 responder second natural suit is forcing', '1C P 1H P 2C P', '2D', '逼叫一轮'],
    ['2631 responder three hearts invites', '1C P 1H P 2C P', '3H', '10–12'],
    ['2631 responder four hearts places game', '1C P 1H P 2C P', '4H', '13+'],
    ['3881 first natural overcall of a weak two', '2D', '2S', '首次自然'],
    ['3936 first natural overcall of a weak two', '2D', '2H', '5+张'],
    ['2730 answer to takeout cuebid is not a strong free rebid', '2D X P 3D P', '3S', ["被迫回答同伴强扣叫", "12+点"]],
    ['3887 natural long-minor game need not be balanced', '1D P 1H P', '3NT', '长低花作自然无将选择'],
    ['2695 passed natural response minimum NT', 'P P 1D P 2C P', '2NT', '12–14点'],
    ['2695 passed natural response strong NT game', 'P P 1D P 2C P', '3NT', '15–21点'],
    ['2721 competitive opener NT keeps public range', '1D X 1H P', '1NT', '12–14点'],
    ['reverse response NT is not direct minor response NT', '1C P 1H P 2D P', '2NT', '逆叫后的最低自然弱无将回答'],
  ])('%s', (_label, prefix, call, expected) => {
    expectReviewedPromise(prefix, call, expected);
    if (_label === '2730 answer to takeout cuebid is not a strong free rebid') expect(meaning(prefix, call)).not.toContain('17+点');
  });

  it.each([
    ['436 a minimum minor repeat preserves its five-card promise', '1C P 1H P 2C P 2D P', '3C', ["梅花5+张", "保留原套长度"]],
    ['494 five-card natural overcall permits three-card support', '1H 2D P', '3D', '方块3+张'],
    ['2600 strong original-suit jump answer to negative double', '1S 2C X P', '3S', '16–20点'],
    ['2600 strong original-suit jump promises six', '1S 2C X P', '3S', '6+张'],
    ['2600 game raise of six-card jump needs two trumps', '1S 2C X P 3S P', '4S', '黑桃2+张'],
    ['2687 competitive opener strong jump remains game forcing', '1C P 1D 1H', '2S', '进局逼叫'],
    ['2687 strong jump allows a four-card original minor', '1C P 1D 1H', '2S', '梅花4+张'],
    ['2687 return to original minor retains its public four-card minimum', '1C P 1D 1H 2S P', '5C', '同伴已示梅花4+张'],
    ['3916 competitive reverse shows strength', '1D X P 1S', '2H', '17–21点'],
    ['2718 natural high-suit response over unusual NT is forcing', '1NT 2NT', '3H', '10+点'],
    ['2718 natural high-suit response has a real five-card suit', '1NT 2NT', '3H', '5+张'],
    ['2730 forced cuebid answer keeps original takeout strength', '2D X P 3D P', '3S', ["12+点", "保留原技术X点力"]],
    ['2730 forced cuebid answer may have three cards', '2D X P 3D P', '3S', '黑桃3+张'],
    ['2623 three-level response has the actual level', '1D 2H', '3C', ["3♣：自然应叫", "梅花5+张"]],
    ['2674 voluntary rebid after passed nonforcing response', 'P P P 1H P 2D P', '2H', '自主再叫'],
    ['passed one-over-one voluntary original-suit rebid', 'P P 1D P 1H P', '2D', '自主再叫'],
    ['unpassed one-over-one still requires an opener answer', '1D P 1H P', '2D', '回答'],
  ])('%s', (_label, prefix, call, expected) => {
    expectReviewedPromise(prefix, call, expected);
  });

  it('distinguishes a minimum minor repeat from a later explicit game support', () => {
    const text = meaning('1C P 1H P 2C P 2D P', '3C');
    expectReviewedPromise('1C P 1H P 2C P 2D P', '3C', '梅花5+张');
    expectReviewedPromise('1C P 1H P 2C P 2D P', '3C', '重复叫不自动增加套长');
    const gameSupport = meaning('1C P 1H P 2C P 2D P 3C P', '5C');
    expectReviewedPromise('1C P 1H P 2C P 2D P 3C P', '5C', '5♣：自然支持');
    expect(gameSupport).not.toContain('最低偏好可仅两张');
    expect(meaning('P P P 1H P 2D P', '2H')).not.toContain('回答');
  });

  it('2687 recognizes the first natural overcall after an enemy response', () => {
    const text = meaning('1C P 1D', '1H');
    expectReviewedPromise('1C P 1D', '1H', '8–16点');
    expectReviewedPromise('1C P 1D', '1H', '红心5+张');
    expect(text).not.toContain('未约定');
  });

  it('2688 describes a real six-card continuation without making all unbalanced hands forced', () => {
    const text = meaning('P 1H P 1NT P', '3H');
    expectReviewedPromise('P 1H P 1NT P', '3H', '16–20点');
    expectReviewedPromise('P 1H P 1NT P', '3H', '红心6+张');
    expect(text).not.toContain('此前没有继续叫牌义务');
  });

  it('2635 uses the public five-card promise of a free strong takeout rebid', () => {
    const text = meaning('P 2H X P 3D P 3S P', '4S');
    expectReviewedPromise('P 2H X P 3D P 3S P', '4S', '同伴已示黑桃5+张');
    expectReviewedPromise('P 2H X P 3D P 3S P', '4S', '黑桃3+张');
    expect(text).not.toContain('未约定固定支持张数');
    expect(meaning('2D X P 3D P 3S P', '4S')).not.toContain('同伴已示黑桃5+张');
  });

  it('shows the actual natural suit minimum in the initial two-over-one response', () => {
    expectReviewedPromise('1S P', '2H', '红心5+张');
    expectReviewedPromise('1H P', '2D', '方块4+张');
    expectReviewedPromise('1H P', '2C', '梅花3+张');
    expectReviewedPromise('1S P', '2H', '进局逼叫');
  });

  it('does not turn a natural six-card responder game into confirmed support', () => {
    expect(meaning('1C P 1H P 2C P', '4H')).not.toContain('已确认至少八张配合');
    expectReviewedPromise('1C P 1H P 2C P', '4H', '红心6+张');
    expect(meaning('1H P 1NT P', '4H')).not.toContain('16–20');
  });

  it('does not reinterpret a fixed artificial bid from any real holding', () => {
    const text = meaning('2C P 2D P 2H P', '3C');
    expectReviewedPromise('2C P 2D P 2H P', '3C', '第二次负应叫');
    expectReviewedPromise('2C P 2D P 2H P', '3C', '不承诺所叫花色长度');
  });

  it('keeps a wrong Stayman answer distinct from a natural game choice', () => {
    expectReviewedPromise('1NT P 2C P', '3NT', '本体系未约定');
  });

  it('does not carry an answered one-round force into a natural rebid', () => {
    for (const [prefix, call] of [['1D 2H X P', '3D'], ['1C P 1H P', '1S'], ['1H 1S P 2H X', '2S']]) {
      expect(meaning(prefix, call)).not.toContain('进局逼叫');
      expect(meaning(prefix, call)).not.toContain('逼叫一轮');
    }
  });

  it('preserves penalty and redouble status in Pass, including opponent contracts', () => {
    expectReviewedPromise('1S X XX P', 'P', '再加倍');
    expectReviewedPromise('1S X XX P P 2H X P', 'P', '加倍定约');
    expectReviewedPromise('1NT X P', 'P', '加倍定约');
  });

  it('does not label minimum preference or five-card overcall answer as new support/length', () => {
    expect(meaning('1S P 1NT P 2H P', '2S')).not.toContain('已确认至少八张配合');
    expect(meaning('1D P 1H P 1S P', '2D')).not.toContain('方块4+张');
    expect(meaning('1H 1S P 2H X', '2S')).not.toContain('黑桃6+张');
  });

  it('uses the approved natural four-card third suit without inventing a first five-card overcall', () => {
    const text = meaning('1D 1S P 2H P 2S P 3H P', '4C');
    expectReviewedPromise('1D 1S P 2H P 2S P 3H P', '4C', '后续第二或第三套');
    expectReviewedPromise('1D 1S P 2H P 2S P 3H P', '4C', '梅花4+张');
    expectReviewedPromise('1D 1S P 2H P 2S P 3H P', '4C', '8–16点');
    expectReviewedPromise('1D 1S P 2H P 2S P 3H P', '4C', '不逼叫');
    expect(text).not.toContain('梅花5+张');
  });

  it('keeps six NT as a slam and the public card consistent with the repaired minor invitation', () => {
    expect(meaning('2NT P', '6NT')).not.toContain('选择3NT');
    const card = SYSTEMS.sayc.rules.join('\n');
    expect(card).toContain('11–12');
    expect(card).toContain('3NT');
    expect(card).toContain('已Pass');
    expect(SYSTEMS.sayc.limitations).toContain('混合体系');
  });

  it('keeps a two-over-one game force explicit in an opener second-suit rebid', () => {
    expectReviewedPromise('1S P 2H P', '3C', '进局逼叫');
    expectReviewedPromise('1S P 2D P', '3D', '进局逼叫');
    expect(meaning('1S P 1NT P', '2C')).not.toContain('进局逼叫');
  });
});

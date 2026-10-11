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
    ['board 7010 fixed second negative', '2C P 2D P 2S P', '3C', '0–3 HCP'],
    ['board 7010 second negative answered', '2C P 2D P 2S P 3C P', '3S', '允许同伴Pass'],
    ['board 7010 natural positive avoids artificial three clubs', '2C P 2D P 2S P', '4C', '5+张自己的套'],
    ['board 2680 negative double original-suit answer', '1C 1H X P', '2C', '不额外保证六张'],
    ['board 2688 negative double original major', '1H 1S X P', '2H', '不额外保证六张'],
    ['board 2694 negative double high original suit', '1D 2H X P', '3D', '不额外保证六张'],
    ['board 2687 competitive opener second suit', '1C P 1D 1H', '1S', '4+张'],
    ['board 2636 unusual advance', '1C 2NT P', '3D', '作出选择'],
    ['board 2718 unusual over NT advance', 'P 1NT 2NT P', '3C', '选择'],
    ['support cuebid answer does not promise six', '1H 1S P 2H X', '2S', '不额外保证六张'],
    ['support cuebid stays constructive', '1H 1S P 2H P 2S P', '3S', '10+'],
    ['weak two raise is nonforcing', '2S P', '3S', '不是'],
    ['weak jump raise is nonforcing', '1D 2S P', '3S', '不逼叫'],
    ['minimum two-card preference', '1S P 1NT P 2H P', '2S', '5-2'],
    ['minimum minor preference', '1D P 1H P 1S P', '2D', '偏好'],
    ['Jacoby shortness', '1S P 2NT P', '3C', '单张或缺门'],
    ['Jacoby minimum fast arrival', '1S P 2NT P', '4S', '最低限'],
    ['ordinary reverse', '1C P 1S P', '2H', '17+'],
    ['strong takeout then suit', '1H X P 1S P', '2C', '17+'],
    ['free advance is not a forced zero-point answer', '1H X 2H', '2S', '自由'],
    ['board 7034 escape after redouble', '1S X XX P P', '2H', '逃叫'],
    ['board 7034 late double after own redouble', '1S X XX P P 2H', 'X', '惩罚'],
    ['board 2661 lead double of transfer after NT overcall', '1D 1NT P 2D', 'X', '首攻'],
    ['board 7124 lead double of transfer', '1NT P 2D', 'X', '首攻'],
    ['board 2604 double of supportive cue', '1H 1S P 2H', 'X', '首攻'],
    ['board 7124 transfer remains artificial after double', '1NT P 2D X', '2H', '转移接受'],
    ['board 7124 opener cannot stop on transfer', '1NT P 2D X', 'P', '不叫不符合'],
    ['board 7124 responder cannot leave own transfer', '1NT P 2D X P P', 'P', '不叫不符合'],
    ['board 2736 actual six not three NT', '2NT P', '6NT', '6NT'],
    ['board 2737 Stayman must be answered', '1NT P 2C P', '3NT', 'Stayman'],
    ['unsupported transfer jump is not a natural six-card suit', '1NT P 2H P', '3S', '未约定超接受'],
    ['NT overcall Stayman still needs a defined answer', 'P 1H 1NT P 2C P', '3NT', '非约定Stayman答叫'],
    ['NT overcall transfer accepts the target', 'P 1H 1NT P 2H P', '2S', '转移接受'],
    ['NT overcall six NT remains a slam', 'P 1H 1NT P', '6NT', '6NT'],
    ['ordinary one-round force is answered', '1C P 1H P', '1S', '4+张'],
    ['minor invitation gap', '1D P', '2NT', '11–12'],
    ['minor game response', '1C P', '3NT', '13+']
  ])('%s', (_label, prefix, call, expected) => {
    expect(meaning(prefix, call)).toContain(expected);
  });

  it.each([
    ['426 strong three-level club jump shift', '1H P 1S P', '3C', '19+ HCP'],
    ['491 strong three-level diamond jump shift', '1C P 1H P', '3D', '建立进局逼叫'],
    ['518 opener four hearts is game', '1H P 1NT P', '4H', '直接成局'],
    ['436 responder second natural suit', '1C P 1H P 2C P', '2D', '4+张'],
    ['436 responder second natural suit is forcing', '1C P 1H P 2C P', '2D', '逼叫一轮'],
    ['2631 responder three hearts invites', '1C P 1H P 2C P', '3H', '10–12'],
    ['2631 responder four hearts places game', '1C P 1H P 2C P', '4H', '13+'],
    ['3881 first natural overcall of a weak two', '2D', '2S', '首次自然'],
    ['3936 first natural overcall of a weak two', '2D', '2H', '5+张'],
    ['2730 answer to takeout cuebid is not a strong free rebid', '2D X P 3D P', '3S', '不额外表示17+'],
    ['3887 natural long-minor game need not be balanced', '1D P 1H P', '3NT', '实牌定约'],
    ['2695 passed natural response minimum NT', 'P P 1D P 2C P', '2NT', '12–14 HCP'],
    ['2695 passed natural response strong NT game', 'P P 1D P 2C P', '3NT', '18–21 HCP'],
    ['2721 competitive opener NT keeps public range', '1D X 1H P', '1NT', '12–14 HCP'],
    ['reverse response NT is not direct minor response NT', '1C P 1H P 2D P', '2NT', '逆叫后的自然'],
  ])('%s', (_label, prefix, call, expected) => {
    expect(meaning(prefix, call)).toContain(expected);
  });

  it.each([
    ['436 minimum repeated clubs remains a preference', '1C P 1H P 2C P 2D P 3C P', '5C', '可仅两三张'],
    ['494 five-card natural overcall permits three-card support', '1H 2D P', '3D', '3+张支持'],
    ['2600 strong original-suit jump answer to negative double', '1S 2C X P', '3S', '16–20 HCP'],
    ['2600 strong original-suit jump promises six', '1S 2C X P', '3S', '6+张'],
    ['2600 game raise of six-card jump needs two trumps', '1S 2C X P 3S P', '4S', '2+张支持'],
    ['2687 competitive opener strong jump remains game forcing', '1C P 1D 1H', '2S', '建立进局逼叫'],
    ['2687 strong jump allows a four-card original minor', '1C P 1D 1H', '2S', '原低花4+张'],
    ['2687 return to original minor retains its public four-card minimum', '1C P 1D 1H 2S P', '5C', '同伴公开4+张'],
    ['3916 competitive reverse shows strength', '1D X P 1S', '2H', '17+ HCP'],
    ['2718 natural high-suit response over unusual NT is forcing', '1NT 2NT', '3H', '10+ HCP'],
    ['2718 natural high-suit response has a real five-card suit', '1NT 2NT', '3H', '5+张'],
    ['2730 forced cuebid answer keeps original takeout strength', '2D X P 3D P', '3S', '13+ HCP'],
    ['2730 forced cuebid answer may have three cards', '2D X P 3D P', '3S', '可仅三张'],
    ['2623 three-level response has the actual level', '1D 2H', '3C', '自然3阶'],
    ['2674 voluntary rebid after passed nonforcing response', 'P P P 1H P 2D P', '2H', '此前没有继续叫牌义务'],
    ['passed one-over-one voluntary original-suit rebid', 'P P 1D P 1H P', '2D', '此前没有继续叫牌义务'],
    ['unpassed one-over-one still requires an opener answer', '1D P 1H P', '2D', '履行本轮应叫义务'],
  ])('%s', (_label, prefix, call, expected) => {
    expect(meaning(prefix, call)).toContain(expected);
  });

  it('does not turn minimum repeated minor preference into a guaranteed eight-card fit', () => {
    const text = meaning('1C P 1H P 2C P 2D P 3C P', '5C');
    expect(text).not.toContain('通常4+张支持');
    expect(text).toContain('不自动确认八张配合');
    expect(meaning('P P P 1H P 2D P', '2H')).not.toContain('履行本轮应叫义务');
  });

  it('2687 recognizes the first natural overcall after an enemy response', () => {
    const text = meaning('1C P 1D', '1H');
    expect(text).toContain('8–16 HCP');
    expect(text).toContain('5+张H');
    expect(text).not.toContain('未约定');
  });

  it('2688 keeps the nonbalanced obligation after a semi-forcing NT response', () => {
    const text = meaning('P 1H P 1NT P', '3H');
    expect(text).toContain('16–20 HCP');
    expect(text).toContain('非均型开叫人有继续描述的义务');
    expect(text).not.toContain('此前没有继续叫牌义务');
  });

  it('2635 uses the public five-card promise of a free strong takeout rebid', () => {
    const text = meaning('P 2H X P 3D P 3S P', '4S');
    expect(text).toContain('同伴公开5+张');
    expect(text).toContain('3+张支持');
    expect(text).not.toContain('未约定固定支持张数');
    expect(meaning('2D X P 3D P 3S P', '4S')).not.toContain('同伴公开5+张');
  });

  it('shows the actual natural suit minimum in the initial two-over-one response', () => {
    expect(meaning('1S P', '2H')).toContain('5+张H');
    expect(meaning('1H P', '2D')).toContain('4+张D');
    expect(meaning('1H P', '2C')).toContain('3+张C');
    expect(meaning('1S P', '2H')).toContain('建立进局逼叫');
  });

  it('does not turn a natural six-card responder game into confirmed support', () => {
    expect(meaning('1C P 1H P 2C P', '4H')).not.toContain('构成至少8张配合');
    expect(meaning('1C P 1H P 2C P', '4H')).toContain('自己的长套');
    expect(meaning('1H P 1NT P', '4H')).not.toContain('16–20');
  });

  it('does not reinterpret a fixed artificial bid from any real holding', () => {
    const text = meaning('2C P 2D P 2H P', '3C');
    expect(text).toContain('第二次负应叫');
    expect(text).toContain('不承诺梅花套');
  });

  it('keeps a wrong Stayman answer distinct from a natural game choice', () => {
    expect(meaning('1NT P 2C P', '3NT')).toContain('非约定Stayman答叫');
  });

  it('does not carry an answered one-round force into a natural rebid', () => {
    for (const [prefix, call] of [['1D 2H X P', '3D'], ['1C P 1H P', '1S'], ['1H 1S P 2H X', '2S']]) {
      expect(meaning(prefix, call)).not.toContain('原有逼叫仍继续');
      expect(meaning(prefix, call)).not.toContain('原有逼叫仍未解除');
    }
  });

  it('preserves penalty and redouble status in Pass, including opponent contracts', () => {
    expect(meaning('1S X XX P', 'P')).toContain('再加倍');
    expect(meaning('1S X XX P P 2H X P', 'P')).toContain('被加倍');
    expect(meaning('1NT X P', 'P')).toContain('被加倍');
  });

  it('does not label minimum preference or five-card overcall answer as new support/length', () => {
    expect(meaning('1S P 1NT P 2H P', '2S')).not.toContain('至少8张');
    expect(meaning('1D P 1H P 1S P', '2D')).not.toContain('4+张支持');
    expect(meaning('1H 1S P 2H X', '2S')).not.toContain('通常6+张');
  });

  it('does not invent a five-card promise for an undefined late competitive new suit', () => {
    const text = meaning('1D 1S P 2H P 2S P 3H P', '4C');
    expect(text).toContain('未约定');
    expect(text).not.toContain('通常5+张');
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
    expect(meaning('1S P 2H P', '3C')).toContain('原有进局逼叫仍继续');
    expect(meaning('1S P 2D P', '3D')).toContain('原有进局逼叫仍继续');
    expect(meaning('1S P 1NT P', '2C')).not.toContain('原有进局逼叫仍继续');
  });
});

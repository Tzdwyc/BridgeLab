import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
const parse = (token: string): Call => token === 'P' ? { kind: 'pass' }
  : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain };
function explain(prefix: string, next: string) {
  const tokens = prefix.split(' ').filter(Boolean);
  const auction: AuctionEntry[] = tokens.map((token, index) => ({ seat: seats[index % 4], call: parse(token) }));
  return describeCall(auction, seats[tokens.length % 4], parse(next), 'sayc');
}

describe('v033 release6 prefix-specific hover explanations', () => {
  it.each([
    ['', ['20–21', '均型'], ['Jacoby', 'Unusual']],
    ['1D P', ['11–12', '邀请'], ['RKCB', '双套']],
    ['1H P', ['Jacoby', '4+', '进局逼叫'], ['均型']],
    ['1H 2H P', ['Michaels', '询问', '不承诺自然无将点力、均型'], ['定量邀请']],
    ['1S', ['Unusual', '5+'], ['均型', '自然2NT邀请']],
    ['1H X P 2H P', ['被迫', '止张', '不自动显示18–20或21–22'], ['强牌无将再叫：21–22']],
    ['1H X P 1S P', ['21–22', '均型', '止张'], ['Jacoby', 'Michaels']],
  ])('2NT retains the role defined by the complete prefix %s', (prefix, required, excluded) => {
    const text = explain(prefix as string, '2NT');
    for (const phrase of required as string[]) expect(text).toContain(phrase);
    for (const phrase of excluded as string[]) expect(text).not.toContain(phrase);
  });
  it('Michaels question publishes artificial request metadata rather than treating a negated balanced word as a promise', () => {
    const tokens = '1H 2H P 2NT'.split(' ');
    const a = tokens.map((token, index) => ({ seat: seats[index % 4], call: parse(token) }));
    expect(publicCallMeaningAt(a, 3)).toMatchObject({ role: 'michaels-inquiry', artificial: true,
      hcpRange: { min: 0 }, suitMinimums: {}, stopperSources: [], forcing: 'one-round' });
    expect(publicCallMeaningAt(a, 3).strictBalancedShapeFamily).toBeUndefined();
    expect(publicCallMeaningAt(a, 3).allowedShapeFamily).toBeUndefined();
  });
  it('names the opener side after enemy takeout rather than the doubler side', () => {
    const text = explain('1C X', '1D');
    expect(text).toContain('本方一阶开叫遭敌方');
    expect(text).toContain('4+张D');
    expect(text).toContain('逼叫一轮');
  });
  it('negative double over both majors asks for the two unbid minors', () => {
    const text = explain('1H 1S', 'X');
    expect(text).toContain('C、D各4+张');
    expect(text).not.toContain('通常表示未叫高花');
  });
  it('a negative double with one unbid major does not promise the remaining minor', () => {
    const text = explain('1C 1S', 'X');
    expect(text).toContain('H4+张');
    expect(text).toContain('不额外保证未叫低花四张');
    expect(text).not.toContain('D、H各4+张');
  });
  it('preserves a support cue on returning to the original overcall suit', () => {
    const text = explain('1D 1S P 2D P 2H P', '3S');
    expect(text).toMatch(/3\+|三张以上/);
    expect(text).not.toContain('最低偏好可为两张');
  });
  it('does not use Michaels inquiry 2NT as a quantitative NT platform', () => {
    const text = explain('1H 2H P 2NT P 3C P 4C P', '4NT');
    expect(text).not.toContain('定量4NT');
    expect(text).toContain('RKCB');
  });
  it('a voluntary four-card heart invitation after Stayman spade answer stays in NT', () => {
    const text = explain('1NT P 2C P 2S P', '3H');
    expect(text).toMatch(/5\+张|五张|五红心/);
    expect(text).toContain('进局逼叫');
    expect(text).not.toContain('8–9');
  });
  it('a cheap original major preference is not an invitation or a four-card promise', () => {
    const text = explain('1H P 1S P 2C P', '2H');
    expect(text).toContain('两张');
    expect(text).not.toContain('4+张支持');
    expect(text).toContain('偏好');
  });
});

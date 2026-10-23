import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { naturalSuitMinimum, publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
const parse = (token: string): Call => token === 'P' ? { kind: 'pass' }
  : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain };
function inspect(prefix: string, next: string) {
  const tokens = prefix.split(' ').filter(Boolean);
  const history: AuctionEntry[] = tokens.map((token, index) => ({ seat: seats[index % 4], call: parse(token) }));
  const seat = seats[tokens.length % 4], call = parse(next);
  const complete = [...history, { seat, call }];
  return { text: describeCall(history, seat, call, 'sayc'),
    meaning: publicCallMeaningAt(complete, history.length, 'sayc'), history, complete, seat };
}

describe('release7 explanations distinguish identical calls by contemporaneous context', () => {
  it('3H is a genuine quiet jump invitation but not an invitation when Michaels has occupied 2H', () => {
    const quiet = inspect('1H P', '3H');
    const competitive = inspect('1H 2H', '3H');
    expect(quiet.meaning.invitation).toBe(true);
    expect(quiet.text).toContain('10–12');
    expect(competitive.meaning.invitation).not.toBe(true);
    expect(competitive.meaning.forcing).toBe('none');
    expect(competitive.text).not.toContain('10–12');
    expect(quiet.text).not.toBe(competitive.text);
  });
  it('first quiet 2S repeat newly promises six; the same minimum competitive 2S still only promises five', () => {
    const quiet = inspect('1S P 1NT P', '2S');
    const competitive = inspect('1S P 1NT 2H', '2S');
    expect(naturalSuitMinimum(quiet.history, 'N', 'S', 'sayc')).toBe(5);
    expect(quiet.meaning.suitMinimum).toBe(6);
    expect(quiet.text).toMatch(/本次.*6/);
    expect(quiet.text).not.toContain('此前公开6');
    expect(competitive.meaning.suitMinimum).toBe(5);
    expect(competitive.text).not.toContain('本次进一步显示6');
  });
  it('2NT after an other-major Stayman invitation declines; the original responder 2NT invites', () => {
    const invited = inspect('1NT P', '2NT');
    const declined = inspect('1NT P 2C P 2H P 2S P', '2NT');
    expect(invited.meaning.invitation).toBe(true);
    expect(invited.text).toContain('8–9');
    expect(declined.meaning.invitation).not.toBe(true);
    expect(declined.text).toMatch(/拒|低限/);
    expect(declined.text).not.toContain('用途为邀请或额外实力');
  });
  it('4S by the NT opener after transfer/3NT supports the responder, without inventing previous three cards', () => {
    const result = inspect('1NT P 2H P 2S P 3NT P', '4S');
    expect(naturalSuitMinimum(result.history, 'N', 'S', 'sayc')).toBe(2);
    expect(result.meaning.suitMinimum).toBe(3);
    expect(result.text).toMatch(/支持|配合/);
    expect(result.text).not.toContain('；自己的长套直接成局');
    expect(result.text).not.toContain('此前公开3');
  });
  it('weak-two feature denial is not a generic free repeat, and forced support does not promise four', () => {
    const denial = inspect('2D P 2NT P', '3D');
    expect(denial.text).toMatch(/低限|特征/);
    const support = inspect('2D P 2S P', '3S');
    expect(support.meaning.suitMinimum).toBe(3);
    expect(support.text).not.toMatch(/本手公开4|本手.*四张/);
  });
  it('same 2D is Michaels over an enemy opening and GF response to our major opening', () => {
    const michaels = inspect('1D', '2D');
    const twoOverOne = inspect('1S P', '2D');
    expect(michaels.meaning.artificial).toBe(true);
    expect(michaels.text).toContain('Michaels');
    expect(twoOverOne.meaning.artificial).toBe(false);
    expect(twoOverOne.meaning.forcing).toBe('game');
    expect(twoOverOne.text).toContain('进局逼叫');
  });
  it('a control trial below game retains the agreed major and is not a new natural club suit', () => {
    const trial = inspect('1H P 3H P', '4C');
    expect(trial.meaning.role).toBe('control-cue');
    expect(trial.meaning.forcing).toBe('game');
    expect(trial.meaning.artificial).toBe(true);
    expect(trial.text).toContain('控制');
    expect(trial.text).toContain('H');
    expect(trial.text).not.toMatch(/4\+张C|5\+张C/);
  });
  it('six agreed trumps after RKCB are described as a small slam rather than ordinary game', () => {
    const signed = inspect('1S P 2H P 3H P 4NT P 5H P', '6H');
    expect(signed.text).toContain('小满贯');
    expect(signed.text).not.toContain('自然6H成局');
  });
});

import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';

const seats: Seat[] = ['N', 'E', 'S', 'W'];
function explain(prefix: string, token: string) {
  const parse = (value: string): Call => value === 'P' ? { kind: 'pass' }
    : value === 'X' ? { kind: 'double' } : value === 'XX' ? { kind: 'redouble' }
      : { kind: 'bid', level: Number(value[0]), strain: value.slice(1) as Strain };
  const tokens = prefix.split(' ').filter(Boolean);
  const auction: AuctionEntry[] = tokens.map((value, index) => ({ seat: seats[index % 4], call: parse(value) }));
  return describeCall(auction, seats[tokens.length % 4], parse(token), 'sayc');
}

describe('v0.3.5 release5 actual hover roles', () => {
  it('distinguishes a passed-hand 1NT from the unpassed semi-forcing response', () => {
    expect(explain('P P 1S P', '1NT')).toContain('不逼叫');
    expect(explain('1S P', '1NT')).toContain('半逼叫');
  });
  it('does not promise three clubs in the four-card second-suit configuration', () => {
    const text = explain('1S P 1NT P', '2C');
    expect(text).toContain('4+张');
    expect(text).not.toContain('可能只有3张');
    expect(text).not.toContain('逆叫2♠');
  });
  it('keeps five hearts a signoff after a 0/3 RKCB reply with hearts agreed', () => {
    const text = explain('1H P 2NT P 3C P 4H P 4NT P 5D P', '5H');
    expect(text).toContain('止叫');
    expect(text).not.toContain('Q询问');
  });
  it('a specific king answer does not accept a grand slam', () => {
    const text = explain('1H P 2NT P 3C P 4H P 4NT P 5S P 5NT P', '6C');
    expect(text).toContain('CK');
    expect(text).toContain('不保证十三墩');
  });
  it('a completed doubled auction is described as ended', () => {
    expect(explain('1C X P P', 'P')).toContain('叫牌结束');
  });
});

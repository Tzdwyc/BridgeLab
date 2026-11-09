import { expect, it } from 'vitest';
import { SEATS, type AuctionEntry, type Call, type Strain } from '../src/core/types';
import { noTrumpRangeAt, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { presentCall } from '../src/ai/bidding-presentation';

const parse = (token: string): Call => token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' }
  : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain };
const auction = (prefix: string): AuctionEntry[] => prefix.split(' ').map((token, i) => ({ seat: SEATS[i % 4], call: parse(token) }));

it.each(['sayc', 'two-over-one', 'precision'] as const)('%s weak NT escapes do not become numeric game invitations', system => {
  const platform = system === 'precision' ? { min: 13, max: 15 } : { min: 15, max: 17 };
  for (const prefix of ['P 1NT 2S 3D P 3NT', '1NT 2C 2H P 3NT', '1NT 2H 3C P 3NT']) {
    const a = auction(prefix), index = a.length - 1;
    const replyIndex = a.findIndex((e, i) => i > 0 && e.call.kind === 'bid' && e.call.strain !== 'NT' && e.seat === SEATS[(SEATS.indexOf(a[index].seat) + 2) % 4]);
    const reply = publicCallMeaningAt(a, replyIndex, system);
    expect(['nt-competitive-minor-escape', 'nt-competitive-weak-response']).toContain(reply.role);
    expect(reply.hcpRange?.min).toBe(5);
    expect(noTrumpRangeAt(a, index, system)).toEqual(platform);
    const m = publicCallMeaningAt(a, index, system);
    expect(m).toMatchObject({ defined: true, role: 'natural-nt', hcpRange: platform, forcing: 'none' });
    expect(m.hcpRange!.min).toBeLessThanOrEqual(m.hcpRange!.max);
    expect(presentCall(a.slice(0, -1), a[index].seat, a[index].call, system)).toContain(`${platform.min}~${platform.max}个大牌点`);
    expect(publicPlayerConstraints(a, a[index].seat, system).hcpRange).toEqual(platform);
    const future = [...a, { seat: SEATS[(index + 1) % 4], call: parse('P') }];
    expect(noTrumpRangeAt(future, index, system)).toEqual(platform);
  }
});

it.each(['sayc', 'two-over-one'] as const)('%s ordinary quantitative invitations retain their existing acceptance threshold', system => {
  const a = auction('1NT P 2NT P 3NT');
  expect(noTrumpRangeAt(a, 4, system)).toEqual({ min: 17, max: 17 });
  expect(publicCallMeaningAt(a, 4, system).intent).toBe('signoff');
});

import { describe, expect, it } from 'vitest';
import { biddingNotices, isJumpBid } from '../src/ai/bidding-notices';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (calls: Call[]): AuctionEntry[] => calls.map((call, index) => ({ seat: seats[index % 4], call }));
const labels = (calls: Call[], call: Call) => biddingNotices(auction(calls), seats[calls.length % 4], call, 'sayc').map(notice => notice.label);

describe('STOP cards', () => {
  it('never shows STOP on an opening call at any level', () => {
    expect(isJumpBid([], bid(1, 'S'))).toBe(false);
    expect(isJumpBid([], bid(2, 'H'))).toBe(false);
    expect(isJumpBid([], bid(4, 'S'))).toBe(false);
  });

  it('shows STOP for actual jump bids after the opening', () => {
    expect(isJumpBid(auction([bid(1, 'D')]), bid(1, 'S'))).toBe(false);
    expect(isJumpBid(auction([bid(1, 'D')]), bid(2, 'S'))).toBe(true);
    expect(isJumpBid(auction([bid(1, 'S')]), bid(2, 'C'))).toBe(false);
    expect(isJumpBid(auction([bid(1, 'S')]), bid(3, 'C'))).toBe(true);
  });

  it('preserves the jump calculation across passes and higher contracts', () => {
    expect(labels([bid(1, 'D'), { kind: 'pass' }, { kind: 'pass' }], bid(2, 'S'))).toEqual(['STOP']);
    expect(labels([bid(2, 'H')], bid(2, 'S'))).toEqual([]);
    expect(labels([bid(2, 'H')], bid(3, 'S'))).toEqual(['STOP']);
  });

  it('returns only STOP notices and never automatically generates ALERT', () => {
    expect(labels([], bid(1, 'H'))).toEqual([]);
    expect(labels([], bid(2, 'C'))).toEqual([]);
    expect(labels([bid(1, 'NT'), { kind: 'pass' }], bid(2, 'C'))).toEqual([]);
    expect(labels([bid(1, 'D')], bid(2, 'S'))).toEqual(['STOP']);
  });
});

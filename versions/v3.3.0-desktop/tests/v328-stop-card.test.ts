import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { biddingNotices, isJumpBid } from '../src/ai/bidding-notices';
import { CallNoticeCards } from '../src/ui/CallNoticeCards';
import { parseAuction } from './fixtures/android-stack-incident';

describe.each(['sayc', 'two-over-one', 'precision'] as const)('v328 %s static STOP card', system => {
  it.each([
    ['1C P 1H P 2C P', '3H', true],
    ['1S P', '3C', true],
    ['1H 2H X', '2S', false],
    ['1H 2S P 2NT P', '3C', false],
    ['1C P 1H P 2C P 2D P', '3C', false],
    ['1S 2H 2S', '3H', false],
    ['', '4NT', false],
  ])('%s → %s marks only an actual skipped level', (prefix, token, jumped) => {
    const auction = parseAuction(prefix), call = parseAuction(token)[0].call;
    expect(isJumpBid(auction, call)).toBe(jumped);
    const notices = biddingNotices(auction, 'S', call, system);
    expect(notices.map(notice => notice.kind)).toEqual(jumped ? ['stop'] : []);
    const html = renderToStaticMarkup(createElement(CallNoticeCards, { notices, compact: true }));
    expect(html.includes('data-bidding-notice="stop"')).toBe(jumped);
    expect(html.includes('STOP')).toBe(jumped);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('ALERT');
  });
  it('keeps mechanical STOP independent of later calls and hidden holding', () => {
    const auction = parseAuction('1S P 3C P');
    const happened = auction[2];
    expect(biddingNotices(auction.slice(0, 2), happened.seat, happened.call, system)).toEqual(
      biddingNotices(parseAuction('1S P'), happened.seat, happened.call, system),
    );
  });
});

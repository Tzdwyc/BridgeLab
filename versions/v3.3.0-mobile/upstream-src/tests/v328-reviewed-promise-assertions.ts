import { expect } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { SEATS, partnerOf, type AuctionEntry, type Call, type Seat, type Strain, type Suit } from '../src/core/types';

const suitNames: Record<string, Suit> = { 黑桃: 'S', 红心: 'H', 方块: 'D', 梅花: 'C' };
const parse = (token: string): Call => token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' }
  : token === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain };
export function publicReview(prefix: string, token: string, dealer: Seat = 'N') {
  const offset = SEATS.indexOf(dealer), tokens = prefix.split(' ').filter(Boolean);
  const auction: AuctionEntry[] = tokens.map((t, i) => ({ seat: SEATS[(offset + i) % 4], call: parse(t) }));
  const seat = SEATS[(offset + tokens.length) % 4], call = parse(token);
  return { auction, seat, call, meaning: publicCallMeaningAt([...auction, { seat, call }], auction.length, 'sayc'),
    prior: publicPlayerConstraints(auction, seat, 'sayc'), partner: publicPlayerConstraints(auction, partnerOf(seat), 'sayc'),
    before: analyzeAuctionSemantics(auction, seat, 'sayc'), text: describeCall(auction, seat, call, 'sayc') };
}

/** Preserve the individually reviewed legacy promise, independent of the old
 * word order, dash glyph or repeated explanation. Unrecognized prose still
 * requires a literal display assertion: no reviewed condition is discarded.
 */
export function expectReviewedPromise(prefix: string, token: string, expected: string | string[], dealer: Seat = 'N') {
  const r = publicReview(prefix, token, dealer), m = r.meaning;
  for (const fragment of [expected].flat()) {
    const numericLengths = [...fragment.matchAll(/(黑桃|红心|方块|梅花)(\d+)\+张/g)];
    if (numericLengths.length) {
      for (const match of numericLengths) {
        const suit = suitNames[match[1]], expectedMinimum = +match[2];
        const actual = fragment.startsWith('同伴已示') ? r.partner.suitMinimums[suit]
          : fragment.startsWith('原套') ? r.prior.suitMinimums[suit] : m.suitMinimums[suit];
        expect(actual, fragment).toBe(expectedMinimum);
      }
      continue;
    }
    const shortness = fragment.match(/(黑桃|红心|方块|梅花)至多(\d+)张/);
    if (shortness) { expect(m.suitMaximums?.[suitNames[shortness[1]]]).toBe(+shortness[2]); continue; }
    const genericLength = fragment.match(/^(\d+)\+张$/);
    if (genericLength && r.call.kind === 'bid' && r.call.strain !== 'NT') {
      expect(m.suitMinimums[r.call.strain]).toBe(+genericLength[1]); continue;
    }
    const range = fragment.match(/^(\d+)–(\d+)(支持点|点)?$/);
    if (range) { const value = range[3] === '支持点' ? m.supportRange : m.hcpRange; expect(value).toMatchObject({ min: +range[1], max: +range[2] }); continue; }
    const minimum = fragment.match(/^(\d+)\+(支持点|点)?$/);
    if (minimum) { const value = minimum[2] === '支持点' ? m.supportRange : m.hcpRange; expect(value?.min).toBe(+minimum[1]); continue; }
    const priorPoints = fragment.match(/^(\d+)\+(支持点|点)（此前已示）$/);
    if (priorPoints) {
      const value = priorPoints[2] === '支持点' && r.call.kind === 'bid' && r.call.strain !== 'NT' ? r.prior.supportRanges[r.call.strain] : r.prior.hcpRange;
      expect(value?.min).toBe(+priorPoints[1]); continue;
    }
    const priorRange = fragment.match(/^(\d+)–(\d+)支持点（此前已示）$/);
    if (priorRange) { if (r.call.kind !== 'bid' || r.call.strain === 'NT') throw Error('Expected a support suit'); expect(r.prior.supportRanges[r.call.strain]).toEqual({ min: +priorRange[1], max: +priorRange[2] }); continue; }
    const partnerInvitation = fragment.match(/^(?:接受)?同伴(\d+)–(\d+)点(?:的进局邀请)?$/);
    if (partnerInvitation) {
      expect(r.partner.hcpRange).toMatchObject({ min: +partnerInvitation[1], max: +partnerInvitation[2] });
      expect(r.text).toContain('接受'); expect(m.invitation).toBe(false); continue;
    }
    if (fragment === '进局逼叫' || fragment === '双高花进局逼叫') { expect(m.forcing).toBe('game'); expect(r.text).toContain('逼叫进局'); continue; }
    if (fragment === '不逼叫') { expect(m.forcing).toBe('none'); expect(r.text).toMatch(/不逼叫|成局止叫|满贯止叫|可止叫/); continue; }
    if (fragment === '保留原套长度' || fragment === '重复叫不自动增加套长') {
      if (r.call.kind !== 'bid' || r.call.strain === 'NT') throw Error('Expected a natural suit repeat');
      expect(m.suitMinimums[r.call.strain]).toBe(r.prior.suitMinimums[r.call.strain]); continue;
    }
    if (fragment === '不表示进局邀请') { expect(m.invitation).toBe(false); expect(r.text).toContain('非邀请'); continue; }
    if (fragment === '偏好') { expect(m.role).toBe('natural-preference'); continue; }
    if (fragment === '最低偏好可仅两张，也可更多') { expect(m.suitMinimum).toBe(2); if (r.call.kind === 'bid' && r.call.strain !== 'NT') expect(m.suitMaximums?.[r.call.strain]).toBeUndefined(); expect(r.text).toContain('可仅两张'); continue; }
    if (fragment === '首次自然' || /：首次自然争叫$/.test(fragment)) { expect(m.role).toBe('natural-overcall'); expect(r.text).toContain('自然争叫'); continue; }
    if (/：自然回套$/.test(fragment)) { expect(m.role).toBe('natural-repeat'); continue; }
    if (/：自然支持$/.test(fragment)) { expect(m.role).toBe('natural-support'); continue; }
    if (/：自然应叫$/.test(fragment)) { expect(m.role).toBe('natural-response'); continue; }
    if (fragment === '自主再叫') { expect(r.before.mustBid).toBe(false); expect(m.forcing).toBe('none'); continue; }
    if (fragment === '回答' || fragment === '被迫回答同伴强扣叫') { expect(r.before.mustBid).toBe(true); expect(m.forcing).toBe('none'); continue; }
    if (fragment === '本体系未约定') { expect(m.defined).toBe(false); expect(r.text).toMatch(/未约定|不是本轮约定回答/); continue; }
    if (fragment === '问叫或逼叫仍须按约定处理') { expect(r.before.mustBid).toBe(true); expect(r.text).toContain('仍须完成'); continue; }
    if (fragment === '第二次负应叫') { expect(m.role).toBe('artificial-response'); expect(m.artificial).toBe(true); expect(m.hcpRange).toEqual({ min: 0, max: 3 }); expect(r.text).toContain('二次负应'); continue; }
    if (fragment === '不承诺所叫花色长度') { expect(m.artificial).toBe(true); if (r.call.kind === 'bid' && r.call.strain !== 'NT') expect(m.suitMinimums[r.call.strain]).toBeUndefined(); expect(r.text).toMatch(/不承诺.*长度/); continue; }
    if (fragment === '后续第二或第三套') { expect(m.role).toBe('natural-second-suit'); continue; }
    if (fragment === '自然竞争续叫') { expect(m.role).toBe('competitive-support'); continue; }
    if (fragment === '已示支持') { expect(Object.keys(r.prior.supportRanges).length).toBeGreaterThan(0); continue; }
    if (fragment === '已确认至少八张配合') {
      if (r.call.kind !== 'bid' || r.call.strain === 'NT') throw Error('Expected a suit fit');
      expect((m.suitMinimums[r.call.strain] ?? 0) + r.partner.suitMinimums[r.call.strain]).toBeGreaterThanOrEqual(8); continue;
    }
    if (fragment === '此前已示3+张') { if (r.call.kind !== 'bid' || r.call.strain === 'NT') throw Error('Expected a suit'); expect(r.prior.suitMinimums[r.call.strain]).toBe(3); continue; }
    if (fragment === '本次进一步显示4+张') { expect(m.suitMinimum).toBe(4); continue; }
    if (fragment === '不新增点力') { expect(m.hcpRange === undefined || m.hcpRange.min === 0 && m.hcpRange.max === 40).toBe(true); expect(m.supportRange).toBeUndefined(); continue; }
    if (fragment === '保留原技术X点力') { expect(m.hcpRange?.min).toBe(r.prior.hcpRange?.min); expect(m.hcpRange?.min).toBe(12); continue; }
    if (fragment === '保留强开叫的点力和已示方块长度') { expect(r.prior.hcpRange?.min).toBe(22); expect(m.suitMinimums.D).toBe(r.prior.suitMinimums.D); continue; }
    if (fragment === '4♦：二次负应后的最低原套回答') { expect(r.before.mustBid).toBe(true); expect(m.role).toBe('natural-repeat'); expect(m.forcing).toBe('none'); expect(r.call).toEqual({ kind: 'bid', level: 4, strain: 'D' }); continue; }
    if (fragment === '再加倍后') { expect(r.auction.some(e => e.call.kind === 'redouble')).toBe(true); expect(m.roleLabel).toBe('penalty'); expect(r.text).toContain('惩罚'); continue; }
    if (fragment === '强4441牌型允许两套等长') { expect(m.suitMinimums).toMatchObject({ D: 4, H: 4 }); expect(m.hcpRange).toEqual({ min: 17, max: 21 }); continue; }
    if (fragment === '未确认八张配合，不另加短门支持点') { expect(m.supportRange).toBeUndefined(); if (r.call.kind !== 'bid' || r.call.strain === 'NT') throw Error('Expected a suit'); expect((m.suitMinimums[r.call.strain] ?? 0) + r.partner.suitMinimums[r.call.strain]).toBeLessThan(8); continue; }
    if (fragment === '不新增18点或均型承诺') { expect(m.hcpRange?.min ?? 0).toBeLessThan(18); expect(m.strictBalancedShapeFamily).toBeUndefined(); expect(m.allowedShapeFamily).toBeUndefined(); continue; }
    if (fragment === '回答自然跳应叫邀请') {
      const index = r.auction.findLastIndex(e => e.seat === partnerOf(r.seat) && e.call.kind === 'bid');
      expect(publicCallMeaningAt(r.auction, index, 'sayc').invitation).toBe(true);
      expect(m.role).toBe('natural-second-suit'); expect(m.forcing).toBe('none'); continue;
    }
    if (fragment === '来自同伴') { expect(m.stopperSources.some(source => source.seat !== r.seat)).toBe(true); expect(r.text).toContain('由同伴已示'); continue; }
    if (fragment === '红心止张由本手自然无将叫品显示') { expect(m.stopperSources.some(source => source.seat === r.seat && source.suit === 'H')).toBe(true); expect(r.text).toContain('红心有止张'); continue; }
    if (fragment === '方块止张' || fragment === '红心止张') { expect(m.stopperSources.some(source => source.suit === suitNames[fragment.slice(0, 2)])).toBe(true); continue; }
    if (/：自然无将$/.test(fragment)) { expect(m.role).toBe('natural-nt'); expect(r.text).toContain('自然无将'); continue; }
    if (/：第四花色无将回答$/.test(fragment)) { expect(m.role).toBe('fourth-suit-nt-answer'); continue; }
    if (fragment === '长低花作自然无将选择') { expect(m.longMinorNTAlternative).toBeDefined(); expect(r.text).toContain('长低花'); continue; }
    if (fragment === '逆叫后的最低自然弱无将回答') { expect(m.role).toBe('natural-nt'); expect(m.hcpRange?.min).toBe(6); expect(m.forcing).toBe('none'); continue; }
    if (fragment === '高花成局答叫') { expect(m.role).toBe('natural-support'); expect(m.supportRange?.min).toBe(19); expect(m.forcing).toBe('none'); continue; }
    expect(r.text, `${prefix}/${token}: reviewed display phrase`).toContain(fragment);
  }
}

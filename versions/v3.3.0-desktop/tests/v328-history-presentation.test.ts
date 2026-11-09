import { describe, expect, it } from 'vitest';
import { describeCall } from '../src/ai/bidding';
import { agreementVersionFor } from '../src/ai/bid-strategy';
import { historicalCallExplanation, withRecordedBiddingAgreement } from '../src/ai/historical-bidding-presentation';
import { SYSTEMS, type BiddingSystem } from '../src/ai/systems';
import { openDocument } from '../src/analysis/model';
import { decodeDocument } from '../src/analysis/persistence';
import { applyCall, newGame, replay, toRecord } from '../src/core/game';
import { parseAuction } from './fixtures/android-stack-incident';

function gameFor(text: string, system: BiddingSystem) {
  let game = newGame(1, 'v328-public-context', { biddingSystem: system, agreementVersion: agreementVersionFor(system) });
  for (const entry of parseAuction(text)) game = applyCall(game, game.turn, entry.call);
  return game;
}

describe('v328 public presentation uses the recorded call prefix across surfaces', () => {
  const cases: [BiddingSystem, string][] = [
    ['sayc', '4NT P 5C P P P'],
    ['two-over-one', '4NT P 5D P P P'],
    ['sayc', '2S P 2NT P 3C P 3S P P P'],
    ['two-over-one', '1H 2S P 2NT P 3C P 3S P P P'],
    ['sayc', '1C P 1H P 2C P 2D P 2NT P P P'],
    ['two-over-one', '1H P 2C P 2H P 4H P P P'],
    ['precision', '1C P 1D P 1NT P 2C P 2D P 2NT P P P'],
    ['precision', '2D P 2NT P 3C P 3NT P P P'],
  ];
  it.each(cases)('%s candidate, table, historical and analysis share %s meanings', (system, text) => {
    const full = gameFor(text, system), archived = replay(JSON.parse(JSON.stringify(toRecord(full))));
    const otherHands = newGame(1, 'different-hidden-hands');
    for (let index = 0; index < full.auction.length; index++) {
      const entry = full.auction[index], before = full.auction.slice(0, index);
      const candidate = describeCall(before, entry.seat, entry.call, system);
      // LAN history also calls describeCall with this exact before-call prefix.
      const lan = describeCall(archived.auction.slice(0, index), entry.seat, entry.call, system);
      expect(lan).toBe(candidate);
      expect(historicalCallExplanation(archived, index, '旧措辞：错误的定量无将解释')).toBe(candidate);
      expect(historicalCallExplanation({ ...archived, auction: archived.auction.slice(0, index + 1) }, index)).toBe(candidate);
      expect(historicalCallExplanation({ ...archived, hands: otherHands.hands, initialHands: otherHands.initialHands }, index)).toBe(candidate);
    }
  });
  it.each(['sayc', 'two-over-one', 'precision'] as const)('fills missing board metadata only from a complete recorded %s match agreement', system => {
    const recorded = { biddingSystem: system, agreementVersion: agreementVersionFor(system) };
    const original = newGame(1, 'missing-board-metadata');
    const game = withRecordedBiddingAgreement(original, recorded);
    expect(game).toMatchObject(recorded);
    expect(original.biddingSystem).toBeUndefined(); expect(original.agreementVersion).toBeUndefined();
    expect(withRecordedBiddingAgreement(original, { biddingSystem: system })).toBe(original);
    const old = { ...original, biddingSystem: system, agreementVersion: `${system}-old-card` };
    expect(withRecordedBiddingAgreement(old, recorded)).toBe(old);
    const different = { ...original, biddingSystem: system === 'precision' ? 'sayc' as const : 'precision' as const };
    expect(withRecordedBiddingAgreement(different, recorded)).toBe(different);
  });
  it.each(['sayc', 'two-over-one', 'precision'] as const)('keeps current %s explanations canonical through analysis export/import', system => {
    let base = newGame(1, 'analysis-public-context');
    for (const entry of parseAuction('P P P P')) base = applyCall(base, base.turn, entry.call);
    const game = withRecordedBiddingAgreement(base, { biddingSystem: system, agreementVersion: agreementVersionFor(system) });
    const snapshots = game.auction.map(() => '相同协议下的过时措辞，不作为当前解释');
    const document = decodeDocument(JSON.stringify(openDocument(game, '公开叫牌上下文', snapshots)));
    const restored = replay(document.source);
    expect(restored).toMatchObject({ biddingSystem: system, agreementVersion: agreementVersionFor(system) });
    expect(document.biddingExplanations).toEqual(snapshots);
    restored.auction.forEach((entry, index) => {
      expect(historicalCallExplanation(restored, index, document.biddingExplanations?.[index]))
        .toBe(describeCall(restored.auction.slice(0, index), entry.seat, entry.call, system));
    });
  });
  it('preserves a genuinely old or unknown snapshot into analysis without relabeling its contract', () => {
    let game = newGame(1, 'old-public-context');
    for (const entry of parseAuction('P P P P')) game = applyCall(game, game.turn, entry.call);
    const old = { ...game, biddingSystem: 'sayc' as const, agreementVersion: 'sayc-old-card' };
    const snapshots = old.auction.map((_, index) => `旧合同保存的第${index + 1}步说明`);
    const restoredDocument = decodeDocument(JSON.stringify(openDocument(old, '旧合同', snapshots)));
    const restored = replay(restoredDocument.source);
    old.auction.forEach((_, index) => {
      expect(historicalCallExplanation(restored, index, restoredDocument.biddingExplanations?.[index]))
        .toBe(historicalCallExplanation(old, index, snapshots[index]));
    });
    expect(historicalCallExplanation(game, 0, snapshots[0])).toBe(`原约定：${snapshots[0]}`);
    expect(historicalCallExplanation(old, 0)).toBe(`按当前标准（SAYC）：${describeCall([], old.auction[0].seat, old.auction[0].call, 'sayc')}`);
  });
  it.each(['sayc', 'two-over-one', 'precision'] as const)('keeps the original 1H prefix usable across %s metadata branches without changing its archive', system => {
    // Same original 1H prefix; only its public metadata changes.
    const current = gameFor('1H', system), entry = current.auction[0];
    const canonical = describeCall([], entry.seat, entry.call, system);
    for (const agreementVersion of [undefined, `${system}-v2.1`, `${system}-v2.3`, agreementVersionFor(system)]) {
      const record = { ...toRecord(current), agreementVersion }, before = JSON.stringify(record);
      const restored = replay(record), exact = agreementVersion === agreementVersionFor(system);
      expect(historicalCallExplanation(restored, 0)).toBe(exact ? canonical : `按当前${SYSTEMS[system].short}：${canonical}`);
      expect(historicalCallExplanation(restored, 0, '原约定保存的1H说明')).toBe(exact ? canonical : '原约定：原约定保存的1H说明');
      expect(JSON.stringify(record)).toBe(before);
      expect(restored.agreementVersion).toBe(agreementVersion);
    }
    const absent = { ...current, biddingSystem: undefined, agreementVersion: undefined };
    expect(historicalCallExplanation(absent, 0, undefined, system)).toBe(`按当前${SYSTEMS[system].short}：${canonical}`);
    expect(historicalCallExplanation(absent, 0)).toBe('原叫牌体系未记录。');
    expect(historicalCallExplanation(absent, 0, '原约定保存的1H说明')).toBe('原约定：原约定保存的1H说明');
    const old = { ...current, agreementVersion: `${system}-old-card` };
    expect(historicalCallExplanation(old, 0, undefined, system === 'precision' ? 'sayc' : 'precision'))
      .toBe(`按当前${SYSTEMS[system].short}：${canonical}`);
  });
  it('rejects invalid snapshot annotations and never uses a cache for a nonexistent call', () => {
    const game = gameFor('P P P P', 'sayc');
    const document = openDocument(game);
    expect(() => decodeDocument(JSON.stringify({ ...document, biddingExplanations: ['wrong length'] }))).toThrow('快照无效');
    expect(() => decodeDocument(JSON.stringify({ ...document, biddingExplanations: ['', 'x', 'x', 'x'] }))).toThrow('快照无效');
    expect(historicalCallExplanation(game, -1, '不存在的旧缓存')).toContain('没有已发生');
    expect(historicalCallExplanation(game, 4, '不存在的旧缓存')).toContain('没有已发生');
  });
});

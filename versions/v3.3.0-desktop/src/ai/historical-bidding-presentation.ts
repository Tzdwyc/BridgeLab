import { type GameState } from '../core/types';
import { SYSTEMS, type BiddingSystem } from './systems';
import { agreementVersionFor } from './bid-strategy';
import { describeCall } from './bidding';

/** A match's recorded public agreement may fill missing per-board metadata.
 * Explicit or conflicting record metadata is never replaced, and settings are
 * not an agreement source. This returns a view copy, not an archive mutation. */
export function withRecordedBiddingAgreement(game: GameState, recorded?: { biddingSystem?: BiddingSystem; agreementVersion?: string }): GameState {
  if (!recorded?.biddingSystem || !recorded.agreementVersion
    || game.biddingSystem && game.biddingSystem !== recorded.biddingSystem
    || game.agreementVersion && game.agreementVersion !== recorded.agreementVersion) return game;
  return { ...game, biddingSystem: game.biddingSystem ?? recorded.biddingSystem,
    agreementVersion: game.agreementVersion ?? recorded.agreementVersion };
}

/** Preserve old recorded meanings; otherwise explain the available system
 * with an explicit current-reference label. Never rewrites archive metadata. */
export function historicalCallExplanation(game: GameState, index: number, frozen?: string, fallbackSystem?: BiddingSystem): string {
  const system = game.biddingSystem ?? fallbackSystem;
  const entry = Number.isInteger(index) && index >= 0 ? game.auction[index] : undefined;
  if (!entry) return '此位置没有已发生的叫品。';
  if (entry && system && game.agreementVersion === agreementVersionFor(system))
    return describeCall(game.auction.slice(0, index), entry.seat, entry.call, system);
  if (frozen) return `原约定：${frozen}`;
  return system
    ? `按当前${SYSTEMS[system].short}：${describeCall(game.auction.slice(0, index), entry.seat, entry.call, system)}`
    : '原叫牌体系未记录。';
}

/** The stored reason is retained; the player sees the historical adjustment rather than engine diagnostics. */
export function historicalBidAdjustment(reason: string): string {
  if (reason.includes('前瞻估计')) return '综合后续定约得失后调整了叫品';
  if (reason.includes('防守牌力支持')) return '防守实力支持惩罚性加倍';
  if (reason.includes('防守牌力不足')) return '防守实力不足，放弃惩罚性加倍';
  if (reason.includes('保留搭档')) return '保留同伴的惩罚性加倍';
  if (reason.includes('被惩罚性加倍')) return '本方被惩罚性加倍后改叫自然花色';
  return '结合当前叫牌选择了另一叫品';
}

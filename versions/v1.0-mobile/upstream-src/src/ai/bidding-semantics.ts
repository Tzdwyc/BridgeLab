import { type AuctionEntry, type Seat, type Strain, type Suit, partnerOf, sideOf } from '../core/types';
import { bidValue } from '../core/auction';
import { type BiddingSystem } from './systems';
import { publicSupportMinimum } from './suit-evaluation';

type Bid = Extract<AuctionEntry['call'], { kind: 'bid' }>;
type BidEntry = { seat: Seat; call: Bid; index: number };

export type ForcingLevel = 'none' | 'one-round' | 'game';
export type ForcingConvention = 'none' | 'strong-opening' | 'waiting-response' | 'strong-suit-rebid' | 'forcing-nt'
  | 'michaels-advance' | 'unusual-advance' | 'michaels-inquiry' | 'overcall-stayman' | 'overcall-transfer' | 'weak-jump-inquiry'
  | 'takeout-response' | 'negative-double' | 'overcall-cue' | 'competitive-cue' | 'natural-response'
   | 'reverse' | 'opener-jump-shift' | 'nt-competitive-response' | 'fourth-suit' | 'new-minor' | 'trial-bid' | 'preempt-new-suit'
  | 'takeout-cue' | 'keycard' | 'king-ask' | 'artificial-answer' | 'responder-second-suit' | 'quantitative-grand-invitation' | 'control-cue' | 'weak-minor-relay' | 'precision-negative-pass' | 'precision-inquiry';
export interface PointRange { min: number; max: number }
export interface AuctionSemantics {
  forcing: ForcingLevel;
  convention: ForcingConvention;
  mustBid: boolean;
  currentContractArtificial: boolean;
}

const bids = (auction: AuctionEntry[]): BidEntry[] => auction.flatMap((entry, index) => entry.call.kind === 'bid' ? [{ seat: entry.seat, call: entry.call, index }] : []);
const major = (strain: Strain) => strain === 'H' || strain === 'S';
const gameLevel = (strain: Strain) => strain === 'NT' ? 3 : major(strain) ? 4 : 5;
const atGame = (call: Bid) => call.level >= gameLevel(call.strain);
const openerStrongClub = (call: Bid) => call.level === 2 && call.strain === 'C';
const intervened = (auction: AuctionEntry[], seat: Seat, from: number, to = auction.length) => auction.slice(from + 1, to).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== 'pass');
const passedBefore = (auction: AuctionEntry[], seat: Seat, index: number) => auction.slice(0, index).some((entry, at) => entry.seat === seat
  && entry.call.kind === 'pass' && !auction.slice(0, at).some(prior => prior.call.kind === 'bid'));

function precisionNegativePassAt(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const opening = bids(auction)[0], entry = auction[index], interference = opening && auction[opening.index + 1];
  return system === 'precision' && opening?.call.level === 1 && opening.call.strain === 'C'
    && entry?.call.kind === 'pass' && entry.seat === partnerOf(opening.seat) && index === opening.index + 2
    && interference?.call.kind === 'bid' && interference.call.strain !== 'NT' && interference.call.level <= 2;
}

function precisionConventionAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  if (system !== 'precision') return undefined;
  const entry = auction[index];
  if (entry?.call.kind !== 'bid') return undefined;
  const all = bids(auction.slice(0,index+1)), side = all.filter(prior=>sideOf(prior.seat)===sideOf(entry.seat));
  const opening=side[0], response=side[1];
  if (opening?.index !== all[0]?.index) return undefined;
  if (index===opening.index && opening.call.level===2 && ['C','D'].includes(opening.call.strain))
    return { stage: opening.call.strain==='C' ? 'club-opening' as const : 'shape-opening' as const, opening };
  if (side.length===2 && entry.seat!==opening.seat && !intervened(auction,entry.seat,opening.index,index)) {
    if (opening.call.level===1 && opening.call.strain==='C' && entry.call.level===1 && entry.call.strain==='D')
      return {stage:'negative' as const,opening};
    if (opening.call.level===2 && opening.call.strain==='C' && entry.call.level===2 && entry.call.strain==='D')
      return {stage:'club-inquiry' as const,opening};
    if (opening.call.level===2 && opening.call.strain==='D' && entry.call.level===2 && entry.call.strain==='NT')
      return {stage:'shape-inquiry' as const,opening};
  }
  if (side.length===3 && entry.seat===opening.seat && response && !intervened(auction,entry.seat,opening.index,index)) {
    if (opening.call.level===2 && opening.call.strain==='C' && response.call.level===2 && response.call.strain==='D'
      && (entry.call.level===2 && ['H','S','NT'].includes(entry.call.strain) || entry.call.level===3 && entry.call.strain==='C'))
      return {stage:'club-answer' as const,opening};
    if (opening.call.level===2 && opening.call.strain==='D' && response.call.level===2 && response.call.strain==='NT'
      && entry.call.level===3 && entry.call.strain!=='NT') return {stage:'shape-answer' as const,opening};
  }
  return undefined;
}

export interface PublicNoTrumpQuestion {
  platform: BidEntry;
  request: BidEntry;
  kind: 'stayman' | 'transfer' | 'weak-minor-relay';
  target?: Suit;
}

/** Opening NT, natural NT overcalls, and strong-club NT rebids share these
 * questions. Ordinary suit-opening NT rebids are deliberately excluded. */
export function publicNoTrumpQuestionAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): PublicNoTrumpQuestion | undefined {
  const request = auction[index];
  if (request?.call.kind !== 'bid') return undefined;
  const side = bids(auction.slice(0, index)).filter(entry => sideOf(entry.seat) === sideOf(request.seat));
  const platform = side.at(-1);
  if (!platform || platform.seat !== partnerOf(request.seat) || platform.call.strain !== 'NT'
    || platform.call.level > 3 || request.call.level !== platform.call.level + 1) return undefined;
  const strongClub = side.length === 3 && side[0].index === bids(auction)[0]?.index && side[0].call.strain === 'C'
    && (system === 'precision' ? side[0].call.level === 1 : side[0].call.level === 2);
  const platformRange = noTrumpRangeAt(auction, platform.index, system);
  const strongTakeoutNT = (platformRange?.min ?? 0) >= 18
    && auction.slice(0, platform.index).some((entry, at) => entry.seat === platform.seat && isTakeoutDoubleAt(auction, at));
  if (!(side.length === 1 || strongClub || strongTakeoutNT) || !platformRange) return undefined;
  // A prior same-side X makes the NT a takeout continuation, not a first
  // natural platform. A doubled question keeps its response obligation.
  if (!strongClub && !strongTakeoutNT && auction.slice(0, platform.index).some(entry => sideOf(entry.seat) === sideOf(request.seat)
    && entry.call.kind !== 'pass')) return undefined;
  if (auction.slice(platform.index + 1, index).some(entry => sideOf(entry.seat) !== sideOf(request.seat)
    && entry.call.kind !== 'pass')) return undefined;
  const question = { seat: request.seat, call: request.call, index };
  if (request.call.strain === 'C') return { platform, request: question, kind: 'stayman' };
  if (request.call.strain === 'D' || request.call.strain === 'H')
    return { platform, request: question, kind: 'transfer', target: request.call.strain === 'D' ? 'H' : 'S' };
  if (platform.call.level === 1 && request.call.strain === 'S')
    return { platform, request: question, kind: 'weak-minor-relay', target: 'C' };
  return undefined;
}

/** A natural two-heart intervention replaces the unanswered one-NT Stayman
 * obligation with an optional natural description. No hidden hand is used. */
export function publicInterruptedStaymanBefore(auction: AuctionEntry[], seat: Seat, system: BiddingSystem = 'sayc') {
  const side = bids(auction).filter(entry => sideOf(entry.seat) === sideOf(seat));
  const request = side.at(-1);
  const question = request && publicNoTrumpQuestionAt(auction, request.index, system);
  const enemy = bids(auction).at(-1);
  if (question?.kind !== 'stayman' || question.platform.call.level !== 1 || question.platform.seat !== seat
    || !enemy || enemy.index <= request!.index || sideOf(enemy.seat) === sideOf(seat)
    || enemy.call.level !== 2 || enemy.call.strain !== 'H' || isArtificialBidAt(auction, enemy.index, system)) return undefined;
  return { ...question, enemy };
}

/** Once a natural enemy bid makes the minimum transfer acceptance illegal,
 * the old automatic acceptance is released. A competitive acceptance is a
 * real support decision; X of the transfer itself does not cancel it. */
export function publicInterruptedTransferBefore(auction: AuctionEntry[], seat: Seat, system: BiddingSystem = 'sayc') {
  const side = bids(auction).filter(entry => sideOf(entry.seat) === sideOf(seat));
  const request = side.at(-1), question = request && publicNoTrumpQuestionAt(auction, request.index, system);
  const enemy = bids(auction).at(-1);
  if (question?.kind !== 'transfer' || question.platform.seat !== seat || !question.target || !enemy
    || enemy.index <= request!.index || sideOf(enemy.seat) === sideOf(seat)
    || isArtificialBidAt(auction, enemy.index, system)
    || bidValue(enemy.call) < bidValue({ kind: 'bid', level: request!.call.level, strain: question.target })) return undefined;
  return { ...question, enemy };
}

export function publicWeakMinorRelayAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if (target?.call.kind !== 'bid') return undefined;
  const question = publicNoTrumpQuestionAt(auction, index, system);
  if (question?.kind === 'weak-minor-relay') return { ...question, stage: 'request' as const };
  const side = bids(auction.slice(0, index + 1)).filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const acceptance = side.at(-2), priorRequest = side.at(-3);
  const candidate = side.at(-2);
  const requested = candidate && publicNoTrumpQuestionAt(auction, candidate.index, system);
  if (requested?.kind === 'weak-minor-relay' && target.seat === requested.platform.seat
    && target.call.level === 3 && target.call.strain === 'C')
    return { ...requested, stage: 'acceptance' as const };
  const correction = priorRequest && publicNoTrumpQuestionAt(auction, priorRequest.index, system);
  if (correction?.kind === 'weak-minor-relay' && acceptance?.seat === correction.platform.seat
    && acceptance.call.level === 3 && acceptance.call.strain === 'C' && target.seat === correction.request.seat
    && target.call.level === 3 && target.call.strain === 'D')
    return { ...correction, stage: 'correction' as const };
  return undefined;
}

export interface PublicTakeoutDouble {
  kind: 'direct' | 'balancing' | 'repeat' | 'sandwich' | 'reopening' | 'responsive';
  target: Suit;
  targetIndex: number;
  unbidSuits: Suit[];
  preferredSuits: Suit[];
}

/** Technical X is a public auction agreement, never a reading of the doubler's
 * cards. Prior bidding alone does not make X penalty: a sole natural opener or
 * overcaller may reopen, and an unbid advancer may make a responsive double.
 * Natural NT, a known fit, a shown enemy suit and an earlier penalty decision
 * exclude these narrowly defined extensions. Only the prefix at X is used. */
export function publicTakeoutDoubleAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): PublicTakeoutDouble | undefined {
  const entry = auction[index];
  if (entry?.call.kind !== 'double') return undefined;
  const before = auction.slice(0, index), all = bids(before);
  const opening = all[0], target = all.at(-1);
  if (entry?.call.kind !== 'double' || !opening || !target || target.call.strain === 'NT'
    || target.call.level > 3 || sideOf(target.seat) === sideOf(entry.seat)
    || isArtificialBidAt(before, target.index, system)) return undefined;
  const immediate = index === target.index + 1;
  const balancing = index === target.index + 3 && before.slice(target.index + 1).every(prior => prior.call.kind === 'pass');
  if (!immediate && !balancing) return undefined;
  const ours = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const enemy = all.filter(prior => sideOf(prior.seat) !== sideOf(entry.seat));
  const actions = before.flatMap((prior, at) => sideOf(prior.seat) === sideOf(entry.seat) && prior.call.kind !== 'pass'
    ? [{ ...prior, index: at }] : []);
  if (before.some((prior, at) => sideOf(prior.seat) === sideOf(entry.seat) && prior.call.kind === 'pass'
    && publicPenaltyConversionBefore(before.slice(0, at), prior.seat, system))) return undefined;
  if (actions.some(prior => prior.call.kind === 'redouble')
    || ours.some(prior => prior.call.strain === 'NT' && !isArtificialBidAt(before, prior.index, system))
    || ours.some(prior => prior.call.strain === target.call.strain && !isArtificialBidAt(before, prior.index, system))) return undefined;
  const naturalOurs = ours.filter(prior => prior.call.strain !== 'NT' && !isArtificialBidAt(before, prior.index, system));
  if (naturalOurs.some(prior => naturalOurs.some(other => other.seat !== prior.seat && other.call.strain === prior.call.strain))) return undefined;
  const enemyNatural = enemy.every((prior, position) => {
    if (prior.call.strain !== 'NT') return !isArtificialBidAt(before, prior.index, system);
    // 1M–1NT–2x is still a low natural two-suit auction. Responder's
    // limited/semi-forcing 1NT is not a strong NT opening or overcall.
    const range = noTrumpRangeAt(before, prior.index, system);
    return position === 1 && enemy[0].call.level === 1 && enemy[0].call.strain !== 'NT'
      && prior.call.level === 1 && prior.seat === partnerOf(enemy[0].seat) && !!range && range.max <= 12;
  });
  if (!enemyNatural) return undefined;
  const singleEnemySuit = enemy.every(prior => prior.call.strain === target.call.strain);
  const enemyRaised = enemy.length >= 2 && singleEnemySuit && target.seat !== enemy[0].seat
    && target.call.level > enemy[0].call.level;
  const shown = new Set([...naturalOurs, ...enemy].map(prior => prior.call.strain));
  const unbidSuits = (['C', 'D', 'H', 'S'] as Suit[]).filter(suit => !shown.has(suit));
  const unbidMajors = unbidSuits.filter(major);
  const result = (kind: PublicTakeoutDouble['kind']): PublicTakeoutDouble => ({ kind, target: target.call.strain as Suit,
    targetIndex: target.index, unbidSuits, preferredSuits: kind === 'responsive' && major(target.call.strain)
      ? unbidSuits.filter(suit => !major(suit)) : unbidMajors.length === 2 ? unbidMajors : unbidSuits });
  if (opening.index === target.index && sideOf(opening.seat) !== sideOf(entry.seat) && !actions.length)
    return result(balancing ? 'balancing' : 'direct');
  // Responder's first X over a natural overcall remains negative, not responsive.
  if (isNegativeDoubleAt(auction, index)) return undefined;
  if (actions.length === 1 && actions[0].seat === partnerOf(entry.seat) && enemyRaised) {
    const partnerAction = actions[0];
    const partnerTakeout = partnerAction.call.kind === 'double' && isTakeoutDoubleAt(before, partnerAction.index, system);
    const partnerOvercall = partnerAction.call.kind === 'bid' && naturalOurs.length === 1
      && partnerAction.index > enemy[0].index && partnerAction.index < target.index;
    if ((partnerTakeout || partnerOvercall) && unbidSuits.length >= 2) return result('responsive');
  }
  // The opener/overcaller has described one suit only; partner has merely
  // passed. X requests the remaining suits rather than fabricating 17+ extras.
  if (actions.length === 1 && actions[0].seat === entry.seat && naturalOurs.length === 1
    && naturalOurs[0].call.level === 1 && singleEnemySuit && unbidSuits.length >= 2
    && before.some((prior, at) => prior.seat === partnerOf(entry.seat) && prior.call.kind === 'pass'
      && at > enemy[0].index) && target.index > actions[0].index) return result('reopening');
  // A previous takeout X by this same player may be repeated; a partner's
  // penalty X or a previous penalty/lead/negative X cannot become takeout.
  const onlyOwnTakeouts = actions.every(prior => prior.seat === entry.seat && prior.call.kind === 'double'
    && isTakeoutDoubleAt(before, prior.index, system));
  if (!onlyOwnTakeouts || sideOf(opening.seat) === sideOf(entry.seat) || opening.call.level > 3) return undefined;
  const naturalTwoSuitAuction = opening.call.level === 1 && enemy.length === 3
    && enemy[1].call.level === 1 && enemy[1].seat !== opening.seat
    && enemy[2].seat === opening.seat && enemy[2].call.level === 2;
  const sandwichAuction = opening.call.level === 1 && enemy.length === 2
    && enemy[1].seat === partnerOf(opening.seat) && enemy[1].call.level === 1
    && enemy[1].call.strain !== opening.call.strain;
  if (singleEnemySuit || naturalTwoSuitAuction || sandwichAuction)
    return result(actions.length ? 'repeat' : sandwichAuction ? 'sandwich' : balancing ? 'balancing' : 'direct');
  return undefined;
}

export function isTakeoutDoubleAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): boolean {
  return !!publicTakeoutDoubleAt(auction, index, system);
}

/** This is the public opportunity to convert, not permission for every hand
 * to pass. The chooser must independently require real trump defense. Once
 * Pass is chosen here it commits our side to defending and later X is penalty. */
export function publicPenaltyConversionBefore(auction: AuctionEntry[], seat: Seat, system: BiddingSystem = 'sayc') {
  const doubleIndex = auction.length - 2, double = auction[doubleIndex], enemyPass = auction.at(-1);
  if (double?.seat !== partnerOf(seat) || double.call.kind !== 'double'
    || enemyPass?.call.kind !== 'pass' || sideOf(enemyPass.seat) === sideOf(seat)
    || !isTakeoutDoubleAt(auction, doubleIndex, system)) return undefined;
  const target = bids(auction.slice(0, doubleIndex)).at(-1);
  if (!target || target.call.strain === 'NT') return undefined;
  return { doubleIndex, target: target.call.strain as Suit, targetIndex: target.index };
}

export type DoubleMeaning = 'takeout' | 'negative' | 'two-suit-strength' | 'lead-directing' | 'penalty';

/** Negative doubles belong to opener's immediate responder, never to a
 * redoubler later penalizing an escape or to an already answered request. */
export function isNegativeDoubleAt(auction: AuctionEntry[], index: number): boolean {
  const opening = bids(auction.slice(0, index))[0], entry = auction[index];
  const overcall = opening && auction[opening.index + 1];
  return !!opening && entry?.call.kind === 'double' && opening.call.level === 1
    && opening.call.strain !== 'NT' && entry.seat === partnerOf(opening.seat)
    && index === opening.index + 2 && overcall?.call.kind === 'bid'
    && overcall.call.strain !== 'NT' && overcall.call.strain !== opening.call.strain
    && bidValue(overcall.call) <= bidValue({ kind: 'bid', level: 2, strain: 'S' });
}

/** The request belongs to the enemy overcall at the time of X. Later enemy
 * suits cannot retroactively change which major the negative double showed. */
export function publicNegativeDoubleMajorsAt(auction: AuctionEntry[], index: number): Suit[] {
  if (!isNegativeDoubleAt(auction, index)) return [];
  const opening = bids(auction.slice(0, index))[0];
  const overcall = auction[opening.index + 1].call as Bid;
  return (['H', 'S'] as Suit[]).filter(suit => suit !== opening.call.strain && suit !== overcall.strain);
}

/** A first delayed advance may freely name responder's earlier suit. It is
 * not a cue of opener's suit, and earlier Pass does not turn it artificial. */
function isDelayedTakeoutSuitAnswer(auction: AuctionEntry[], index: number): boolean {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.strain === 'NT') return false;
  const double = auction.findLastIndex((prior, priorIndex) => priorIndex < index
    && prior.seat === partnerOf(entry.seat) && isTakeoutDoubleAt(auction, priorIndex));
  if (double < 0 || auction.slice(double + 1, index).some(prior => prior.seat === entry.seat && prior.call.kind === 'bid')) return false;
  const enemy = bids(auction.slice(0, double)).filter(prior => sideOf(prior.seat) !== sideOf(entry.seat));
  const original = enemy[0];
  if (!original || entry.call.strain === original.call.strain) return false;
  if (bids(auction.slice(double + 1, index)).some(prior => sideOf(prior.seat) !== sideOf(entry.seat))) return true;
  return enemy.length === 3 && enemy[0].seat === enemy[2].seat && enemy[0].call.level === 1
    && enemy[2].call.level === 2 && enemy[2].call.strain !== enemy[0].call.strain
    && entry.call.strain !== enemy[0].call.strain && entry.call.strain !== enemy[2].call.strain;
}

type StaymanContinuation = { kind: 'denial-major-unknown' | 'other-major-invitation' | 'other-major-game-force'; platform: BidEntry; answer: BidEntry };
function staymanContinuationAt(auction: AuctionEntry[], index: number, system: BiddingSystem): StaymanContinuation | undefined {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || !major(target.call.strain)) return undefined;
  const own = bids(auction.slice(0, index + 1)).filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const position = own.length - 1;
  const platform = own[position - 3], inquiry = own[position - 2], answer = own[position - 1];
  const platformPosition = position - 3;
  const genuineStrongNT = platformPosition === 2 && own[0].index === bids(auction)[0]?.index
    && own[0].call.strain === 'C' && (own[0].call.level === 2 || system === 'precision' && own[0].call.level === 1);
  if (!platform || !inquiry || !answer || !(platformPosition === 0 || genuineStrongNT)
    || !isNaturalNoTrumpAt(auction, platform.index, system)
    || inquiry.seat !== target.seat || inquiry.call.strain !== 'C' || inquiry.call.level !== platform.call.level + 1
    || answer.call.level !== inquiry.call.level || answer.seat === target.seat) return undefined;
  if (answer.call.strain === 'D') return { kind: 'denial-major-unknown', platform, answer };
  if (major(answer.call.strain) && target.call.strain !== answer.call.strain
    && bidValue(target.call) - bidValue(answer.call) <= 5)
    return { kind: platform.call.level === 1 && target.call.level === 2
      ? 'other-major-invitation' : 'other-major-game-force', platform, answer };
  return undefined;
}

/** The NT bidder's answer to a four-card other-major invitation is a
 * rejection/acceptance, never a fresh invitation by the NT bidder. */
function staymanNTDecisionAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.strain !== 'NT' || ![2, 3].includes(target.call.level)) return undefined;
  const partner = bids(auction.slice(0, index)).findLast(prior => prior.seat === partnerOf(target.seat));
  const invitation = partner && staymanContinuationAt(auction, partner.index, system);
  if (invitation?.kind !== 'other-major-invitation' || invitation.platform.seat !== target.seat) return undefined;
  const platform = noTrumpRangeAt(auction, invitation.platform.index, system);
  if (!platform) return undefined;
  const invitationMin = Math.max(8, 25 - platform.max);
  return { platform, invitationMin, accepted: target.call.level === 3,
    range: target.call.level === 2 ? { min: platform.min, max: 24 - invitationMin }
      : { min: 25 - invitationMin, max: platform.max } };
}

function transferGameContinuationAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid') return undefined;
  const side = bids(auction.slice(0, index + 1)).filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  for (let at = 0; at + 3 < side.length; at++) {
    const platform = side[at], transfer = side[at + 1], acceptance = side[at + 2], offer = side[at + 3];
    const trump: Suit | undefined = transfer.call.strain === 'D' ? 'H' : transfer.call.strain === 'H' ? 'S' : undefined;
    if (!trump || !isNaturalNoTrumpAt(auction, platform.index, system) || platform.call.level > 2
      || transfer.seat === platform.seat || !isArtificialBidAt(auction, transfer.index, system)
      || transfer.call.level !== platform.call.level + 1 || acceptance.seat !== platform.seat
      || acceptance.call.strain !== trump || acceptance.call.level !== transfer.call.level
      || offer.seat !== transfer.seat || offer.call.strain !== 'NT' || ![2, 3].includes(offer.call.level)) continue;
    if (offer.index === index && offer.call.level === 3) return { kind: 'offer' as const, trump, platform, offer };
    if (side[at + 4]?.index === index && target.seat === platform.seat && target.call.strain === trump
      && target.call.level === 4) return { kind: 'support' as const, trump, platform, offer };
  }
  return undefined;
}

function naturalMinorSlamTryAt(auction: AuctionEntry[], index: number) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 4 || !['C', 'D'].includes(target.call.strain)) return false;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const [opening, response] = side;
  return side.length === 3 && opening?.index === all[0]?.index && opening.seat === target.seat
    && opening.call.level === 1 && opening.call.strain === target.call.strain
    && response?.call.strain === 'NT' && response.call.level === 3
    && all.some(prior => prior.index > opening.index && prior.index < response.index
      && sideOf(prior.seat) !== sideOf(target.seat) && prior.call.level === 3 && prior.call.strain !== 'NT');
}

function weakDoubledEscapeAt(auction: AuctionEntry[], index: number) {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 2 || entry.call.strain === 'NT') return false;
  const before = auction.slice(0, index), lastBid = bids(before).at(-1);
  const lastAction = before.findLast(prior => prior.call.kind !== 'pass');
  if (!lastBid || lastBid.seat !== partnerOf(entry.seat) || lastBid.call.level !== 1
    || lastAction?.call.kind !== 'double' || sideOf(lastAction.seat) === sideOf(entry.seat)) return false;
  const priorRedouble = before.some((prior, at) => at < lastBid.index && prior.call.kind === 'redouble');
  const escapeOrigin = before.some((prior, at) => at < lastBid.index && sideOf(prior.seat) === sideOf(entry.seat)
    && (prior.call.kind === 'redouble' || isTakeoutDoubleAt(before, at)));
  return priorRedouble && escapeOrigin && entry.call.strain !== lastBid.call.strain;
}

function newSuitOverStrongNTRebidAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || target.call.strain === 'NT') return false;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const [opening, response, rebid] = side;
  return (system === 'sayc' || system === 'two-over-one') && side.length === 4
    && opening?.index === all[0]?.index && opening.call.level === 1 && opening.call.strain !== 'NT'
    && response?.seat === target.seat && response.call.level === 1 && response.call.strain !== 'NT'
    && rebid?.seat === opening.seat && rebid.call.strain === 'NT' && rebid.call.level === 2
    && target.call.strain !== opening.call.strain && target.call.strain !== response.call.strain
    && noTrumpRangeAt(auction, rebid.index, system)?.min === 18
    && !intervened(auction, target.seat, opening.index, index);
}

/** A control below the agreed major game is distinct from a natural new
 * suit or a support cue of the opponents' suit. Only a previously public
 * eight-card major fit and a game force/strong three-level support enable it. */
export function publicControlCueAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'):
  { trump: Suit; suit: Suit; continuation: boolean; control: 'first-or-second-round'; supportMinimum?: number; postHeartGame?: boolean } | undefined {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 4 || entry.call.strain === 'NT') return undefined;
  const before = auction.slice(0, index), all = bids(before);
  const side = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  if (!side.length || side.some(prior => prior.call.level >= 4 && prior.call.strain === 'NT')) return undefined;
  // With two genuinely established major fits, 4H selects the heart game;
  // it must not be recast as a heart control for the earlier spade fit.
  if (major(entry.call.strain) && naturalSuitMinimum(before, entry.seat, entry.call.strain as Suit, system)
    + naturalSuitMinimum(before, partnerOf(entry.seat), entry.call.strain as Suit, system) >= 8) return undefined;
  const heartGame = side.at(-1);
  if (entry.call.strain === 'S' && heartGame?.seat === partnerOf(entry.seat)
    && heartGame.call.level === 4 && heartGame.call.strain === 'H' && all.at(-1)?.index === heartGame.index
    && !isArtificialBidAt(before, heartGame.index, system)
    && naturalSuitMinimum(before, entry.seat, 'H', system)
      + naturalSuitMinimum(before, partnerOf(entry.seat), 'H', system) >= 8
    && !side.some(prior => publicCallMeaningAt(before, prior.index, system).controlSuits?.S)) {
    const ownLength = naturalSuitMinimum(before, entry.seat, 'H', system);
    return { trump: 'H', suit: 'S', continuation: false, control: 'first-or-second-round', postHeartGame: true,
      supportMinimum: Math.max(0, 33 - publicSupportMinimum('H', ownLength,
        publicPlayerConstraints(before, partnerOf(entry.seat), system))) };
  }
  const priorControl = side.findLast(prior => publicControlCueAt(before, prior.index, system));
  const continued = priorControl && publicControlCueAt(before, priorControl.index, system);
  const latestMajor = side.findLast(prior => major(prior.call.strain) && prior.call.level === 3
    && !isArtificialBidAt(before, prior.index, system));
  const jacobyTrump = side[0]?.call.level === 1 && major(side[0].call.strain)
    && side[1]?.call.level === 2 && side[1].call.strain === 'NT' && isArtificialBidAt(before, side[1].index, system)
    ? side[0].call.strain as Suit : undefined;
  const trump = continued?.trump ?? jacobyTrump ?? latestMajor?.call.strain as Suit | undefined;
  if (!trump || !major(trump) || entry.call.strain === trump
    || bidValue(entry.call) >= bidValue({ kind: 'bid', level: 4, strain: trump })
    || side.some(prior => prior.call.strain === trump && prior.call.level >= 4)) return undefined;
  const controlSuit = entry.call.strain as Suit;
  if (side.some(prior => publicCallMeaningAt(before, prior.index, system).controlSuits?.[controlSuit])) return undefined;
  if (naturalSuitMinimum(before, entry.seat, trump, system)
    + naturalSuitMinimum(before, partnerOf(entry.seat), trump, system) < 8) return undefined;
  const support = latestMajor && publicCallMeaningAt(before, latestMajor.index, system);
  const strongSupport = support && (support.invitation && (support.supportRange?.min ?? support.hcpRange?.min ?? 0) >= 10
    || support.role === 'natural-support' && (support.hcpRange?.min ?? 0) >= 15);
  if (!continued && !strongSupport && analyzeAuctionSemantics(before, entry.seat, system).forcing !== 'game') return undefined;
  const ownPublicLength = naturalSuitMinimum(before, entry.seat, trump, system);
  const supportMinimum = continued ? undefined : Math.max(0, 33 - publicSupportMinimum(trump, ownPublicLength,
    publicPlayerConstraints(before, partnerOf(entry.seat), system)));
  return { trump, suit: entry.call.strain as Suit, continuation: !!continued, control: 'first-or-second-round' as const,
    ...(supportMinimum !== undefined ? { supportMinimum } : {}) };
}

/** Only these weak, natural, two-level corrections promise just two cards.
 * Artificial support, game forces and voluntary side-suit raises are excluded. */
function naturalPreferenceAt(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 2 || entry.call.strain === 'NT') return false;
  const all = bids(auction.slice(0, index + 1));
  const side = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const [opening, response, rebid] = side;
  if (side.length !== 4 || opening.index !== all[0]?.index || opening.call.level !== 1
    || opening.call.strain !== entry.call.strain || response.seat !== entry.seat || rebid.seat !== opening.seat
    || rebid.call.strain === opening.call.strain || rebid.call.strain === 'NT'
    || isArtificialBidAt(auction, response.index, system) || isArtificialBidAt(auction, rebid.index, system)
    || analyzeAuctionSemantics(auction.slice(0, index), entry.seat, system).mustBid) return false;
  const semiNT = major(opening.call.strain) && response.call.level === 1 && response.call.strain === 'NT'
    && isNaturalNoTrumpAt(auction, response.index, system);
  const naturalSuitReturn = response.call.level === 1 && response.call.strain !== 'NT'
    && response.call.strain !== opening.call.strain;
  return semiNT || naturalSuitReturn;
}

function lowPointNaturalPreferenceAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.strain === 'NT' || target.call.level > 3) return false;
  const strain = target.call.strain;
  const before = auction.slice(0, index), all = bids(before);
  if (all.some(prior => prior.seat === target.seat
    && publicCallMeaningAt(before, prior.index, system).supportRange?.trump === strain)) return false;
  const partners = all.filter(prior => prior.seat === partnerOf(target.seat)
    && prior.call.strain !== 'NT' && !isArtificialBidAt(before, prior.index, system));
  const latest = partners.at(-1), original = partners.find(prior => prior.call.strain === strain);
  const previous = all.at(-1);
  return !!original && !!latest && !!previous && original.index < latest.index
    && (naturalSuitMinimum(before.slice(0, original.index + 1), partnerOf(target.seat), strain, system) >= 5
      || naturalSuitMinimum(before, target.seat, strain, system) >= 4)
    && latest.call.strain !== target.call.strain && !atGame(latest.call)
    && bidValue(target.call) > bidValue(previous.call) && bidValue(target.call) - bidValue(previous.call) <= 5
    && analyzeAuctionSemantics(before, target.seat, system).forcing === 'none';
}

function reverseMinorPreferenceAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || !['C', 'D'].includes(target.call.strain)) return false;
  const before = auction.slice(0, index), all = bids(before), opening = all[0], last = all.at(-1);
  return opening?.call.level === 1 && opening.seat === partnerOf(target.seat) && opening.call.strain === target.call.strain
    && !!last && last.seat === opening.seat && bidValue(target.call) - bidValue(last.call) <= 5
    && analyzeAuctionSemantics(before, target.seat, system).convention === 'reverse';
}

function weakFiveSpadeReturnAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 2 || entry.call.strain !== 'S') return false;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  return side.length === 4 && side[0].index === all[0]?.index && side[0].call.level === 1
    && ['C', 'D'].includes(side[0].call.strain) && side[1].seat === entry.seat
    && side[1].call.level === 1 && side[1].call.strain === 'S' && side[2].call.level === 2
    && ['C', 'D'].includes(side[2].call.strain) && !intervened(auction, entry.seat, side[0].index, index)
    && analyzeAuctionSemantics(auction.slice(0, index), entry.seat, system).forcing === 'none';
}

export function publicSecondaryMinorInvitationAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || !['C', 'D'].includes(target.call.strain)) return undefined;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const [opening, response, second, weakReturn] = side;
  if (side.length !== 5 || opening?.index !== all[0]?.index || opening.seat !== target.seat
    || opening.call.level !== 1 || !['C', 'D'].includes(opening.call.strain)
    || response?.call.level !== 1 || response.call.strain !== 'S'
    || second?.call.level !== 2 || second.call.strain !== target.call.strain || second.call.strain === opening.call.strain
    || !weakReturn || !weakFiveSpadeReturnAt(auction, weakReturn.index, system)
    || intervened(auction, target.seat, opening.index, index)) return undefined;
  return { original: opening.call.strain as Suit, suit: target.call.strain as Suit, minimum: 16, maximum: 18, length: 5 };
}

export function publicNTNewMinorAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 3 || !['C', 'D'].includes(entry.call.strain)) return undefined;
  const before = auction.slice(0, index), side = bids(before).filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const lastNT = side.at(-1);
  if (side.length === 2 && side[0].index === bids(before)[0]?.index && side[0].call.level === 1
    && side[0].call.strain !== 'NT' && lastNT?.seat === partnerOf(entry.seat)
    && lastNT.call.level === 1 && lastNT.call.strain === 'NT'
    && noTrumpRangeAt(before, lastNT.index, system)?.min === 12
    && noTrumpRangeAt(before, lastNT.index, system)?.max === 14
    && before.some((prior, at) => prior.seat === entry.seat && isNegativeDoubleAt(before, at)))
    return { game: false, minimum: 10, maximum: 12, length: 6 };
  if (side.length === 3 && side[0].index === bids(before)[0]?.index && side[0].call.level === 1
    && ['C', 'D'].includes(side[0].call.strain) && side[1].seat === entry.seat && side[1].call.level === 1
    && side[1].call.strain !== 'NT' && side[2].seat === side[0].seat && side[2].call.level === 1
    && side[2].call.strain === 'NT' && noTrumpRangeAt(before, side[2].index, system)?.min === 12
    && entry.call.strain !== side[0].call.strain && entry.call.strain !== side[1].call.strain
    && !intervened(auction, entry.seat, side[0].index, index))
    return { game: false, minimum: 10, maximum: 12, length: 6 };
  const reply = side.at(-1), request = side.at(-2);
  const question = request && publicNoTrumpQuestionAt(before, request.index, system);
  if (!reply || !question || question.kind === 'weak-minor-relay' || question.platform.seat !== partnerOf(entry.seat)
    || reply.seat !== question.platform.seat || reply.index <= request!.index) return undefined;
  const validAnswer = question.kind === 'transfer' ? reply.call.strain === question.target
    && reply.call.level === request!.call.level : ['D', 'H', 'S'].includes(reply.call.strain)
      && reply.call.level === request!.call.level;
  const range = noTrumpRangeAt(before, question.platform.index, system);
  if (!validAnswer || !range) return undefined;
  return { game: range.min >= 15, minimum: range.min >= 15 ? Math.max(0, 25 - range.min) : 10,
    maximum: range.min >= 15 ? 40 : 12, length: range.min >= 15 ? 5 : 6, question };
}

function twoNTMinorEscapeAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 4 || !['C', 'D'].includes(entry.call.strain)) return false;
  const side = bids(auction.slice(0, index)).filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const [platform, request, reply] = side;
  return side.length === 3 && platform.index !== bids(auction)[0]?.index && platform.call.level === 2
    && platform.call.strain === 'NT' && noTrumpRangeAt(auction, platform.index, system)?.min === 15
    && request.seat === entry.seat && publicNoTrumpQuestionAt(auction, request.index, system)?.kind === 'stayman'
    && reply.seat === platform.seat && reply.call.level === 3 && reply.call.strain === 'D';
}

function semiNTMinorInvitationShapeAt(auction: AuctionEntry[], index: number) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || target.call.strain !== 'C') return undefined;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const [opening, response, rebid] = side;
  if (side.length !== 4 || opening.index !== all[0]?.index || opening.call.level !== 1
    || (opening.call.strain !== 'H' && opening.call.strain !== 'S') || response.seat !== target.seat
    || response.call.level !== 1 || response.call.strain !== 'NT' || rebid.call.level !== 2
    || rebid.call.strain !== opening.call.strain || intervened(auction, target.seat, opening.index, index)) return undefined;
  return { primary: 'C' as const, ordinaryLength: 6 as const, secondary: 'D' as const, secondaryMinimum: 5 as const,
    originalMajor: opening.call.strain, maxOriginal: 1 as const };
}

function weakMinorContinuationAt(auction: AuctionEntry[], index: number) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || (target.call.level !== 3 && target.call.level !== 4)
    || (target.call.strain !== 'C' && target.call.strain !== 'D')) return undefined;
  const all = bids(auction.slice(0, index + 1));
  const side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const [opening, response, rebid] = side;
  if (side.length !== 4 || opening.index !== all[0]?.index || opening.call.level !== 1
    || (opening.call.strain !== 'C' && opening.call.strain !== 'D')
    || response.seat !== target.seat || response.call.level !== 1 || !major(response.call.strain)
    || rebid.seat !== opening.seat || rebid.call.level !== 2 || rebid.call.strain !== opening.call.strain
    || target.call.strain === opening.call.strain
    || auction.slice(opening.index + 1, index).some(entry => sideOf(entry.seat) !== sideOf(target.seat) && entry.call.kind !== 'pass')) return undefined;
  return target.call.level === 3 ? 'weak-minor-escape' as const : 'long-minor-invitation' as const;
}

/** The weak-two exception is identified by the enemy's public natural NT,
 * never by the responder's hidden suit quality or strength. */
function preemptNTCompetitiveResponseAt(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const target = auction[index];
  if (system !== 'sayc' || target?.call.kind !== 'bid' || target.call.level !== 3 || target.call.strain === 'NT') return false;
  const all = bids(auction.slice(0, index + 1));
  const side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const opening = side[0], previous = all.at(-2);
  if (side.length !== 2 || opening?.index !== all[0]?.index || opening.call.level !== 2
    || !(major(opening.call.strain) || opening.call.strain === 'D')) return false;
  return opening.seat !== target.seat && target.call.strain !== opening.call.strain
    && !!previous && bidValue(target.call) - bidValue(previous.call) <= 5
    && all.some(entry => entry.index > opening.index && entry.index < index
      && sideOf(entry.seat) !== sideOf(target.seat) && isNaturalNoTrumpAt(auction, entry.index, system));
}

function takeoutCompetitiveRaiseAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.strain === 'NT' || target.call.level > 3) return undefined;
  const before = auction.slice(0, index), all = bids(before), last = all.at(-1);
  const technical = before.findLastIndex((prior, at) => prior.seat === target.seat && isTakeoutDoubleAt(before, at, system));
  const answer = all.find(prior => prior.index > technical && prior.seat === partnerOf(target.seat));
  if (technical < 0 || all.some(prior => prior.seat === target.seat) || !answer
    || answer.call.strain !== target.call.strain || isArtificialBidAt(before, answer.index, system)
    || target.call.level !== answer.call.level + 1 || !last || sideOf(last.seat) === sideOf(target.seat)
    || last.index < answer.index || bidValue(target.call) - bidValue(last.call) > 5
    || before.slice(technical + 1).some(prior => prior.call.kind === 'redouble')) return undefined;
  return { answer };
}

function strongMichaelsRaiseAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || !major(target.call.strain)) return undefined;
  const before = auction.slice(0, index), all = bids(before);
  const own = all.filter(prior => prior.seat === target.seat), answer = all.findLast(prior => prior.seat === partnerOf(target.seat));
  if (own.length !== 1 || publicCallMeaningAt(before, own[0].index, system).role !== 'michaels'
    || !answer || answer.call.level !== 2 || answer.call.strain !== target.call.strain
    || publicCallMeaningAt(before, answer.index, system).role !== 'two-suit-choice'
    || all.some(prior => prior.index > answer.index && sideOf(prior.seat) !== sideOf(target.seat))) return undefined;
  return { answer };
}

function takeoutSupportInvitationAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || !major(target.call.strain)) return undefined;
  const prefix = auction.slice(0, index + 1), all = bids(prefix);
  const ownDouble = prefix.findLastIndex((entry, at) => at < index && entry.seat === target.seat && isTakeoutDoubleAt(prefix, at));
  const partner = all.findLast(entry => entry.index < index && entry.seat === partnerOf(target.seat));
  const firstAnswer = all.find(entry => entry.index > ownDouble && entry.seat === partnerOf(target.seat));
  const beforePartner = partner && all.findLast(entry => entry.index < partner.index);
  const weakTwo = all[0]?.call.level === 2 && ['D', 'H', 'S'].includes(all[0].call.strain);
  const jumpInvitation = partner?.call.level === 1 && target.call.level === 3;
  const freeAnswer = partner && all.some(entry => entry.index > ownDouble && entry.index < partner.index
    && sideOf(entry.seat) !== sideOf(target.seat));
  if (ownDouble < 0 || all.some(entry => entry.index < index && entry.seat === target.seat)
    || !partner || partner.index !== firstAnswer?.index || partner.call.strain !== target.call.strain
    || isArtificialBidAt(prefix, partner.index, system) || !beforePartner
    || bidValue(partner.call) - bidValue(beforePartner.call) > 5
    || !(target.call.level === partner.call.level + 1 || jumpInvitation)
    || !jumpInvitation && bidValue(target.call) - bidValue(partner.call) > 5
    || !(partner.call.level === 1 || partner.call.level === 2 && (weakTwo || freeAnswer))
    || prefix.some((entry, at) => at > ownDouble && at < index
      && sideOf(entry.seat) !== sideOf(target.seat) && (entry.call.kind === 'redouble'
        || at > partner.index && entry.call.kind !== 'pass'))) return undefined;
  return { min: jumpInvitation ? 19 : weakTwo ? 18 : 16, max: jumpInvitation ? 21 : weakTwo ? 20 : 18, answer: partner, jump: jumpInvitation };
}

/** Ordinary 1NT rebids do not enable new-minor forcing in this card. */
function ntMinorCorrectionAt(auction: AuctionEntry[], index: number): boolean {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 2
    || (target.call.strain !== 'C' && target.call.strain !== 'D')) return false;
  const all = bids(auction.slice(0, index + 1));
  const side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const [opening, response, rebid] = side;
  return side.length === 4 && opening.index === all[0]?.index && opening.call.level === 1
    && opening.call.strain !== 'NT' && response.seat === target.seat && response.call.level === 1
    && response.call.strain !== 'NT' && rebid.seat === opening.seat && rebid.call.level === 1
    && rebid.call.strain === 'NT' && target.call.strain !== opening.call.strain
    && target.call.strain !== response.call.strain
    && !auction.slice(opening.index + 1, index).some(entry => sideOf(entry.seat) !== sideOf(target.seat) && entry.call.kind !== 'pass');
}

function transferredGameTrumpBefore(auction: AuctionEntry[], index: number, system: BiddingSystem): Suit | undefined {
  const target = auction[index];
  if (!target) return undefined;
  const side = bids(auction.slice(0, index)).filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  for (let at = 0; at < side.length - 2; at++) {
    const platform = side[at], transfer = side[at + 1], acceptance = side[at + 2];
    if (!isNaturalNoTrumpAt(auction, platform.index, system) || platform.call.level > 2
      || !(at === 0 || at === 2 && side[0].call.level === 2 && side[0].call.strain === 'C')
      || transfer.seat === platform.seat || transfer.call.level !== platform.call.level + 1
      || !isArtificialBidAt(auction, transfer.index, system)) continue;
    const trump = transfer.call.strain === 'D' ? 'H' : transfer.call.strain === 'H' ? 'S' : undefined;
    if (trump && acceptance.call.strain === trump && acceptance.call.level === transfer.call.level
      && side.slice(at + 3).some(entry => entry.seat === platform.seat && entry.call.strain === trump
        && entry.call.level === 4 && !isArtificialBidAt(auction, entry.index, system))) return trump;
  }
  return undefined;
}

function naturalStaymanAnswerAt(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || !major(target.call.strain)) return false;
  const side = bids(auction.slice(0, index + 1)).filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const at = side.length - 1, platform = side[at - 2], inquiry = side[at - 1];
  return !!platform && !!inquiry && (at === 2 || at === 4 && side[0].call.level === 2 && side[0].call.strain === 'C')
    && platform.seat === target.seat && inquiry.seat !== target.seat && inquiry.call.strain === 'C'
    && inquiry.call.level === platform.call.level + 1
    && (target.call.level === inquiry.call.level || target.call.level === inquiry.call.level + 1
      && bids(auction.slice(inquiry.index + 1, index)).some(entry => sideOf(entry.seat) !== sideOf(target.seat))
      && bidValue(target.call) - bidValue(bids(auction.slice(0, index)).at(-1)!.call) <= 5)
    && isNaturalNoTrumpAt(auction, platform.index, system) && isArtificialBidAt(auction, inquiry.index, system);
}

/** The latest same-side support/control statement chooses an agreed fit.
 * Artificial support cues name the partner's trump, not their displayed suit. */
function publicAgreedTrumpBefore(auction: AuctionEntry[], index: number, system: BiddingSystem): Suit | undefined {
  const question = auction[index];
  if (!question) return undefined;
  const before = auction.slice(0, index);
  const own = publicPlayerConstraints(before, question.seat, system);
  const partner = publicPlayerConstraints(before, partnerOf(question.seat), system);
  const prior = bids(before).filter(entry => sideOf(entry.seat) === sideOf(question.seat));
  for (const entry of prior.toReversed()) {
    const meaning = publicCallMeaningAt(before, entry.index, system);
    const trump = meaning.agreedTrump ?? meaning.supportRange?.trump
      ?? (!meaning.artificial && entry.call.strain !== 'NT' ? entry.call.strain as Suit : undefined);
    if (trump && own.suitMinimums[trump] + partner.suitMinimums[trump] >= 8) return trump;
  }
  return undefined;
}

export function publicKeycardTrumpAt(auction: AuctionEntry[], questionIndex: number, system: BiddingSystem): Strain | undefined {
  const question = auction[questionIndex];
  if (question?.call.kind !== 'bid' || question.call.level !== 4 || question.call.strain !== 'NT'
    || !isArtificialBidAt(auction, questionIndex, system)) return undefined;
  const publicAgreement = publicAgreedTrumpBefore(auction, questionIndex, system);
  if (publicAgreement) return publicAgreement;
  const prior = bids(auction).filter(entry => entry.index < questionIndex && sideOf(entry.seat) === sideOf(question.seat));
  const natural = prior.filter(entry => !isArtificialBidAt(auction, entry.index, system));
  const agreed = natural.findLast(entry => entry.call.strain !== 'NT'
    && natural.some(other => other.seat !== entry.seat && other.call.strain === entry.call.strain));
  if (agreed) return agreed.call.strain;
  const minorTry = natural.findLast(entry => entry.seat === partnerOf(question.seat) && naturalMinorSlamTryAt(auction, entry.index));
  if (minorTry) return minorTry.call.strain;
  if (prior[0]?.call.level === 1 && major(prior[0].call.strain) && prior[1]?.call.level === 2
    && prior[1].call.strain === 'NT' && isArtificialBidAt(auction, prior[1].index, system)) return prior[0].call.strain;
  const transferredTrump = transferredGameTrumpBefore(auction, questionIndex, system);
  if (transferredTrump) return transferredTrump;
  if (natural.some(entry => entry.call.strain === 'NT')) return undefined;
  // A public keycard ask after partner's natural suit sets that suit as
  // trump. Waiting responses and negative artificials are excluded above.
  return natural.findLast(entry => entry.seat === partnerOf(question.seat) && entry.call.strain !== 'NT')?.call.strain;
}

function keycardContinuationAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid') return undefined;
  const side = bids(auction.slice(0, index + 1)).filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const askPosition = side.findLastIndex(prior => prior.index < index && prior.call.level === 4 && prior.call.strain === 'NT'
    && isArtificialBidAt(auction.slice(0, prior.index + 1), prior.index, system));
  if (askPosition < 0) return undefined;
  const ask = side[askPosition], reply = side[askPosition + 1];
  const trump = publicKeycardTrumpAt(auction, ask.index, system);
  if (!trump || trump === 'NT' || !reply || reply.call.level !== 5 || reply.call.strain === 'NT') return undefined;
  const offset = side.length - 1 - askPosition;
  if (offset === 1) return { role: 'keycard-answer' as const, trump };
  if (offset === 2 && entry.seat === ask.seat) {
    if (entry.call.strain === trump && entry.call.level === 5) return { role: 'keycard-signoff' as const, trump };
    if (entry.call.strain === 'NT' && entry.call.level === 5) return { role: 'king-ask' as const, trump };
    if (reply.call.strain === 'C' || reply.call.strain === 'D') {
      const lowestNonTrump = (['C', 'D', 'H', 'S'] as Suit[]).find(suit => suit !== trump
        && bidValue({ kind: 'bid', level: 5, strain: suit }) > bidValue(reply.call));
      if (lowestNonTrump && entry.call.level === 5 && entry.call.strain === lowestNonTrump
        && bidValue(entry.call) < bidValue({ kind: 'bid', level: 5, strain: trump }))
        return { role: 'queen-ask' as const, trump };
    }
  }
  const continuation = side[askPosition + 2];
  if (offset === 3 && continuation && entry.seat === reply.seat) {
    const role = keycardContinuationAt(auction, continuation.index, system)?.role;
    if (role === 'king-ask') return { role: 'king-answer' as const, trump };
    if (role === 'queen-ask') return { role: 'queen-answer' as const, trump };
  }
  return undefined;
}

/** Infer artificiality from the call's own prefix, without future hands or
 * calls. The recursion through earlier doubles always uses a shorter prefix. */
function strongSecondNegativeAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  if (system !== 'sayc' && system !== 'two-over-one') return false;
  const target = auction[index];
  if (target?.call.kind !== 'bid') return false;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  return side.length === 4 && side[0].index === all[0]?.index && side[0].call.level === 2 && side[0].call.strain === 'C'
    && side[1].call.level === 2 && side[1].call.strain === 'D' && side[1].seat === target.seat
    && target.call.level === 3 && (major(side[2].call.strain) ? target.call.strain === 'C'
      : side[2].call.strain === 'C' ? target.call.strain === 'D' : side[2].call.strain === 'D' && target.call.strain === 'NT');
}

/** Recognize the request from its public prefix alone. The forcing-state
 * interpreter also needs this fact, so it must not call back into that state. */
function weakTwoFeatureInquiryAt(auction: AuctionEntry[], index: number): boolean {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 2 || target.call.strain !== 'NT') return false;
  const prefix = auction.slice(0, index + 1), all = bids(prefix);
  const own = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  return own.length === 2 && own[0].index === all[0]?.index && own[0].call.level === 2
    && ['D', 'H', 'S'].includes(own[0].call.strain) && target.seat !== own[0].seat
    && !intervened(prefix, target.seat, own[0].index, index);
}

/** The analogous weak jump-overcall question also requires a clear path to
 * the request. An enemy X or bid before 2NT does not start this convention. */
function weakJumpFeatureInquiryAt(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const target = auction[index];
  if (system !== 'sayc' || target?.call.kind !== 'bid' || target.call.level !== 2 || target.call.strain !== 'NT') return false;
  const prefix = auction.slice(0, index + 1), all = bids(prefix), opening = all[0];
  const own = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat)), overcall = own[0];
  return own.length === 2 && opening?.call.level === 1 && opening.call.strain !== 'NT'
    && sideOf(opening.seat) !== sideOf(target.seat) && overcall?.index === opening.index + 1
    && overcall.call.level === 2 && overcall.call.strain !== 'NT' && overcall.call.strain !== opening.call.strain
    && bidValue(overcall.call) - bidValue(opening.call) > 5 && target.seat === partnerOf(overcall.seat)
    && !intervened(prefix, target.seat, overcall.index, index);
}

export function isArtificialBidAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): boolean {
  const precision = precisionConventionAt(auction,index,system);
  if (precision) return !['club-opening','club-answer'].includes(precision.stage);
  const target = auction[index];
  if (target?.call.kind !== 'bid') return false;
  if (strongSecondNegativeAt(auction, index, system)) return true;
  const ntQuestion = publicNoTrumpQuestionAt(auction, index, system);
  if (ntQuestion) return true;
  const previous = bids(auction.slice(0, index)).findLast(entry => entry.seat === partnerOf(target.seat));
  const denial = previous && publicNoTrumpQuestionAt(auction.slice(0, index), previous.index, system);
  if (denial?.kind === 'stayman' && target.seat === denial.platform.seat
    && target.call.strain === 'D' && target.call.level === denial.platform.call.level + 1) return true;
  const minorRelay = publicWeakMinorRelayAt(auction, index, system);
  if (minorRelay) return false;
  if (isDelayedTakeoutSuitAnswer(auction, index)) return false;
  if (weakDoubledEscapeAt(auction, index)) return false;
  if (publicNTNewMinorAt(auction, index, system)) return false;
  if (publicStrongTakeoutStopCueAt(auction, index, system)) return true;
  if (negativeDoubleGameCueAt(auction, index, system)) return true;
  if (publicControlCueAt(auction, index, system)) return true;
  if (naturalStaymanAnswerAt(auction, index, system)) return false;
  if (staymanContinuationAt(auction, index, system)) return false;
  if (system === 'sayc' && weakMinorContinuationAt(auction, index)) return false;
  const keycardContinuation = keycardContinuationAt(auction, index, system);
  if (keycardContinuation?.role === 'keycard-answer') return target.call.strain !== keycardContinuation.trump;
  if (keycardContinuation?.role === 'keycard-signoff') return false;
  if (keycardContinuation?.role === 'queen-ask' || keycardContinuation?.role === 'king-ask') return true;
  if (keycardContinuation?.role === 'queen-answer' || keycardContinuation?.role === 'king-answer')
    return target.call.strain !== keycardContinuation.trump;
  const targetBid = target.call;
  const prefix = auction.slice(0, index + 1), all = bids(prefix);
  const own = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const preceding = own.at(-2);
  if (weakTwoFeatureInquiryAt(prefix, index)) return true;
  if (weakJumpFeatureInquiryAt(prefix, index, system)) return true;
  if (own.length === 3 && own[0].index === all[0]?.index && own[0].call.level === 2
    && ['D', 'H', 'S'].includes(own[0].call.strain) && target.seat === own[0].seat
    && own[1].call.level === 2 && own[1].call.strain === 'NT' && isArtificialBidAt(prefix, own[1].index, system)
    && targetBid.level === 3 && targetBid.strain !== 'NT' && targetBid.strain !== own[0].call.strain) return true;
  const ntBeforeInquiry = own.at(-3);
  if (major(targetBid.strain) && preceding?.call.strain === 'C'
    && targetBid.level === preceding.call.level && ntBeforeInquiry?.call.strain === 'NT'
    && preceding.call.level === ntBeforeInquiry.call.level + 1
    && noTrumpRangeAt(prefix, ntBeforeInquiry.index, system)) return false;
  const jacoby = (system === 'sayc' || system === 'two-over-one') && own[0]?.call.level === 1
    && own[0].index === all[0]?.index
    && major(own[0].call.strain) && own[1]?.call.level === 2 && own[1].call.strain === 'NT'
    && !intervened(prefix, target.seat, own[0].index, own[1].index)
    && !passedBefore(prefix, own[1].seat, own[0].index);
  if (jacoby && (own.length === 2 || own.length === 3 && targetBid.level === 3
    && targetBid.strain !== 'NT' && targetBid.strain !== own[0].call.strain)) return true;
  if (targetBid.level === 4 && targetBid.strain === 'NT') {
    const prior = own.slice(0, -1);
    if (publicAgreedTrumpBefore(prefix, index, system)) return true;
    if (prior.findLast(entry => entry.seat === partnerOf(target.seat) && naturalMinorSlamTryAt(prefix, entry.index))) return true;
    const agreedSuit = prior.some(entry => entry.call.strain !== 'NT'
      && prior.some(other => other.seat !== entry.seat && other.call.strain === entry.call.strain
        && !isArtificialBidAt(prefix, entry.index, system) && !isArtificialBidAt(prefix, other.index, system)));
    const naturalNt = prior.some(entry => entry.call.strain === 'NT'
      && !isArtificialBidAt(prefix, entry.index, system));
    const partnerSuit = prior.findLast(entry => entry.seat === partnerOf(target.seat) && entry.call.strain !== 'NT'
      && !isArtificialBidAt(prefix, entry.index, system));
    return jacoby || agreedSuit || !!transferredGameTrumpBefore(prefix, index, system) || !naturalNt && !!partnerSuit;
  }
  if (targetBid.level === 5 && targetBid.strain !== 'NT' && preceding?.call.level === 4
    && preceding.call.strain === 'NT') {
    const trump = publicKeycardTrumpAt(prefix, preceding.index, system);
    // The 1430 reply still conveys keycards, but a reply in the agreed trump
    // is also a playable contract which the asker may leave at this level.
    return isArtificialBidAt(prefix, preceding.index, system) && targetBid.strain !== trump;
  }
  if (targetBid.strain !== 'NT'
    && all.some(entry => entry.index < index && sideOf(entry.seat) !== sideOf(target.seat)
      && entry.call.strain === targetBid.strain && !isArtificialBidAt(prefix, entry.index, system))
    && !own.slice(0, -1).some(entry => entry.call.strain === targetBid.strain)) return true;
  if (preceding?.seat === partnerOf(target.seat) && preceding.call.strain === 'NT'
    && preceding.call.level <= 3 && target.call.level === preceding.call.level + 1
    && (['C', 'D', 'H'].includes(target.call.strain)
      || preceding.call.level === 1 && target.call.strain === 'S')
    && publicNoTrumpQuestionAt(prefix, index, system)
    && (own.length === 2 || own.length === 4 && own[0].call.strain === 'C'
      && (own[0].call.level === 2 || system === 'precision' && own[0].call.level === 1))
    && !prefix.slice(preceding.index + 1, index).some(entry => sideOf(entry.seat) !== sideOf(target.seat)
      && entry.call.kind !== 'pass')) return true;
  return analyzeAuctionSemantics(prefix, partnerOf(target.seat), system).currentContractArtificial;
}

/** Shared classification for decisions and hover text. Direct defense to a
 * two-suiter is a strength double; a later support cue is a lead request. */
export function classifyDoubleAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): DoubleMeaning | undefined {
  const entry = auction[index];
  if (entry?.call.kind !== 'double') return undefined;
  const before = bids(auction.slice(0, index)), opening = before[0], target = before.at(-1);
  if (target && isArtificialBidAt(auction, target.index, system)) {
    if (opening?.call.level === 1
      && target.index === opening.index + 1 && index === target.index + 1
      && entry.seat === partnerOf(opening.seat) && target.call.level === 2
      && (opening.call.strain !== 'NT' && target.call.strain === opening.call.strain
        || target.call.strain === 'NT')) return 'two-suit-strength';
    return 'lead-directing';
  }
  if (isNegativeDoubleAt(auction, index)) return 'negative';
  if (isTakeoutDoubleAt(auction, index, system)) return 'takeout';
  return 'penalty';
}

function isTwoOverOne(opening: BidEntry, response: BidEntry, auction: AuctionEntry[]) {
  const o = opening.call, r = response.call;
  return o.level === 1 && o.strain !== 'NT' && r.level === 2 && r.strain !== 'NT' && r.strain !== o.strain && bidValue(r) - bidValue(o) <= 5 && !passedBefore(auction, response.seat, opening.index) && !intervened(auction, opening.seat, opening.index, response.index);
}

function naturalRebidRange(system: BiddingSystem, opening: Bid, rebid: Bid): PointRange | undefined {
  if (rebid.strain !== 'NT') return undefined;
  if (system === 'two-over-one' || system === 'sayc') {
    // Rule-of-20 openings include genuine 12-HCP hands. A public range must
    // include that floor instead of inventing an extra point for partner.
    if (opening.level === 1 && opening.strain !== 'NT' && rebid.level === 1) return { min: 12, max: 14 };
    if (opening.level === 1 && opening.strain !== 'NT' && rebid.level === 2) return { min: 18, max: 19 };
  }
  if (system === 'precision' && opening.level === 1 && opening.strain !== 'C' && opening.strain !== 'NT' && rebid.level === 1) return { min: 11, max: 12 };
  return undefined;
}

/** Infer the range promised by one specific no-trump call. Invitational responses are deliberately not ranges. */
export function noTrumpRangeAt(auction: AuctionEntry[], entryIndex: number, system: BiddingSystem): PointRange | undefined {
  const prefix = auction.slice(0, entryIndex + 1), target = prefix[entryIndex];
  const interrupted = target?.call.kind === 'bid' && target.call.strain === 'NT' && target.call.level === 2
    ? publicInterruptedStaymanBefore(prefix.slice(0, -1), target.seat, system) : undefined;
  if (interrupted) return noTrumpRangeAt(prefix, interrupted.platform.index, system);
  if (target?.call.kind === 'bid' && target.call.strain === 'NT') {
    const requester = bids(prefix.slice(0, -1)).findLast(entry => entry.seat === partnerOf(target.seat));
    const pending = requester && publicNoTrumpQuestionAt(prefix.slice(0, -1), requester.index, system);
    if (pending?.kind === 'stayman' && pending.platform.seat === target.seat
      && !prefix.slice(requester!.index + 1, entryIndex).some(entry => sideOf(entry.seat) !== sideOf(target.seat)
        && entry.call.kind === 'bid')) return undefined;
  }
  let range = computeNoTrumpRangeAt(prefix, entryIndex, system);
  if (!range && target?.call.kind === 'bid' && target.call.strain === 'NT' && target.call.level === 2
    && analyzeAuctionSemantics(prefix.slice(0, -1), target.seat, system).convention === 'reverse') range = { min: 0, max: 40 };
  if (target?.call.kind !== 'bid' || target.call.strain !== 'NT') return range;
  const prior = publicPlayerConstraints(prefix.slice(0, -1), target.seat, system).hcpRange;
  const previousNT = bids(prefix.slice(0, -1)).findLast(entry => entry.seat === target.seat && entry.call.strain === 'NT'
    && noTrumpRangeAt(prefix, entry.index, system));
  if (target.call.level === 3 && previousNT && !staymanNTDecisionAt(prefix, entryIndex, system)) {
    const previousRange = noTrumpRangeAt(prefix, previousNT.index, system)!;
    const partner = bids(prefix.slice(0, -1)).findLast(entry => entry.seat === partnerOf(target.seat));
    const invitation = partner?.call.level === 2 && partner.call.strain === 'NT'
      ? noTrumpRangeAt(prefix, partner.index, system) : undefined;
    const partnerFloor = publicPlayerConstraints(prefix.slice(0, -1), partnerOf(target.seat), system).hcpRange?.min;
    range = invitation ? { min: 25 - invitation.min, max: previousRange.max }
      : { min: Math.max(previousRange.min, partnerFloor === undefined ? 0 : 25 - partnerFloor), max: previousRange.max };
  }
  return range ? { min: Math.max(range.min, prior?.min ?? 0), max: Math.min(range.max, prior?.max ?? 40) } : undefined;
}

function computeNoTrumpRangeAt(auction: AuctionEntry[], entryIndex: number, system: BiddingSystem): PointRange | undefined {
  const target = auction[entryIndex];
  if (!target || target.call.kind !== 'bid' || target.call.strain !== 'NT') return undefined;
  const preceding = bids(auction).filter(entry => entry.index <= entryIndex);
  const partnership = preceding.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const position = partnership.findIndex(entry => entry.index === entryIndex);
  const globalOpening = preceding[0], ourOpening = partnership[0];
  if (position === 1 && ourOpening?.index === globalOpening?.index && ourOpening.call.level === 3
    && ourOpening.call.strain !== 'NT' && target.seat !== ourOpening.seat && target.call.level === 3)
    return { min: 16, max: 40 };
  if (position === 3 && ourOpening?.index === globalOpening?.index && ourOpening.call.level === 2
    && ['D', 'H', 'S'].includes(ourOpening.call.strain) && target.seat === partnership[1]?.seat
    && target.call.level === 3 && partnership[1].call.level === 3 && ['C', 'D'].includes(partnership[1].call.strain)
    && partnership[2].call.level === 3 && partnership[2].call.strain === ourOpening.call.strain)
    return { min: 19, max: 40 };
  const firstAdvance = position === 1 && ourOpening && globalOpening
    && ourOpening.index !== globalOpening.index && ourOpening.call.level === 1 && ourOpening.call.strain !== 'NT'
    && !isArtificialBidAt(auction, ourOpening.index, system)
    && !auction.slice(0, entryIndex).some((entry, at) => sideOf(entry.seat) === sideOf(target.seat)
      && isTakeoutDoubleAt(auction, at));
  if (firstAdvance && target.seat !== ourOpening.seat)
    return target.call.level === 1 ? { min: 8, max: 11 } : target.call.level === 2 ? { min: 12, max: 14 } : undefined;
  const genuineOpening = ourOpening?.index === globalOpening?.index && ourOpening?.call.level === 1
    && ourOpening.call.strain !== 'NT';
  if (genuineOpening && target.seat !== ourOpening.seat && target.call.level === 1 && position >= 2
    && partnership.some(entry => entry.index < entryIndex && entry.seat === target.seat
      && entry.call.level === 1 && entry.call.strain !== 'NT' && !isArtificialBidAt(auction, entry.index, system)))
    return { min: 6, max: 10 };
  const ownNegative = genuineOpening && auction.some((entry, at) => at < entryIndex && entry.seat === target.seat
    && isNegativeDoubleAt(auction, at));
  const partnerMinimumNT = partnership.findLast(entry => entry.index < entryIndex && entry.seat === partnerOf(target.seat)
    && entry.call.level === 1 && entry.call.strain === 'NT');
  if (ownNegative && target.call.level === 2 && partnerMinimumNT
    && noTrumpRangeAt(auction, partnerMinimumNT.index, system)?.min === 12) return { min: 11, max: 12 };
  const precision = precisionConventionAt(auction,entryIndex,system);
  if (precision?.stage==='club-answer') return {min:14,max:15};
  if (partnership[0]?.seat === target.seat && partnership[0].call.level === 2
    && partnership[0].call.strain === 'C' && position === 1
    && auction.some((_, index) => strongClubNegativePassAt(auction, index, system)))
    return target.call.level === 2 ? { min: 22, max: 24 } : target.call.level === 3 ? { min: 25, max: 37 } : undefined;
  if (system==='precision' && partnership[0]?.index===preceding[0]?.index && partnership[0].call.level===1
    && partnership[0].call.strain==='C') {
    if (position === 3 && target.seat === partnership[1]?.seat && target.call.level === 2
      && partnership[1].call.level === 1 && partnership[1].call.strain === 'D'
      && partnership[2]?.call.level === 1 && partnership[2].call.strain === 'NT'
      && noTrumpRangeAt(auction, partnership[2].index, system)?.min === 16
      && !intervened(auction, target.seat, partnership[0].index, entryIndex)) return { min: 7, max: 8 };
    if(position===1) return target.call.level===1 ? {min:8,max:13} : target.call.level===2 ? {min:14,max:40} : undefined;
    if(position===2 && partnership[1]?.call.strain==='NT' && target.call.level===3) return {min:16,max:40};
  }
  const staymanDecision = staymanNTDecisionAt(auction, entryIndex, system);
  if (staymanDecision) return staymanDecision.range;
  const firstNT = partnership[0], lastPartner = partnership.slice(0, position).findLast(prior => prior.seat !== target.seat);
  if (lastPartner && target.call.level <= 3 && target.seat === ourOpening?.seat
    && preceding.some(prior => prior.index < lastPartner.index && sideOf(prior.seat) !== sideOf(target.seat)
      && prior.call.strain === lastPartner.call.strain && !isArtificialBidAt(auction, prior.index, system))
    && publicCallMeaningAt(auction.slice(0, entryIndex), lastPartner.index, system).role === 'cue') {
    const ownRange = publicPlayerConstraints(auction.slice(0, entryIndex), target.seat, system).hcpRange;
    const partnerFloor = publicPlayerConstraints(auction.slice(0, entryIndex), lastPartner.seat, system).hcpRange?.min ?? 0;
    return { min: Math.max(ownRange?.min ?? 0, target.call.level === 3 ? 25 - partnerFloor : 0), max: ownRange?.max ?? 40 };
  }
  if (target.call.level === 3 && firstNT?.seat === target.seat && firstNT.call.strain === 'NT'
    && firstNT.call.level === 1 && lastPartner?.call.strain === 'NT' && lastPartner.call.level === 2
    && position >= 2) {
    const platformRange = noTrumpRangeAt(auction, firstNT.index, system);
    const inviteRange = noTrumpRangeAt(auction, lastPartner.index, system);
    if (platformRange && inviteRange && !isArtificialBidAt(auction, lastPartner.index, system))
      return { min: 25 - inviteRange.min, max: platformRange.max };
  }
  const ownTakeout = auction.findLastIndex((entry, index) => index < entryIndex
    && entry.seat === target.seat && isTakeoutDoubleAt(auction, index));
  if (system === 'sayc' && ownTakeout >= 0 && !preceding.some(entry => entry.index > ownTakeout
    && entry.index < entryIndex && entry.seat === target.seat)) {
    const answer = preceding.find(entry => entry.index > ownTakeout && entry.seat === partnerOf(target.seat));
    if (answer && isArtificialBidAt(auction, answer.index, system)) return undefined;
    const previous = preceding.at(-2)?.call;
    const jumped = previous && bidValue(target.call) - bidValue(previous) > 5;
    return target.call.level === 2 && jumped ? { min: 21, max: 22 }
      : target.call.level <= 2 ? { min: 18, max: 20 } : undefined;
  }
  // Compulsory stopper/shape answers are not voluntary 18–19 jump rebids.
  if (position === 4 && partnership[0]?.seat === target.seat
    && partnership[0].index === preceding[0].index && fourthSuit(partnership.slice(0, 4))
    && !passedBefore(auction, partnership[3].seat, partnership[0].index)) {
    const last = preceding.at(-2);
    const cheapest = last && [1, 2, 3, 4, 5, 6, 7].find(level =>
      bidValue({ kind: 'bid', level, strain: 'NT' }) > bidValue(last.call));
    const reverse = reverseByOpener(partnership.slice(0, 3), auction);
    const rebid = partnership[2], beforeRebid = preceding.findLast(prior => prior.index < rebid.index);
    const strongJump = rebid.call.strain !== partnership[0].call.strain && rebid.call.strain !== partnership[1].call.strain
      && beforeRebid && bidValue(rebid.call) - bidValue(beforeRebid.call) > 5;
    // A forced answer cannot erase a publicly promised reverse or jump shift.
    if (target.call.level <= 3 && (reverse || strongJump)) return { min: strongJump ? 19 : 17, max: 21 };
    return target.call.level <= 3 ? target.call.level === cheapest
      ? { min: 12, max: 14 } : { min: 15, max: 21 } : undefined;
  }
  if (position === 3 && partnership[1]?.seat === target.seat
    && reverseByOpener(partnership.slice(0, 3), auction) && target.call.level === 2)
    return { min: 6, max: 10 };
  if (system === 'sayc' && partnership[0]?.index === preceding[0]?.index
    && partnership[0].seat === target.seat && partnership[0].call.level === 1
    && partnership[0].call.strain !== 'NT' && position === 1 && target.call.level === 2
    && !auction.some((prior, at) => at < entryIndex && prior.seat === partnerOf(target.seat)
      && isNegativeDoubleAt(auction, at))) {
    const enemyNT = preceding.some(prior => prior.index < entryIndex && sideOf(prior.seat) !== sideOf(target.seat)
      && prior.call.strain === 'NT' && isBalancedNoTrumpAt(auction, prior.index, system));
    return enemyNT ? publicOpenerNTOverNTAt(auction, entryIndex, system) ? { min: 19, max: 21 } : undefined
      : { min: 18, max: 19 };
  }
  if (position === 0) {
    const opposingOpening = preceding[0];
    if (opposingOpening?.index !== entryIndex) {
      if (system !== 'sayc') return undefined;
      const ownDouble = auction.slice(0, entryIndex).some((entry, index) => entry.seat === target.seat && isTakeoutDoubleAt(auction, index));
      const partnerDouble = auction.slice(0, entryIndex).some((entry, index) => entry.seat === partnerOf(target.seat) && isTakeoutDoubleAt(auction, index));
      if (ownDouble) {
        const partnerResponse = preceding.find(entry => entry.seat === partnerOf(target.seat));
        // A cue forces a description; the cheapest NT answer is not the
        // doubler's voluntary strong-NT rebid. This card has not subdivided
        // the forced NT ranges, so do not invent 18–20 or 21–22.
        if (partnerResponse && preceding.some(entry => entry.index < partnerResponse.index
          && sideOf(entry.seat) !== sideOf(target.seat) && entry.call.strain === partnerResponse.call.strain)) return undefined;
        const previous = preceding.at(-2)?.call;
        const jump = previous && bidValue(target.call) - bidValue(previous) > 5;
        return target.call.level === 2 && jump && partnerResponse?.call.strain !== opposingOpening.call.strain
          ? { min: 21, max: 22 } : { min: 18, max: 20 };
      }
      if (partnerDouble) return target.call.level === 1 ? { min: 6, max: 10 }
        : target.call.level === 2 ? { min: 11, max: 12 } : target.call.level === 3 ? { min: 13, max: 15 } : undefined;
      if (opposingOpening.call.strain === 'NT') return undefined;
      // The two-suiter 2NT is artificial; it never promises 20-21 balanced.
      if (opposingOpening.call.level === 1 && target.call.level === 2) return undefined;
      const between = auction.slice(opposingOpening.index + 1, entryIndex);
      const balancing = between.length === 2 && between.every(entry => entry.call.kind === 'pass');
      if (target.call.level === 1) return balancing ? { min: 11, max: 14 } : { min: 15, max: 18 };
      if (opposingOpening.call.level >= 2 && target.call.level <= 3) return { min: 15, max: 18 };
      return undefined;
    }
    if (target.call.level === 1) return system === 'precision' ? { min: 13, max: 15 } : { min: 15, max: 17 };
    if (target.call.level === 2) return system === 'precision' ? { min: 22, max: 23 } : { min: 20, max: 21 };
    if (target.call.level === 3 && system === 'sayc') return { min: 25, max: 27 };
    return undefined;
  }
  const opening = partnership[0]?.call, response = partnership[1]?.call;
  if (partnership[0]?.call.level === 1 && partnership[0].call.strain === 'NT'
    && noTrumpRangeAt(auction, partnership[0].index, system) && target.seat !== partnership[0].seat
    && target.call.level === 2 && position >= 1 && position <= 3)
    return partnership[0].index !== preceding[0].index
      && noTrumpRangeAt(auction, partnership[0].index, system)?.min === 11 ? { min: 11, max: 12 }
      : system === 'precision' ? { min: 10, max: 11 } : { min: 8, max: 9 };
  if (system === 'sayc' && position === 1 && partnership[0].index === preceding[0].index
    && opening.level === 1 && opening.strain !== 'NT' && target.call.level <= 2
    && target.seat !== partnership[0].seat && intervened(auction, target.seat, partnership[0].index, entryIndex))
    return target.call.level === 1 ? { min: 6, max: 10 } : { min: 11, max: 12 };
  // Responder's natural NT continuation retains the same point promise after
  // additional natural descriptions or a fulfilled fourth-suit inquiry. The
  // forcing reverse answer above remains its distinct 6–10 negative range.
  if ((system === 'sayc' || system === 'two-over-one') && position >= 3
    && preceding[0].index === partnership[0].index && opening.level === 1 && opening.strain !== 'NT'
    && partnership[1].seat !== partnership[0].seat && target.seat === partnership[1].seat
    && response.strain !== 'NT' && (response.level === 1
      || response.level === 2 && intervened(auction, target.seat, partnership[0].index, partnership[1].index))
    && partnership[2].seat === partnership[0].seat && partnership[2].call.level <= 2
    && (partnership[2].call.strain !== 'NT' || partnership[2].call.level === 1)) {
    if (target.call.level === 1) return { min: 6, max: 10 };
    if (target.call.level === 2) return { min: 11, max: 12 };
  }
  if ((system === 'sayc' || system === 'two-over-one') && position >= 3 && target.call.level === 2
    && partnership[0]?.index === preceding[0]?.index && target.seat === partnership[1]?.seat
    && opening.level === 1 && opening.strain !== 'NT' && response.level === 2 && response.strain !== 'NT'
    && passedBefore(auction, target.seat, partnership[0].index)
    && !intervened(auction, target.seat, partnership[0].index, entryIndex)) return { min: 11, max: 12 };
  if ((system === 'sayc' || system === 'two-over-one') && position === 1
    && preceding[0].index === partnership[0].index && opening.level === 1 && major(opening.strain)
    && target.call.level === 1 && !intervened(auction, target.seat, partnership[0].index, entryIndex))
    return { min: 5, max: 12 };
  if ((system === 'sayc' || system === 'two-over-one') && position === 1
    && preceding[0].index === partnership[0].index && opening.level === 1 && major(opening.strain)
    && target.call.level === 2 && passedBefore(auction, target.seat, partnership[0].index)
    && !intervened(auction, target.seat, partnership[0].index, entryIndex)) return { min: 11, max: 12 };
  if (system === 'sayc' && opening.level === 1 && opening.strain !== 'NT'
    && target.seat === partnership[0].seat && position === 1
    && auction.some((entry, at) => at > partnership[0].index && at < entryIndex
      && entry.seat === partnerOf(target.seat) && isNegativeDoubleAt(auction, at))) {
    const previous = preceding.at(-2)?.call;
    const jumped = previous && bidValue(target.call) - bidValue(previous) > 5;
    // Over 2H/2S, a forced cheapest 2NT answer cannot promise the strength
    // of an unforced jump over a one-level overcall.
    const enemyOvercall = preceding.find(entry => entry.index > partnership[0].index && entry.index < entryIndex
      && sideOf(entry.seat) !== sideOf(target.seat));
    return target.call.level === 1 ? { min: 12, max: 14 }
      : target.call.level === 2 ? jumped ? { min: 18, max: 19 } : { min: 12, max: 18 }
      : target.call.level === 3 ? { min: enemyOvercall && enemyOvercall.call.level >= 2 ? 17 : 19, max: 21 } : undefined;
  }
  if (system === 'sayc' && preceding[0].index === partnership[0].index && opening.level === 1
    && opening.strain !== 'NT' && target.seat === partnership[0].seat && position >= 2
    && target.call.level === 2 && partnership.filter(entry => entry.seat === target.seat).length >= 3
    && !partnership.slice(0, position).some(entry => entry.seat === target.seat && entry.call.strain === 'NT')
    && !isTwoOverOne(partnership[0], partnership[1], auction)) return { min: 18, max: 19 };
  if (position === 1 && (system === 'sayc') && preceding[0].index === partnership[0].index
    && opening.level === 1 && (opening.strain === 'C' || opening.strain === 'D')
    && !intervened(auction, target.seat, partnership[0].index, entryIndex)) {
    if (target.call.level === 1) return { min: 6, max: 10 };
    if (target.call.level === 2) return { min: 11, max: 12 };
    // Usually 13–15; stronger hands without an honest natural new suit may
    // also place the game, so this is not a fixed 15-HCP upper limit.
    if (target.call.level === 3) return { min: 13, max: 40 };
  }
  if (position === 2 && partnership[0]?.seat === target.seat && partnership[1]?.seat !== target.seat) {
    // A natural 2C overcall followed by a cuebid is not a strong 2C opening.
    if (preceding[0].index !== partnership[0].index) return undefined;
    const previous = preceding.at(-2);
    if (system === 'sayc' && opening.level === 1 && opening.strain !== 'NT'
      && response.level === 2 && response.strain !== 'NT' && target.call.level === 2
      && intervened(auction, target.seat, partnership[0].index, partnership[1].index)
      && previous && bidValue(target.call) - bidValue(previous.call) <= 5) return { min: 12, max: 14 };
    if (system === 'sayc' && opening.level === 1 && opening.strain !== 'NT'
      && response.level === 2 && response.strain !== 'NT' && response.strain !== opening.strain
      && passedBefore(auction, partnership[1].seat, partnership[0].index)
      && !intervened(auction, target.seat, partnership[0].index, entryIndex)) {
      return target.call.level === 2 ? { min: 12, max: 14 }
        : target.call.level === 3 ? { min: 15, max: 21 } : undefined;
    }
    if ((system === 'two-over-one' || system === 'sayc') && opening?.level === 2 && opening.strain === 'C' && response?.level === 2 && response.strain === 'D') {
      if (target.call.level === 2) return { min: 22, max: 24 };
      if (target.call.level === 3) return { min: 25, max: 37 };
    }
    if (system === 'precision' && opening?.level === 1 && opening.strain === 'C' && response?.level === 1 && response.strain === 'D') {
      if (target.call.level === 1) return { min: 16, max: 18 };
      if (target.call.level === 2) return { min: 19, max: 21 };
      if (target.call.level === 3) return { min: 24, max: 37 };
    }
    // 2NT inside a 2/1 game force describes shape, not an 18-19 jump.
    if ((system === 'sayc' || system === 'two-over-one') && isTwoOverOne(partnership[0], partnership[1], auction)
      && target.call.level === 2) return { min: 12, max: 21 };
    if (preceding[0].index !== partnership[0].index || response.level !== 1) return undefined;
    if (target.call.level === 3) return { min: 19, max: 21 };
    return naturalRebidRange(system, partnership[0].call, target.call);
  }
  // A semi-forcing response is not an opening NT platform. Its later 2NT
  // invitation and opener's acceptance keep the one-suit opening context.
  if ((system === 'sayc' || system === 'two-over-one') && partnership[0]?.index === preceding[0]?.index
    && opening?.level === 1 && major(opening.strain) && response?.level === 1 && response.strain === 'NT'
    && partnership[2]?.seat === partnership[0].seat && partnership[2].call.strain !== 'NT') {
    const minorDescription = partnership[2].call.level === 2 && !major(partnership[2].call.strain);
    if (position === 3 && target.seat === partnership[1].seat && target.call.level === 2)
      return { min: minorDescription ? 10 : 11, max: 12 };
    if (position === 4 && target.seat === partnership[0].seat && target.call.level === 3
      && partnership[3].call.strain === 'NT' && partnership[3].call.level === 2)
      return { min: minorDescription ? 15 : 14, max: 21 };
  }
  return undefined;
}

/** Infer the latest defined public no-trump range for one partnership, including rebids. */
export function latestNoTrumpRange(auction: AuctionEntry[], seat: Seat, system: BiddingSystem, before = auction.length): PointRange | undefined {
  const candidates = bids(auction).filter(entry => entry.index < before && sideOf(entry.seat) === sideOf(seat) && entry.call.strain === 'NT');
  for (let i = candidates.length - 1; i >= 0; i--) {
    const range = noTrumpRangeAt(auction, candidates[i].index, system);
    if (range && isNaturalNoTrumpAt(auction, candidates[i].index, system)) return range;
  }
}

/** Shared NT-platform guard. An artificial 2NT is never a balanced platform,
 * even when an unrelated positional branch happens to assign it a range. */
export function isNaturalNoTrumpAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): boolean {
  const entry = auction[index];
  return entry?.call.kind === 'bid' && entry.call.strain === 'NT'
    && !!noTrumpRangeAt(auction.slice(0, index + 1), index, system)
    && !isArtificialBidAt(auction.slice(0, index + 1), index, system);
}

/** Only an explicitly balanced platform promises two cards in every suit.
 * Natural responder NT, forced stopper answers and late cashing NT do not. */
function naturalMinorNTGameResponseAt(auction: AuctionEntry[], index: number, system: BiddingSystem): boolean {
  const target = auction[index];
  if (system !== 'sayc' || target?.call.kind !== 'bid' || target.call.level !== 3 || target.call.strain !== 'NT') return false;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const opening = side[0];
  return side.length === 2 && opening?.index === all[0]?.index && opening.seat !== target.seat
    && opening.call.level === 1 && (opening.call.strain === 'C' || opening.call.strain === 'D')
    && !intervened(auction, target.seat, opening.index, index);
}

export function isBalancedNoTrumpAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): boolean {
  if (!isNaturalNoTrumpAt(auction, index, system)) return false;
  const prefix = auction.slice(0, index + 1), target = prefix[index];
  if (target.call.kind !== 'bid') return false;
  const all = bids(prefix), side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const first = side[0], ownPrior = side.filter(entry => entry.seat === target.seat && entry.index < index);
  if (side.length === 2 && first?.index === all[0]?.index && first.call.level === 3
    && first.call.strain !== 'NT' && target.call.level === 3 && target.call.strain === 'NT') return true;
  if (index === all[0]?.index) return true;
  if (side.length === 1 && !prefix.some((entry, at) => at < index
    && sideOf(entry.seat) === sideOf(target.seat) && isTakeoutDoubleAt(prefix, at))) return true;
  const ownTakeout = prefix.findLastIndex((entry, at) => at < index && entry.seat === target.seat && isTakeoutDoubleAt(prefix, at));
  if (ownTakeout >= 0 && ownPrior.length === 0) {
    const range = noTrumpRangeAt(prefix, index, system);
    if (range?.min === 18 && range.max === 20 || range?.min === 21 && range.max === 22) return true;
  }
  if (first?.index !== all[0]?.index || first.seat !== target.seat || side.length !== 3 || ownPrior.length !== 1) return false;
  if (first.call.level === 2 && first.call.strain === 'C' && side[1].call.level === 2 && side[1].call.strain === 'D') return true;
  if (first.call.level !== 1 || first.call.strain === 'NT' || side[1].call.level !== 1) return false;
  const range = noTrumpRangeAt(prefix, index, system), previous = all.at(-2);
  return target.call.level === 1 && range?.min === 12 && range.max === 14
    || target.call.level === 2 && range?.min === 18 && range.max === 19
      && !!previous && !intervened(prefix, target.seat, first.index, index);
}

export function publicOpenerNTOverNTAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index], opening = bids(auction.slice(0, index))[0];
  if (system !== 'sayc' || target?.call.kind !== 'bid' || target.call.level !== 2 || target.call.strain !== 'NT'
    || opening?.call.level !== 1 || !['C', 'D'].includes(opening.call.strain) || target.seat !== opening.seat
    || index !== opening.index + 4 || auction[opening.index + 2]?.call.kind !== 'pass'
    || auction[opening.index + 3]?.call.kind !== 'pass') return undefined;
  const overcall = auction[opening.index + 1];
  if (overcall?.call.kind !== 'bid' || overcall.call.level !== 1 || overcall.call.strain !== 'NT'
    || !isBalancedNoTrumpAt(auction, opening.index + 1, system)) return undefined;
  return { opening, overcall, min: 19, max: 21, shapeFamily: ['4333', '4432', '5332', '6322'] as const };
}

/** First original-major game over an enemy four-minor raise, with no natural
 * partner response: normal nineteen-point long game or the bounded eighteen
 * point two-major playing source. The branch is public; hand quality is private. */
export function publicSelfLongMajorGameAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if (system !== 'sayc' || target?.call.kind !== 'bid' || target.call.level !== 4 || !major(target.call.strain)) return undefined;
  const all = bids(auction.slice(0, index + 1)), opening = all[0];
  const side = all.filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const last = all.at(-2);
  if (side.length !== 2 || opening?.seat !== target.seat || opening.call.level !== 1
    || opening.call.strain !== target.call.strain || !last || last.call.strain === 'NT'
    || sideOf(last.seat) === sideOf(target.seat) || bidValue(target.call) <= bidValue(last.call)
    || auction.slice(opening.index + 1, index).some(prior => prior.seat === partnerOf(target.seat)
      && prior.call.kind !== 'pass')) return undefined;
  const primarySuit = target.call.strain as Suit, secondarySuit = primarySuit === 'H' ? 'S' as const : 'H' as const;
  const allowEighteenException = last.call.level === 4 && ['C', 'D'].includes(last.call.strain);
  return { normalHcpMinimum: 19, minHcp: allowEighteenException ? 18 : 19, primarySuit, secondarySuit, allowEighteenException,
    minPrimaryLength: 6, minSecondaryLength: 5, minQuickTricks: 4, maxLosingTricks: 3 };
}

/** A genuine minimum balanced rebid leaves at least one three-card major.
 * Responder's five-five description therefore establishes a game force. */
/** A first higher new major over partner's natural three-level overcall is
 * a strong one-round advance, distinct from a two-level or forced reply. */
export function publicThreeLevelOvercallAdvanceAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if ((system !== 'sayc' && system !== 'two-over-one') || target?.call.kind !== 'bid'
    || target.call.level !== 3 || !major(target.call.strain)) return undefined;
  const targetBid = target.call;
  const before = auction.slice(0, index), all = bids(before);
  const sideActions = before.filter(entry => sideOf(entry.seat) === sideOf(target.seat) && entry.call.kind !== 'pass');
  if (sideActions.length !== 1 || sideActions[0].seat !== partnerOf(target.seat)) return undefined;
  const overcall = all.find(entry => sideOf(entry.seat) === sideOf(target.seat));
  const enemy = overcall && all.findLast(entry => entry.index < overcall.index);
  if (!overcall || overcall.index === all[0]?.index || overcall.call.level !== 3
    || overcall.call.strain === 'NT' || overcall.call.strain === target.call.strain
    || !enemy || bidValue(overcall.call) - bidValue(enemy.call) > 5
    || bidValue(target.call) <= bidValue(overcall.call)
    || isArtificialBidAt(before, overcall.index, system)
    || all.some(entry => sideOf(entry.seat) !== sideOf(target.seat) && entry.call.strain === targetBid.strain)) return undefined;
  return { overcall, minHcp: 13, minLength: 5 };
}

export function publicStrictNTTwoMajorAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 3 || entry.call.strain !== 'H') return undefined;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const [opening, response, platform] = side;
  if (side.length !== 4 || opening?.index !== all[0]?.index || opening.call.level !== 1
    || !['C', 'D'].includes(opening.call.strain) || response.call.level !== 1 || response.call.strain !== 'S'
    || entry.seat !== response.seat || platform.seat !== opening.seat || platform.call.level !== 1
    || platform.call.strain !== 'NT' || intervened(auction, entry.seat, opening.index, index)
    || !isBalancedNoTrumpAt(auction, platform.index, system)) return undefined;
  const range = noTrumpRangeAt(auction, platform.index, system);
  if (range?.min !== 12 || range.max !== 14) return undefined;
  return { platform, opening, response };
}

export function publicStrongMinorTrialAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 4 || !['C', 'D'].includes(target.call.strain)) return undefined;
  const before = auction.slice(0, index), side = bids(before).filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const trump = target.call.strain as Suit;
  if (!side.some(prior => prior.seat === target.seat && prior.call.strain === trump
    && !isArtificialBidAt(before, prior.index, system))) return undefined;
  const partner = publicPlayerConstraints(before, partnerOf(target.seat), system);
  if (!partner.strictBalancedShapeFamily || !side.some(prior => prior.seat === partnerOf(target.seat)
    && isBalancedNoTrumpAt(before, prior.index, system)) || partner.suitMinimums[trump] < 2
    || !side.some(prior => analyzeAuctionSemantics(before.slice(0, prior.index + 1), partnerOf(prior.seat), system).forcing === 'game')) return undefined;
  const ownMinimum = Math.max(6, naturalSuitMinimum(before, target.seat, trump, system));
  return { trump, ownMinimum, partnerMinimum: partner.suitMinimums[trump],
    supportMinimum: Math.max(0, 33 - publicSupportMinimum(trump, ownMinimum, partner)),
    controlSuits: (['C', 'D', 'H', 'S'] as Suit[]).filter(suit => suit !== trump) };
}

function strongClubNegativePassAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const opening = bids(auction.slice(0, index))[0], target = auction[index];
  const enemy = opening && auction[opening.index + 1];
  if (!((system === 'sayc' || system === 'two-over-one') && opening?.call.level === 2 && opening.call.strain === 'C'
    && target?.call.kind === 'pass' && target.seat === partnerOf(opening.seat))) return false;
  if (index === opening.index + 2) return enemy?.call.kind === 'bid' && enemy.call.strain !== 'NT'
    && !isArtificialBidAt(auction, opening.index + 1, system);
  const side = bids(auction.slice(0, index)).filter(prior => sideOf(prior.seat) === sideOf(target.seat));
  const waiting = side[1], rebid = side[2], intervention = auction[index - 1];
  return side.length === 3 && waiting?.call.level === 2 && waiting.call.strain === 'D'
    && rebid?.seat === opening.seat && rebid.call.strain !== 'NT' && !atGame(rebid.call)
    && intervention?.call.kind === 'bid' && sideOf(intervention.seat) !== sideOf(target.seat)
    && !isArtificialBidAt(auction, index - 1, system);
}

export function quantitativeNoTrumpPlatformBefore(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if (!target) return undefined;
  const all = bids(auction.slice(0, index)), side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const [opening, response] = side;
  return side.findLast(entry => isNaturalNoTrumpAt(auction, entry.index, system)
    && !(opening?.index === all[0]?.index && opening.call.level === 1 && major(opening.call.strain)
      && response?.index === entry.index && entry.call.level === 1));
}

function semiNTWeakMajorAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if ((system !== 'sayc' && system !== 'two-over-one') || target?.call.kind !== 'bid'
    || target.call.level !== 2 || !major(target.call.strain)) return undefined;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const [opening, response, rebid] = side;
  if (side.length !== 4 || opening?.index !== all[0]?.index || opening.call.level !== 1
    || !major(opening.call.strain) || response?.call.level !== 1 || response.call.strain !== 'NT'
    || response.seat !== target.seat || rebid?.seat !== opening.seat || rebid.call.level !== 2
    || target.call.strain === opening.call.strain
    || intervened(auction, target.seat, opening.index, response.index)
    || !['C', 'D'].includes(rebid.call.strain)) return undefined;
  return { opening, rebid };
}

function semiNTMajorEscapeAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if ((system !== 'sayc' && system !== 'two-over-one') || target?.call.kind !== 'bid'
    || target.call.level !== 3 || target.call.strain !== 'H') return undefined;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const [opening, response, rebid] = side;
  if (side.length !== 4 || opening?.index !== all[0]?.index || opening.call.level !== 1 || opening.call.strain !== 'S'
    || response?.seat !== target.seat || response.call.level !== 1 || response.call.strain !== 'NT'
    || rebid?.seat !== opening.seat || rebid.call.level !== 2 || rebid.call.strain !== 'S'
    || auction.slice(opening.index + 1, index).some(entry => sideOf(entry.seat) !== sideOf(target.seat)
      && entry.call.kind !== 'pass')) return undefined;
  return { opening, response, rebid };
}

function negativeDoubleMinorContinuationAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if ((system !== 'sayc' && system !== 'two-over-one') || target?.call.kind !== 'bid'
    || target.call.level !== 2 || !['C', 'D'].includes(target.call.strain)) return undefined;
  const targetBid = target.call;
  const before = auction.slice(0, index), all = bids(before);
  const negativeIndex = before.findLastIndex((entry, at) => entry.seat === target.seat && isNegativeDoubleAt(before, at));
  const reply = all.findLast(entry => entry.seat === partnerOf(target.seat) && entry.index > negativeIndex);
  if (negativeIndex < 0 || !reply || reply.call.strain === 'NT' || isArtificialBidAt(before, reply.index, system)
    || all.some(entry => entry.seat === target.seat || sideOf(entry.seat) === sideOf(target.seat)
      && entry.call.strain === targetBid.strain && !isArtificialBidAt(before, entry.index, system))
    || all.some(entry => sideOf(entry.seat) !== sideOf(target.seat) && entry.call.strain === targetBid.strain)) return undefined;
  const latest = all.at(-1);
  const cheapest = latest && [1, 2, 3, 4, 5, 6, 7].find(level => bidValue({ kind: 'bid', level, strain: targetBid.strain }) > bidValue(latest.call));
  if (cheapest !== 2 || analyzeAuctionSemantics(before, target.seat, system).mustBid
    || analyzeAuctionSemantics(before, target.seat, system).forcing === 'game') return undefined;
  return { negativeIndex, reply };
}

function competitiveOpenerReverseAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index], opening = bids(auction.slice(0, index))[0];
  const targetSuit = target?.call.kind === 'bid' ? target.call.strain : undefined;
  const prior = bids(auction.slice(0, index));
  const previous = prior.at(-1);
  if (target?.call.kind === 'bid' && previous && bidValue(target.call) - bidValue(previous.call) > 5) return undefined;
  const partnerReplyRequest = prior.findLast(entry => entry.seat === partnerOf(target.seat));
  if (partnerReplyRequest && isArtificialBidAt(auction.slice(0, index), partnerReplyRequest.index, system)
    && prior.some(entry => entry.index < partnerReplyRequest.index && sideOf(entry.seat) !== sideOf(target.seat)
      && entry.call.strain === partnerReplyRequest.call.strain)) return undefined;
  if ((system === 'sayc' || system === 'two-over-one') && target?.call.kind === 'bid'
    && target.call.level === 2 && major(target.call.strain) && opening?.seat === target.seat
    && opening.call.level === 1 && ['C', 'D'].includes(opening.call.strain)
    && prior.filter(entry => entry.seat === target.seat).length === 1
    && !auction.slice(0, index).some((entry, at) => entry.seat === partnerOf(target.seat)
      && isNegativeDoubleAt(auction, at) && publicNegativeDoubleMajorsAt(auction, at).some(suit => suit === targetSuit))
    && prior.some(entry => sideOf(entry.seat) !== sideOf(target.seat))
    && !prior.some(entry => entry.seat !== target.seat && entry.call.strain === targetSuit)
    && !prior.some(entry => sideOf(entry.seat) !== sideOf(target.seat) && atGame(entry.call)))
    return { opening, originalMinimum: 4, newMinimum: 4 };
  if ((system !== 'sayc' && system !== 'two-over-one') || target?.call.kind !== 'bid'
    || target.call.level !== 2 || target.call.strain === 'NT' || opening?.seat !== target.seat
    || opening.call.level !== 1 || opening.call.strain === 'NT'
    || bidValue({ kind: 'bid', level: 1, strain: target.call.strain }) <= bidValue(opening.call)
    || index !== opening.index + 4 || !isTakeoutDoubleAt(auction, opening.index + 1)
    || auction[opening.index + 2]?.call.kind !== 'pass') return undefined;
  const advance = auction[opening.index + 3];
  if (advance?.call.kind !== 'bid' || advance.call.strain === target.call.strain
    || bidValue(advance.call) >= bidValue({ kind: 'bid', level: 2, strain: opening.call.strain })) return undefined;
  return { opening, originalMinimum: 4, newMinimum: 4 };
}

export function publicStrongTakeoutStopCueAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc') {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || target.call.strain === 'NT') return undefined;
  const before = auction.slice(0, index), all = bids(before), original = all[0];
  const partner = all.findLast(prior => prior.seat === partnerOf(target.seat));
  const own = all.filter(prior => prior.seat === target.seat);
  if (!partner || original?.call.strain !== target.call.strain || own.length !== 1
    || publicCallMeaningAt(before, own[0].index, system).role !== 'takeout-minimum-response') return undefined;
  const meaning = publicCallMeaningAt(before, partner.index, system);
  if (meaning.role !== 'takeout-strong-rebid' || (meaning.hcpRange?.min ?? 0) < 17) return undefined;
  return { minimum: Math.max(0, 25 - meaning.hcpRange!.min), partner };
}

function negativeDoubleGameCueAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index], all = bids(auction.slice(0, index)), opening = all[0];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || opening?.seat !== target.seat
    || opening.call.level !== 1 || opening.call.strain === 'NT' || all.filter(entry => entry.seat === target.seat).length !== 1)
    return undefined;
  const overcall = auction[opening.index + 1], response = auction[opening.index + 2];
  const latestEnemy = all.findLast(prior => sideOf(prior.seat) !== sideOf(target.seat));
  if (response?.seat === partnerOf(target.seat) && response.call.kind === 'double'
    && classifyDoubleAt(auction, opening.index + 2, system) === 'two-suit-strength'
    && latestEnemy?.call.strain === target.call.strain && !isArtificialBidAt(auction, latestEnemy.index, system))
    return { minimum: 15, twoSuitStrength: true };
  if (overcall?.call.kind !== 'bid' || overcall.call.level !== 2 || overcall.call.strain !== target.call.strain
    || response?.seat !== partnerOf(target.seat) || !isNegativeDoubleAt(auction, opening.index + 2)) return undefined;
  return { minimum: 25 - (publicPlayerConstraints(auction.slice(0, index), response.seat, system).hcpRange?.min ?? 8) };
}

function takeoutCueNaturalGameAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const target = auction[index];
  if (target?.call.kind !== 'bid' || target.call.level !== 3 || target.call.strain === 'NT') return false;
  const before = auction.slice(0, index), all = bids(before);
  const own = all.filter(prior => prior.seat === target.seat), partner = all.findLast(prior => prior.seat === partnerOf(target.seat));
  if (own.length !== 1 || !partner || publicCallMeaningAt(before, own[0].index, system).role !== 'cue'
    || !before.some((entry, at) => entry.seat === partner.seat && isTakeoutDoubleAt(before, at))
    || (publicCallMeaningAt(before, own[0].index, system).hcpRange?.min ?? 0) < 12
    || own[0].call.strain === target.call.strain || partner.call.strain === target.call.strain) return false;
  return (major(target.call.strain) ? 12 : 16)
    + (publicPlayerConstraints(before, partner.seat, system).hcpRange?.min ?? 0) >= 25;
}

function reverseByOpener(partnership: BidEntry[], auction: AuctionEntry[]) {
  if (partnership.length < 3) return false;
  const [opening, response, rebid] = partnership;
  // A passed-hand two-level response is limited and NF: opener's reverse
  // still promises extras. An unpassed uncontested 2/1 already forces game
  // and its economical shape reverse does not add a new 17-point promise.
  const limitedResponse = response.call.level === 1 || response.call.level === 2
    && response.call.strain !== 'NT' && !isTwoOverOne(opening, response, auction);
  return opening.seat === rebid.seat && response.seat !== opening.seat && opening.call.level === 1 && limitedResponse && rebid.call.level === 2 && rebid.call.strain !== 'NT' && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain && bidValue({ kind: 'bid', level: 1, strain: rebid.call.strain }) > bidValue(opening.call);
}

function fourthSuit(partnership: BidEntry[]) {
  if (partnership.length !== 4) return false;
  if (partnership[0].call.level !== 1 || partnership[1].call.level !== 1) return false;
  const natural = partnership.map(entry => entry.call).filter(call => call.strain !== 'NT');
  return natural.length === 4 && new Set(natural.map(call => call.strain)).size === 4
    && partnership[3].call.level >= 2 && partnership[1].seat === partnership[3].seat;
}

/** After opener has already described two natural suits, repeating the
 * original major as the first answer to fourth suit shows a sixth card.
 * This does not change minimum five-card repeats inside a true 2/1 GF. */
function fourthSuitOriginalMajorAnswerAt(auction: AuctionEntry[], index: number, system: BiddingSystem) {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.level !== 3 || !major(entry.call.strain)) return undefined;
  const all = bids(auction.slice(0, index + 1)), side = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const [opening, response, rebid, inquiry, answer] = side;
  if (side.length !== 5 || opening?.index !== all[0]?.index || opening.seat !== entry.seat
    || opening.call.level !== 1 || opening.call.strain !== entry.call.strain
    || response.call.level !== 1 || response.call.strain === 'NT'
    || rebid.seat !== entry.seat || rebid.call.strain === opening.call.strain || rebid.call.strain === 'NT'
    || inquiry.seat !== partnerOf(entry.seat) || answer.index !== index
    || !fourthSuit(side.slice(0, 4)) || passedBefore(auction, inquiry.seat, opening.index)
    || intervened(auction, entry.seat, opening.index, index)
    || !isArtificialBidAt(auction, inquiry.index, system)) return undefined;
  return { opening, inquiry };
}

function newMinor(partnership: BidEntry[]) {
  if (partnership.length !== 4) return false;
  const [opening, response, rebid, inquiry] = partnership;
  return opening.call.level === 1 && !major(opening.call.strain) && response.call.level === 1 && major(response.call.strain) && rebid.call.level === 1 && rebid.call.strain === 'NT' && inquiry.call.level === 2 && (inquiry.call.strain === 'C' || inquiry.call.strain === 'D') && inquiry.call.strain !== opening.call.strain;
}

function responderTrialBid(partnership: BidEntry[]) {
  if (partnership.length !== 4) return false;
  const [opening, response, raise, trial] = partnership;
  return opening.call.level === 1 && response.call.level === 1 && response.call.strain !== 'NT'
    && raise.seat === opening.seat && raise.call.level === 2 && raise.call.strain === response.call.strain
    && trial.seat === response.seat && trial.call.level <= 3 && trial.call.strain !== 'NT'
    && trial.call.strain !== response.call.strain;
}

function artificialAnswer(partnership: BidEntry[], system: BiddingSystem, auction: AuctionEntry[]) {
  if (partnership.length < 3) return false;
  const last = partnership.at(-1)!.call;
  const previous = partnership.at(-2)!.call;
  const before = partnership.at(-3)!.call;
  const ntIndex = partnership.length - 3;
  const ntPlatform = ntIndex === 0 || (ntIndex === 2 && partnership[0].call.strain === 'C'
    && (partnership[0].call.level === 2 || (system === 'precision' && partnership[0].call.level === 1)));
  if (ntPlatform && before.strain === 'NT' && before.level <= 3 && previous.strain === 'C'
    && previous.level === before.level + 1 && last.level === previous.level
    && last.strain === 'D') return true;
  if (system === 'precision' && partnership[0].call.level === 2 && partnership[0].call.strain === 'D' && previous.level === 2 && previous.strain === 'NT' && last.level === 3) return true;
  if (previous.level === 4 && previous.strain === 'NT' && last.level === 5) {
    if (!isArtificialBidAt(auction, partnership.at(-2)!.index, system)) return false;
    const trump = publicKeycardTrumpAt(auction, partnership.at(-2)!.index, system);
    return last.strain !== trump;
  }
  return false;
}

/** Public forcing and artificial-contract state for the player whose turn it is. */
export function analyzeAuctionSemantics(auction: AuctionEntry[], seat: Seat, system: BiddingSystem): AuctionSemantics {
  const state = computeAuctionSemantics(auction, seat, system);
  const all = bids(auction), lastSide = all.findLast(entry => sideOf(entry.seat) === sideOf(seat));
  const enemy = all.findLast(entry => sideOf(entry.seat) !== sideOf(seat));
  if (state.forcing === 'one-round' && lastSide && enemy && enemy.index > lastSide.index
    && atGame(enemy.call) && !isArtificialBidAt(auction, enemy.index, system)
    && ['overcall-cue', 'competitive-cue', 'negative-double', 'natural-response', 'reverse',
      'responder-second-suit', 'preempt-new-suit', 'takeout-cue'].includes(state.convention))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  if (state.forcing === 'one-round' && lastSide && enemy && enemy.index > lastSide.index
    && ['overcall-cue', 'competitive-cue'].includes(state.convention)
    && !isArtificialBidAt(auction, enemy.index, system)) {
    // An ordinary support cue cannot force game merely because a later enemy
    // bid removes its original below-game return. Independent game forces have
    // state.forcing === 'game' and never enter this release.
    const trump = publicCallMeaningAt(auction, lastSide.index, system).supportRange?.trump;
    if (trump) {
      const minimumReturn = (after: BidEntry) => [1, 2, 3, 4, 5, 6, 7].find(level =>
        bidValue({ kind: 'bid', level, strain: trump }) > bidValue(after.call));
      const originalLevel = minimumReturn(lastSide), currentLevel = minimumReturn(enemy);
      if (originalLevel && currentLevel && originalLevel < gameLevel(trump) && currentLevel >= gameLevel(trump))
        return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
    }
  }
  return state;
}

function computeAuctionSemantics(auction: AuctionEntry[], seat: Seat, system: BiddingSystem): AuctionSemantics {
  const all = bids(auction);
  const partnership = all.filter(entry => sideOf(entry.seat) === sideOf(seat));
  const opening = partnership[0], response = partnership[1];
  const completedGame = partnership.at(-1);
  if (completedGame && atGame(completedGame.call)
    && !strongSecondNegativeAt(auction, completedGame.index, system)
    && !(completedGame.call.strain === 'NT' && [4, 5].includes(completedGame.call.level))
    && !keycardContinuationAt(auction, completedGame.index, system)
    && !publicControlCueAt(auction, completedGame.index, system))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  if (publicInterruptedStaymanBefore(auction, seat, system))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  if (partnership.some(entry => publicStrongTakeoutStopCueAt(auction, entry.index, system)
    || negativeDoubleGameCueAt(auction, entry.index, system)
    || takeoutCueNaturalGameAt(auction, entry.index, system)))
    return { forcing: 'game', convention: 'takeout-cue', mustBid: partnership.at(-1)?.seat !== seat,
      currentContractArtificial: !!lastCallIsStrongTakeoutCue() };
  function lastCallIsStrongTakeoutCue() {
    const last = partnership.at(-1);
    return last && (publicStrongTakeoutStopCueAt(auction, last.index, system)
      || negativeDoubleGameCueAt(auction, last.index, system));
  }
  const negativePass = auction.findIndex((entry, index) => sideOf(entry.seat) === sideOf(seat)
    && strongClubNegativePassAt(auction, index, system));
  if (negativePass >= 0 && opening) {
    const openerReply = partnership.find(prior => prior.index > negativePass && prior.seat === opening.seat);
    return openerReply ? { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false }
      : { forcing: 'one-round', convention: 'strong-opening', mustBid: seat === opening.seat, currentContractArtificial: false };
  }
  const lastSide = partnership.at(-1);
  const ntMinorForce = partnership.some(entry => publicNTNewMinorAt(auction, entry.index, system)?.game);
  if (ntMinorForce) return { forcing: 'game', convention: 'responder-second-suit',
    mustBid: lastSide?.seat !== seat, currentContractArtificial: false };
  if (lastSide && (semiNTWeakMajorAt(auction, lastSide.index, system)
    || twoNTMinorEscapeAt(auction, lastSide.index, system)
    || weakFiveSpadeReturnAt(auction, lastSide.index, system)
    || semiNTMajorEscapeAt(auction, lastSide.index, system)
    || negativeDoubleMinorContinuationAt(auction, lastSide.index, system)))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  if (lastSide && competitiveOpenerReverseAt(auction, lastSide.index, system)
    && !auction.slice(lastSide.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid'))
    return { forcing: 'one-round', convention: 'reverse', mustBid: lastSide.seat === partnerOf(seat), currentContractArtificial: false };
  if (lastSide && publicThreeLevelOvercallAdvanceAt(auction, lastSide.index, system))
    return { forcing: 'one-round', convention: 'natural-response', mustBid: lastSide.seat === partnerOf(seat), currentContractArtificial: false };
  if (lastSide && publicStrongMinorTrialAt(auction, lastSide.index, system))
    return { forcing: 'one-round', convention: 'control-cue', mustBid: lastSide.seat === partnerOf(seat), currentContractArtificial: false };
  const strictTwoMajor = partnership.find(prior => publicStrictNTTwoMajorAt(auction, prior.index, system));
  if (strictTwoMajor) {
    const last = partnership.at(-1)!;
    const complete = partnership.some(prior => prior.index >= strictTwoMajor.index && atGame(prior.call));
    return { forcing: complete ? 'none' : 'game', convention: 'responder-second-suit',
      mustBid: !complete && last.seat === partnerOf(seat), currentContractArtificial: false };
  }
  const precisionFinal = partnership.at(-1), precisionConvention = precisionFinal && precisionConventionAt(auction,precisionFinal.index,system);
  if (precisionConvention && ['club-inquiry','shape-inquiry','negative'].includes(precisionConvention.stage)
    && precisionFinal!.seat===partnerOf(seat))
    return {forcing:'one-round',convention:'precision-inquiry',mustBid:true,currentContractArtificial:true};
  if (precisionConvention && ['club-answer','shape-answer'].includes(precisionConvention.stage))
    return precisionConvention.stage==='shape-answer'
      ? {forcing:'one-round',convention:'precision-inquiry',mustBid:precisionFinal!.seat===partnerOf(seat),currentContractArtificial:true}
      : {forcing:'none',convention:'none',mustBid:false,currentContractArtificial:false};
  const lastPartnership = partnership.at(-1);
  const ntRequest = lastPartnership && publicNoTrumpQuestionAt(auction, lastPartnership.index, system);
  if (ntRequest?.kind === 'transfer' && publicInterruptedTransferBefore(auction, ntRequest.platform.seat, system))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  if (ntRequest && lastPartnership!.seat === partnerOf(seat))
    return { forcing: 'one-round', convention: ntRequest.kind === 'stayman' ? 'overcall-stayman'
      : ntRequest.kind === 'weak-minor-relay' ? 'weak-minor-relay' : 'overcall-transfer', mustBid: true, currentContractArtificial: true };
  const denialInquiry = lastPartnership?.call.level === 2 && lastPartnership.call.strain === 'D'
    ? partnership.findLast(prior => prior.index < lastPartnership!.index && prior.seat !== lastPartnership!.seat) : undefined;
  const completedStayman = denialInquiry && publicNoTrumpQuestionAt(auction, denialInquiry.index, system);
  if (completedStayman?.kind === 'stayman' && completedStayman.platform.call.level === 1
    && lastPartnership!.seat === completedStayman.platform.seat
    && analyzeAuctionSemantics(auction.slice(0, completedStayman.platform.index + 1), seat, system).forcing !== 'game')
    return { forcing: 'none', convention: 'none', mustBid: false,
      currentContractArtificial: false };
  const transferInquiry = lastPartnership && partnership.findLast(prior => prior.index < lastPartnership.index
    && prior.seat !== lastPartnership.seat && publicNoTrumpQuestionAt(auction, prior.index, system)?.kind === 'transfer');
  const completedTransfer = transferInquiry && publicNoTrumpQuestionAt(auction, transferInquiry.index, system);
  if (completedTransfer?.kind === 'transfer' && lastPartnership?.seat === completedTransfer.platform.seat
    && lastPartnership.call.strain === completedTransfer.target && lastPartnership.call.level === transferInquiry!.call.level
    && !all.some(prior => prior.index > transferInquiry!.index && prior.index < lastPartnership.index
      && sideOf(prior.seat) !== sideOf(seat))
    && analyzeAuctionSemantics(auction.slice(0, completedTransfer.platform.index + 1), seat, system).forcing !== 'game')
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  if (system === 'precision' && opening && opening.index === all[0]?.index && opening.call.level === 1 && opening.call.strain === 'C'
    && !response && auction[opening.index + 1]?.call.kind === 'bid') {
    const negative = auction.findIndex((_, index) => precisionNegativePassAt(auction, index, system));
    if (negative >= 0 && seat === opening.seat)
      return { forcing: 'one-round', convention: 'precision-negative-pass', mustBid: true, currentContractArtificial: false };
    if (negative < 0 && seat === partnerOf(opening.seat))
      return { forcing: 'one-round', convention: 'strong-opening', mustBid: false, currentContractArtificial: true };
  }
  const relayRequest = partnership.findLast(entry => publicWeakMinorRelayAt(auction, entry.index, system)?.stage === 'request');
  if (relayRequest && !partnership.some(entry => entry.index > relayRequest.index && entry.seat === partnerOf(relayRequest.seat)))
    return { forcing: 'one-round', convention: 'weak-minor-relay', mustBid: seat === partnerOf(relayRequest.seat), currentContractArtificial: true };
  if (partnership.at(-1) && publicWeakMinorRelayAt(auction, partnership.at(-1)!.index, system))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  const naturalOpening = opening && all[0]?.seat === opening.seat;
  const grandInvitation = partnership.findLast(entry => entry.call.level === 5 && entry.call.strain === 'NT'
    && keycardContinuationAt(auction, entry.index, system)?.role !== 'king-ask'
    && quantitativeNoTrumpPlatformBefore(auction, entry.index, system));
  if (grandInvitation && !partnership.some(entry => entry.index > grandInvitation.index
    && entry.call.strain === 'NT' && entry.call.level >= 6))
    return { forcing: 'one-round', convention: 'quantitative-grand-invitation', mustBid: true, currentContractArtificial: false };
  if (system === 'sayc' && partnership.at(-1)?.seat === partnerOf(seat)
    && weakMinorContinuationAt(auction, partnership.at(-1)!.index))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  const finalPartnerCall = all.findLast(entry => entry.seat === partnerOf(seat));
  if (finalPartnerCall && finalPartnerCall.index === partnership.at(-1)?.index) {
    if (newSuitOverStrongNTRebidAt(auction, finalPartnerCall.index, system))
      return { forcing: 'game', convention: 'responder-second-suit', mustBid: true, currentContractArtificial: false };
    if (partnership.length === 2 && partnership[0]?.index === all[0]?.index && partnership[0].seat === seat
      && partnership[0].call.level === 2 && ['D', 'H', 'S'].includes(partnership[0].call.strain)
      && finalPartnerCall.call.strain === 'NT' && finalPartnerCall.call.level === 2
      && weakTwoFeatureInquiryAt(auction, finalPartnerCall.index)
      && !auction.slice(finalPartnerCall.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid'))
      return { forcing: 'one-round', convention: 'weak-jump-inquiry', mustBid: true, currentContractArtificial: true };
    // X of an established keycard ask changes scoring, not the information
    // request. A natural intervention needs a separate agreement; this card
    // does not invent DOPI/ROPI or force an unavailable ordinary answer.
    if (finalPartnerCall.call.level === 4 && finalPartnerCall.call.strain === 'NT'
      && publicKeycardTrumpAt(auction, finalPartnerCall.index, system)
      && !auction.slice(finalPartnerCall.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid'))
      return { forcing: 'one-round', convention: 'keycard', mustBid: true, currentContractArtificial: true };
    const partnerControl = publicControlCueAt(auction, finalPartnerCall.index, system);
    if (partnerControl)
      return { forcing: partnerControl.postHeartGame ? 'one-round' : 'game', convention: 'control-cue', mustBid: true, currentContractArtificial: true };
    const continuation = keycardContinuationAt(auction, finalPartnerCall.index, system);
    if (continuation?.role === 'queen-ask' || continuation?.role === 'king-ask')
      return { forcing: 'one-round', convention: continuation.role === 'king-ask' ? 'king-ask' : 'artificial-answer',
        mustBid: true, currentContractArtificial: true };
    if ((continuation?.role === 'keycard-answer' || continuation?.role === 'queen-answer' || continuation?.role === 'king-answer')
      && finalPartnerCall.call.strain !== continuation.trump)
      return { forcing: 'one-round', convention: 'artificial-answer', mustBid: true, currentContractArtificial: true };
  }

  const globalOpening = all[0];
  const directAction = globalOpening ? auction[globalOpening.index + 1] : undefined;
  const responderAction = globalOpening ? auction[globalOpening.index + 2] : undefined;
  const advancerAction = globalOpening ? auction[globalOpening.index + 3] : undefined;
  if (system === 'sayc' && globalOpening?.call.level === 1 && globalOpening.call.strain !== 'NT'
    && directAction?.call.kind === 'bid' && directAction.call.level === 2 && directAction.call.strain !== 'NT'
    && directAction.call.strain !== globalOpening.call.strain
    && bidValue(directAction.call) - bidValue(globalOpening.call) > 5
    && sideOf(directAction.seat) === sideOf(seat)
    && partnership[1]?.call.level === 2 && partnership[1].call.strain === 'NT'
    && weakJumpFeatureInquiryAt(auction, partnership[1].index, system)
    && !auction.slice(partnership[1].index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid')
    && ((partnership.length === 2 && directAction.seat === seat)
      || (partnership.length === 3 && directAction.seat !== seat))) {
    const answeredInTrump = partnership.length === 3 && partnership[2].call.strain === directAction.call.strain;
    return { forcing: answeredInTrump ? 'none' : 'one-round', convention: 'weak-jump-inquiry',
      mustBid: !answeredInTrump, currentContractArtificial: !answeredInTrump };
  }

  // A takeout double creates a real obligation when opener's partner passes.
  // This is position based, so opening passes and later auction noise cannot
  // turn the double into an unidentified action.
  const pendingTakeout = auction.findLastIndex((entry, index) => entry.seat === partnerOf(seat)
    && isTakeoutDoubleAt(auction, index));
  if ((system === 'sayc' || system === 'two-over-one') && pendingTakeout >= 0
    && !auction.some((entry, index) => index > pendingTakeout && entry.seat === seat)
    && !auction.some((entry, index) => index > pendingTakeout && sideOf(entry.seat) !== sideOf(seat)
      && (entry.call.kind === 'bid' || entry.call.kind === 'redouble'))) {
    return { forcing: 'one-round', convention: 'takeout-response', mustBid: true, currentContractArtificial: false };
  }

  // A negative double asks opener to describe the hand when advancer passes.
  // If advancer bids, opener may make a bridge judgment, handled by the
  // competitive chooser, rather than being forced by a blanket rule.
  if (system === 'sayc' && globalOpening?.call.level === 1 && globalOpening.call.strain !== 'NT'
    && globalOpening.seat === seat && directAction?.call.kind === 'bid'
    && directAction.call.strain !== 'NT' && bidValue(directAction.call) <= bidValue({ kind: 'bid', level: 2, strain: 'S' })
    && responderAction?.seat === partnerOf(seat) && responderAction.call.kind === 'double'
    && advancerAction?.call.kind === 'pass'
    && !auction.some((entry, index) => index > globalOpening.index + 2 && entry.seat === seat)) {
    return { forcing: 'one-round', convention: 'negative-double', mustBid: true, currentContractArtificial: false };
  }

  // Michaels and Unusual 2NT are artificial two-suited calls. Advancer must
  // select a shown suit or inquire for the unknown minor even when opener's
  // partner doubles the artificial call. A double changes the score, not the
  // obligation to remove an artificial contract.
  const opposingNaturalOpening = all[0];
  const partnerIntervention = all.find(entry => entry.index === (opposingNaturalOpening?.index ?? -2) + 1
    && entry.seat === partnerOf(seat));
  const ownActionAfterIntervention = partnerIntervention ? auction.some((entry, index) => index > partnerIntervention.index
    && entry.seat === seat) : false;
  const naturalEnemyBidAfterIntervention = partnerIntervention ? auction.some((entry, index) => index > partnerIntervention.index
    && sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid') : false;
  if (system === 'sayc' && opposingNaturalOpening?.call.level === 1
    && sideOf(opposingNaturalOpening.seat) !== sideOf(seat)
    && partnerIntervention?.call.level === 2 && partnerIntervention.index === opposingNaturalOpening.index + 1
    && !naturalEnemyBidAfterIntervention && !ownActionAfterIntervention) {
    if (opposingNaturalOpening.call.strain !== 'NT' && partnerIntervention.call.strain === opposingNaturalOpening.call.strain) {
      return { forcing: 'one-round', convention: 'michaels-advance', mustBid: true, currentContractArtificial: true };
    }
    if (partnerIntervention.call.strain === 'NT') {
      return { forcing: 'one-round', convention: 'unusual-advance', mustBid: true, currentContractArtificial: true };
    }
  }

  // A 2NT inquiry after Michaels asks the bidder to name the unknown minor.
  if (system === 'sayc' && opposingNaturalOpening?.call.level === 1 && major(opposingNaturalOpening.call.strain)
    && sideOf(opposingNaturalOpening.seat) !== sideOf(seat)
    && directAction?.seat === seat && directAction.call.kind === 'bid'
    && directAction.call.level === 2 && directAction.call.strain === opposingNaturalOpening.call.strain
    && advancerAction?.seat === partnerOf(seat) && advancerAction.call.kind === 'bid'
    && advancerAction.call.level === 2 && advancerAction.call.strain === 'NT'
    && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && entry.seat === seat)) {
    return { forcing: 'one-round', convention: 'michaels-inquiry', mustBid: true, currentContractArtificial: true };
  }

  // Stayman retains its meaning over a direct natural 1NT overcall.
  if (system === 'sayc' && opposingNaturalOpening && opposingNaturalOpening.call.strain !== 'NT'
    && sideOf(opposingNaturalOpening.seat) !== sideOf(seat)
    && directAction?.seat === seat && directAction.call.kind === 'bid'
    && directAction.call.level <= 2 && directAction.call.strain === 'NT'
    && (opposingNaturalOpening.call.level >= 2 || directAction.call.level === 1)
    && advancerAction?.seat === partnerOf(seat) && advancerAction.call.kind === 'bid'
    && advancerAction.call.level === directAction.call.level + 1 && advancerAction.call.strain === 'C'
    && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && entry.seat === seat)) {
    return { forcing: 'one-round', convention: 'overcall-stayman', mustBid: true, currentContractArtificial: true };
  }

  if (system === 'sayc' && opposingNaturalOpening && opposingNaturalOpening.call.strain !== 'NT'
    && sideOf(opposingNaturalOpening.seat) !== sideOf(seat)
    && directAction?.seat === seat && directAction.call.kind === 'bid' && directAction.call.level <= 2 && directAction.call.strain === 'NT'
    && (opposingNaturalOpening.call.level >= 2 || directAction.call.level === 1)
    && advancerAction?.call.kind === 'bid' && advancerAction.call.level === directAction.call.level + 1
    && ['D', 'H', 'S'].includes(advancerAction.call.strain)
    && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && (entry.seat === seat
      || (sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid')))) {
    return { forcing: 'one-round', convention: 'overcall-transfer', mustBid: true, currentContractArtificial: true };
  }

  // The only forcing response to a simple SAYC overcall is a cue of opener's
  // suit. Preserve that force through a double or a natural rebid by opener.
  const highOvercallCue = system === 'sayc' && opposingNaturalOpening?.call.level === 1
    && sideOf(opposingNaturalOpening.seat) !== sideOf(seat)
    && directAction?.call.kind === 'bid' && major(directAction.call.strain)
    && directAction.call.strain !== opposingNaturalOpening.call.strain
    && advancerAction?.call.kind === 'bid' && advancerAction.call.strain === opposingNaturalOpening.call.strain
    && bidValue(advancerAction.call) > bidValue({ kind: 'bid', level: 3, strain: directAction.call.strain });
  if (highOvercallCue && !partnership.some(entry => atGame(entry.call)))
    return { forcing: 'game', convention: 'overcall-cue', mustBid: true,
      currentContractArtificial: partnership.at(-1)?.index === opposingNaturalOpening.index + 3 };
  if (system === 'sayc' && opposingNaturalOpening?.call.level === 1 && opposingNaturalOpening.call.strain !== 'NT'
    && sideOf(opposingNaturalOpening.seat) !== sideOf(seat)
    && directAction?.seat === seat && directAction.call.kind === 'bid'
    && directAction.call.strain !== 'NT' && directAction.call.strain !== opposingNaturalOpening.call.strain
    && advancerAction?.seat === partnerOf(seat) && advancerAction.call.kind === 'bid'
    && advancerAction.call.strain === opposingNaturalOpening.call.strain
    && !auction.some((entry, index) => index > opposingNaturalOpening.index + 3 && entry.seat === seat)) {
    return { forcing: 'one-round', convention: 'overcall-cue', mustBid: true, currentContractArtificial: true };
  }
  const competitiveCue = naturalOpening && response && response.seat === partnerOf(opening.seat)
    && !isDelayedTakeoutSuitAnswer(auction, response.index)
    && response.call.strain !== 'NT' && all.some(entry => entry.index > opening.index && entry.index < response.index
      && sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === response.call.strain
      && !isArtificialBidAt(auction, entry.index, system));
  const jacobyGameForce = naturalOpening && response && (system === 'sayc' || system === 'two-over-one')
    && opening.call.level === 1 && major(opening.call.strain) && response.call.level === 2
    && response.call.strain === 'NT' && !intervened(auction, seat, opening.index, response.index)
    && !passedBefore(auction, response.seat, opening.index);
  const competitiveCueGameForce = competitiveCue && major(opening.call.strain)
    && bidValue(response.call) > bidValue({ kind: 'bid', level: 3, strain: opening.call.strain });
  const gameForce = !!jacobyGameForce || !!competitiveCueGameForce || !!(naturalOpening && response && ((system === 'two-over-one' || system === 'sayc')
    ? isTwoOverOne(opening, response, auction)
    : system === 'precision' && opening.call.level === 1 && opening.call.strain === 'C' && !(response.call.level === 1 && response.call.strain === 'D')));
  const partnershipReachedGame = partnership.some(entry => atGame(entry.call));
  if ((system === 'sayc' || system === 'two-over-one') && naturalOpening && openerStrongClub(opening.call)
    && response?.seat === partnerOf(opening.seat) && response.call.strain !== 'NT'
    && !(response.call.level === 2 && response.call.strain === 'D')
    && !all.some(prior => prior.index > opening.index && prior.index < response.index
      && sideOf(prior.seat) !== sideOf(opening.seat) && prior.call.strain === response.call.strain)
    && !partnershipReachedGame)
    return { forcing: 'game', convention: 'strong-suit-rebid', mustBid: true, currentContractArtificial: false };
  const staymanContinuation = partnership.find(entry =>
    staymanContinuationAt(auction, entry.index, system)?.kind === 'other-major-game-force');
  if (staymanContinuation && !partnershipReachedGame)
    return { forcing: 'game', convention: 'responder-second-suit', mustBid: true, currentContractArtificial: false };
  const ntPlatformIndex = opening?.call.strain === 'NT' ? 0
    : opening?.call.level === 2 && opening.call.strain === 'C' && partnership[2]?.call.strain === 'NT' ? 2 : -1;
  if ((system === 'sayc' || system === 'two-over-one') && ntPlatformIndex >= 0 && !partnershipReachedGame
    && noTrumpRangeAt(auction, partnership[ntPlatformIndex].index, system)) {
    const ntPlatform = partnership[ntPlatformIndex], transfer = partnership[ntPlatformIndex + 1];
    const acceptance = partnership[ntPlatformIndex + 2], secondMajor = partnership[ntPlatformIndex + 3];
    const target: Strain | undefined = transfer?.call.strain === 'D' ? 'H' : transfer?.call.strain === 'H' ? 'S' : undefined;
    if (target && ntPlatform.call.level <= 2 && transfer.call.level === ntPlatform.call.level + 1
      && acceptance?.call.strain === target && acceptance.call.level === transfer.call.level
      && secondMajor?.seat === transfer.seat && secondMajor.call.level === 3
      && major(secondMajor.call.strain) && secondMajor.call.strain !== target)
      return { forcing: 'game', convention: 'responder-second-suit', mustBid: true, currentContractArtificial: false };
  }
  if (gameForce && !partnershipReachedGame) return { forcing: 'game', convention: competitiveCueGameForce ? 'competitive-cue' : 'none', mustBid: true, currentContractArtificial: competitiveCueGameForce && partnership.length === 2 };
  if (system === 'sayc' && naturalOpening && opening.call.level === 1 && opening.call.strain === 'NT'
    && response?.call.level === 3 && response.call.strain !== 'NT' && !competitiveCue
    && major(response.call.strain) && intervened(auction, seat, opening.index, response.index) && !partnershipReachedGame)
    return { forcing: 'game', convention: 'nt-competitive-response', mustBid: true, currentContractArtificial: false };
  const rebid = partnership[2];
  const previousBeforeRebid = rebid && all.findLast(entry => entry.index < rebid.index);
  const openerJumpShift = naturalOpening && response && rebid && opening.call.level === 1
    && opening.call.strain !== 'NT' && response.call.level === 1
    && rebid.seat === opening.seat && rebid.call.strain !== 'NT'
    && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain
    && previousBeforeRebid && bidValue(rebid.call) - bidValue(previousBeforeRebid.call) > 5;
  if (openerJumpShift && !partnershipReachedGame)
    return { forcing: 'game', convention: 'opener-jump-shift', mustBid: true, currentContractArtificial: false };
  // A positive continuation after a strong 2C suit rebid is a game force.
  // A second negative followed by the original suit repeated is the sole
  // below-game exit; changing suit after that negative restores the force.
  if (naturalOpening && (system === 'sayc' || system === 'two-over-one')
    && openerStrongClub(opening.call) && response?.call.level === 2 && response.call.strain === 'D'
    && partnership.length >= 4 && partnership[2].call.strain !== 'NT') {
    const naturalSuit = partnership[2].call.strain;
    const next = partnership[3].call;
    const negative = next.level === 3 && (major(naturalSuit) ? next.strain === 'C'
      : system === 'sayc' && (naturalSuit === 'C' ? next.strain === 'D' : next.strain === 'NT'));
    const genuineGame = partnership.some((entry, index) => !(negative && index === 3) && atGame(entry.call));
    const originalAfterNegative = negative && partnership[4]?.call.strain === naturalSuit;
    if (!genuineGame && (!negative || (partnership.length >= 5 && !originalAfterNegative)))
      return { forcing: 'game', convention: 'strong-suit-rebid', mustBid: true, currentContractArtificial: false };
  }

  if (competitiveCue && opening.seat === seat && partnership.length === 2) {
    return { forcing: 'one-round', convention: 'competitive-cue', mustBid: true, currentContractArtificial: true };
  }

  // Reopening X may belong to the original opener. Its strong cue refers to
  // the opponents' first natural suit, never our own opening suit.
  const opposingOpening = all.find(entry => sideOf(entry.seat) !== sideOf(seat));
  const directTakeout = opposingOpening && opposingOpening.call.level <= 3 && opposingOpening.call.strain !== 'NT'
    ? auction.findIndex((entry, index) => index > opposingOpening.index && entry.seat === seat && isTakeoutDoubleAt(auction, index)) : -1;
  const partnerCue = opposingOpening && directTakeout >= 0 ? [...all].reverse().find(entry => entry.seat === partnerOf(seat)
    && entry.index > directTakeout && entry.call.strain === opposingOpening.call.strain
    && !isDelayedTakeoutSuitAnswer(auction, entry.index)) : undefined;
  const ownBidAfterCue = partnerCue ? all.some(entry => entry.seat === seat && entry.index > partnerCue.index) : false;
  if (partnerCue && !ownBidAfterCue && partnership.at(-1)?.index === partnerCue.index) return { forcing: 'one-round', convention: 'takeout-cue', mustBid: true, currentContractArtificial: true };

  // Later competitive cues have the same response obligation as a direct
  // cue. Do not lose it because the opener, rather than responder, made it.
  // A raise of a suit our side previously bid naturally is still natural.
  const latestPartner = partnership.at(-1);
  const beforeLatest = latestPartner && partnership.findLast(prior => prior.index < latestPartner.index
    && prior.seat !== latestPartner.seat);
  const answeredCue = latestPartner && beforeLatest && isArtificialBidAt(auction, beforeLatest.index, system)
    && ['overcall-cue', 'competitive-cue', 'takeout-cue'].includes(analyzeAuctionSemantics(
      auction.slice(0, latestPartner.index), latestPartner.seat, system).convention);
  if (answeredCue && !gameForce && !openerJumpShift && !(opening && openerStrongClub(opening.call)))
    return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
  const latestIsMichaels = latestPartner && all[0]?.call.level === 1 && all[0].call.strain !== 'NT'
    && sideOf(all[0].seat) !== sideOf(seat) && latestPartner.index === all[0].index + 1
    && latestPartner.call.level === 2 && latestPartner.call.strain === all[0].call.strain;
  if (latestPartner?.seat === partnerOf(seat) && latestPartner.call.strain !== 'NT'
    && !latestIsMichaels
    && !isDelayedTakeoutSuitAnswer(auction, latestPartner.index)
    && !naturalStaymanAnswerAt(auction, latestPartner.index, system)
    && all.some(entry => entry.index < latestPartner.index && sideOf(entry.seat) !== sideOf(seat)
      && entry.call.strain === latestPartner.call.strain && !isArtificialBidAt(auction, entry.index, system))
    && !partnership.some(entry => entry.index < latestPartner.index && entry.call.strain === latestPartner.call.strain))
    return { forcing: 'one-round', convention: 'competitive-cue', mustBid: true, currentContractArtificial: true };

  const partnerMadeLastPartnershipBid = partnership.at(-1)?.seat !== seat;
  const opener = partnership[0]?.call;
  if (naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 2
    && response.seat !== opening.seat
    && opening.call.level === 1 && opening.call.strain !== 'NT' && response.call.level === 1
    && response.call.strain !== 'NT' && response.call.strain !== opening.call.strain
    && !passedBefore(auction, response.seat, opening.index)
    && !auction.slice(response.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid')
    && !auction.slice(opening.index + 1, response.index).some(entry => sideOf(entry.seat) !== sideOf(seat)
      && entry.call.kind === 'bid')) {
    return { forcing: 'one-round', convention: 'natural-response', mustBid: true, currentContractArtificial: false };
  }
  if (naturalOpening && opening.seat === seat && partnership.length === 2
    && opening.call.level === 1 && opening.call.strain !== 'NT' && response.call.strain !== 'NT'
    && response.call.strain !== opening.call.strain && !passedBefore(auction, response.seat, opening.index)) {
    const enemyBefore = all.filter(entry => entry.index > opening.index && entry.index < response.index
      && sideOf(entry.seat) !== sideOf(seat));
    const previous = all.findLast(entry => entry.index < response.index);
    const naturalFreeResponse = previous && enemyBefore.length > 0
      && !auction.some((entry, index) => index < response.index && entry.seat === seat && isTakeoutDoubleAt(auction, index, system))
      && !enemyBefore.some(entry => entry.call.strain === response.call.strain
        && !isArtificialBidAt(auction, entry.index, system))
      && bidValue(response.call) - bidValue(previous.call) <= 5;
    if (naturalFreeResponse && !auction.some((entry, index) => index > response.index
      && sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid'))
      return { forcing: 'one-round', convention: 'natural-response', mustBid: true, currentContractArtificial: false };
  }
  if (naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 1 && (((system === 'two-over-one' || system === 'sayc') && opener.level === 2 && opener.strain === 'C') || (system === 'precision' && opener.level === 1 && opener.strain === 'C'))) return { forcing: 'one-round', convention: 'strong-opening', mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && (system === 'two-over-one' || system === 'sayc') && partnership.length === 2 && opener.level === 2 && opener.strain === 'C' && partnership[1].call.level === 2 && partnership[1].call.strain === 'D') return { forcing: 'one-round', convention: 'waiting-response', mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && (system === 'two-over-one' || system === 'sayc') && partnership.length === 3 && opener.level === 2 && opener.strain === 'C' && partnership[1].call.strain === 'D' && partnership[2].call.strain !== 'NT') return { forcing: 'one-round', convention: 'strong-suit-rebid', mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && (system === 'two-over-one' || system === 'sayc') && partnership.length === 4 && opener.level === 2 && opener.strain === 'C' && partnership[1].call.strain === 'D' && partnership[2].call.strain !== 'NT' && partnership[3].call.level === 3 && partnership[3].call.strain === 'C') return { forcing: 'one-round', convention: 'artificial-answer', mustBid: true, currentContractArtificial: true };
  if (system === 'sayc' && naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 4
    && opener.level === 2 && opener.strain === 'C' && partnership[1].call.strain === 'D'
    && partnership[3].call.level === 3 && ((partnership[2].call.strain === 'C' && partnership[3].call.strain === 'D')
      || (partnership[2].call.strain === 'D' && partnership[3].call.strain === 'NT')))
    return { forcing: 'one-round', convention: 'artificial-answer', mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && system === 'sayc' && partnership.length === 2
    && (opener.level === 3 || (opener.level === 2 && opener.strain !== 'C')) && opener.strain !== 'NT' && partnership[1].call.strain !== 'NT'
    && partnership[1].call.strain !== opener.strain
    && !preemptNTCompetitiveResponseAt(auction, partnership[1].index, system)
    && !passedBefore(auction, partnership[1].seat, opening.index)
    && !auction.slice(partnership[1].index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat)
      && entry.call.kind === 'bid')) return { forcing: 'one-round', convention: 'preempt-new-suit', mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && reverseByOpener(partnership, auction) && partnership.length === 3
    && !auction.slice(partnership[2].index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat)
      && entry.call.kind === 'bid')) return { forcing: 'one-round', convention: 'reverse', mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && fourthSuit(partnership)
    && !passedBefore(auction, partnership[3].seat, opening.index)
    && !all.some(prior => prior.index > partnership[3].index && sideOf(prior.seat) !== sideOf(seat)
      && atGame(prior.call) && !isArtificialBidAt(auction, prior.index, system)))
    return { forcing: 'one-round', convention: 'fourth-suit', mustBid: true, currentContractArtificial: true };
  if ((system === 'sayc' || system === 'two-over-one') && naturalOpening && partnerMadeLastPartnershipBid
    && opening.call.level === 1 && opening.call.strain !== 'NT' && opening.seat === seat
    && latestPartner?.seat === partnerOf(seat) && latestPartner.call.level === 3 && latestPartner.call.strain !== 'NT'
    && !partnership.slice(0, -1).some(entry => entry.call.strain === latestPartner.call.strain)
    && !passedBefore(auction, latestPartner.seat, opening.index)
    && !all.some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === latestPartner.call.strain)
    && !auction.slice(latestPartner.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid')
    && (partnership.length === 4 && response?.call.level === 1 && response.call.strain !== 'NT'
      || partnership.length === 3 && auction.some((entry, index) => index > opening.index && index < partnership[1].index
        && entry.seat === partnerOf(seat) && classifyDoubleAt(auction, index, system) === 'negative')))
    return { forcing: 'one-round', convention: 'responder-second-suit', mustBid: true, currentContractArtificial: false };
  if (system === 'sayc' && naturalOpening && partnership.length === 4 && opening.seat === seat
    && opening.call.level === 1 && opening.call.strain !== 'NT' && response.call.level === 1
    && response.call.strain !== 'NT' && partnership[2].call.strain === opening.call.strain
    && partnership[3].seat === response.seat && partnership[3].call.strain !== 'NT'
    && !partnership.slice(0, 3).some(entry => entry.call.strain === partnership[3].call.strain)
    && !passedBefore(auction, response.seat, opening.index)
    && !all.some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === partnership[3].call.strain)
    && !auction.slice(partnership[3].index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat)
      && entry.call.kind === 'bid'))
    return { forcing: 'one-round', convention: 'responder-second-suit', mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && system !== 'sayc' && newMinor(partnership)) return { forcing: 'one-round', convention: 'new-minor', mustBid: true, currentContractArtificial: true };
  if (naturalOpening && partnerMadeLastPartnershipBid && responderTrialBid(partnership)) return { forcing: 'one-round', convention: 'trial-bid', mustBid: true, currentContractArtificial: true };
  if (partnerMadeLastPartnershipBid && partnership.at(-1)?.call.level === 5 && partnership.at(-1)?.call.strain === 'NT'
    && partnership.some(entry => entry.call.level === 4 && entry.call.strain === 'NT'
      && isArtificialBidAt(auction, entry.index, system)))
    return { forcing: 'one-round', convention: 'king-ask', mustBid: true, currentContractArtificial: true };
  if (partnerMadeLastPartnershipBid && artificialAnswer(partnership, system, auction)) return { forcing: 'one-round', convention: 'artificial-answer', mustBid: true, currentContractArtificial: true };
  return { forcing: 'none', convention: 'none', mustBid: false, currentContractArtificial: false };
}

/** Conservative suit length promised by this player's public calls only.
 * A repeated secondary suit and a return to the original suit after showing
 * another suit must not inherit the six-card direct-rebid promise. */
export function naturalSuitMinimum(auction: AuctionEntry[], seat: Seat, suit: Suit, system: BiddingSystem): number {
  const all = bids(auction), side = all.filter(entry => sideOf(entry.seat) === sideOf(seat));
  const opening = side[0], response = side[1];
  const rebid = side[2], beforeRebid = rebid && all.findLast(entry => entry.index < rebid.index);
  const strongJumpShift = opening?.call.level === 1 && response?.call.level === 1
    && rebid?.seat === opening.seat && rebid.call.strain !== 'NT'
    && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain
    && beforeRebid && bidValue(rebid.call) - bidValue(beforeRebid.call) > 5;
  let minimum = strongJumpShift && opening.seat === seat && opening.call.strain === suit && !major(suit) ? 4 : 0;
  for (let index = 0; index < auction.length; index++) {
    if (auction[index].seat === seat) {
      const technical = publicTakeoutDoubleAt(auction, index, system);
      if (technical?.kind === 'reopening' && technical.preferredSuits.includes(suit)) minimum = Math.max(minimum, 3);
      if (technical?.kind === 'responsive' && technical.preferredSuits.includes(suit)) minimum = Math.max(minimum, 4);
    }
    if (auction[index].seat !== seat || !isNegativeDoubleAt(auction, index)) continue;
    const enemy = auction[all[0].index + 1].call;
    const unbidMajor = (['H', 'S'] as Suit[]).filter(candidate => candidate !== all[0].call.strain
      && enemy.kind === 'bid' && candidate !== enemy.strain);
    if (unbidMajor.includes(suit) || unbidMajor.length === 0 && !major(suit)) minimum = Math.max(minimum, 4);
  }
  for (const entry of side.filter(entry => entry.seat === seat)) {
    if (reverseMinorPreferenceAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 2);
      continue;
    }
    const secondaryMinorInvitation = publicSecondaryMinorInvitationAt(auction, entry.index, system);
    if (secondaryMinorInvitation) {
      if (suit === secondaryMinorInvitation.suit || suit === secondaryMinorInvitation.original) minimum = Math.max(minimum, 5);
      continue;
    }
    if (twoNTMinorEscapeAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 6); continue;
    }
    if (semiNTMinorInvitationShapeAt(auction, entry.index)) {
      if (suit === 'C') minimum = Math.max(minimum, 5); continue;
    }
    if (weakFiveSpadeReturnAt(auction, entry.index, system)) {
      if (suit === 'S') minimum = Math.max(minimum, 5); continue;
    }
    const ntMinor = publicNTNewMinorAt(auction, entry.index, system);
    if (ntMinor) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, ntMinor.length); continue;
    }
    const earlier = auction.slice(0, entry.index);
    const technical = earlier.findLastIndex((prior, at) => prior.seat === seat && isTakeoutDoubleAt(earlier, at));
    const partnerRequest = earlier.findLastIndex((prior, at) => prior.seat === partnerOf(seat) && isTakeoutDoubleAt(earlier, at, system));
    if (partnerRequest > technical && publicTakeoutDoubleAt(earlier, partnerRequest, system)?.kind === 'responsive'
      && !bids(earlier).some(prior => prior.seat === seat && prior.index > partnerRequest)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    if (takeoutCompetitiveRaiseAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    if (strongMichaelsRaiseAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 6);
      continue;
    }
    if (fourthSuitOriginalMajorAnswerAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 6);
      continue;
    }
    if (technical >= 0 && !bids(earlier).some(prior => prior.seat === seat)
      && !bids(earlier).some(prior => prior.seat === partnerOf(seat) && prior.call.strain === entry.call.strain
        && !isArtificialBidAt(earlier, prior.index, system))
      && !earlier.slice(technical + 1).some(prior => prior.call.kind === 'redouble')
      && analyzeAuctionSemantics(earlier, seat, system).convention !== 'takeout-cue'
      && entry.call.strain !== 'NT') {
      const naturalNTAnswer = bids(earlier).findLast(prior => prior.seat === partnerOf(seat)
        && prior.call.strain === 'NT' && !isArtificialBidAt(earlier, prior.index, system));
      if (entry.call.strain === suit) minimum = Math.max(minimum,
        major(suit) && entry.call.level === 4 && naturalNTAnswer ? 6 : 5);
      continue;
    }
    if (lowPointNaturalPreferenceAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 2);
      continue;
    }
    const interrupted = publicInterruptedStaymanBefore(auction.slice(0, entry.index), seat, system);
    if (interrupted && entry.call.level === 2 && entry.call.strain === 'S') {
      if (suit === 'S') minimum = Math.max(minimum, 4);
      continue;
    }
    if (semiNTMajorEscapeAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 6);
      continue;
    }
    if (semiNTWeakMajorAt(auction, entry.index, system) || negativeDoubleMinorContinuationAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 5);
      continue;
    }
    const competitiveReverse = competitiveOpenerReverseAt(auction, entry.index, system);
    if (competitiveReverse) {
      if (entry.call.strain === suit || competitiveReverse.opening.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    if (publicThreeLevelOvercallAdvanceAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 5);
      continue;
    }
    const selfLongGame = publicSelfLongMajorGameAt(auction, entry.index, system);
    if (selfLongGame) {
      if (suit === selfLongGame.primarySuit) minimum = Math.max(minimum, 6);
      continue;
    }
    if (publicStrictNTTwoMajorAt(auction, entry.index, system)) {
      if (major(suit)) minimum = Math.max(minimum, 5);
      continue;
    }
    const previousPartner = side.findLast(prior=>prior.index<entry.index&&prior.seat===partnerOf(seat));
    const precisionAnswer=previousPartner&&precisionConventionAt(auction,previousPartner.index,system);
    if(precisionAnswer&&['club-answer','shape-answer'].includes(precisionAnswer.stage)&&major(entry.call.strain)
      &&entry.call.strain===suit&&entry.call.level===4) {
      const partnerMinimum=naturalSuitMinimum(auction.slice(0,entry.index),partnerOf(seat),suit,system);
      minimum=Math.max(minimum,8-partnerMinimum); continue;
    }
    const precision = precisionConventionAt(auction,entry.index,system);
    if (precision) {
      if (precision.stage==='club-opening' || precision.stage==='club-answer') {
        if(suit==='C') minimum=Math.max(minimum,5);
        if(precision.stage==='club-answer' && major(entry.call.strain) && suit===entry.call.strain) minimum=Math.max(minimum,4);
      }
      if (precision.stage==='shape-opening') minimum=Math.max(minimum,suit==='C'?4:major(suit)?3:0);
      if (precision.stage==='shape-answer') {
        const shape:Record<string,Record<Suit,number>>={C:{S:4,H:4,D:1,C:4},D:{S:4,H:4,D:0,C:5},H:{S:4,H:3,D:1,C:5},S:{S:3,H:4,D:1,C:5}};
        minimum=Math.max(minimum,shape[entry.call.strain][suit]);
      }
      continue;
    }
    const partnerNegative = auction.findLastIndex((prior, index) => index < entry.index
      && prior.seat === partnerOf(seat) && isNegativeDoubleAt(auction, index));
    if (partnerNegative >= 0 && major(suit) && entry.call.strain === suit
      && !side.some(prior => prior.index < entry.index && prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system))) {
      const asked = publicCallMeaningAt(auction.slice(0, entry.index), partnerNegative, system).suitMinimums[suit];
      if (asked === 4) { minimum = Math.max(minimum, 4); continue; }
    }
    if (naturalStaymanAnswerAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    const relay = publicWeakMinorRelayAt(auction, entry.index, system);
    if (relay) {
      if (relay.stage === 'acceptance' && suit === 'C') minimum = Math.max(minimum, 2);
      if (relay.stage === 'correction' && suit === 'D') minimum = Math.max(minimum, 6);
      continue;
    }
    if (isBalancedNoTrumpAt(auction, entry.index, system)) minimum = Math.max(minimum, 2);
    if (entry.call.strain === suit && takeoutSupportInvitationAt(auction, entry.index, system)) {
      minimum = Math.max(minimum, 4); continue;
    }
    const before = side.filter(previous => previous.index < entry.index);
    const previous = before.at(-1);
    const ownPrior = before.filter(previous => previous.seat === seat
      && staymanContinuationAt(auction, previous.index, system)?.kind !== 'denial-major-unknown');
    if (opening?.index === all[0]?.index && opening.call.level === 1 && major(opening.call.strain)
      && response?.seat === seat && response.call.level === 1 && response.call.strain === 'NT'
      && ownPrior.length === 1 && entry.call.level === 3 && entry.call.strain === suit
      && suit !== opening.call.strain && suit !== side[2]?.call.strain
      && !analyzeAuctionSemantics(auction.slice(0, entry.index), seat, system).mustBid
      && !intervened(auction, seat, opening.index, entry.index)) {
      minimum = Math.max(minimum, 6); continue;
    }
    if (opening?.call.strain === 'NT' && opening.call.level === 1 && response?.index === entry.index
      && major(suit) && entry.call.strain === suit && entry.call.level === 4
      && isBalancedNoTrumpAt(auction, opening.index, system)
      && intervened(auction, seat, opening.index, entry.index)) {
      minimum = Math.max(minimum, 6); continue;
    }
    const staymanContinuation = staymanContinuationAt(auction, entry.index, system);
    if (newSuitOverStrongNTRebidAt(auction, entry.index, system)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    if (weakDoubledEscapeAt(auction, entry.index)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    const strongMinorTrial = publicStrongMinorTrialAt(auction, entry.index, system);
    if (strongMinorTrial) {
      if (suit === strongMinorTrial.trump) minimum = Math.max(minimum, strongMinorTrial.ownMinimum);
      continue;
    }
    const priorOwnTakeout = auction.findLastIndex((prior, at) => at < entry.index
      && prior.seat === seat && isTakeoutDoubleAt(auction, at));
    if (priorOwnTakeout >= 0 && ownPrior.length === 0 && entry.call.level <= 2
      && auction.slice(priorOwnTakeout + 1, entry.index).some(prior => sideOf(prior.seat) !== sideOf(seat)
        && prior.call.kind === 'redouble')) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    if (entry.call.level >= 4 && !major(entry.call.strain) && opening?.seat !== seat
      && opening?.index === all[0]?.index && (ownPrior.length > 0
        || auction.some((prior, at) => at < entry.index && prior.seat === seat && prior.call.kind === 'double'))
      && !ownPrior.some(prior => prior.call.strain === entry.call.strain && !isArtificialBidAt(auction, prior.index, system))
      && !before.some(prior => prior.seat === partnerOf(seat) && prior.call.strain === entry.call.strain
        && !isArtificialBidAt(auction, prior.index, system))
      && analyzeAuctionSemantics(auction.slice(0, entry.index), seat, system).forcing === 'game') {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 5);
      continue;
    }
    if (naturalMinorSlamTryAt(auction, entry.index)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 6);
      continue;
    }
    if (staymanContinuation?.kind === 'denial-major-unknown') continue;
    if (staymanContinuation?.kind === 'other-major-invitation') {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    const previousPartnerInvitation = before.findLast(prior => prior.seat === partnerOf(seat));
    const invitedOtherMajor = previousPartnerInvitation
      && staymanContinuationAt(auction, previousPartnerInvitation.index, system);
    if (invitedOtherMajor?.kind === 'other-major-invitation' && invitedOtherMajor.platform.seat === seat
      && entry.call.level === 3 && entry.call.strain === previousPartnerInvitation!.call.strain) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 4);
      continue;
    }
    if (keycardContinuationAt(auction, entry.index, system)?.role.endsWith('answer')) continue;
    if (staymanContinuation?.kind === 'other-major-game-force') {
      if (entry.call.strain === suit) minimum = Math.max(minimum, staymanContinuation.platform.call.level === 1 ? 5 : 4);
      if (staymanContinuation.answer.call.strain === 'S' && suit === 'S') minimum = Math.max(minimum, 4);
      continue;
    }
    const jacoby = opening?.index === all[0]?.index && opening.call.level === 1 && major(opening.call.strain)
      && response?.call.level === 2 && response.call.strain === 'NT'
      && isArtificialBidAt(auction, response.index, system);
    if (jacoby && entry.index > response.index && entry.call.strain === opening.call.strain) {
      if (suit === opening.call.strain) minimum = Math.max(minimum, entry.seat === opening.seat ? 5 : 4);
      continue;
    }
    if (isArtificialBidAt(auction, entry.index, system)) {
      const context = analyzeAuctionSemantics(auction.slice(0, entry.index + 1), partnerOf(seat), system);
      if (entry.call.strain === 'NT' && entry.call.level === 2 && opening?.index === all[0]?.index
        && opening.call.level === 1 && major(opening.call.strain) && entry.index === response?.index
        && opening.call.strain === suit) minimum = Math.max(minimum, 4);
      if (['overcall-cue', 'competitive-cue'].includes(context.convention) && previous?.call.strain === suit) {
        const partnerLength = naturalSuitMinimum(auction.slice(0, entry.index), partnerOf(seat), suit, system);
        const firstNaturalSupport = !ownPrior.some(prior => prior.call.strain===suit&&!isArtificialBidAt(auction, prior.index, system));
        const firstOpenerCue=opening?.index===all[0]?.index&&seat===opening.seat;
        if (!firstOpenerCue&&firstNaturalSupport&&partnerLength>=5 || minimum+partnerLength>=8)
          minimum = Math.max(minimum, context.forcing === 'game' ? Math.max(3, 8 - partnerLength) : 3);
      }
    }
    if ((system === 'sayc' || system === 'two-over-one') && ntMinorCorrectionAt(auction, entry.index)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 5);
      continue;
    }
    if (system === 'sayc' && weakMinorContinuationAt(auction, entry.index)) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, 6);
      continue;
    }
    const enemyOpening = all[0];
    const lastBeforeOvercall = all.findLast(prior => prior.index < entry.index);
    if (opening?.index === entry.index && entry.index !== enemyOpening?.index
      && !auction.slice(0, entry.index).some(prior => sideOf(prior.seat) === sideOf(seat) && prior.call.kind !== 'pass')
      && !isArtificialBidAt(auction, entry.index, system) && lastBeforeOvercall
      && bidValue(entry.call) - bidValue(lastBeforeOvercall.call) > 5) {
      if (entry.call.strain === suit) minimum = Math.max(minimum, entry.call.level + 4);
      continue;
    }
    const directTwoSuiter = system === 'sayc' && enemyOpening?.call.level === 1
      && sideOf(enemyOpening.seat) !== sideOf(seat) && entry.index === enemyOpening.index + 1
      && entry.call.level === 2;
    if (directTwoSuiter && enemyOpening.call.strain !== 'NT' && entry.call.strain === enemyOpening.call.strain) {
      const shown = major(enemyOpening.call.strain)
        ? [enemyOpening.call.strain === 'H' ? 'S' : 'H'] : ['H', 'S'];
      if (shown.includes(suit)) minimum = Math.max(minimum, 5);
    }
    if (directTwoSuiter && entry.call.strain === 'NT') {
      const shown = enemyOpening.call.strain === 'NT' ? ['C', 'D']
        : (['C', 'D', 'H', 'S'] as Suit[]).filter(candidate => candidate !== enemyOpening.call.strain).slice(0, 2);
      if (shown.includes(suit)) minimum = Math.max(minimum, 5);
    }
    const nt = previous && isNaturalNoTrumpAt(auction, previous.index, system);
    const ntPlatform = before.length === 1 || before.length === 3 && before[0].call.strain === 'C'
      && (before[0].call.level === 2 || system === 'precision' && before[0].call.level === 1);
    if (nt && ntPlatform && entry.call.level === previous!.call.level + 1) {
      const transferred = entry.call.strain === 'D' ? 'H' : entry.call.strain === 'H' ? 'S' : undefined;
      if (transferred === suit) minimum = Math.max(minimum, 5);
    }
    const staymanPlatform = before.at(-3), staymanRequest = before.at(-2), staymanAnswer = before.at(-1);
    if (staymanPlatform?.call.strain === 'NT' && staymanRequest?.seat === seat && staymanRequest.call.strain === 'C'
      && staymanRequest.call.level === staymanPlatform.call.level + 1 && staymanAnswer?.call.level === staymanRequest.call.level
      && major(staymanAnswer.call.strain) && major(entry.call.strain) && entry.call.strain !== staymanAnswer.call.strain
      && bidValue(entry.call) - bidValue(staymanAnswer.call) <= 5 && isNaturalNoTrumpAt(auction, staymanPlatform.index, system)) {
      if (suit === entry.call.strain) minimum = Math.max(minimum, 4);
      if (entry.call.strain === suit) continue;
    }
    if (entry.call.strain !== suit || isArtificialBidAt(auction, entry.index, system)) continue;
    if (opening?.index === all[0]?.index && entry.seat === opening.seat && entry.call.level === 1
      && ownPrior.length === 1 && opening.call.strain !== suit) {
      minimum = Math.max(minimum, 4); continue;
    }
    const inquiry = before.at(-2), platform = before.at(-3);
    const genuineInquiryPlatform = inquiry && (before.length === 2
      || before.length === 4 && opening?.index === all[0]?.index && opening.call.strain === 'C'
        && (opening.call.level === 2 || system === 'precision' && opening.call.level === 1));
    if (genuineInquiryPlatform && previous?.call.strain === 'C' && inquiry?.call.strain === 'NT'
      && previous.call.level === inquiry.call.level + 1 && entry.call.level === previous.call.level
      && major(suit) && isNaturalNoTrumpAt(auction, inquiry.index, system)) {
      minimum = Math.max(minimum, 4); continue;
    }
    if (previous && platform === undefined && inquiry && isNaturalNoTrumpAt(auction, inquiry.index, system)
      && previous.call.level === inquiry.call.level + 1
      && (previous.call.strain === 'D' && suit === 'H' || previous.call.strain === 'H' && suit === 'S')) {
      minimum = Math.max(minimum, 2); continue;
    }
    // Transfers on a strong-2C NT platform have two extra partnership calls.
    if (previous && inquiry && isNaturalNoTrumpAt(auction, inquiry.index, system)
      && previous.call.level === inquiry.call.level + 1
      && (previous.call.strain === 'D' && suit === 'H' || previous.call.strain === 'H' && suit === 'S')) {
      minimum = Math.max(minimum, 2); continue;
    }
    if (all[0]?.index === entry.index) {
      minimum = Math.max(minimum, entry.call.level === 1 ? major(suit) ? 5 : system === 'precision' && suit === 'D' ? 2 : 3
        : entry.call.level === 2 ? 6 : entry.call.level === 3 ? 7 : 8); continue;
    }
    if (opening?.index === all[0]?.index && response?.index === entry.index
      && (system === 'sayc' || system === 'two-over-one') && isTwoOverOne(opening, response, auction)) {
      minimum = Math.max(minimum, suit === 'C' ? 3 : suit === 'D' ? 4 : 5); continue;
    }
    const repeated = ownPrior.some(prior => prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system));
    const original = ownPrior.find(prior => prior.call.strain !== 'NT' && !isArtificialBidAt(auction, prior.index, system));
    if (repeated) {
      if (original?.call.strain === suit) {
        if (staymanContinuationAt(auction, original.index, system)?.kind === 'other-major-invitation') {
          minimum = Math.max(minimum, 4); continue;
        }
        const supportedByCue = before.some(prior => prior.seat === partnerOf(seat)
          && publicCallMeaningAt(auction.slice(0, entry.index), prior.index, system).role === 'cue'
          && (publicCallMeaningAt(auction.slice(0, entry.index), prior.index, system).suitMinimums[suit] ?? 0) >= 3);
        if (supportedByCue) continue;
        const originalWasSupport = all.some(prior => prior.index < original.index && prior.seat === partnerOf(seat)
          && prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system));
        if (originalWasSupport) continue;
        if (ownPrior.some(prior => isNaturalNoTrumpAt(auction, prior.index, system))) {
          // A transfer acceptance remains support even after strong 2C–NT.
          minimum = Math.max(minimum, 3); continue;
        }
        if ((system === 'sayc' || system === 'two-over-one') && opening?.seat === seat && opening.index === all[0]?.index
          && opening.call.level === 2 && opening.call.strain === 'C') {
          // The first natural strong-club minor may come from 4441. Repeating
          // that suit does not add a fifth card to the public promise.
          minimum = Math.max(minimum, major(suit) ? 5 : 4); continue;
        }
        const otherSuit = ownPrior.some(prior => prior.call.strain !== 'NT' && prior.call.strain !== suit
          && !isArtificialBidAt(auction, prior.index, system));
        const gameForce = opening && response && isTwoOverOne(opening, response, auction);
        if (opening?.index === all[0]?.index && opening.seat === seat && opening.call.level === 1 && major(suit)
          && response?.call.level === 2 && response.call.strain !== 'NT' && response.call.strain !== suit
          && passedBefore(auction, response.seat, opening.index) && entry.call.level === 2) {
          minimum = Math.max(minimum, 5); continue;
        }
        if (gameForce && !major(suit)) {
          // Responder's 2/1 clubs may be three, diamonds four. Opener's
          // natural original-minor rebid is at least four (including 4441).
          if (opening.seat === seat) minimum = Math.max(minimum, 4);
          continue;
        }
        const lastBefore = all.findLast(prior => prior.index < entry.index);
        const jumpMinor = !major(suit) && lastBefore && bidValue(entry.call) - bidValue(lastBefore.call) > 5;
        const nonJump = lastBefore && bidValue(entry.call) - bidValue(lastBefore.call) <= 5;
        if (major(suit) && nonJump && analyzeAuctionSemantics(auction.slice(0, entry.index), seat, system).forcing === 'game') {
          minimum = Math.max(minimum, 5); continue;
        }
        if (major(suit) && nonJump && opening?.seat !== seat
          && (strongJumpShift || reverseByOpener(side.slice(0, 3), auction))) {
          minimum = Math.max(minimum, 5); continue;
        }
        const originalIsOvercall = all[0] && sideOf(all[0].seat) !== sideOf(seat);
        const competitiveRepeat = all.some(prior => prior.index > original.index && prior.index < entry.index
          && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system));
        const raisedFit = before.some(prior => prior.seat === partnerOf(seat) && prior.call.strain === suit
          && !isArtificialBidAt(auction, prior.index, system));
        if (raisedFit && entry.call.level >= gameLevel(suit)) {
          minimum = Math.max(minimum, 8 - naturalSuitMinimum(auction.slice(0, entry.index), partnerOf(seat), suit, system));
          continue;
        }
        if (raisedFit && nonJump) continue;
        minimum = Math.max(minimum, !major(suit) && nonJump && competitiveRepeat ? 4
          : otherSuit && strongJumpShift && !major(suit) ? 4
          : otherSuit || gameForce || major(suit) && nonJump && (originalIsOvercall || competitiveRepeat || raisedFit)
            ? 5 : major(suit) || jumpMinor ? 6 : 5);
      }
      continue;
    }
    if (opening && opening.seat === partnerOf(seat) && opening.index !== all[0]?.index
      && isArtificialBidAt(auction, opening.index, system)
      && naturalSuitMinimum(auction.slice(0, entry.index), partnerOf(seat), suit, system) >= 5) {
      const previousBid = all.findLast(prior => prior.index < entry.index);
      minimum = Math.max(minimum, entry.call.level >= gameLevel(suit) || !previousBid
        || bidValue(entry.call) - bidValue(previousBid.call) > 5 ? 3 : 1); continue;
    }
    const partnerSuit = before.findLast(prior => prior.seat === partnerOf(seat) && prior.call.strain === suit
      && !isArtificialBidAt(auction, prior.index, system));
    if (partnerSuit) {
      if (staymanContinuationAt(auction, partnerSuit.index, system)?.kind === 'denial-major-unknown') continue;
      const previousBid = all.findLast(prior => prior.index < entry.index);
      const openerRaise = opening?.seat === seat && partnerSuit.index === response?.index && ownPrior.length === 1;
      const preference = naturalPreferenceAt(auction, entry.index, system);
      const promised = naturalSuitMinimum(auction.slice(0, entry.index), partnerOf(seat), suit, system);
      if (!major(suit) && entry.call.level === 4 && previousBid
        && bidValue(entry.call) - bidValue(previousBid.call) <= 5) {
        minimum = Math.max(minimum, 3, 8 - promised); continue;
      }
      if (major(suit) && promised >= 6 && entry.call.level === 3 && ownPrior.length > 0
        && opening?.index === all[0]?.index && opening.call.level === 1 && opening.seat !== seat
        && !analyzeAuctionSemantics(auction.slice(0, entry.index), seat, system).mustBid
        && !all.some(prior => prior.index > partnerSuit.index && prior.index < entry.index
          && sideOf(prior.seat) !== sideOf(seat))) {
        minimum = Math.max(minimum, 2); continue;
      }
      if (openerRaise && major(suit) && entry.call.level === 3 && previousBid
        && bidValue(entry.call) - bidValue(previousBid.call) > 5) {
        minimum = Math.max(minimum, 4, 8 - promised); continue;
      }
      const weakTwoOpening = opening?.index === all[0]?.index && opening.call.level === 2
        && ['D', 'H', 'S'].includes(opening.call.strain);
      if (!preference && weakTwoOpening && opening.seat === seat && response?.index === partnerSuit.index
        && major(suit) && entry.call.level === 3 && suit !== opening.call.strain) {
        minimum = Math.max(minimum, 3); continue;
      }
      if (!preference && weakTwoOpening && opening.seat !== seat && ownPrior.length === 0
        && partnerSuit.index === opening.index && suit === opening.call.strain && entry.call.level < gameLevel(suit)) {
        minimum = Math.max(minimum, 3); continue;
      }
      if (!preference && entry.call.level >= gameLevel(suit) && promised > 0) {
        minimum = Math.max(minimum, Math.max(0, 8 - promised)); continue;
      }
      if (!preference && openerRaise && opening?.index === all[0]?.index && response
        && isTwoOverOne(opening, response, auction) && major(suit)) {
        minimum = Math.max(minimum, 3); continue;
      }
      if (!preference && opening?.index !== all[0]?.index && promised >= 5) {
        minimum = Math.max(minimum, entry.call.level === 3 && promised >= 6 ? 2 : 3); continue;
      }
      const competitiveRaise = openerRaise && all.some(prior => prior.index > opening.index && prior.index < entry.index
        && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system));
      const quietOpenerRaise = opening?.seat === seat && opening.index === all[0]?.index
        && ownPrior.length === 1
        && !['fourth-suit', 'new-minor'].includes(analyzeAuctionSemantics(auction.slice(0, entry.index), seat, system).convention)
        && !all.some(prior => prior.index > opening.index && prior.index < entry.index
          && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system));
      minimum = Math.max(minimum, preference ? 2 : major(suit) ? (openerRaise && !competitiveRaise || quietOpenerRaise) ? 4 : 3
        : ownPrior.length === 0 && opening?.index === partnerSuit.index ? 5
          : opening?.call.level === 2 && opening.call.strain !== 'C' && opening.call.strain !== 'NT'
            && opening.seat === seat && partnerSuit.call.level === 3 ? 3 : 4);
      if (major(suit) && !preference && opening?.call.strain !== suit && !openerRaise && opening?.seat !== seat) minimum = Math.max(minimum, 4);
      if (!preference && opening?.seat !== seat && ownPrior.length > 0 && entry.call.level === 3
        && !competitiveRaise && !all.some(prior => prior.index > partnerSuit.index && prior.index < entry.index
          && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system))
        && !analyzeAuctionSemantics(auction.slice(0, entry.index), seat, system).mustBid) {
        minimum = Math.max(minimum, Math.max(major(suit) && promised >= 6 ? 2 : 3, 8 - promised));
      }
      continue;
    }
    const ownDouble = auction.findLastIndex((prior, index) => index < entry.index
      && prior.seat === seat && isTakeoutDoubleAt(auction, index));
    if (ownDouble >= 0 && ownPrior.length === 0) {
      const advance = before.find(prior => prior.index > ownDouble && prior.seat === partnerOf(seat));
      if (advance && isArtificialBidAt(auction, advance.index, system)) {
        minimum = Math.max(minimum, 3); continue;
      }
      const lastBeforeAdvance = advance && all.findLast(prior => prior.index < advance.index);
      const minimumAdvance = advance && lastBeforeAdvance && bidValue(advance.call) - bidValue(lastBeforeAdvance.call) <= 5;
      if (advance && lastBeforeAdvance && bidValue(advance.call) - bidValue(lastBeforeAdvance.call) > 5
        && entry.call.level === 4 && major(entry.call.strain) && entry.call.strain !== advance.call.strain) {
        if (entry.call.strain === suit) minimum = Math.max(minimum, 6);
        continue;
      }
      minimum = Math.max(minimum, advance?.call.strain === 'NT' && major(suit) && entry.call.level === 4 ? 6 : minimumAdvance ? 5 : 4); continue;
    }
    const takeout = auction.findLastIndex((prior, index) => index < entry.index
      && prior.seat === partnerOf(seat) && isTakeoutDoubleAt(auction, index));
    const lastBid = all.findLast(prior => prior.index < entry.index);
    if (takeout >= 0 && ownPrior.length === 0) {
      const jump = lastBid && bidValue(entry.call) - bidValue(lastBid.call) > 5;
      const enemySuits = new Set(all.filter(prior => prior.index < takeout && sideOf(prior.seat) !== sideOf(seat)
        && prior.call.strain !== 'NT' && !isArtificialBidAt(auction, prior.index, system)).map(prior => prior.call.strain));
      const free = all.some(prior => prior.index > takeout && prior.index < entry.index && sideOf(prior.seat) !== sideOf(seat));
      minimum = Math.max(minimum, enemySuits.size === 3 && !jump && !free ? 0 : jump || enemySuits.size > 1 || free ? 4 : 3); continue;
    }
    if (system === 'precision' && opening?.call.level === 1 && opening.call.strain === 'C'
      && response?.index === entry.index && major(suit)) {
      minimum = Math.max(minimum, 5); continue;
    }
    if (opening?.index === all[0]?.index && opening.call.level === 1 && major(opening.call.strain)
      && response?.seat === seat && response.call.level === 1 && response.call.strain === 'NT'
      && ownPrior.length === 1 && entry.call.level === 3 && major(suit) && lastBid
      && (bidValue(entry.call) - bidValue(lastBid.call) > 5
        || entry.call.strain !== opening.call.strain && entry.call.strain !== side[2]?.call.strain)) {
      minimum = Math.max(minimum, 6); continue;
    }
    if (opening?.index === all[0]?.index && opening.call.level === 1
      && (opening.call.strain === 'C' || opening.call.strain === 'D') && response?.index === entry.index
      && suit === 'S' && entry.call.level === 1
      && all.some(prior => prior.index > opening.index && prior.index < entry.index
        && sideOf(prior.seat) !== sideOf(seat) && prior.call.strain === 'H'
        && !isArtificialBidAt(auction, prior.index, system))) {
      minimum = Math.max(minimum, 5); continue;
    }
    if ((system === 'sayc' || system === 'two-over-one') && opening?.seat === seat && opening.index === all[0]?.index
      && opening.call.level === 2 && opening.call.strain === 'C' && !major(suit)
      && !ownPrior.some(prior => !isArtificialBidAt(auction, prior.index, system))) {
      minimum = Math.max(minimum, 4); continue;
    }
    if (opening?.index === all[0]?.index && response?.index === entry.index
      && entry.call.level === 2 && suit === 'D' && passedBefore(auction, seat, opening.index)
      && !intervened(auction, seat, opening.index, entry.index)) {
      minimum = Math.max(minimum, 4); continue;
    }
    minimum = Math.max(minimum, ownPrior.some(prior => !isArtificialBidAt(auction, prior.index, system))
      || opening?.seat !== seat && entry.call.level === 1 ? 4 : 5);
  }
  return minimum;
}

export type PublicCallRole = 'pass' | 'double' | 'redouble' | 'natural-opening' | 'strong-opening'
  | 'natural-overcall' | 'natural-response' | 'semi-forcing-nt' | 'passed-hand-nt' | 'natural-nt'
  | 'stayman' | 'stayman-answer' | 'stayman-other-major-invitation' | 'unmapped-stayman-major'
  | 'transfer' | 'transfer-acceptance' | 'takeout-free-response' | 'takeout-minimum-response'
  | 'takeout-strong-rebid' | 'takeout-long-major-game' | 'fourth-suit' | 'fourth-suit-nt-answer' | 'passed-second-suit'
  | 'natural-nt-minor-correction'
  | 'natural-preference' | 'support-cue-continuation' | 'jacoby-rebid' | 'jacoby-continuation' | 'stayman-other-major-game-force'
  | 'responder-second-suit' | 'natural-second-suit' | 'natural-repeat' | 'natural-support'
  | 'competitive-support' | 'cue' | 'michaels' | 'unusual' | 'michaels-minor-answer' | 'two-suit-choice'
  | 'weak-minor-escape' | 'long-minor-invitation' | 'artificial-response'
  | 'takeout-support-invitation' | 'takeout-minor-invitation' | 'preempt-nt-competitive-response'
  | 'keycard-ask' | 'keycard-signoff' | 'keycard-answer' | 'queen-ask' | 'queen-answer' | 'king-ask' | 'king-answer'
  | 'control-cue' | 'weak-feature-inquiry' | 'weak-feature-answer' | 'minor-slam-try' | 'weak-doubled-escape'
  | 'weak-minor-relay' | 'weak-minor-relay-acceptance' | 'weak-minor-relay-correction' | 'takeout-cue-continuation' | 'precision-negative-pass'
  | 'stronger-minor-invitation' | 'nt-competitive-weak-response' | 'nt-competitive-minor-escape' | 'semi-nt-new-major' | 'accepted-invitation'
  | 'precision-opening' | 'precision-inquiry' | 'precision-answer' | 'precision-negative' | 'weak-preempt-minor-correction'
  | 'strict-nt-two-major-game-force' | 'weak-takeout-redoubled-escape' | 'nt-competitive-major-game'
  | 'semi-nt-new-major-invitation' | 'semi-nt-new-minor-invitation' | 'semi-nt-major-escape'
  | 'strong-minor-control-trial' | 'strong-club-negative-pass' | 'michaels-inquiry' | 'preempt-natural-nt' | 'unknown';
export interface PublicStopperSource { suit: Suit; index: number; seat: Seat }
function stopperDescription(sources: PublicStopperSource[], index: number, actor: Seat): string {
  const suitNames: Record<Suit, string> = { C: '梅花C', D: '方块D', H: '红心H', S: '黑桃S' };
  return sources.length ? sources.map(source => `${suitNames[source.suit]}止张${source.index === index
    ? '由本次自然NT承诺' : `依此前${source.seat}第${source.index + 1}步的公开NT承诺${source.seat === actor ? '保留' : '，来自同伴'}`}`).join('、')
    : '公开前缀没有额外指定敌套止张，不虚构任何止张来源';
}
export interface PublicCallMeaning {
  index: number;
  seat: Seat;
  role: PublicCallRole;
  roleLabel: string;
  defined: boolean;
  artificial: boolean;
  hcpRange?: PointRange;
  minorInvitationShape?: NonNullable<ReturnType<typeof semiNTMinorInvitationShapeAt>>;
  longMinorNTAlternative?: { suit: Suit; minLength: 7; minHcp: 19; minSideAces: 2; requiredHonors: 'AKQ';
    sixCardSource?: { minLength: 6; minHcp: 19; minSideAKSuits: 2; requiredHonorsOrConnectedHonors: 'AK';
      alternativeMinQueenHigher: 2; alternativeMinTenHigher: 3 } };
  strictBalancedShapeFamily?: Array<'4333' | '4432' | '5332'>;
  allowedShapeFamily?: Array<'4333' | '4432' | '5332' | '5422' | '6322'>;
  playingSourceCompensation?: { normalHcpMinimum: number; minHcp: number; suit: Suit; minLength: number;
    minKingOrAce: number; minQueenOrHigher: number; minTenOrHigher: number;
    normalMinKingOrAce?: number; normalMinQueenOrHigher?: number; normalMinTenOrHigher?: number;
    extraLongAlternative?: { minHcp: number; minLength: number; minKingOrAce: number; minQueenOrHigher: number; minTenOrHigher: number };
    maxOtherSuitLength?: { suit: Suit; max: number } };
  selfLongGameQualification?: NonNullable<ReturnType<typeof publicSelfLongMajorGameAt>>;
  supportRange?: { trump: Suit; min: number; max: number };
  suitMinimums: Partial<Record<Suit, number>>;
  suitMaximums?: Partial<Record<Suit, number>>;
  suitMinimum?: number;
  /** Actor's natural promise before this call; never the post-call minimum. */
  priorSuitMinimum?: number;
  agreedTrump?: Suit;
  jointSupportFloor?: { trump: Suit; total: number; invitationIndex: number };
  controlSuits?: Partial<Record<Suit, 'first-or-second-round'>>;
  forcing: ForcingLevel;
  invitation: boolean;
  intent: 'answer' | 'competitive' | 'invitation' | 'grand-inv' | 'signoff' | 'descriptive' | 'inquiry';
  request?: string;
  stopperSources: PublicStopperSource[];
  description?: string;
}
export interface PublicPlayerConstraints {
  ruleOf20Opening?: boolean;
  controlSuits?: Partial<Record<Suit, 'first-or-second-round'>>;
  hcpRange?: PointRange;
  strictBalancedShapeFamily?: Array<'4333' | '4432' | '5332'>;
  allowedShapeFamily?: Array<'4333' | '4432' | '5332' | '5422' | '6322'>;
  supportRanges: Partial<Record<Suit, PointRange>>;
  suitMinimums: Record<Suit, number>;
  suitMaximums?: Partial<Record<Suit, number>>;
  stopperSources: PublicStopperSource[];
  lengthSources: Array<{ suit: Suit; minimum: number; index: number }>;
  pointSources: Array<{ index: number; type: 'hcp' | 'support'; range: PointRange; trump?: Suit;
    sourceTrumpMinimum?: number; sourcePartnerTrumpMinimum?: number;
    playingSourceCompensation?: PublicCallMeaning['playingSourceCompensation'];
    minorInvitationShape?: PublicCallMeaning['minorInvitationShape'] }>;
  jointSupportSources?: Array<{ index: number; trump: Suit; total: number; invitationIndex: number }>;
}

/** Enemy stoppers promised by an earlier natural NT remain after transfers,
 * preferences, and other later bids. No hand is inspected by this module. */
function ntStopperSources(auction: AuctionEntry[], index: number, system: BiddingSystem): PublicStopperSource[] {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.strain !== 'NT' || isArtificialBidAt(auction, index, system)) return [];
  const enemies = bids(auction.slice(0, index)).filter(prior => sideOf(prior.seat) !== sideOf(entry.seat));
  const enemySuits = enemies.flatMap(prior => {
    if (!isArtificialBidAt(auction, prior.index, system)) return prior.call.strain === 'NT' ? [] : [prior.call.strain as Suit];
    const meaning = publicCallMeaningAt(auction, prior.index, system);
    return ['michaels', 'unusual', 'michaels-minor-answer'].includes(meaning.role)
      ? (['C', 'D', 'H', 'S'] as Suit[]).filter(suit => (meaning.suitMinimums[suit] ?? 0) >= 5) : [];
  });
  const previousNT = bids(auction.slice(0, index)).findLast(prior => sideOf(prior.seat) === sideOf(entry.seat)
    && prior.call.strain === 'NT' && !isArtificialBidAt(auction, prior.index, system));
  const retained = previousNT ? ntStopperSources(auction, previousNT.index, system) : [];
  const priorSemantics = analyzeAuctionSemantics(auction.slice(0, index), entry.seat, system);
  const lastPartner = bids(auction.slice(0, index)).findLast(prior => prior.seat === partnerOf(entry.seat));
  const fourthSuitRequest = priorSemantics.convention === 'fourth-suit'
    || lastPartner && publicCallMeaningAt(auction, lastPartner.index, system).role === 'fourth-suit' ? lastPartner
    : bids(auction.slice(0, index)).findLast(prior => prior.seat === entry.seat
      && publicCallMeaningAt(auction.slice(0, index), prior.index, system).role === 'fourth-suit');
  const promised = [...enemySuits, ...retained.map(source => source.suit)];
  if (fourthSuitRequest && fourthSuitRequest.call.strain !== 'NT') promised.push(fourthSuitRequest.call.strain);
  return [...new Set(promised)].map(suit =>
    retained.find(source => source.suit === suit) ?? { suit, index, seat: entry.seat });
}

/** Canonical meaning of one call, bound to its own prefix. Consumers must not
 * supply future bids or hidden hands to infer an extra range or suit length. */
const publicCallCache = new Map<string, PublicCallMeaning>();
const publicConstraintCache = new Map<string, PublicPlayerConstraints>();
const callCacheLimit = 5000, constraintCacheLimit = 10000;

function publicPrefixKey(auction: AuctionEntry[], index: number, system: BiddingSystem, actor: Seat) {
  return JSON.stringify([system, index, actor, auction.slice(0, index + 1).map(entry =>
    entry.call.kind === 'bid' ? [entry.seat, 'bid', entry.call.level, entry.call.strain] : [entry.seat, entry.call.kind])]);
}
function rememberPublic<T>(cache: Map<string, T>, key: string, value: T, limit: number) {
  // The consumer never receives the stored object, including nested ranges,
  // source arrays and suit maps. Cache keys contain only public information.
  if (cache.size >= limit) cache.delete(cache.keys().next().value!);
  cache.set(key, structuredClone(value));
}
/** Reset bounded public caches, useful for cold/hot equivalence checks. */
export function clearPublicMeaningCaches() {
  publicCallCache.clear(); publicConstraintCache.clear();
}

export function publicCallMeaningAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): PublicCallMeaning {
  const entry = auction[index];
  if (!entry) throw new RangeError('Public call meaning requires an existing auction entry');
  const key = publicPrefixKey(auction, index, system, entry.seat), cached = publicCallCache.get(key);
  if (cached) return structuredClone(cached);
  const result = computePublicCallMeaningAt(auction, index, system);
  rememberPublic(publicCallCache, key, result, callCacheLimit);
  return result;
}

function computePublicCallMeaningAt(auction: AuctionEntry[], index: number, system: BiddingSystem): PublicCallMeaning {
  const entry = auction[index];
  if (!entry) throw new RangeError('Public call meaning requires an existing auction entry');
  const prefix = auction.slice(0, index + 1), before = prefix.slice(0, -1);
  const all = bids(prefix), side = all.filter(prior => sideOf(prior.seat) === sideOf(entry.seat));
  const opening = all[0], ourOpening = side[0], response = side[1];
  const ownPrior = side.filter(prior => prior.seat === entry.seat && prior.index < index);
  const partner = side.findLast(prior => prior.seat === partnerOf(entry.seat) && prior.index < index);
  const target = entry.call;
  const after = analyzeAuctionSemantics(prefix, partnerOf(entry.seat), system);
  const forcedBefore = analyzeAuctionSemantics(before, entry.seat, system);
  const result: PublicCallMeaning = {
    index, seat: entry.seat, role: 'unknown', roleLabel: '未分类续叫', defined: false,
    artificial: target.kind === 'bid' && isArtificialBidAt(prefix, index, system),
    suitMinimums: {}, forcing: after.forcing, invitation: false, intent: 'descriptive', stopperSources: [],
  };
  const set = (role: PublicCallRole, label: string, description?: string) => {
    result.role = role; result.roleLabel = label; result.defined = true;
    if (description) result.description = description;
  };
  const hcp = (min: number, max = 40) => {
    const prior = publicPlayerConstraints(before, entry.seat, system).hcpRange;
    result.hcpRange = { min: Math.max(min, prior?.min ?? 0), max: Math.min(max, prior?.max ?? 40) };
  };
  const length = (suit: Suit, minimum: number) => {
    if (minimum > 0) result.suitMinimums[suit] = minimum;
    if (target.kind === 'bid' && target.strain === suit) result.suitMinimum = minimum || undefined;
  };
  const precision = precisionConventionAt(prefix,index,system);
  if(precision) {
    const stage=precision.stage;
    set(stage==='negative'?'precision-negative':stage.endsWith('inquiry')?'precision-inquiry':stage.endsWith('answer')?'precision-answer':'precision-opening','精确制原有开叫／询问协议');
    result.artificial=!['club-opening','club-answer'].includes(stage);
    result.intent=stage.endsWith('inquiry')?'inquiry':stage.endsWith('answer')||stage==='negative'?'answer':'descriptive';
    if(stage==='negative') {
      hcp(0,7); result.forcing='one-round'; result.description='精确强1C后的1D负应：0–7 HCP，人工不承诺方块长度；强开叫人须继续自然描述，不作8+正应或弱二方块套';
    } else if(stage.endsWith('inquiry')) {
      hcp(0); result.forcing='one-round';
      result.description=stage==='club-inquiry'?'精确限制性2C后的2D人工询问四张高花；不承诺方块长度、不作强梅花二次负应，开叫人须回答2H/2S，或按高低限2NT/3C':'精确短方块2D后的2NT人工牌型询问；不承诺均型或自然无将点窗，开叫人须按四个约定形状回答';
    } else {
      hcp(stage==='club-answer'&&target.kind==='bid'&&target.strain==='NT'?14:11,
        stage==='club-answer'&&target.kind==='bid'&&target.strain==='C'?13:15);
      result.forcing=stage==='shape-answer'?'one-round':'none';
      if(stage==='club-opening'||stage==='club-answer') {
        length('C',5);
        if(stage==='club-answer'&&target.kind==='bid'&&major(target.strain)) length(target.strain as Suit,4);
        result.description=stage==='club-opening'?'精确自然2C限制性开叫：11–15 HCP，六张梅花或五张梅花加四张高花；公共最低五C，不是SAYC22+强2C':'精确2C–2D询问后的回答：2H/2S显示真实四张该高花，2NT为14–15且否认四张高花，3C为11–13；保留原五张以上梅花，完成询问后不逼叫';
      } else {
        const shapes:Record<string,Record<Suit,number>>={C:{S:4,H:4,D:1,C:4},D:{S:4,H:4,D:0,C:5},H:{S:4,H:3,D:1,C:5},S:{S:3,H:4,D:1,C:5}};
        const shape=stage==='shape-answer'&&target.kind==='bid'?shapes[target.strain]:{C:4,D:0,H:3,S:3};
        for(const s of ['C','D','H','S'] as Suit[]) length(s,shape[s]);
        result.suitMaximums=stage==='shape-answer'?{...shape}:{C:5,D:1,H:4,S:4};
        result.description=stage==='shape-opening'?'精确人工短方块2D：11–15 HCP、C4+、两高花各3+、D至多一张；四种约定形状之一，不是自然六张弱方块':'精确2D–2NT后的人工三阶牌型回答：3C=4414、3D=4405、3H=4315、3S=3415（依S/H/D/C顺序）；此叫不表示所叫套自然长套，完整形状与11–15 HCP保留；询问者仍须继续自然支持或无将签约，逼叫一轮，不能Pass停在人工牌型回复，自然定约完成后解除';
      }
    }
    return result;
  }
  if (target.kind === 'pass') {
    if (strongClubNegativePassAt(prefix, index, system)) {
      set('strong-club-negative-pass', '强2C遭插叫后的弱负应Pass'); hcp(0, 3);
      result.forcing = 'one-round'; result.intent = 'answer';
      result.description = '本配置强2C初次遭自然花色插叫，或2D等待后开叫人自然再叫又遭自然插叫时，Pass为0–3 HCP负应扩展，不承诺套长；强开叫人必须自然描述，其首个最低自然回答后可NF，相当于弱负应已完成，不把弱Pass说成违反强2C义务；4+正应仍走真实正应并建立逼局';
    } else if (precisionNegativePassAt(prefix, index, system)) {
      set('precision-negative-pass', '强梅花遭插叫后的负应Pass'); hcp(0, 7); result.intent = 'answer';
      result.description = '精确强1C遭自然花色插叫后的Pass负应：0–7 HCP，不承诺花色长度；弱手允许Pass履行负应，不能把无点手强制解释为处罚X；强开叫人随后须自然描述，正应手仍用已约定的真实正应建立逼局';
    } else {
      set('pass', '不叫'); result.intent = 'signoff';
      const conversion = publicPenaltyConversionBefore(before, entry.seat, system);
      if (conversion) {
        result.roleLabel = '把同伴技术X转作惩罚'; result.forcing = 'none';
        result.description = `把同伴技术X转作惩罚的Pass：愿防守当前被加倍的${(before[conversion.targetIndex].call as Bid).level}${conversion.target}，原选未叫套义务由本次明确转罚完成，后续不再要求技术应叫；这不是普通弱牌的无条件Pass，须有真实敌套将牌防守及足够赢墩依据；不从Pass虚构均型、自然NT点窗或同伴支持`;
      }
      const interruptedTransfer = publicInterruptedTransferBefore(before, entry.seat, system);
      if (interruptedTransfer)
        result.description = `不叫：敌方自然${interruptedTransfer.enemy.call.level}${interruptedTransfer.enemy.call.strain}已使原最低${interruptedTransfer.request.call.level}${interruptedTransfer.target}转移接叫不合法，本轮自动接转移义务解除；允许防守，不承诺目标套三张支持；如继续接受须按竞争高度作真实支持判断，不要求叫出非法的旧最低接叫`;
      if (publicInterruptedStaymanBefore(before, entry.seat, system))
        result.description = '真实1NT平台的Stayman遭敌方自然2H插叫，本轮询问义务被竞争解除；无四张黑桃及可安全自然NT回答时允许Pass，不将敌方自然定约误称己方未完成的人工止约，也不承诺自己红心长度';
      const ownTransfer = ownPrior.at(-1);
      const completed = ownTransfer && publicNoTrumpQuestionAt(before, ownTransfer.index, system);
      const platformRange = completed && noTrumpRangeAt(before, completed.platform.index, system);
      if (!forcedBefore.mustBid && forcedBefore.forcing === 'none' && completed?.kind === 'transfer'
        && platformRange?.min === 18 && platformRange.max === 20
        && isBalancedNoTrumpAt(before, completed.platform.index, system)
        && before.some((prior, at) => at < completed.platform.index && prior.seat === completed.platform.seat
          && isTakeoutDoubleAt(before, at))
        && partner?.seat === completed.platform.seat && partner.call.strain === completed.target
        && partner.call.level === ownTransfer!.call.level && partner.index > ownTransfer!.index
        && !all.some(prior => prior.index > ownTransfer!.index && sideOf(prior.seat) !== sideOf(entry.seat))) {
        result.forcing = 'none';
        result.description = `不叫：技术X方已自然再叫18–20 HCP真实均型无将，并已按约定接受本手高花转移为${partner.call.level}${partner.call.strain}；本轮转移义务已完成，允许弱转移手停在自然高花部分定约，不延续旧敌套扣叫义务，也不把已接受转移误判为未完成的人工定约`;
      }
    }
    return result;
  }
  if (target.kind === 'redouble') { set('redouble', '实力再加倍'); hcp(10); return result; }
  if (target.kind === 'double') {
    set('double', classifyDoubleAt(prefix, index, system) ?? '加倍');
    if (result.roleLabel === 'takeout') {
      const technical = publicTakeoutDoubleAt(prefix, index, system)!;
      const targetBid = before[technical.targetIndex].call as Bid;
      hcp(technical.kind === 'responsive' ? targetBid.level >= 3 ? 8 : 6
        : technical.kind === 'balancing' ? 9 : technical.kind === 'reopening' && opening?.seat !== entry.seat ? 12
          : opening?.call.level === 3 ? 15 : 12);
      if (technical.kind === 'reopening') {
        for (const suit of technical.preferredSuits) length(suit, 3);
        result.suitMaximums = { [technical.target]: 2 };
        result.description = `再开叫技术性加倍：保留此前自然叫牌的点力和套长，本轮${result.hcpRange!.min}+ HCP、敌${technical.target}套至多两张，${technical.preferredSuits.join('／')}各3+张适合选配；开叫人普通低限也可凭牌型再开叫，不因自己叫过牌就解释为惩罚，也不额外承诺17+强自由再叫；同伴未有敌方新叫牌解围时须选自然花色，可凭真实敌套赢墩转罚`;
      } else if (technical.kind === 'responsive') {
        for (const suit of technical.preferredSuits) length(suit, 4);
        result.suitMaximums = { [technical.target]: 2 };
        result.description = `响应性技术加倍：敌方自然${technical.target}套加叫后，${result.hcpRange!.min}+ HCP、敌套至多两张，${technical.preferredSuits.join('／')}各4+张，请同伴选择未叫套；同伴先前技术X或自然争叫不把本轮X变成惩罚；敌方随后Pass时须自然回答，允许有真实将牌防守的转罚`;
      } else result.description = opening?.call.level === 2
        ? '对弱二的技术性加倍：普通13+ HCP且适合未叫套；本配置允许12 HCP、敌开叫套单缺且三门未叫套各4+张的补偿例外，17+强牌也可先X再自然叫真实长套；三张未叫套只是普通形状条件，不是强牌例外下永远成立的套长保证，未自然示支持时不借此虚构八张配合'
        : `技术性加倍：${result.hcpRange!.min}+ HCP，普通形状适合未叫套，17+强牌允许先X后自然描述；不把普通未叫套三张偏好变成强牌例外下的无条件长度承诺`;
    } else if (result.roleLabel === 'two-suit-strength') {
      hcp(10); result.description = '对敌Michaels／Unusual双套人工争叫的实力加倍：10+ HCP，表示防守及实力，不承诺未叫套长度，不套自然1NT惩罚加倍的15点／三快赢墩合同';
    } else if (result.roleLabel === 'lead-directing') {
      const artificial = bids(before).at(-1);
      if (artificial && artificial.call.strain !== 'NT') {
        hcp(8); length(artificial.call.strain, 3);
        result.description = `人工叫品${artificial.call.level}${artificial.call.strain}上的首攻指示加倍：8+ HCP；所叫花色须3+张且有AK，或4+张且至少三张T以上荣誉并含Q以上大牌，或5+张且含AQ／KQ／QJ；显示该套防守兴趣，不是负加倍，不要求伙伴选未叫花色，不把只有一个大牌且缺乏荣誉连接的长套自动视为合格`;
      }
    } else if (result.roleLabel === 'penalty') {
      const enemy = bids(before).at(-1);
      if (enemy?.call.strain === 'NT' && enemy.call.level === 1) {
        hcp(15); result.description = '对自然1NT的惩罚性加倍：15+ HCP且至少3个快速赢墩；点力达到15本身不足以自动加倍，不表示未叫套，不套人工2NT双套争叫上的实力加倍';
      } else if (before.some(prior => sideOf(prior.seat) === sideOf(entry.seat) && prior.call.kind === 'redouble'))
        result.description = '本方真实实力再加倍后，对敌方自然逃叫的惩罚性加倍：继续执行先前公开的防守与实力方向，不要求同伴选未叫套，不把敌方逃叫重新当作首次技术加倍';
      else result.description = '惩罚性加倍：本轮无已约定的技术、负加倍或首攻指示语境，依据公开无将、已示配合、敌套防守兴趣或高阶定约作防守判断；不要求同伴改选未叫花色，不凭本手隐藏牌型改变公开含义';
    }
    else if (result.roleLabel === 'negative') {
      const overcall = opening && auction[opening.index + 1]?.call;
      hcp(overcall?.kind === 'bid' && overcall.level >= 2 ? 8 : 6);
      for (const majorSuit of publicNegativeDoubleMajorsAt(prefix, index)) length(majorSuit, 4);
      if (opening && major(opening.call.strain) && overcall?.kind === 'bid' && major(overcall.strain)) {
        length('C', 4); length('D', 4);
      }
    }
    return result;
  }
  const pendingNTQuestion = partner && publicNoTrumpQuestionAt(before, partner.index, system);
  const interruptedTransfer = publicInterruptedTransferBefore(before, entry.seat, system);
  if (interruptedTransfer) {
    const acceptanceLevel = [1, 2, 3, 4, 5, 6, 7].find(level => bidValue({ kind: 'bid', level,
      strain: interruptedTransfer.target! }) > bidValue(interruptedTransfer.enemy.call));
    if (target.strain === interruptedTransfer.target && target.level === acceptanceLevel && target.level <= 3) {
      set('transfer-acceptance', '自然干扰后的竞争性转移接叫');
      const range = noTrumpRangeAt(before, interruptedTransfer.platform.index, system)!;
      hcp(range.min, range.max);
      for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) length(suit, 2);
      length(target.strain as Suit, 3);
      result.strictBalancedShapeFamily = ['4333', '4432', '5332'];
      result.artificial = false; result.forcing = 'none'; result.intent = 'competitive';
      result.stopperSources = ntStopperSources(before, interruptedTransfer.platform.index, system);
      result.description = `转移遭自然干扰后的${target.level}${target.strain}竞争接叫：原最低${interruptedTransfer.request.call.level}${interruptedTransfer.target}已不合法，本轮接受不再自动；本手真实3+张目标高花支持，保留原自然无将${range.min}–${range.max} HCP及严格均型，与转移手公开五张确认八配；自然不逼叫，不额外承诺自己的五张或六张，也不按未受干扰的超接受解释；原无自动继续义务时也可Pass`;
      return result;
    }
    if (target.strain === 'NT') {
      result.defined = false; result.role = 'unknown'; result.roleLabel = '转移遭自然干扰后的未约定无将续叫';
      result.artificial = false; result.forcing = 'none';
      result.description = `敌方自然${interruptedTransfer.enemy.call.level}${interruptedTransfer.enemy.call.strain}已使原最低${interruptedTransfer.request.call.level}${interruptedTransfer.target}转移接叫不合法，自动接叫义务解除；本卡未约定${target.level}NT为脱离转移的自然强弱档，不虚构18–19新点窗或同伴额外实力，也不要求非法的原最低接叫；可Pass，或在三阶以内以真实3+张支持作最低竞争性接转移`;
      return result;
    }
  }
  const interruptedStayman = publicInterruptedStaymanBefore(before, entry.seat, system);
  if (interruptedStayman && target.level === 2 && ['S', 'NT'].includes(target.strain)) {
    set(target.strain === 'NT' ? 'natural-nt' : 'natural-response', 'Stayman遭自然红心插叫后的自然回答');
    const range = noTrumpRangeAt(before, interruptedStayman.platform.index, system)!;
    hcp(range.min, range.max);
    result.strictBalancedShapeFamily = ['4333', '4432', '5332'];
    for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) length(suit, 2);
    if (target.strain === 'S') length('S', 4);
    else result.stopperSources = [{ suit: 'H', index, seat: entry.seat }];
    result.artificial = false; result.forcing = 'none'; result.intent = 'answer';
    result.description = `真实1NT平台Stayman遭敌方自然2H后的${target.level}${target.strain}：保留原${range.min}–${range.max} HCP及严格均型、各套至少两张；${target.strain === 'S' ? '自然显示四张以上黑桃' : '没有四张黑桃，红心有本手止张，最低自然2NT不是新的邀请或18–19强跳档'}；竞争已解除原询问一轮义务，本次自然回答不逼叫，不虚构五张红心或敌套支持扣叫`;
    return result;
  }
  if (pendingNTQuestion && target.strain === 'NT' && entry.seat === pendingNTQuestion.platform.seat
    && !intervened(prefix, entry.seat, partner.index, index)) {
    result.defined = false; result.role = 'unknown'; result.roleLabel = '无将询问的未约定回答';
    result.description = '真实无将平台的人工询问尚待规定花色回答；本配置未约定直接NT作为此询问的回答，不以成局高度绕过回应义务，也不发布新的自然无将点力范围';
    return result;
  }
  result.stopperSources = ntStopperSources(prefix, index, system);
  const strongTakeoutStopCue = publicStrongTakeoutStopCueAt(prefix, index, system)
    ?? negativeDoubleGameCueAt(prefix, index, system);
  if (strongTakeoutStopCue) {
    set('cue', '技术X强自然再叫后的限量进局止张扣叫'); hcp(strongTakeoutStopCue.minimum);
    result.artificial = true; result.forcing = 'game'; result.intent = 'inquiry';
    result.request = `${target.strain}止张或真实自然描述`;
    result.description = `${negativeDoubleGameCueAt(prefix, index, system)?.twoSuitStrength ? '本手一阶开叫、同伴对人工双套争叫作10+实力X、敌方自然选择所示套之后的' : negativeDoubleGameCueAt(prefix, index, system) ? '本手一阶开叫、敌二阶争叫及同伴8+负X之后首个' : '本手先作技术X的最低自然回答、同伴再以17+真实长套示强后的'}3${target.strain}敌套扣叫：${result.hcpRange!.min}+ HCP使联手最低25，询问敌套止张或自然描述，进局逼叫；不承诺所扣敌套长度、不虚构三张支持或调整短门，不把弱牌原套回叫也一并变成强应叫`;
    return result;
  }
  const selfLongGame = publicSelfLongMajorGameAt(prefix, index, system);
  if (selfLongGame) {
    set('natural-repeat', '竞争中原开叫高花的独立长套成局');
    length(selfLongGame.primarySuit, 6); hcp(selfLongGame.minHcp, 21);
    result.selfLongGameQualification = selfLongGame;
    if (selfLongGame.allowEighteenException) result.playingSourceCompensation = { normalHcpMinimum: 19, minHcp: 18,
      suit: selfLongGame.secondarySuit, minLength: 5, minKingOrAce: 0, minQueenOrHigher: 0, minTenOrHigher: 0 };
    result.forcing = 'none'; result.intent = 'signoff';
    result.description = `原1${selfLongGame.primarySuit}开叫、同伴尚无自然应叫、敌方花色竞争后的4${selfLongGame.primarySuit}独立长套成局：19–21 HCP及原高花6+张；${selfLongGame.allowEighteenException ? '仅敌方已到四阶低花时，本配置允许18 HCP且本手原高花6+、另一高花5+、至少四快赢墩及至多三输张的有界双高赢墩来源。公共保守18 HCP及原高花六张；低点分支须全部套型及实际大牌条件同时成立；' : ''}不向普通19点六张手虚报另一高花五张，也不虚构伙伴支持／八配或25联手点，成局NF`;
    return result;
  }
  const openerOverNT = publicOpenerNTOverNTAt(prefix, index, system);
  if (openerOverNT) {
    result.allowedShapeFamily = [...openerOverNT.shapeFamily];
    for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) {
      length(suit, 2);
      result.stopperSources.push({ suit, index, seat: entry.seat });
    }
  }
  const strongMinorTrial = publicStrongMinorTrialAt(prefix, index, system);
  if (strongMinorTrial) {
    set('strong-minor-control-trial', '已逼局且严格均型NT背景的原低花控制试探');
    length(strongMinorTrial.trump, strongMinorTrial.ownMinimum);
    result.agreedTrump = strongMinorTrial.trump;
    result.supportRange = { trump: strongMinorTrial.trump, min: strongMinorTrial.supportMinimum, max: 40 };
    result.controlSuits = Object.fromEntries(strongMinorTrial.controlSuits.map(suit => [suit, 'first-or-second-round']));
    result.forcing = 'one-round'; result.intent = 'descriptive'; result.artificial = false;
    result.description = `此前已明确逼局、同伴真实严格均型NT后回自己的原自然4${target.strain}：本手${strongMinorTrial.ownMinimum}+张、同伴公开${strongMinorTrial.partnerMinimum}+张确认八配，${strongMinorTrial.supportMinimum}+调整支持点使联手公共最低33；全部旁门${strongMinorTrial.controlSuits.join('/')}均有首轮或第二轮控制，自然逼叫一轮的满贯控制试探，不是RKCB，不降低未逼局的16 HCP六低花试探或13–16支持点NF跳邀请；同伴有安全成局退出空间及真实支持时可继续问关键张`;
    return result;
  }
  const minorRelay = publicWeakMinorRelayAt(prefix, index, system);
  if (minorRelay) {
    set(minorRelay.stage === 'request' ? 'weak-minor-relay' : minorRelay.stage === 'acceptance'
      ? 'weak-minor-relay-acceptance' : 'weak-minor-relay-correction', minorRelay.stage === 'request'
      ? '弱低花接力' : minorRelay.stage === 'acceptance' ? '弱低花接力接叫' : '弱方块纠正叫');
    result.intent = minorRelay.stage === 'request' ? 'inquiry' : minorRelay.stage === 'acceptance' ? 'answer' : 'signoff';
    result.forcing = minorRelay.stage === 'request' ? 'one-round' : 'none';
    result.artificial = minorRelay.stage === 'request';
    if (minorRelay.stage === 'request' || minorRelay.stage === 'correction') hcp(0, 9);
    if (minorRelay.stage === 'correction') length('D', 6);
    if (minorRelay.stage === 'acceptance') length('C', 2);
    result.description = minorRelay.stage === 'request'
      ? '自然1NT平台后的2S弱低花接力：0–9 HCP、六张以上C或D，不表示黑桃长度；逼叫一轮到3C，即使敌方加倍也须完成接叫，不能Pass人工2S；这是本配置在自然NT争叫后也使用的扩展'
      : minorRelay.stage === 'acceptance' ? '弱低花2S接力后的3C最低接叫：只保留无将方两张以上梅花，不承诺自己的五张套；接力义务已完成，不逼叫，弱梅花手可Pass，弱方块手可3D纠正'
        : '2S弱低花接力、3C接叫后的3D纠正：六张以上方块，保留接力的0–9 HCP；自然不逼叫，可在3D止叫，不是强牌新套逼叫';
    return result;
  }
  if (newSuitOverStrongNTRebidAt(prefix, index, system)) {
    set('responder-second-suit', '强均型无将再叫后的自然新套');
    hcp(10); length(target.strain as Suit, 4); result.intent = 'descriptive'; result.forcing = 'game';
    result.description = `开叫人18–19 HCP均型2NT再叫后的自然3${target.strain}新套：10+ HCP、4+张，联手公开最低28 HCP，进局逼叫；不是16+六张原低花满贯尝试，也不凭真实隐藏手牌预先确认此新套配合；同伴可自然支持或选择3NT，到局前不得Pass`;
    return result;
  }
  if (weakDoubledEscapeAt(prefix, index)) {
    set('weak-doubled-escape', '技术X或再加倍逃叫路线中的弱牌换套');
    hcp(0); length(target.strain as Suit, 4); result.intent = 'competitive'; result.forcing = 'none';
    result.description = `技术X或再加倍后的自然逃叫定约遭惩罚性加倍，换到2${target.strain}：0+ HCP、4+张本手真实自然套，弱牌逃叫、不逼叫；不套普通争叫新套8+ HCP五张门槛，不承诺同伴持此套三张，保留同伴先前独立实力信息`;
    return result;
  }
  const controlCue = publicControlCueAt(prefix, index, system);
  if (controlCue) {
    set('control-cue', '已定高花的满贯控制探查');
    result.agreedTrump = controlCue.trump;
    result.controlSuits = { [controlCue.suit]: controlCue.control };
    if (controlCue.supportMinimum !== undefined)
      result.supportRange = { trump: controlCue.trump, min: controlCue.supportMinimum, max: 40 };
    result.intent = 'descriptive'; result.forcing = controlCue.postHeartGame ? 'one-round' : 'game'; result.artificial = true;
    length(controlCue.trump, naturalSuitMinimum(before, entry.seat, controlCue.trump, system));
    if (controlCue.postHeartGame) {
      result.request = '已成4H后的黑桃控制试探；同伴可继续4NT关键张或自然5H止叫';
      result.description = `已自然4H确认公开八张红心配合后的自主4S控制试探：红心仍为将牌，显示黑桃首轮或第二轮控制（A、K或单缺），不承诺自然黑桃长度；保留此前红心及方块等真实套长，${controlCue.supportMinimum}+调整红心支持点与同伴公开最低实力合计至少33；人工逼叫一轮，不能Pass在4S，同伴可4NT询问关键张或自然5H止叫，不把已成局的红心误改为黑桃签约`;
      return result;
    }
    result.request = `有尚未公开的旁门控制可在4${controlCue.trump}以下继续最便宜控制叫，否则回4${controlCue.trump}关闭`;
    result.description = `已公开八张${controlCue.trump}配合后的4${controlCue.suit}控制叫：显示本套首轮或第二轮控制（A、K或单缺），不保证自然套长、不改变${controlCue.trump}将牌；${result.supportRange ? `本手${result.supportRange.min}+调整支持点，按同伴公开最低支持点共同达到33；` : '保留发起控制探查时的公开支持点下界；'}旁门控制未齐不直接问关键张；进局逼叫继续，至少回4${controlCue.trump}，不能Pass在控制叫；有尚未公开控制可继续局以下最便宜控制，否则4${controlCue.trump}关闭`;
    return result;
  }
  if (naturalMinorSlamTryAt(prefix, index)) {
    set('minor-slam-try', '三阶阻击后无将之上的自然低花满贯尝试');
    hcp(16, 21); length(target.strain as Suit, 6); result.intent = 'descriptive';
    result.description = `三阶阻击后3NT应叫之上的4${target.strain}自然低花满贯尝试：16+ HCP、6+张开叫低花，保留同伴3NT的公开HCP与敌套止张；有两张以上支持及足够额外实力的同伴可用4NT确定此低花配合并问关键张，不当作无将定量邀请`;
    return result;
  }
  if (isBalancedNoTrumpAt(prefix, index, system)) {
    result.strictBalancedShapeFamily = ['4333', '4432', '5332'];
    for (const balancedSuit of ['C', 'D', 'H', 'S'] as Suit[]) length(balancedSuit, 2);
  }
  if (publicStrictNTTwoMajorAt(prefix, index, system)) {
    set('strict-nt-two-major-game-force', '严格均型最低再叫后的自然五五双高花');
    length('S', 5); length('H', 5);
    const passed = passedBefore(prefix, entry.seat, opening.index);
    hcp(11, passed ? 12 : 40); result.forcing = 'game'; result.intent = 'descriptive';
    result.description = `一阶低花–1S–严格均型1NT12–14后的自然3H：5+张S、5+张H、${passed ? '11–12' : '11+'} HCP，进局逼叫；同伴仅有4333／4432／5332形状，至少一个高花有三张，五五手短门支持点与同伴最低支持共同达到成局；开叫人选择自己三张以上支持的4H或4S，不能Pass在3H，也不是半均型1NT后的邀请或NT转移后的另一高花`;
    return result;
  }
  const transferGame = transferGameContinuationAt(prefix, index, system);
  if (transferGame) {
    const { trump, platform, kind, offer } = transferGame;
    if (kind === 'support') {
      set('natural-support', '无将开叫人转移后的高花成局支持');
      length(trump, 3); result.intent = 'signoff'; result.forcing = 'none';
      result.description = `无将方在接受转移、同伴${offer.call.level}NT${offer.call.level === 2 ? '邀请' : '成局提议'}后选择4${trump}：本手3+张支持同伴已示5+张${trump}，确认八张配合；先前最低转移接叫只保证两张，本次进一步显示三张以上支持；按已定高花配合及25调整支持点接受成局，可止叫，保留原无将点力`;
    } else {
      set('natural-nt', '转移应叫人的无将成局提议');
      const platformRange = noTrumpRangeAt(prefix, platform.index, system);
      if (platformRange) hcp(Math.max(0, 25 - platformRange.min));
      length(trump, 5); result.intent = 'signoff'; result.forcing = 'none';
      result.description = `高花转移被接受后的3NT：保留本手5+张${trump}及${result.hcpRange?.min ?? '成局'}+ HCP；提出无将成局，同伴有三张以上${trump}支持可选择4${trump}，仅两张时可Pass 3NT；不承诺本手均型；${stopperDescription(result.stopperSources, index, entry.seat)}`;
    }
    return result;
  }
  const weakTwo = ourOpening?.call.level === 2 && ['D', 'H', 'S'].includes(ourOpening.call.strain)
    && (ourOpening.index === opening?.index || ourOpening.index < index
      && publicCallMeaningAt(before, ourOpening.index, system).roleLabel === '首次阻击争叫');
  if (weakTwo && side.length === 2 && response?.index === index && target.strain === 'NT'
    && target.level === 2 && result.artificial) {
    set('weak-feature-inquiry', '弱二旁门特征询问'); result.intent = 'inquiry'; result.forcing = 'one-round';
    result.request = system === 'sayc' ? '9–11时展示旁门A/K，否则回三阶原套' : '8–10时展示旁门A/K，否则回三阶原套';
    result.description = `弱二／弱跳争叫后的2NT旁门特征询问：人工特征问叫、逼叫一轮，不是均型无将邀请；${result.request}，回答后可依公开实力与真实配合决定继续或Pass`;
    return result;
  }
  if (weakTwo && side.length === 3 && entry.seat === ourOpening.seat
    && response?.call.strain === 'NT' && response.call.level === 2 && target.level === 3
    && target.strain === ourOpening.call.strain && isArtificialBidAt(prefix, response.index, system)) {
    set('natural-repeat', '弱二特征询问后的原套回答');
    length(target.strain as Suit, 6); result.priorSuitMinimum = 6;
    result.intent = 'answer'; result.forcing = 'none';
    result.description = `弱二开叫后2NT特征询问的3${target.strain}原套回答：保留6+张原套和弱二${system === 'sayc' ? '5–11' : '6–10'} HCP；${system === 'sayc' ? '5–8最低限，或9–11没有可展示的旁门A/K特征' : '6–7最低限，或8–10没有可展示的旁门A/K特征'}，不额外保证一定低限，也不是邀请；已履行本轮回答义务，同伴可Pass`;
    return result;
  }
  if (weakTwo && side.length === 3 && entry.seat === ourOpening.seat && result.artificial
    && response?.call.strain === 'NT' && response.call.level === 2 && target.level === 3
    && target.strain !== 'NT' && target.strain !== ourOpening.call.strain) {
    set('weak-feature-answer', '弱二特征询问的旁门回答'); result.intent = 'answer'; result.forcing = 'none';
    hcp(system === 'sayc' ? 9 : 8, system === 'sayc' ? 11 : 10);
    result.controlSuits = { [target.strain]: 'first-or-second-round' };
    result.description = `弱二后2NT询问的3${target.strain}旁门特征回答：${result.hcpRange!.min}–${result.hcpRange!.max} HCP，显示本套A或K，保留原弱二六张套；不承诺该旁门四张或五张，不按自然新套增加套长；已完成本轮询问，同伴按原套配合与公开实力选择定约`;
    return result;
  }
  if (preemptNTCompetitiveResponseAt(prefix, index, system)) {
    set('preempt-nt-competitive-response', '弱二遭自然NT介入后的建设性新套');
    hcp(10); length(target.strain as Suit, 5); result.forcing = 'none'; result.intent = 'competitive';
    result.description = `弱二开叫遭敌方真实自然无将介入后的${target.level}${target.strain}：10+ HCP、5+张自然新套，建设性、不逼叫；此最低合法竞争回复原本可Pass，不采用无干扰弱二新套13+逼叫一轮，也不宣称已有高花配合`;
    return result;
  }
  if ((system === 'sayc' || system === 'two-over-one') && ntMinorCorrectionAt(prefix, index)) {
    set('natural-nt-minor-correction', '普通1NT再叫后的自然低花纠正叫');
    const passed = passedBefore(prefix, entry.seat, opening.index);
    length(target.strain as Suit, 5); hcp(6, passed ? 12 : 40); result.forcing = 'none'; result.intent = 'signoff';
    result.description = `普通1NT再叫后的${target.level}${target.strain}：保留一阶自然应叫的公开实力、5+张自然低花，通常作为弱牌纠正叫，不逼叫；本卡未启用新低花逼叫，搭档可Pass，不从此叫品额外推导邀请点力`;
    return result;
  }
  const weakMinor = system === 'sayc' && weakMinorContinuationAt(prefix, index);
  if (weakMinor) {
    set(weakMinor, weakMinor === 'weak-minor-escape' ? '弱六张低花逃叫' : '六张低花自然邀请');
    hcp(weakMinor === 'weak-minor-escape' ? 5 : 10, weakMinor === 'weak-minor-escape' ? 9 : 12);
    length(target.strain as Suit, 6); result.forcing = 'none'; result.invitation = weakMinor === 'long-minor-invitation';
    result.intent = result.invitation ? 'invitation' : 'signoff';
    result.description = `1m–1M–2m后${target.level}${target.strain}：${result.hcpRange!.min}–${result.hcpRange!.max} HCP、6+张自然低花；${result.invitation ? '好六张套的自然邀请、不逼叫' : '弱牌逃叫、不逼叫'}，不是通常10+五张新套逼叫一轮；搭档无配合时应比较原套和实牌退路`;
    return result;
  }
  const askedTrump = target.level === 4 && target.strain === 'NT' && result.artificial
    ? publicKeycardTrumpAt(prefix, index, system) : undefined;
  if (askedTrump && askedTrump !== 'NT') {
    set('keycard-ask', 'RKCB关键张问叫'); result.intent = 'inquiry'; result.agreedTrump = askedTrump;
    const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), askedTrump, system);
    length(askedTrump, Math.max(naturalSuitMinimum(before, entry.seat, askedTrump, system), 8 - partnerMinimum));
    result.description = `RKCB 1430关键张问叫：已约定${askedTrump}为将牌及八张以上配合，询问四个A及${askedTrump}K；5C=1/4、5D=0/3、5H=2/5无Q、5S=2/5有Q`;
    return result;
  }
  const keycard = keycardContinuationAt(prefix, index, system);
  if (keycard) {
    set(keycard.role, keycard.role === 'keycard-signoff' ? '关键张后五阶将牌止叫' : keycard.role);
    result.intent = keycard.role.endsWith('ask') ? 'inquiry' : keycard.role.endsWith('answer') ? 'answer' : 'signoff';
    if (keycard.role === 'keycard-answer') result.description = `RKCB 1430回答${target.level}${target.strain}：${target.strain === 'C' ? '1或4关键张' : target.strain === 'D' ? '0或3关键张' : target.strain === 'H' ? '2关键张、无将牌Q' : '2关键张、有将牌Q'}；这是关键张信息，不新增自然套长或支持承诺${target.strain === keycard.trump ? '；本答叫已在约定将牌，可以作为五阶实牌定约，同伴可Pass' : '；非约定将牌人工答叫，同伴须继续处理'}`;
    if (keycard.role === 'keycard-signoff') result.description = `RKCB后五阶将牌${target.level}${target.strain}止叫：优先作为安全实牌定约，不同时解释为将牌Q问叫；同伴可Pass`;
    if (keycard.role === 'queen-ask') result.request = '回答将牌Q，保留最差回答后的五阶将牌退出';
    if (keycard.role === 'king-ask') result.request = '显示低于六阶将牌可安全描述的最低旁门K，否则回六阶将牌';
    if (keycard.role === 'king-answer') result.description = target.strain === keycard.trump
      ? `5NT旁门K问叫后回六阶将牌：没有可在此将牌以下安全显示的旁门K；不否认更高花色K，也不是大满贯接受`
      : `5NT后显示最低可安全描述的${target.strain}K：越过的更低旁门K被否认；只提供这一项控制，不保证十三墩或接受大满贯`;
    return result;
  }
  const staymanContinuation = staymanContinuationAt(prefix, index, system);
  if (staymanContinuation?.kind === 'denial-major-unknown') {
    result.role = 'unmapped-stayman-major'; result.roleLabel = 'Stayman否认后的未定义高花续叫';
    result.forcing = 'none';
    result.description = `Stayman否认四张高花后的${target.level}${target.strain}：本卡未启用Smolen或弱双高花退叫，不能推导五张套或额外逼叫；四张高花邀请应走2NT，进局走3NT`;
    return result;
  }
  if (staymanContinuation?.kind === 'other-major-invitation') {
    set('stayman-other-major-invitation', 'Stayman后另一四张高花邀请');
    const platformRange = noTrumpRangeAt(prefix, staymanContinuation.platform.index, system);
    const minimum = Math.max(8, 25 - (platformRange?.max ?? 17));
    length(target.strain as Suit, 4); hcp(minimum, minimum + 1); result.invitation = true; result.intent = 'invitation';
    result.description = `Stayman答叫后另一高花${target.level}${target.strain}邀请：${minimum}–${minimum + 1} HCP、4+张所叫高花；未建立进局逼叫，开叫人无八张配合而达到25点时可接受3NT`;
    return result;
  }
  if (staymanContinuation?.kind === 'other-major-game-force') {
    set('stayman-other-major-game-force', 'Stayman后另一高花自然逼局');
    const firstNT = staymanContinuation.platform.call.level === 1;
    length(target.strain as Suit, firstNT ? 5 : 4);
    if (firstNT && staymanContinuation.answer.call.strain === 'S') length('S', 4);
    hcp(firstNT ? 10 : 5); result.intent = 'descriptive'; result.forcing = 'game';
    result.description = firstNT
      ? '1NT–Stayman–2S后的3H：10+ HCP、五张以上H及四张以上S，自然进局逼叫；四H邀请改用2NT，未采用Smolen'
      : `强2NT平台Stayman后的另一高花${target.level}${target.strain}：5+ HCP、四张以上，自然进局逼叫，不是没有无将拒邀空间的四张邀请`;
    return result;
  }
  const ntInquiry = partner && isNaturalNoTrumpAt(prefix, partner.index, system) && target.level === partner.call.level + 1
    && result.artificial;
  if (ntInquiry && target.strain === 'C') {
    set('stayman', 'Stayman'); result.intent = 'inquiry';
    if (partner!.call.level === 1) hcp(8);
    result.description = `真实自然${partner!.call.level}NT平台后的Stayman：${partner!.call.level === 1 ? '本卡8+ HCP、询问四张高花；' : '询问四张高花；'}人工逼叫一轮，问叫未答时不能Pass；1NT完成2D否高花回答后该轮义务解除，不额外承诺D长度；强2NT的3D与Precision人工牌型回答仍须继续自然签约`;
    return result;
  }
  if (ntInquiry && (target.strain === 'D' || target.strain === 'H')) {
    set('transfer', '高花转移'); length(target.strain === 'D' ? 'H' : 'S', 5); result.intent = 'inquiry';
    if (before.some((prior, at) => prior.seat === partner!.seat && isTakeoutDoubleAt(before, at)))
      result.description = `技术X方已自由再叫18+真实均型NT后，本次${target.level}${target.strain}仍为高花转移：本手5+张${target.strain === 'D' ? 'H' : 'S'}，不另加12+强扣叫点力；同伴须先最低接受转移，不把技术X最初的敌套背景覆盖新强NT平台`;
    return result;
  }
  const lastThree = side.slice(-3), platform = lastThree[0], inquiry = lastThree[1];
  if (platform?.call.strain === 'NT' && inquiry?.call.level === platform.call.level + 1
    && (target.level === inquiry.call.level || inquiry.call.strain === 'C' && naturalStaymanAnswerAt(prefix, index, system)) && platform.seat === entry.seat
    && isNaturalNoTrumpAt(prefix, platform.index, system) && isArtificialBidAt(prefix, inquiry.index, system)) {
    if (inquiry.call.strain === 'C') {
      set('stayman-answer', 'Stayman回答'); result.intent = 'answer';
      if (major(target.strain)) length(target.strain as Suit, 4);
      if (platform.call.level === 1 && target.strain === 'D') {
        result.description = `真实1NT的Stayman询问后2D否认四张高花：人工，不额外承诺方块长度；询问已完成，${after.forcing === 'game' ? '此前独立进局逼叫仍继续' : '本轮不逼叫，应叫人可按自己的D实牌接受为部分定约或作合法自然续叫，不因人工否认回答再强迫一轮'}；初次2C须8+ HCP；强2NT的3D及Precision人工形状答案仍须继续选择自然定约`;
      }
      return result;
    }
    const transferred = inquiry.call.strain === 'D' ? 'H' : inquiry.call.strain === 'H' ? 'S' : undefined;
    if (target.strain === transferred) { set('transfer-acceptance', '最低转移接叫'); length(transferred as Suit, 2); result.intent = 'answer'; return result; }
  }
  if (result.artificial) {
    if (opening?.index === index && (openerStrongClub(target) || system === 'precision' && target.level === 1 && target.strain === 'C')) {
      set('strong-opening', system === 'precision' ? '精确强1C' : '强2C'); hcp(system === 'precision' ? 16 : 22);
      result.intent = 'inquiry'; result.request = system === 'precision' ? '1D负应或8+正应' : '2D等待或定义的正应叫';
    } else if (after.convention === 'michaels-inquiry' && target.level === 2 && target.strain === 'NT') {
      set('michaels-inquiry', 'Michaels未知低花询问');
      hcp(0); result.forcing = 'one-round'; result.intent = 'inquiry'; result.request = '同伴以3C或3D显示未知的五张以上低花';
      result.description = '同伴对敌高花作Michaels双套扣叫后的2NT人工询问：要求3C／3D显示未知的五张以上低花；不承诺自然无将点力、均型、止张或套长，低点手也可询问以选择真实配合；逼叫一轮，不能Pass停在人工扣叫或2NT，最低自然低花回答后不自动逼局';
    } else if (after.convention === 'takeout-cue') {
      set('cue', '技术性加倍后的强扣叫'); hcp(12); result.intent = 'inquiry';
      result.description = '同伴技术性加倍后的敌原套强扣叫：12+ HCP、人工逼叫一轮，要求同伴自然描述；不承诺两门五张高花，也不把强扣叫套当自己的自然长度';
    } else if (system === 'sayc' && opening?.index !== index && ourOpening?.index === index && target.level === 2
      && opening?.call.level === 1 && opening.call.strain !== 'NT'
      && target.strain === opening.call.strain && !before.some(prior => sideOf(prior.seat) === sideOf(entry.seat) && prior.call.kind !== 'pass')) {
      set('michaels', 'Michaels双套扣叫'); hcp(major(opening.call.strain) ? 10 : 8);
      for (const majorSuit of (major(opening.call.strain) ? [opening.call.strain === 'H' ? 'S' : 'H'] : ['H', 'S']) as Suit[]) length(majorSuit, 5);
      result.intent = 'inquiry';
    } else if (system === 'sayc' && opening?.index !== index && ourOpening?.index === index && target.level === 2 && target.strain === 'NT'
      && !before.some(prior => sideOf(prior.seat) === sideOf(entry.seat) && prior.call.kind !== 'pass')) {
      set('unusual', 'Unusual双套2NT');
      for (const low of (['C', 'D', 'H', 'S'] as Suit[]).filter(suit => suit !== opening?.call.strain).slice(0, 2)) length(low, 5);
      result.intent = 'inquiry';
    } else if (ourOpening?.index === opening?.index && ourOpening.call.level === 1 && major(ourOpening.call.strain)
      && response?.call.level === 2 && response.call.strain === 'NT' && target.level === 3
      && entry.seat === ourOpening.seat && side.length === 3 && target.strain !== ourOpening.call.strain
      && target.strain !== 'NT' && isArtificialBidAt(prefix, response.index, system)) {
      set('jacoby-rebid', 'Jacoby逼局后的短套回答'); length(ourOpening.call.strain as Suit, 5);
      result.suitMaximums = { [target.strain]: 1 }; result.intent = 'answer';
      result.controlSuits = { [target.strain]: 'first-or-second-round' };
      result.description = `Jacoby 2NT后的3${target.strain}短套回答：该旁门至多一张，保留开叫人五张将牌及应叫人四张支持；人工描述短门、不承诺该套自然长度，原有进局逼叫仍继续；已公开短门可用于配合中的支持点下界，但不重复加点`;
    } else if (ourOpening?.index === opening?.index && ourOpening.call.level === 2 && ourOpening.call.strain === 'C') {
      set('artificial-response', '强2C的约定回答');
      if (side.length === 4 && target.level === 3 && (major(side[2].call.strain) ? target.strain === 'C'
        : side[2].call.strain === 'C' ? target.strain === 'D' : side[2].call.strain === 'D' && target.strain === 'NT')) {
        hcp(0, 3);
        result.description = `强2C–2D等待、开叫人自然${side[2].call.level}${side[2].call.strain}后的${target.level}${target.strain}：0–3 HCP人工第二次负应叫，${target.strain === 'C' ? '不承诺梅花套' : target.strain === 'D' ? '不承诺方块套' : '不表示自然无将成局'}；开叫人须继续，最低回原自然套后允许止叫，换新套则原逼叫继续`;
      }
    } else if (ourOpening?.index === opening?.index && ourOpening.call.level === 1 && major(ourOpening.call.strain)
      && response?.index === index && target.level === 2 && target.strain === 'NT') {
      set('natural-support', 'Jacoby 2NT进局逼叫支持'); length(ourOpening.call.strain as Suit, 4);
      result.supportRange = { trump: ourOpening.call.strain as Suit, min: 13, max: 40 }; result.intent = 'inquiry';
    } else if (after.convention === 'fourth-suit') {
      set('fourth-suit', '第四花色一轮询问'); hcp(10); result.intent = 'inquiry'; result.request = '描述支持、止张或真实套长；最低限与额外实力分档';
      result.description = `第四花色逼叫询问：10+ HCP、人工逼叫一轮，不承诺所叫花色长度；合法自然回答解除本轮义务，已有2/1进局逼叫则继续`;
    } else if (after.convention === 'overcall-cue' || after.convention === 'competitive-cue') {
      set('cue', '支持性或强扣叫'); result.intent = 'inquiry'; hcp(10);
      if (partner?.call.strain !== 'NT' && partner) {
        const trump = partner.call.strain as Suit;
        const partnerLength = naturalSuitMinimum(before, partnerOf(entry.seat), trump, system);
        const alreadyShown = naturalSuitMinimum(before, entry.seat, trump, system);
        const firstNaturalSupport = !ownPrior.some(prior => prior.call.strain===trump&&!isArtificialBidAt(before, prior.index, system));
        const firstOpenerCue = ourOpening?.index===opening?.index&&entry.seat===ourOpening.seat;
        const supportsPublicFit = !firstOpenerCue&&firstNaturalSupport&&partnerLength>=5 || alreadyShown+partnerLength>=8;
        if (supportsPublicFit) length(trump, Math.max(3, alreadyShown));
        else {
          const partnerFloor = publicPlayerConstraints(before, partnerOf(entry.seat), system).hcpRange?.min ?? 0;
          hcp(Math.max(10, 25 - partnerFloor));
          result.description = `尚未公开八张配合的敌套强扣叫：${result.hcpRange!.min}+ HCP，与同伴公开${partnerFloor}+原始点使联手至少25；人工逼叫一轮，询问敌套止张或要求自然描述，以探索无将或真实配合；不套10点支持扣叫，不制造三张或五张低花支持，不计短门支持点，也不因低花回答越过三阶就自动逼局`;
          result.request = '敌套止张或真实自然描述';
        }
        if (supportsPublicFit) {
          result.hcpRange = undefined; result.supportRange = { trump, min: 10, max: 40 };
          result.description = `确认八张${trump}配合后的支持性扣叫：3+张支持、10+调整支持点；保留此前独立HCP承诺，不新增10 HCP门槛；${after.forcing === 'game' ? '最低原套回答已越过三阶，须有25支持点高花或29支持点低花成局意图，进局逼叫继续' : '逼叫一轮，同伴须自然描述；合法回答后不自动继续逼局'}`;
        }
      }
      if (!result.supportRange && !result.description) {
        const partnerFloor = publicPlayerConstraints(before, partnerOf(entry.seat), system).hcpRange?.min ?? 0;
        hcp(Math.max(10, 25 - partnerFloor));
        result.description = `未确认八张配合的敌套强扣叫：${result.hcpRange!.min}+ HCP与同伴公开${partnerFloor}+原始点达到至少25，要求止张或真实自然描述；不把低点无配合手按10点支持扣叫推进四阶，自然无将此前公开实力和止张继续保留`;
      }
      if (['overcall-cue', 'competitive-cue'].includes(after.convention) && after.forcing === 'game'
        && partner && partner.call.strain !== 'NT') {
        const partnerConstraints = publicPlayerConstraints(before, partnerOf(entry.seat), system);
        const trump = partner.call.strain as Suit, partnerLength = naturalSuitMinimum(before, partnerOf(entry.seat), trump, system);
        const ownLength = Math.max(3, 8 - partnerLength); length(trump, ownLength);
        result.supportRange = { trump, min: Math.max(10, (major(trump) ? 25 : 29)
          - publicSupportMinimum(trump, ownLength, partnerConstraints)), max: 40 };
        result.hcpRange = undefined;
        result.description = `高位自然支持扣叫：${ownLength}+张${trump}支持，与同伴公开${partnerLength}+张确认八配合；${result.supportRange ? `${result.supportRange.min}+支持点，` : ''}下一最低原套回答已达四阶或更高，表示成局意图并持续逼局；自然侧套回答不解除，到局才可止叫，保留此前HCP承诺而不新增10 HCP门槛，低花用29点门槛`;
      }
    }
    return result;
  }
  const jacoby = ourOpening?.index === opening?.index && ourOpening.call.level === 1 && major(ourOpening.call.strain)
    && response?.call.level === 2 && response.call.strain === 'NT' && isArtificialBidAt(prefix, response.index, system);
  if (jacoby && index > response.index && !side.some(prior => prior.index < index
    && prior.call.level === 4 && prior.call.strain === 'NT' && isArtificialBidAt(prefix, prior.index, system))) {
    const trump = ourOpening.call.strain as Suit;
    length(trump, entry.seat === ourOpening.seat ? 5 : 4);
    set(entry.seat === ourOpening.seat ? 'jacoby-rebid' : 'jacoby-continuation', 'Jacoby逼局后的自然续叫');
    result.intent = target.level >= gameLevel(target.strain) ? 'signoff' : 'descriptive';
    if (side.length === 3 && entry.seat === ourOpening.seat) {
      if (target.strain === 'NT' && target.level === 3) hcp(15, 17);
      if (target.strain === trump && target.level === 3) hcp(18, 21);
      if (target.strain === trump && target.level === 4) hcp(12, 14);
      if (target.strain !== trump && target.strain !== 'NT' && target.level === 3) {
        result.suitMaximums = { [target.strain]: 1 };
      }
    }
    result.description = `Jacoby 2NT之后的${target.level}${target.strain}：保留开叫人五张及应叫人四张${trump}支持${result.hcpRange ? `；本手${result.hcpRange.min}–${result.hcpRange.max} HCP` : '及此前13+支持点'}；${after.forcing === 'game' ? '进局逼叫继续' : `已选择${target.level === 7 ? '大满贯' : target.level === 6 ? '小满贯' : '成局'}，可以止叫`}，不把人工2NT当均型平台，也不把后续支持降为二张偏好`;
    return result;
  }
  if (target.strain === 'NT') {
    const range = noTrumpRangeAt(prefix, index, system);
    const longMinorNT = target.level === 3 && side.length === 3 && ourOpening?.index === opening?.index
      && ourOpening.call.level === 1 && ['C', 'D'].includes(ourOpening.call.strain)
      && entry.seat === ourOpening.seat && response?.call.level === 1 && major(response.call.strain)
      && !intervened(prefix, entry.seat, ourOpening.index, index);
    if (longMinorNT) result.longMinorNTAlternative = { suit: ourOpening.call.strain as Suit,
      minLength: 7, minHcp: 19, minSideAces: 2, requiredHonors: 'AKQ',
      sixCardSource: { minLength: 6, minHcp: 19, minSideAKSuits: 2, requiredHonorsOrConnectedHonors: 'AK',
        alternativeMinQueenHigher: 2, alternativeMinTenHigher: 3 } };
    const preemptNTResponse = side.length === 2 && ourOpening?.index === opening?.index
      && ourOpening.call.level === 3 && ourOpening.call.strain !== 'NT' && entry.seat !== ourOpening.seat
      && target.level === 3;
    const weakTwoLateNT = side.length === 4 && ourOpening?.index === opening?.index
      && ourOpening.call.level === 2 && ['D', 'H', 'S'].includes(ourOpening.call.strain)
      && response?.seat === entry.seat && response.call.level === 3 && ['C', 'D'].includes(response.call.strain)
      && side[2].call.level === 3 && side[2].call.strain === ourOpening.call.strain && target.level === 3;
    if (preemptNTResponse || weakTwoLateNT) {
      set('preempt-natural-nt', preemptNTResponse ? '三阶阻击后的自然无将成局回应' : '弱二强新套后的自然无将成局续叫');
      hcp(preemptNTResponse ? 16 : 19); result.forcing = 'none'; result.intent = 'signoff';
      if (preemptNTResponse) {
        result.strictBalancedShapeFamily = ['4333', '4432', '5332'];
        for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) {
          length(suit, 2);
          if (suit !== ourOpening.call.strain) result.stopperSources.push({ suit, index, seat: entry.seat });
        }
      } else length(response!.call.strain as Suit, 6);
      result.description = preemptNTResponse
        ? `同伴三阶${ourOpening.call.strain}阻击后的首次3NT：16+ HCP、严格均型各套至少两张，所示七张以上长套为赢墩来源，全部旁门由本手止张；不是无内容的保留此前点力，也不按弱阻击5点机械要求自己20；自然成局可止叫`
        : `弱二之后本手13+五张新低花、开叫人回三阶原六套后的3NT：本手19+ HCP、此前所示低花现在至少六张，以强牌与长套作为自然无将成局资源；保留先前点力而不依赖弱开叫人隐藏高限，不承诺均型，不把未被请求的普通旁门一律宣称自己全止；自然成局可止叫`;
      return result;
    }
    if (range) hcp(range.min, range.max);
    if (system === 'precision' && target.level === 2 && range?.min === 7 && range.max <= 8
      && side.length === 4 && ourOpening?.index === opening?.index && ourOpening.call.level === 1
      && ourOpening.call.strain === 'C' && response?.call.level === 1 && response.call.strain === 'D'
      && partner?.call.level === 1 && partner.call.strain === 'NT') {
      set('natural-nt', '精确强梅花自然无将再叫后的定量邀请');
      result.invitation = true; result.intent = 'invitation'; result.forcing = 'none';
      result.description = `精确强1C–1D负应–自然1NT（16–18 HCP）后的2NT定量邀请：基础邀请窗7–8 HCP，不逼叫；保留此前1D的0–7上界，所以本合法前序实际公开${result.hcpRange!.min}–${result.hcpRange!.max} HCP，不放宽负应；同伴仅在公开HCP合计至少25时接受3NT，不把合成8点错误负应前序当作合法精确制路线`;
      return result;
    }
    if (naturalMinorNTGameResponseAt(prefix, index, system)) {
      set('natural-nt', '自然低花开叫后的无将成局应叫');
      result.suitMaximums = { H: 3, S: 3 }; result.forcing = 'none'; result.intent = 'signoff';
      result.description = '一阶自然低花开叫后无干扰的3NT应叫：13+ HCP，通常13–15、无四张高花；通常均型，更强而没有合适真实新套时也可凭适合无将的牌型直接选择成局，因此不一概承诺四套均两张；原则上止叫，即使有五张开叫低花支持仍优先定量无将，本卡不采用倒置低花加叫，不将支持点当HCP';
      return result;
    }
    const semiNT = ourOpening?.index === opening?.index && ourOpening?.call.level === 1
      && major(ourOpening.call.strain) && side.length === 2 && target.level === 1;
    if (semiNT) {
      const passed = passedBefore(prefix, entry.seat, opening.index);
      set(passed ? 'passed-hand-nt' : 'semi-forcing-nt', passed ? '过手自然1NT' : '半逼叫1NT');
      result.request = passed ? undefined : '最低限均型允许Pass；描述合法四张第二套或真实六张原套，12–16非均型无合法再叫也可Pass';
      result.description = `1M后${passed ? '已Pass手牌的自然' : '半逼叫'}1NT：5–12 HCP；${passed ? '通常不逼叫，开叫人可Pass或自然描述' : '最低限均型开叫人可Pass；非均型描述合法四张第二套或六张原套，12–16 HCP既无合法四张低阶第二套又无六张原套、另一高花逆叫未达17+时也可Pass'}；不承诺高花支持，不用三张低花伪造再叫`;
      return result;
    }
    if (forcedBefore.convention === 'fourth-suit') {
      set('fourth-suit-nt-answer', '第四花色无将回答'); result.intent = 'answer';
      result.description = `第四花色询问后的自然${target.level}NT：${range ? `${result.hcpRange!.min}–${result.hcpRange!.max} HCP、` : ''}所问花色有止张；${range?.min === 12 ? '受合法空间约束的最低限回答' : '额外实力选择成局'}，履行本轮义务；没有此前2/1时不虚构持续逼局；${stopperDescription(result.stopperSources, index, entry.seat)}`;
      return result;
    }
    if (forcedBefore.convention === 'takeout-cue' && target.level === 2 && !range) {
      set('natural-nt', '技术X强扣叫后的被迫止张回答'); result.intent = 'answer';
      result.forcing = after.forcing === 'game' ? 'game' : 'none';
      const originalStrength = publicPlayerConstraints(before, entry.seat, system).hcpRange;
      if (originalStrength) hcp(originalStrength.min, originalStrength.max);
      const strengthDescription = result.hcpRange
        ? `${result.hcpRange.min}${result.hcpRange.max < 40 ? `–${result.hcpRange.max}` : '+'} HCP，保留原技术X点力`
        : '保留原技术X已公布的点力，本轮没有新增点力下界';
      result.description = `技术X方回答同伴强扣叫的被迫2NT：${strengthDescription}，所询敌套有止张；不额外承诺18+ HCP，不自动显示18–20或21–22档，不由本次被迫止张回答保证四套各两张；履行本轮义务后${result.forcing === 'game' ? '既有进局逼叫仍继续' : '不自动继续逼叫'}；${stopperDescription(result.stopperSources, index, entry.seat)}`;
      return result;
    }
    if (forcedBefore.convention === 'reverse' && target.level === 2) {
      set('natural-nt', '逆叫后的最低自然弱无将回答'); hcp(0);
      result.forcing = 'none'; result.intent = 'answer';
      result.description = `17–21逆叫后的最低自然2NT回答：${result.hcpRange!.min}${result.hcpRange!.max < 40 ? `–${result.hcpRange!.max}` : '+'} HCP，保留此前独立点力，本轮不新增下界；有已叫敌套时由本次或此前同伴NT承诺止张；不承诺均型、不表示邀请，不是Ingberman人工接力；履行本轮义务后NF，可停2NT；${stopperDescription(result.stopperSources, index, entry.seat)}`;
      return result;
    }
    if (!range && target.level === 2 && !forcedBefore.mustBid) {
      result.defined = false; result.role = 'unknown'; result.roleLabel = '未约定的自主重复无将';
      result.description = '当前公开前序的自主2NT没有已约定的邀请点窗或新增赢墩来源；本卡未定义此竞争无将续叫，不能仅保留此前一阶开叫或6–10等范围就视为额外实力，也不能当作遭惩罚X后的弱逃叫';
      return result;
    }
    set('natural-nt', '自然无将');
    const staymanDecision = staymanNTDecisionAt(prefix, index, system);
    if (staymanDecision) {
      result.invitation = false; result.forcing = 'none'; result.intent = 'signoff';
      result.description = `Stayman另一四张高花邀请后的${target.level}NT：${range!.min}–${range!.max} HCP；${staymanDecision.accepted ? '无八张高花配合时接受邀请，联手公开最低25 HCP，选择3NT成局' : '无八张高花配合且未达25 HCP，最低限拒绝邀请，停在2NT部分定约'}；保留原均型无将承诺，不是新的邀请或额外实力描述，同伴可Pass；${stopperDescription(result.stopperSources, index, entry.seat)}`;
      return result;
    }
    const responderInvitation = (range?.min === 11 && range.max === 12 || range?.min === 8 && range.max === 9
      || range?.min === 10 && (range.max === 11 || range.max === 12))
      && target.level === 2 && entry.seat !== ourOpening?.seat;
    const strictMinimumRebidInvite = responderInvitation && side.length === 4 && ourOpening?.index === opening?.index
      && ['C', 'D'].includes(ourOpening.call.strain) && response?.call.level === 1 && response.call.strain === 'S'
      && partner?.index === side[2].index && partner.call.level === 1 && partner.call.strain === 'NT'
      && noTrumpRangeAt(before, partner.index, system)?.min === 12 && isBalancedNoTrumpAt(before, partner.index, system);
    const semiMinorRebidInvite = responderInvitation && range?.min === 10 && range.max === 12
      && side.length === 4 && ourOpening?.index === opening?.index && ourOpening.call.level === 1
      && major(ourOpening.call.strain) && response?.call.level === 1 && response.call.strain === 'NT'
      && partner?.index === side[2].index && partner.call.level === 2 && ['C', 'D'].includes(partner.call.strain);
    if (strictMinimumRebidInvite || semiMinorRebidInvite) {
      result.allowedShapeFamily = ['4333', '4432', '5332', '5422', '6322'];
      for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) length(suit, 2);
    }
    const quantitativePlatform = quantitativeNoTrumpPlatformBefore(prefix, index, system);
    const quantitativeInvitation = (target.level === 4 || target.level === 5) && !!quantitativePlatform;
    if (quantitativeInvitation && quantitativePlatform?.seat === partnerOf(entry.seat)) {
      const partnerRange = noTrumpRangeAt(prefix, quantitativePlatform.index, system);
      if (partnerRange) hcp(Math.max(0, partnerRange.max < 40
        ? (target.level === 5 ? 37 : 33) - partnerRange.max : (target.level === 5 ? 35 : 31) - partnerRange.min));
    }
    result.invitation = !!responderInvitation || quantitativeInvitation;
    result.intent = quantitativeInvitation && target.level === 5 ? 'grand-inv'
      : result.invitation ? 'invitation' : target.level === 3 || target.level >= 6
      ? 'signoff' : forcedBefore.mustBid ? 'answer' : 'descriptive';
    if (target.level === 3 && !result.hcpRange && (ourOpening?.call.level === 1 || ourOpening?.call.strain === 'NT'
      || side.some(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
        && isNaturalNoTrumpAt(before, prior.index, system)))) {
      const minimum = publicPlayerConstraints(before, partnerOf(entry.seat), system).hcpRange?.min;
      if (minimum !== undefined) hcp(Math.max(0, 25 - minimum));
    }
    if (!result.hcpRange) {
      const retained = publicPlayerConstraints(before, entry.seat, system).hcpRange;
      if (target.level >= 6) {
        const partnerFloor = publicPlayerConstraints(before, partnerOf(entry.seat), system).hcpRange?.min;
        if (partnerFloor !== undefined) hcp(Math.max(0, (target.level === 6 ? 33 : 37) - partnerFloor));
      } else if (retained) hcp(retained.min, retained.max);
    }
    const stopDescription = stopperDescription(result.stopperSources, index, entry.seat);
    const purpose = quantitativeInvitation ? target.level === 5
      ? '自然无将平台后的定量5NT邀请大满贯，同时逼到至少6NT；最低限应6NT，足够额外实力可7NT，不能Pass停在5NT；不是RKCB问K，也不是未采用的大满贯逼叫问将牌顶张'
      : '自然无将平台后的定量4NT满贯邀请，不是RKCB；搭档可依据已公开HCP范围接受或Pass'
      : target.level === 4 || target.level === 5 ? '没有可确认的自然无将定量平台，本卡不由此推导满贯邀请或解除已有逼叫义务'
        : target.level === 6 ? '选择无将小满贯签约，可止叫'
          : target.level === 7 ? '选择无将大满贯签约，可止叫'
            : responderInvitation ? '邀请、不逼叫，同伴以HCP合计最低25接受'
              : target.level === 3 ? '选择无将成局并可止叫'
                : forcedBefore.mustBid ? '最低自然回答，不凭阶数增加邀请实力' : '限制性自然描述、不逼叫';
    const retainedBalance = ownPrior.some(prior => isBalancedNoTrumpAt(prefix, prior.index, system));
    const balanceDescription = result.allowedShapeFamily && ['C', 'D', 'H', 'S'].every(suit => (result.suitMinimums[suit as Suit] ?? 0) >= 2)
      ? '严格均型或无单缺的5422／6322半均型，四套均至少两张'
      : isBalancedNoTrumpAt(prefix, index, system) || retainedBalance
        ? `${retainedBalance ? '保留此前' : '明确'}均型，四套均至少两张，允许五张高花的5-3-3-2`
        : '适合无将的自然描述，此叫品不自动承诺四套均两张';
    result.description = `自然${target.level}NT：${result.hcpRange ? `${result.hcpRange.min}${result.hcpRange.max < 40 ? `–${result.hcpRange.max}` : '+'} HCP；` : '保留此前HCP承诺；'}${purpose}；${balanceDescription}；${stopDescription}；不把支持点当HCP${after.forcing === 'game' ? '；既有进局逼叫继续，到自然成局前不能Pass' : ''}`;
    if (openerOverNT) result.description += '；本配置仅限原低花开叫遭真实1NT争叫及两次Pass后的19–21额外2NT，严格均型或6322、四门均有本手止张，NF；不套用敌方技术X答1NT或平衡位NT后的其他竞争前缀';
    if (strictMinimumRebidInvite) result.description += '；此最低均型再叫后的2NT邀请限严格均型或无单缺的5422／6322半均型，不用5512单张K隐瞒真实双高花，五五双高应走自然3H进局逼叫';
    if (semiMinorRebidInvite) result.description += '；半逼叫后二阶低花再叫的2NT邀请限严格均型或无单缺5422／6322，四套至少两张，不用单张低牌伪造无将适合牌型';
    if (longMinorNT) result.description += '；本前序19–21强3NT采用严格均型，或原低花至少七张且有AKQ、两门旁门各有A的长套赢墩来源，或19+原六张以上低花含AK或至少三张T以上且两张Q以上荣誉、两门旁门各有A／K兑现入口；另允许19+且原低花六张的6322半均型，本套至少两张Q以上大牌且两门旁门各有A／K，不把AQ六张排除于有界半均型来源；各分支均按实牌核查，不向长套手虚报均型，也不放行普通19点弱六／七张套';
    if (ourOpening?.index === opening?.index && side.length === 2 && target.level === 1
      && ['C', 'D'].includes(ourOpening.call.strain) && entry.seat !== ourOpening.seat)
      result.description += '；无四张高花时的6–10限制性NT回应，通常均型或半均型，也允许不足二盖一实力的长低花牌，不把它当Stayman／转移平台';
    if (forcedBefore.convention === 'takeout-cue') result.description += before.some((prior, at) => prior.seat === entry.seat && isTakeoutDoubleAt(before, at))
      ? '；技术X方被迫回答强扣叫，不额外承诺18+ HCP或均型'
      : '；回答同伴强止张扣叫，保留此前负X或自然应叫已公开的点力，不将本手误作技术X方，也不额外承诺18+ HCP或均型';
    const ownTakeoutNT = before.findLastIndex((prior, at) => prior.seat === entry.seat && isTakeoutDoubleAt(before, at));
    const beforePartnerNT = partner && all.findLast(prior => prior.index < partner.index);
    if (ownTakeoutNT >= 0 && target.level === 3 && partner && partner.call.strain !== 'NT'
      && !isArtificialBidAt(before, partner.index, system) && beforePartnerNT
      && bidValue(partner.call) - bidValue(beforePartnerNT.call) > 5) {
      hcp(16);
      result.description = `接受同伴自然跳应叫邀请的3NT：${result.hcpRange!.min}+ HCP、敌套有本手或此前同伴公开NT止张，按同伴9–11 HCP下界使联手至少25 HCP；不额外承诺18+ HCP或均型，不把接受叫当技术X后首个自由18–20强NT再叫；${stopperDescription(result.stopperSources, index, entry.seat)}`;
    }
    return result;
  }
  const suit = target.strain as Suit;
  const previousBid = all.at(-2);
  const jumped = previousBid && bidValue(target) - bidValue(previousBid.call) > 5;
  const strongMichaelsRaise = strongMichaelsRaiseAt(prefix, index, system);
  if (strongMichaelsRaise) {
    set('natural-repeat', 'Michaels强牌分支的额外长高花邀请');
    hcp(17); length(suit, 6); result.invitation = true; result.intent = 'invitation'; result.forcing = 'none';
    const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
    result.description = `Michaels双套后，同伴已以最低2${suit}选套、敌方没有继续竞叫，本手主动3${suit}表示强分支17+ HCP及自己的6+张该高花；自然邀请不逼叫，弱双套手应在最低选择后止叫，不能只凭原8+ HCP五张套自动再加阶；同伴此前仅公开${partnerMinimum}+张，不虚构八张配合或短门支持点`;
    return result;
  }
  const fourthSuitMajorAnswer = fourthSuitOriginalMajorAnswerAt(prefix, index, system);
  if (fourthSuitMajorAnswer) {
    set('natural-repeat', '第四花色询问后的原高花六张回答');
    hcp(0, 21); length(suit, 6); result.intent = 'answer'; result.forcing = after.forcing;
    result.description = `开叫人已自然描述原高花和第二套，同伴第四花色询问后的首次3${suit}回原高花：本次进一步显示自己的6+张，保留此前${result.hcpRange!.min}+ HCP及第二套；五张原高花无第六张时可按真实第二套等自然回答，不虚报六张。${after.forcing === 'game' ? '已有独立进局逼叫继续' : '完成本轮询问后不自动新建进局逼叫'}；此六张承诺不推广到真实2/1进局逼叫中的最低五张原套重复`;
    return result;
  }
  if (reverseMinorPreferenceAt(prefix, index, system)) {
    set('natural-preference', '逆叫后的最低原低花弱偏好'); length(suit, Math.max(2, naturalSuitMinimum(before, entry.seat, suit, system))); hcp(0);
    result.forcing = 'none'; result.invitation = false; result.intent = 'answer'; result.artificial = false;
    result.description = `17+逆叫后最低3${suit}回原低花：2+张偏好，保留此前独立HCP和已示长度，本次不新增点力或五张支持承诺；履行一轮义务后NF，不凭原开叫低花四张和本次偏好虚构八配，也不强迫弱手升五阶`;
    return result;
  }
  const secondaryMinorInvitation = publicSecondaryMinorInvitationAt(prefix, index, system);
  if (secondaryMinorInvitation) {
    set('natural-repeat', '开叫人五五低花的额外实力邀请'); hcp(16, 18);
    length(secondaryMinorInvitation.original, 5); length(suit, 5);
    result.invitation = true; result.intent = 'invitation'; result.forcing = 'none'; result.artificial = false;
    result.description = `一低花–1S–二阶另一低花–弱2S之后，开叫人自主3${suit}重复第二套：16–18 HCP、原${secondaryMinorInvitation.original}五张及${suit}五张以上，五五低花自然邀请、不逼叫；不是保留四张而无额外实力的最低竞争回套，不推广到已有GF或敌方干扰的前序`;
    return result;
  }
  if (twoNTMinorEscapeAt(prefix, index, system)) {
    set('weak-minor-escape', '真实二阶NT争叫询问后的自然低花止损');
    hcp(0); length(suit, 6); result.artificial = false; result.forcing = 'none'; result.intent = 'signoff';
    result.description = `真实15–18 HCP二阶NT争叫、Stayman及3D否认回答后的最低4${suit}：本手6+张真实低花，保留此前独立点力，本次不新增邀请或29支持点承诺；自然NF止损，不保证同伴低花支持，不把9点弱手强逼到五阶，也不推广到强2NT开叫或未完成问叫`;
    return result;
  }
  if (weakFiveSpadeReturnAt(prefix, index, system)) {
    set('natural-repeat', '低花最低再叫后的弱五张黑桃回套');
    hcp(6, 9); length('S', 5); result.priorSuitMinimum = naturalSuitMinimum(before, entry.seat, 'S', system);
    result.forcing = 'none'; result.intent = 'signoff';
    result.description = `1m–1S–2m后的最低2S：6–9 HCP、自己的5+张黑桃；此前公开${result.priorSuitMinimum}+张，本次进一步显示5+张，自然弱回套不逼叫；不把原低花的最低再叫当进局逼叫，不推广到其他首次回套的六张合同，较强六S仍可按10–12真跳3S邀请`;
    return result;
  }
  const ntNewMinor = publicNTNewMinorAt(prefix, index, system);
  if (ntNewMinor) {
    set(ntNewMinor.game ? 'responder-second-suit' : 'long-minor-invitation', '已完成真实NT问答后的自然新低花');
    hcp(ntNewMinor.minimum, ntNewMinor.maximum); length(suit, ntNewMinor.length);
    result.forcing = ntNewMinor.game ? 'game' : 'none'; result.invitation = !ntNewMinor.game;
    result.intent = ntNewMinor.game ? 'descriptive' : 'invitation'; result.artificial = false;
    result.description = `真实自然NT平台的后续3${suit}新低花：本手${ntNewMinor.length}+张、${result.hcpRange!.min}${result.hcpRange!.max < 40 ? `–${result.hcpRange!.max}` : '+'} HCP；${ntNewMinor.game ? '原NT最低15+，联手已到25，建立进局逼叫并继续寻找真实配合或合适3NT，不把低花自持五张当作已确认八配' : '原NT为11–14弱／平衡来源，六张低花10–12自然邀请不逼叫，未达公开成局门槛可停三阶'}；保留原平台及已示高花，不混同弱低花2S接力或未经约定的八点五低花逃叫`;
    return result;
  }
  if (lowPointNaturalPreferenceAt(prefix, index, system)) {
    set('natural-preference', '已有两个自然花色后的廉价弱偏好');
    length(suit, Math.max(2, naturalSuitMinimum(before, entry.seat, suit, system))); hcp(0); result.artificial = false; result.forcing = 'none'; result.intent = 'signoff';
    result.description = `同伴已自然描述两套后的最低合法${target.level}${suit}回原套偏好：本手2+张，不保证恰好两张，也可能有更多支持；保留此前独立HCP／支持来源，本次不新增6+支持点或10+邀请门槛；自然不逼叫，弱Pass手也可选择此前已公开的较好配合；5-2偏好本身不宣称八配，也不适用于未完成的人工问叫或进局逼叫`;
    return result;
  }
  const completedNTQuestion = side.find(prior => prior.index < index
    && publicNoTrumpQuestionAt(before, prior.index, system)
    && side.some(reply => reply.index > prior.index && reply.index < index && reply.seat !== prior.seat));
  const ntGamePartner = side.findLast(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
    && prior.call.strain === 'NT' && isBalancedNoTrumpAt(before, prior.index, system)
    && (!isArtificialBidAt(before, prior.index, system))
    && (completedNTQuestion || ourOpening?.index === opening?.index));
  if (!major(suit) && target.level === 5 && ntGamePartner) {
    const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
    if (partnerMinimum >= 2) {
      set('natural-support', '已完成NT询问后的自然长低花成局');
      length(suit, Math.max(3, 8 - partnerMinimum)); hcp(0);
      const minimum = Math.max(0, 29 - publicSupportMinimum(suit, result.suitMinimum!,
        publicPlayerConstraints(before, partnerOf(entry.seat), system)));
      result.supportRange = { trump: suit, min: minimum, max: 40 };
      result.forcing = 'none'; result.intent = 'signoff'; result.artificial = false;
      result.description = `${completedNTQuestion ? '真实自然NT平台已完成Stayman／转移／低花接力后的' : '真实均型自然NT再叫之后的'}5${suit}自然成局：本手${result.suitMinimum}+张低花，与NT方此前公开${partnerMinimum}+张确认八配，${minimum}+调整支持点使联合公共下界至少29；不把已答问叫继续当人工定约，不借NT私牌补支持，不自动新增普通二盖一HCP门槛，成局可止叫`;
      return result;
    }
  }
  length(suit, naturalSuitMinimum(prefix, entry.seat, suit, system));
  const precisionPartnerAnswer=partner&&precisionConventionAt(before,partner.index,system);
  if(precisionPartnerAnswer&&['club-answer','shape-answer'].includes(precisionPartnerAnswer.stage)&&major(suit)&&target.level===4) {
    const partnerMinimum=naturalSuitMinimum(before,partnerOf(entry.seat),suit,system);
    set('natural-support','精确询问回答后的自然高花支持'); length(suit,Math.max(result.suitMinimum??0,8-partnerMinimum));
    result.intent='signoff'; result.forcing='none';
    result.description=`精确制询问回答已公开同伴${partnerMinimum}+张${suit}，本手${result.suitMinimum}+张自然支持选择4${suit}，确认八张配合；保留原11–15限制性开叫和真实人工形状，不把回答叫品当所叫花色自然长套，也不造本手六张或19–21强跳范围`;
    return result;
  }
  const weakOpening = ourOpening?.index===opening?.index&&ourOpening.call.level===2&&['D','H','S'].includes(ourOpening.call.strain)
    && !(system==='precision'&&ourOpening.call.strain==='D');
  if(weakOpening&&side.length===4&&response?.seat===entry.seat&&response.call.strain!==ourOpening.call.strain
    &&response.call.strain!=='NT'&&!isArtificialBidAt(prefix,response.index,system)
    &&side[2].seat===ourOpening.seat&&side[2].call.level===3&&side[2].call.strain===ourOpening.call.strain
    &&target.level===4&&!major(suit)&&suit!==ourOpening.call.strain&&suit!==response.call.strain
    &&!ownPrior.some(prior=>prior.call.strain===suit)&&naturalSuitMinimum(before,entry.seat,ourOpening.call.strain as Suit,system)
      +naturalSuitMinimum(before,ourOpening.seat,ourOpening.call.strain as Suit,system)<8) {
    set('weak-preempt-minor-correction','弱二强应叫后的有限低花纠正'); hcp(16); length(suit,4);
    result.suitMaximums={[ourOpening.call.strain]:1}; result.intent='descriptive'; result.forcing='none';
    result.description=`弱二后13+ HCP、五张新套应叫的一轮义务已由三阶原六套回答履行；本手首个续叫4${suit}为16+ HCP、4+张新低花、原开叫套至多一张且没有公开八配的自然纠正／配合探索，不逼局、不保证同伴支持；保留原五张新套与点力。这是本配置有界扩展，不冒称SAYC原卡规定所有第二套四张可叫`;
    return result;
  }
  const transferRequest = side.at(-3), transferAcceptance = side.at(-2);
  const transferQuestion = transferRequest && publicNoTrumpQuestionAt(before, transferRequest.index, system);
  if (transferQuestion?.kind === 'transfer' && target.level === 3 && major(suit)
    && suit !== transferQuestion.target && entry.seat === transferRequest!.seat
    && transferAcceptance?.seat === transferQuestion.platform.seat && transferAcceptance.call.strain === transferQuestion.target
    && transferAcceptance.call.level === transferRequest!.call.level) {
    set('responder-second-suit', '转移后的自然双高花进局逼叫');
    length(transferQuestion.target!, 5); length(suit, 5);
    hcp(Math.max(0, 25 - noTrumpRangeAt(before, transferQuestion.platform.index, system)!.min));
    result.forcing = 'game'; result.intent = 'descriptive';
    result.description = `自然NT转移并接叫后3${suit}：5+张${suit}及此前转移所示的5+张${transferQuestion.target}，${result.hcpRange!.min}+ HCP，双高花进局逼叫；本次建立进局逼叫，至少选高花成局或合适3NT，不以五加三支持代替真实五五，也不是Stayman后的四四邀请`;
    return result;
  }
  const invited = partner && publicCallMeaningAt(before, partner.index, system);
  if (invited?.invitation && invited.supportRange?.trump === suit && target.level === gameLevel(suit)
    && partner!.call.strain === suit && naturalSuitMinimum(before, partnerOf(entry.seat), suit, system)
      + naturalSuitMinimum(before, entry.seat, suit, system) >= 8) {
    set('accepted-invitation', '接受已确认配合的自然邀请');
    const total = major(suit) ? 25 : 29;
    result.jointSupportFloor = { trump: suit, total, invitationIndex: partner!.index };
    result.intent = 'signoff'; result.forcing = 'none';
    result.priorSuitMinimum = naturalSuitMinimum(before, entry.seat, suit, system);
    length(suit, result.priorSuitMinimum);
    result.description = `接受同伴第${partner!.index + 1}步的明确${suit}支持点邀请，选择${target.level}${suit}：本手保留此前${result.priorSuitMinimum}+张，按本手实际支持与该邀请在当前真实配合下的最低值，联手至少${total}调整支持点；不为接叫人制造固定HCP或支持点下限，也不把接受叫品额外变成六张；邀请方有超出其原公布下界的真实盈余时可继续安全探查，仍需旁门控制与关键张依据`;
    return result;
  }
  if (semiNTWeakMajorAt(prefix, index, system)) {
    set('semi-nt-new-major', '半逼叫无将后的自然弱新高花'); length(suit, 5); hcp(5, 12);
    result.forcing = 'none'; result.intent = 'descriptive';
    result.description = `1${ourOpening.call.strain}–半逼叫1NT–2${side[2].call.strain}后的2${suit}：5–12 HCP、自己的5+张新高花，自然不逼叫；保留原1NT点力范围，不是先前自然1S应叫后四张第二套的逼叫一轮，也不是两张原高花偏好`;
    return result;
  }
  if (semiNTMajorEscapeAt(prefix, index, system)) {
    set('semi-nt-major-escape', '半逼叫后原六黑桃无配合的自然六红心退路');
    length('H', 6); hcp(5, 12); result.suitMaximums = { S: 1 };
    result.invitation = false; result.forcing = 'none'; result.intent = 'signoff';
    result.description = '1S–半逼叫1NT–原开叫人2S后的最低合法3H：自己的6+张红心、黑桃至多一张，保留5–12 HCP，自然不逼叫；这是无原六黑桃配合时的长套退路，3H是最低合法叫品，不自动显示10–12邀请，也不保证伙伴红心支持。原黑桃已有两张时与公开六张确认八配，应优先比较原配合，不使用这一退路；开叫人回2m且仍有2H合法时的真跳3H仍为10–12邀请';
    return result;
  }
  if (ourOpening?.index === opening?.index && ourOpening.call.level === 1 && major(ourOpening.call.strain)
    && response?.call.level === 1 && response.call.strain === 'NT' && side.length === 4
    && entry.seat === response.seat && side[2].seat === ourOpening.seat && side[2].call.level === 2
    && target.level === 3 && (!major(suit) || jumped) && suit !== ourOpening.call.strain && suit !== side[2].call.strain
    && !forcedBefore.mustBid && !intervened(prefix, entry.seat, ourOpening.index, index)) {
    set(major(suit) ? 'semi-nt-new-major-invitation' : 'semi-nt-new-minor-invitation', '半逼叫无将后的自然新六张长套邀请');
    const minorShape = semiNTMinorInvitationShapeAt(prefix, index);
    if (minorShape) result.minorInvitationShape = minorShape;
    length(suit, minorShape ? 5 : 6); hcp(10, 12); result.invitation = true; result.intent = 'invitation'; result.forcing = 'none';
    result.description = `1${ourOpening.call.strain}–半逼叫1NT–开叫人二阶自然再叫后的3${suit}：${minorShape ? '自己的六张梅花，或梅花五张加方块五张且原高花至多一张的双低花备选；公共保守五C，不向普通五C无第二长套手放宽' : `自己的6+张此前未示新${major(suit) ? '高' : '低'}花`}、10–12 HCP邀请，NF；不把原1NT当转移平台，不新增已经公布的原高花支持，不混同二阶5–12 HCP五张弱新高花或严格均型1m1S1NT后的五五逼局`;
    return result;
  }
  const firstNTCompetitiveResponse = ourOpening && entry.seat !== ourOpening.seat && ownPrior.length === 0
    && side.length === 2 && isNaturalNoTrumpAt(before, ourOpening.index, system)
    && ourOpening.call.level === 1 && intervened(prefix, entry.seat, ourOpening.index, index);
  if (firstNTCompetitiveResponse && target.level === 3 && !major(suit) && !jumped) {
    set('nt-competitive-minor-escape', '自然无将遭插叫后的弱长低花逃叫');
    length(suit, 6); hcp(5, 9); result.forcing = 'none'; result.intent = 'signoff';
    result.description = `真实1NT开叫／自然争叫遭花色插叫，二阶低花无合法空间后的最低3${suit}：5–9 HCP、自己的6+张真实低花，自然弱逃叫、不逼叫；保留先前NT两张支持及敌套止张，不使用未约定的Lebensohl接力；八配仍须按真实长度，低花未达29支持点可停三阶`;
    return result;
  }
  if (firstNTCompetitiveResponse && target.level === 4 && major(suit)) {
    set('nt-competitive-major-game', '自然无将遭插叫后的长高花成局');
    const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
    length(suit, Math.max(6, 8 - partnerMinimum)); hcp(0);
    const minimum = Math.max(0, 25 - publicSupportMinimum(suit, result.suitMinimum!,
      publicPlayerConstraints(before, partnerOf(entry.seat), system)));
    result.supportRange = { trump: suit, min: minimum, max: 40 };
    result.forcing = 'none'; result.intent = 'signoff';
    result.description = `真实自然1NT遭花色插叫后的4${suit}自然成局：本手${result.suitMinimum}+张长高花，与NT方公开${partnerMinimum}+张确认八张配合，${minimum}+调整支持点，联手公开最低25；不新增10 HCP门槛，也不是人工转移或普通五张三阶应叫；保留NT原点力、严格均型及止张来源，到局可止叫`;
    return result;
  }
  if (!result.artificial && partner && ['overcall-cue', 'competitive-cue'].includes(forcedBefore.convention)
    && forcedBefore.forcing !== 'game'
    && !ownPrior.some(prior => prior.call.strain === suit && !isArtificialBidAt(before, prior.index, system))
    && !side.some(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
      && prior.call.strain === suit && !isArtificialBidAt(before, prior.index, system))) {
    set('natural-second-suit', '支持或止张扣叫后的最低自然回答');
    const originalMajor = ownPrior.find(prior => prior.call.strain === suit && major(suit)
      && !isArtificialBidAt(before, prior.index, system));
    const ownPriorLength = naturalSuitMinimum(before, entry.seat, suit, system);
    length(suit, originalMajor || ownPriorLength >= 4 ? ownPriorLength : entry.seat === ourOpening?.seat ? 4 : 5);
    hcp(0); result.intent = 'answer'; result.forcing = 'none';
    result.description = `同伴人工支持／止张扣叫后的自然${target.level}${suit}回答：${result.suitMinimum}+张真实花色，保留此前${result.hcpRange!.min}+ HCP；履行一轮自然描述义务，不新增10+ HCP或下一轮逼叫，不把先前负X询问的高花改成敌方后来所叫花色；已有独立进局逼叫时仍按原协议继续`;
    return result;
  }
  const ownStrongCue = ownPrior.find(prior => publicCallMeaningAt(before, prior.index, system).role === 'cue'
    && analyzeAuctionSemantics(before.slice(0, prior.index + 1), partnerOf(entry.seat), system).convention === 'takeout-cue');
  if (ownStrongCue && ownPrior.length === 1 && partner && partner.index > ownStrongCue.index
    && !side.some(prior => prior.index < index && prior.call.strain === suit && !isArtificialBidAt(before, prior.index, system))) {
    set('takeout-cue-continuation', '强扣叫应叫人的自然新套续叫');
    hcp(major(suit) ? 12 : 16); length(suit, major(suit) ? 5 : 4); result.forcing = after.forcing === 'game' ? 'game' : 'none'; result.intent = 'descriptive';
    result.description = `技术性加倍后强扣叫已经得到自然回答，本轮自然${target.level}${suit}续叫：${result.hcpRange!.min}+ HCP、${result.suitMinimum}+张真实新套；保留先前强扣叫12+ HCP，不造双高花五五；${result.forcing === 'game' ? '与同伴已经公开的原始点力最低合计25，继续自然描述直至成局，不能Pass停在三阶' : '未达公共25时不自动建立进局逼叫，同伴可依真实配合继续或Pass'}`;
    return result;
  }
  if (naturalPreferenceAt(prefix, index, system)) {
    set('natural-preference', '弱牌自然二張偏好'); length(suit, 2); result.intent = 'signoff'; result.forcing = 'none';
    result.description = `自然${target.level}${suit}弱牌偏好：至少二张原套支持，不保证恰好两张；可选择5-2部分定约，保留此前自然响应点力；此前没有继续叫牌义务，不邀请，不把五加二当八张配合，也不适用于支持性扣叫、Jacoby或三阶侧套邀请`;
    return result;
  }
  if (ourOpening?.index === opening?.index && ourOpening.call.level === 1 && major(ourOpening.call.strain)
    && response?.seat === entry.seat && response.call.level === 1 && response.call.strain === 'NT'
    && ownPrior.length === 1 && target.level === 3 && major(suit) && jumped) {
    set('natural-response', '半逼叫1NT后的长高花跳再叫邀请');
    hcp(10, 12); length(suit, 6); result.invitation = true; result.forcing = 'none'; result.intent = 'invitation';
    result.description = `半逼叫1NT后的3${suit}长套跳再叫：10–12 HCP、6+张自然高花，邀请成局，不是弱牌偏好；同伴无配合时可比较3NT`;
    return result;
  }
  if (forcedBefore.convention === 'michaels-inquiry') {
    set('michaels-minor-answer', 'Michaels询问后的自然低花'); length(suit, 5); result.intent = 'answer';
    return result;
  }
  const firstTwoSuitAdvance = ownPrior.length === 0 && ourOpening?.seat === partnerOf(entry.seat)
    && ourOpening.index !== opening?.index && ourOpening.call.level === 2
    && !before.some((prior, at) => prior.seat === entry.seat && isTakeoutDoubleAt(before, at))
    && isArtificialBidAt(prefix, ourOpening.index, system)
    && (ourOpening.call.strain === opening?.call.strain || ourOpening.call.strain === 'NT');
  if (firstTwoSuitAdvance || forcedBefore.convention === 'michaels-advance' || forcedBefore.convention === 'unusual-advance') {
    set('two-suit-choice', '双套争叫后的自然选择'); result.intent = 'answer';
    const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
    if (partnerMinimum >= 5) {
      length(suit, jumped ? 3 : 1);
      if (jumped && target.level === 3) {
        result.supportRange = { trump: suit, min: 10, max: 12 };
        result.invitation = true; result.intent = 'invitation';
      }
      if (target.level >= gameLevel(suit)) {
        length(suit, Math.max(3, 8 - partnerMinimum));
        const minimum = Math.max(0, (major(suit) ? 25 : 29) - publicSupportMinimum(suit, result.suitMinimum!,
          publicPlayerConstraints(before, partnerOf(entry.seat), system)));
        result.supportRange = { trump: suit, min: minimum, max: 40 }; result.intent = 'signoff';
        result.description = `双套争叫后的${target.level}${suit}自然成局选择：本手${result.suitMinimum}+张支持同伴公开${partnerMinimum}+张，确认八配；${minimum}+调整支持点使联手至少${major(suit) ? 25 : 29}，这是主动成局而非最低被迫选择，无新原始点力门槛，到局可止叫`;
      } else result.description = `双套争叫后的${target.level}${suit}自然选择：本手${result.suitMinimum}+张偏好同伴公开${partnerMinimum}+张${suit}，作出选择；${result.invitation ? '另有更低合法支持，真跳叫表示10–12支持点邀请' : '当前最低合法支持回答，不从三阶高度推导10–12邀请；不额外保证点力，单张偏好用于两门均短时止损，不宣称八配'}，履行本轮选择义务后不逼叫，同伴可Pass`;
    } else {
      result.defined = false; result.role = 'unknown'; result.roleLabel = '双套争叫后的未约定独立新套';
      result.description = `同伴人工双套没有公开${suit}为五张所示套，${target.level}${suit}不能解释为选择已示花色；本卡未定义此独立新套的点力、长度与套质，不借必须回答人工叫的义务虚构同伴支持，须选择有约定的示套偏好或询问`;
    }
    return result;
  }
  if (opening?.index === index) {
    set(openerStrongClub(target) ? 'strong-opening' : 'natural-opening', '开叫');
    if (target.level === 1) hcp(system === 'precision' ? 11 : 12, system === 'precision' ? 15 : 21);
    else if (openerStrongClub(target)) hcp(22);
    else if (target.level === 2) hcp(5, 11);
    else if (target.level === 3 || target.level === 4 && system === 'sayc') hcp(system === 'sayc' ? 5 : 6, 10);
    if (target.level === 3 && system === 'sayc')
      result.description = `三阶阻击开叫3${suit}：5–10 HCP、7+张且本套至少一张Q以上大牌；七张单Q为允许的最低套质，不能用七张全小牌冒充合格；不保证同伴支持，NF`;
    return result;
  }
  const partnerTakeout = before.findLastIndex((prior, priorIndex) => prior.seat === partnerOf(entry.seat) && isTakeoutDoubleAt(before, priorIndex));
  const ownTakeout = before.findLastIndex((prior, priorIndex) => prior.seat === entry.seat && isTakeoutDoubleAt(before, priorIndex));
  if (partnerTakeout >= 0 && ownPrior.length === 0) {
    const strongPartner = partner && publicCallMeaningAt(before, partner.index, system);
    if (target.level === gameLevel(suit) && partner?.call.strain === suit
      && strongPartner?.role === 'takeout-strong-rebid') {
      set('natural-support', '技术X方自然强套已示后的成局支持');
      const promised = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      length(suit, Math.max(3, 8 - promised)); hcp(0);
      result.forcing = 'none'; result.intent = 'signoff';
      result.description = `同伴技术X后已经自然${partner.call.level}${suit}显示17+ HCP及${promised}+张，本手${result.suitMinimum}+张支持成局；保留本手此前独立点力，按真实八配及${major(suit) ? 25 : 29}联手支持点判断，不再套首次9–11 HCP自由跳答或额外邀请范围，成局可止叫`;
      return result;
    }
    const free = bids(before).some(prior => prior.index > partnerTakeout && sideOf(prior.seat) !== sideOf(entry.seat));
    const previous = all.at(-2), jump = previous && bidValue(target) - bidValue(previous.call) > 5;
    const cheapestSuitLevel = previous && [1, 2, 3, 4, 5, 6, 7].find(level =>
      bidValue({ kind: 'bid', level, strain: suit }) > bidValue(previous.call));
    set(free ? 'takeout-free-response' : 'takeout-minimum-response', free ? '技术X后的自然自由答叫' : '技术X后的自然答叫');
    hcp(jump ? 9 : free ? 6 : 0, jump ? 11 : 40);
    result.invitation = !!jump; result.intent = jump ? 'invitation' : free ? 'competitive' : 'answer';
    if (free) length(suit, 4);
    result.description = `${result.roleLabel}${target.level}${suit}：${jump ? '9–11' : free ? '6+' : '0+'} HCP、${result.suitMinimum ? `${result.suitMinimum}+张` : '受空间影响不保证四张'}自然花色；${jump ? `已有更低合法自然答叫，最低可叫${cheapestSuitLevel}${suit}，此跳应叫主动显示邀请实力` : free ? '原本可Pass，敌方应叫人此前叫过此套也不自动变人工扣叫' : '最低被迫回复不保证点力，也不固定限制8点上限'}；${jump ? '邀请' : '不逼叫'}`;
    return result;
  }
  if (ownTakeout >= 0 && ownPrior.length === 0) {
    const competitiveRaise = takeoutCompetitiveRaiseAt(prefix, index, system);
    if (competitiveRaise) {
      set('competitive-support', '技术X后对同伴自然答叫的最低竞争支持');
      length(suit, 4); hcp(0); result.forcing = 'none'; result.intent = 'competitive';
      const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      result.description = `技术X后对同伴${competitiveRaise.answer.call.level}${suit}自然答叫的${target.level}${suit}最低竞争支持：本手4+张，保留原技术X的${result.hcpRange!.min}+ HCP，敌方后续自然叫牌使本次加叫成为竞争而非16–18／18–20支持邀请；不额外保证17+或五张新套；同伴仅公开${partnerMinimum}+张，${partnerMinimum + 4 >= 8 ? '已确认八张配合' : '尚不无条件保证八张配合，不虚加短门支持点'}，自然不逼叫`;
      return result;
    }
    const strengthRedouble = before.slice(ownTakeout + 1).some(prior => sideOf(prior.seat) !== sideOf(entry.seat)
      && prior.call.kind === 'redouble');
    if (strengthRedouble && target.level <= 2) {
      set('weak-takeout-redoubled-escape', '技术X遭实力XX后的自然逃叫');
      length(suit, 4); hcp(0); result.forcing = 'none'; result.intent = 'competitive';
      result.description = `本手技术X遭敌方实力XX后，以最低一／二阶${target.level}${suit}自然逃叫：真实4+张，保留原加倍HCP下界；不另承诺17+或五张强自由再叫，不能把短敌套的普通技术X手牌强迫防守敌方XX定约；自然不逼叫，不保证同伴配合`;
      return result;
    }
    if (forcedBefore.convention === 'takeout-cue') {
      set('natural-second-suit', '技术X后被迫回答同伴强扣叫'); length(suit, 3); result.intent = 'answer';
      hcp(0);
      result.description = `技术性加倍后回答同伴强扣叫的${target.level}${suit}：可仅三张（3+张）自然花色，保留原技术X的${result.hcpRange?.min ?? 0}+ HCP实力；${opening?.call.level === 2 && opening.call.strain !== 'C' && opening.call.strain !== 'NT' ? '对弱二通常13+ HCP；12点仅允许敌套单缺且三门未叫套各4+的补偿；' : ''}这是被迫自然回答，不额外表示17+ HCP自由长套，也不保证四张或五张；履行一轮义务后${after.forcing === 'game' ? '既有进局逼叫仍继续' : '不自动继续逼叫'}`;
      return result;
    }
    const last = all.at(-2);
    const minimumMinorRaise = !major(suit) && target.level === 4 && partner?.call.strain === suit
      && !isArtificialBidAt(prefix, partner.index, system) && last
      && bidValue(target) - bidValue(last.call) <= 5 && !forcedBefore.mustBid;
    if (minimumMinorRaise) {
      set('takeout-minor-invitation', '技术X方最低四阶低花自然邀请'); length(suit, 5);
      const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      if (partnerMinimum + 5 >= 8) result.supportRange = { trump: suit, min: 18, max: 40 };
      else hcp(18);
      result.invitation = true; result.forcing = 'none'; result.intent = 'invitation';
      result.description = `技术X方在同伴最低${partner.call.level}${suit}答叫后的4${suit}自然邀请：本手5+张、18+${result.supportRange ? '调整支持点，已公开确认八张配合' : ' HCP，尚未公开八张配合，不虚加短门点'}；没有20点上限，保留原技术X的独立HCP下界；低花以公开29支持点接受5${suit}，否则可Pass；不从额外实力直接推导33点或问关键张`;
      return result;
    }
    const escape = before.slice(ownTakeout + 1).some(prior => sideOf(prior.seat) !== sideOf(entry.seat) && prior.call.kind === 'redouble');
    const beforePartner = partner && all.findLast(prior => prior.index < partner.index);
    const simpleInvitation = takeoutSupportInvitationAt(prefix, index, system);
    if (simpleInvitation && !forcedBefore.mustBid) {
      set('takeout-support-invitation', '技术X方在最低答叫后的自然邀请');
      const { min, max, answer } = simpleInvitation;
      const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      const fit = partnerMinimum + (result.suitMinimum ?? 0) >= 8;
      if (fit) result.supportRange = { trump: suit, min, max }; else hcp(min, max);
      result.invitation = true; result.intent = 'invitation'; result.forcing = 'none';
      result.description = `技术X方在同伴最便宜${answer.call.level}${suit}答叫后的${simpleInvitation.jump ? '跨两阶跳加叫' : '简单加叫'}${target.level}${suit}：4+张支持、${min}–${max}${fit ? '支持点，公开已确认至少八张配合' : ' HCP，公开尚未确认八张配合，不虚加短门支持点'}，邀请、不逼叫；不同于答叫人被迫作最便宜三阶高花或四阶低花回复，后者不从阶数额外承诺邀请点力`;
      return result;
    }
    if (!escape && !forcedBefore.mustBid && partner?.call.strain === 'NT' && major(suit)
      && target.level === 4) {
      set('takeout-long-major-game', '技术X后选择自己长高花成局'); length(suit, 6); result.intent = 'signoff';
      result.description = `技术X后面对自然无将答叫，选择自己6+张高花4${suit}成局；保留原加倍的公开实力，不额外承诺17+或鼓励同伴仅据此探索满贯`;
      return result;
    }
    if (!escape && !forcedBefore.mustBid && partner && beforePartner && partner.call.strain !== 'NT'
      && bidValue(partner.call) - bidValue(beforePartner.call) > 5 && partner.call.strain !== suit) {
      if (target.level === 4 && major(suit)) {
        set('takeout-long-major-game', '接受自然跳应叫邀请并选择自己长高花成局');
        length(suit, 6); hcp(16); result.forcing = 'none'; result.intent = 'signoff';
        result.description = `技术X方接受同伴9–11 HCP自然跳应叫邀请，选择自己的6+张高花4${suit}成局：16+ HCP与伙伴邀请下界使联手至少25 HCP；没有公开八配时仍用HCP，不借未知高花支持加短门点，不把四张廉价新套描述直接当作独立高花成局，NF`;
        return result;
      }
      set('natural-second-suit', '技术X后回答自然跳应叫邀请'); length(suit, 4);
      result.description = `技术X方以自然${target.level}${suit}回应同伴的跳应叫邀请：本手4+张真实第二套、保留原X实力；不是17+五张首次自由长套，也不自动逼局，同伴继续比较真正配合`;
      return result;
    }
    if (!escape && !forcedBefore.mustBid && partner?.call.strain !== suit) {
      set('takeout-strong-rebid', '技术X后首次自由自然长套'); hcp(17); length(suit, 5);
      result.description = `技术性加倍后首次自由再叫自然${target.level}${suit}：17+ HCP、5+张；不是被迫扣叫回答或XX后的弱逃叫，这份额外实力在后续偏好和回套后仍保留`;
      return result;
    }
  }
  const partnerSuit = side.findLast(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
    && prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system));
  if (partnerSuit && !ownPrior.some(prior => prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system))) {
    const competition = all.some(prior => prior.index > partnerSuit.index && prior.index < index
      && sideOf(prior.seat) !== sideOf(entry.seat) && !isArtificialBidAt(prefix, prior.index, system));
    set(competition ? 'competitive-support' : 'natural-support', competition ? '自然竞争支持或偏好' : '自然支持或偏好');
    result.intent = target.level >= gameLevel(suit) ? 'signoff' : forcedBefore.mustBid ? 'answer' : competition ? 'competitive' : 'descriptive';
    const promised = publicPlayerConstraints(before, partnerOf(entry.seat), system).suitMinimums[suit];
    const points = (min: number, max: number) => {
      if (promised + (result.suitMinimum ?? 0) >= 8) result.supportRange = { trump: suit, min, max };
      else hcp(min, max);
    };
    if (major(suit) && target.level === 2 && !jumped && ownPrior.length === 1
      && ourOpening?.index !== opening?.index && ourOpening?.seat === entry.seat
      && suit !== ourOpening.call.strain && partnerSuit.call.level === 1 && promised === 4) {
      set('natural-preference', '原自然争叫人对同伴一阶高花的廉价支持');
      length(suit, 3); hcp(8, 16); result.forcing = 'none'; result.intent = 'competitive';
      result.description = `原自然争叫人对同伴四张一阶高花的最低2${suit}偏好：3+张，保留原8–16 HCP及原争叫套；不套首次6–9支持上界，不额外保证八配或添加短门点，自然NF`;
      return result;
    }
    if (!major(suit) && target.level === 4 && !jumped && !result.artificial)
      length(suit, Math.max(naturalSuitMinimum(before, entry.seat, suit, system), 3, 8 - promised));
    if (naturalStaymanAnswerAt(prefix, partnerSuit.index, system) && partnerSuit.call.level === 2 && target.level === 3) {
      const platform = side.findLast(prior => prior.index < partnerSuit.index && isNaturalNoTrumpAt(prefix, prior.index, system));
      const platformRange = platform && noTrumpRangeAt(prefix, platform.index, system);
      const minimum = Math.max(8, 25 - (platformRange?.max ?? 17));
      hcp(minimum, minimum + 1); length(suit, 4); result.invitation = true; result.intent = 'invitation';
      result.description = `Stayman自然${partnerSuit.call.level}${suit}答叫后的3${suit}：本手4+张支持，同伴公开四张，确认八张配合；${minimum}–${minimum + 1} HCP自然邀请、不逼叫；即使敌方原开叫花色也叫${suit}，自然Stayman回答仍不是人工支持扣叫，不制造未知的一轮义务`;
      return result;
    }
    if (ownTakeout >= 0 && ownPrior.length === 0 && target.level === gameLevel(suit)) {
      const priorPartner = all.findLast(prior => prior.index < partnerSuit.index);
      const jumpAnswer = priorPartner && bidValue(partnerSuit.call) - bidValue(priorPartner.call) > 5;
      if (jumpAnswer) {
        result.description = `技术性加倍方接受同伴9–11 HCP自然跳应叫邀请，选择${target.level}${suit}成局：保留原技术X的公开实力和本手${result.suitMinimum}+张支持，按真实八张配合及联手${major(suit) ? 25 : 29}支持点判断；不把加倍方误作争叫人的弱6–9支持点加叫，不额外承诺17+ HCP`;
        return result;
      }
    }
    const priorSupportCue = ownPrior.find(prior => isArtificialBidAt(prefix, prior.index, system)
      && ['overcall-cue', 'competitive-cue'].includes(analyzeAuctionSemantics(prefix.slice(0, prior.index + 1), partnerOf(entry.seat), system).convention));
    if (priorSupportCue && publicCallMeaningAt(before, priorSupportCue.index, system).supportRange?.trump === suit) {
      set('support-cue-continuation', '支持性扣叫后的自然支持续叫');
      length(suit, Math.max(result.suitMinimum ?? 0, 3));
      const cueMeaning = publicCallMeaningAt(prefix, priorSupportCue.index, system);
      result.description = `支持性扣叫后的自然${target.level}${suit}：保留原先${cueMeaning.supportRange ? '10+调整支持点及独立HCP' : '10+ HCP'}和三张以上支持承诺，不降为二张偏好；${target.level >= gameLevel(suit) ? `选择${target.level === 7 ? '大满贯' : target.level === 6 ? '小满贯' : '成局'}止叫` : after.forcing === 'game' ? '此前进局逼叫继续' : '原扣叫一轮已被同伴自然回答履行，本轮不因重复支持新建逼叫'}；搭档套长与点力保持此前公开下限`;
      return result;
    }
    const otherMajorInvitation = staymanContinuationAt(before, partnerSuit.index, system);
    if (otherMajorInvitation?.kind === 'other-major-invitation' && otherMajorInvitation.platform.seat === entry.seat
      && target.level === 3 && major(suit)) {
      length(suit, 4); result.forcing = 'none'; result.intent = 'signoff';
      result.description = `Stayman另一四张高花邀请后的最低3${suit}：本手4+张支持同伴已公开四张，确认八配；保留原NT点窗，未接受高花成局邀请，可停部分定约，不把最低拒邀解释为三张七配或新的邀请`;
      return result;
    }
    const twoOverOneSupport = ourOpening?.index === opening?.index && response
      && isTwoOverOne(ourOpening, response, prefix) && major(suit) && [3, 4].includes(target.level)
      && (entry.seat === ourOpening.seat && suit === response.call.strain
        || entry.seat !== ourOpening.seat && suit === ourOpening.call.strain);
    if (twoOverOneSupport) {
      const openerSupport = entry.seat === ourOpening.seat;
      hcp(openerSupport ? target.level === 3 ? 15 : 12 : 13, openerSupport && target.level >= 4 ? 14 : 40);
      length(suit, 3); result.intent = target.level === 3 ? 'descriptive' : 'signoff';
      result.description = openerSupport
        ? `开叫人二盖一后的${target.level === 3 ? '慢到局' : '快到局'}自然${target.level}${suit}支持：3+张支持、${target.level === 3 ? '15+ HCP，保留满贯探索空间；原有进局逼叫仍继续' : '最低限12–14 HCP，选择高花成局，可止叫'}，不降为二张偏好或另加邀请范围`
        : `应叫人二盖一后回支持开叫高花${target.level}${suit}：保留原公开点力下限13+ HCP，3+张支持同伴五张，确认至少8张配合；${after.forcing === 'game' ? '原有进局逼叫仍继续' : '已选择高花成局，可止叫'}，不套开叫人的12–14快到局上限，也不降为二张偏好`;
      return result;
    }
    const originalMajor = ourOpening?.index === opening?.index && ourOpening.call.level === 1 && major(suit) && ourOpening.call.strain === suit
      && ownPrior.length === 0;
    if (originalMajor && target.level < gameLevel(suit) && !jumped) points(6, target.level === 3 ? 40 : 9);
    if (originalMajor && target.level === 3 && jumped) {
      points(10, 12); result.invitation = true; result.intent = 'invitation';
    }
    const firstSecondMajorSupport = ourOpening?.index === opening?.index && ourOpening.call.level === 1
      && major(suit) && entry.seat !== ourOpening.seat && ownPrior.length === 0 && partnerSuit.seat === ourOpening.seat
      && suit !== ourOpening.call.strain && target.level === partnerSuit.call.level + 1 && !jumped;
    const strongTakeoutSupport = partnerTakeout >= 0 && major(suit) && !jumped
      && publicCallMeaningAt(prefix, partnerSuit.index, system).role === 'takeout-strong-rebid';
    if (firstSecondMajorSupport || strongTakeoutSupport) {
      points(6, target.level >= gameLevel(suit) || target.level === 3 ? 40 : 9); result.invitation = false;
      result.intent = competition ? 'competitive' : 'descriptive';
    }
    const originalMinor = ourOpening?.index === opening?.index && ourOpening.call.level === 1
      && ourOpening.call.strain === suit && !major(suit) && ownPrior.length === 0;
    if (originalMinor && target.level < gameLevel(suit)) {
      if (target.level === 2 && !jumped) points(6, 9);
      if (target.level === 3 && jumped) { points(10, 12); result.invitation = true; result.intent = 'invitation'; }
    }
    const openerJumpSupport = ourOpening?.index === opening?.index && ourOpening.call.level === 1
      && entry.seat === ourOpening.seat && ownPrior.length === 1 && target.level === 3 && jumped;
    if (openerJumpSupport) {
      length(suit, Math.max(4, 8 - promised));
      points(16, 18); result.invitation = true; result.intent = 'invitation';
    }
    const overcallRaise = ownTakeout < 0 && partnerTakeout < 0 && ourOpening?.index !== opening?.index && ourOpening?.seat !== entry.seat
      && ownPrior.length === 0 && major(suit) && target.level === partnerSuit.call.level + 1;
    const partnerPreempt = publicCallMeaningAt(before, partnerSuit.index, system).roleLabel === '首次阻击争叫'
      || partnerSuit.index === opening?.index && opening.call.level >= 2 && opening.call.strain !== 'NT'
        && !(opening.call.level === 2 && opening.call.strain === 'C');
    if (overcallRaise && !partnerPreempt && target.level < gameLevel(suit)) points(6, target.level === 3 && !jumped ? 40 : 9);
    if (ownTakeout < 0 && partnerTakeout < 0 && ourOpening?.index !== opening?.index && ourOpening?.seat !== entry.seat
      && ownPrior.length === 0 && major(suit) && target.level === 3 && jumped && !forcedBefore.mustBid && !partnerPreempt) {
      points(10, 12); result.invitation = true; result.intent = 'invitation';
    }
    const responderMinorInvitation = ourOpening?.index === opening?.index && entry.seat !== ourOpening.seat
      && ownPrior.length > 0 && !major(suit) && target.level === 3 && partnerSuit.call.level === 2 && !competition
      && !forcedBefore.mustBid && after.forcing !== 'game';
    if (responderMinorInvitation) {
      length(suit, Math.max(3, 8 - promised));
      points(10, 12); result.invitation = true; result.intent = 'invitation';
    }
    const voluntaryStrongMinorInvitation = !major(suit) && target.level === 4 && jumped
      && !forcedBefore.mustBid && after.forcing !== 'game';
    if (voluntaryStrongMinorInvitation) {
      set('stronger-minor-invitation', '较强低花自然跳邀请');
      length(suit, Math.max(3, 8 - promised)); points(13, 16);
      result.invitation = true; result.intent = 'invitation'; result.forcing = 'none';
    } else if (target.level < gameLevel(suit) && !jumped && !forcedBefore.mustBid
      && !result.hcpRange && !result.supportRange
      && !(ourOpening?.index===opening?.index&&entry.seat===ourOpening.seat&&ownPrior.length>0)
      && !(ourOpening?.index===opening?.index&&(ourOpening.call.level>=3||weakOpening))
      && !(ourOpening?.index!==opening?.index&&publicCallMeaningAt(before,ourOpening.index,system).roleLabel==='首次阻击争叫'))
      points(6, competition?40:major(suit)&&target.level===2?9:40);
    const responderMajorInvitation = ourOpening?.index === opening?.index && entry.seat !== ourOpening.seat
      && ownPrior.length > 0 && major(suit) && target.level === 3 && partnerSuit.call.level <= 2
      && after.forcing !== 'game' && !forcedBefore.mustBid;
    if (responderMajorInvitation) {
      length(suit, Math.max(naturalSuitMinimum(before, entry.seat, suit, system), promised >= 6 ? 2 : 3, 8 - promised));
      points(10, 12); result.invitation = true; result.intent = 'invitation';
    }
    const negativeDoubleJumpSupport = major(suit) && target.level === 3 && jumped && partnerSuit.call.level === 1
      && ourOpening?.index === opening?.index && partnerSuit.seat === ourOpening.seat
      && !forcedBefore.mustBid && after.forcing !== 'game'
      && before.some((prior, at) => prior.seat === entry.seat && isNegativeDoubleAt(before, at)
        && publicNegativeDoubleMajorsAt(before, at).includes(suit));
    if (negativeDoubleJumpSupport) {
      length(suit, 4); points(10, 12); result.invitation = true; result.intent = 'invitation'; result.forcing = 'none';
    }
    const strongOpenerGameSupport = ourOpening?.index === opening?.index && ourOpening.call.level === 1
      && entry.seat === ourOpening.seat && ownPrior.length === 1 && major(suit) && target.level === 4
      && jumped && after.forcing !== 'game' && !competition && response?.call.level === 1
      && !intervened(prefix, entry.seat, ourOpening.index, index) && !isArtificialBidAt(prefix, ourOpening.index, system);
    if (strongOpenerGameSupport) { points(19, 21); result.intent = 'signoff'; }
    const rangeText = result.supportRange ? `${result.supportRange.min}${result.supportRange.max < 40 ? `–${result.supportRange.max}` : '+'}支持点`
      : result.hcpRange ? `${result.hcpRange.min}${result.hcpRange.max < 40 ? `–${result.hcpRange.max}` : '+'} HCP` : undefined;
    const contract = target.level === 7 ? '大满贯' : target.level === 6 ? '小满贯' : '成局';
    if (partnerPreempt && target.level < gameLevel(suit)) {
      result.hcpRange = undefined; result.supportRange = undefined; result.invitation = false; result.forcing = 'none';
      result.description = `同伴弱阻击后的自然${target.level}${suit}延长阻击：本手${result.suitMinimum}+张支持／偏好，同伴此前公开${promised}+张；不逼叫，不额外承诺邀请或6+ HCP、6–9支持点，不套普通五张争叫后的建设性加叫或10–12邀请；保留原阻击套长和此前独立点力，八张配合依实际支持与此公开长度判断`;
      return result;
    }
    result.description = `${result.roleLabel}${target.level}${suit}：本手公开${result.suitMinimum ?? '未细分'}张以上支持，搭档公开${promised || '未定义'}张；${result.invitation ? `${rangeText}邀请` : target.level >= gameLevel(suit) ? `${strongOpenerGameSupport ? `${rangeText}强跳支持；` : ''}选择${contract}并可止叫，保留此前实力` : result.intent === 'answer' ? '最低合法支持回答，履行一轮义务、不额外承诺邀请' : rangeText ? `${rangeText}，不逼叫${(result.supportRange?.max ?? result.hcpRange?.max) === 40 ? '；最低合法竞争支持，不额外承诺邀请' : ''}` : competition ? '竞争性、不凭阶数当邀请或逼局' : '自然限制性支持，不额外承诺邀请'}；配合不足八张时不虚加短门点${after.forcing === 'game' ? '；既有进局逼叫继续' : ''}`;
    return result;
  }
  if (ownPrior.some(prior => prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system))) {
    set('natural-repeat', '自然回套'); result.intent = forcedBefore.mustBid ? 'answer' : 'descriptive';
    result.priorSuitMinimum = naturalSuitMinimum(before, entry.seat, suit, system);
    const priorPartnerSupportCue = side.findLast(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
      && publicCallMeaningAt(before, prior.index, system).supportRange?.trump === suit
      && publicCallMeaningAt(before, prior.index, system).role === 'cue');
    if (!major(suit) && target.level === 4 && jumped && priorPartnerSupportCue
      && after.forcing !== 'game'
      && (!forcedBefore.mustBid || ['overcall-cue', 'competitive-cue'].includes(forcedBefore.convention))) {
      const partnerMinimum = publicPlayerConstraints(before, partnerOf(entry.seat), system).suitMinimums[suit];
      length(suit, Math.max(result.priorSuitMinimum, 8 - partnerMinimum));
      result.supportRange = { trump: suit, min: 16, max: 40 };
      result.forcing = 'none'; result.invitation = true; result.intent = 'invitation';
      result.description = `同伴已通过支持扣叫确认八张${suit}配合后的自主4${suit}跳再叫：16+调整支持点，保留此前独立HCP与本手${result.suitMinimum}+张原套；较低三阶原套仍合法，因此这是额外实力自然邀请、NF，不是最低被迫回套；未到双方公开29支持点时不自动升五阶`;
      return result;
    }
    const previous = all.at(-2);
    const priorStopCue = ownPrior.find(prior => {
      const meaning = publicCallMeaningAt(before, prior.index, system);
      return meaning.role === 'cue' && !meaning.supportRange;
    }) ?? (partner && publicCallMeaningAt(before, partner.index, system).role === 'cue'
      && !publicCallMeaningAt(before, partner.index, system).supportRange ? partner : undefined);
    if (!major(suit) && target.level === 4 && jumped && priorStopCue
      && (!forcedBefore.mustBid || ['overcall-cue', 'competitive-cue'].includes(forcedBefore.convention))
      && after.forcing !== 'game' && entry.seat !== ourOpening?.seat) {
      set('minor-slam-try', '止张扣叫后的原自然低花强跳描述');
      length(suit, 6); hcp(16); result.forcing = 'none'; result.intent = 'invitation'; result.invitation = true;
      result.description = `原自然低花及敌套止张扣叫背景下的自主4${suit}跳回原套：16+ HCP、自己的6+张原自然低花、额外实力邀请，不逼叫；更低三阶原套仍合法，不是最低被迫回答；保留原扣叫强度与长度，不把未知同伴低花支持当已确认八配、不加虚构短门支持点，也不把一轮扣叫自动延续为进局逼叫`;
      return result;
    }
    const competition = all.some(prior => prior.index > ownPrior[0].index && prior.index < index
      && sideOf(prior.seat) !== sideOf(entry.seat) && !isArtificialBidAt(prefix, prior.index, system));
    if (!major(suit) && target.level === 4 && !forcedBefore.mustBid && after.forcing !== 'game'
      && !ownPrior.some(prior => publicCallMeaningAt(before, prior.index, system).roleLabel === '首次阻击争叫')
      && !(ourOpening?.index === opening?.index && ourOpening.call.level >= 2)
      && naturalSuitMinimum(before, partnerOf(entry.seat), suit, system)
        + naturalSuitMinimum(before, entry.seat, suit, system) < 8) {
      const latestEnemy = all.findLast(prior => prior.index < index && sideOf(prior.seat) !== sideOf(entry.seat));
      const originalSeven = ourOpening?.index === opening?.index && ourOpening.call.level === 1
        && ourOpening.call.strain === suit && !jumped
        && latestEnemy?.call.level === 3 && latestEnemy.call.strain !== suit;
      hcp(originalSeven ? 12 : 16); length(suit, 6); result.forcing = 'none'; result.intent = 'competitive';
      if (originalSeven) result.playingSourceCompensation = { normalHcpMinimum: 16, minHcp: 12, suit,
        minLength: 7, minKingOrAce: 0, minQueenOrHigher: 2, minTenOrHigher: 3,
        normalMinKingOrAce: 0, normalMinQueenOrHigher: 0, normalMinTenOrHigher: 0 };
      result.description = `尚无公开八张配合的自主4${suit}原套竞争：16+ HCP及自己的6+张真实长套${originalSeven ? '；或原一阶低花开叫人面对敌三阶新套、已无三阶原套合法空间时，12+ HCP及自己的七张以上原低花、至少两张Q以上及三张T以上荣誉的有界赢墩来源。公开保守12点／六张，两个分支须按实牌同时核查，不向普通六张12点手放宽' : ''}，NF；不允许普通五张弱套仅凭通用四张回套说明升四阶，不借伙伴未公开支持加短门；已有GF、最低被迫回答、阻击和真实配合的合同另行处理`;
      return result;
    }
    const genuineOne = ourOpening?.index === opening?.index && ourOpening.call.level === 1;
    const partnerRaised = side.some(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
      && (prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system)
        || publicCallMeaningAt(before, prior.index, system).role === 'cue'
          && (publicCallMeaningAt(before, prior.index, system).suitMinimums[suit] ?? 0) >= 3));
    if (genuineOne && entry.seat === ourOpening.seat && ownPrior.length === 1 && major(suit)
      && target.level === 4 && jumped && !competition && after.forcing !== 'game' && !partnerRaised) {
      length(suit, 6); result.intent = 'signoff';
      const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      if (partnerMinimum + 6 >= 8) result.supportRange = { trump: suit, min: 19, max: 21 }; else hcp(19, 21);
      result.description = `开叫人自然4${suit}强力再叫：本次为原高花强跳再叫，6+张原高花、19–21${result.supportRange ? '调整支持点，公开已确认八张配合' : ' HCP，尚未确认八张配合不虚加短门'}；选择成局、可止叫，保留原开叫点力与长度，不混同16–18三阶邀请或最低回套`;
      return result;
    }
    if (genuineOne && side.length === 4 && major(suit) && target.level === 4
      && entry.seat !== ourOpening.seat && response?.call.level === 1 && response.call.strain === suit
      && side[2].call.strain === ourOpening.call.strain && side[2].call.level === 2
      && !partnerRaised && after.forcing !== 'game') {
      hcp(13); length(suit, 6); result.intent = 'signoff';
      result.description = `应叫人以自己的长套直接成局4${suit}：13+ HCP、6+张高花，尚未得到开叫人公开支持；这是独立长套选择成局，可止叫，不把原低花再叫虚当高花配合，也不推广到已有强无将背景的配合成局`;
      return result;
    }
    if (partnerRaised && target.level >= gameLevel(suit)) {
      const promised = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      length(suit, Math.max(result.suitMinimum ?? 0, 8 - promised));
      result.intent = 'signoff';
      const contract = target.level === 7 ? '大满贯' : target.level === 6 ? '小满贯' : '成局';
      result.description = `已有搭档支持后的自然${target.level}${suit}${contract}：搭档公开${promised}+张，本手保留此前长度且至少${result.suitMinimum}+张，确认八张配合；不把${contract}跳叫自动加为六张，不另造原先没有的HCP门槛；${major(suit) && target.level === 5 ? '五阶竞争还须另有十一墩赢墩来源或明确牺牲依据，不仅凭四阶局的25支持点继续；' : ''}${after.forcing === 'game' ? '原有进局逼叫仍继续' : '到局可以止叫'}`;
      return result;
    }
    const firstOwnNatural = ownPrior.find(prior => !isArtificialBidAt(prefix, prior.index, system));
    const alreadySupporting = firstOwnNatural?.call.strain === suit && side.some(prior => prior.index < firstOwnNatural.index
      && prior.seat === partnerOf(entry.seat) && prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system));
    if (alreadySupporting && competition) {
      set('competitive-support', '已示支持的自然竞争续叫'); result.intent = target.level >= gameLevel(suit) ? 'signoff' : 'competitive';
      const promised = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      result.description = `已示支持后的自然${target.level}${suit}：本手保留${result.suitMinimum}+张支持，同伴公开${promised}+张；竞争性、不额外承诺邀请，不撤销原支持承诺${after.forcing === 'game' ? '；原有进局逼叫仍继续' : '；自然不逼叫，搭档可Pass'}`;
      return result;
    }
    const overcallerInvitation = ourOpening?.index !== opening?.index && entry.seat === ourOpening?.seat && major(suit);
    const latestTrumpSupport = side.findLast(prior => prior.index < index && prior.seat === partnerOf(entry.seat)
      && prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system));
    const oppositionAfterSupport = latestTrumpSupport && all.some(prior => prior.index > latestTrumpSupport.index
      && prior.index < index && sideOf(prior.seat) !== sideOf(entry.seat));
    if ((genuineOne || overcallerInvitation) && partnerRaised && !oppositionAfterSupport && after.forcing !== 'game'
      && !forcedBefore.mustBid && target.level === 3) {
      const opener = entry.seat === ourOpening.seat;
      const partnerMinimum = naturalSuitMinimum(before, partnerOf(entry.seat), suit, system);
      if (!opener && major(suit)) length(suit, Math.max(result.priorSuitMinimum, 8 - partnerMinimum));
      const firstMinorInvitation = opener&&!major(suit)&&!ownPrior.some(prior=>publicCallMeaningAt(before,prior.index,system).invitation);
      if ((result.suitMinimum ?? 0) + partnerMinimum >= 8)
        result.supportRange = { trump: suit, min: opener ? 16 : 10, max: firstMinorInvitation?40:opener ? 18 : 12 };
      else hcp(opener ? 16 : 10, firstMinorInvitation ? 40 : opener ? 18 : 12);
      result.invitation = true; result.intent = 'invitation';
      const invitationRange = result.supportRange ?? result.hcpRange!;
      result.description = `${result.supportRange ? '已确认八张配合中的' : '尚未确认八张配合的'}自然${target.level}${suit}邀请：${invitationRange.min}${invitationRange.max===40?'+':`–${invitationRange.max}`}${result.supportRange ? '支持点' : ' HCP，不虚加短门点'}，本手${result.suitMinimum}+张、同伴公开${partnerMinimum}+张，保留此前独立HCP；${firstMinorInvitation?'首个原低花较强自然邀请不设18上限，不因自己额外实力和伙伴低点可能而盲升五阶；':''}不逼叫，不把支持点当HCP，也不因重复支持额外增加长度`;
      return result;
    }
    if (genuineOne && after.forcing !== 'game'
      && (!forcedBefore.mustBid || ['natural-response', 'negative-double'].includes(forcedBefore.convention)) && previous
      && target.level === 3 && bidValue(target) - bidValue(previous.call) > 5) {
      const openerJump = entry.seat === ourOpening.seat && ownPrior.length === 1;
      const responderJump = entry.seat !== ourOpening.seat && ownPrior.length === 1 && ownPrior[0].call.level === 1;
      if (openerJump || responderJump) {
        const balancedNTFit = responderJump && major(suit) && response?.call.level === 1 && response.call.strain === suit
          && side.length === 4 && side[2].call.strain === 'NT' && side[2].call.level === 1
          && isBalancedNoTrumpAt(prefix, side[2].index, system)
          && noTrumpRangeAt(prefix, side[2].index, system)?.min === 12;
        if (balancedNTFit) {
          length(suit, 6); result.supportRange = { trump: suit, min: 10, max: 12 };
          result.invitation = true; result.intent = 'invitation';
          result.description = `一盖一高花应叫、开叫人明确均型1NT12–14后，应叫人3${suit}跳再叫：自己的6+张原高花与搭档至少两张确认八张配合，10–12支持点邀请、不逼叫；保留原应叫的HCP承诺，不新添10 HCP门槛，不是替搭档套加叫，也不推广到未确认配合的独立长套邀请`;
          return result;
        }
        hcp(openerJump ? 16 : 10, openerJump ? major(suit) ? 20 : 18 : 12); length(suit, 6); result.invitation = true; result.intent = 'invitation';
        const semiBackground = openerJump && response?.call.level === 1 && response.call.strain === 'NT' && major(suit);
        result.description = `自然原${major(suit) ? '高' : '低'}花3${suit}跳再叫：${result.hcpRange!.min}–${result.hcpRange!.max} HCP、6+张，${semiBackground ? '半逼叫背景中真实六张原套应继续描述；本次为邀请，不新建逼叫' : '邀请成局而非最低回套'}；同伴按公开实力和实际支持决定接受或Pass`;
        return result;
      }
    }
    const semiBackground = genuineOne && major(suit) && entry.seat === ourOpening.seat && ownPrior.length === 1
      && response?.call.level === 1 && response.call.strain === 'NT';
    const originalAfterSecondNegative = ourOpening?.index === opening?.index && ourOpening.call.level === 2
      && ourOpening.call.strain === 'C' && entry.seat === ourOpening.seat && side.length === 5
      && response?.call.strain === 'D' && side[2].call.strain === suit && after.forcing === 'none'
      && (side[3].call.level === 3 && side[3].call.strain === 'C' && major(side[2].call.strain)
        || side[3].call.level === 3 && side[3].call.strain === 'D' && side[2].call.strain === 'C'
        || side[3].call.level === 3 && side[3].call.strain === 'NT' && side[2].call.strain === 'D');
    const lengthDescription = (result.suitMinimum ?? 0) > result.priorSuitMinimum
      ? `此前公开${result.priorSuitMinimum}+张，本次进一步显示${result.suitMinimum}+张`
      : `保留此前公开${result.priorSuitMinimum}张承诺，最低回套不自动增加长度`;
    const transferSupport = side.some(prior => {
      const question = prior.index < index && publicNoTrumpQuestionAt(before, prior.index, system);
      return question && question.kind === 'transfer' && question.target === suit && question.platform.seat === entry.seat;
    });
    result.description = `自然再叫${target.level}${suit}：${lengthDescription}${(result.suitMinimum ?? 0) < 6 ? '，不额外保证六张' : ''}；${target.level >= gameLevel(suit) && !partnerRaised ? `${transferSupport ? '支持同伴公开五张高花' : '自己的长套'}选择${target.level === 7 ? '大满贯' : target.level === 6 ? '小满贯' : '成局'}；` : ''}${forcedBefore.mustBid ? '履行本轮应叫义务' : semiBackground ? '半逼叫背景中真实六张原套应继续自然描述，最低回套不表示邀请' : '此前没有继续叫牌义务，此次主动描述，未从回套推导额外实力'}${after.forcing === 'game' ? '，原有进局逼叫仍继续' : originalAfterSecondNegative ? '，二次负应后的最低原套回答允许同伴Pass' : '，不自动新建逼叫'}`;
    return result;
  }
  const ownNegative = before.findLastIndex((prior, at) => prior.seat === entry.seat && isNegativeDoubleAt(before, at));
  if (negativeDoubleMinorContinuationAt(prefix, index, system)) {
    const passed = passedBefore(prefix, entry.seat, opening.index);
    set(passed ? 'passed-second-suit' : 'responder-second-suit', '负加倍已获自然回答后的最低新低花');
    hcp(6, passed ? 12 : 40); length(suit, 5); result.intent = 'descriptive'; result.forcing = 'none';
    result.description = `原负加倍已得到同伴合法自然回答后的最低2${suit}新低花：自己的5+张真实${suit}、${result.hcpRange!.min}${passed ? '–12' : '+'} HCP，保留原负X更高下界及过手上界；自然不逼叫，不额外建立进局逼叫，不承诺同伴低花支持或公开八张配合；未获回答或仍有独立逼叫义务时不套此退路`;
    return result;
  }
  if (ownNegative >= 0 && ownPrior.length === 0 && target.level === 3 && major(suit)
    && !side.some(prior => prior.index < index && prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system))) {
    const passed = passedBefore(prefix, entry.seat, opening.index);
    set('responder-second-suit', '负加倍后首次自然高花续叫'); hcp(10, passed ? 12 : 40); length(suit, 5);
    result.intent = 'descriptive';
    result.description = `负加倍后的自然3${suit}续叫：本次进一步显示5+张、${result.hcpRange!.min}${passed ? '–12' : '+'} HCP，保留原负X公开四张；${passed ? '过手自然不逼叫' : after.forcing === 'one-round' ? '自然逼叫一轮，不另立进局逼叫' : '自然不逼叫，保留已示长度和点力'}；伙伴三张支持现可确认八配，不把原四张询问长度与本次五张承诺混同`;
    return result;
  }
    if (ownNegative >= 0 && ownPrior.length === 0 && target.level === 3 && !major(suit)
    && !side.some(prior => prior.index < index && prior.call.strain === suit && !isArtificialBidAt(prefix, prior.index, system))) {
    const passed = passedBefore(prefix, entry.seat, opening.index);
    set('responder-second-suit', '负加倍后首次自然低花续叫'); hcp(10, passed ? 12 : 40); length(suit, 5);
    result.intent = 'descriptive';
    result.description = `负加倍后的自然3${suit}新低花：10${passed ? '–12' : '+'} HCP、5+张，不把原负加倍所示高花当成已经定将；${passed ? '过手不逼叫' : after.forcing === 'one-round' ? '逼叫一轮，搭档须自然回答；敌方再介入后可解除本轮义务' : '本轮没有持续叫牌义务'}，先前已示高花长度和此次新套/点力承诺均保留，敌方后续竞争不撤销这些公开信息`;
    return result;
  }
  if (after.forcing === 'game' && forcedBefore.forcing === 'game' && (ownPrior.length > 0
    || before.some(prior => prior.seat === entry.seat && prior.call.kind === 'double'))
    && entry.seat !== ourOpening?.seat && target.level >= 4 && !major(suit)) {
    set('responder-second-suit', '既有进局逼叫中的高位自然新低花');
    length(suit, 5); hcp(0); result.intent = 'answer';
    result.description = `既有进局逼叫中的最低自然${target.level}${suit}新低花：自己的5+张真实花色，保留此前${result.hcpRange!.min}+ HCP；保留此前已建立的进局逼叫，不从高位回答制造六张或新的10／13 HCP下限，到自然成局前仍须继续`;
    return result;
  }
  if (ourOpening?.index === opening?.index && ourOpening.call.level === 1 && ourOpening.call.strain !== 'NT'
    && entry.seat !== ourOpening.seat && ownPrior.some(prior => prior.call.level === 1 && prior.call.strain !== 'NT')) {
    const passed = passedBefore(prefix, entry.seat, opening.index);
    set(passed ? 'passed-second-suit' : 'responder-second-suit', passed ? '过手自然第二套' : '应叫人自然第二套');
    hcp(target.level >= 3 ? 10 : 6, passed ? 12 : 40); length(suit, target.level >= 3 ? 5 : 4);
    result.description = `${result.roleLabel}${target.level}${suit}：${result.hcpRange!.min}${passed ? '–12' : '+'} HCP、${result.suitMinimum}+张；${passed ? '不逼叫，但搭档仍应比较适合的配合' : '逼叫一轮，不凭此叫品认定进局逼叫'}`;
    return result;
  }
  if (after.forcing === 'game' && ownPrior.length > 0 && target.level === 3 && entry.seat !== ourOpening?.seat) {
    if (ourOpening?.index === opening?.index && ourOpening.call.level === 2 && ourOpening.call.strain === 'C'
      && response?.call.level === 2 && response.call.strain === 'D' && side.length === 4) {
      set('natural-response', '强2C等待后的自然正应'); length(suit, 5); hcp(4); result.intent = 'descriptive';
      result.description = `强2C–2D等待、开叫人自然再叫后的${target.level}${suit}自然正应：4+ HCP、5+张真实花色；本次正应确立进局逼叫，不混同0–3点人工二次负应，不把人工等待的方块当自己的套长`;
      return result;
    }
    set('responder-second-suit', '既有进局逼叫中的自然新套'); length(suit, 4); hcp(0);
    result.intent = 'descriptive';
    result.description = `既有进局逼叫中的自然3${suit}新套：4+张真实花色，保留此前${result.hcpRange!.min}+ HCP与所有已示长度；原有进局逼叫继续，不把真实第二低花误报成原套六张或另造16+跳邀请`;
    return result;
  }
  if (ourOpening?.index === opening?.index && entry.seat === ourOpening.seat) {
    set('natural-second-suit', '开叫人自然第二套');
    const reverse = after.convention === 'reverse', strongJump = after.convention === 'opener-jump-shift';
    if (reverse || strongJump) hcp(strongJump ? 19 : 17, 21);
    if ((strongJump || reverse) && ourOpening.call.strain !== 'NT')
      length(ourOpening.call.strain as Suit, Math.max(4, naturalSuitMinimum(prefix, entry.seat, ourOpening.call.strain as Suit, system)));
    const partnerNegative = before.findIndex((prior, priorIndex) => prior.seat === partnerOf(entry.seat) && isNegativeDoubleAt(before, priorIndex));
    if (partnerNegative >= 0 && ownPrior.length === 1 && major(suit) && target.level === 4 && jumped
      && publicNegativeDoubleMajorsAt(before, partnerNegative).includes(suit)) {
      set('natural-support', '负加倍后的高花成局答叫'); length(suit, 4); hcp(0, 21);
      result.supportRange = { trump: suit, min: Math.max(0, 25 - publicSupportMinimum(suit, 4,
        publicPlayerConstraints(before, partnerOf(entry.seat), system))), max: 40 };
      result.forcing = 'none'; result.intent = 'signoff';
      result.description = `负加倍后的4${suit}高花成局答叫：4+张支持同伴在原负X时公开四张，确认八配；${result.supportRange.min}+调整支持点与伙伴公开最低值达到25，保留原开叫12–21 HCP，不套19–21无干扰强跳支持；自然成局可止叫`;
      return result;
    }
    if (partnerNegative >= 0 && ownPrior.length === 1 && major(suit) && target.level === 3 && jumped) {
      set('natural-support', '负加倍后的强跳高花支持'); length(suit, 4);
      result.supportRange = { trump: suit, min: 16, max: 18 }; result.invitation = true; result.intent = 'invitation';
      result.description = `负加倍后的3${suit}强跳支持：16–18调整支持点、4+张同伴询问高花；邀请成局，不要求原始HCP达到16，也不是六张原套`;
    }
    if (!result.description) {
      const strongClub = ourOpening.call.level === 2 && ourOpening.call.strain === 'C';
      hcp(reverse ? 17 : strongJump ? 19 : 0, strongClub ? 40 : 21);
      const originalLength = !strongClub && ourOpening.call.strain !== 'NT'
        ? Math.max(reverse || strongJump ? 4 : 0, naturalSuitMinimum(prefix, entry.seat, ourOpening.call.strain as Suit, system)) : undefined;
      const originalDescription = originalLength === undefined ? '' : major(ourOpening.call.strain)
        ? `，保留${originalLength}+张开叫高花` : `，保留原低花${originalLength}+张`;
      const rawDescription = reverse || strongJump ? `${result.hcpRange!.min}+ HCP（本档${result.hcpRange!.min}–${result.hcpRange!.max}）`
        : `${result.hcpRange!.min}${result.hcpRange!.max < 40 ? `–${result.hcpRange!.max}` : '+'} HCP`;
      result.description = `开叫人自然${target.level}${suit}新套：${result.suitMinimum}+张第二套${originalDescription}，保留${rawDescription}；${strongClub && !major(suit) ? '低花通常五张，强4-4-4-1允许自然四张低花；' : reverse || strongJump ? '强4-4-4-1手牌可两套等长；' : ''}${strongJump ? '强跳移叫建立进局逼叫' : reverse ? '17+逆叫逼叫一轮' : after.forcing === 'game' ? '原有进局逼叫仍继续' : after.forcing === 'one-round' ? '履行当前义务，按前缀一轮逼叫处理' : '自然描述，不额外承诺邀请或持续逼局'}`;
    }
    return result;
  }
  if (ourOpening?.index === opening?.index && ourOpening.call.level === 2 && ourOpening.call.strain === 'C'
    && entry.seat !== ourOpening.seat && target.level >= 2) {
    set('natural-response', '强2C后的自然正应'); hcp(4); length(suit, 5);
    result.forcing = 'game'; result.description = `强2C后的自然${target.level}${suit}正应：4+ HCP、5+张自己的套，建立进局逼叫，不与人工2D等待或0–3点弱负应Pass混同`;
    const rebid = side[2];
    if (response?.call.level === 2 && response.call.strain === 'D' && rebid?.call.strain === 'C')
      result.description += '；若本手0–3 HCP，本轮固定负应叫为3♦，4D不作为二次负应';
    return result;
  }
  if (ownPrior.length === 0 && ourOpening?.seat === entry.seat && ourOpening.index !== opening?.index) {
    const previous = all.at(-2);
    const jump = previous && bidValue(target) - bidValue(previous.call) > 5;
    set('natural-overcall', jump ? '首次阻击争叫' : '首次自然争叫');
    const balancing = opening && index === opening.index + 3 && before.slice(opening.index + 1).every(prior => prior.call.kind === 'pass');
    hcp(jump ? 5 : target.level === 1 ? balancing ? 6 : 8 : 10, jump ? target.level === 2 ? 11 : 10 : 16); length(suit, jump ? target.level + 4 : 5);
    if (!jump && target.level === 1 && balancing)
      result.description = `平衡位首次一阶自然${target.level}${suit}争叫：6–16 HCP、5+张可用套；此前敌方开叫后连续两次Pass，允许点力低于直接位8+门槛，不把平衡位减点推广到直接争叫，也不额外保证六张或同伴配合，自然不逼叫`;
    if (jump && target.level === 3) result.description = `首次自然三阶弱跳争叫3${suit}：5–10 HCP、7+张本套且至少一张Q以上大牌，Q987542属于允许的七张最低套质；不以同伴私牌补荣誉。二阶六张弱跳仍须至少两张T以上且含一张Q以上；这是阻击而不是自然强新套，NF`;
    if (!jump && !major(suit) && target.level === 4 && !forcedBefore.mustBid && after.forcing !== 'game') {
      hcp(16); length(suit, 6);
      result.description = `敌方自然叫牌后的首次非跳4${suit}争叫：16+ HCP、自己的6+张真实低花，自主自然NF；不把普通10点五张二阶争叫标准无界扩到四阶，不包括八张弱跳阻击或被迫最低回答`;
      return result;
    }
    if (!jump && target.level === 2 && opening?.call.strain === 'NT') {
      result.playingSourceCompensation = { normalHcpMinimum: 10, minHcp: 8, suit, minLength: 6,
        minKingOrAce: 1, minQueenOrHigher: 0, minTenOrHigher: 3,
        normalMinKingOrAce: 1, normalMinQueenOrHigher: 2, normalMinTenOrHigher: 3,
        extraLongAlternative: { minHcp: 12, minLength: 8, minKingOrAce: 1, minQueenOrHigher: 2, minTenOrHigher: 2 } };
      hcp(8, 16);
      result.description = `敌方自然NT开叫后的首次2阶自然争叫2${suit}：10–16 HCP、5+张且有A/K、至少两张Q以上及三张T以上荣誉的强套，或8–16 HCP、自己的6+张优质长套且有A/K及三张T以上荣誉；另允许12–16 HCP、自己的8+张长套有A/K且至少两张Q以上荣誉，以长度补偿只有两张T以上荣誉。各分支可重叠，普通五张和六张套的质量门槛不放宽；自然不逼叫，公共保守8 HCP／五张，实牌须核查相应分支`;
    }
    if(!jump&&target.level===3&&!major(suit)&&opening&&opening.call.level>=2&&opening.call.strain!=='NT') {
      result.playingSourceCompensation={normalHcpMinimum:10,minHcp:7,suit,minLength:8,minKingOrAce:1,minQueenOrHigher:0,minTenOrHigher:3};
      hcp(7,16);
      result.description=`对自然阻击开叫的最低3${suit}争叫：通常10–16 HCP、5+张自然套；本配置仅允许7–9 HCP且真实8+张本套、至少一张A/K及三张T以上荣誉的长套赢墩来源补偿，须有真实大牌控制；低点例外不推广到普通五张，也不因有补偿路线向所有同叫品公布八张套。公开保守下界7 HCP及五张，机器人以实牌同时核查低点与长套荣誉条件`;
    }
    return result;
  }
  if (response?.index === index && ourOpening?.index === opening?.index) {
    set('natural-response', '自然应叫');
    const passed = passedBefore(prefix, entry.seat, opening.index);
    const preemptResponse = ourOpening.call.level >= 2 && ourOpening.call.strain !== 'NT';
    const competitiveResponse = ourOpening.call.level === 1 && target.level >= 2
      && intervened(prefix, entry.seat, ourOpening.index, index);
    const ntCompetitiveResponse = ourOpening.call.strain === 'NT' && competitiveResponse;
    if (ntCompetitiveResponse && target.level === 2 && major(suit)) {
      set('nt-competitive-weak-response', '无将遭插叫后的自然弱高花应叫');
      hcp(5, 12); length(suit, 5); result.forcing = 'none'; result.intent = 'competitive';
      result.description = `自然1NT遭敌方花色插叫后的2${suit}：5–12 HCP、5+张${suit}；自然不逼叫；这是有干扰的弱长套应叫，不是高花转移，不把五张套最低竞争回复套作10+或进局逼叫；先前NT点力及止张仍保留`;
      return result;
    }
    if (ntCompetitiveResponse && target.level === 3 && !major(suit) && !jumped) {
      set('nt-competitive-minor-escape', '无将遭插叫后的弱长低花逃叫');
      hcp(5, 9); length(suit, 6); result.forcing = 'none'; result.intent = 'signoff';
      result.description = `自然1NT遭花色插叫、二阶低花已无合法空间时的最低3${suit}：5–9 HCP、6+张真实低花，自然弱逃叫、不逼叫；这是本配置明示的弱长低花退路，不承诺所缺旁门止张，不使用人工2NT Lebensohl接力；同伴无真实配合可Pass`;
      return result;
    }
    const highSpaceGameIntent = competitiveResponse && target.level === 4 && major(ourOpening.call.strain)
      && target.strain !== ourOpening.call.strain
      && bidValue(target) < bidValue({ kind: 'bid', level: 4, strain: ourOpening.call.strain });
    if (highSpaceGameIntent && passed) {
      result.defined = false; result.role = 'unknown'; result.roleLabel = '过手高位新套未定义';
      result.description = `已Pass手牌的自然${target.level}${suit}候选：保留真实5+张自然套及此前公开限制；本卡未定义此过手高位路线，不采用未Pass手牌的13+ HCP成局意图／逼叫一轮约定，不制造13–12点矛盾区间；${after.forcing === 'game' ? '此前已有进局逼叫仍继续' : '不由此新增逼叫义务'}，机器人不使用此路线`;
      length(suit, 5); return result;
    }
    hcp(system === 'precision' && ourOpening.call.level === 1 && ourOpening.call.strain === 'C' ? 8
      : preemptResponse ? ourOpening.call.level === 2 ? 13 : 15
      : competitiveResponse ? highSpaceGameIntent ? 13 : 10
      : system === 'precision' && ourOpening.call.level === 1 && ourOpening.call.strain === 'C' ? 8
        : after.forcing === 'game' && target.level === 2 ? 13 : passed && target.level === 2 ? 10 : 6, passed && !preemptResponse ? 12 : 40);
    if (passed && !competitiveResponse && !preemptResponse && target.level === 2)
      length(suit, suit === 'C' ? 5 : suit === 'D' ? 4 : 5);
    if (preemptResponse || competitiveResponse) length(suit, 5);
    result.intent = 'descriptive';
    const doubledOpening = prefix[ourOpening.index + 1]?.call.kind === 'double';
    result.description = `${doubledOpening ? '本方一阶开叫遭敌方技术性加倍后的' : ''}自然${target.level}${suit}应叫：${result.hcpRange!.min}${passed && !preemptResponse ? '–12' : '+'} HCP、${result.suitMinimum ?? '此前已示'}+张${suit}；${highSpaceGameIntent ? '原高花最低合法回答已是四阶成局，显示成局意图但仍只逼叫一轮；没有真实配合时不强制停在四阶高花，不把此强度推广到三阶10+新套' : after.forcing === 'game' ? ntCompetitiveResponse ? '自然NT开叫被双套或花色争叫后的自然进局逼叫，到局前不得Pass' : '未Pass且无干扰的二盖一建立进局逼叫，到局前不得Pass' : after.forcing === 'one-round' ? '逼叫一轮，搭档须作合法自然回答' : '自然不逼叫，但真实配合和公开实力仍可用于进局判断'}，不将点力转换成未确认配合的支持点`;
    if (system === 'sayc' && preemptResponse && ourOpening.call.level === 3
      && major(ourOpening.call.strain) && !major(suit) && target.level === 4 && !jumped
      && !intervened(prefix, entry.seat, ourOpening.index, index)) {
      result.playingSourceCompensation = { normalHcpMinimum: 15, minHcp: 13, suit, minLength: 6,
        minKingOrAce: 0, minQueenOrHigher: 0, minTenOrHigher: 0,
        maxOtherSuitLength: { suit: ourOpening.call.strain as Suit, max: 1 } };
      hcp(13); length(suit, 5);
      result.description = `同伴三阶高花阻击后首次最低4${suit}自然新低花：通常15+ HCP、5+张；另允许13+ HCP且自己的6+张${suit}、原高花至多一张的有界长套补偿，两个分支均由实牌核查。公共保守13 HCP及五张，不向普通15点五张手虚报六张或原高花单缺；两分支统一逼叫一轮，合法自然回答后可解除，不因私牌不同改变公开逼叫状态，不宣称同伴支持或29支持点低花成局`;
    }
    if(competitiveResponse&&!ntCompetitiveResponse&&target.level===2&&major(suit)&&!highSpaceGameIntent
      &&!(system==='precision'&&ourOpening.call.strain==='C')) {
      result.playingSourceCompensation={normalHcpMinimum:10,minHcp:9,suit,minLength:8,minKingOrAce:1,minQueenOrHigher:2,minTenOrHigher:3};
      hcp(9,passed?12:40);
      result.description=`竞争中自然2${suit}应叫：通常10+ HCP、5+张；只允许9 HCP且自己的8+张${suit}有至少两张Q以上及三张T以上荣誉（并有A/K控制）作为有界长套补偿；公开保守最低9 HCP及五张，不向普通10+五张手虚报八张。${after.forcing==='one-round'?'逼叫一轮，合法自然回答后解除':after.forcing==='game'?'既有进局逼叫继续':'自然不逼叫'}，此前HCP上界与已示长度保留，机器人须同时核查实际点力、长度与荣誉条件`;
    }
    return result;
  }
  if (ownPrior.length === 0 && ourOpening?.index !== opening?.index && ourOpening?.seat === partnerOf(entry.seat)
    && ourOpening.call.strain !== 'NT' && !isArtificialBidAt(prefix, ourOpening.index, system)) {
    set('natural-response', '自然争叫后的新套应叫'); hcp(target.level === 1 ? 6 : 8); length(suit, target.level === 1 ? 4 : 5);
    result.intent = 'competitive'; result.forcing = 'none';
    if (publicThreeLevelOvercallAdvanceAt(prefix, index, system)) {
      hcp(13); result.forcing = 'one-round'; result.intent = 'descriptive';
      result.roleLabel = '三阶自然争叫后的强新高花应叫';
      result.description = `同伴首次自然三阶争叫后，首次更高的同阶3${suit}新高花：13+ HCP、5+张真实${suit}，逼叫一轮，同伴须作合法自然回答；不承诺同伴支持或公开八张配合，不将未确认配合的短门换作原始点力。此合同只适用于自然三阶争叫，不推广到二阶争叫后的最低三阶新套、Michaels选择、技术加倍后的被迫回答或原争叫人第二套`;
      return result;
    }
    result.description = `同伴自然争叫后的${target.level}${suit}新套：${result.hcpRange!.min}+ HCP、${result.suitMinimum}+张自然花色；自然不逼叫，不把新套当作已确认将牌配合；保留自身公开点力与长度供后续判断`;
    if (target.level === 2 && major(suit) && !jumped) {
      result.playingSourceCompensation = { normalHcpMinimum: 8, minHcp: 7, suit, minLength: 8,
        minKingOrAce: 1, minQueenOrHigher: 2, minTenOrHigher: 3 };
      hcp(7);
      result.description = `同伴自然争叫后的最低2${suit}新套答叫：通常8+ HCP、5+张自然高花；本配置仅允许7 HCP且自己8+张本套、有A/K控制、至少两张Q以上和三张T以上荣誉的有限赢墩来源补偿；不逼叫、不保证同伴支持，公共保守7 HCP及五张，普通八点五套不会被虚报八张，低点分支须同时核实长度与套质`;
    }
    return result;
  }
  if (ourOpening?.index !== opening?.index && ownPrior.some(prior => prior.call.strain !== 'NT'
    && !isArtificialBidAt(before, prior.index, system)) && target.level < gameLevel(suit)) {
    set('natural-second-suit', '自然争叫者后续真实第二或第三套');
    length(suit, 4); hcp(0); result.intent = forcedBefore.mustBid ? 'answer' : 'descriptive';
    result.forcing = forcedBefore.forcing === 'game' ? 'game' : 'none';
    result.description = `${ownTakeout >= 0 ? '技术X方已经自然回答后的' : '原自然争叫方的'}${target.level}${suit}后续新套：真实4+张，保留此前${result.hcpRange!.min}${result.hcpRange!.max < 40 ? `–${result.hcpRange!.max}` : '+'} HCP与原自然套长度；${result.forcing === 'game' ? '此前进局逼叫继续' : '自然不逼叫，先前支持／止张扣叫的一轮描述义务已履行'}；不再套首次五张争叫、17+技术X强再叫或六张跳原套，伙伴继续比较公开的两套配合`;
    return result;
  }
  if (ownPrior.some(prior => prior.call.strain !== 'NT' && !isArtificialBidAt(before, prior.index, system))
    && ourOpening?.index !== opening?.index && ownTakeout < 0 && partnerTakeout < 0
    && !result.artificial && !jumped) {
    set('natural-second-suit', '自然争叫后的新套续叫'); length(suit, 4); hcp(0);
    result.intent = 'descriptive';
    result.description = `自然争叫后的${target.level}${suit}新套续叫：4+张真实花色，保留自己此前${result.hcpRange!.min}+ HCP及已示长套；${after.forcing === 'game' ? '已有进局逼叫继续' : '自然不逼叫，不凭第三套或竞争高度制造16+跳邀请'}，不把未确认的配合当作八张`; return result;
  }
  return result;
}

export function publicPlayerConstraints(auction: AuctionEntry[], seat: Seat, system: BiddingSystem = 'sayc'): PublicPlayerConstraints {
  const key = publicPrefixKey(auction, auction.length - 1, system, seat), cached = publicConstraintCache.get(key);
  if (cached) return structuredClone(cached);
  const result = computePublicPlayerConstraints(auction, seat, system);
  rememberPublic(publicConstraintCache, key, result, constraintCacheLimit);
  return result;
}

function computePublicPlayerConstraints(auction: AuctionEntry[], seat: Seat, system: BiddingSystem): PublicPlayerConstraints {
  const result: PublicPlayerConstraints = { supportRanges: {}, suitMinimums: { C: 0, D: 0, H: 0, S: 0 },
    stopperSources: [], lengthSources: [], pointSources: [] };
  const merge = (previous: PointRange | undefined, next: PointRange): PointRange => previous
    ? { min: Math.max(previous.min, next.min), max: Math.min(previous.max, next.max) } : { ...next };
  for (let index = 0; index < auction.length; index++) {
    if (auction[index].seat !== seat) continue;
    const meaning = publicCallMeaningAt(auction, index, system);
    if (!meaning.defined) continue;
    const call = auction[index].call;
    if (system === 'sayc' && meaning.role === 'natural-opening' && call.kind === 'bid'
      && call.level === 1 && call.strain !== 'NT') result.ruleOf20Opening = true;
    if (meaning.controlSuits) result.controlSuits = { ...result.controlSuits, ...meaning.controlSuits };
    if (meaning.strictBalancedShapeFamily) result.strictBalancedShapeFamily = [...meaning.strictBalancedShapeFamily];
    if (meaning.allowedShapeFamily) result.allowedShapeFamily = [...meaning.allowedShapeFamily];
    if (meaning.jointSupportFloor) {
      result.jointSupportSources ??= [];
      result.jointSupportSources.push({ index, ...meaning.jointSupportFloor });
    }
    if (meaning.hcpRange) {
      result.hcpRange = merge(result.hcpRange, meaning.hcpRange);
      result.pointSources.push({ index, type: 'hcp', range: { ...meaning.hcpRange },
        ...(meaning.playingSourceCompensation ? { playingSourceCompensation: { ...meaning.playingSourceCompensation } } : {}),
        ...(meaning.minorInvitationShape ? { minorInvitationShape: { ...meaning.minorInvitationShape } } : {}) });
    }
    if (meaning.supportRange) {
      const { trump, min, max } = meaning.supportRange;
      result.supportRanges[trump] = merge(result.supportRanges[trump], { min, max });
      const sourceTrumpMinimum = Math.max(result.suitMinimums[trump], meaning.suitMinimums[trump] ?? 0);
      const sourcePartnerTrumpMinimum = publicPlayerConstraints(auction.slice(0, index), partnerOf(seat), system).suitMinimums[trump];
      result.pointSources.push({ index, type: 'support', trump, range: { min, max }, sourceTrumpMinimum, sourcePartnerTrumpMinimum });
    }
    for (const suit of ['C', 'D', 'H', 'S'] as Suit[]) {
      const minimum = meaning.suitMinimums[suit];
      if (minimum) {
        result.suitMinimums[suit] = Math.max(result.suitMinimums[suit], minimum);
        result.lengthSources.push({ index, suit, minimum });
      }
      const maximum = meaning.suitMaximums?.[suit];
      if (maximum !== undefined) {
        result.suitMaximums ??= {};
        result.suitMaximums[suit] = Math.min(result.suitMaximums[suit] ?? 13, maximum);
      }
    }
    result.stopperSources.push(...meaning.stopperSources);
  }
  return result;
}

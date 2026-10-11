import { type AuctionEntry, type Seat, type Strain, type Suit, partnerOf, sideOf } from '../core/types';
import { bidValue } from '../core/auction';
import { type BiddingSystem } from './systems';

type Bid = Extract<AuctionEntry['call'], { kind: 'bid' }>;
type BidEntry = { seat: Seat; call: Bid; index: number };

export type ForcingLevel = 'none' | 'one-round' | 'game';
export type ForcingConvention = 'none' | 'strong-opening' | 'waiting-response' | 'strong-suit-rebid' | 'forcing-nt'
  | 'michaels-advance' | 'unusual-advance' | 'michaels-inquiry' | 'overcall-stayman' | 'overcall-transfer' | 'weak-jump-inquiry'
  | 'takeout-response' | 'negative-double' | 'overcall-cue' | 'competitive-cue' | 'natural-response'
   | 'reverse' | 'opener-jump-shift' | 'nt-competitive-response' | 'fourth-suit' | 'new-minor' | 'trial-bid' | 'preempt-new-suit'
  | 'takeout-cue' | 'king-ask' | 'artificial-answer' | 'responder-second-suit';
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
const passedBefore = (auction: AuctionEntry[], seat: Seat, index: number) => auction.slice(0, index).some(entry => entry.seat === seat && entry.call.kind === 'pass');

/** Direct/balancing suit doubles and first doubles of low natural auctions are takeout.
 * Later penalty/negative doubles must never acquire this meaning retrospectively.
 */
export function isTakeoutDoubleAt(auction: AuctionEntry[], index: number): boolean {
  const entry = auction[index];
  const opening = bids(auction)[0];
  if (!entry || entry.call.kind !== 'double' || !opening || opening.call.strain === 'NT'
    || opening.call.level > 3 || sideOf(entry.seat) === sideOf(opening.seat)) return false;
  const target = bids(auction.slice(0, index)).at(-1);
  if (target && isArtificialBidAt(auction, target.index)) return false;
  if (index === opening.index + 1 || (index === opening.index + 3
    && auction.slice(opening.index + 1, index).every(before => before.call.kind === 'pass'))) return true;
  // A first double of an enemy single-suit auction (including a raise) is
  // takeout through the three level. Prior natural bidding by our side, or a
  // previous double, changes the context and must not be reclassified here.
  const before = auction.slice(0, index);
  const ourEarlierActions = before.filter(e => sideOf(e.seat) === sideOf(entry.seat) && e.call.kind !== 'pass');
  if (ourEarlierActions.some(e => e.call.kind !== 'double' || e.seat !== entry.seat)
    || ourEarlierActions.some(e => !isTakeoutDoubleAt(auction.slice(0, index), before.indexOf(e)))) return false;
  const enemy = bids(before).filter(e => sideOf(e.seat) !== sideOf(entry.seat));
  const last = enemy.at(-1);
  const naturalTwoSuitAuction = opening.call.level === 1 && enemy.length === 3
    && enemy[1].call.level === 1 && enemy[1].seat !== opening.seat
    && enemy[2].seat === opening.seat && enemy[2].call.level === 2 && enemy[2].call.strain !== 'NT';
  const sandwichAuction = opening.call.level === 1 && enemy.length === 2
    && enemy[1].seat === partnerOf(opening.seat) && enemy[1].call.level === 1
    && enemy[1].call.strain !== 'NT' && enemy[1].call.strain !== opening.call.strain;
  return !!last && last.call.strain !== 'NT' && last.call.level <= 3
    && (enemy.every(e => e.call.strain === opening.call.strain) || naturalTwoSuitAuction || sandwichAuction)
    && (index === last.index + 1 || (index === last.index + 3
      && before.slice(last.index + 1).every(e => e.call.kind === 'pass')));
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

function isDelayedTakeoutSuitAnswer(auction: AuctionEntry[], index: number): boolean {
  const entry = auction[index];
  if (entry?.call.kind !== 'bid' || entry.call.strain === 'NT') return false;
  const double = auction.findLastIndex((prior, priorIndex) => priorIndex < index
    && prior.seat === partnerOf(entry.seat) && isTakeoutDoubleAt(auction, priorIndex));
  if (double < 0 || auction.slice(double + 1, index).some(prior => prior.seat === entry.seat)) return false;
  const enemy = bids(auction.slice(0, double)).filter(prior => sideOf(prior.seat) !== sideOf(entry.seat));
  return enemy.length === 3 && enemy[0].seat === enemy[2].seat && enemy[0].call.level === 1
    && enemy[2].call.level === 2 && enemy[2].call.strain !== enemy[0].call.strain
    && entry.call.strain !== enemy[0].call.strain && entry.call.strain !== enemy[2].call.strain;
}

function publicKeycardTrumpAt(auction: AuctionEntry[], questionIndex: number, system: BiddingSystem): Strain | undefined {
  const question = auction[questionIndex];
  if (question?.call.kind !== 'bid' || question.call.level !== 4 || question.call.strain !== 'NT'
    || !isArtificialBidAt(auction, questionIndex, system)) return undefined;
  const prior = bids(auction).filter(entry => entry.index < questionIndex && sideOf(entry.seat) === sideOf(question.seat));
  const natural = prior.filter(entry => !isArtificialBidAt(auction, entry.index, system));
  const agreed = natural.findLast(entry => entry.call.strain !== 'NT'
    && natural.some(other => other.seat !== entry.seat && other.call.strain === entry.call.strain));
  if (agreed) return agreed.call.strain;
  if (prior[0]?.call.level === 1 && major(prior[0].call.strain) && prior[1]?.call.level === 2
    && prior[1].call.strain === 'NT' && isArtificialBidAt(auction, prior[1].index, system)) return prior[0].call.strain;
  if (natural.some(entry => entry.call.strain === 'NT')) return undefined;
  // A public keycard ask after partner's natural suit sets that suit as
  // trump. Waiting responses and negative artificials are excluded above.
  return natural.findLast(entry => entry.seat === partnerOf(question.seat) && entry.call.strain !== 'NT')?.call.strain;
}

/** Infer artificiality from the call's own prefix, without future hands or
 * calls. The recursion through earlier doubles always uses a shorter prefix. */
export function isArtificialBidAt(auction: AuctionEntry[], index: number, system: BiddingSystem = 'sayc'): boolean {
  const target = auction[index];
  if (target?.call.kind !== 'bid') return false;
  if (isDelayedTakeoutSuitAnswer(auction, index)) return false;
  const targetBid = target.call;
  const prefix = auction.slice(0, index + 1), all = bids(prefix);
  const own = all.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const preceding = own.at(-2);
  const ntBeforeInquiry = own.at(-3);
  if (major(targetBid.strain) && preceding?.call.strain === 'C'
    && targetBid.level === preceding.call.level && ntBeforeInquiry?.call.strain === 'NT'
    && preceding.call.level === ntBeforeInquiry.call.level + 1
    && noTrumpRangeAt(prefix, ntBeforeInquiry.index, system)) return false;
  const jacoby = (system === 'sayc' || system === 'two-over-one') && own[0]?.call.level === 1
    && own[0].index === all[0]?.index
    && major(own[0].call.strain) && own[1]?.call.level === 2 && own[1].call.strain === 'NT'
    && !intervened(prefix, target.seat, own[0].index, own[1].index);
  if (jacoby && (own.length === 2 || own.length === 3 && targetBid.level === 3
    && targetBid.strain !== 'NT' && targetBid.strain !== own[0].call.strain)) return true;
  if (targetBid.level === 4 && targetBid.strain === 'NT') {
    const prior = own.slice(0, -1);
    const agreedSuit = prior.some(entry => entry.call.strain !== 'NT'
      && prior.some(other => other.seat !== entry.seat && other.call.strain === entry.call.strain
        && !isArtificialBidAt(prefix, entry.index, system) && !isArtificialBidAt(prefix, other.index, system)));
    const naturalNt = prior.some(entry => entry.call.strain === 'NT'
      && !isArtificialBidAt(prefix, entry.index, system));
    const partnerSuit = prior.findLast(entry => entry.seat === partnerOf(target.seat) && entry.call.strain !== 'NT'
      && !isArtificialBidAt(prefix, entry.index, system));
    return jacoby || agreedSuit || !naturalNt && !!partnerSuit;
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
    && preceding.call.level <= 2 && target.call.level === preceding.call.level + 1
    && (['C', 'D', 'H'].includes(target.call.strain)
      || preceding.call.level === 1 && target.call.strain === 'S')
    && noTrumpRangeAt(prefix, preceding.index, system)
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
  if (isTakeoutDoubleAt(auction, index)) return 'takeout';
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
  const target = auction[entryIndex];
  if (!target || target.call.kind !== 'bid' || target.call.strain !== 'NT') return undefined;
  const preceding = bids(auction).filter(entry => entry.index <= entryIndex);
  const partnership = preceding.filter(entry => sideOf(entry.seat) === sideOf(target.seat));
  const position = partnership.findIndex(entry => entry.index === entryIndex);
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
    && fourthSuit(partnership.slice(0, 4)) && target.call.level === 2)
    return { min: 12, max: 21 };
  if (position === 3 && partnership[1]?.seat === target.seat
    && reverseByOpener(partnership.slice(0, 3)) && target.call.level === 2)
    return { min: 6, max: 10 };
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
  if ((system === 'sayc' || system === 'two-over-one') && position === 3
    && preceding[0].index === partnership[0].index && opening.level === 1 && opening.strain !== 'NT'
    && target.seat === partnership[1].seat && response.level === 1 && response.strain !== 'NT'
    && partnership[2].seat === partnership[0].seat && partnership[2].call.level <= 2
    && partnership[2].call.strain !== 'NT' && target.call.level === 2)
    return { min: 11, max: 12 };
  if ((system === 'sayc' || system === 'two-over-one') && position === 1
    && preceding[0].index === partnership[0].index && opening.level === 1 && major(opening.strain)
    && target.call.level === 1 && !intervened(auction, target.seat, partnership[0].index, entryIndex))
    return { min: 5, max: 12 };
  if (system === 'sayc' && opening.level === 1 && opening.strain !== 'NT'
    && target.seat === partnership[0].seat && position === 1
    && auction.slice(partnership[0].index + 1, entryIndex).some(entry => entry.seat === partnerOf(target.seat)
      && entry.call.kind === 'double')) {
    const previous = preceding.at(-2)?.call;
    const jumped = previous && bidValue(target.call) - bidValue(previous) > 5;
    // Over 2H/2S, a forced cheapest 2NT answer cannot promise the strength
    // of an unforced jump over a one-level overcall.
    return target.call.level === 1 ? { min: 12, max: 14 }
      : target.call.level === 2 ? jumped ? { min: 18, max: 19 } : { min: 12, max: 18 }
      : target.call.level === 3 ? { min: 19, max: 21 } : undefined;
  }
  if (system === 'sayc' && preceding[0].index === partnership[0].index && opening.level === 1
    && opening.strain !== 'NT' && target.seat === partnership[0].seat && position >= 2
    && target.call.level === 2 && partnership.filter(entry => entry.seat === target.seat).length >= 3
    && !partnership.slice(0, position).some(entry => entry.seat === target.seat && entry.call.strain === 'NT')
    && !isTwoOverOne(partnership[0], partnership[1], auction)) return { min: 18, max: 19 };
  if (position === 1 && (system === 'sayc') && preceding[0].index === partnership[0].index
    && opening.level === 1 && (opening.strain === 'C' || opening.strain === 'D')
    && !intervened(auction, target.seat, partnership[0].index, entryIndex)) {
    if (target.call.level === 2) return { min: 11, max: 12 };
    // Usually 13–15; stronger hands without an honest natural new suit may
    // also place the game, so this is not a fixed 15-HCP upper limit.
    if (target.call.level === 3) return { min: 13, max: 21 };
  }
  if (position === 2 && partnership[0]?.seat === target.seat && partnership[1]?.seat !== target.seat) {
    // A natural 2C overcall followed by a cuebid is not a strong 2C opening.
    if (preceding[0].index !== partnership[0].index) return undefined;
    if (system === 'sayc' && opening.level === 1 && opening.strain !== 'NT'
      && response.level === 2 && response.strain !== 'NT' && response.strain !== opening.strain
      && passedBefore(auction, partnership[1].seat, partnership[0].index)
      && !intervened(auction, target.seat, partnership[0].index, entryIndex)) {
      return target.call.level === 2 ? { min: 12, max: 14 }
        : target.call.level === 3 ? { min: 18, max: 19 } : undefined;
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
    return naturalRebidRange(system, partnership[0].call, target.call);
  }
  return undefined;
}

/** Infer the latest defined public no-trump range for one partnership, including rebids. */
export function latestNoTrumpRange(auction: AuctionEntry[], seat: Seat, system: BiddingSystem, before = auction.length): PointRange | undefined {
  const candidates = bids(auction).filter(entry => entry.index < before && sideOf(entry.seat) === sideOf(seat) && entry.call.strain === 'NT');
  for (let i = candidates.length - 1; i >= 0; i--) {
    const range = noTrumpRangeAt(auction, candidates[i].index, system);
    if (range) return range;
  }
}

function reverseByOpener(partnership: BidEntry[]) {
  if (partnership.length < 3) return false;
  const [opening, response, rebid] = partnership;
  return opening.seat === rebid.seat && response.seat !== opening.seat && opening.call.level === 1 && response.call.level === 1 && rebid.call.level === 2 && rebid.call.strain !== 'NT' && rebid.call.strain !== opening.call.strain && rebid.call.strain !== response.call.strain && bidValue({ kind: 'bid', level: 1, strain: rebid.call.strain }) > bidValue(opening.call);
}

function fourthSuit(partnership: BidEntry[]) {
  if (partnership.length !== 4) return false;
  const natural = partnership.map(entry => entry.call).filter(call => call.strain !== 'NT');
  return natural.length === 4 && new Set(natural.map(call => call.strain)).size === 4
    && partnership[3].call.level >= 2 && partnership[1].seat === partnership[3].seat;
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
  const all = bids(auction);
  const partnership = all.filter(entry => sideOf(entry.seat) === sideOf(seat));
  const opening = partnership[0], response = partnership[1];
  const naturalOpening = opening && all[0]?.seat === opening.seat;

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
  if (system === 'sayc' && pendingTakeout >= 0
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
    && response.call.strain === 'NT' && !intervened(auction, seat, opening.index, response.index);
  const gameForce = !!jacobyGameForce || !!(competitiveCue && response.call.level >= 3) || !!(naturalOpening && response && ((system === 'two-over-one' || system === 'sayc')
    ? isTwoOverOne(opening, response, auction)
    : system === 'precision' && opening.call.level === 1 && opening.call.strain === 'C' && !(response.call.level === 1 && response.call.strain === 'D')));
  const partnershipReachedGame = partnership.some(entry => atGame(entry.call));
  const ntPlatformIndex = opening?.call.strain === 'NT' ? 0
    : opening?.call.level === 2 && opening.call.strain === 'C' && partnership[2]?.call.strain === 'NT' ? 2 : -1;
  if ((system === 'sayc' || system === 'two-over-one') && ntPlatformIndex >= 0 && !partnershipReachedGame) {
    const ntPlatform = partnership[ntPlatformIndex], transfer = partnership[ntPlatformIndex + 1];
    const acceptance = partnership[ntPlatformIndex + 2], secondMajor = partnership[ntPlatformIndex + 3];
    const target: Strain | undefined = transfer?.call.strain === 'D' ? 'H' : transfer?.call.strain === 'H' ? 'S' : undefined;
    if (target && ntPlatform.call.level <= 2 && transfer.call.level === ntPlatform.call.level + 1
      && acceptance?.call.strain === target && acceptance.call.level === transfer.call.level
      && secondMajor?.seat === transfer.seat && secondMajor.call.level === 3
      && major(secondMajor.call.strain) && secondMajor.call.strain !== target)
      return { forcing: 'game', convention: 'responder-second-suit', mustBid: true, currentContractArtificial: false };
  }
  if (gameForce && !partnershipReachedGame) return { forcing: 'game', convention: 'none', mustBid: true, currentContractArtificial: false };
  if (system === 'sayc' && naturalOpening && opening.call.level === 1 && opening.call.strain === 'NT'
    && response?.call.level === 3 && response.call.strain !== 'NT' && !competitiveCue
    && intervened(auction, seat, opening.index, response.index) && !partnershipReachedGame)
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

  const opposingOpening = all[0];
  const directTakeout = opposingOpening?.call.level <= 3 && opposingOpening.call.strain !== 'NT'
    ? auction.findIndex((entry, index) => index > opposingOpening.index && entry.seat === seat && isTakeoutDoubleAt(auction, index)) : -1;
  const partnerCue = directTakeout >= 0 ? [...all].reverse().find(entry => entry.seat === partnerOf(seat)
    && entry.index > directTakeout && entry.call.strain === opposingOpening.call.strain) : undefined;
  const ownBidAfterCue = partnerCue ? all.some(entry => entry.seat === seat && entry.index > partnerCue.index) : false;
  if (partnerCue && !ownBidAfterCue && partnership.at(-1)?.index === partnerCue.index) return { forcing: 'one-round', convention: 'takeout-cue', mustBid: true, currentContractArtificial: true };

  // Later competitive cues have the same response obligation as a direct
  // cue. Do not lose it because the opener, rather than responder, made it.
  // A raise of a suit our side previously bid naturally is still natural.
  const latestPartner = partnership.at(-1);
  const latestIsMichaels = latestPartner && all[0]?.call.level === 1 && all[0].call.strain !== 'NT'
    && sideOf(all[0].seat) !== sideOf(seat) && latestPartner.index === all[0].index + 1
    && latestPartner.call.level === 2 && latestPartner.call.strain === all[0].call.strain;
  if (latestPartner?.seat === partnerOf(seat) && latestPartner.call.strain !== 'NT'
    && !latestIsMichaels
    && !isDelayedTakeoutSuitAnswer(auction, latestPartner.index)
    && all.some(entry => entry.index < latestPartner.index && sideOf(entry.seat) !== sideOf(seat)
      && entry.call.strain === latestPartner.call.strain && !isArtificialBidAt(auction, entry.index, system))
    && !partnership.some(entry => entry.index < latestPartner.index && entry.call.strain === latestPartner.call.strain))
    return { forcing: 'one-round', convention: 'competitive-cue', mustBid: true, currentContractArtificial: true };

  const partnerMadeLastPartnershipBid = partnership.at(-1)?.seat !== seat;
  const opener = partnership[0]?.call;
  if (naturalOpening && partnerMadeLastPartnershipBid && partnership.length === 2
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
    && !passedBefore(auction, partnership[1].seat, opening.index)
    && !auction.slice(partnership[1].index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat)
      && entry.call.kind === 'bid')) return { forcing: 'one-round', convention: 'preempt-new-suit', mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && reverseByOpener(partnership) && partnership.length === 3
    && !auction.slice(partnership[2].index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat)
      && entry.call.kind === 'bid')) return { forcing: 'one-round', convention: 'reverse', mustBid: true, currentContractArtificial: false };
  if (naturalOpening && partnerMadeLastPartnershipBid && fourthSuit(partnership)
    && !passedBefore(auction, partnership[3].seat, opening.index))
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
  for (const entry of side.filter(entry => entry.seat === seat)) {
    const before = side.filter(previous => previous.index < entry.index);
    const previous = before.at(-1);
    const ownPrior = before.filter(previous => previous.seat === seat);
    const enemyOpening = all[0];
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
    const nt = previous?.call.strain === 'NT' && noTrumpRangeAt(auction, previous.index, system);
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
      && entry.call.level === staymanAnswer.call.level && noTrumpRangeAt(auction, staymanPlatform.index, system)) {
      if (suit === entry.call.strain || suit === staymanAnswer.call.strain) minimum = Math.max(minimum, 4);
      if (entry.call.strain === suit) continue;
    }
    if (entry.call.strain !== suit || isArtificialBidAt(auction, entry.index, system)) continue;
    const inquiry = before.at(-2), platform = before.at(-3);
    if (previous?.call.strain === 'C' && inquiry?.call.strain === 'NT'
      && previous.call.level === inquiry.call.level + 1 && entry.call.level === previous.call.level
      && major(suit) && noTrumpRangeAt(auction, inquiry.index, system)) {
      minimum = Math.max(minimum, 4); continue;
    }
    if (previous && platform === undefined && inquiry?.call.strain === 'NT'
      && previous.call.level === inquiry.call.level + 1
      && (previous.call.strain === 'D' && suit === 'H' || previous.call.strain === 'H' && suit === 'S')) {
      minimum = Math.max(minimum, 2); continue;
    }
    // Transfers on a strong-2C NT platform have two extra partnership calls.
    if (previous && inquiry?.call.strain === 'NT' && noTrumpRangeAt(auction, inquiry.index, system)
      && previous.call.level === inquiry.call.level + 1
      && (previous.call.strain === 'D' && suit === 'H' || previous.call.strain === 'H' && suit === 'S')) {
      minimum = Math.max(minimum, 2); continue;
    }
    if (all[0]?.index === entry.index) {
      minimum = Math.max(minimum, entry.call.level === 1 ? major(suit) ? 5 : 3
        : entry.call.level === 2 ? 6 : entry.call.level === 3 ? 7 : 8); continue;
    }
    const repeated = ownPrior.some(prior => prior.call.strain === suit && !isArtificialBidAt(auction, prior.index, system));
    const original = ownPrior.find(prior => prior.call.strain !== 'NT' && !isArtificialBidAt(auction, prior.index, system));
    if (repeated) {
      if (original?.call.strain === suit) {
        if ((system === 'sayc' || system === 'two-over-one') && opening?.seat === seat
          && opening.call.level === 2 && opening.call.strain === 'C' && !major(suit)) {
          // The first natural strong-club minor may come from 4441. Repeating
          // that suit does not add a fifth card to the public promise.
          minimum = Math.max(minimum, 4); continue;
        }
        if (ownPrior.some(prior => prior.call.strain === 'NT' && noTrumpRangeAt(auction, prior.index, system))) {
          // Repeating an NT opener's transfer acceptance or Stayman answer
          // raises the known major; it does not suddenly show a six-card suit.
          minimum = Math.max(minimum, 3); continue;
        }
        const otherSuit = ownPrior.some(prior => prior.call.strain !== 'NT' && prior.call.strain !== suit
          && !isArtificialBidAt(auction, prior.index, system));
        const gameForce = opening && response && isTwoOverOne(opening, response, auction);
        const lastBefore = all.findLast(prior => prior.index < entry.index);
        const jumpMinor = !major(suit) && lastBefore && bidValue(entry.call) - bidValue(lastBefore.call) > 5;
        const nonJump = lastBefore && bidValue(entry.call) - bidValue(lastBefore.call) <= 5;
        const originalIsOvercall = all[0] && sideOf(all[0].seat) !== sideOf(seat);
        const competitiveRepeat = all.some(prior => prior.index > original.index && prior.index < entry.index
          && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system));
        const raisedFit = before.some(prior => prior.seat === partnerOf(seat) && prior.call.strain === suit
          && !isArtificialBidAt(auction, prior.index, system));
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
      minimum = Math.max(minimum, 3); continue;
    }
    const partnerSuit = before.findLast(prior => prior.seat === partnerOf(seat) && prior.call.strain === suit
      && !isArtificialBidAt(auction, prior.index, system));
    if (partnerSuit) {
      const previousBid = all.findLast(prior => prior.index < entry.index);
      const openerRaise = opening?.seat === seat && partnerSuit.index === response?.index && ownPrior.length === 1;
      const preference = !openerRaise && ownPrior.length > 0 && previousBid
        && (partnerSuit.call.strain === opening?.call.strain || !major(suit))
        && bidValue(entry.call) - bidValue(previousBid.call) <= 5;
      const competitiveRaise = openerRaise && all.some(prior => prior.index > partnerSuit.index && prior.index < entry.index
        && sideOf(prior.seat) !== sideOf(seat) && !isArtificialBidAt(auction, prior.index, system));
      minimum = Math.max(minimum, preference ? 2 : major(suit) ? openerRaise && !competitiveRaise ? 4 : 3
        : ownPrior.length === 0 && opening?.index === partnerSuit.index ? 5 : 4);
      if (major(suit) && opening?.call.strain !== suit && !openerRaise && opening?.seat !== seat) minimum = Math.max(minimum, 4);
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
      minimum = Math.max(minimum, minimumAdvance ? 5 : 4); continue;
    }
    const takeout = auction.findLastIndex((prior, index) => index < entry.index
      && prior.seat === partnerOf(seat) && isTakeoutDoubleAt(auction, index));
    const lastBid = all.findLast(prior => prior.index < entry.index);
    if (takeout >= 0 && ownPrior.length === 0) {
      const jump = lastBid && bidValue(entry.call) - bidValue(lastBid.call) > 5;
      const enemySuits = new Set(all.filter(prior => prior.index < takeout && sideOf(prior.seat) !== sideOf(seat)
        && prior.call.strain !== 'NT' && !isArtificialBidAt(auction, prior.index, system)).map(prior => prior.call.strain));
      minimum = Math.max(minimum, jump || enemySuits.size > 1 ? 4 : 3); continue;
    }
    if (system === 'precision' && opening?.call.level === 1 && opening.call.strain === 'C'
      && response?.index === entry.index && major(suit)) {
      minimum = Math.max(minimum, 5); continue;
    }
    if (opening?.index === all[0]?.index && opening.call.level === 1
      && (opening.call.strain === 'C' || opening.call.strain === 'D') && response?.index === entry.index
      && suit === 'S' && entry.call.level === 1
      && all.some(prior => prior.index > opening.index && prior.index < entry.index
        && sideOf(prior.seat) !== sideOf(seat) && prior.call.strain === 'H'
        && !isArtificialBidAt(auction, prior.index, system))) {
      minimum = Math.max(minimum, 5); continue;
    }
    if ((system === 'sayc' || system === 'two-over-one') && opening?.seat === seat
      && opening.call.level === 2 && opening.call.strain === 'C' && !major(suit)
      && !ownPrior.some(prior => !isArtificialBidAt(auction, prior.index, system))) {
      minimum = Math.max(minimum, 4); continue;
    }
    minimum = Math.max(minimum, ownPrior.some(prior => !isArtificialBidAt(auction, prior.index, system))
      || opening?.seat !== seat && opening?.index === all[0]?.index
      && entry.call.level === 1 ? 4 : 5);
  }
  return minimum;
}

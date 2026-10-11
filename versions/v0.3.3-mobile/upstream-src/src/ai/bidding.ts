import { type AuctionEntry, type Call, type Seat, type Strain, type Suit, PASS, SUITS, partnerOf, sideOf } from '../core/types';
import { auctionStatus, sameCall, bidValue } from '../core/auction';
import { type BiddingObservation } from './observation';
import { chooseBid as legacyBid, evaluateHand } from './bidding-legacy';
import { type BiddingSystem, SYSTEMS } from './systems';
import { analyzeAuctionSemantics, classifyDoubleAt, isArtificialBidAt, isTakeoutDoubleAt, latestNoTrumpRange, naturalSuitMinimum, noTrumpRangeAt } from './bidding-semantics';
import { countKeycards, evaluateSuitFit, hasTrumpQueen, rkcb1430Response } from './suit-evaluation';
import { chooseCompetitiveCall } from './competition';
export { evaluateHand } from './bidding-legacy';

type Bid = Extract<Call, { kind: 'bid' }>;
type Entry = { seat: Seat; call: Bid; index: number };
const bid = (level: number, strain: Strain): Bid => ({ kind: 'bid', level, strain });
const major = (strain: Strain): strain is 'H' | 'S' => strain === 'H' || strain === 'S';
const gameLevel = (strain: Strain) => strain === 'NT' ? 3 : major(strain) ? 4 : 5;
const atGame = (call: Bid) => call.level >= gameLevel(call.strain);
const entries = (auction: AuctionEntry[]): Entry[] => auction.flatMap((entry, index) => entry.call.kind === 'bid' ? [{ seat: entry.seat, call: entry.call, index }] : []);
const intervened = (auction: AuctionEntry[], seat: Seat, from: number, to = auction.length) => auction.slice(from + 1, to).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== 'pass');
const passedBefore = (auction: AuctionEntry[], seat: Seat, index: number) => auction.slice(0, index).some(entry => entry.seat === seat && entry.call.kind === 'pass');
function twoOverOne(opening: Entry, response: Entry, auction: AuctionEntry[]) {
  const o = opening.call, r = response.call;
  return o.level === 1 && o.strain !== 'NT' && r.level === 2 && r.strain !== 'NT' && r.strain !== o.strain && bidValue(r) - bidValue(o) <= 5 && !passedBefore(auction, response.seat, opening.index) && !intervened(auction, opening.seat, opening.index, response.index);
}
function secondNegative(us: Entry[], index: number, system: BiddingSystem): boolean {
  if (system === 'precision' || index !== 3 || us[0]?.call.level !== 2 || us[0].call.strain !== 'C'
    || us[1]?.call.strain !== 'D' || us[1].call.level !== 2 || us[2]?.call.strain === 'NT') return false;
  const call = us[index]?.call;
  if (!call || call.level !== 3) return false;
  if (major(us[2].call.strain)) return call.strain === 'C';
  return system === 'sayc' && (us[2].call.strain === 'C' ? call.strain === 'D' : call.strain === 'NT');
}
function knownFit(us: Entry[], lengths: Record<Suit, number>, system: BiddingSystem, seat: Seat): Suit | undefined {
  const strongClub = us[0]?.call.strain === 'C' && (system === 'precision' ? us[0].call.level === 1 : us[0].call.level === 2);
  const ntIndex = us.findIndex((entry, index) => entry.call.strain === 'NT'
    && (index === 0 || (index === 2 && strongClub)));
  if (ntIndex >= 0) {
    const nt = us[ntIndex], request = us[ntIndex + 1], answer = us[ntIndex + 2];
    const base = nt.call.level + 1;
    if (request?.call.level === base && (request.call.strain === 'D' || request.call.strain === 'H')) {
      const target: Suit = request.call.strain === 'D' ? 'H' : 'S';
      // The acceptance does not promise a long suit. Only a subsequent
      // natural trump rebid/raise establishes a fit for keycard purposes.
      return us.slice(ntIndex + 3).some(entry => entry.call.strain === target && entry.call.level >= 3) ? target : undefined;
    }
    if (request?.call.strain === 'C' && request.call.level === base) {
      return answer && major(answer.call.strain) && lengths[answer.call.strain] >= 4
        && (seat !== nt.seat || us.slice(ntIndex + 3).some(entry => entry.call.strain === answer.call.strain)) ? answer.call.strain : undefined;
    }
    return undefined;
  }
  const relevant = us.filter((entry, index) => entry.call.strain !== 'NT'
    && !secondNegative(us, index, system)
    && !(strongClub && (index === 0 || (index === 1 && entry.call.strain === 'D'))));
  const jacobyMajor = us[0]?.call.level === 1 && major(us[0].call.strain) && us[1]?.call.level === 2 && us[1].call.strain === 'NT' ? us[0].call.strain : undefined;
  if (jacobyMajor && lengths[jacobyMajor] >= 3) return jacobyMajor;
  const competitiveMinorTry = us[0]?.call.level === 1 && (us[0].call.strain === 'C' || us[0].call.strain === 'D')
    && us[1]?.call.level === 3 && us[1].call.strain === 'NT'
    && us[2]?.call.level === 4 && us[2].call.strain === us[0].call.strain ? us[0].call.strain : undefined;
  if (competitiveMinorTry && lengths[competitiveMinorTry] >= 2) return competitiveMinorTry;
  const preemptFit = us[0]?.call.level === 3 && us[0].call.strain !== 'NT'
    && us[1]?.call.level === 3 && us[1].call.strain !== 'NT' && us[1].call.strain !== us[0].call.strain
    && us[2]?.call.level === 4 && us[2].call.strain === us[0].call.strain ? us[0].call.strain : undefined;
  if (preemptFit && lengths[preemptFit] >= 2) return preemptFit;
  return (['S', 'H', 'D', 'C'] as Suit[]).find(suit => lengths[suit] >= 2
    && new Set(relevant.filter(e => e.call.strain === suit).map(e => e.seat)).size === 2);
}

/** Declared trump for explanations: auction only, including low-card support.
 * Filter waiting, asking and transfer calls before looking for a mutual raise.
 */
function declaredTrump(us: Entry[], system: BiddingSystem, genuineOpening = true): Suit | undefined {
  const opening = us[0]; if (!opening) return undefined;
  if (opening.call.level === 1 && major(opening.call.strain) && us[1]?.call.level === 2 && us[1].call.strain === 'NT') return opening.call.strain;
  const nt = us.find(entry => entry.call.strain === 'NT' && entry.call.level <= 3);
  const ntIndex = nt ? us.indexOf(nt) : -1;
  const transfer = us[ntIndex + 1];
  const transferSuit = nt && transfer?.call.level === nt.call.level + 1
    ? transfer.call.strain === 'D' ? 'H' : transfer.call.strain === 'H' ? 'S' : undefined : undefined;
  if (transferSuit && us.some(entry => entry.index > transfer.index && entry.call.strain === transferSuit && entry.call.level >= 3)) return transferSuit;
  const staymanAnswer = us[ntIndex + 2];
  if (nt && transfer?.call.strain === 'C' && transfer.call.level === nt.call.level + 1
    && staymanAnswer && major(staymanAnswer.call.strain)
    && us.some(entry => entry.index > staymanAnswer.index && entry.call.strain === staymanAnswer.call.strain)) return staymanAnswer.call.strain;
  const natural = us.filter((entry, index) => entry.call.strain !== 'NT'
    && !secondNegative(us, index, system)
    && !(genuineOpening && index === 0 && ((opening.call.level === 2 && opening.call.strain === 'C' && system !== 'precision')
      || (opening.call.level === 1 && opening.call.strain === 'C' && system === 'precision')))
    && !(genuineOpening && index === 1 && ((opening.call.level === 2 && opening.call.strain === 'C' && entry.call.strain === 'D')
      || (system === 'precision' && opening.call.strain === 'C' && entry.call.strain === 'D')))
    && !(nt && entry.index > nt.index && index <= ntIndex + 2));
  const raise = [...natural].reverse().find(entry => natural.some(before => before.index < entry.index
    && before.seat !== entry.seat && before.call.strain === entry.call.strain));
  if (raise && raise.call.strain !== 'NT') return raise.call.strain;
  if (opening.call.level === 3 && opening.call.strain !== 'NT' && us[2]?.call.strain === opening.call.strain) return opening.call.strain;
  if (opening.call.level === 1 && !major(opening.call.strain) && opening.call.strain !== 'NT'
    && us[1]?.call.strain === 'NT' && us[1].call.level === 3 && us[2]?.call.strain === opening.call.strain && us[2].call.level === 4) return opening.call.strain;
  return undefined;
}

/** A keycard ask can itself confirm support of partner's last natural suit.
 * This never turns a waiting bid, cuebid, transfer or NT sequence into trump.
 */
function keycardTrump(us: Entry[], system: BiddingSystem, asker: Seat, auction: AuctionEntry[]): Suit | undefined {
  const declared = declaredTrump(us, system, entries(auction)[0]?.index === us[0]?.index);
  if (declared) return declared;
  if (us.some(entry => entry.call.strain === 'NT')) return undefined;
  const partner = [...us].reverse().find(entry => entry.seat === partnerOf(asker) && entry.call.strain !== 'NT');
  if (!partner) return undefined;
  const index = us.indexOf(partner), opening = us[0];
  const strong = opening?.call.strain === 'C' && (system === 'precision' ? opening.call.level === 1 : opening.call.level === 2);
  if (strong && (index === 0 || (index === 1 && partner.call.strain === 'D'))) return undefined;
  if (secondNegative(us, index, system)) return undefined;
  if (entries(auction).some(entry => sideOf(entry.seat) !== sideOf(asker) && entry.call.strain === partner.call.strain)) return undefined;
  return partner.call.strain as Suit;
}

/** Decisions consume only BiddingObservation. System ranges and forcing states are public. */
export function chooseBid(obs: BiddingObservation, system: BiddingSystem = 'two-over-one'): Call {
  if (system === 'natural-lite') return legacyBid(obs);
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const semantics = analyzeAuctionSemantics(obs.auction, obs.seat, system);
  const available = (call: Call) => obs.legalCalls.some(c => sameCall(c, call));
  const forcedFallback = (): Call => {
    // A forcing obligation is not permission to name an arbitrary short suit.
    // Prefer actual length or a publicly shown natural partner suit, avoiding
    // opponent suits and artificial questions that have their own handlers.
    const enemySuits = new Set(all.filter(e => sideOf(e.seat) !== sideOf(obs.seat)
      && !all.some(prior => prior.index < e.index && sideOf(prior.seat) === sideOf(obs.seat)
        && prior.call.strain === e.call.strain)).map(e => e.call.strain));
    const partnerSuits = us.filter(e => e.seat === partnerOf(obs.seat) && e.call.strain !== 'NT'
      && !enemySuits.has(e.call.strain) && !(e.call.level === 2 && e.call.strain === 'C' && e === opening && naturalOpening));
    const candidates = obs.legalCalls.filter((c): c is Bid => c.kind === 'bid');
    const score = (c: Bid) => c.strain === 'NT'
      ? (balanced && [...enemySuits].every(hasStopper) ? 9 : 0) - c.level * 2
      : lengths[c.strain] * 2 + (partnerSuits.some(e => e.call.strain === c.strain) ? 4 : 0)
        - (enemySuits.has(c.strain) ? 15 : 0) - c.level * 2;
    return candidates.sort((a, b) => score(b) - score(a) || bidValue(a) - bidValue(b))[0] ?? PASS;
  };
  const safePass = (): Call => semantics.mustBid ? forcedFallback() : PASS;
  const pick = (...calls: Call[]): Call => calls.find(available) ?? safePass();
  const cheapest = (strain: Strain, maximum = 7): Call | undefined => {
    for (let level = 1; level <= maximum; level++) if (available(bid(level, strain))) return bid(level, strain);
  };
  const sorted = [...SUITS].sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a));
  const naturalMajorOrder = (['H', 'S'] as Suit[]).sort((a, b) => lengths[b] - lengths[a]
    || (lengths[a] === 4 ? SUITS.indexOf(a) - SUITS.indexOf(b) : SUITS.indexOf(b) - SUITS.indexOf(a)));
  const longest = sorted[0]; const openingMajor = sorted.find(suit => major(suit) && lengths[suit] >= 5);
  const minor = lengths.C === lengths.D ? (lengths.C === 3 ? 'C' : 'D') : lengths.C > lengths.D ? 'C' : 'D';
  const saycOpeningStrength = hcp >= 13 || (hcp === 12 && lengths[sorted[0]] + lengths[sorted[1]] >= 8);
  const hasStopper = (strain: Strain) => strain === 'NT' || obs.hand.some(c => c.suit === strain && (c.rank === 14 || (c.rank === 13 && lengths[c.suit] >= 2) || (c.rank === 12 && lengths[c.suit] >= 3)));
  const reasonablePreemptSuit = (suit: Suit) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    return ranks.length >= 7 || (ranks.filter(rank => rank >= 10).length >= 2 && ranks.some(rank => rank >= 12));
  };
  const all = entries(obs.auction); const us = all.filter(e => sideOf(e.seat) === sideOf(obs.seat));
  const opening = us[0]; const response = us[1]; const p = us.filter(e => e.seat === partnerOf(obs.seat)).at(-1);
  const own = us.filter(e => e.seat === obs.seat); const last = all.at(-1);
  const naturalOpening = !!opening && all[0]?.index === opening.index;
  const range = (call: Bid): [number, number] => call.level === 2 ? system === 'precision' ? [22, 23] : [20, 21] : system === 'precision' ? [13, 15] : [15, 17];
  const responder = opening ? partnerOf(opening.seat) : null;
  const isOpener = opening?.seat === obs.seat;
  const partnerTrumpMinimum = (trump: Suit): number => {
    const partner = partnerOf(obs.seat);
    const negativeIndex = obs.auction.findIndex((entry, index) => entry.seat === partner
      && classifyDoubleAt(obs.auction, index, system) === 'negative');
    const negativeEnemy = negativeIndex >= 0 ? all.findLast(entry => entry.index < negativeIndex
      && sideOf(entry.seat) !== sideOf(obs.seat)) : undefined;
    if (naturalOpening && major(trump) && negativeEnemy && trump !== opening.call.strain
      && trump !== negativeEnemy.call.strain) return 4;
    const partnerBids = us.filter(entry => entry.seat === partner);
    const ownDoubleIndex = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, index));
    const firstReply = partnerBids[0];
    if (ownDoubleIndex >= 0 && firstReply?.index > ownDoubleIndex && firstReply.call.strain === trump
      && !partnerBids.some(entry => entry.index > firstReply.index && entry.call.strain === trump)) {
      const previous = all.findLast(entry => entry.index < firstReply.index)?.call;
      return previous && bidValue(firstReply.call) - bidValue(previous) > 5 ? 4 : 0;
    }
    if (naturalOpening && opening?.seat === obs.seat && major(opening.call.strain)
      && response?.call.level === 1 && response.call.strain === 'NT' && us[2]?.call.level === 3
      && us[2].call.strain !== opening.call.strain && partnerBids.at(-1)?.call.strain === trump
      && major(trump) && partnerBids.at(-1)!.index > us[2].index) return 6;
    if (opening?.seat === obs.seat && major(opening.call.strain) && opening.call.strain === trump && partnerBids.some(entry => entry.call.level === 2 && entry.call.strain === 'NT')) return 4;
    if (naturalOpening && opening?.seat === obs.seat && opening.call.level === 1
      && opening.call.strain === trump && !major(trump) && response?.call.strain === trump) return 5;
    // Returning to opener's major after a second suit is a preference, not
    // a simple raise. In the semi-forcing NT sequence it may be just two cards.
    if (naturalOpening && opening?.seat === obs.seat && opening.call.strain === trump
      && response?.call.level === 1 && response.call.strain !== trump
      && us[2]?.call.level === 2 && us[2].call.strain !== trump
      && partnerBids.some(entry => entry.index > us[2].index && entry.call.level === 2 && entry.call.strain === trump)) return 2;
    if (naturalOpening && opening?.seat === partner && response?.seat === obs.seat
      && response.call.level === 1 && response.call.strain === trump && opening.call.strain !== trump
      && us[2]?.seat === partner && us[2].call.strain === trump) return 4;
    // Both decisions and hover descriptions use conservative public lengths.
    // Repeating a four-card second suit does not turn it into six.
    return naturalSuitMinimum(obs.auction, partner, trump, system);
  };
  const fitPoints = (trump: Suit, promised = partnerTrumpMinimum(trump)) => evaluateSuitFit(obs.hand, trump, promised).totalPoints;

  if (!last) {
    if (system === 'precision') {
      if (balanced && hcp >= 22 && hcp <= 23) return pick(bid(2, 'NT'));
      if (hcp >= 16) return pick(bid(1, 'C'));
      if (hcp >= 11) {
        if (openingMajor) return pick(bid(1, openingMajor));
        if (balanced && hcp >= 13) return pick(bid(1, 'NT'));
        if (lengths.C >= 6 || (lengths.C === 5 && (lengths.H === 4 || lengths.S === 4))) return pick(bid(2, 'C'));
        if (lengths.D <= 1 && lengths.H >= 3 && lengths.S >= 3 && lengths.C >= 4) return pick(bid(2, 'D'));
        return pick(bid(1, 'D'));
      }
    } else {
      if (system === 'sayc' && balanced && hcp >= 25 && hcp <= 27) return pick(bid(3, 'NT'));
      if (hcp >= 22) return pick(bid(2, 'C'));
      if (balanced && hcp >= 20 && hcp <= 21) return pick(bid(2, 'NT'));
      if (balanced && hcp >= 15 && hcp <= 17) return pick(bid(1, 'NT'));
      if (system === 'sayc' ? saycOpeningStrength : hcp >= 12) return pick(bid(1, openingMajor ?? minor));
    }
    if (system === 'sayc' && hcp >= 5 && hcp <= 10 && lengths[longest] >= 8) return pick(bid(4, longest));
    if (system === 'sayc' && hcp >= 5 && hcp <= 10 && lengths[longest] >= 7) return pick(bid(3, longest));
    if (system === 'sayc' && hcp >= 5 && hcp <= 11 && lengths[longest] >= 6 && longest !== 'C' && reasonablePreemptSuit(longest)) return pick(bid(2, longest));
    if (system !== 'sayc' && hcp >= 6 && hcp <= 10 && lengths[longest] >= 6 && (system === 'precision' ? major(longest) : longest !== 'C')) return pick(bid(2, longest));
    if (system !== 'sayc' && hcp >= 6 && hcp <= 10 && lengths[longest] >= 7) return pick(bid(3, longest));
    return safePass();
  }

  // Answer an outstanding NT question before competition or strength/fit
  // scoring. A lead-directing double of the artificial request does not
  // turn a transfer into natural support or cancel Stayman's answer.
  const strongNtPlatform = naturalOpening && (system === 'sayc' || system === 'two-over-one')
    && opening?.call.level === 2 && opening.call.strain === 'C'
    && response?.call.level === 2 && response.call.strain === 'D' && us[2]?.call.strain === 'NT'
    ? us[2] : undefined;
  const questionNt = naturalOpening && opening?.call.strain === 'NT' ? opening : strongNtPlatform;
  const questionEntries = questionNt ? us.slice(us.indexOf(questionNt)) : [];
  const question = questionEntries[1];
  if (questionNt && questionNt.seat === obs.seat && questionEntries.length === 2 && question
    && question.call.level === questionNt.call.level + 1 && questionNt.call.level <= 2
    && obs.auction.slice(questionNt.index + 1, question.index).every(entry => entry.call.kind === 'pass')
    && obs.auction.slice(question.index + 1).every(entry => entry.call.kind === 'pass' || entry.call.kind === 'double')) {
    if (question.call.strain === 'C') return pick(bid(question.call.level, lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D'));
    if (question.call.strain === 'D' || question.call.strain === 'H')
      return pick(bid(question.call.level, question.call.strain === 'D' ? 'H' : 'S'));
  }

  // A lead double of the artificial opening does not show a natural enemy
  // suit. Keep waiting and opener's first description ahead of generic fit
  // scoring, which must never count artificial 2C as a club fit.
  const quietStrongClub = naturalOpening && (system === 'sayc' || system === 'two-over-one')
    && opening?.call.level === 2 && opening.call.strain === 'C'
    && !obs.auction.slice(opening.index + 1).some(entry => sideOf(entry.seat) !== sideOf(obs.seat)
      && entry.call.kind === 'bid');
  if (quietStrongClub && obs.seat === responder && !own.length) return pick(bid(2, 'D'));
  if (quietStrongClub && isOpener && us.length === 2 && response?.call.level === 2 && response.call.strain === 'D') {
    if (balanced) return pick(bid(hcp >= 25 ? 3 : 2, 'NT'));
    if (lengths[longest] === 4) {
      const minor = (['D', 'C'] as Suit[]).find(suit => lengths[suit] >= 4);
      if (minor) return pick(bid(3, minor));
    }
    return pick(cheapest(longest, 3) ?? safePass());
  }

  if (system === 'sayc') {
    const competitive = chooseCompetitiveCall(obs, system);
    // A released one-round obligation does not make Pass compulsory. Keep
    // independently known game values and an available natural major alive.
    const enemySuits = [...new Set(all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
      && entry.call.strain !== 'NT' && !isArtificialBidAt(obs.auction, entry.index, system)).map(entry => entry.call.strain as Suit))];
    if ((!competitive || competitive.kind === 'pass') && naturalOpening && !isOpener && !own.length
      && opening.call.level === 1 && opening.call.strain !== 'NT' && hcp >= 13 && enemySuits.length) {
      const newSuit = sorted.find(suit => suit !== opening.call.strain && !enemySuits.includes(suit)
        && lengths[suit] >= 5 && cheapest(suit, 3));
      if (newSuit) return pick(cheapest(newSuit, 3) ?? safePass());
      if (enemySuits.every(hasStopper)) return pick(bid(3, 'NT'));
      const cue = enemySuits.find(suit => cheapest(suit, 3));
      if (cue) return pick(cheapest(cue, 3) ?? safePass());
    }
    const continuationAfterInterference = naturalOpening && opening.call.level === 1 && opening.call.strain !== 'NT'
      && response?.call.level === 1 && response.call.strain !== 'NT' && own.length >= 1
      && !us.some(entry => atGame(entry.call));
    if ((!competitive || competitive.kind === 'pass') && continuationAfterInterference
      && all.some(entry => sideOf(entry.seat) !== sideOf(obs.seat))) {
      if (obs.seat === responder && hcp + 12 >= 25) {
        if (p?.call.strain === 'NT' && p.index === last?.index
          && own.some(entry => entry.call.strain !== 'NT' && isArtificialBidAt(obs.auction, entry.index, system)))
          return pick(bid(3, 'NT'));
        const fit = sorted.find(suit => us.some(entry => entry.seat === partnerOf(obs.seat) && entry.call.strain === suit
          && !isArtificialBidAt(obs.auction, entry.index, system)) && lengths[suit] + partnerTrumpMinimum(suit) >= 8);
        if (fit && fitPoints(fit) + 12 >= (major(fit) ? 25 : 29)) return pick(bid(gameLevel(fit), fit));
        if (enemySuits.every(hasStopper)) return pick(bid(3, 'NT'));
        const cue = enemySuits.find(suit => cheapest(suit, 3));
        if (cue) return pick(cheapest(cue, 3) ?? safePass());
        const second = sorted.find(suit => suit !== response.call.strain && !enemySuits.includes(suit)
          && lengths[suit] >= 4 && cheapest(suit, 3));
        if (second) return pick(cheapest(second, 3) ?? safePass());
      }
      if (isOpener && own.length === 1) {
        if (balanced && hcp >= 18 && enemySuits.every(hasStopper)) return pick(bid(2, 'NT'));
        const newMajor = naturalMajorOrder.find(suit => suit !== opening.call.strain && suit !== response.call.strain
          && !enemySuits.includes(suit) && lengths[suit] >= 4 && available(bid(1, suit)));
        if (newMajor) return hcp >= 19 && opening.call.strain !== 'NT'
          && lengths[opening.call.strain] >= 4 && available(bid(2, newMajor))
          ? bid(2, newMajor) : bid(1, newMajor);
        if (major(opening.call.strain) && lengths[opening.call.strain] >= 6)
          return pick(cheapest(opening.call.strain, 3) ?? safePass());
      }
    }
    if (competitive && available(competitive) && (competitive.kind !== 'pass'
      || !semantics.mustBid && !(naturalOpening && own.length > 0))) return competitive;
  }

  // RKCB 1430 is used only with publicly established trump support.
  if (p?.call.strain === 'NT' && p.call.level === 4) {
    const fit = knownFit(us.slice(0, -1), lengths, system, p.seat) ?? keycardTrump(us.slice(0, -1), system, p.seat, obs.auction);
    if (fit) {
      const answer = rkcb1430Response(countKeycards(obs.hand, fit), hasTrumpQueen(obs.hand, fit));
      return pick(bid(answer.level, answer.strain));
    }
    const quantitativeRange = latestNoTrumpRange(obs.auction, obs.seat, system, p.index);
    return balanced && quantitativeRange && hcp >= quantitativeRange.max ? pick(bid(6, 'NT')) : safePass();
  }

  // The next step over a 5C/5D RKCB response asks for the trump queen.
  const ownLast = own.at(-1);
  const fourNt = [...us].reverse().find(entry => entry.call.level === 4 && entry.call.strain === 'NT');
  const rkcbFit = fourNt ? knownFit(us.filter(entry => entry.index < fourNt.index), lengths, system, fourNt.seat)
    ?? keycardTrump(us.filter(entry => entry.index < fourNt.index), system, fourNt.seat, obs.auction) : undefined;
  // RKCB 5NT asks for a specific side-suit king. The trump king is already a keycard.
  const kingAsk = !!(rkcbFit && fourNt && ownLast && p && p.call.level === 5 && p.call.strain === 'NT'
    && fourNt.seat === p.seat && ownLast.index > fourNt.index && ownLast.index < p.index && ownLast.call.level === 5 && ownLast.call.strain !== 'NT');
  if (kingAsk && rkcbFit) {
    const sideKing = (['C', 'D', 'H', 'S'] as Suit[]).find(suit => suit !== rkcbFit && obs.hand.some(card => card.suit === suit && card.rank === 13));
    return pick(sideKing ? bid(6, sideKing) : bid(6, rkcbFit));
  }
  // A side-king response accepts the grand-slam try; six of trumps denies a side king.
  const kingReply = !!(rkcbFit && fourNt && ownLast && p && ownLast.call.level === 5 && ownLast.call.strain === 'NT'
    && ownLast.index > fourNt.index && p.index > ownLast.index && p.call.level === 6 && p.call.strain !== 'NT');
  if (kingReply && rkcbFit && p) return p.call.strain === rkcbFit ? safePass() : pick(bid(7, rkcbFit), bid(6, rkcbFit));
  // A below-trump six-level response to the queen ask shows the trump queen
  // and that side-suit king. It is descriptive, not a proposal to play there;
  // the asker signs off in six of the already agreed trump suit.
  const rkcbAnswer = fourNt ? us.find(entry => entry.index > fourNt.index && entry.seat === partnerOf(fourNt.seat)
    && entry.call.level === 5 && (entry.call.strain === 'C' || entry.call.strain === 'D')) : undefined;
  const queenInquiryByUs = !!(rkcbFit && fourNt && fourNt.seat === obs.seat && ownLast && rkcbAnswer && p
    && rkcbAnswer.index < ownLast.index && ownLast.index < p.index
    && ((rkcbAnswer.call.strain === 'C' && ownLast.call.level === 5 && ownLast.call.strain === 'D')
      || (rkcbAnswer.call.strain === 'D' && ownLast.call.level === 5 && ownLast.call.strain === 'H')));
  if (queenInquiryByUs && rkcbFit && p && p.call.level === 6 && p.call.strain !== rkcbFit
    && bidValue(p.call) < bidValue(bid(6, rkcbFit))) return pick(bid(6, rkcbFit));
  if (queenInquiryByUs && rkcbFit && p && p.call.strain === rkcbFit && (p.call.level === 5 || p.call.level === 6)) return safePass();
  const queenAsk = !!(rkcbFit && ownLast && p && ownLast.index < p.index && ownLast.call.level === 5
    && ((ownLast.call.strain === 'C' && p.call.level === 5 && p.call.strain === 'D') || (ownLast.call.strain === 'D' && p.call.level === 5 && p.call.strain === 'H')));
  if (queenAsk && rkcbFit) {
    if (!hasTrumpQueen(obs.hand, rkcbFit)) return pick(cheapest(rkcbFit, 6) ?? safePass());
    const sixTrump = bid(6, rkcbFit);
    const sideKing = (['C', 'D', 'H', 'S'] as Suit[]).find(suit => suit !== rkcbFit && obs.hand.some(card => card.suit === suit && card.rank === 13) && bidValue(bid(6, suit)) < bidValue(sixTrump) && available(bid(6, suit)));
    return pick(sideKing ? bid(6, sideKing) : sixTrump);
  }
  if (own.at(-1)?.call.strain === 'NT' && own.at(-1)?.call.level === 4 && p?.call.level === 5) {
    const fit = knownFit(us.slice(0, -2), lengths, system, obs.seat) ?? keycardTrump(us.slice(0, -2), system, obs.seat, obs.auction);
    if (fit) {
      const ownKeycards = countKeycards(obs.hand, fit);
      let partnerKeysMinimum = p.call.strain === 'C' ? 1 : p.call.strain === 'D' ? 0 : 2;
      // A defined NT range can rule out the zero side of a 0/3 reply.
      // Subtract our honors and all remaining keycard honors from the deck's
      // forty HCP: the remainder is the most partner could hold with no keys.
      // This uses only our hand and partner's earlier public NT promise.
      const partnerNt = [...us].reverse().filter(entry => entry.seat === p.seat && entry.call.strain === 'NT'
        && entry.index < own.at(-1)!.index && !isArtificialBidAt(obs.auction, entry.index, system))
        .map(entry => noTrumpRangeAt(obs.auction, entry.index, system)).find(range => range !== undefined);
      const remainingKeyPoints = SUITS.filter(suit => !obs.hand.some(card => card.suit === suit && card.rank === 14)).length * 4
        + (obs.hand.some(card => card.suit === fit && card.rank === 13) ? 0 : 3);
      if (p.call.strain === 'D' && ownKeycards <= 2 && partnerNt
        && partnerNt.min > 40 - hcp - remainingKeyPoints) partnerKeysMinimum = 3;
      // An RKCB answer can coincide with the safe trump contract. Repeating
      // the same bid is illegal, but passing that answer is legal signoff;
      // the generic artificial-contract fallback must not raise it a level.
      const signoff = (level: number): Call => p.call.strain === fit && p.call.level === level
        ? PASS : pick(bid(level, fit));
      const openingBid = us[0]; const responseBid = us[1];
      const publicPartnerMin = openingBid?.seat === obs.seat
        ? responseBid?.call.level === 2 && responseBid.call.strain === 'NT' ? 13 : system === 'precision' && openingBid.call.strain === 'C' && responseBid && !(responseBid.call.level === 1 && responseBid.call.strain === 'D') ? 8 : responseBid?.call.level === 3 ? 10 : 6
        : !naturalOpening ? openingBid?.call.level === 1 ? 8 : 10 : (system === 'two-over-one' || system === 'sayc') && openingBid?.call.level === 2 && openingBid.call.strain === 'C' ? 22 : system === 'precision' && openingBid?.call.level === 1 && openingBid.call.strain === 'C' ? 16 : system === 'precision' ? 11 : 12;
      const allFiveKnown = ownKeycards + partnerKeysMinimum === 5;
      const trumpQueenKnown = hasTrumpQueen(obs.hand, fit) || p.call.strain === 'S';
      if (allFiveKnown && trumpQueenKnown && fitPoints(fit) + publicPartnerMin >= 37 && available(bid(5, 'NT'))) return bid(5, 'NT');
      if (p.call.strain === 'C' || p.call.strain === 'D') {
        const knownTotal = ownKeycards + partnerKeysMinimum;
        if (knownTotal < 4) return p.call.strain === fit ? PASS : pick(cheapest(fit, 6) ?? safePass());
        if (hasTrumpQueen(obs.hand, fit)) return pick(bid(6, fit));
        const question = bid(5, p.call.strain === 'C' ? 'D' : 'H');
        // Do not ask about a queen we hold, or ask past the safe five-level
        // contract when the response leaves two keycards missing.
        return bidValue(question) < bidValue(bid(5, fit)) ? pick(question)
          : p.call.strain === fit ? PASS : pick(cheapest(fit, 6) ?? safePass());
      }
      const totalKeycards = ownKeycards + 2;
      const hasQueen = trumpQueenKnown;
      const level = totalKeycards === 5 && hasQueen && fitPoints(fit) + publicPartnerMin >= 37 ? 7 : totalKeycards >= 4 && hasQueen ? 6 : 5;
      return signoff(level);
    }
  }

  const directUncontested = opening && !intervened(obs.auction, obs.seat, opening.index);
  const gameForcing = (semantics.forcing === 'game' && (!directUncontested || semantics.convention === 'strong-suit-rebid'
    || semantics.convention === 'opener-jump-shift')) || !!(naturalOpening && response && ((system === 'two-over-one' || system === 'sayc')
    ? twoOverOne(opening, response, obs.auction)
    : system === 'precision' && opening.call.level === 1 && opening.call.strain === 'C' && !(response.call.level === 1 && response.call.strain === 'D')));

  // After 1m-(3X)-3NT, a strong distributional opener may continue with a
  // six-card minor as a natural slam try. Responder's return to 4NT with
  // two-card support and extras is RKCB for that explicitly established fit.
  const competitiveThreeNt = !!(opening && response && opening.call.level === 1
    && (opening.call.strain === 'C' || opening.call.strain === 'D')
    && response.call.level === 3 && response.call.strain === 'NT'
    && intervened(obs.auction, opening.seat, opening.index, response.index));
  if (competitiveThreeNt && isOpener && own.length === 1 && p?.index === response?.index
    && lengths[opening!.call.strain as Suit] >= 6 && hcp >= 16) return pick(bid(4, opening!.call.strain));
  if (competitiveThreeNt && obs.seat === responder && own.length === 1 && p?.call.level === 4
    && p.call.strain === opening!.call.strain && lengths[opening!.call.strain as Suit] >= 2 && hcp >= 13
    && available(bid(4, 'NT'))) return bid(4, 'NT');

  const closeGame = (): Call => {
    const partnerSuits = us.filter(e => e.seat === partnerOf(obs.seat) && e.call.strain !== 'NT'
      && !isArtificialBidAt(obs.auction, e.index, system));
    const fit = [...new Map(partnerSuits.map(entry => [entry.call.strain, entry])).values()]
      .map(entry => ({ entry, combined: lengths[entry.call.strain as Suit] + partnerTrumpMinimum(entry.call.strain as Suit) }))
      .filter(candidate => candidate.combined >= 8)
      .sort((a, b) => b.combined - a.combined || (major(b.entry.call.strain) ? 1 : 0) - (major(a.entry.call.strain) ? 1 : 0))[0]?.entry;
    if (fit) return pick(bid(gameLevel(fit.call.strain), fit.call.strain), bid(3, 'NT'));
    const ownLongSuit = sorted.find(suit => lengths[suit] >= 6);
    const realMajor = sorted.find(suit => major(suit) && lengths[suit] >= 5 && available(bid(4, suit)));
    const realSide = sorted.find(suit => lengths[suit] >= 4 && cheapest(suit, 4));
    return pick(bid(3, 'NT'), ownLongSuit ? bid(gameLevel(ownLongSuit), ownLongSuit)
      : realMajor ? bid(4, realMajor) : realSide ? cheapest(realSide, 4)! : bid(5, longest), bid(5, longest));
  };

  const partnerMinimum = (): number => {
    const supportMinimum = (): number => {
      if (!p || p.call.strain === 'NT') return 10;
      const previousOwn = own.findLast(entry => entry.index < p.index && entry.call.strain === p.call.strain);
      const preceding = all.findLast(entry => entry.index < p.index);
      const enemyAdvanced = previousOwn && all.some(entry => entry.index > previousOwn.index && entry.index < p.index
        && sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, entry.index, system));
      // A minimum raise after the opponents take away bidding space is
      // competitive support, rather than a fresh ten-point invitation.
      return enemyAdvanced && preceding && bidValue(p.call) - bidValue(preceding.call) <= 5 ? 6 : 10;
    };
    if (naturalOpening && !isOpener && p?.seat === opening.seat && response?.call.level === 1
      && major(response.call.strain) && p.call.strain === response.call.strain && p.call.level === 3
      && p.index === us[2]?.index) return 16;
    if (naturalOpening && !isOpener && p?.seat === opening.seat && p.call.strain === opening.call.strain
      && p.call.strain !== 'NT' && p.call.level === 3 && p.index === us[2]?.index
      && response?.call.level === 1 && response.call.strain !== opening.call.strain) return 16;
    if (naturalOpening && !isOpener && p?.seat === opening.seat && major(p.call.strain) && p.call.level === 3
      && response?.call.strain === opening.call.strain && response.call.level === 2) return 16;
    if (p?.call.strain === 'NT') {
      const publicRange = noTrumpRangeAt(obs.auction, p.index, system);
      if (publicRange) return publicRange.min;
    }
    const ourNegative = obs.auction.findIndex((entry, index) => entry.seat === obs.seat
      && classifyDoubleAt(obs.auction, index, system) === 'negative');
    if (ourNegative >= 0 && p && major(p.call.strain) && p.call.level === 3 && p.index > ourNegative
      && !own.length) {
      const beforeReply = all.findLast(entry => entry.index < p.index)?.call;
      if (beforeReply && bidValue(p.call) - bidValue(beforeReply) > 5) return 16;
    }
    if (naturalOpening && isOpener && p && p.call.level === 3 && p.call.strain !== 'NT'
      && !major(p.call.strain) && p.call.strain === opening.call.strain
      && own.some(entry => entry.index < p.index && entry.call.level === 2 && entry.call.strain === p.call.strain))
      return supportMinimum();
    if ((system === 'sayc' || system === 'two-over-one') && naturalOpening && !isOpener
      && p?.index === us[2]?.index && p.call.strain !== 'NT' && response?.call.level === 1
      && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain
      && !all.some(entry => entry.index < p.index && sideOf(entry.seat) !== sideOf(obs.seat)
        && entry.call.strain === p.call.strain && !isArtificialBidAt(obs.auction, entry.index, system))) {
      const preceding = all.findLast(entry => entry.index < p.index)?.call;
      if (preceding && bidValue(p.call) - bidValue(preceding) > 5) return 19;
    }
    if (naturalOpening && p && p.call.strain !== 'NT' && major(p.call.strain) && p.call.level === 3) {
      const previous = all.findLast(entry => entry.index < p.index)?.call;
      if (!isOpener && p.seat === opening.seat && p.call.strain === opening.call.strain
        && previous && bidValue(p.call) - bidValue(previous) > 5) return 16;
      if (isOpener && own.some(entry => entry.index < p.index && entry.call.strain === p.call.strain)) return supportMinimum();
      if (isOpener && response?.call.level === 1 && response.call.strain === p.call.strain
        && p.index > response.index) return 10;
    }
    if (naturalOpening && isOpener && response?.call.strain === opening.call.strain
      && response.call.strain !== 'NT') return response.call.level === 2 ? 6 : response.call.level === 3 ? 10 : 0;
    if (naturalOpening && isOpener && response?.call.level === 1 && response.call.strain === 'NT'
      && p?.call.level === 3 && major(p.call.strain) && p.call.strain !== opening.call.strain) {
      const preceding = all.findLast(entry => entry.index < p.index)?.call;
      if (preceding && bidValue(p.call) - bidValue(preceding) > 5) return 10;
    }
    if (naturalOpening && !isOpener && p && p.index === us[2]?.index
      && p.call.level === 2 && p.call.strain !== 'NT' && p.call.strain !== opening.call.strain
      && p.call.strain !== response?.call.strain
      && bidValue(bid(1, p.call.strain)) > bidValue(opening.call)) return 17;
    if (naturalOpening && opening?.seat === obs.seat && response?.call.level === 1
      && major(response.call.strain) && us[2]?.call.level === 2 && us[2].call.strain === response.call.strain
      && p && p.index > us[2].index && p.call.level === 3 && p.call.strain === response.call.strain) return 10;
    const takeoutIndex = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, index));
    if (p && takeoutIndex >= 0 && p.index > takeoutIndex) {
      const opposingOpening = all[0]?.call;
      const firstReply = all.find(entry => entry.seat === partnerOf(obs.seat) && entry.index > takeoutIndex);
      if (!firstReply) return 0;
      if (opposingOpening && firstReply.call.strain === opposingOpening.strain) return 12;
      if (firstReply.call.strain === 'NT') return firstReply.call.level === 1 ? 6 : firstReply.call.level === 2 ? 11 : 13;
      const previous = all.findLast(entry => entry.index < firstReply.index)?.call;
      return previous && bidValue(firstReply.call) - bidValue(previous) > 5 ? 9 : 0;
    }
    if (!opening || opening.seat === obs.seat) {
      if (!response || response.seat !== partnerOf(obs.seat)) return 0;
      if ((system === 'sayc' || system === 'two-over-one') && opening?.call.level === 2 && opening.call.strain === 'C'
        && response.call.strain === 'D' && response.call.level === 2) return 0;
      if (system === 'precision' && opening?.call.level === 1 && opening.call.strain === 'C') return response.call.level === 1 && response.call.strain === 'D' ? 0 : 8;
      if ((system === 'two-over-one' || system === 'sayc') && opening && twoOverOne(opening, response, obs.auction)) return 13;
      if (opening && major(opening.call.strain) && response.call.level === 2 && response.call.strain === 'NT') return 13;
      if (opening && major(opening.call.strain) && response.call.level === 3 && response.call.strain === opening.call.strain) return 10;
      if (system === 'sayc' && opening && major(opening.call.strain) && response.call.level === 1 && response.call.strain === 'NT') return 5;
      if (opening && opening.call.level === 2 && opening.call.strain !== 'C' && opening.call.strain !== 'NT'
        && response.call.strain !== opening.call.strain && response.call.strain !== 'NT') return 13;
      if (opening && opening.call.level === 1 && response.call.level === 2 && response.call.strain !== 'NT'
        && response.call.strain !== opening.call.strain) return 10;
      return response.call.level === 1 ? 6 : 8;
    }
    if (system === 'two-over-one' && response && twoOverOne(opening, response, obs.auction)) {
      const openerRebid = us[2];
      if (openerRebid?.seat === opening.seat && openerRebid.call.level === 3 && openerRebid.call.strain === response.call.strain && major(response.call.strain)) return 15;
    }
    if (!naturalOpening) return opening.call.level === 1 ? 8 : 10;
    if (opening.call.level >= 3 && opening.call.strain !== 'NT') return 5;
    if (opening.call.level === 2 && opening.call.strain !== 'NT' && opening.call.strain !== 'C') return 5;
    if ((system === 'two-over-one' || system === 'sayc') && opening.call.level === 2 && opening.call.strain === 'C') return 22;
    if (system === 'precision' && opening.call.level === 1 && opening.call.strain === 'C') return 16;
    if (opening.call.level === 2 && opening.call.strain === 'NT') return system === 'precision' ? 22 : 20;
    if (opening.call.level === 1 && opening.call.strain === 'NT') return system === 'precision' ? 13 : 15;
    return system === 'precision' ? 11 : 12;
  };
  // Raises and Jacoby promise support points, not an equal number of HCP.
  // Their distribution allowance must not manufacture a no-trump game.
  const partnerHcpMinimum = (): number => {
    if (naturalOpening && isOpener && p && p.call.level === 3 && p.call.strain !== 'NT'
      && !major(p.call.strain) && p.call.strain === opening.call.strain
      && own.some(entry => entry.index < p.index && entry.call.level === 2 && entry.call.strain === p.call.strain))
      return 0;
    if (isOpener && p && p.call.level === 3 && major(p.call.strain)
      && own.some(entry => entry.index < p.index && entry.call.strain === p.call.strain)) return 0;
    if (naturalOpening && isOpener && response && (response.call.strain === opening.call.strain
      || (major(opening.call.strain) && response.call.level === 2 && response.call.strain === 'NT'))) return 0;
    return partnerMinimum();
  };
  const explicitFit = (): Suit | undefined => {
    const fitLengths = Object.fromEntries(SUITS.map(suit => [suit,
      lengths[suit] + partnerTrumpMinimum(suit) >= 8 ? lengths[suit] : 0])) as Record<Suit, number>;
    const established = knownFit(us, fitLengths, system, obs.seat);
    if (established && lengths[established] + partnerTrumpMinimum(established) >= 8) return established;
    if (system === 'precision' && opening?.call.level === 1 && opening.call.strain === 'C' && response && response.call.strain !== 'NT' && response.call.strain !== 'D' && lengths[response.call.strain] >= 3) return response.call.strain;
    const openerRebid = us[2];
    if (opening && response && obs.seat === responder && openerRebid?.seat === opening.seat && openerRebid.call.strain !== 'NT') {
      if (openerRebid.call.strain === opening.call.strain && major(opening.call.strain)
        && lengths[opening.call.strain] + partnerTrumpMinimum(opening.call.strain) >= 8) return opening.call.strain;
      if (openerRebid.call.strain !== opening.call.strain
        && lengths[openerRebid.call.strain] + partnerTrumpMinimum(openerRebid.call.strain) >= 8) return openerRebid.call.strain;
    }
    if (naturalOpening && (system === 'two-over-one' || system === 'sayc') && opening?.call.level === 2 && opening.call.strain === 'C' && obs.seat !== opening.seat
      && !us.some((entry, index) => index === 2 && entry.call.strain === 'NT')) {
      const openerSuit = us.find((entry, index) => index >= 2 && entry.seat === opening.seat && entry.call.strain !== 'NT');
      const openerStrain = openerSuit?.call.strain;
      if (openerStrain && openerStrain !== 'NT' && lengths[openerStrain] >= 3) return openerStrain;
    }
    return undefined;
  };

  // New-suit responses to weak two/three-level preempts retain their one-round
  // force through interference. Do not fall through to competitive Pass.
  if (naturalOpening && isOpener && response && semantics.convention === 'preempt-new-suit') {
    if (response.call.strain !== 'NT' && lengths[response.call.strain] >= 3) return pick(cheapest(response.call.strain, 5) ?? safePass());
    return pick(cheapest(opening.call.strain, 5) ?? safePass());
  }
  if (naturalOpening && system === 'sayc' && isOpener && own.length === 1 && response
    && opening.call.level === 1 && opening.call.strain !== 'NT'
    && passedBefore(obs.auction, response.seat, opening.index)
    && response.call.level === 2 && response.call.strain !== 'NT'
    && response.call.strain !== opening.call.strain && directUncontested && !gameForcing) {
    // A passed responder's two-level new suit is not a 2/1 game force, but
    // opener cannot treat its constructive values as zero and pass with extras.
    if ((hcp >= 15 && balanced) || (hcp >= 19 && SUITS.filter(suit => suit !== response.call.strain).every(hasStopper))) return pick(bid(3, 'NT'));
    if (lengths[response.call.strain] >= (major(response.call.strain) ? 3 : 4))
      return hcp >= 18 ? pick(bid(gameLevel(response.call.strain), response.call.strain))
        : hcp >= 15 ? pick(cheapest(response.call.strain, 3) ?? safePass()) : safePass();
    if (major(opening.call.strain) && lengths[opening.call.strain] >= 6)
      return pick(cheapest(opening.call.strain, 2) ?? safePass());
    const longSide = sorted.find(suit => suit !== opening.call.strain && suit !== response.call.strain
      && lengths[suit] >= 5 && cheapest(suit, 3));
    if (longSide && lengths[response.call.strain] <= 1) return pick(cheapest(longSide, 3) ?? safePass());
    if (hcp >= 15) {
      const second = sorted.find(suit => suit !== opening.call.strain && suit !== response.call.strain
        && lengths[suit] >= 4 && cheapest(suit, 3));
      if (second) return pick(cheapest(second, 3) ?? safePass());
      return pick(cheapest(opening.call.strain, 3) ?? safePass());
    }
  }

  // A new suit by an unpassed strong responder over partner's three-level
  // preempt is forcing for one round. The preempter raises with support or
  // returns to the long suit; responder may then establish that suit and use
  // RKCB with clear slam interest.
  if (system === 'sayc' && opening && opening.call.level === 3 && opening.call.strain !== 'NT') {
    if (obs.seat === responder && own.length === 0 && p?.index === opening.index && hcp >= 15) {
      const forcingSuit = sorted.find(suit => suit !== opening.call.strain && lengths[suit] >= 5 && !!cheapest(suit, 4));
      if (forcingSuit) return pick(cheapest(forcingSuit, 4) ?? safePass());
      if (balanced && hcp >= 16) return pick(bid(3, 'NT'), cheapest(opening.call.strain, 5) ?? safePass());
      if (lengths[opening.call.strain as Suit] >= 2 && hcp >= 18 && available(bid(4, 'NT'))) return bid(4, 'NT');
    }
    if (isOpener && semantics.convention === 'preempt-new-suit' && response) {
      if (lengths[response.call.strain as Suit] >= 3) return pick(cheapest(response.call.strain, 4) ?? safePass());
      return pick(cheapest(opening.call.strain, 4) ?? safePass());
    }
    if (obs.seat === responder && own.length === 1 && us.length === 3 && p?.call.level === 4
      && p.call.strain === opening.call.strain && lengths[opening.call.strain as Suit] >= 2 && hcp >= 18
      && available(bid(4, 'NT'))) return bid(4, 'NT');
  }

  // Public no-trump ranges set hard game, small-slam and grand-slam floors.
  const latestPartnerNt = [...us].reverse().find(entry => entry.seat === partnerOf(obs.seat) && entry.call.strain === 'NT');
  const latestDefinedPartnerNt = [...us].reverse().find(entry => entry.seat === partnerOf(obs.seat)
    && noTrumpRangeAt(obs.auction, entry.index, system));
  const ntRange = latestDefinedPartnerNt ? noTrumpRangeAt(obs.auction, latestDefinedPartnerNt.index, system) : undefined;
  if (ntRange && balanced) {
    const combinedMinimum = hcp + ntRange.min;
    if (combinedMinimum >= 37) return pick(bid(7, 'NT'));
    const majorSearchCompleted = us.some(entry => entry.seat === obs.seat && entry.call.strain === 'C'
      && latestPartnerNt && entry.index > us[0].index && entry.index < latestPartnerNt.index);
    if (combinedMinimum >= 31 && combinedMinimum < 33 && hcp + ntRange.max >= 33
      && ((lengths.H < 4 && lengths.S < 4) || majorSearchCompleted)) return pick(bid(4, 'NT'));
    if (combinedMinimum >= 33) return pick(bid(6, 'NT'));
    if (combinedMinimum >= 25 && lengths.H < 4 && lengths.S < 4) return pick(bid(3, 'NT'));
  }

  // Once support and at least 33 public adjusted points are known, ask for keycards instead of signing off in game.
  const slamFit = explicitFit();
  if (slamFit && fitPoints(slamFit) + partnerMinimum() >= 33
    && !us.some(entry => entry.call.level === 4 && entry.call.strain === 'NT') && available(bid(4, 'NT'))) return bid(4, 'NT');
  // Natural support points can establish game before a narrow continuation
  // chooses a minimum repeat or a false preference. Only a public eight-card
  // fit earns shortness points; an artificial answer contributes no length.
  if (p && !atGame(p.call) && own.length >= 1 && !(gameForcing && isOpener && own.length === 1)
    && semantics.convention !== 'fourth-suit'
    && semantics.convention !== 'new-minor' && semantics.convention !== 'weak-jump-inquiry'
    && !isArtificialBidAt(obs.auction, p.index, system)) {
    const fit = sorted.find(suit => major(suit) && lengths[suit] + partnerTrumpMinimum(suit) >= 8
      && us.some(entry => entry.seat === partnerOf(obs.seat) && entry.call.strain === suit
        && !isArtificialBidAt(obs.auction, entry.index, system)));
    if (fit && fitPoints(fit) + partnerMinimum() >= 25) return pick(bid(4, fit));
  }
  // Answer partner's takeout double before treating the opposing opening as an overcall.
  const partnerDouble = obs.auction.findLast((e, index) => e.seat === partnerOf(obs.seat) && isTakeoutDoubleAt(obs.auction, index));
  const partnerNegative = naturalOpening && opening.seat === obs.seat
    && obs.auction[opening.index + 1]?.call.kind === 'bid'
    && obs.auction[opening.index + 2]?.seat === partnerOf(obs.seat)
    && obs.auction[opening.index + 2]?.call.kind === 'double';
  if (partnerDouble && !p && !own.length && last.call.strain !== 'NT' && last.call.level <= 2) {
    const suit = sorted.find(s => s !== last.call.strain)!; const low = cheapest(suit, 3);
    if (hcp >= 12) return pick(cheapest(last.call.strain, 3) ?? safePass(), bid(3, 'NT'));
    if (low?.kind === 'bid' && hcp >= 9) return pick(bid(low.level + 1, suit), low);
    return pick(low ?? safePass());
  }
  if (partnerNegative && !p && own.length === 1 && opening?.seat === obs.seat && last.call.level <= 2) {
    const opponent = all.findLast(entry => sideOf(entry.seat) !== sideOf(obs.seat));
    if (opponent && major(opponent.call.strain)) {
      const other: Suit = opponent.call.strain === 'H' ? 'S' : 'H';
      if (lengths[other] >= 4) return pick(cheapest(other, 3) ?? safePass());
    }
    if (opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 6 && hcp >= 16
      && available(bid(3, opening.call.strain))) return bid(3, opening.call.strain);
    return pick(cheapest(longest, 3) ?? safePass());
  }
  // Opposing bids use natural competition. Existing game forces survive later interference.
  if (system === 'sayc' && naturalOpening && opening.call.strain === 'NT' && opening.call.level <= 2
    && p && p.call.strain !== 'NT' && semantics.convention === 'competitive-cue' && isOpener) {
    const naturalMajor = sorted.find(suit => major(suit) && lengths[suit] >= 4 && cheapest(suit, 4));
    if (naturalMajor) return pick(cheapest(naturalMajor, 4) ?? safePass());
    if (hasStopper(p.call.strain)) return pick(bid(3, 'NT'));
    return forcedFallback();
  }
  if (system === 'sayc' && naturalOpening && opening.call.strain === 'NT' && opening.call.level === 1
    && !own.length && p?.index === opening.index && last.call.strain !== 'NT'
    && sideOf(last.seat) !== sideOf(obs.seat) && last.call.level <= 3) {
    const newMajor = sorted.find(suit => major(suit) && suit !== last.call.strain && lengths[suit] >= 5);
    if (newMajor && hcp >= 10 && available(bid(3, newMajor))) return bid(3, newMajor);
    if (hcp >= 10 && (lengths.H >= 4 || lengths.S >= 4))
      return pick(cheapest(last.call.strain, 3) ?? safePass());
    if (hcp >= 10 && hasStopper(last.call.strain)) return pick(bid(3, 'NT'));
    if (newMajor && lengths[newMajor] >= 6 && hcp >= 6) return pick(cheapest(newMajor, 2) ?? safePass());
  }
  if (naturalOpening && isOpener && own.length === 1 && !directUncontested && response
    && p?.index === response.index && response.call.strain !== 'NT' && response.call.strain !== opening.call.strain
    && (semantics.convention === 'natural-response'
      || (passedBefore(obs.auction, response.seat, opening.index) && lengths[response.call.strain] <= 2))) {
    const r = response.call.strain;
    if (lengths[r] >= (response.call.level === 1 ? 4 : major(r) ? 3 : 4))
      return pick(cheapest(r, 5) ?? safePass());
    const second = sorted.find(suit => suit !== opening.call.strain && suit !== r && lengths[suit] >= 4
      && !all.some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain === suit) && cheapest(suit, 3)
      && (bidValue(bid(1, suit)) < bidValue(opening.call) || hcp >= 17));
    const enemyNatural = all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== 'NT');
    const nt = cheapest('NT', 2);
    if (balanced && nt?.kind === 'bid' && (nt.level === 1
      || hcp >= 18 && enemyNatural.every(entry => hasStopper(entry.call.strain)))) return nt;
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 5) return pick(cheapest(opening.call.strain, 3) ?? safePass());
    return forcedFallback();
  }
  // A free opposing bid may end the response's one-round obligation; it
  // does not erase opener's independently sufficient strength.
  if (system === 'sayc' && naturalOpening && isOpener && own.length === 1 && !directUncontested
    && response?.seat === partnerOf(obs.seat) && response.call.level === 1 && response.call.strain !== 'NT'
    && p?.index === response.index && hcp >= 17 && opening.call.strain !== 'NT') {
    const enemySuits = new Set(all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
      && !isArtificialBidAt(obs.auction, entry.index, system)).map(entry => entry.call.strain));
    const second = sorted.find(suit => suit !== opening.call.strain && suit !== response.call.strain
      && !enemySuits.has(suit) && lengths[suit] >= 4 && cheapest(suit, 3));
    const low = second ? cheapest(second, 3) : undefined;
    if (low?.kind === 'bid' && lengths[opening.call.strain] >= 4
      && (hcp >= 19 || bidValue(bid(1, low.strain)) > bidValue(opening.call)))
      return pick(bid(low.level === 1 && hcp >= 19 ? 2 : low.level, low.strain));
  }
  if (sideOf(last.seat) !== sideOf(obs.seat)) {
    if (gameForcing && !us.some(entry => atGame(entry.call))) return closeGame();
    const opponent = last.call; const stopped = hasStopper(opponent.strain);
    if (naturalOpening && isOpener && own.length === 1 && response?.call.level === 1
      && major(response.call.strain) && opening.call.strain !== response.call.strain
      && lengths[response.call.strain] === 3 && balanced && hcp >= 12 && opponent.level <= 2
      && response.index < last.index && !isArtificialBidAt(obs.auction, response.index, system)) {
      const support = cheapest(response.call.strain, 2);
      if (support) return support;
    }
    if (naturalOpening && isOpener && own.length === 1 && opening.call.level === 1
      && opening.call.strain !== 'NT' && hcp >= 12) {
      const enemyNatural = all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
        && !isArtificialBidAt(obs.auction, entry.index, system)).map(entry => entry.call.strain);
      const second = sorted.find(suit => suit !== opening.call.strain && suit !== response?.call.strain
        && !enemyNatural.includes(suit) && lengths[suit] >= 4 && cheapest(suit, 2)
        && bidValue(bid(1, suit)) < bidValue(opening.call));
      if (second && !balanced) return pick(cheapest(second, 2) ?? safePass());
      if (lengths[opening.call.strain] >= 6 && available(bid(2, opening.call.strain)))
        return pick(bid(hcp >= 16 ? 3 : 2, opening.call.strain));
    }
    if (naturalOpening && !isOpener && response?.seat === obs.seat && own.length >= 1
      && response.call.strain !== 'NT' && lengths[response.call.strain] >= 6 && hcp >= 6) {
      const repeat = cheapest(response.call.strain, 3);
      if (repeat) return pick(repeat);
    }
    if (naturalOpening && opening && opening.call.strain !== 'NT' && p && own.length === 0 && opening.call.level === 1 && opponent.level <= 2
      && last.index === opening.index + 1 && obs.auction.length === opening.index + 2) {
      const otherMajor = opponent.strain === 'H' ? 'S' : opponent.strain === 'S' ? 'H' : null;
      if (otherMajor && lengths[otherMajor] === 4 && hcp >= (opponent.level === 1 ? 6 : 8)) return pick({ kind: 'double' });
    }
    const artificialPartnerOpening = !!(naturalOpening && p && opening && p.index === opening.index && ((system === 'precision' && p.call.level === 1 && p.call.strain === 'C') || ((system === 'two-over-one' || system === 'sayc') && p.call.level === 2 && p.call.strain === 'C')));
    if (artificialPartnerOpening) {
      const positiveSuit = sorted.find(suit => suit !== opponent.strain && lengths[suit] >= 5);
      if (hcp >= 8 && positiveSuit) return pick(cheapest(positiveSuit, 3) ?? safePass());
      if (hcp >= 8 && balanced) return pick(cheapest('NT', 3) ?? safePass());
      return pick({ kind: 'double' }, forcedFallback());
    }
    if (naturalOpening && !isOpener && !own.length && opening.call.level === 1
      && opening.call.strain !== 'NT' && p?.index === opening.index && opponent.level === 2
      && hcp >= 13) {
      const natural = sorted.find(suit => suit !== opening.call.strain && suit !== opponent.strain
        && lengths[suit] >= 5 && cheapest(suit, 3));
      if (natural) return pick(cheapest(natural, 3) ?? safePass());
    }
    if (naturalOpening && isOpener && own.length === 1 && opening.call.strain !== 'NT'
      && major(opening.call.strain) && lengths[opening.call.strain] >= 7 && hcp >= 12
      && obs.hand.filter(card => card.suit === opening.call.strain && card.rank >= 11).length >= 3) {
      const repeat = cheapest(opening.call.strain, 3); if (repeat) return repeat;
    }
    if (p && !artificialPartnerOpening && p.call.strain !== 'NT' && lengths[p.call.strain] >= 3
      && fitPoints(p.call.strain) >= 6) {
      const ownTakeout = obs.auction.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, index));
      const forcedTakeoutResponse = ownTakeout >= 0 && p.index > ownTakeout;
      const partnerMin = forcedTakeoutResponse ? 0 : partnerMinimum();
      const total = fitPoints(p.call.strain) + partnerMin;
      const supportNeeded = major(p.call.strain) ? p.call.level === 1 && p.index !== opening?.index ? 4 : 3
        : p.index === opening?.index ? 5 : 4;
      if (lengths[p.call.strain] >= supportNeeded && total >= (major(p.call.strain) ? 25 : 29)
        && available(bid(gameLevel(p.call.strain), p.call.strain))) return bid(gameLevel(p.call.strain), p.call.strain);
      const competitiveRaise = lengths[p.call.strain] >= supportNeeded ? cheapest(p.call.strain, 3) : undefined;
      if (competitiveRaise) return competitiveRaise;
    }
    if (naturalOpening && isOpener && own.length === 1 && (!p || p.index === opening.index)) {
      const o = opening.call.strain;
      const enemyNatural = all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== 'NT');
      if (balanced && hcp >= 18 && enemyNatural.every(entry => hasStopper(entry.call.strain)))
        return pick(cheapest('NT', 3) ?? safePass());
      const second = sorted.find(suit => suit !== o && !enemyNatural.some(entry => entry.call.strain === suit)
        && lengths[suit] >= 4 && cheapest(suit, 3));
      // A strong opener retains its actual second suit after an opposing
      // takeout double; repeating six cards first would conceal these extras.
      if (second && (hcp >= 18 || (hcp >= 17 && bidValue(bid(1, second)) > bidValue(opening.call))))
        return pick(cheapest(second, 3) ?? safePass());
      if (o !== 'NT' && lengths[o] >= 6 && hcp >= 16) {
        const repeat = cheapest(o, 4); if (repeat) return repeat;
      }
      if (second && (hcp >= 18 || (hcp >= 17 && lengths[second] >= 6))) return pick(cheapest(second, 3) ?? safePass());
      if (o !== 'NT' && lengths[o] >= 5 && hcp >= 18) return pick(cheapest(o, 4) ?? safePass());
      if (balanced && hcp >= 18 && stopped) return pick(cheapest('NT', 3) ?? safePass());
    }
    const balancing = all.length === 1 && obs.auction.slice(last.index + 1).length === 2
      && obs.auction.slice(last.index + 1).every(entry => entry.call.kind === 'pass');
    const ntMinimum = balancing ? 11 : 15, ntMaximum = balancing ? 14 : 18;
    const artificialEnemy = isArtificialBidAt(obs.auction, last.index, system);
    if (!artificialEnemy && !own.length && balanced && hcp >= ntMinimum && hcp <= ntMaximum
      && stopped && available(bid(1, 'NT'))) return bid(1, 'NT');
    const enemySuits = new Set(all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)).map(entry => entry.call.strain));
    const overcallSuit = sorted.find(suit => !enemySuits.has(suit) && lengths[suit] >= 5);
    if (!own.length && overcallSuit) {
      const call = cheapest(overcallSuit, 2);
      const ranks = obs.hand.filter(card => card.suit === overcallSuit).map(card => card.rank);
      const sound = call?.kind === 'bid' && (call.level === 1 ? ranks.some(rank => rank >= 12) || ranks.length >= 6
        : ranks.filter(rank => rank >= 10).length >= 2 && ranks.some(rank => rank >= 12)
          || ranks.length >= 6 && ranks.some(rank => rank >= 13));
      if (call?.kind === 'bid' && hcp >= (call.level === 1 ? 8 : 12) && sound) return call;
    }
    const unbid = SUITS.filter(s => s !== opponent.strain);
    if (!artificialEnemy && !own.length && opponent.strain !== 'NT' && opponent.level <= 2
      && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system) === 'takeout'
      && ((hcp >= 18 && (lengths[opponent.strain] <= 2 || unbid.some(s => lengths[s] >= 5)))
        || (hcp >= 12 && lengths[opponent.strain] <= 2 && unbid.every(s => lengths[s] >= 3)))) return pick({ kind: 'double' });
    return safePass();
  }
  if (!opening || !p) return safePass();
  if (semantics.convention === 'competitive-cue' && p.call.strain !== 'NT'
    && balanced && hasStopper(p.call.strain)) return pick(cheapest('NT', 3) ?? forcedFallback());

  const responderNegativeIndex = obs.auction.findIndex((entry, index) => entry.seat === obs.seat
    && entry.call.kind === 'double' && index === opening.index + 2
    && obs.auction[opening.index + 1]?.call.kind === 'bid');
  if (naturalOpening && !isOpener && responderNegativeIndex >= 0 && !own.length && p.index > responderNegativeIndex) {
    if (p.call.strain !== 'NT' && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8
      && fitPoints(p.call.strain) + partnerMinimum() >= (major(p.call.strain) ? 25 : 29))
      return pick(bid(gameLevel(p.call.strain), p.call.strain));
    const enemyNatural = all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
      && !isArtificialBidAt(obs.auction, entry.index, system));
    if (balanced && hcp + partnerHcpMinimum() >= 25 && enemyNatural.every(entry => hasStopper(entry.call.strain)))
      return pick(bid(3, 'NT'));
    if (p.call.strain !== 'NT' && major(p.call.strain) && lengths[p.call.strain] >= 4) {
      const total = evaluateSuitFit(obs.hand, p.call.strain, 4).totalPoints + 12;
      return pick(bid(total >= 25 ? 4 : total >= 23 ? 3 : 2, p.call.strain));
    }
    const shownRange = p.call.strain === 'NT' ? noTrumpRangeAt(obs.auction, p.index, system) : undefined;
    if (shownRange && balanced) return hcp + shownRange.min >= 25 ? pick(bid(3, 'NT'))
      : hcp + shownRange.max >= 25 ? pick(bid(2, 'NT')) : safePass();
    if (p.call.strain !== 'NT' && lengths[p.call.strain] <= 1) {
      const enemySuits = new Set(all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)).map(entry => entry.call.strain));
      const escape = sorted.find(suit => !enemySuits.has(suit) && lengths[suit] >= 5 && cheapest(suit, 3));
      if (escape) return pick(cheapest(escape, 3) ?? safePass());
    }
  }

  if (semantics.convention === 'new-minor' && isOpener) {
    const respondersMajor = response && major(response.call.strain) ? response.call.strain : undefined;
    if (respondersMajor && lengths[respondersMajor] >= 3) return pick(cheapest(respondersMajor, 3) ?? safePass());
    const otherMajor = (['H', 'S'] as Suit[]).find(suit => suit !== respondersMajor && lengths[suit] >= 4);
    if (otherMajor) return pick(cheapest(otherMajor, 3) ?? safePass());
    return pick(cheapest('NT', 3) ?? safePass(), cheapest(opening.call.strain, 3) ?? safePass());
  }
  if (semantics.convention === 'fourth-suit' && isOpener) {
    const respondersSuit = response?.call.strain;
    if (respondersSuit && respondersSuit !== 'NT' && lengths[respondersSuit] >= (major(respondersSuit) ? 3 : 4)) return pick(cheapest(respondersSuit, 3) ?? safePass());
    if (hasStopper(p.call.strain)) return pick(cheapest('NT', 3) ?? safePass());
    const ownNatural = own.filter(entry => entry.call.strain !== 'NT').at(-1)?.call.strain;
    return pick(ownNatural ? cheapest(ownNatural, 3) ?? safePass() : safePass());
  }
  if (semantics.convention === 'trial-bid' && isOpener && response && major(response.call.strain) && p.call.strain !== 'NT') {
    const accept = hcp >= 14 || lengths[p.call.strain] <= 1 || hasStopper(p.call.strain);
    return pick(bid(accept ? 4 : 3, response.call.strain));
  }

  const naturalRebidRange = p.call.strain === 'NT' ? latestNoTrumpRange(obs.auction, obs.seat, system, p.index + 1) : undefined;
  const responseToNaturalOneLevel = !isOpener && own.length === 1 && opening.call.level === 1 && opening.call.strain !== 'NT' && !(system === 'precision' && opening.call.strain === 'C') && response?.seat === obs.seat && response.call.level === 1 && response.call.strain !== 'NT' && p.seat === opening.seat;
  if (responseToNaturalOneLevel && naturalRebidRange) {
    if (major(response!.call.strain) && lengths[response!.call.strain] >= 6) {
      const supported = fitPoints(response!.call.strain as Suit, 2);
      if (supported + naturalRebidRange.min >= 25) return pick(bid(4, response!.call.strain));
      if (hcp >= 10 && supported + naturalRebidRange.max >= 25) return pick(bid(3, response!.call.strain));
    }
    if (!balanced && hcp <= 9) {
      const escape = sorted.find(suit => suit !== response!.call.strain && lengths[suit] >= 5 && cheapest(suit, 2));
      if (escape) return pick(cheapest(escape, 2) ?? safePass());
      if (lengths[response!.call.strain as Suit] >= 6) return pick(cheapest(response!.call.strain, 2) ?? safePass());
    }
    if (hcp + naturalRebidRange.min >= 25) return pick(bid(3, 'NT'));
    if (hcp >= 10 || hcp + naturalRebidRange.max >= 25) return pick(bid(2, 'NT'));
    return safePass();
  }
  // Invitations after a one-over-one do not require a perfectly balanced
  // hand. Show a genuine second major or choose NT with the invitation range.
  if (system === 'sayc' && responseToNaturalOneLevel && us.length === 3
    && p.call.strain === opening.call.strain && p.call.strain !== 'NT' && p.call.level === 3
    && hcp + partnerHcpMinimum() >= 25
    && (!major(p.call.strain) || lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8)) {
    if (!major(p.call.strain)) {
      if (lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8
        && fitPoints(p.call.strain) + partnerMinimum() >= 29) return pick(bid(5, p.call.strain));
      return pick(bid(3, 'NT'));
    }
    if (balanced) return pick(bid(3, 'NT'));
    const side = sorted.find(suit => suit !== response!.call.strain && suit !== p.call.strain
      && lengths[suit] >= 4 && cheapest(suit, 3));
    if (side) return pick(cheapest(side, 3) ?? safePass());
    return pick(bid(3, 'NT'));
  }
  if (system === 'sayc' && responseToNaturalOneLevel && us.length === 3
    && p.call.strain === opening.call.strain && p.call.strain !== 'NT' && hcp >= 10 && hcp <= 12) {
    const second = sorted.find(suit => suit !== response!.call.strain && suit !== opening.call.strain
      && lengths[suit] >= 4 && cheapest(suit, 3));
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (lengths[response!.call.strain as Suit] >= 6) return pick(bid(3, response!.call.strain));
    if (available(bid(2, 'NT'))) return bid(2, 'NT');
  }

  const strongRebidNT = opening && us[2]?.call.strain === 'NT' && ((system === 'two-over-one' || system === 'sayc') && opening.call.level === 2 && opening.call.strain === 'C' || system === 'precision' && opening.call.level === 1 && opening.call.strain === 'C' && response?.call.strain === 'D' && response.call.level === 1);
  const ntOpening = opening?.call.strain === 'NT' ? opening : strongRebidNT ? us[2] : undefined;
  const ntUs = ntOpening ? us.slice(us.indexOf(ntOpening)) : [];
  const ntResponse = ntUs[1];
  if (naturalOpening && directUncontested && system === 'sayc' && ntOpening?.call.level === 3) {
    if (obs.seat === responder && ntUs.length === 1) {
      if (openingMajor) return pick(bid(4, openingMajor === 'H' ? 'D' : 'H'));
      if (lengths.H >= 4 || lengths.S >= 4) return pick(bid(4, 'C'));
      return safePass();
    }
    if (isOpener && ntUs.length === 2) {
      if (p.call.level === 4 && p.call.strain === 'C') return pick(bid(4, lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D'));
      if (p.call.level === 4 && (p.call.strain === 'D' || p.call.strain === 'H')) return pick(bid(4, p.call.strain === 'D' ? 'H' : 'S'));
    }
  }
  const ntQuestionsOnlyDoubled = !!ntOpening && obs.auction.slice(ntOpening.index + 1).every((entry, offset) =>
    sideOf(entry.seat) === sideOf(obs.seat) || entry.call.kind === 'pass'
    || entry.call.kind === 'double' && isArtificialBidAt(obs.auction, ntOpening.index + offset, system));
  if (naturalOpening && (directUncontested || ntQuestionsOnlyDoubled) && ntOpening && ntOpening.call.level <= 2) {
    const [minimum, maximum] = strongRebidNT ? system === 'precision' ? ntOpening.call.level === 1 ? [16, 18] : [19, 21] : [22, 24] : range(ntOpening.call);
    const base = ntOpening.call.level + 1;
    const invite = Math.max(0, 23 - minimum); const gamePoints = Math.max(0, 25 - minimum);
    if (obs.seat === responder && ntUs.length === 1) {
      if (openingMajor) return pick(bid(base, openingMajor === 'H' ? 'D' : 'H'));
      const staymanPoints = ntOpening.call.level === 2 ? gamePoints : invite;
      if ((lengths.H >= 4 || lengths.S >= 4) && hcp >= staymanPoints) return pick(bid(base, 'C'));
      if (hcp >= gamePoints) return pick(bid(3, 'NT'));
      if (ntOpening.call.level === 1 && hcp >= invite) return pick(bid(2, 'NT'));
      return safePass();
    }
    if (isOpener && ntUs.length === 2) {
      if (p.call.strain === 'C' && p.call.level === base) return pick(bid(base, lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D'));
      if (p.call.level === base && (p.call.strain === 'D' || p.call.strain === 'H')) return pick(bid(base, p.call.strain === 'D' ? 'H' : 'S'));
      if (p.call.strain === 'NT' && p.call.level === 2) return hcp >= Math.ceil((minimum + maximum) / 2) ? pick(bid(3, 'NT')) : safePass();
      return safePass();
    }
    if (obs.seat === responder && ntUs.length === 3 && ntResponse) {
      if (ntResponse.call.level === base && (ntResponse.call.strain === 'D' || ntResponse.call.strain === 'H')) {
        const target: Suit = ntResponse.call.strain === 'D' ? 'H' : 'S';
        const fit = lengths[target] + partnerTrumpMinimum(target) >= 8;
        const support = fitPoints(target);
        const secondMajor: Suit = target === 'H' ? 'S' : 'H';
        if (hcp >= gamePoints && lengths[secondMajor] >= 5 && available(bid(3, secondMajor))) return bid(3, secondMajor);
        if (fit && support + minimum >= 25) return pick(bid(4, target));
        if (hcp >= gamePoints) return pick(bid(3, 'NT'));
        if (hcp >= invite || fit && support + maximum >= 25)
          return fit ? pick(bid(3, target)) : pick(bid(2, 'NT'));
        return safePass();
      }
      if (ntResponse.call.strain === 'C' && ntResponse.call.level === base) {
        if (major(p.call.strain) && lengths[p.call.strain] >= 4)
          return pick(bid(fitPoints(p.call.strain, 4) + minimum >= 25 ? 4 : 3, p.call.strain));
        const otherMajor = (['H', 'S'] as Suit[]).find(suit => suit !== p.call.strain && lengths[suit] >= 4
          && cheapest(suit, 3));
        if (otherMajor && hcp < gamePoints) return pick(cheapest(otherMajor, 3) ?? safePass());
        return hcp >= gamePoints ? pick(bid(3, 'NT')) : ntOpening.call.level === 1 ? pick(bid(2, 'NT')) : safePass();
      }
    }
    if (isOpener && ntUs.length >= 4 && ntResponse) {
      const target = ntResponse.call.strain === 'D' ? 'H' : ntResponse.call.strain === 'H' ? 'S' : null;
      if (ntResponse.call.strain === 'C' && p.call.level === 2 && major(p.call.strain)
        && lengths[p.call.strain] >= 4) return fitPoints(p.call.strain, 4) + invite >= 25
          ? pick(bid(4, p.call.strain)) : pick(bid(3, p.call.strain));
      if (p.call.strain === 'NT' && p.call.level === 3 && target && lengths[target] >= 3) return pick(bid(4, target));
      if (p.call.strain === 'NT' && p.call.level === 2) {
        if (target && lengths[target] >= 3 && fitPoints(target, 5) + invite >= 25) return pick(bid(4, target));
        return hcp + invite >= 25 ? pick(bid(3, 'NT')) : safePass();
      }
      if (major(p.call.strain) && p.call.level === 3) {
        const promised = ntResponse.call.strain === 'C' ? 4 : 6;
        return lengths[p.call.strain] + promised >= 8 && fitPoints(p.call.strain, promised) + invite >= 25
          ? pick(bid(4, p.call.strain)) : safePass();
      }
      return safePass();
    }
  }

  if (naturalOpening && directUncontested && system === 'precision' && opening.call.level === 1 && opening.call.strain === 'C') {
    if (obs.seat === responder && !own.length) {
      if (hcp <= 7) return pick(bid(1, 'D'));
      if (openingMajor) return pick(bid(1, openingMajor));
      if (lengths[longest] >= 5) return pick(bid(2, longest));
      return pick(bid(hcp >= 14 ? 2 : 1, 'NT'));
    }
    if (isOpener && us.length === 2 && response) {
      const negative = response.call.strain === 'D' && response.call.level === 1;
      if (negative) {
        if (balanced) return pick(bid(hcp >= 24 ? 3 : hcp >= 19 ? 2 : 1, 'NT'));
        const suit = openingMajor ?? sorted.find(s => major(s) && lengths[s] >= 4) ?? longest;
        return pick(cheapest(suit, 3) ?? safePass());
      }
      if (response.call.strain !== 'NT' && lengths[response.call.strain] >= (major(response.call.strain) ? 3 : 4)) return pick(bid(gameLevel(response.call.strain), response.call.strain), bid(3, 'NT'));
      if (!balanced && openingMajor) return pick(cheapest(openingMajor, 3) ?? bid(3, 'NT'));
      return pick(bid(3, 'NT'));
    }
    if (obs.seat === responder && us.length === 3 && response?.call.strain === 'D' && response.call.level === 1) {
      if (p.call.strain === 'NT') return p.call.level === 2 && hcp >= 6 ? pick(bid(3, 'NT')) : p.call.level === 1 && hcp >= 7 ? pick(bid(2, 'NT')) : safePass();
      if (major(p.call.strain) && lengths[p.call.strain] >= 3 && hcp >= 5) return pick(bid(2, p.call.strain));
      if (hcp >= 5 && lengths.S >= 4 && available(bid(1, 'S'))) return bid(1, 'S');
      return hcp >= 5 ? pick(bid(1, 'NT')) : safePass();
    }
  }

  if (quietStrongClub && opening.call.level === 2 && opening.call.strain === 'C' && (system === 'two-over-one' || system === 'sayc')) {
    if (obs.seat === responder && !own.length) return pick(bid(2, 'D'));
    if (isOpener && us.length === 2) {
      if (balanced) return pick(bid(hcp >= 25 ? 3 : 2, 'NT'));
      if (lengths[longest] === 4) return pick(bid(3, minor));
      return pick(cheapest(longest, 3) ?? safePass());
    }
    if (obs.seat === responder && us.length === 3) {
      if (p.call.strain === 'NT') {
        if (p.call.level === 2 && openingMajor) return pick(bid(3, openingMajor === 'H' ? 'D' : 'H'));
        if (p.call.level === 2 && (lengths.H >= 4 || lengths.S >= 4) && hcp >= 3) return pick(bid(3, 'C'));
        return hcp >= 3 ? pick(bid(3, 'NT')) : safePass();
      }
      if (system === 'sayc' && hcp <= 3) {
        const negative = p.call.strain === 'C' ? bid(3, 'D') : p.call.strain === 'D' ? bid(3, 'NT') : bid(3, 'C');
        return pick(negative);
      }
      if (lengths[p.call.strain] >= (major(p.call.strain) ? 3 : 4)) return pick(bid(gameLevel(p.call.strain), p.call.strain));
      if (system === 'sayc' && hcp >= 4) {
        const positive = sorted.find(suit => suit !== p.call.strain && lengths[suit] >= 5 && cheapest(suit, 4));
        if (positive) {
          const low = cheapest(positive, 4);
          const reservedNegative = major(p.call.strain) ? 'C' : p.call.strain === 'C' ? 'D' : 'NT';
          if (low?.kind === 'bid' && low.level === 3 && low.strain === reservedNegative)
            return pick(bid(4, positive));
          return pick(low ?? safePass());
        }
      }
      if (hcp <= 3) return pick(bid(3, 'C'));
      return pick(bid(3, 'NT'));
    }
    if (system === 'sayc' && isOpener && us.length === 4 && hcp <= 26
      && ((us[2].call.strain === 'C' && p.call.level === 3 && p.call.strain === 'D')
        || (us[2].call.strain === 'D' && p.call.level === 3 && p.call.strain === 'NT')))
      return pick(cheapest(us[2].call.strain, 5) ?? safePass());
    if (isOpener && p.call.level === 3 && p.call.strain === 'C' && own.at(-1)?.call.strain === 'NT') return pick(bid(3, lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D'));
    if (isOpener && p.call.level === 3 && (p.call.strain === 'D' || p.call.strain === 'H') && own.at(-1)?.call.strain === 'NT') return pick(bid(3, p.call.strain === 'D' ? 'H' : 'S'));
    if (isOpener && p.call.level === 3 && p.call.strain === 'C' && own.at(-1)?.call.strain !== 'NT') {
      if (hcp >= 25) {
        const second = sorted.find(suit => suit !== own.at(-1)!.call.strain && lengths[suit] >= 4 && cheapest(suit, 4));
        if (second) return pick(cheapest(second, 4) ?? safePass());
        return pick(bid(4, own.at(-1)!.call.strain), bid(3, 'NT'));
      }
      return pick(cheapest(own.at(-1)!.call.strain, 4) ?? bid(3, 'NT'));
    }
  }

  if (naturalOpening && directUncontested && system === 'precision' && opening.call.level === 2 && (opening.call.strain === 'C' || opening.call.strain === 'D')) {
    const clubs = opening.call.strain === 'C'; const ask = clubs ? bid(2, 'D') : bid(2, 'NT');
    if (obs.seat === responder && !own.length) {
      if (hcp >= 11) return pick(ask);
      if (clubs && lengths.C >= 3 && hcp >= 6) return pick(bid(3, 'C'));
      if (!clubs) { const suit = lengths.S >= lengths.H ? 'S' : 'H'; if (lengths[suit] >= 4) return pick(bid(2, suit)); }
      return safePass();
    }
    if (isOpener && us.length === 2 && sameCall(response.call, ask)) {
      if (clubs) return lengths.H >= 4 ? pick(bid(2, 'H')) : lengths.S >= 4 ? pick(bid(2, 'S')) : hcp >= 14 ? pick(bid(2, 'NT')) : pick(bid(3, 'C'));
      return pick(bid(3, lengths.D === 0 ? 'D' : lengths.H === 3 ? 'H' : lengths.S === 3 ? 'S' : 'C'));
    }
    if (obs.seat === responder && us.length === 3 && sameCall(response.call, ask)) {
      const shownMajor = clubs ? major(p.call.strain) ? p.call.strain : null : lengths.S >= 4 && p.call.strain !== 'S' ? 'S' : lengths.H >= 4 && p.call.strain !== 'H' ? 'H' : null;
      if (shownMajor && lengths[shownMajor] >= 4) return pick(bid(hcp >= 14 ? 4 : 3, shownMajor));
      return clubs && hcp < 14 ? pick(bid(3, 'C'), bid(3, 'NT')) : pick(bid(3, 'NT'), bid(4, 'C'));
    }
  }

  // Weak two: natural support and a simple feature ask, with no Ogust inference.
  if (naturalOpening && directUncontested && opening.call.level === 2 && opening.call.strain !== 'NT' && (system === 'precision' ? major(opening.call.strain) : opening.call.strain !== 'C')) {
    if (obs.seat === responder && !own.length) {
      const supportTotal = fitPoints(opening.call.strain, 6);
      if (lengths[opening.call.strain] >= 2 && supportTotal + 5 >= (major(opening.call.strain) ? 25 : 29))
        return pick(bid(gameLevel(opening.call.strain), opening.call.strain));
      if (system === 'sayc') {
        const forcingSuit = sorted.find(suit => suit !== opening.call.strain && lengths[suit] >= 5 && hcp >= 13 && cheapest(suit, 3));
        if (forcingSuit) return pick(cheapest(forcingSuit, 3) ?? safePass());
      }
      if (hcp >= 15) return pick(bid(2, 'NT'));
      if (lengths[opening.call.strain] >= 3 && supportTotal >= 6) return pick(bid(3, opening.call.strain));
      return safePass();
    }
    if (system === 'sayc' && isOpener && us.length === 2 && response && response.call.strain !== 'NT' && response.call.strain !== opening.call.strain) {
      if (lengths[response.call.strain] >= 3) return pick(cheapest(response.call.strain, 4) ?? safePass());
      if (hcp <= 8) return pick(bid(3, opening.call.strain));
      const feature = sorted.find(s => s !== opening.call.strain && s !== response.call.strain && obs.hand.some(c => c.suit === s && c.rank >= 13));
      return feature ? pick(cheapest(feature, 4) ?? bid(3, opening.call.strain)) : pick(cheapest('NT', 3) ?? bid(3, opening.call.strain));
    }
    if (isOpener && p.call.strain === 'NT' && p.call.level === 2) {
      if (hcp >= (system === 'sayc' ? 9 : 8)) { const feature = sorted.find(s => s !== opening.call.strain && obs.hand.some(c => c.suit === s && c.rank >= 13)); if (feature) return pick(bid(3, feature), bid(3, opening.call.strain)); }
      return pick(bid(3, opening.call.strain));
    }
    if (obs.seat === responder && response?.call.strain === 'NT' && response.call.level === 2 && us.length === 3) {
      const publicMinimum = p.call.strain === opening.call.strain ? 5 : 9;
      if (lengths[opening.call.strain] + 6 >= 8
        && fitPoints(opening.call.strain, 6) + publicMinimum >= (major(opening.call.strain) ? 25 : 29))
        return pick(bid(gameLevel(opening.call.strain), opening.call.strain));
      if (balanced && hcp + publicMinimum >= 25) return pick(bid(3, 'NT'));
      return pick(cheapest(opening.call.strain, 3) ?? safePass());
    }
    if (system === 'sayc' && obs.seat === responder && response?.call.strain !== 'NT'
      && response?.call.strain !== opening.call.strain && us.length >= 3 && hcp >= 19) {
      if (lengths[opening.call.strain] >= 2) return pick(bid(gameLevel(opening.call.strain), opening.call.strain));
      if (balanced) return pick(bid(3, 'NT'));
      const selfMajor = sorted.find(suit => major(suit) && lengths[suit] >= 6 && available(bid(4, suit)));
      if (selfMajor) return pick(bid(4, selfMajor));
      if (SUITS.filter(suit => suit !== opening.call.strain).every(hasStopper)) return pick(bid(3, 'NT'));
      const sideSuit = sorted.find(suit => suit !== opening.call.strain && suit !== response.call.strain
        && lengths[suit] >= 4 && cheapest(suit, 4));
      if (sideSuit) return pick(cheapest(sideSuit, 4) ?? safePass());
      return pick(cheapest(response.call.strain, 3) ?? safePass());
    }
    if (system === 'sayc' && obs.seat === responder && response?.call.strain !== 'NT'
      && response?.call.strain !== opening.call.strain && us.length === 3
      && p.call.strain === opening.call.strain && lengths[opening.call.strain] <= 1
      && lengths[response.call.strain] >= 6 && hcp >= 13)
      return pick(cheapest(response.call.strain, 3) ?? safePass());
    return safePass();
  }
  if (system === 'sayc' && naturalOpening && opening.call.level === 3
    && obs.seat === responder && response?.call.strain !== 'NT' && response?.call.strain !== opening.call.strain
    && own.length === 1 && us.length === 3 && hcp >= 15 && major(response.call.strain)
    && lengths[response.call.strain] >= 6 && available(bid(4, response.call.strain)))
    return bid(4, response.call.strain);
  if (atGame(last.call)) return safePass();
  if (system === 'sayc' && naturalOpening && isOpener && own.length === 1 && p.call.level === 2
    && opening.call.strain !== 'NT' && !major(opening.call.strain) && p.call.strain === opening.call.strain
    && hcp >= 16 && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8)
    return pick(bid(fitPoints(p.call.strain) + partnerMinimum() >= 29 ? 5 : 3, p.call.strain));
  if (system === 'sayc' && naturalOpening && isOpener && own.length >= 2 && p.call.level === 3
    && p.call.strain !== 'NT' && p.call.strain !== opening.call.strain
    && hcp + partnerHcpMinimum() >= 25 && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8) {
    const side = sorted.find(suit => suit !== p.call.strain && lengths[suit] >= 4 && cheapest(suit, 4));
    return pick(bid(3, 'NT'), side ? cheapest(side, 4) ?? safePass() : safePass());
  }
  // A natural NT rebid or invitation has a public range even when an
  // earlier intervention or a nonbalanced response preceded it.
  if (system === 'sayc' && naturalOpening && p.call.strain === 'NT' && p.call.level === 2
    && opening.call.level === 1 && opening.call.strain !== 'NT' && own.length >= 1) {
    if (!isOpener && response?.call.strain !== 'NT' && major(response!.call.strain)
      && lengths[response!.call.strain] >= 6 && fitPoints(response!.call.strain as Suit, 2) + partnerMinimum() >= 25)
      return pick(bid(4, response!.call.strain));
    if (hcp + partnerHcpMinimum() >= 25) return pick(bid(3, 'NT'));
  }
  if (system === 'sayc' && naturalOpening && isOpener && own.length >= 2
    && p.call.strain !== 'NT' && !gameForcing && lengths[p.call.strain] <= 1
    && opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 6)
    return pick(cheapest(opening.call.strain, 3) ?? safePass());
  if (system === 'sayc' && naturalOpening && isOpener && own.length >= 2 && p.call.strain !== 'NT'
    && !gameForcing && hcp >= 17 && !atGame(p.call)) {
    if (balanced) return pick(cheapest('NT', 3) ?? safePass());
    const second = sorted.find(suit => suit !== opening.call.strain && suit !== p.call.strain
      && lengths[suit] >= 4 && cheapest(suit, 3));
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8)
      return pick(cheapest('NT', 3) ?? safePass());
  }
  if (system === 'sayc' && naturalOpening && isOpener && own.length === 1 && response
    && response.call.level === 2 && response.call.strain !== 'NT' && !gameForcing
    && opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 6
    && lengths[response.call.strain] <= 2)
    return pick(cheapest(opening.call.strain, 3) ?? safePass());
  if (system === 'sayc' && naturalOpening && !gameForcing && obs.seat === responder && own.length === 1
    && response?.call.level === 2 && response.call.strain !== 'NT'
    && p.call.strain !== 'NT' && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8) {
    const enemies = all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== 'NT'
      && !isArtificialBidAt(obs.auction, entry.index, system));
    if (hcp >= 13) {
      if (enemies.every(entry => hasStopper(entry.call.strain))) return pick(bid(3, 'NT'));
      const cue = enemies.findLast(entry => cheapest(entry.call.strain, 3));
      if (cue) return pick(cheapest(cue.call.strain, 3) ?? safePass());
    }
    if (lengths[response.call.strain] >= 6 && lengths[p.call.strain] <= 2)
      return pick(cheapest(response.call.strain, 3) ?? safePass());
    if (hcp >= 10) return pick(bid(2, 'NT'), cheapest(response.call.strain, 3) ?? safePass());
  }
  if (naturalOpening && !gameForcing && response?.call.level === 1 && major(response.call.strain)
    && opening.call.strain !== response.call.strain && us[2]?.call.level === 2
    && us[2].call.strain === response.call.strain) {
    const trump = response.call.strain;
    if (obs.seat === responder && us.length === 3 && fitPoints(trump, 4) >= 10)
      return pick(bid(fitPoints(trump, 4) + partnerMinimum() >= 25 ? 4 : 3, trump));
    if (isOpener && us.length === 4 && p.call.level === 3 && p.call.strain === trump
      && fitPoints(trump, 4) >= 15) return pick(bid(4, trump));
  }
  if (system === 'sayc' && naturalOpening && !directUncontested && p?.call.strain !== 'NT'
    && !all.some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain === p.call.strain)) {
    const trump = p.call.strain;
    const partnerMin = isOpener && obs.auction.some(entry => entry.seat === partnerOf(obs.seat)
      && entry.call.kind === 'redouble') ? 10 : partnerMinimum();
    if (lengths[trump] + partnerTrumpMinimum(trump) >= 8
      && fitPoints(trump) + partnerMin >= (major(trump) ? 25 : 29)) return pick(bid(gameLevel(trump), trump));
  }
  if (gameForcing && (system === 'two-over-one' || system === 'sayc') && isOpener && own.length === 1) {
    if (p.call.strain !== 'NT' && lengths[p.call.strain] >= (major(p.call.strain) ? 3 : 4)) {
      if (major(p.call.strain)) return hcp <= 14 ? pick(bid(4, p.call.strain)) : pick(bid(3, p.call.strain));
      if (balanced) return pick(bid(2, 'NT'));
      return pick(cheapest(p.call.strain, 3) ?? safePass());
    }
    if (balanced) return pick(bid(2, 'NT'));
    if (lengths[opening.call.strain as Suit] >= 6) return pick(cheapest(opening.call.strain, 3) ?? safePass());
    const second = sorted.find(suit => suit !== opening.call.strain && suit !== p.call.strain && lengths[suit] >= 4 && cheapest(suit, 3));
    if (second) return pick(cheapest(second, 3) ?? safePass());
    if (lengths[opening.call.strain as Suit] >= 5) return pick(cheapest(opening.call.strain, 3) ?? safePass());
    return forcedFallback();
  }
  if (gameForcing && system === 'sayc' && !isOpener && us.length === 3 && response?.call.level === 1
    && response.call.strain === 'NT' && semantics.convention === 'opener-jump-shift') {
    const longMajor = sorted.find(suit => major(suit) && lengths[suit] >= 6 && suit !== opening.call.strain
      && suit !== p?.call.strain && cheapest(suit, 3));
    if (longMajor) return pick(cheapest(longMajor, 3) ?? safePass());
  }
  if (gameForcing) return closeGame();
  if (system === 'sayc' && naturalOpening && !isOpener && own.length === 2 && us.length === 5
    && own[1].call.strain !== 'NT' && isArtificialBidAt(obs.auction, own[1].index, system)
    && new Set(us.slice(0, 4).map(entry => entry.call.strain)).size === 4 && hcp >= 13)
    return closeGame();
  if (system === 'sayc' && naturalOpening && !directUncontested && isOpener && own.length === 1
    && response && response.call.strain !== 'NT' && response.call.strain !== opening.call.strain
    && opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 6 && hcp >= 16
    && available(bid(3, opening.call.strain))) return bid(3, opening.call.strain);
  // The same natural responder continuations apply when an earlier enemy
  // intervention has ended. Do not route every such auction into Pass.
  const naturalResponderContinuation = !!(naturalOpening && responseToNaturalOneLevel && us.length >= 3 && us.length <= 5);
  if ((!naturalOpening || !directUncontested) && !naturalResponderContinuation) {
    if (system === 'sayc') {
      // Competitive sequences retain their own public ranges. Do not hand an
      // unrecognized auction to the old HCP-only engine.
      if (semantics.forcing === 'game') return closeGame();
      if (semantics.mustBid) return forcedFallback();
      return PASS;
    }
    const fallback = legacyBid(obs);
    return semantics.mustBid && fallback.kind === 'pass' ? forcedFallback() : fallback;
  }

  if (!own.length && obs.seat === responder && opening.call.level === 1) {
    const o = opening.call;
    if (major(o.strain)) {
      const supportTotal = fitPoints(o.strain, 5);
      if (lengths[o.strain] >= 4 && supportTotal >= (system === 'precision' ? 14 : 13)) return pick(bid(2, 'NT'));
      if (o.strain === 'H' && lengths.S >= 4 && hcp >= 6) return pick(bid(1, 'S'));
      if (lengths[o.strain] >= 3 && supportTotal >= 6) {
        if (supportTotal >= 13 && system === 'precision') return pick(bid(4, o.strain));
        if (supportTotal <= 12) return pick(bid(supportTotal >= 10 ? 3 : 2, o.strain));
      }
      const responderPassed = passedBefore(obs.auction, obs.seat, opening.index);
      if (system === 'sayc' && responderPassed && hcp >= 10) {
        const longSuit = sorted.find(s => s !== o.strain && lengths[s] >= 5 && available(bid(2, s)));
        if (longSuit) return bid(2, longSuit);
        if (balanced && lengths[o.strain] <= 2) {
          if (hcp >= 16 && hcp <= 18) return pick(bid(3, 'NT'));
        }
        const suit = sorted.find(s => s !== o.strain && lengths[s] >= 4 && available(bid(2, s)));
        if (suit) return bid(2, suit);
      }
      if ((system === 'two-over-one' || system === 'sayc') && hcp >= 13 && !responderPassed) {
        const suit = (['H', 'D', 'C'] as Suit[]).find(s => s !== o.strain && lengths[s] >= (s === 'H' ? 5 : s === 'D' ? 4 : 3) && available(bid(2, s)));
        if (suit) return bid(2, suit);
      }
      if (system === 'precision' && hcp >= 10) { const suit = sorted.find(s => s !== o.strain && lengths[s] >= 4 && available(bid(2, s))); if (suit) return bid(2, suit); }
      if (supportTotal >= 13 && lengths[o.strain] >= 3) return pick(bid(4, o.strain));
      return hcp >= (system === 'sayc' ? 5 : 6) ? pick(bid(1, 'NT')) : safePass();
    }
    const newMajor = naturalMajorOrder.find(s => lengths[s] >= 4 && available(bid(1, s)));
    if (newMajor && hcp >= 6) return bid(1, newMajor);
    if (o.strain === 'C' && lengths.D >= 4 && hcp >= 6) return pick(bid(1, 'D'));
    if (system === 'sayc' && balanced && hcp >= 11 && hcp <= 15)
      return pick(bid(hcp >= 13 ? 3 : 2, 'NT'));
    const twoOneThreshold = (system === 'two-over-one' || system === 'sayc')
      && !passedBefore(obs.auction, obs.seat, opening.index) ? 13 : 10;
    if (o.strain === 'D' && lengths.C >= (system === 'two-over-one' ? 3 : 4) && hcp >= twoOneThreshold) return pick(bid(2, 'C'));
    // Balanced 11-12 invites; 13+ places game when no one-level major or
    // genuine new-suit game force is available. Minor support is not HCP.
    if (system === 'sayc' && balanced && hcp >= 13) return pick(bid(3, 'NT'));
    if (system === 'sayc' && balanced && hcp >= 11) return pick(bid(2, 'NT'));
    if (system !== 'sayc' && balanced && hcp >= 13) return pick(bid(3, 'NT'));
    if (system !== 'sayc' && balanced && hcp >= 11) return pick(bid(2, 'NT'));
    if (lengths[o.strain as Suit] >= 5) {
      const partnerLength = system === 'precision' && o.strain === 'D' ? 2 : 3;
      const supportTotal = fitPoints(o.strain as Suit, partnerLength);
      if (supportTotal >= 6) return pick(bid(supportTotal >= 10 ? 3 : 2, o.strain));
    }
    return hcp >= 6 ? pick(bid(1, 'NT')) : safePass();
  }
  // Jacoby 2NT over an uncontested major: shortness, extras, or minimum game.
  if (major(opening.call.strain) && response?.call.strain === 'NT' && response.call.level === 2) {
    if (isOpener && own.length === 1) {
      const short = sorted.find(s => s !== opening.call.strain && lengths[s] <= 1);
      if (short) return pick(bid(3, short));
      return pick(bid(hcp >= 18 ? 3 : 4, opening.call.strain));
    }
    if (obs.seat === responder) return pick(bid(4, opening.call.strain));
  }
  // The 11-12 balanced invitation is accepted from the opener's own HCP.
  if (system === 'sayc' && isOpener && (opening.call.strain === 'C' || opening.call.strain === 'D')
    && response?.call.level === 2 && response.call.strain === 'NT' && own.length === 1) {
    return hcp >= 14 ? pick(bid(3, 'NT')) : safePass();
  }
  // A balanced 18-19 opener rebids 2NT after a natural 1NT response. Passing
  // would conceal the upper range and can lose a game opposite 6-7 HCP.
  if (system === 'sayc' && isOpener && opening.call.level === 1 && opening.call.strain !== 'NT'
    && response?.call.level === 1 && response.call.strain === 'NT' && own.length === 1
    && balanced && hcp >= 18) return pick(bid(2, 'NT'));
  if (system === 'sayc' && isOpener && opening.call.level === 1 && !major(opening.call.strain)
    && opening.call.strain !== 'NT' && response?.call.level === 1 && response.call.strain === 'NT'
    && own.length === 1 && hcp >= 17 && !balanced) {
    const second = sorted.find(suit => suit !== opening.call.strain && lengths[suit] >= 4
      && cheapest(suit, 2));
    if (second) return pick(cheapest(second, 2) ?? safePass());
    if (lengths[opening.call.strain] >= 6) return pick(bid(3, opening.call.strain));
    if (hcp >= 19 && SUITS.filter(suit => suit !== opening.call.strain).every(hasStopper)) return pick(bid(3, 'NT'));
    return pick(cheapest(opening.call.strain, 2) ?? safePass());
  }
  if (system === 'sayc' && isOpener && opening.call.level === 1 && opening.call.strain !== 'NT'
    && !major(opening.call.strain) && response?.call.level === 1 && response.call.strain === 'NT'
    && own.length === 1 && !balanced && lengths[opening.call.strain] >= 6)
    return pick(bid(hcp >= 16 ? 3 : 2, opening.call.strain));
  // SAYC+2/1 1M-1NT is 5-12 semi-forcing. A minimum balanced opener may pass,
  // but a minimum or intermediate unbalanced
  // opener still describes a real four-card side suit instead of concealing a
  // 5-4 shape. With no side suit, a six-card major is the natural rebid.
  if (isOpener && system === 'sayc' && major(opening.call.strain)
    && response?.call.level === 1 && response.call.strain === 'NT' && own.length === 1) {
    const second = sorted.find(s => s !== opening.call.strain && lengths[s] >= 4 && available(bid(2, s))
      && (bidValue(bid(1, s)) < bidValue(opening.call) || hcp >= 17));
    if (hcp >= 19 && second && available(bid(3, second))) return bid(3, second);
    if (lengths[opening.call.strain] >= 6 && hcp >= 16
      && !(second && bidValue(bid(1, second)) > bidValue(opening.call)))
      return pick(bid(hcp >= 19 ? 4 : 3, opening.call.strain));
    if (second) return bid(2, second);
    if (lengths[opening.call.strain] >= 6) return pick(bid(2, opening.call.strain));
    // A 4S-5H hand below reverse strength cannot rebid 2S. Its minor rebid
    // may be a three-card suit after the wide semi-forcing 1NT response.
    if (!balanced) {
      const lowerMinor = (['C', 'D'] as Suit[]).filter(s => lengths[s] >= 3 && available(bid(2, s)))
        .sort((a, b) => lengths[b] - lengths[a])[0];
      if (lowerMinor) return bid(2, lowerMinor);
      if (lengths[opening.call.strain] >= 5) return pick(bid(2, opening.call.strain));
    }
    return safePass();
  }
  // Force an opener rebid after an unpassed 1M–1NT. Choose the cheapest real side suit.
  if (isOpener && system === 'two-over-one' && major(opening.call.strain) && response?.call.strain === 'NT' && response.call.level === 1 && !passedBefore(obs.auction, response.seat, opening.index) && own.length === 1) {
    if (balanced && hcp >= 18) return pick(bid(2, 'NT'));
    const second = sorted.find(s => s !== opening.call.strain && lengths[s] >= 4 && available(bid(2, s))
      && (bidValue(bid(1, s)) < bidValue(opening.call) || hcp >= 17));
    if (second) return bid(2, second);
    if (lengths[opening.call.strain] >= 6) return pick(bid(2, opening.call.strain));
    const lower = (['C', 'D'] as Suit[]).find(s => lengths[s] >= 3 && available(bid(2, s)));
    return pick(bid(2, lower ?? 'C'));
  }
  // After 1M-1NT and opener's natural rebid, responder must choose the safest
  // partscore instead of passing a singleton second suit. A two-card return to
  // opener's known five-card major is the standard false preference.
  if (obs.seat === responder && major(opening.call.strain) && response?.seat === obs.seat
    && response.call.level === 1 && response.call.strain === 'NT' && own.length === 1 && us.length === 3) {
    const openerRebid = p.call;
    if (openerRebid.strain === 'NT') {
      const publicNt = noTrumpRangeAt(obs.auction, p.index, system);
      if (hcp + (publicNt?.min ?? 18) >= 25 && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (hcp >= 8 && available(bid(2, 'NT'))) return bid(2, 'NT');
      return safePass();
    }
    if (openerRebid.strain === opening.call.strain) {
      const combinedTrumps = lengths[opening.call.strain] + partnerTrumpMinimum(opening.call.strain);
      if (combinedTrumps >= 8 && fitPoints(opening.call.strain) + partnerMinimum() >= 25)
        return pick(bid(4, opening.call.strain));
      if (combinedTrumps >= 8 && fitPoints(opening.call.strain) >= 10)
        return pick(bid(fitPoints(opening.call.strain) + partnerMinimum() >= 25 ? 4 : 3, opening.call.strain));
      const ownLong = sorted.find(suit => suit !== opening.call.strain && lengths[suit] >= 6 && cheapest(suit, 3));
      if (hcp >= 10 && ownLong) return pick(bid(3, ownLong));
      if (hcp >= 10 && available(bid(2, 'NT'))) return pick(bid(2, 'NT'));
      const weakLong = sorted.find(suit => suit !== opening.call.strain && lengths[suit] >= 6 && cheapest(suit, 3));
      if (lengths[opening.call.strain] <= 1 && weakLong) return pick(cheapest(weakLong, 3) ?? safePass());
      return safePass();
    }
    const secondFit = lengths[openerRebid.strain] + partnerTrumpMinimum(openerRebid.strain) >= 8;
    if (secondFit && fitPoints(openerRebid.strain) + partnerMinimum() >= (major(openerRebid.strain) ? 25 : 29))
      return pick(bid(gameLevel(openerRebid.strain), openerRebid.strain));
    if (hcp >= 10) {
      const invitationSuit = sorted.find(suit => suit !== opening.call.strain && suit !== openerRebid.strain
        && lengths[suit] >= 6 && available(bid(3, suit)));
      if (invitationSuit) return bid(3, invitationSuit);
      if (balanced && available(bid(2, 'NT'))) return bid(2, 'NT');
    }
    if (secondFit && lengths[openerRebid.strain] >= 4) {
      if (fitPoints(openerRebid.strain) >= 10) return pick(bid(Math.min(4, openerRebid.level + 1), openerRebid.strain));
      return safePass();
    }
    const ownLong = sorted.find(suit => suit !== opening.call.strain && suit !== openerRebid.strain && lengths[suit] >= 6 && cheapest(suit, 3));
    if (ownLong) return pick(cheapest(ownLong, 3) ?? safePass());
    if (lengths[opening.call.strain] >= 2) {
      const preference = cheapest(opening.call.strain, 2);
      if (preference) return preference;
    }
    return safePass();
  }
  // A reverse promises 17+, so a responder with game values cannot give a
  // minimum five-card repeat. Describe a genuine fourth suit before NT.
  if (system === 'sayc' && responseToNaturalOneLevel && us.length === 3
    && semantics.convention === 'reverse' && hcp + partnerHcpMinimum() >= 25) {
    if (balanced) return pick(bid(3, 'NT'));
    const fourth = sorted.find(suit => !us.some(entry => entry.call.strain === suit)
      && lengths[suit] >= 4 && cheapest(suit, 3));
    if (fourth) return pick(cheapest(fourth, 3) ?? safePass());
    if (explicitFit()) return closeGame();
    if (lengths[response!.call.strain as Suit] >= 6) return pick(bid(3, response!.call.strain));
    return pick(bid(3, 'NT'));
  }
  // SAYC one-over-one continuation: after 1H-1S-2m, a weak responder with no
  // minor fit gives a two-card false preference to opener's known five-card
  // heart suit. With invitational values, bid a four-card fourth suit instead
  // of disguising the hand as a weak sign-off.
  if (obs.seat === responder && (system === 'sayc' || system === 'two-over-one')
    && major(opening.call.strain) && response?.seat === obs.seat
    && response.call.level === 1 && response.call.strain !== 'NT'
    && own.length === 1 && us.length === 3 && p.call.level === 2
    && p.call.strain !== 'NT' && !major(p.call.strain)) {
    const openerSecond = p.call.strain;
    const secondFit = lengths[openerSecond] + partnerTrumpMinimum(openerSecond) >= 8;
    if (!secondFit) {
      if (lengths[response.call.strain] >= 6 && hcp <= 12)
        return pick(bid(hcp >= 10 ? 3 : 2, response.call.strain));
      if (hcp <= 9 && lengths[opening.call.strain] >= 2) {
        const preference = cheapest(opening.call.strain, 2);
        if (preference) return preference;
      }
      if (hcp >= 10) {
        const fourthSuit = sorted.find(suit => suit !== opening.call.strain && suit !== response.call.strain
          && suit !== openerSecond && lengths[suit] >= 4 && cheapest(suit, 3));
        if (fourthSuit) return pick(cheapest(fourthSuit, 3) ?? safePass());
        if (balanced) return hcp >= 13 ? pick(bid(3, 'NT')) : pick(cheapest('NT', 3) ?? safePass());
      }
      if (lengths[response.call.strain] >= 6) return pick(cheapest(response.call.strain, 2) ?? safePass());
    }
    if (secondFit && fitPoints(openerSecond) >= 10)
      return pick(bid(fitPoints(openerSecond) + partnerMinimum() >= 29 ? 5 : 3, openerSecond));
  }
  // After a one-over-one response and opener's natural second-suit rebid,
  // balanced invitational hands keep the auction alive. This branch comes
  // after the weak false-preference rule so 6-9 HCP can still sign off in 2M.
  if (obs.seat === responder && system === 'sayc' && response?.seat === obs.seat
    && response.call.level === 1 && response.call.strain !== 'NT'
    && own.length === 1 && us.length === 3 && p.call.strain !== 'NT'
    && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain && balanced
    && !(major(p.call.strain) && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8)) {
    if (hcp >= 13) return pick(bid(3, 'NT'));
    if (hcp >= 10) return pick(bid(2, 'NT'));
  }
  // A one-level second suit by opener does not promise enough cards to be
  // passed with a poor fit. Responder describes NT, a real long suit or a
  // supported original minor instead of treating the last bid as a contract.
  if (system === 'sayc' && obs.seat === responder && own.length === 1 && us.length === 3
    && response?.call.level === 1 && response.call.strain !== 'NT' && p.call.level === 1
    && p.call.strain !== 'NT' && p.call.strain !== response.call.strain
    && p.call.strain !== opening.call.strain) {
    if (hcp >= 13) {
      const fourth = SUITS.find(suit => !us.some(entry => entry.call.strain === suit));
      if (fourth) return pick(cheapest(fourth, 3) ?? safePass());
    }
    if (opening.call.strain !== 'NT' && !major(opening.call.strain)
      && lengths[opening.call.strain] >= 5 && fitPoints(opening.call.strain) >= 10)
      return pick(bid(3, opening.call.strain));
    if (lengths[p.call.strain] >= 4) {
      const total = fitPoints(p.call.strain, 4) + 12;
      return pick(bid(total >= 25 ? gameLevel(p.call.strain) : total >= 23 ? 3 : 2, p.call.strain));
    }
    const enemyNatural = all.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.strain !== 'NT');
    if (hcp >= 13 && balanced && enemyNatural.every(entry => hasStopper(entry.call.strain))) return pick(bid(3, 'NT'));
    if (hcp >= 10 && balanced && enemyNatural.every(entry => hasStopper(entry.call.strain))) return pick(bid(2, 'NT'));
    if (hcp >= 10) {
      const fourth = sorted.find(suit => suit !== response.call.strain && suit !== p.call.strain
        && suit !== opening.call.strain && lengths[suit] >= 4 && cheapest(suit, 2));
      if (fourth) return pick(cheapest(fourth, 2) ?? safePass());
      if (available(bid(2, 'NT'))) return bid(2, 'NT');
    }
    const longEscape = sorted.find(suit => suit !== response.call.strain && suit !== p.call.strain
      && suit !== opening.call.strain && lengths[suit] >= 6 && cheapest(suit, 2));
    if (longEscape && lengths[opening.call.strain as Suit] <= 1 && hcp >= 6)
      return pick(cheapest(longEscape, 2) ?? safePass());
    if (lengths[response.call.strain] >= 6) return pick(bid(hcp >= 10 ? 3 : 2, response.call.strain));
    if (opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 4)
      return pick(bid(2, opening.call.strain));
    if (hcp >= 6 && enemyNatural.every(entry => hasStopper(entry.call.strain))) return pick(bid(1, 'NT'));
  }
  // The two-level second minor promises only four cards. Prefer a real
  // six-card response or the original five-card minor to a six-card fit.
  if (system === 'sayc' && responseToNaturalOneLevel && us.length === 3
    && p.call.level === 2 && p.call.strain !== 'NT' && !major(p.call.strain)
    && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain
    && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) < 8) {
    if (hcp >= 13) {
      const fourth = SUITS.find(suit => !us.some(entry => entry.call.strain === suit));
      if (fourth) return pick(cheapest(fourth, 3) ?? safePass());
    }
    if (lengths[response.call.strain as Suit] >= 6)
      return pick(bid(hcp >= 10 ? 3 : 2, response.call.strain));
    if (hcp >= 10) return pick(bid(2, 'NT'));
    if (opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 2)
      return pick(cheapest(opening.call.strain, 2) ?? safePass());
  }
  // A one-over-one response has no upper limit. After a minimum original-
  // suit rebid, responder still has to invite, reach game, or escape a
  // singleton with an actual long suit. The opener's minimum is not zero.
  if (system === 'sayc' && responseToNaturalOneLevel && us.length === 3
    && p.call.strain === opening.call.strain && p.call.strain !== 'NT') {
    if (balanced && hcp >= 13) return pick(bid(3, 'NT'));
    if (balanced && hcp >= 10) return pick(bid(2, 'NT'));
    if (lengths[response.call.strain as Suit] >= 6 && lengths[p.call.strain] <= 2)
      return pick(bid(hcp >= 13 && major(response.call.strain) ? 4 : hcp >= 10 ? 3 : 2, response.call.strain));
    const ownSecond = sorted.find(suit => suit !== opening.call.strain && suit !== response.call.strain
      && lengths[suit] >= 5 && cheapest(suit, 3));
    if (hcp >= 10 && ownSecond) return pick(cheapest(ownSecond, 3) ?? safePass());
    if (lengths[p.call.strain] <= 1) {
      if (ownSecond) return pick(cheapest(ownSecond, 3) ?? safePass());
      if (lengths[response.call.strain as Suit] >= 5) return pick(cheapest(response.call.strain, 2) ?? safePass());
    }
    const publicFit = lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8;
    if (publicFit && fitPoints(p.call.strain) >= 10) {
      const total = fitPoints(p.call.strain) + partnerMinimum();
      return pick(bid(total >= (major(p.call.strain) ? 25 : 29) ? gameLevel(p.call.strain) : 3, p.call.strain));
    }
  }
  // Strong unbalanced one-over-one hands use fourth-suit forcing rather
  // than disappearing into Pass after opener describes the second suit.
  if (system === 'sayc' && responseToNaturalOneLevel && us.length === 3 && hcp >= 13
    && p.call.strain !== 'NT' && p.call.strain !== opening.call.strain && p.call.strain !== response.call.strain) {
    const fourth = SUITS.find(suit => !us.some(entry => entry.call.strain === suit));
    if (fourth && cheapest(fourth, 3)) return pick(cheapest(fourth, 3) ?? safePass());
  }
  // Opener's simple raise of responder's major shows a four-card fit. Responder
  // can therefore place game from the public 12-point opening minimum.
  if (obs.seat === responder && system === 'sayc' && response?.seat === obs.seat
    && response.call.level === 1 && major(response.call.strain) && us.length === 3
    && p.call.level === 2 && p.call.strain === response.call.strain) {
    const total = fitPoints(response.call.strain, 4) + 12;
    if (total >= 33) return pick(bid(4, 'NT'));
    if (total >= 25) return pick(bid(4, response.call.strain));
    if (total >= 23) return pick(bid(3, response.call.strain));
    return safePass();
  }
  // A SAYC two-level new-suit response shows at least 10 HCP. After opener
  // supports that suit, responder with 12+ balanced values has a public game.
  if (obs.seat === responder && system === 'sayc' && response?.seat === obs.seat
    && response.call.level === 2 && response.call.strain !== 'NT' && us.length === 3
    && p.call.strain === response.call.strain && p.call.level === 3) {
    if (balanced && hcp >= 12) return pick(bid(3, 'NT'), bid(5, response.call.strain));
    const total = fitPoints(response.call.strain, 4) + 12;
    if (total >= 29) return pick(bid(5, response.call.strain));
    return safePass();
  }
  if (isOpener && own.length === 1) {
    if (system === 'sayc' && response?.call.level === 2 && response.call.strain !== 'NT'
      && response.call.strain !== opening.call.strain && passedBefore(obs.auction, response.seat, opening.index)
      && balanced && lengths[response.call.strain] < (major(response.call.strain) ? 3 : 4)) {
      if (hcp >= 18) return pick(bid(3, 'NT'));
      if (hcp >= 12 && hcp <= 14) return pick(bid(2, 'NT'));
    }
    if (!major(opening.call.strain) && opening.call.strain !== 'NT' && p.call.strain === opening.call.strain
      && p.call.level === 2 && hcp >= 16)
      return pick(bid(fitPoints(opening.call.strain) + partnerMinimum() >= 29 ? 5 : 3, opening.call.strain));
    if (major(opening.call.strain) && p.call.strain === opening.call.strain && p.call.level === 3) return fitPoints(opening.call.strain, 3) >= 15 ? pick(bid(4, p.call.strain)) : safePass();
    if (major(p.call.strain) && lengths[p.call.strain] >= (p.call.level === 1 ? 4 : 3)) {
      const total = fitPoints(p.call.strain, p.call.level === 1 ? 4 : 3);
      return pick(bid(total >= 19 ? 4 : total >= 16 ? 3 : 2, p.call.strain));
    }
    if (system === 'sayc' && p.call.level === 1 && major(p.call.strain) && balanced && hcp <= 14)
      return pick(bid(1, 'NT'));
    if (p.call.strain === 'NT' && p.call.level === 2) return hcp >= (system === 'precision' ? 14 : 14) ? pick(bid(3, 'NT')) : safePass();
    if (p.call.level === 1 && p.call.strain !== 'NT') {
      const majorSuit = naturalMajorOrder.find(s => lengths[s] >= 4 && available(bid(1, s)));
      if (hcp >= 19 && !major(opening.call.strain) && opening.call.strain !== 'NT'
        && lengths[opening.call.strain] >= 6 && SUITS.filter(suit => suit !== opening.call.strain).every(hasStopper)
        && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (balanced && hcp >= 18) return pick(bid(2, 'NT'));
      if (hcp >= 19 && opening.call.strain !== 'NT' && lengths[opening.call.strain] >= 4) {
        const second = sorted.find(suit => suit !== opening.call.strain && suit !== p.call.strain && lengths[suit] >= 4
          && cheapest(suit, 2));
        const low = second ? cheapest(second, 2) : undefined;
        if (low?.kind === 'bid' && available(bid(low.level + 1, low.strain))) return bid(low.level + 1, low.strain);
      }
      if (majorSuit) return bid(1, majorSuit);
      if (balanced) return pick(bid(1, 'NT'));
      const responseBid = response?.call;
      const second = sorted.find(s => {
        if (s === opening.call.strain || lengths[s] < 4 || !available(bid(2, s))) return false;
        const reverse = responseBid?.level === 1 && bidValue(bid(1, s)) > bidValue(opening.call);
        return !reverse || hcp >= 17;
      });
      if (second && bidValue(bid(1, second)) > bidValue(opening.call)) return bid(2, second);
      if (lengths[opening.call.strain as Suit] >= 6 && hcp >= 16) return pick(bid(hcp >= 19 && major(opening.call.strain) ? 4 : 3, opening.call.strain));
      if (second) return bid(2, second);
      if (lengths[opening.call.strain as Suit] >= 6) return pick(bid(2, opening.call.strain));
      if (lengths[opening.call.strain as Suit] >= 5) return pick(bid(2, opening.call.strain));
      return pick(bid(1, 'NT'));
    }
  }
  // Responder's 2NT after a natural 1NT rebid is invitational (11-12). A
  // 13-14 SAYC opener accepts with 14, using only the public invitation range.
  if (system === 'sayc' && isOpener && p.call.level === 2 && p.call.strain === 'NT') {
    const ownMajor = sorted.find(suit => major(suit) && lengths[suit] >= 6);
    if (ownMajor && fitPoints(ownMajor, 2) + 10 >= 25) return pick(bid(4, ownMajor));
    const ownNt = own.findLast(entry => entry.call.level === 1 && entry.call.strain === 'NT');
    if (ownNt && hcp >= 14) return pick(bid(3, 'NT'));
    if (own.length >= 2 && hcp >= 15) return pick(bid(3, 'NT'));
  }
  if (system === 'sayc' && isOpener && p.call.level === 3 && major(p.call.strain)
    && response?.call.level === 1 && response.call.strain === p.call.strain
    && own.some(entry => entry.call.level === 1 && entry.call.strain === 'NT')
    && lengths[p.call.strain] >= 2 && hcp >= 14) return pick(bid(4, p.call.strain));
  if (system === 'sayc' && !isOpener && own.length === 2 && us.length === 5 && p.call.strain === 'NT'
    && own[1].call.strain !== 'NT' && new Set(us.slice(0, 4).map(entry => entry.call.strain)).size === 4
    && hcp >= 13) return pick(bid(3, 'NT'));
  if (system === 'sayc' && !isOpener && own.length === 2 && us.length === 5
    && own[1].call.strain !== 'NT' && new Set(us.slice(0, 4).map(entry => entry.call.strain)).size === 4
    && hcp >= 13 && !atGame(p.call)) return closeGame();
  if (system === 'sayc' && isOpener && own.length >= 2 && p.call.strain === 'NT' && p.call.level === 1
    && opening.call.level === 1 && opening.call.strain !== 'NT' && hcp >= 18)
    return pick(bid(hcp >= 19 ? 3 : 2, 'NT'));
  // A reverse is 17+ and the one-round response may still be a minimum.
  // With 19+ the opener must show the extras instead of hiding them in Pass.
  if (system === 'sayc' && isOpener && own.length === 2 && own[1].call.level === 2
    && own[1].call.strain !== 'NT' && own[1].call.strain !== opening.call.strain
    && bidValue(bid(1, own[1].call.strain)) > bidValue(opening.call)
    && response?.call.level === 1 && p.call.level <= 2 && hcp >= 19) {
    if (p.call.strain !== 'NT' && lengths[p.call.strain] >= 3 && major(p.call.strain)) return pick(bid(4, p.call.strain));
    return pick(bid(3, 'NT'), cheapest(opening.call.strain, 3) ?? safePass());
  }
  // A simple natural continuation evaluates public minimums, never actual partner HCP.
  if (system === 'sayc' && isOpener && opening.call.level === 1 && major(opening.call.strain)
    && response?.call.level === 1 && response.call.strain === 'NT' && own.length >= 2
    && p.call.level === 3 && p.call.strain !== 'NT' && p.call.strain !== opening.call.strain
    && hcp >= 17 && SUITS.filter(suit => suit !== p.call.strain).every(hasStopper))
    return pick(bid(3, 'NT'));
  if (system === 'sayc' && isOpener && opening.call.level === 1 && major(opening.call.strain)
    && response?.call.level === 1 && response.call.strain === 'NT' && us.length === 4
    && us[2].call.level === 2 && us[2].call.strain !== opening.call.strain
    && p.call.level === 2 && p.call.strain === opening.call.strain) {
    if (hcp >= 18 && SUITS.filter(suit => suit !== opening.call.strain).every(hasStopper)) return pick(bid(2, 'NT'));
    if (hcp >= 17 && lengths[opening.call.strain] >= 6) return pick(bid(3, opening.call.strain));
    return safePass();
  }
  const partnerMin = partnerMinimum();
  if (p.call.strain !== 'NT' && lengths[p.call.strain] + partnerTrumpMinimum(p.call.strain) >= 8
    && fitPoints(p.call.strain) + partnerMin >= (major(p.call.strain) ? 25 : 29)) return pick(bid(gameLevel(p.call.strain), p.call.strain));
  if (balanced && hcp + partnerHcpMinimum() >= 25) return pick(bid(3, 'NT'));
  return safePass();
}

/** Descriptions are based on public calls; they never reveal actual strength. */
export function describeCall(auction: AuctionEntry[], seat: Seat, call: Call, system: BiddingSystem): string {
  if (call.kind === 'pass') {
    const status = auctionStatus(auction); const lastBid = status.lastBid;
    if (!lastBid) return '不叫：没有达到当前体系的一阶开叫或阻击开叫条件';
    if (lastBid.call.kind !== 'bid') return '不叫：当前没有自然定约需要继续竞争';
    const lastIndex = auction.findLastIndex(entry => entry === lastBid);
    const forcing = analyzeAuctionSemantics(auction, seat, system).mustBid;
    const ourArtificialContract = sideOf(lastBid.seat) === sideOf(seat)
      && isArtificialBidAt(auction, lastIndex, system);
    if (forcing || ourArtificialContract) return '不叫不符合当前逼叫状态；本叫品应保持禁用，人工询问或转移不能作为最终定约';
    const doubled = status.doubled === 2 ? '再加倍后的' : status.doubled === 1 ? '被加倍的' : '';
    if (sideOf(lastBid.seat) === sideOf(seat)) {
      const owner = lastBid.seat === seat ? '自己' : '搭档';
      return `不叫：当前没有继续叫牌义务，暂时接受${owner}${doubled}${lastBid.call.level}${lastBid.call.strain}；对手仍可继续叫牌`;
    }
    const ownSideHasBid = auction.some(entry => sideOf(entry.seat) === sideOf(seat) && entry.call.kind === 'bid');
    return ownSideHasBid ? `不叫：暂不继续本方叫牌或加倍，让对手${doubled}${lastBid.call.level}${lastBid.call.strain}保持为当前定约`
      : `不叫：放弃在对手${doubled}${lastBid.call.level}${lastBid.call.strain}之后争叫、加倍或牺牲`;
  }
  if (call.kind === 'double') {
    const bidEntries = entries(auction); const lastBid = bidEntries.at(-1);
    const ourBids = bidEntries.filter(entry => sideOf(entry.seat) === sideOf(seat));
    const ourBid = ourBids.at(-1);
    if (system === 'sayc' && lastBid && sideOf(lastBid.seat) !== sideOf(seat)) {
      const role = classifyDoubleAt([...auction, { seat, call }], auction.length, system);
      if (role === 'lead-directing' && lastBid.call.strain === 'NT') return `人工${lastBid.call.level}NT问叫上的加倍：有首攻指示意图，但本卡未约定此无将人工叫品上的具体首攻方向；不能当成自然无将惩罚或技术性加倍`;
      if (role === 'lead-directing') return `人工叫品${lastBid.call.level}${lastBid.call.strain}上的首攻指示加倍：显示所叫花色的防守兴趣；不是负加倍，也不要求搭档选未叫花色`;
      if (role === 'two-suit-strength') return '对Michaels或Unusual 2NT的实力加倍：10+ HCP，表示有惩罚意愿并保留后续判断';
      if (role === 'negative') return 'SAYC负加倍：通常表示未叫高花，使用至敌方2♠争叫；要求开叫人描述，但普通答叫不自动继续逼叫';
      if (role === 'penalty' && lastBid.call.strain === 'NT') return bidEntries.length === 1 && lastBid.call.level === 1
        ? '对自然1NT开叫的惩罚性加倍：15+ HCP且至少3个快速赢墩；点力达到15本身不足以自动加倍，不表示未叫花色'
        : `对自然${lastBid.call.level}NT的惩罚性加倍：要求足够防守赢墩；无将定约不按将牌长度判断，也不重新解释为负加倍`;
      if (role === 'penalty') return `惩罚性加倍：针对对手的${lastBid.call.level}${lastBid.call.strain}，要求相应将牌质量和防守实力${auction.some(entry => sideOf(entry.seat) === sideOf(seat) && entry.call.kind === 'redouble') ? '；本方实力再加倍后的后续竞争加倍不重新解释为负加倍' : '；当前自然定约上的加倍不自动表示未叫花色'}`;
      if (isTakeoutDoubleAt([...auction, { seat, call }], auction.length)) return 'SAYC技术性加倍：要求搭档选未叫花色；强牌随后再叫长套';
      if (!ourBid) return lastBid.call.strain === 'NT'
        ? '惩罚性加倍：对方自然无将定约，要求足够防守实力'
        : '惩罚性加倍：当前不是本体系的技术性加倍位置，要求敌方将牌质量和防守实力';
      const firstBid = bidEntries[0];
      const conventionalTwoSuiter = firstBid && sideOf(firstBid.seat) === sideOf(seat)
        && lastBid.index === firstBid.index + 1 && lastBid.call.level === 2
        && (lastBid.call.strain === firstBid.call.strain || lastBid.call.strain === 'NT');
      if (conventionalTwoSuiter) return '对Michaels或Unusual 2NT的实力加倍：10+ HCP，表示有惩罚意愿并保留后续判断';
      const negativeDouble = ourBids.length === 1 && ourBid.seat === partnerOf(seat)
        && ourBid.index === firstBid?.index && lastBid.index === ourBid.index + 1
        && auction.length === ourBid.index + 2 && lastBid.call.level <= 2
        && lastBid.call.strain !== 'NT' && lastBid.call.strain !== ourBid.call.strain;
      if (negativeDouble) return 'SAYC负加倍：通常表示未叫高花，使用至敌方2♠争叫';
      return '惩罚性加倍：本方已参与竞争；要求有敌方将牌长度和质量、足够防守墩，并结合局况保守使用';
    }
    return lastBid ? `加倍：当前体系未把此处定义为人工技术性或负加倍，按对${lastBid.call.level}${lastBid.call.strain}的惩罚性加倍处理` : '加倍：当前没有可加倍的敌方定约';
  }
  if (call.kind === 'redouble') return system === 'sayc' ? '再加倍：通常表示10+ HCP和实力，准备惩罚对手或寻找更好定约' : '再加倍：表示实力并要求搭档按当前体系继续描述';
  const all = entries(auction); const us = all.filter(e => sideOf(e.seat) === sideOf(seat)); const opening = us[0];
  const lastOpponent = [...all].reverse().find(entry => sideOf(entry.seat) !== sideOf(seat));
  const genuine = !!opening && opening.index === all[0]?.index;
  const clean = genuine && !intervened(auction, seat, opening.index);
  const own = us.filter(entry => entry.seat === seat);
  const partner = [...us].reverse().find(entry => entry.seat === partnerOf(seat));
  const following = [...auction, { seat, call }];
  const fourNt = [...us].reverse().find(entry => entry.call.level === 4 && entry.call.strain === 'NT');
  const trump = fourNt ? keycardTrump(us.filter(entry => entry.index < fourNt.index), system, fourNt.seat, auction) : undefined;
  const ownLast = own.at(-1);
  const immediateDouble = genuine && opening.call.level === 1 && auction[opening.index + 1]?.call.kind === 'double'
    && auction.length === opening.index + 2 && seat !== opening.seat;
  const enemyBase = all[0];
  const initialOvercall = all[1];
  if (system === 'sayc' && enemyBase?.call.level === 1 && enemyBase.call.strain !== 'NT'
    && sideOf(enemyBase.seat) !== sideOf(seat) && initialOvercall && initialOvercall.call.strain !== 'NT'
    && initialOvercall.call.strain !== enemyBase.call.strain
    && sideOf(initialOvercall.seat) === sideOf(seat) && call.strain === initialOvercall.call.strain
    && us.length >= 3 && ownLast?.call.strain === enemyBase.call.strain)
    return `支持性扣叫后回到争叫套${call.strain}：原扣叫已显示10+ HCP及通常3+张支持；本次是选择将牌或加叫，不承诺自己的五张新套`;
  if (genuine && opening?.call.level === 1 && major(opening.call.strain)
    && us[1]?.seat === seat && us[1].call.level === 1 && us[1].call.strain === 'NT'
    && us[2]?.seat === opening.seat && us[2].call.strain === opening.call.strain
    && call.strain === opening.call.strain && us.length === 3)
    return atGame(call)
      ? `半逼叫1NT后选择${call.level}${call.strain}成局：接受开叫人原套再叫所示实力或凭本手实力到局；可仅两张支持六张原套，不额外承诺三张支持，原则上止叫`
      : call.level === 3
      ? '半逼叫1NT后对原高花再叫的邀请：通常10–12 HCP，可仅两张支持；原套通常六张但有五张例外，不能直接宣称已确定八张配合'
      : '半逼叫1NT后回到原高花：弱牌偏好或选择部分定约，可仅两张；不额外承诺三张支持';
  if (system === 'sayc' && immediateDouble && call.strain !== 'NT' && call.strain !== opening.call.strain) {
    if (call.level === 1) return `对技术性加倍的一阶自然新花色应叫：6+ HCP、4+张${call.strain}；${passedBefore(auction, seat, opening.index) ? '已Pass手牌限制实力，通常不逼叫' : '未Pass手牌逼叫一轮'}`;
    const previous = all.at(-1)!.call;
    const jump = bidValue(call) - bidValue(previous) > 5;
    return `对技术性加倍的${jump ? '弱跳移叫' : '二阶自然新花色应叫'}：通常6–10 HCP及6+张${call.strain}，好五张套可作自然应叫；自然不逼叫，不是无干扰二盖一进局逼叫`;
  }
  if (genuine && opening?.call.level === 1 && opening.call.strain !== 'NT' && us.length === 3
    && us[1]?.seat === seat && us[1].call.level === 1 && major(us[1].call.strain)
    && us[2].call.level === 2 && us[2].call.strain === us[1].call.strain && call.strain === us[1].call.strain)
    return lastOpponent && lastOpponent.index > us[2].index && call.level === 3
      ? `敌方继续叫牌后的${call.strain}竞争性加叫：沿用已确认配合，争取三阶部分定约；不自动表示10–12支持点邀请，不逼叫`
      : call.level === 3 ? `对开叫人四张支持的${call.strain}邀请：通常10–12支持点，已确认至少八张配合；不额外表示六张自己的套`
      : `在开叫人四张支持后选择${call.level}${call.strain}：已确认高花配合；成局或部分定约按先前实力决定`;
  if (genuine && opening?.call.level === 1 && us[1]?.call.level === 1 && major(us[1].call.strain)
    && us[2]?.seat === seat && us[2].call.level === 2 && us[2].call.strain === us[1].call.strain
    && us[3]?.call.level === 3 && us[3].call.strain === us[1].call.strain && call.level === 4 && call.strain === us[1].call.strain)
    return '接受应叫高花的三阶邀请：开叫人持四张支持及足够调整点，选择高花成局；不是新花色显示';
  if (system === 'sayc' && genuine && us.length === 1 && opening.seat === partnerOf(seat)
    && opening.call.level === 1 && opening.call.strain !== 'NT' && call.strain !== 'NT'
    && call.strain !== opening.call.strain && lastOpponent && lastOpponent.index > opening.index
    && call.strain !== lastOpponent.call.strain && bidValue(call) - bidValue(lastOpponent.call) <= 5) {
    const alreadyPassed = passedBefore(auction, seat, opening.index);
    const fiveSpades = !major(opening.call.strain) && lastOpponent.call.strain === 'H' && call.strain === 'S';
    return `开叫方在争叫后${call.level === 1 ? '一阶' : `自然${call.level}阶`}新花色应叫：${call.level === 1 ? '6+' : '10+'} HCP、通常${call.level === 1 && !fiveSpades ? '4' : '5'}+张${call.strain}；${alreadyPassed ? '过手牌限制实力，通常不逼叫' : '逼叫一轮，开叫人不能无故Pass'}，不是另一方的争叫后应叫`;
  }
  // Jacoby shortness remains artificial after the response; the major fit
  // is already agreed and side-suit replies must not become new natural suits.
  if (clean && opening?.call.level === 1 && major(opening.call.strain)
    && us[1]?.call.level === 2 && us[1].call.strain === 'NT') {
    const agreed = opening.call.strain;
    if (us.length === 2 && seat === opening.seat) {
      if (call.level === 3 && call.strain !== 'NT' && call.strain !== agreed)
        return `Jacoby 2NT后的短门答叫：${call.strain}单张或缺门；既定将牌为${agreed}，不承诺所叫花色长度，进局逼叫继续`;
      if (call.strain === agreed && call.level === 3) return `Jacoby 2NT后的额外实力答叫：无短门，通常18+ HCP；${agreed}为将牌，保留满贯空间`;
      if (call.strain === agreed && call.level === 4) return `Jacoby 2NT后的最低限答叫：无短门、额外实力较少，选择4${agreed}成局`;
    }
    if (us.length >= 3 && call.strain === agreed && call.level === 4)
      return `Jacoby 2NT后选择4${agreed}成局：此前已约定${agreed}为将牌，当前不继续满贯探索`;
  }
  const keyAnswer = fourNt ? us.find(entry => entry.index > fourNt.index && entry.seat !== fourNt.seat && entry.call.level === 5 && entry.call.strain !== 'NT') : undefined;
  // Asking, answering and signing off are distinct roles; a five-level
  // natural signoff after an answer is never Stayman or another keycard reply.
  if (trump && fourNt) {
    if (partner?.index === fourNt.index && call.level === 5 && call.strain !== 'NT') {
      return call.strain === 'C' ? 'RKCB 1430答叫：1或4个关键张'
        : call.strain === 'D' ? 'RKCB 1430答叫：0或3个关键张'
          : call.strain === 'H' ? 'RKCB 1430答叫：2或5个关键张，无将牌Q'
            : 'RKCB 1430答叫：2或5个关键张，有将牌Q';
    }
    const queenAsk = keyAnswer && fourNt.seat === seat && partner?.index === keyAnswer.index
      && ((keyAnswer.call.strain === 'C' && call.level === 5 && call.strain === 'D')
        || (keyAnswer.call.strain === 'D' && call.level === 5 && call.strain === 'H'));
    if (queenAsk) return `RKCB后的将牌Q询问：对${keyAnswer.call.strain === 'C' ? '5♣' : '5♦'}加一级；无Q回到最低可叫的${trump}，有Q显示六阶将牌或其下的旁门K`;
    const queenResponse = keyAnswer && ownLast?.index === keyAnswer.index && partner
      && ((keyAnswer.call.strain === 'C' && partner.call.level === 5 && partner.call.strain === 'D')
        || (keyAnswer.call.strain === 'D' && partner.call.level === 5 && partner.call.strain === 'H'));
    if (queenResponse && call.strain === trump) return call.level === 5
      ? `将牌Q答叫：否认Q，回到5${trump}止叫；不是新的自然长套或关键张回答`
      : partner && bidValue(partner.call) >= bidValue(bid(5, trump))
        ? `将牌Q答叫：回到最低可叫的6${trump}；五阶将牌已被问叫越过，此回答不能单独区分有Q与无Q`
        : `将牌Q答叫：有Q，叫6${trump}；没有在其下可描述的旁门K`;
    if (queenResponse && call.level === 6) return `将牌Q答叫：有将牌Q，同时显示${call.strain}K；既定将牌仍是${trump}`;
    if (call.level === 5 && call.strain === 'NT' && fourNt.seat === seat && partner?.index === keyAnswer?.index) return `RKCB后的5NT问K：确认五个关键张及将牌Q齐全后，询问旁门K；${trump}K已计入关键张`;
    if (partner?.call.level === 5 && partner.call.strain === 'NT' && partner.seat === fourNt.seat && call.level === 6 && call.strain !== 'NT') return call.strain === trump
      ? `5NT问K答叫：没有旁门K，回到6${trump}` : `5NT问K答叫：显示最低可叫的${call.strain}K；将牌仍是${trump}`;
    if (fourNt.seat === seat && keyAnswer && call.strain === trump && call.level >= 5) return `RKCB后的${call.level}${trump}签约：按关键张及将牌Q回答选择定约；不再表示新花色或额外套长`;
  }
  if (call.level === 4 && call.strain === 'NT') {
    const fit = keycardTrump(us, system, seat, auction);
    if (fit) return `RKCB 1430关键张问叫：已约定${fit}为将牌，询问四个A及${fit}K；5♣=1/4、5♦=0/3、5♥=2/5无Q、5♠=2/5有Q`;
    if (us.some(entry => entry.call.strain === 'NT')) return '自然无将中的定量4NT：邀请满贯，可按已公开的无将范围接受或Pass；不是RKCB';
    return '非体系4NT：尚未约定将牌，也没有自然无将定量背景；不应把它解释为RKCB，手动选择不承诺关键张问叫';
  }
  if (genuine && opening.call.level === 2 && opening.call.strain === 'C' && system !== 'precision') {
    if (us.length === 1 && seat !== opening.seat && call.level === 2 && call.strain === 'D') return '强2♣后的2♦等待应叫：人工逼叫，不承诺方块长度，也不等于弱牌';
    if (us.length === 2 && seat === opening.seat && call.strain === 'NT') return call.level === 2
      ? '强2♣后的2NT再叫：22–24 HCP均型；2♦等待应叫不算方块套'
      : '强2♣后的3NT再叫：25+ HCP均型，选择成局定约';
    if (us.length === 3 && seat !== opening.seat && call.level === 3 && call.strain === 'C' && major(us[2].call.strain)) return system === 'sayc'
      ? '强2♣后的第二次负应叫3♣：人工示弱，0–3 HCP；不承诺梅花套或梅花配合，逼叫一轮'
      : '强2♣后的第二次负应叫3♣：人工示弱；不承诺梅花套或梅花配合，逼叫一轮';
    if (system === 'sayc' && us.length === 3 && seat !== opening.seat && call.level === 3
      && ((us[2].call.strain === 'C' && call.strain === 'D') || (us[2].call.strain === 'D' && call.strain === 'NT')))
      return '强2♣后三阶低花再叫的第二次负应叫：0–3 HCP，人工示弱并逼叫一轮；不显示方块长套或自然无将成局实力';
    if (system === 'sayc' && us.length === 3 && seat !== opening.seat && us[1]?.call.level === 2
      && us[1].call.strain === 'D' && us[2].call.strain !== 'NT' && call.strain !== 'NT' && call.strain !== us[2].call.strain)
      return `强2♣等待后自然${call.level}${call.strain}正应：5+张自己的套，不是0–3 HCP的人工二次负应叫；进局逼叫继续，本轮固定负应叫为${major(us[2].call.strain) ? '3♣' : us[2].call.strain === 'C' ? '3♦' : '3NT'}，不因实际手牌而改变`;
    if (us.length === 2 && seat === opening.seat && call.strain !== 'NT') return `强2♣后的自然${call.level}${call.strain}再叫：${major(call.strain) ? '显示5+张高花套' : '通常5+张低花；强4-4-4-1手牌没有五张套时允许自然四张低花，不把四张高花伪报为五张'}，逼叫一轮；尚未解除强开叫的应叫义务`;
  }
  const ntOpening = genuine ? opening.call.strain === 'NT' ? opening
    : opening.call.level === 2 && opening.call.strain === 'C' && us[2]?.call.strain === 'NT' ? us[2] : undefined : undefined;
  const ntUs = ntOpening ? us.slice(us.indexOf(ntOpening)) : [];
  const ntResponse = ntUs[1];
  const ntConventionsAvailable = ntOpening && !auction.slice(ntOpening.index + 1)
    .some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid');
  if (ntConventionsAvailable && ntOpening && ntOpening.call.level <= 3) {
    const base = ntOpening.call.level + 1;
    if (ntUs.length === 1 && seat !== ntOpening.seat && call.level === base) {
      if (call.strain === 'C') return 'Stayman：人工询问四张高花，不承诺梅花长度；逼叫一轮';
      if (call.strain === 'D' || call.strain === 'H') return `Jacoby转移：5+张${call.strain === 'D' ? '红心' : '黑桃'}，要求接受转移；不承诺所叫花色长度`;
    }
    if (ntUs.length === 2 && seat === ntOpening.seat && ntResponse) {
      if (ntResponse.call.strain === 'C' && ntResponse.call.level === base) {
        if (call.level === base && call.strain === 'D') return 'Stayman答叫：否认四张高花；人工回答，不承诺方块长度';
        if (call.level === base && major(call.strain)) return `Stayman答叫：4+张${call.strain}；人工询问的自然高花回答，不承诺五张套`;
        return `非约定Stayman答叫${call.level}${call.strain}：本卡要求${base}D、${base}H或${base}S回答；不能用自然成局说明代替尚未回答的人工询问`;
      }
      if (ntResponse.call.level === base && (ntResponse.call.strain === 'D' || ntResponse.call.strain === 'H')) {
        const target = ntResponse.call.strain === 'D' ? 'H' : 'S';
        if (call.level === base && call.strain === target) return `Jacoby转移接受：按要求叫${call.level}${call.strain}，通常只保证2+张支持；不表示自己持五张或六张套`;
        return `非约定转移答叫${call.level}${call.strain}：本卡要求接受到${base}${target}；此处未约定超接受或其他答叫的点力、长度或满贯含义，不能直接当成自然六张套`;
      }
    }
    if (ntUs.length === 3 && seat !== ntOpening.seat && ntResponse?.call.level === base
      && (ntResponse.call.strain === 'D' || ntResponse.call.strain === 'H')) {
      const target = ntResponse.call.strain === 'D' ? 'H' : 'S';
      if (major(call.strain) && call.strain !== target && call.level >= 3)
        return `转移后自然第二高花${call.level}${call.strain}：5+张${call.strain}及此前转移所示的5+张${target}，显示双高花并建立进局逼叫；不是弱牌逃叫，也不把转移接受当成同伴五张套`;
      if (call.strain === 'NT' && call.level === 3) return `转移后的3NT：5+张${target}及成局实力，让无将开叫人有3+张支持时选择4${target}`;
      if (call.strain === 'NT' && call.level === 2) return `转移后的2NT：5+张${target}及邀请实力，不是20–21点的无将开叫`;
      if (call.strain === target && call.level === 3) return `转移后的3${target}：6+张长高花，邀请进局`;
      if (call.strain === target && call.level === 4) return `转移后的4${target}：6+张长高花及成局实力，签约止叫`;
    }
    if (ntUs.length >= 4 && seat === ntOpening.seat && (partner?.call.level === 2 || partner?.call.level === 3) && partner.call.strain === 'NT'
      && ntResponse && (ntResponse.call.strain === 'D' || ntResponse.call.strain === 'H')
      && call.level === 4 && call.strain === (ntResponse.call.strain === 'D' ? 'H' : 'S')) return `转移后由${partner.call.level}NT改叫4${call.strain}：3+张支持搭档已示的五张高花，${partner.call.level === 2 ? '接受邀请并' : ''}选择已知八张配合；不额外承诺六张套`;
    if (ntOpening.call.level === 1 && ntUs.length === 3 && seat !== ntOpening.seat && ntResponse?.call.strain === 'C'
      && ntResponse.call.level === base && ntUs[2].call.level === base
      && major(ntUs[2].call.strain) && major(call.strain) && call.strain !== ntUs[2].call.strain)
      return call.level === base
        ? `Stayman答叫后另一高花${call.level}${call.strain}邀请：4+张所叫高花，仍寻找同伴四张配合；不是五张新套或Jacoby转移，未建立进局逼叫`
        : `Stayman答叫后另一高花${call.level}${call.strain}：本卡仅约定最低二阶四张高花邀请；此跳级续叫未约定固定长度或点力，不能自动当作五张自然新套`;
  }
  if (clean && us.length === 3 && seat !== opening.seat && call.level >= 2 && call.strain !== 'NT'
    && new Set([...us.map(entry => entry.call.strain), call.strain]).size === 4
    && us.every(entry => entry.call.strain !== 'NT')
    && isArtificialBidAt(following, auction.length, system)) return `第四花色逼叫：人工询问止张、支持或额外牌型，不承诺所叫花色长度；至少逼叫一轮${analyzeAuctionSemantics(auction, seat, system).forcing === 'game' ? '，原有进局逼叫继续' : '，本叫品本身不等于此前已建立二盖一逼局'}`;
  if (system === 'sayc' && genuine && opening.call.strain === 'NT' && lastOpponent
    && lastOpponent.index > opening.index && us.length === 1 && seat !== opening.seat
    && call.strain === lastOpponent.call.strain) return '无将开叫受争叫后的逼局扣叫：10+ HCP，询问四张高花及敌套止张；不承诺敌方花色长度，要求继续描述';
  if (system === 'sayc' && genuine && opening.call.strain === 'NT' && us[1]
    && all.some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.index < us[1].index && entry.call.strain === us[1].call.strain)
    && seat === opening.seat && call.strain !== 'NT' && major(call.strain))
    return `无将竞争扣叫后的高花答叫：4+张${call.strain}；继续寻找高花配合，不承诺五张套`;
  if (clean && system !== 'sayc' && us.length === 3 && opening.call.level === 1 && !major(opening.call.strain)
    && us[1].call.level === 1 && major(us[1].call.strain) && us[2].call.strain === 'NT' && us[2].call.level === 1
    && call.level === 2 && (call.strain === 'C' || call.strain === 'D') && call.strain !== opening.call.strain) return '新低花逼叫：人工询问高花支持或另一高花；不承诺新低花长度';
  if (genuine && opening.call.level === 2 && opening.call.strain !== 'C' && opening.call.strain !== 'NT') {
    if (us.length === 1 && seat !== opening.seat && call.level === 2 && call.strain === 'NT') return '弱二后的2NT特征问叫：通常15+ HCP，逼叫一轮；询问最高限及旁门A/K，不是自然均型定量叫';
    if (us.length === 2 && seat === opening.seat && us[1].call.strain === 'NT' && us[1].call.level === 2) return call.strain === opening.call.strain
      ? '弱二特征问叫答叫：最低限或没有可显示的旁门A/K，回到原长套；不增加套长承诺'
      : `弱二特征问叫答叫：最高限并显示${call.strain}A或K；不承诺旁门四张套`;
    if (us.length === 1 && seat !== opening.seat && call.strain !== 'NT' && call.strain !== opening.call.strain) return '弱二后的新花色应叫：13+ HCP、5+张自然套，逼叫一轮；有争叫时仍不得无故Pass';
    if (seat === opening.seat && call.strain === opening.call.strain && us.length === 2
      && us[1].call.strain === opening.call.strain)
      return `弱二普通加叫后的${call.level}${call.strain}选择：原弱二仍为6+张；同伴加叫是竞争性或延长阻击、不构成正常邀请，本次不应解释为接受限制性邀请；不逼叫`;
  }
  if (genuine && system === 'sayc' && us.length === 1 && opening?.seat === partnerOf(seat) && opening.call.level === 3
    && opening.call.strain !== 'NT' && call.strain !== 'NT' && call.strain !== opening.call.strain) return '同伴三阶阻击后的新花色：15+ HCP、5+张，逼叫一轮；阻击方必须描述配合或回叫原套';
  if (genuine && opening?.call.level === 2 && opening.call.strain !== 'NT' && opening.call.strain !== 'C'
    && us.length === 1 && opening.seat !== seat && call.level === 3 && call.strain === opening.call.strain)
    return '弱二后的三阶加叫：通常3+张支持，竞争性或阻击性延长；不逼叫，也不是正常的一阶开叫后限制性邀请';
  if (system === 'sayc' && !genuine && us.length === 1 && opening?.seat === partnerOf(seat)
    && opening.call.strain !== 'NT' && call.strain === opening.call.strain && call.level > opening.call.level
    && enemyBase?.call.level === 1 && enemyBase.call.strain !== 'NT'
    && !auction.some((entry, index) => sideOf(entry.seat) === sideOf(seat) && isTakeoutDoubleAt(auction, index))
    && bidValue(opening.call) - bidValue(all.findLast(entry => entry.index < opening.index)!.call) > 5)
    return `弱跳争叫后的${call.level}${call.strain}加叫：按同伴阻击长套及支持延长阻击或选择定约；不逼叫，不是普通开叫后的限制性邀请`;
  if (genuine && system === 'sayc' && opening?.seat === seat && opening.call.level === 3 && us[1]?.call.strain !== 'NT'
    && us[1]?.call.strain !== opening.call.strain && call.level === 4 && call.strain === opening.call.strain) return '三阶阻击方对新花色逼叫的最低再叫：无应叫花色配合，回到原长套';
  if (genuine && system === 'sayc' && opening?.seat !== seat && opening?.call.level === 3
    && us[1]?.seat === seat && us[1].call.strain === call.strain && major(call.strain) && call.level === 4)
    return '三阶阻击后的强应叫人继续选择自己的高花成局：原新花色应叫已显示实力；不是对同伴阻击低花的加叫';
  if (system === 'sayc' && us.length === 1 && opening?.seat === partnerOf(seat) && opening.call.level === 1
    && lastOpponent?.call.level === 3 && lastOpponent.index > opening.index) {
    if (call.level === 3 && call.strain === 'NT') return '三阶阻击后的自然3NT：12+ HCP、均型或半均型，并有敌方花色止张；进局逼叫';
    if (call.strain === lastOpponent.call.strain) return '三阶阻击后的逼叫扣叫：有进局实力，要求开叫人继续描述牌情';
  }
  if (system === 'sayc' && opening?.seat === seat && opening.call.level === 1 && (opening.call.strain === 'C' || opening.call.strain === 'D')
    && us[1]?.call.level === 3 && us[1].call.strain === 'NT' && call.level === 4 && call.strain === opening.call.strain) return '三阶阻击后3NT应叫之上的自然低花满贯尝试：16+ HCP、6+张开叫低花';
  const competitiveOpening = all[0];
  const partnerConvention = all.length === 2 && all[1]?.seat === partnerOf(seat)
    && all[1].index === all[0].index + 1 ? all[1] : undefined;
  if (system === 'sayc' && competitiveOpening && partnerConvention
    && sideOf(competitiveOpening.seat) !== sideOf(seat)
    && competitiveOpening.call.level === 1 && competitiveOpening.call.strain !== 'NT'
    && partnerConvention.call.level === 2) {
    const michaels = partnerConvention.call.strain === competitiveOpening.call.strain;
    if (michaels && !major(competitiveOpening.call.strain) && major(call.strain)) return 'Michaels应叫：选择同伴已显示的高花；人工扣叫被加倍后仍不得Pass';
    if (michaels && major(competitiveOpening.call.strain)) {
      const shownMajor = competitiveOpening.call.strain === 'H' ? 'S' : 'H';
      if (call.strain === shownMajor) return 'Michaels应叫：选择同伴已显示的另一高花；人工扣叫被加倍后仍不得Pass';
      if (call.strain === 'NT') return 'Michaels 2NT询问：没有三张另一高花，要求同伴说明未明确的低花；人工扣叫被加倍后仍不得Pass';
    }
    if (partnerConvention.call.strain === 'NT') {
      const shown = SUITS.filter(suit => suit !== competitiveOpening.call.strain).slice(0, 2);
      if (call.strain !== 'NT' && shown.includes(call.strain)) return 'Unusual 2NT应叫：在同伴显示的两门最低未叫花色中作出选择；人工2NT被加倍后仍不得Pass';
    }
  }
  const partnerDouble = auction.findLast((entry, index) => entry.seat === partnerOf(seat) && isTakeoutDoubleAt(auction, index));
  const ownDouble = auction.findLast((entry, index) => entry.seat === seat && isTakeoutDoubleAt(auction, index));
  const enemyOpening = all[0] && sideOf(all[0].seat) !== sideOf(seat) ? all[0] : undefined;
  const balancingTakeout = enemyOpening?.call.level === 1 && !!ownDouble
    && auction.indexOf(ownDouble) > enemyOpening.index + 2
    && auction.slice(enemyOpening.index + 1, auction.indexOf(ownDouble)).every(entry => entry.call.kind === 'pass');
  const takeoutMinimum = balancingTakeout ? '9+' : enemyOpening?.call.level && enemyOpening.call.level >= 3 ? '15+'
    : enemyOpening?.call.level === 2 ? '13+' : '12+';
  const negativeResponse = genuine && opening?.seat === seat && opening.call.level === 1
    && opening.call.strain !== 'NT' && us.length === 1
    && auction[opening.index + 1]?.call.kind === 'bid' && (auction[opening.index + 1].call as Bid).strain !== 'NT'
    && (auction[opening.index + 1].call as Bid).level <= 2
    && auction[opening.index + 2]?.seat === partnerOf(seat)
    && auction[opening.index + 2]?.call.kind === 'double'
    && classifyDoubleAt(auction, opening.index + 2, system) === 'negative';
  if (system === 'sayc' && negativeResponse && call.strain !== 'NT') {
    const jump = bidValue(call) - bidValue(all.at(-1)!.call) > 5;
    if (jump && call.strain === opening.call.strain)
      return `负加倍初答中的原套强跳再叫：16–20 HCP、6+张${call.strain}，邀请或直接选择成局；不是最低回套，不因负加倍本身把普通一轮逼叫继续算到下一轮`;
    if (jump && major(call.strain))
      return atGame(call)
        ? `负加倍后的高花成局答叫：4+张${call.strain}支持同伴已询问的未叫高花；按已确认配合的调整支持点选择成局，不机械套用三阶邀请的16–18点范围`
        : `负加倍后的高花强跳答叫：16–18调整支持点、4+张${call.strain}，支持同伴已询问的未叫高花；短门及额外将牌可增值，不要求原始HCP达到16，不是自己的六张原套，也不是最低答叫`;
    if (major(call.strain) && call.strain !== opening.call.strain)
      return `负加倍后的高花答叫：4+张${call.strain}；展示同伴询问的未叫高花，阶数区别最低限与额外实力，不保证五张套`;
    return call.strain === opening.call.strain
      ? `负加倍后再叫开叫套${call.strain}：未找到合适高花或无将；最低回叫不额外保证六张套`
      : `负加倍后自然第二套${call.strain}：通常4+张，继续描述牌型；不是五张高花争叫`;
  }
  const currentConvention = analyzeAuctionSemantics(auction, seat, system).convention;
  if (system === 'sayc' && currentConvention === 'michaels-inquiry' && (call.strain === 'C' || call.strain === 'D'))
    return `Michaels 2NT询问后的低花答叫：显示5+张${call.strain}及此前已示的5+张另一高花；自然回答未明确低花，不是首次争叫或未约定的晚期新套，已履行本轮答叫义务`;
  if (system === 'sayc' && analyzeAuctionSemantics(following, partnerOf(seat), system).convention === 'overcall-cue'
    && call.strain === enemyOpening?.call.strain)
    return '自然争叫后的支持性扣叫：通常10+ HCP及3+张争叫套支持，人工逼叫一轮；敌方再加叫后仍可使用，不承诺敌方花色长度';
  if (system === 'sayc' && (currentConvention === 'weak-jump-inquiry'
    || analyzeAuctionSemantics(following, partnerOf(seat), system).convention === 'weak-jump-inquiry'))
    return us.length === 1 && call.strain === 'NT' ? '弱跳争叫后2NT特征问叫：人工逼叫一轮，询问高低限及旁门A/K；不保证敌方花色止张'
      : us.length === 2 ? call.strain === us[0].call.strain ? '弱跳争叫后2NT问叫的最低回套：5–8 HCP，未显示旁门特征；回到原六张长套'
        : '弱跳争叫后2NT问叫的特征答叫：9–11 HCP及所叫旁门A/K；不保证该旁门四张或五张长度'
      : '弱跳争叫特征问叫后的定约选择：结合已公开高低限与六张原套；不将特征花色当成长套';
  if (system === 'sayc' && currentConvention === 'unusual-advance' && call.strain !== 'NT')
    return 'Unusual 2NT应叫：选择同伴公开的双低花之一，通常只需三张支持；不是五张自然争叫';
  if (system === 'sayc' && currentConvention === 'overcall-cue' && call.strain !== 'NT') {
    const low = Array.from({ length: 7 }, (_, n) => bid(n + 1, call.strain))
      .find(candidate => bidValue(candidate) > bidValue(all.at(-1)!.call));
    return call.strain === us[0]?.call.strain
      ? `支持性扣叫后回到自然争叫套：原争叫5+张；${call.level === low?.level ? '空间抬高后的最便宜回套，履行本轮答叫义务，不额外表示实力，也不额外保证六张' : '最低回叫不额外保证六张，跳回叫表示额外实力'}`
      : `支持性扣叫后描述自然第二套${call.strain}：通常4+张，原争叫套仍为5+张；不是首次五张争叫`;
  }
  if (system === 'sayc' && genuine && opening?.call.level === 1 && opening.call.strain !== 'NT'
    && opening.seat === seat && call.strain === 'NT'
    && auction.some(entry => entry.seat === partnerOf(seat) && entry.call.kind === 'double')) {
    const inferred = noTrumpRangeAt(following, auction.length, system);
    if (inferred) return `负加倍后的自然无将答叫：${inferred.min}–${inferred.max} HCP，均型或适合无将且敌方花色有止张；${inferred.min < 18 && call.level === 2 ? '被迫在二阶回答，不是18–19点的跳再叫' : '阶数结合可用空间描述实力'}`;
  }
  if (system === 'sayc' && enemyOpening && ownDouble && own.length === 0 && call.strain === 'NT') {
    if (call.level === 3 && partner?.call.strain === 'NT' && !isArtificialBidAt(auction, partner.index, system))
      return `技术性加倍后选择3NT：接受同伴自然无将应叫所示的邀请或成局实力；按原技术X范围结合联手点力与可兑现赢墩判断，不额外承诺18+ HCP或均型，可依赖同伴已公开的敌套止张`;
    if (currentConvention === 'takeout-cue' || partner && isArtificialBidAt(auction, partner.index, system)
      && analyzeAuctionSemantics(auction, seat, system).mustBid)
      return `技术性加倍后回答同伴人工扣叫的自然${call.level}NT：适合无将且敌套有止张；原${balancingTakeout ? '平衡位' : ''}技术X通常${takeoutMinimum} HCP，被迫答叫不自动显示18–20或21–22，也不额外承诺18+，本卡未进一步划分此答叫的点力范围`;
    const inferred = noTrumpRangeAt(following, auction.length, system);
    return `技术性加倍后的强牌无将再叫：${inferred ? `${inferred.min}–${inferred.max}` : '18+'} HCP，均型且敌方花色有止张；不是开叫无将范围`;
  }
  if (system === 'sayc' && enemyOpening && ownDouble && own.length === 0 && call.strain !== 'NT') {
    if (auction.slice(auction.indexOf(ownDouble) + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'redouble'))
      return `技术性加倍遭实力再加倍后的${call.level}${call.strain}逃叫：自然选择可用花色，通常4+张；不逼叫，不自动表示17+强牌再叫`;
    if (currentConvention === 'takeout-cue' && call.strain !== enemyOpening.call.strain)
      return `技术性加倍后回答同伴的强扣叫：选择自然未叫套${call.strain}，受空间影响可仅三张，并不额外保证四张或五张；原${balancingTakeout ? '平衡位' : ''}技术X通常${takeoutMinimum} HCP，此处被迫描述不额外表示17+，也不承诺同伴有四张${call.strain}支持；普通一轮逼叫已作答`;
    if (call.strain === enemyOpening.call.strain) return '技术性加倍方再扣敌方花色：人工强牌再叫，要求同伴继续描述；不承诺所叫敌方花色长度';
    if (call.strain === partner?.call.strain) return `技术性加倍方加叫同伴的${call.strain}：通常4+张支持；阶数区别最低限、邀请与成局，不是应叫人的首次应叫`;
    if (major(call.strain) && atGame(call) && partner?.call.strain === 'NT'
      && !isArtificialBidAt(auction, partner.index, system))
      return `技术性加倍后选择自己的长高花${call.level}${call.strain}成局：结合原技术X、同伴自然无将的公开点力及长套赢墩判断，不统一要求本手17+ HCP；同伴无将未保证三张高花支持，是否八张配合仍须结合公开最低长度判断`;
    if (partner && !isArtificialBidAt(auction, partner.index, system)
      && bidValue(partner.call) - bidValue(all.findLast(entry => entry.index < partner.index)!.call) > 5)
      return `技术性加倍后回应同伴的跳应叫邀请：自然描述4+张${call.strain}，按原技术X范围及同伴邀请实力判断；不额外承诺17+ HCP或五张长套，不自动建立进局逼叫`;
    return `先技术性加倍再叫新套${call.strain}：通常17+ HCP、5+张自然长套，显示强牌；不是普通弱争叫`;
  }
  if (system === 'sayc' && enemyOpening && partnerDouble && own.length === 0) {
    if (call.strain === enemyOpening.call.strain) return '技术性加倍后的扣叫应叫：12+ HCP，人工逼叫一轮；要求加倍方继续描述，不承诺敌方花色套';
    if (call.strain === 'NT') return call.level === 1 ? '技术性加倍后的1NT应叫：6–10 HCP均型，敌方花色有止张；不逼叫'
      : call.level === 2 ? '技术性加倍后的2NT应叫：11–12 HCP均型且有止张，邀请进局' : '技术性加倍后的3NT应叫：13–15 HCP均型且有止张，选择成局';
    const low = Array.from({ length: 7 }, (_, n) => bid(n + 1, call.strain)).find(candidate => bidValue(candidate) > bidValue(all.at(-1)!.call));
    if (!analyzeAuctionSemantics(auction, seat, system).mustBid && call.level === low?.level)
      return `技术性加倍后对手继续叫牌时的自由${call.level}${call.strain}应叫：通常6+ HCP及4+张未叫花色；本可Pass，不能当作0点被迫应叫，不逼叫`;
    if (call.level >= 4) return call.level === low?.level
      ? `高阶技术性加倍后的最低${call.level}${call.strain}应叫：选择自己的未叫长套（通常4+张）；${atGame(call) ? '已达到成局阶数' : '受对手阻击抬高，仍可低于成局'}，受空间影响的被迫最低应叫不保证点力`
      : `高阶技术性加倍后的跳应叫${call.level}${call.strain}：最低可叫${low?.level}${call.strain}仍有空间，本次显示额外实力及4+张未叫花色；通常9–11点以上，按支持点、套质与成局阶数判断，不能当作零点的被迫最低应叫`;
    return call.level === low?.level ? '技术性加倍后的最低花色应叫：通常0–8 HCP，尽量选择四张未叫花色；被迫应叫不保证点力'
      : '技术性加倍后的跳应叫：通常9–11 HCP、4+张未叫花色，邀请进局';
  }
  if (system === 'sayc' && enemyOpening && !genuine && opening?.seat === partnerOf(seat)
    && opening.call.strain !== 'NT' && opening.call.strain !== enemyOpening.call.strain
    && us.length === 1 && call.strain === enemyOpening.call.strain) return '自然争叫后的支持性扣叫：10+ HCP、3+张支持争叫花色，逼叫一轮；不承诺所扣敌方花色长度';
  if (system === 'sayc' && !genuine && opening?.call.strain === 'NT'
    && (opening.call.level === 1 || (opening.call.level === 2 && enemyOpening && enemyOpening.call.level >= 2))
    && !auction.slice(opening.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'bid')) {
    const base = opening.call.level + 1;
    const ntLabel = `${opening.call.level}NT`;
    if (opening.call.level === 1 && us.length === 3 && seat !== opening.seat
      && us[1].call.level === base && us[1].call.strain === 'C'
      && us[2].call.level === base && major(us[2].call.strain)
      && major(call.strain) && call.strain !== us[2].call.strain)
      return call.level === base
        ? `${ntLabel}争叫的Stayman答叫后另一高花${call.level}${call.strain}邀请：4+张所叫高花，继续寻找四张配合；不是五张新套或转移，未建立进局逼叫`
        : `${ntLabel}争叫的Stayman答叫后跳级另一高花：本卡未约定固定长度或点力，不能当作五张自然新套`;
    if (us.length === 3 && seat !== opening.seat && us[1].call.level === base
      && (us[1].call.strain === 'D' || us[1].call.strain === 'H')
      && major(call.strain) && call.strain !== (us[1].call.strain === 'D' ? 'H' : 'S') && call.level >= 3)
      return `${ntLabel}争叫的转移后自然第二高花${call.level}${call.strain}：5+张${call.strain}及已示的5+张${us[1].call.strain === 'D' ? 'H' : 'S'}，双高花进局逼叫；不是弱牌逃叫`;
    if (us.length >= 4 && seat === opening.seat && us[1]?.call.level === base
      && (us[1].call.strain === 'D' || us[1].call.strain === 'H')
      && partner?.call.strain === 'NT' && (partner.call.level === 2 || partner.call.level === 3)
      && call.level === 4 && call.strain === (us[1].call.strain === 'D' ? 'H' : 'S'))
      return `${ntLabel}争叫后的转移进局选择：3+张支持搭档已示的五张高花；${partner.call.level === 2 ? '接受邀请，' : ''}选择已知八张配合，不额外承诺自己的六张套`;
    if (us.length === 1 && seat !== opening.seat) {
      if (call.level === base && call.strain === 'C') return `${ntLabel}争叫后的Stayman：至少一门四张高花，逼叫一轮；不是自然梅花逃叫`;
      if (call.level === base && (call.strain === 'D' || call.strain === 'H')) return `${ntLabel}争叫后的Jacoby转移：5+张${call.strain === 'D' ? '红心' : '黑桃'}，要求同伴接受转移；不承诺所叫花色长度`;
      if (base === 2 && call.level === 2 && call.strain === 'S') return '1NT争叫后的低花逃叫：要求3♣，随后可Pass或改3♦；人工接力，不是自然黑桃';
      if (call.strain === 'NT') {
        const ntRange = noTrumpRangeAt(auction, opening.index, system);
        const minimum = ntRange?.min ?? 15;
        return call.level === 2 ? `${ntLabel}争叫后的自然2NT：通常${23 - minimum}–${24 - minimum} HCP，按已公开${ntRange ? `${ntRange.min}–${ntRange.max}` : '15–18'}点范围邀请成局`
          : call.level === 3 ? `${ntLabel}争叫后的自然3NT：通常${25 - minimum}+ HCP，按已公开无将范围选择成局`
            : `${ntLabel}争叫后的自然${call.level}NT：按已公开无将范围${call.level >= 6 ? '选择无将满贯定约' : '邀请大满贯'}；不按3NT成局应叫解释`;
      }
    }
    if (us.length === 2 && seat === opening.seat) {
      const request = us[1].call;
      if (request.level === base && request.strain === 'C') return call.level === base && call.strain === 'D'
        ? `${ntLabel}争叫后的Stayman答叫：否认四张高花；方块为人工回答`
        : call.level === base && major(call.strain) ? `${ntLabel}争叫后的Stayman答叫：4+张${call.strain}，继续寻找高花配合`
          : `非约定Stayman答叫${call.level}${call.strain}：${ntLabel}争叫后须用${base}D、${base}H或${base}S回答；未约定其他答叫的长度或点力`;
      if (request.level === base && (request.strain === 'D' || request.strain === 'H')) return call.level === base && call.strain === (request.strain === 'D' ? 'H' : 'S')
        ? `${ntLabel}争叫后的Jacoby转移接受：不额外承诺三张支持或六张长套`
        : `非约定转移答叫${call.level}${call.strain}：${ntLabel}争叫后须接受到${base}${request.strain === 'D' ? 'H' : 'S'}；未约定超接受或其他答叫的点力、长度`;
      if (base === 2 && request.level === 2 && request.strain === 'S') return call.level === 3 && call.strain === 'C'
        ? '低花逃叫接力的3♣答叫：不保证梅花长度，允许同伴Pass或改3♦'
        : `非约定低花逃叫接力答叫${call.level}${call.strain}：本卡要求3♣，未约定其他答叫的点力或长度`;
    }
  }
  if (system === 'sayc' && !genuine && opening?.call.strain === 'NT'
    && us[1]?.call.level === 2 && us[1].call.strain === 'S'
    && us[2]?.call.level === 3 && us[2].call.strain === 'C'
    && us.length === 3 && us[1].seat === seat && call.level === 3 && call.strain === 'D')
    return '低花逃叫接力后的3♦改叫：自然方块长套，选择部分定约、不逼叫；3♣接力已经回答，不再保留人工应叫义务';
  if (system === 'sayc' && all.length === 1 && enemyOpening && auction.length === enemyOpening.index + 3
    && auction.slice(enemyOpening.index + 1).every(entry => entry.call.kind === 'pass') && call.strain === 'NT' && call.level === 1) return '平衡位1NT：11–14 HCP均型，敌方开叫花色有止张；不是直接15–18点的1NT争叫';
  const opposingOpening = all.length === 1 && sideOf(all[0].seat) !== sideOf(seat)
    && auction.length === all[0].index + 1 ? all[0] : undefined;
  if (system === 'sayc' && opposingOpening?.call.level === 1 && opposingOpening.call.strain === 'NT'
    && call.level === 2 && call.strain === 'NT') return '对1NT的双低花争叫：5+张梅花及5+张方块，人工叫品；不是自然无将';
  if (system === 'sayc' && opposingOpening && opposingOpening.call.level >= 2 && opposingOpening.call.level <= 3
    && call.strain === 'NT') return `对阻击的自然${call.level}NT争叫：15–18 HCP、均型及敌方花色止张；后续Stayman和高花转移继续使用`;
  if (system === 'sayc' && opposingOpening && opposingOpening.call.level >= 2 && opposingOpening.call.level <= 3
    && opposingOpening.call.strain !== 'NT' && call.strain !== 'NT' && call.strain !== opposingOpening.call.strain
    && bidValue(call) - bidValue(opposingOpening.call) <= 5)
    return `对阻击的首次自然${call.level}${call.strain}非跳争叫：5+张可用花色；二阶通常10–16 HCP，更高阶需要足够实力和套质；不是尚未约定的晚期续叫`;
  if (system === 'sayc' && opposingOpening?.call.level === 1 && opposingOpening.call.strain !== 'NT') {
    if (call.level === 2 && call.strain === opposingOpening.call.strain) return major(call.strain)
      ? 'Michaels扣叫：5+张另一高花及5+张未明确低花'
      : 'Michaels扣叫：两门高花各5+张';
    if (call.level === 2 && call.strain === 'NT') return 'Unusual 2NT：两门最低未叫花色各5+张';
    const naturalLevel = call.strain !== 'NT' && bidValue(bid(1, call.strain)) > bidValue(opposingOpening.call) ? 1 : 2;
    if (call.strain !== 'NT' && call.level > naturalLevel) return 'SAYC弱跳争叫：按同阶阻击开叫的牌力、长度与花色质量处理';
    if (call.strain === 'NT') return 'SAYC 1NT争叫：15–18 HCP均型，并有开叫花色止张';
    return naturalLevel === 1 ? 'SAYC一阶自然争叫：5+张，8–16 HCP' : 'SAYC二阶自然争叫：5+张，10–16 HCP；不是强2♣开叫';
  }
  if (system === 'sayc' && enemyOpening && call.strain !== 'NT'
    && auction.every(entry => sideOf(entry.seat) !== sideOf(seat) || entry.call.kind === 'pass')
    && !all.some(entry => entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system))) {
    const lastNaturalBid = all.at(-1)!;
    const cheapest = Array.from({ length: 7 }, (_, n) => bid(n + 1, call.strain))
      .find(candidate => bidValue(candidate) > bidValue(lastNaturalBid.call));
    const balancing = auction.length === lastNaturalBid.index + 3
      && auction.slice(lastNaturalBid.index + 1).every(entry => entry.call.kind === 'pass');
    return call.level === cheapest?.level
      ? `${balancing ? '平衡位' : '敌方开叫或应叫之后的'}首次${call.level === 1 ? '一阶' : `${call.level}阶`}自然争叫：5+张${call.strain}；${call.level === 1 ? '直接位通常8–16 HCP' : '直接位通常10–16 HCP及较好套'}${balancing ? '，平衡位可适当减低点力要求' : ''}；本方此前仅Pass，不是已有本方自然叫牌后的晚期续叫`
      : `首次自然跳争叫${call.level}${call.strain}：按同阶阻击开叫的弱牌点力、长度和套质处理；不是未约定的后续新花色`;
  }
  if (opening?.call.level === 1 && major(opening.call.strain) && call.level === 2 && call.strain === opening.call.strain
    && us.length >= 3 && us[1]?.seat === seat && us[1].call.level === 1
    && us[2].call.level === 2 && us[2].call.strain !== opening.call.strain) return 'SAYC回叫开叫高花的弱牌偏好或支持：可仅两张，也可有三张或更多支持；两张时可选择5-2配合止叫，三张以上与公开五张高花构成八张配合，不自动宣称恰好两张';
  if (system === 'sayc' && opening?.call.level === 1 && major(opening.call.strain) && us.length === 3
    && us[1]?.seat === seat && us[1].call.level === 2 && us[1].call.strain !== 'NT'
    && us[2].seat === opening.seat && us[2].call.level <= 3 && us[2].call.strain !== opening.call.strain
    && call.strain === opening.call.strain) return call.level === 4
      ? '选择开叫高花为将牌：应叫人3+张支持与开叫人5+张构成至少8张配合；按SAYC二盖一后的公开点力下限叫到成局'
      : '回到开叫高花：3+张支持构成至少8张配合，优先于对开叫人第二套的三张支持';
  if (!all.length) {
    if (system === 'sayc' && call.level === 3 && call.strain === 'NT') return 'SAYC 3NT开叫：25–27 HCP均型';
    if (call.strain !== 'NT' && call.level === 3) return system === 'sayc' ? '三阶阻击开叫：通常5–10 HCP、7+张且套质合格' : '三阶阻击开叫：通常弱牌、7+张长套';
    if (call.strain !== 'NT' && call.level === 4) return system === 'sayc' ? '四阶阻击开叫：通常5–10 HCP、8+张长套' : '四阶阻击开叫：通常弱牌、8+张长套';
    if (call.level >= 3) return `${call.level}${call.strain}不是当前体系定义的常规开叫；手动选择不承诺精确点力或牌型`;
    if (system === 'precision') return call.strain === 'C' && call.level === 1 ? '强梅花，16+ HCP，人为逼叫' : call.strain === 'NT' ? call.level === 1 ? '13–15 HCP 均型，无5张高花' : '22–23 HCP 均型' : call.level === 1 && major(call.strain) ? '11–15 HCP，5+张高花' : call.level === 1 ? '11–15 HCP，2+张方块' : call.strain === 'C' ? '11–15，6+梅花或5梅花＋4张高花' : call.strain === 'D' ? '11–15，短方块指定牌型' : '6–10 HCP，6+张弱二';
    return call.strain === 'NT' ? call.level === 1 ? '15–17 HCP均型；自然1NT开叫' : '20–21 HCP均型；自然2NT开叫' : call.level === 2 && call.strain === 'C' ? '22+ HCP强2♣；人工逼叫，2♦为等待应叫' : call.level === 2 ? system === 'sayc' ? '5–11 HCP、通常6+张且套质合格的弱二开叫' : '6–10 HCP、6+张的弱二开叫' : call.level === 1 ? major(call.strain) ? system === 'sayc' ? '自然一阶高花开叫：5+张，通常13–21 HCP；12 HCP须满足Rule of 20' : '自然一阶高花开叫：5+张，约12–21 HCP' : system === 'sayc' ? `自然一阶${call.strain}开叫：通常3+张、13–21 HCP；12 HCP须满足Rule of 20` : `自然一阶${call.strain}开叫：通常3+张、约12–21 HCP` : '自然阻击开叫';
  }
  if (opening && clean) {
    const base = opening.call.level + 1;
    if (opening.call.strain === 'NT' && us.length === 1) {
      if (call.level === base && call.strain === 'C') return 'Stayman，问4张高花';
      if (call.level === base && call.strain === 'D') return 'Jacoby转移，5+张红心';
      if (call.level === base && call.strain === 'H') return 'Jacoby转移，5+张黑桃';
      if (call.strain === 'NT') return call.level === 2 ? '1NT后的自然2NT邀请：8–9 HCP均型；不逼叫'
        : `自然${call.level}NT：根据已公开的无将范围选择${call.level >= 6 ? '无将满贯定约' : call.level === 5 ? '大满贯邀请' : '无将成局'}；${call.level === 5 ? '允许按范围接受或Pass' : '原则上止叫'}`;
    }
    if (us.length === 1 && system === 'precision' && opening.call.strain === 'C' && opening.call.level === 1) return call.strain === 'D' && call.level === 1 ? '0–7 HCP，强梅花负应叫' : '8+ HCP，强梅花正应叫，进局逼叫';
    if (opening.call.level === 1 && major(opening.call.strain) && us.length === 1 && call.strain === 'NT' && call.level === 2) return 'Jacoby 2NT：4+张高花支持、13+调整支持点，进局逼叫';
    if (opening.call.level === 1 && major(opening.call.strain) && us.length === 1 && call.strain === 'NT' && call.level === 1 && system === 'sayc') return 'SAYC＋2/1半逼叫1NT：5–12 HCP；均型最低限开叫人可以Pass，非均型开叫人继续描述';
    if (opening.call.level === 1 && major(opening.call.strain) && us.length === 1 && call.strain === 'NT' && call.level === 1 && system === 'two-over-one') return passedBefore(auction, seat, opening.index) ? 'Pass过的手牌，1NT不逼叫' : '6–12 HCP，1NT逼叫一轮';
    if (us.length === 1 && (system === 'two-over-one' || system === 'sayc') && twoOverOne(opening, { seat, call, index: auction.length }, auction)) return `二盖一：13+ HCP、${call.strain === 'C' ? '3' : call.strain === 'D' ? '4' : '5'}+张${call.strain}，未Pass且无干扰，建立进局逼叫；本方到局前不得Pass`;
    if (us.length === 1 && opening.call.level === 1 && call.strain !== 'NT') {
      if (call.strain === opening.call.strain) return call.level === 2 ? `简单加叫：通常6–9${major(call.strain) ? '支持点，3+张支持开叫花色' : '点，通常4+张自然低花支持或偏好；开叫仅保证三张时，确认八张配合需5+张支持，未确认前不计短门点'}；不逼叫`
        : call.level === 3 ? `限制性跳加叫：通常10–12支持点，${major(call.strain) ? '3+张支持' : '通常5+张支持以确认八张低花配合'}；邀请进局`
          : call.level === gameLevel(call.strain) ? `封局加叫：确认${major(call.strain) ? '至少3张' : '通常5张'}支持并直接叫到成局；原则上止叫，不是满贯邀请`
            : `非常规跳加叫至${call.level}${call.strain}：不属于本体系的标准响应；手动选择不承诺固定点力范围`;
      if (call.level === 1) return `一盖一自然应叫：6+ HCP、4+张${call.strain}；${passedBefore(auction, seat, opening.index) ? '已Pass的应叫人限制牌力，通常不逼叫' : '逼叫一轮'}`;
      if (system === 'sayc' && call.level === 2) return `二阶新花色自然应叫：10+ HCP、通常4+张${call.strain}；${passedBefore(auction, seat, opening.index) ? '过手牌限制实力，通常不逼叫，不是二盖一进局逼叫' : '逼叫一轮'}`;
    }
    if (us.length === 1 && opening.call.level === 1 && (opening.call.strain === 'C' || opening.call.strain === 'D') && call.strain === 'NT') {
      if (call.level === 1) return '自然1NT应叫：通常6–10 HCP，通常均型或半均型，也可用不够二盖一进局逼叫实力的长低花牌作限制性描述；否认可在一阶叫出的四张高花，不逼叫';
      if (call.level === 2 && system === 'sayc') return '修正SAYC自然2NT应叫：11–12 HCP均型、无可在一阶应叫的四张高花，邀请进局、不逼叫；5-3-3-2即使有五张开叫低花支持也优先定量描述，本卡不采用倒置低花加叫';
      if (call.level === 3 && system === 'sayc') return '修正SAYC自然3NT应叫：13+ HCP均型，通常13–15、无四张高花；更强而无合适真实新套时也可直接成局，原则上止叫；5-3-3-2即使有5张开叫低花支持仍优先定量NT，本卡不采用倒置低花加叫';
    }
    if (opening.seat === seat && us.length === 2 && opening.call.strain !== 'NT') {
      const response = us[1].call;
      if (call.strain === 'NT') {
        if (call.level === 1) return system === 'sayc' ? '开叫人自然1NT再叫：12–14 HCP均型（12点须符合Rule of 20），限制性再叫' : '开叫人最低限自然1NT再叫：均型，限制性范围';
        if (call.level === 2 && us[1] && twoOverOne(opening, us[1], auction)) return '二盖一进局逼叫中的自然2NT再叫：均型，12–21 HCP的未细分范围；并不额外承诺18–19点，进局逼叫继续';
        if (system === 'sayc' && response.level === 2 && response.strain !== 'NT'
          && response.strain !== opening.call.strain && passedBefore(auction, us[1].seat, opening.index)) {
          if (call.level === 2) return '已Pass应叫人自然二阶新套后的最低2NT再叫：12–14 HCP均型、无合适花色配合；受叫牌空间抬高，不是18–19点跳再叫，自然限制性且不逼叫';
          if (call.level === 3) return '已Pass应叫人自然二阶新套后的3NT再叫：18–21 HCP均型或适合无将，结合应叫人已示10+实力直接选择成局；不是最低2NT的12–14范围';
        }
        if (call.level === 2) return system === 'sayc' ? '开叫人跳再叫2NT：18–19 HCP均型；邀请搭档判断进局或满贯' : '开叫人自然2NT再叫：显示额外点力和均型牌';
        if (call.level === 3 && response.strain === 'NT') return '开叫人接受自然无将应叫，选择3NT成局；不表示花色支持张数';
      }
      if (call.strain === opening.call.strain && response.strain === opening.call.strain) return `开叫人对同伴加叫的${call.level}${call.strain}再叫：已找到花色配合；${atGame(call) ? '接受邀请或直接选择成局' : '显示额外实力，邀请进局'}，不额外承诺六张套`;
      if (call.strain === opening.call.strain && major(call.strain) && call.level === 4)
        return `开叫人原高花${call.level}${call.strain}直接成局：通常6+张、较长或有足够套质及实力；原则上止叫，不是三阶邀请，不承诺同伴已经支持该套`;
      if (opening.call.level === 2 && opening.call.strain !== 'C' && call.strain === opening.call.strain)
        return `弱二后回到原套${call.level}${call.strain}：维持弱二已示的6+张，不降为五张例外；履行新套应叫的一轮义务，未建立新的进局逼叫`;
      if (call.strain === opening.call.strain) return twoOverOne(opening, us[1], auction)
        ? major(call.strain) ? `二盖一逼局中的原高花再叫：保证开叫时的5+张，不额外保证六张；进局逼叫继续`
          : `二盖一逼局中的原低花再叫：自然强调开叫低花；进局逼叫继续，不是高花五张套`
        : `开叫人再叫原花色：通常6+张${call.strain}，最低限无合适再叫时可能只有五张；${call.level >= 3 && opening.call.level === 1 ? '跳再叫通常16–20 HCP，邀请成局' : '限制性自然再叫'}，${system === 'sayc' && major(opening.call.strain) && response.level === 1 && response.strain === 'NT' && !passedBefore(auction, us[1].seat, opening.index) ? '半逼叫1NT允许最低限均型开叫人Pass；非均型开叫人有继续描述的义务，本次履行该义务，不自动建立新的持续逼叫' : analyzeAuctionSemantics(auction, seat, system).mustBid ? '履行本轮应叫义务，不自动延续一轮逼叫' : '此前没有继续叫牌义务，自然选择再叫，不建立新的逼叫'}`;
      if (call.strain === response.strain) {
        if (twoOverOne(opening, us[1], auction) && major(response.strain)) return call.level === 3
          ? '二盖一后的慢到局加叫：3+张支持、15+ HCP，保留满贯探索空间；进局逼叫继续'
          : '二盖一后的快到局加叫：3+张支持、最低限12–14 HCP，选择高花成局；额外实力较少';
        return `开叫人支持应叫花色：${response.level === 1 ? '4' : major(response.strain) ? '3' : '4'}+张支持；阶数表示最低限、邀请或进局实力${analyzeAuctionSemantics(following, partnerOf(seat), system).forcing === 'game' && !atGame(call) ? '；原有进局逼叫仍继续，双方到局前不得Pass' : ''}`;
      }
      if (call.level >= 2 && !atGame(call) && call.strain !== 'NT' && response.level === 1
        && bidValue(call) - bidValue(response) > 5) return `开叫人强跳移叫：通常19+ HCP、4+张${call.strain}；原高花5+张，原低花4+张且可与第二套等长；建立进局逼叫，不能Pass在此部分定约`;
      if (call.level === 2 && call.strain !== 'NT' && response.level === 1
        && bidValue(bid(1, call.strain)) > bidValue(opening.call)) return `开叫人逆叫：17+ HCP、4+张${call.strain}，原花色通常更长；强4-4-4-1手牌可两套等长，逼叫一轮`;
      if (call.strain !== 'NT') return system === 'sayc' && major(opening.call.strain) && response.level === 1 && response.strain === 'NT'
        ? `开叫人自然再叫第二套${call.strain}：通常4+张；显示5张开叫高花和通常4张第二套；低花可能只有3张，避免以不足17点的牌逆叫2♠，履行半逼叫1NT后的描述`
        : `开叫人自然再叫第二套${call.strain}：通常4+张；进一步描述牌型${analyzeAuctionSemantics(following, partnerOf(seat), system).forcing === 'game' && !atGame(call) ? '；原有进局逼叫仍继续，双方到局前不得Pass' : ''}`;
    }
    if (system === 'precision' && opening.call.level === 2 && opening.call.strain === 'C' && us.length === 1 && call.level === 2 && call.strain === 'D') return '精确2♣后2♦问高花';
    if (system === 'precision' && opening.call.level === 2 && opening.call.strain === 'D' && us.length === 1 && call.level === 2 && call.strain === 'NT') return '精确短方块2♦后2NT问牌型';
  }
  if (call.level === 4 && call.strain === 'NT') return '已有明确将牌配合则RKCB 1430关键张问叫；无将中为定量邀请';
  const ownBids = us.filter(entry => entry.seat === seat);
  const partnerBid = [...us].reverse().find(entry => entry.seat === partnerOf(seat));
  const forcedBeforeCall = analyzeAuctionSemantics(auction, seat, system).mustBid;
  const continuesGameForce = analyzeAuctionSemantics(following, partnerOf(seat), system).forcing === 'game' && !atGame(call);
  const gameReached = atGame(call);
  const responderLaterNewSuit = system === 'sayc' && genuine && opening?.call.level === 1
    && opening.call.strain !== 'NT' && opening.seat === partnerOf(seat)
    && call.level === 3 && call.strain !== 'NT' && call.strain !== opening.call.strain
    && partnerBid?.seat === opening.seat && partnerBid.index > opening.index
    && call.strain !== partnerBid.call.strain
    && !us.some(entry => entry.seat === seat && entry.call.strain === call.strain
      && !isArtificialBidAt(auction, entry.index, system))
    && !all.some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === call.strain
      && !isArtificialBidAt(auction, entry.index, system))
    && (ownBids.some(entry => entry.call.level === 1 && entry.call.strain !== 'NT')
      || auction.some((entry, index) => entry.seat === seat && classifyDoubleAt(auction, index, system) === 'negative'));
  if (responderLaterNewSuit)
    return `应叫人在开叫人自然再叫后的三阶新套${call.strain}：通常10+ HCP、5+张自然套；${passedBefore(auction, seat, opening.index) ? '已Pass手牌限制实力，不逼叫' : '未Pass手牌逼叫一轮，要求开叫人继续描述'}；六张以上长套可按套质与可兑现赢墩酌减点力，但不能自动认定进局逼叫`;
  if (system === 'sayc' && analyzeAuctionSemantics(following, partnerOf(seat), system).convention === 'responder-second-suit')
    return `一盖一后应叫人自然描述第二套${call.strain}：4+张；未Pass的自然新套续叫逼叫一轮，要求开叫人继续描述，不是人工新低花或未约定叫品`;
  if (genuine && system === 'sayc' && opening?.call.level === 1 && opening.call.strain !== 'NT'
    && us.length === 3 && seat !== opening.seat && us[1].call.level === 1 && major(us[1].call.strain)
    && call.strain === us[1].call.strain && bidValue(call) - bidValue(us[2].call) > 5)
    return call.level === 4 ? `应叫人原高花4${call.strain}直接成局：13+ HCP及6+张自己的长套；不是对低花的加叫，不承诺开叫人高花支持或已知八张配合`
      : call.level === 3 ? `应叫人原高花3${call.strain}跳再叫：通常10–12 HCP及6+张自己的套，邀请成局；不是支持加叫，不自动建立进局逼叫`
        : `应叫人原高花${call.level}${call.strain}再叫：自然强调自己的长套；最低再叫不建立新的进局逼叫，不承诺同伴已支持`;
  if (genuine && opening?.call.level === 2 && opening.call.strain === 'C' && seat === opening.seat
    && us.length === 4 && secondNegative(us, 3, system) && call.strain === us[2].call.strain)
    return `强2♣后履行二次负应叫的原套再叫：原${major(call.strain) ? `高花${call.strain}仅保证5+张` : `低花${call.strain}通常5+张，强4-4-4-1例外可仅四张`}；最低限原套再叫解除进局义务，允许同伴Pass；不额外保证六张`;
  if (genuine && opening?.call.level === 1 && opening.call.strain !== 'NT' && opening.seat === seat
    && ownBids.length === 1 && call.strain !== 'NT' && call.strain !== opening.call.strain
    && !us.some(entry => entry.seat === partnerOf(seat) && entry.call.strain === call.strain
      && !isArtificialBidAt(auction, entry.index, system))
    && !all.some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.strain === call.strain)) {
    if (us[1]?.call.level === 1 && call.strain !== us[1].call.strain && !atGame(call)
      && bidValue(call) - bidValue(all.at(-1)!.call) > 5)
      return `开叫人在竞争中的强跳移叫：19+ HCP、4+张${call.strain}；原高花5+张，原低花4+张且可等长；建立进局逼叫，不是最低第二套描述`;
    if (call.level === 2 && call.strain !== us[1]?.call.strain
      && bidValue(bid(1, call.strain)) > bidValue(opening.call))
      return `开叫人在竞争中的逆叫：17+ HCP、4+张${call.strain}，原套通常较长；强4-4-4-1手牌允许两套等长，表示额外实力，不是最低第二套，不自动把已Pass同伴当作新进局逼叫的应叫人`;
    return `开叫人在竞争中自然描述第二套${call.strain}：通常4+张；不是首次五张争叫，阶数结合空间及先前点力描述`;
  }
  if (system === 'sayc' && genuine && opening?.call.strain === 'NT' && us.length === 1
    && seat !== opening.seat && call.level === 2 && call.strain !== 'NT'
    && lastOpponent && call.strain !== lastOpponent.call.strain
    && !isArtificialBidAt(following, auction.length, system))
    return `无将受争叫后的二阶自然新套${call.strain}：5+张自己的长套，竞争性不逼叫；不是无干扰的Stayman或转移，不自动承诺三阶进局逼叫的10+实力`;
  if (system === 'sayc' && genuine && opening?.call.strain === 'NT' && us.length === 1
    && seat !== opening.seat && call.level === 3 && call.strain !== 'NT'
    && analyzeAuctionSemantics(following, partnerOf(seat), system).convention === 'nt-competitive-response'
    && !isArtificialBidAt(following, auction.length, system))
    return `无将受争叫后的三阶自然新套${call.strain}：10+ HCP、5+张，建立进局逼叫；不是未约定的后续竞争叫，也不是二阶弱牌逃叫`;
  if (clean && opening?.call.level === 1 && major(opening.call.strain) && us[1]?.call.level === 1
    && us[1].call.strain === 'NT' && us.length === 3 && seat !== opening.seat
    && call.strain !== 'NT' && call.strain !== opening.call.strain && call.strain !== us[2].call.strain)
    return analyzeAuctionSemantics(auction, seat, system).forcing === 'game'
      ? `强跳移叫建立逼局后自然描述6+张${call.strain}：进局逼叫继续，不是弱牌止叫`
      : call.level === 2 ? `半逼叫1NT后的${call.level}${call.strain}改叫：弱牌、通常6+张自己的套，选择部分定约；不逼叫`
      : bidValue(call) - bidValue(all.at(-1)!.call) > 5
        ? `半逼叫1NT后的长套跳再叫：通常10–12 HCP及6+张${call.strain}，邀请成局；不是弱牌偏好`
        : `半逼叫1NT后的${call.level}${call.strain}三阶长套描述：通常6+张，可能在二阶无空间时为弱牌逃叫；不是跳再叫，不自动承诺邀请实力`;
  if (!genuine && opening && opening.call.strain !== 'NT' && !ownDouble && !partnerDouble
    && ownBids.length === 0 && call.strain !== 'NT'
    && call.strain !== opening?.call.strain && call.strain !== all[0]?.call.strain)
    return '自然争叫后的新花色应叫：通常8+ HCP、5+张；建设性但不逼叫，支持性扣叫才要求争叫人继续';
  if (call.strain === 'NT') {
    const purpose = currentConvention === 'fourth-suit' ? '自然回答第四花色询问，描述止张及最低限实力；不套用跳再叫点力，也不自动承诺成局邀请'
      : call.level === 1 ? '部分定约或限制性再叫'
      : call.level === 2 ? '邀请或额外实力描述'
        : call.level === 3 ? '选择无将成局并原则上止叫'
          : call.level === 5 ? '自然大满贯邀请' : call.level >= 6 ? '无将满贯定约' : '满贯定量邀请';
    const partnerNtStopper = partnerBid?.call.strain === 'NT' && !isArtificialBidAt(auction, partnerBid.index, system);
    const stopper = lastOpponent ? partnerNtStopper ? '，可依赖同伴自然无将已公开的敌套止张，不额外保证本手也有止张' : '，并保证对手已示花色至少一止张' : '';
    const inferred = noTrumpRangeAt(following, auction.length, system);
    const points = inferred ? `${inferred.min}–${inferred.max} HCP；` : '';
    const reverseContext = currentConvention === 'reverse' && call.level === 2
      ? '这是逆叫后的自然最低限或邀请性答叫，履行逆叫的一轮应叫义务；不是低花直接2NT的11–12邀请，未采用人工Blackout范围；' : '';
    return `自然${call.level}NT：${points}${reverseContext}适合无将，可为均型或半均型，也可凭可兑现长套选择实牌定约${stopper}；用途为${purpose}${continuesGameForce ? '，进局逼叫仍未解除' : ''}`;
  }
  if (genuine && opening?.call.level === 1 && !major(opening.call.strain) && opening.call.strain !== 'NT'
    && seat !== opening.seat && us.length === 3 && call.strain === opening.call.strain
    && us[1].call.strain !== opening.call.strain && us[2].call.strain !== opening.call.strain
    && call.level === 2)
    return `回到开叫低花${call.level}${call.strain}的最低偏好或支持：可只有两三张，也可有四张或更多支持；是否确认八张配合按本手与同伴公开长度判断，不能仅凭此叫品认定没有配合${continuesGameForce ? '；进局逼叫继续' : '；最低回套不建立新逼叫，更强手牌须另作强度描述'}`;
  if (currentConvention === 'fourth-suit' && genuine && opening?.seat === seat
    && us[1]?.call.strain === call.strain && major(call.strain))
    return `第四花色询问后的迟到高花支持${call.level}${call.strain}：可仅3张支持同伴的一阶自然高花；这是支持或偏好，不承诺自己的四张第二套，同伴此前仅保证四张时仍不能自动确认八张配合${continuesGameForce ? '；原有进局逼叫继续' : '；已履行本轮询问义务，不自动建立新逼叫'}`;
  if (system === 'sayc' && genuine && opening?.seat === seat && ownBids.length === 1
    && partnerBid?.call.level === 1 && major(partnerBid.call.strain) && call.strain === partnerBid.call.strain
    && !isArtificialBidAt(auction, partnerBid.index, system) && call.level <= 3
    && lastOpponent && lastOpponent.index > partnerBid.index) {
    const partnerMinimum = naturalSuitMinimum(auction, partnerOf(seat), call.strain as Suit, system);
    return `开叫人在敌方继续叫牌后的竞争性高花支持${call.level}${call.strain}：可仅3张支持；同伴公开${partnerMinimum}+张高花，${partnerMinimum >= 5 ? '三张支持可确认八张配合' : '同伴仅示四张时仍可能只有七张配合，不自动认定八张'}；不是自己的自然第二套，不套用安静叫牌的四张支持承诺`;
  }
  const partnerSuitBid = [...us].reverse().find(entry => entry.seat === partnerOf(seat)
    && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system));
  if (partnerSuitBid) {
    // A raise describes the public natural suit, including a return to an
    // earlier suit. A minimum forced repeat must retain its five-card exception.
    const partnerNatural = us.filter(entry => entry.seat === partnerOf(seat)
      && entry.call.strain === call.strain && !isArtificialBidAt(auction, entry.index, system));
    const firstPartnerSuit = partnerNatural[0];
    const partnerOpened = opening?.seat === partnerOf(seat) && opening.call.strain === call.strain;
    let partnerMinimum: number | undefined = naturalSuitMinimum(auction, partnerOf(seat), call.strain as Suit, system) || undefined;
    let minimumRepeatPreference = false;
    if (partnerMinimum === undefined && partnerOpened && genuine) partnerMinimum = opening.call.level === 1 ? major(call.strain) ? 5 : 3
      : opening.call.level === 2 && opening.call.strain !== 'C' ? 6 : opening.call.level === 3 ? 7 : opening.call.level === 4 ? 8 : undefined;
    else if (partnerMinimum === undefined && !genuine && firstPartnerSuit.index === opening?.index) {
      const before = entries(auction.slice(0, firstPartnerSuit.index)).at(-1);
      const jumped = before && bidValue(firstPartnerSuit.call) - bidValue(before.call) > 5;
      partnerMinimum = jumped ? firstPartnerSuit.call.level === 2 ? 6 : firstPartnerSuit.call.level === 3 ? 7 : 8 : 5;
    } else if (partnerMinimum === undefined && genuine && opening?.call.level === 2 && opening.call.strain === 'C') partnerMinimum = 5;
    else if (partnerMinimum === undefined && genuine && opening?.call.strain === 'NT') partnerMinimum = major(call.strain) ? 4 : undefined;
    else if (partnerMinimum === undefined && genuine && opening?.call.level === 1) partnerMinimum = firstPartnerSuit.call.level === 1 ? 4
      : opening.seat === firstPartnerSuit.seat && major(opening.call.strain)
        && us[1]?.call.strain === 'NT' && firstPartnerSuit.call.level === 2 && !major(call.strain) ? 3 : 4;
    // A free strong new-suit rebid after takeout has its own five-card promise.
    // A forced cuebid answer or a redouble escape must not inherit that promise.
    if (system === 'sayc' && partnerDouble && enemyOpening && firstPartnerSuit.call.strain !== enemyOpening.call.strain
      && auction.indexOf(partnerDouble) < firstPartnerSuit.index
      && !us.some(entry => entry.seat === partnerOf(seat) && entry.index < firstPartnerSuit.index)
      && analyzeAuctionSemantics(auction.slice(0, firstPartnerSuit.index), partnerOf(seat), system).convention !== 'takeout-cue'
      && !auction.slice(auction.indexOf(partnerDouble) + 1, firstPartnerSuit.index)
        .some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind === 'redouble'))
      partnerMinimum = 5;
    // Jump replies to a negative double, and natural original-suit jumps,
    // publicly promise six. Minimum answers to a double do not.
    if (partnerOpened && opening.call.level === 1 && partnerNatural.length > 1) {
      const before = entries(auction.slice(0, partnerSuitBid.index)).at(-1);
      const jumped = before && bidValue(partnerSuitBid.call) - bidValue(before.call) > 5;
      const negative = auction[opening.index + 2]?.call.kind === 'double'
        && classifyDoubleAt(auction, opening.index + 2, system) === 'negative'
        && partnerNatural.length === 2;
      if (jumped) partnerMinimum = Math.max(partnerMinimum ?? 0, 6);
      else if (!negative && !(us[1] && twoOverOne(opening, us[1], auction))) {
        if (partnerMinimum === undefined) partnerMinimum = 5;
        minimumRepeatPreference = partnerMinimum >= 5;
      }
    }
    // A strong jump shift can disclose four cards in the original minor,
    // including 4-4-4-1; it does not necessarily disclose five.
    if (partnerOpened && genuine && opening.call.level === 1 && !major(call.strain) && us[1]?.call.level === 1
      && us.some(entry => entry.seat === opening.seat && entry.call.strain !== call.strain && entry.call.strain !== 'NT'
        && entry.call.level >= 2 && bidValue(entry.call) - bidValue(entries(auction.slice(0, entry.index)).at(-1)!.call) > 5))
      partnerMinimum = Math.max(partnerMinimum ?? 0, 4);
    const support = minimumRepeatPreference
      ? '支持或偏好同伴反复显示的长套，可仅两三张；普通最低回套仍有五张例外，不自动确认八张配合'
      : partnerMinimum !== undefined ? `同伴公开${partnerMinimum}+张自然套；确认八张配合时自己只需${Math.max(1, 8 - partnerMinimum)}+张支持，不固定套用高花三张或低花四张`
        : '选择同伴此前自然花色；此序列未约定固定支持张数，不能自动确认八张配合';
    const purpose = gameReached ? '叫到成局或更高阶并原则上止叫' : call.level === 3 ? '竞争性或邀请性加叫' : '部分定约加叫';
    const originallyRaisedPartner = ownBids[0]?.call.strain === opening?.call.strain && ownBids[0]?.seat !== opening?.seat;
    if (!originallyRaisedPartner && ownBids.some(entry => entry.call.strain === call.strain)) return `自然再叫${call.level}${call.strain}：回到自己已显示的花色；${purpose}${continuesGameForce ? '，进局逼叫仍继续' : ''}`;
    return `自然支持${call.level}${call.strain}：${support}；${purpose}${continuesGameForce ? '，进局逼叫仍继续' : ''}`;
  }
  if (ownBids.some(entry => entry.call.strain === call.strain)) {
    const ownPriorSuit = ownBids.filter(entry => entry.call.strain === call.strain
      && !isArtificialBidAt(auction, entry.index, system));
    if (!ownPriorSuit.length) return `本次${call.level}${call.strain}转为自然花色描述：此前同花色叫品属于人工询问或回答，不承诺该花色长度；不能据此虚构原有五张或六张自然套${continuesGameForce ? '；原有进局逼叫继续' : '；不自动建立新的逼叫'}`;
    const supported = ownPriorSuit.some(entry => us.some(partnerEntry => partnerEntry.seat !== seat
      && partnerEntry.index < entry.index && partnerEntry.call.strain === call.strain));
    const promised = naturalSuitMinimum(following, seat, call.strain as Suit, system);
    const length = supported ? '此前已确认配合，不额外承诺六张套'
      : promised === 4 ? ownPriorSuit[0].index === opening?.index && genuine
        ? '四张原低花的竞争性回套例外，维持4+张承诺；不宣称五张或六张长套'
        : '维持此前自然第二套的4+张承诺，不因重复叫牌就变成六张原套'
        : promised >= 6 ? `自然强调自己的${promised}+张长套`
          : promised === 5 ? '保证之前显示的5+张套，不因最低回叫就额外承诺六张'
            : '自然强调此前花色；此序列没有足以保证五张或六张的公开长度信息';
    return `自然再叫${call.level}${call.strain}：${length}；${gameReached ? '叫到成局或满贯并原则上止叫' : continuesGameForce ? '进局逼叫仍继续' : forcedBeforeCall ? '履行本轮应叫义务；未建立持续进局逼叫' : '未建立新的人工逼叫'}`;
  }
  if (lastOpponent && call.strain === lastOpponent.call.strain) return `自然体系扣叫${call.level}${call.strain}：所叫花色属于对手，不承诺该花色长度；表示支持搭档或强牌并要求继续描述`;
  if (lastOpponent) return `${call.level}${call.strain}为本卡未约定的后续竞争新花色：同伴最后叫${partnerBid ? `${partnerBid.call.level}${partnerBid.call.strain}` : '尚无自然花色'}、敌方已叫${lastOpponent.call.level}${lastOpponent.call.strain}之后，此续叫没有固定长度、点力或逼叫约定；不能按首次自然争叫自动承诺五张${continuesGameForce ? '，已建立的进局逼叫仍继续' : forcedBeforeCall ? '，本次履行之前的一轮应叫义务，但不自动建立新逼叫' : ''}`;
  return `${SYSTEMS[system].short}后续新花色${call.level}${call.strain}：本卡未约定此续叫的固定长度和精确点力；${gameReached ? '选择成局或更高定约' : continuesGameForce ? '已建立的进局逼叫继续' : forcedBeforeCall ? '本次履行一轮应叫义务，不自动继续逼叫' : '不能仅凭新花色认定逼叫'}`;
}

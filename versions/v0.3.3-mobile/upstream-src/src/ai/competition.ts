import { bidValue, sameCall } from '../core/auction';
import { type Call, type Strain, type Suit, PASS, SUITS, partnerOf, sideOf } from '../core/types';
import { type BiddingObservation } from './observation';
import { evaluateHand } from './bidding-legacy';
import { type BiddingSystem } from './systems';
import { analyzeAuctionSemantics, classifyDoubleAt, isArtificialBidAt, isTakeoutDoubleAt, noTrumpRangeAt } from './bidding-semantics';
import { evaluateSuitFit } from './suit-evaluation';

type Bid = Extract<Call, { kind: 'bid' }>;
const bid = (level: number, strain: Strain): Bid => ({ kind: 'bid', level, strain });
const major = (suit: Suit): boolean => suit === 'H' || suit === 'S';

/** SAYC-style competitive methods shared by the natural defensive profile. */
export function chooseCompetitiveCall(obs: BiddingObservation, system: BiddingSystem): Call | undefined {
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const available = (call: Call) => obs.legalCalls.some(legal => sameCall(legal, call));
  const cheapest = (strain: Strain): Bid | undefined => {
    for (let level = 1; level <= 7; level++) if (available(bid(level, strain))) return bid(level, strain);
  };
  const jump = (strain: Suit): Bid | undefined => {
    const low = cheapest(strain);
    return low && low.level < 7 && available(bid(low.level + 1, strain)) ? bid(low.level + 1, strain) : undefined;
  };
  const stopper = (suit: Suit) => obs.hand.some(card => card.suit === suit && (card.rank === 14 || (card.rank === 13 && lengths[suit] >= 2) || (card.rank === 12 && lengths[suit] >= 3)));
  const reasonablePreemptSuit = (suit: Suit) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    return ranks.length >= 7 || (ranks.filter(rank => rank >= 10).length >= 2 && ranks.some(rank => rank >= 12));
  };
  const reasonableOvercallSuit = (suit: Suit, level: number) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    if (level === 1) return ranks.some(rank => rank >= 12) || ranks.length >= 6;
    return ranks.filter(rank => rank >= 10).length >= 2 && ranks.some(rank => rank >= 12)
      || ranks.length >= 6 && ranks.some(rank => rank >= 13);
  };
  const strongTakeoutShape = (opened: Suit) => hcp >= 17
    && (SUITS.some(suit => suit !== opened && lengths[suit] >= 5)
      || hcp >= 18 && balanced && stopper(opened));
  const quickTricks = () => SUITS.reduce((total, suit) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    const ace = ranks.includes(14); const king = ranks.includes(13); const queen = ranks.includes(12);
    if (ace && king) return total + 2;
    if (ace && queen) return total + 1.5;
    if (ace) return total + 1;
    if (king && queen) return total + 1;
    if (king && ranks.length >= 2) return total + 0.5;
    return total;
  }, 0);
  const longest = (suits: Suit[]) => [...suits].sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a))[0];
  const firstBid = obs.auction.findIndex(entry => entry.call.kind === 'bid');
  const raw = firstBid < 0 ? obs.auction : obs.auction.slice(firstBid);
  const semantics = system === 'sayc' ? analyzeAuctionSemantics(obs.auction, obs.seat, system) : undefined;
  const meaning = semantics?.convention ?? 'none';
  const firstNatural = raw.find(entry => entry.call.kind === 'bid');
  const enemyNaturalSuits = new Set(obs.auction.flatMap((entry, index) =>
    sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid' && entry.call.strain !== 'NT'
      && !isArtificialBidAt(obs.auction, index, system) ? [entry.call.strain] : []));
  const current = obs.auction.findLast(entry => entry.call.kind === 'bid');
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT' && major(firstNatural.call.strain)
    && firstNatural.seat === partnerOf(obs.seat) && lengths[firstNatural.call.strain] >= 3
    && obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'redouble')
    && !obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'bid')
    && evaluateSuitFit(obs.hand, firstNatural.call.strain, 5).totalPoints >= 10
    && available(bid(3, firstNatural.call.strain))) return bid(3, firstNatural.call.strain);
  const ownSideAction = obs.auction.some(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind !== 'pass');
  if (!ownSideAction && firstNatural?.call.kind === 'bid' && firstNatural.call.strain !== 'NT'
    && current?.call.kind === 'bid' && current.call.strain !== 'NT' && current.call.level <= 3
    && sideOf(current.seat) !== sideOf(obs.seat) && raw.filter(entry => entry.call.kind === 'bid').length >= 2) {
    const unbid = SUITS.filter(suit => !enemyNaturalSuits.has(suit));
    if (hcp >= 17 && unbid.some(suit => lengths[suit] >= 5) && available({ kind: 'double' })
      && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system) === 'takeout')
      return { kind: 'double' };
    const natural = longest(unbid.filter(suit => {
      const call = cheapest(suit);
      return call && lengths[suit] >= 6 && reasonableOvercallSuit(suit, call.level)
        && hcp >= (call.level <= 2 ? lengths[suit] >= 7 ? 8 : 10 : 14);
    }));
    if (natural) return cheapest(natural);
  }
  if (!semantics?.mustBid && current?.call.kind === 'bid' && current.call.strain !== 'NT'
    && current.call.level <= 2 && sideOf(current.seat) !== sideOf(obs.seat)
    && lengths[current.call.strain] <= 1 && hcp >= 18
    && firstNatural?.seat === obs.seat && firstNatural.call.kind === 'bid') {
    const ownNatural = obs.auction.filter((entry, index) => entry.seat === obs.seat
      && entry.call.kind === 'bid' && entry.call.strain !== 'NT' && !isArtificialBidAt(obs.auction, index, system));
    const second = ownNatural.at(-1);
    const originalSuit = firstNatural.call.strain;
    if (ownNatural.length >= 2 && second?.call.kind === 'bid' && second.call.strain !== 'NT' && second.call.strain !== originalSuit
      && lengths[second.call.strain] >= 5 && reasonableOvercallSuit(second.call.strain, 3)) {
      const repeat = cheapest(second.call.strain);
      if (repeat && repeat.level <= 3) return repeat;
    }
  }
  if (current?.call.kind === 'bid' && sideOf(current.seat) !== sideOf(obs.seat)
    && isArtificialBidAt(obs.auction, obs.auction.indexOf(current), system) && !semantics?.mustBid) {
    const role = classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system);
    if (role === 'two-suit-strength' && firstNatural?.call.kind === 'bid'
      && firstNatural.call.level === 1 && firstNatural.call.strain === 'NT' && hcp >= 10) {
      const naturalMajor = longest((['H', 'S'] as Suit[]).filter(suit => lengths[suit] >= 5));
      if (naturalMajor && available(bid(3, naturalMajor))) return bid(3, naturalMajor);
    }
    if (role !== 'two-suit-strength') {
      if (current.call.strain !== 'NT' && available({ kind: 'double' })) {
        const leadSuit = current.call.strain;
        const ranks = obs.hand.filter(card => card.suit === leadSuit).map(card => card.rank);
        const leadHolding = ranks.length >= 4 && ranks.filter(rank => rank >= 11).length >= 2
          && ranks.some(rank => rank >= 12) || ranks.length >= 3 && [14, 13].every(rank => ranks.includes(rank));
        if (leadHolding && hcp >= 8) return { kind: 'double' };
      }
      return PASS;
    }
  }
  if (meaning === 'weak-jump-inquiry' && raw[1]?.call.kind === 'bid' && raw[1].call.strain !== 'NT') {
    const trump = raw[1].call.strain;
    if (obs.seat === raw[1].seat) {
      const feature = hcp >= 9 ? SUITS.find(suit => suit !== trump
        && obs.hand.some(card => card.suit === suit && card.rank >= 13)) : undefined;
      return feature ? cheapest(feature) : cheapest(trump);
    }
    const answer = raw.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid').at(-1)!;
    const minimum = answer.call.kind === 'bid' && answer.call.strain !== trump ? 9 : 5;
    if (lengths[trump] >= 2 && evaluateSuitFit(obs.hand, trump, 6).totalPoints + minimum >= (major(trump) ? 25 : 29))
      return bid(major(trump) ? 4 : 5, trump);
    const enemy = firstNatural?.call.kind === 'bid' ? firstNatural.call.strain : 'NT';
    if (balanced && enemy !== 'NT' && stopper(enemy) && hcp + minimum >= 25 && available(bid(3, 'NT')))
      return bid(3, 'NT');
    return answer.call.kind === 'bid' && answer.call.strain === trump ? PASS : cheapest(trump);
  }
  if (meaning === 'unusual-advance' && firstNatural?.call.kind === 'bid') {
    const opened = firstNatural.call.strain;
    const shown = SUITS.filter(suit => suit !== opened).slice(0, 2);
    return cheapest(lengths[shown[1]] > lengths[shown[0]] ? shown[1] : shown[0]);
  }
  // Enemy natural bidding releases the compulsory Michaels advance, but
  // does not turn the artificial cue into a natural strength promise for NT.
  const ourFirst = obs.auction.find(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT'
    && ourFirst?.call.kind === 'bid' && ourFirst.seat === obs.seat && ourFirst.call.level === 2
    && ourFirst.call.strain === firstNatural.call.strain && isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system)) {
    const advance = obs.auction.find((entry, index) => index > obs.auction.indexOf(ourFirst)
      && entry.seat === partnerOf(obs.seat) && entry.call.kind === 'bid');
    if (advance?.call.kind === 'bid' && advance.call.strain !== 'NT' && major(advance.call.strain)
      && lengths[advance.call.strain] >= 5 && !semantics?.mustBid) {
      const low = cheapest(advance.call.strain);
      return low && low.level <= 3 ? low : PASS;
    }
  }
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT'
    && !semantics?.mustBid
    && ourFirst?.call.kind === 'bid' && ourFirst.seat === partnerOf(obs.seat)
    && ourFirst.call.level === 2 && ourFirst.call.strain === firstNatural.call.strain
    && isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system)
    && !obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'bid')) {
    const shown: Suit[] = major(firstNatural.call.strain) ? [firstNatural.call.strain === 'H' ? 'S' : 'H'] : ['H', 'S'];
    const preferred = longest(shown);
    const response = cheapest(preferred);
    if (lengths[preferred] >= 3 && response) {
      const points = evaluateSuitFit(obs.hand, preferred, 5).totalPoints + 6;
      return response.level <= 3 || points >= 25 ? response : PASS;
    }
    const minor = longest((['C', 'D'] as Suit[]).filter(suit => lengths[suit] >= 5));
    if (minor) {
      const response = cheapest(minor); return response && response.level <= 3 ? response : PASS;
    }
    return PASS;
  }
  // First natural overcalls in balancing or delayed position still permit
  // ordinary support. A nonforcing new suit may also be corrected when the
  // partner's suit is a singleton or void opposite a genuine long suit.
  if (firstNatural?.call.kind === 'bid' && sideOf(firstNatural.seat) !== sideOf(obs.seat)
    && ourFirst?.call.kind === 'bid' && ourFirst.call.strain !== 'NT'
    && !obs.auction.some((entry, index) => index < obs.auction.indexOf(ourFirst)
      && sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'double')
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system)) {
    const ours = obs.auction.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
    const trump = ourFirst.call.strain;
    const previousBid = obs.auction.slice(0, obs.auction.indexOf(ourFirst)).findLast(entry => entry.call.kind === 'bid');
    const weakJump = previousBid?.call.kind === 'bid' && bidValue(ourFirst.call) - bidValue(previousBid.call) > 5;
    if (ours.length === 1 && ourFirst.seat === partnerOf(obs.seat) && !weakJump && lengths[trump] >= 3) {
      const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints;
      const between = obs.auction.slice(obs.auction.indexOf(firstNatural) + 1, obs.auction.indexOf(ourFirst));
      const balancing = between.length === 2 && between.every(entry => entry.call.kind === 'pass');
      const overcallMinimum = ourFirst.call.level === 1 ? balancing ? 7 : 8 : firstNatural.call.level >= 2 ? 12 : 10;
      if (points + overcallMinimum >= (major(trump) ? 25 : 29)) {
        const game = bid(major(trump) ? 4 : 5, trump); if (available(game)) return game;
      }
      if (hcp >= 10 && firstNatural.call.strain !== 'NT') {
        const cue = cheapest(firstNatural.call.strain); if (cue) return cue;
      }
      if (points >= 10 && major(trump) && ourFirst.call.level === 1 && available(bid(3, trump))) return bid(3, trump);
      const raise = bid(ourFirst.call.level + 1, trump);
      if (points >= 6 && available(raise)) return raise;
    }
    const latestPartner = ours.at(-1);
    if (latestPartner?.seat === partnerOf(obs.seat) && latestPartner.call.kind === 'bid'
      && !semantics?.mustBid && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartner), system)
      && latestPartner.call.strain !== 'NT' && latestPartner.call.level <= 3
      && lengths[latestPartner.call.strain] <= 2) {
      if (ourFirst.seat === obs.seat && lengths[trump] >= 6) return cheapest(trump);
      const escape = longest(SUITS.filter(suit => lengths[suit] >= 5 && !enemyNaturalSuits.has(suit)));
      if (escape && hcp >= 8) return cheapest(escape);
    }
  }
  // After a natural NT overcall, systems are on: transfers describe majors,
  // 2S relays to 3C for a weak long minor. A low-card club hand is not Stayman.
  const ntPosition = raw[3]?.call.kind === 'bid' && raw[3].call.strain === 'NT'
    && raw[1]?.call.kind === 'pass' && raw[2]?.call.kind === 'pass' ? 3 : 1;
  const ntOvercall = raw[ntPosition];
  if (raw[0]?.call.kind === 'bid' && raw[0].call.strain !== 'NT'
    && ntOvercall?.call.kind === 'bid' && ntOvercall.call.level <= 2 && ntOvercall.call.strain === 'NT'
    && (raw[0].call.level >= 2 || ntOvercall.call.level === 1)) {
    const base = ntOvercall.call.level + 1;
    const ourNtSide = sideOf(ntOvercall.seat) === sideOf(obs.seat);
    const sideBids = raw.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
    const request = sideBids[1]?.call;
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 1
      && raw.length === ntPosition + 2 && raw[ntPosition + 1].call.kind === 'pass') {
      const m = longest((['H', 'S'] as Suit[]).filter(suit => lengths[suit] >= 5));
      if (m) return bid(base, m === 'H' ? 'D' : 'H');
      const minimum = ntPosition === 3 && base === 2 ? 11 : 15;
      const game = 25 - minimum, invitation = ntPosition === 3 ? 11 : 23 - minimum;
      if (hcp >= invitation && (lengths.H >= 4 || lengths.S >= 4)) return bid(base, 'C');
      if (hcp >= game) return bid(3, 'NT');
      if (base === 2 && hcp >= invitation) return bid(2, 'NT');
      if (base === 2 && Math.max(lengths.C, lengths.D) >= 6) return bid(2, 'S');
      return PASS;
    }
    if (ourNtSide && obs.seat === ntOvercall.seat && sideBids.length === 2 && request?.kind === 'bid') {
      if (request.level === base && request.strain === 'C') return cheapest(lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D');
      if (request.level === base && request.strain === 'D') return cheapest('H');
      if (request.level === base && request.strain === 'H') return cheapest('S');
      if (base === 2 && request.level === 2 && request.strain === 'S') return cheapest('C');
      if (request.level === 2 && request.strain === 'NT') return hcp >= (ntPosition === 3 ? 14 : 17) ? bid(3, 'NT') : PASS;
    }
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 3 && request?.kind === 'bid') {
      if (request.level === 2 && request.strain === 'S') return lengths.D > lengths.C ? cheapest('D') : PASS;
      if (request.level === base && request.strain === 'C') {
        const answer = sideBids[2].call as Bid;
        if (answer.strain !== 'NT' && major(answer.strain) && lengths[answer.strain] >= 4)
          return bid(hcp >= (ntPosition === 3 ? 14 : 10) ? 4 : 3, answer.strain);
        return bid(hcp >= (ntPosition === 3 ? 14 : 10) ? 3 : 2, 'NT');
      }
      if (request.level === base && (request.strain === 'D' || request.strain === 'H')) {
        const m: Suit = request.strain === 'D' ? 'H' : 'S';
        if (hcp >= (ntPosition === 3 ? 14 : 10)) return lengths[m] >= 6 ? bid(4, m) : bid(3, 'NT');
        if (base === 2 && hcp >= (ntPosition === 3 ? 11 : 8)) return lengths[m] >= 6 ? bid(3, m) : bid(2, 'NT');
        return PASS;
      }
    }
    if (ourNtSide && obs.seat === ntOvercall.seat && sideBids.length === 4 && request?.kind === 'bid'
      && (request.strain === 'D' || request.strain === 'H')) {
      const continuation = sideBids[3].call as Bid;
      const m: Suit = request.strain === 'D' ? 'H' : 'S';
      if (continuation.strain === 'NT' && continuation.level === 3 && lengths[m] >= 3) return bid(4, m);
      if (continuation.level < 3 && (hcp >= (ntPosition === 3 ? 14 : 17)
        || lengths[m] >= 3 && evaluateSuitFit(obs.hand, m, 5).totalPoints + (ntPosition === 3 ? 11 : 8) >= 25))
        return lengths[m] >= 3 ? bid(4, m) : bid(3, 'NT');
      return PASS;
    }
  }

  // Resolve obligations by their public meaning, not the auction's exact
  // length. A double or a further opposing bid must not erase a question.
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.strain !== 'NT') {
    const opened = firstNatural.call.strain;
    if (meaning === 'takeout-response') {
      const doubleIndex = obs.auction.findLastIndex((entry, index) => entry.seat === partnerOf(obs.seat)
        && isTakeoutDoubleAt(obs.auction, index));
      const enemyBefore = obs.auction.slice(0, doubleIndex).filter((entry, index) => entry.call.kind === 'bid'
        && sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, index, system));
      // A delayed takeout of opener's two-suit auction requests the two other
      // suits. Responder's earlier one-level suit does not erase our longest.
      const twoSuitOpening = enemyBefore.length === 3 && enemyBefore[0].seat === enemyBefore[2].seat
        && enemyBefore[0].call.kind === 'bid' && enemyBefore[2].call.kind === 'bid'
        && enemyBefore[0].call.level === 1 && enemyBefore[2].call.level === 2;
      const excluded = twoSuitOpening ? new Set([enemyBefore[0].call, enemyBefore[2].call]
        .flatMap(call => call.kind === 'bid' && call.strain !== 'NT' ? [call.strain] : [])) : enemyNaturalSuits;
      const unbid = SUITS.filter(suit => !excluded.has(suit));
      const preferred = longest(unbid.filter(suit => major(suit) && lengths[suit] >= 4));
      // Over a three-level preempt the cheapest major is already game.
      // Do not cue past that game merely because advancer has 12 points.
      if (firstNatural.call.level === 3 && hcp < 19 && preferred && lengths[preferred] >= 4
        && major(preferred) && available(bid(4, preferred))) return bid(4, preferred);
      if (hcp >= 12) return cheapest(opened);
      if (balanced && stopper(opened)) {
        if (hcp >= 13 && available(bid(3, 'NT'))) return bid(3, 'NT');
        if (hcp >= 11 && available(bid(2, 'NT'))) return bid(2, 'NT');
        if (hcp >= 6 && available(bid(1, 'NT'))) return bid(1, 'NT');
      }
      const suit = longest(unbid);
      const low = cheapest(suit);
      return low && hcp >= 9 && lengths[suit] >= 4 && low.level <= 3 && low.level < (major(suit) ? 4 : 5) && available(bid(low.level + 1, suit))
        ? bid(low.level + 1, suit) : low;
    }
    if (meaning === 'negative-double') {
      if (hcp >= 16 && lengths[opened] >= 6) {
        const rebid = bid(3, opened); if (available(rebid)) return rebid;
      }
      const enemyOvercall = raw[1]?.call;
      if (enemyOvercall?.kind === 'bid') {
        const shown = longest((['H', 'S'] as Suit[]).filter(suit => suit !== opened
          && suit !== enemyOvercall.strain && lengths[suit] >= 4));
        if (shown) {
          const points = evaluateSuitFit(obs.hand, shown, 4).totalPoints
            + (enemyOvercall.level === 1 ? 6 : 8);
          if (points >= 25 && available(bid(4, shown))) return bid(4, shown);
          if (points >= 23 && available(bid(3, shown))) return bid(3, shown);
          return cheapest(shown);
        }
        if ((balanced || hcp >= 18) && stopper(enemyOvercall.strain as Suit)) {
          if (hcp >= 19 && available(bid(3, 'NT'))) return bid(3, 'NT');
          if (hcp >= 18 && available(bid(2, 'NT'))) return bid(2, 'NT');
          if (hcp >= 12) { const nt = cheapest('NT'); if (nt && nt.level <= 2) return nt; }
        }
        const side = longest(SUITS.filter(suit => suit !== opened && suit !== enemyOvercall.strain && lengths[suit] >= 4));
        if (side && (lengths[opened as Suit] < 5 || hcp >= 17)) return cheapest(side);
      }
      return cheapest(opened);
    }
    if (meaning === 'michaels-inquiry') return cheapest(lengths.D > lengths.C ? 'D' : 'C');
    if (meaning === 'overcall-stayman') return cheapest(lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D');
    if (meaning === 'overcall-cue') {
      const overcall = raw[1]?.call;
      if (overcall?.kind === 'bid' && overcall.strain !== 'NT') {
        if (hcp <= 10) return cheapest(overcall.strain);
        const enemySuits = raw.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid'
          && entry.call.strain !== 'NT').map(entry => (entry.call as Bid).strain as Suit);
        if (balanced && enemySuits.every(stopper)) {
          const nt = cheapest('NT'); if (nt) return nt;
        }
        const side = longest(SUITS.filter(suit => !enemySuits.includes(suit) && suit !== overcall.strain && lengths[suit] >= 4));
        if (side) return cheapest(side);
        const low = cheapest(overcall.strain);
        if (hcp <= 12) return low;
        return low && low.level < 7 && available(bid(low.level + 1, overcall.strain))
          ? bid(low.level + 1, overcall.strain) : low;
      }
    }
  }

  // Direct action over a natural one-level suit opening.
  if (raw.length === 1 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT' && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    if (system === 'precision' && opened === 'C') return undefined;
    const unbid = SUITS.filter(suit => suit !== opened);
    const twoLowest = [...unbid].sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b)).slice(0, 2);
    const otherMajor: Suit | undefined = opened === 'H' ? 'S' : opened === 'S' ? 'H' : undefined;

    if (!major(opened) && lengths.H >= 5 && lengths.S >= 5 && hcp >= 8 && available(bid(2, opened))) return bid(2, opened);
    if (otherMajor && lengths[otherMajor] >= 5 && Math.max(lengths.C, lengths.D) >= 5 && hcp >= 10 && available(bid(2, opened))) return bid(2, opened);
    if (hcp >= 5 && twoLowest.every(suit => lengths[suit] >= 5) && available(bid(2, 'NT'))) return bid(2, 'NT');
    if (balanced && hcp >= 15 && hcp <= 18 && stopper(opened) && available(bid(1, 'NT'))) return bid(1, 'NT');

    const weakJumpSuit = longest(unbid.filter(suit => reasonablePreemptSuit(suit)));
    if (weakJumpSuit) {
      const call = jump(weakJumpSuit);
      const maximum = call?.level === 2 ? 11 : 10;
      const requiredLength = call ? call.level + 4 : 14;
      if (call && lengths[weakJumpSuit] >= requiredLength && hcp >= 5 && hcp <= maximum) return call;
    }

    const shapeTakeout = lengths[opened] <= 2 && unbid.every(suit => lengths[suit] >= 3);
    if ((strongTakeoutShape(opened) || (hcp >= 12 && shapeTakeout)) && available({ kind: 'double' })) return { kind: 'double' };

    const simple = longest(unbid.filter(suit => {
      const call = cheapest(suit);
      return lengths[suit] >= 5 && call && hcp >= (call.level === 1 ? 8 : 10)
        && reasonableOvercallSuit(suit, call.level);
    }));
    if (simple && hcp <= 16) {
      const call = cheapest(simple);
      if (call && hcp >= (call.level === 1 ? 8 : 10) && reasonableOvercallSuit(simple, call.level)) return call;
    }
    return undefined;
  }

  // Natural defense to an opposing 1NT: penalty double, natural suits, or both minors.
  if (raw.length === 1 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain === 'NT'
    && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    if (hcp >= 15 && quickTricks() >= 3 && available({ kind: 'double' })) return { kind: 'double' };
    if (hcp >= 5 && lengths.C >= 5 && lengths.D >= 5 && available(bid(2, 'NT'))) return bid(2, 'NT');
    const suit = longest(SUITS.filter(candidate => lengths[candidate] >= 6));
    if (suit && hcp >= 8) return cheapest(suit);
    return undefined;
  }

  // Balancing seat after a one-level opening and two passes.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[1].call.kind === 'pass' && raw[2].call.kind === 'pass' && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const unbid = SUITS.filter(suit => suit !== opened);
    if (balanced && hcp >= 11 && hcp <= 14 && stopper(opened) && available(bid(1, 'NT'))) return bid(1, 'NT');
    const shapeTakeout = lengths[opened] <= 2 && unbid.every(suit => lengths[suit] >= 3);
    if ((strongTakeoutShape(opened) || (hcp >= 9 && shapeTakeout)) && available({ kind: 'double' })) return { kind: 'double' };
    const suit = longest(unbid.filter(candidate => lengths[candidate] >= 5));
    if (suit && hcp >= 7) return cheapest(suit);
    // The card's balancing NT is 11–14. A stronger hand lacking takeout
    // support and an honest five-card suit must not leak to a direct-NT
    // fallback that promises the wrong range.
    if (hcp >= 15 && hcp <= 17) return PASS;
    return undefined;
  }

  // Responder after an opponent's takeout double of partner's natural one-level opening.
  if (raw.length === 2 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && sideOf(raw[0].seat) === sideOf(obs.seat) && raw[1].call.kind === 'double') {
    const opened = raw[0].call.strain;
    if (hcp >= 10 && available({ kind: 'redouble' })) return { kind: 'redouble' };
    if (lengths[opened] >= (major(opened) ? 3 : 5)
      && evaluateSuitFit(obs.hand, opened, major(opened) ? 5 : 3).totalPoints >= 6) {
      if (evaluateSuitFit(obs.hand, opened, major(opened) ? 5 : 3).totalPoints >= 10 && available(bid(3, opened))) return bid(3, opened);
      const raise = cheapest(opened); if (raise) return raise;
    }
    const oneLevel = longest(SUITS.filter(candidate => candidate !== opened && lengths[candidate] >= 4
      && cheapest(candidate)?.level === 1));
    if (oneLevel && hcp >= 6) return cheapest(oneLevel);
    const longEscape = longest(SUITS.filter(candidate => candidate !== opened && (lengths[candidate] >= 6
      || lengths[candidate] >= 5 && reasonableOvercallSuit(candidate, 2))));
    if (longEscape && hcp >= 6) return cheapest(longEscape);
    return PASS;
  }

  // SAYC defense when the opponent uses Michaels or Unusual 2NT over our opening.
  if (raw.length === 2 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && sideOf(raw[0].seat) === sideOf(obs.seat) && raw[1].call.kind === 'bid' && sideOf(raw[1].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const michaels = raw[1].call.level === 2 && raw[1].call.strain === opened;
    const unusual = raw[1].call.level === 2 && raw[1].call.strain === 'NT';
    if (michaels || unusual) {
      // A genuine unshown major is more descriptive than a general strength
      // double. At the three level it needs the card's 10-HCP free-bid floor.
      if (unusual && hcp >= 10) {
        const shown = SUITS.filter(suit => suit !== opened).slice(0, 2);
        const naturalMajor = longest((['H', 'S'] as Suit[]).filter(suit => suit !== opened
          && !shown.includes(suit) && lengths[suit] >= 5));
        if (naturalMajor) return cheapest(naturalMajor);
      }
      if (hcp >= 10 && available({ kind: 'double' })) return { kind: 'double' };
      if (hcp >= 6 && lengths[opened] >= (major(opened) ? 3 : 5)) return cheapest(opened);
      const natural = longest(SUITS.filter(candidate => candidate !== opened && lengths[candidate] >= 5));
      if (natural && hcp >= 10) return cheapest(natural);
      return PASS;
    }
  }

  // Natural defenses to a direct weak-two or three-level preempt.
  if ((raw.length === 1 || (raw.length === 3 && raw[1].call.kind === 'pass' && raw[2].call.kind === 'pass'))
    && raw[0].call.kind === 'bid' && raw[0].call.level >= 2 && raw[0].call.level <= 3
    && raw[0].call.strain !== 'NT' && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const openingCall = raw[0].call;
    const opened = openingCall.strain as Suit;
    const unbid = SUITS.filter(suit => suit !== opened);
    if (balanced && hcp >= 15 && hcp <= 18 && stopper(opened)) {
      const nt = cheapest('NT'); if (nt) return nt;
    }
    const shapeTakeout = lengths[opened] <= 2 && unbid.every(suit => lengths[suit] >= 3);
    if ((strongTakeoutShape(opened) || (hcp >= (openingCall.level === 2 ? 13 : 15) && shapeTakeout)) && available({ kind: 'double' })) return { kind: 'double' };
    const natural = longest(unbid.filter(suit => {
      const call = cheapest(suit);
      const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
      const exceptionalLength = lengths[suit] >= 8 && hcp >= 7
        && ranks.filter(rank => rank >= 10).length >= 3 && ranks.some(rank => rank >= 13);
      if (!call || lengths[suit] < (openingCall.level === 2 ? 5 : 6)) return false;
      return exceptionalLength || hcp >= (call.level === 2 ? 12 : 14)
        && reasonableOvercallSuit(suit, call.level)
        && (call.level <= 2 || lengths[suit] >= 6 || ranks.filter(rank => rank >= 12).length >= 2);
    }));
    if (natural) return cheapest(natural);
    return PASS;
  }

  // Responder's negative double after partner opens and RHO overcalls through 2S.
  if (raw.length === 2 && raw[0].call.kind === 'bid' && raw[1].call.kind === 'bid'
    && raw[0].call.level === 1 && raw[0].call.strain !== 'NT' && raw[1].call.strain !== 'NT'
    && sideOf(raw[0].seat) === sideOf(obs.seat) && sideOf(raw[1].seat) !== sideOf(obs.seat) && bidValue(raw[1].call) <= bidValue(bid(2, 'S'))) {
    const opened = raw[0].call.strain; const overcalled = raw[1].call.strain;
    const points = raw[1].call.level === 1 ? 6 : 8;
    const unbidMajors = (['H', 'S'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled);
    const support = major(opened) && lengths[opened] >= 3 ? evaluateSuitFit(obs.hand, opened, 5).totalPoints : 0;
    if (support >= 13 && available(bid(4, opened))) return bid(4, opened);
    if (support >= 10 && available(bid(3, opened))) return bid(3, opened);
    if (support >= 6 && available(bid(2, opened))) return bid(2, opened);
    const longMajor = longest(unbidMajors.filter(suit => lengths[suit] >= 5));
    const naturalMajor = longMajor ? cheapest(longMajor) : undefined;
    if (naturalMajor && naturalMajor.level <= 2
      && (hcp >= (naturalMajor.level === 1 ? 6 : 10) || (hcp >= 8 && lengths[longMajor!] >= 6))) return naturalMajor;
    if (opened !== 'H' && opened !== 'S' && overcalled === 'H' && lengths.S >= 5 && hcp >= points && available(bid(1, 'S'))) return bid(1, 'S');
    // After 1m-(1S), a five-card heart suit with constructive values is shown
    // naturally at 2H. The negative double is reserved for exactly four hearts
    // (or hands whose shape cannot be described by a natural available call).
    if (opened !== 'H' && opened !== 'S' && overcalled === 'S' && lengths.H >= 5
      && hcp >= 10 && available(bid(2, 'H'))) return bid(2, 'H');
    if (hcp >= points && unbidMajors.length && unbidMajors.every(suit => lengths[suit] >= 4) && available({ kind: 'double' })) return { kind: 'double' };
    if (hcp >= points && !unbidMajors.length) {
      const unbidMinors = (['C', 'D'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled);
      if (unbidMinors.length && unbidMinors.every(suit => lengths[suit] >= 4) && available({ kind: 'double' })) return { kind: 'double' };
    }
    const freeMajor = longest(unbidMajors.filter(suit => lengths[suit] >= 4 && hcp >= 6
      && cheapest(suit)?.level === 1 && !(overcalled === 'H' && !major(opened) && suit === 'S' && lengths.S === 4)));
    if (freeMajor) return cheapest(freeMajor);
    const freeSuit = longest(SUITS.filter(suit => suit !== opened && suit !== overcalled && lengths[suit] >= 5
      && hcp >= 10 && cheapest(suit)?.level === 2));
    if (freeSuit) return cheapest(freeSuit);
    if (balanced && stopper(overcalled) && hcp >= 6) {
      if (hcp >= 13 && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (hcp >= 11 && available(bid(2, 'NT'))) return bid(2, 'NT');
      if (hcp <= 10 && available(bid(1, 'NT'))) return bid(1, 'NT');
    }
  }

  // A three-level jump overcall must not buy the contract when responder has
  // game-going values. SAYC negative doubles stop at 2S in this card, so at
  // the three level responder uses 3NT with a stopper, a natural five-card
  // suit, a supported-minor game, or a forcing cuebid.
  if (raw.length === 2 && raw[0].call.kind === 'bid' && raw[1].call.kind === 'bid'
    && raw[0].call.level === 1 && raw[0].call.strain !== 'NT' && raw[1].call.level === 3 && raw[1].call.strain !== 'NT'
    && sideOf(raw[0].seat) === sideOf(obs.seat) && sideOf(raw[1].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain as Suit; const overcalled = raw[1].call.strain as Suit;
    if (hcp >= 12) {
      if (balanced && stopper(overcalled) && available(bid(3, 'NT'))) return bid(3, 'NT');
      const natural = longest(SUITS.filter(suit => suit !== opened && suit !== overcalled && lengths[suit] >= 5));
      if (natural) { const call = cheapest(natural); if (call && call.level <= 4) return call; }
      if (!major(opened) && lengths[opened] >= 4 && available(bid(5, opened))) return bid(5, opened);
      const cue = cheapest(overcalled); if (cue) return cue;
    }
    return undefined;
  }

  // Opener acts again when responder's negative double is followed by a raise
  // or further bid from advancer. The double has publicly shown the unbid major;
  // letting the auction die would ignore partner's forcing request.
  if (raw.length === 4 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[0].seat === obs.seat && raw[1].call.kind === 'bid' && sideOf(raw[1].seat) !== sideOf(obs.seat)
    && raw[2].seat === partnerOf(obs.seat) && raw[2].call.kind === 'double'
    && raw[3].call.kind === 'bid' && sideOf(raw[3].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const overcalled = raw[1].call.strain;
    const unbidMajors = (['H', 'S'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled);
    const shown = longest(unbidMajors.filter(suit => lengths[suit] >= 4));
    if (shown) {
      const call = cheapest(shown);
      if (call) return call;
    }
    if (hcp >= 16 && stopper(overcalled as Suit)) {
      const nt = cheapest('NT');
      if (nt) return nt;
    }
    const fallback = cheapest(opened);
    return fallback ?? PASS;
  }

  // Advancer is free to pass when responder bids over the takeout double.
  // With values, choose an unbid suit; never accidentally cue with a weak hand.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.strain !== 'NT'
    && raw[1].seat === partnerOf(obs.seat) && raw[1].call.kind === 'double'
    && isTakeoutDoubleAt(obs.auction, firstBid + 1) && raw[2].call.kind !== 'pass') {
    const opened = raw[0].call.strain;
    if (hcp >= 12) return cheapest(opened);
    if (hcp < 6) return PASS;
    const enemySuit = raw[2].call.kind === 'bid' ? raw[2].call.strain : opened;
    const suit = longest(SUITS.filter(s => s !== opened && s !== enemySuit && lengths[s] >= 4));
    return suit ? cheapest(suit) : PASS;
  }

  // Advancer after opener's partner competes. The opponent's extra call does
  // not erase a real fit or the option to make a forcing support cuebid.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level <= 3 && raw[0].call.strain !== 'NT'
    && sideOf(raw[0].seat) !== sideOf(obs.seat) && raw[1].seat === partnerOf(obs.seat)
    && raw[1].call.kind === 'bid' && raw[1].call.strain !== 'NT' && raw[1].call.strain !== raw[0].call.strain
    && bidValue(raw[1].call) - bidValue(raw[0].call) <= 5 && raw[2].call.kind === 'bid') {
    const trump = raw[1].call.strain;
    const minimum = raw[1].call.level === 1 ? 8 : raw[1].call.level === 2 ? 10 : 12;
    const supported = evaluateSuitFit(obs.hand, trump, 5).totalPoints;
    if (lengths[trump] >= 3) {
      const level = major(trump) ? 4 : 5;
      if (supported + minimum >= (major(trump) ? 25 : 29) && available(bid(level, trump))) return bid(level, trump);
      if (!major(trump) && supported + minimum >= 25 && available(bid(4, trump))) return bid(4, trump);
      if (hcp >= 10 && raw[0].call.level === 1) return cheapest(raw[0].call.strain);
      if (supported >= 6) return cheapest(trump);
    }
  }

  // Advancer after an opponent's opening, partner's direct action, and a pass.
  // Natural overcalls of weak twos also promise 12+ and a five-card suit.
  // Do not omit a known game fit merely because opener preempted above one.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level >= 2 && raw[0].call.level <= 3
    && raw[0].call.strain !== 'NT' && raw[1].seat === partnerOf(obs.seat)
    && raw[1].call.kind === 'bid' && raw[1].call.strain !== 'NT'
    && raw[1].call.strain !== raw[0].call.strain && raw[2].call.kind === 'pass') {
    const trump = raw[1].call.strain;
    if (lengths[trump] >= 3) {
      const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints + (raw[0].call.level === 2 ? 12 : 14);
      if (points >= (major(trump) ? 25 : 29) && available(bid(major(trump) ? 4 : 5, trump)))
        return bid(major(trump) ? 4 : 5, trump);
      if (points >= 23 && major(trump) && available(bid(3, trump))) return bid(3, trump);
      if (points >= 25 && !major(trump) && available(bid(4, trump))) return bid(4, trump);
      if (evaluateSuitFit(obs.hand, trump, 5).totalPoints >= 6) return cheapest(trump);
    }
  }
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && (raw[2].call.kind === 'pass' || raw[2].call.kind === 'double')
    && sideOf(raw[0].seat) !== sideOf(obs.seat) && raw[1].seat === partnerOf(obs.seat)
    && sideOf(raw[2].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    if (raw[1].call.kind === 'double') {
      const unbid = SUITS.filter(suit => suit !== opened); const suit = longest(unbid);
      if (hcp >= 12) return cheapest(opened);
      if (balanced && stopper(opened)) {
        if (hcp >= 13 && available(bid(3, 'NT'))) return bid(3, 'NT');
        if (hcp >= 11 && available(bid(2, 'NT'))) return bid(2, 'NT');
        if (hcp >= 6 && available(bid(1, 'NT'))) return bid(1, 'NT');
      }
      const low = cheapest(suit);
      if (low && hcp >= 9 && lengths[suit] >= 4 && low.level < 7 && available(bid(low.level + 1, suit))) return bid(low.level + 1, suit);
      return low ?? PASS;
    }
    if (raw[1].call.kind !== 'bid') return undefined;
    const intervention = raw[1].call;
    const michaels = intervention.level === 2 && intervention.strain === opened && !(system === 'precision' && opened === 'C');
    if (michaels) {
      if (!major(opened)) {
        const fit: Suit = lengths.S >= lengths.H ? 'S' : 'H';
        if (lengths[fit] >= 3 && evaluateSuitFit(obs.hand, fit, 5).totalPoints + 8 >= 25 && available(bid(4, fit))) return bid(4, fit);
        return cheapest(fit);
      }
      const other: Suit = opened === 'H' ? 'S' : 'H';
      if (lengths[other] >= 3) {
        if (evaluateSuitFit(obs.hand, other, 5).totalPoints + 10 >= 25 && available(bid(4, other))) return bid(4, other);
        return cheapest(other);
      }
      return available(bid(2, 'NT')) ? bid(2, 'NT') : cheapest(other);
    }
    if (intervention.level === 2 && intervention.strain === 'NT') {
      const shown = SUITS.filter(suit => suit !== opened).sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b)).slice(0, 2);
      return cheapest(lengths[shown[1]] > lengths[shown[0]] ? shown[1] : shown[0]);
    }
    if (raw[2].call.kind === 'double') return undefined;
    if (intervention.strain === 'NT') {
      if ((lengths.H >= 4 || lengths.S >= 4) && hcp >= 8 && available(bid(2, 'C'))) return bid(2, 'C');
      const natural = longest(SUITS.filter(suit => lengths[suit] >= 5));
      if (natural && available(bid(2, natural))) return bid(2, natural);
      if (hcp >= 10 && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (hcp >= 8 && available(bid(2, 'NT'))) return bid(2, 'NT');
      return PASS;
    }
    const overcalled = intervention.strain;
    const naturalLevel = bidValue(bid(1, overcalled)) > bidValue(raw[0].call) ? 1 : 2;
    const jumpOvercall = intervention.level > naturalLevel;
    if (jumpOvercall) {
      if (hcp >= 15) {
        const ask = cheapest('NT'); if (ask) return ask;
      }
      if (lengths[overcalled] >= 3) {
        const raise = cheapest(overcalled); if (raise) return raise;
      }
      return undefined;
    }
    if (lengths[overcalled] >= 3) {
      if (hcp >= 10 && available(bid(2, opened))) return bid(2, opened);
      const raise = bid(Math.min(7, intervention.level + 1), overcalled);
      if (evaluateSuitFit(obs.hand, overcalled, 5).totalPoints >= 6 && available(raise)) return raise;
    }
    const newSuit = longest(SUITS.filter(suit => suit !== opened && suit !== overcalled && lengths[suit] >= 5));
    if (newSuit && hcp >= 8) return cheapest(newSuit);
    const majorResponse = longest((['H', 'S'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled && lengths[suit] >= 4
      && cheapest(suit)?.level === 1));
    if (majorResponse && hcp >= 8) return cheapest(majorResponse);
    if (balanced && stopper(opened) && hcp >= 9) return hcp + (intervention.level === 1 ? 8 : 10) >= 25 && available(bid(3, 'NT'))
      ? bid(3, 'NT') : available(bid(2, 'NT')) && hcp >= 11 ? bid(2, 'NT') : cheapest('NT');
    return undefined;
  }

  // Overcaller's response to Stayman after a direct 1NT overcall.
  if (raw.length === 5 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[1].seat === obs.seat && raw[1].call.kind === 'bid' && raw[1].call.level === 1 && raw[1].call.strain === 'NT'
    && raw[2].call.kind === 'pass' && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === 'bid' && raw[3].call.level === 2 && raw[3].call.strain === 'C'
    && raw[4].call.kind === 'pass') {
    if (lengths.H >= 4) return bid(2, 'H');
    if (lengths.S >= 4) return bid(2, 'S');
    return bid(2, 'D');
  }

  // Michaels bidder names the unknown minor after advancer's 2NT inquiry.
  if (raw.length === 5 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT' && major(raw[0].call.strain)
    && raw[1].seat === obs.seat && raw[1].call.kind === 'bid' && raw[1].call.level === 2 && raw[1].call.strain === raw[0].call.strain
    && raw[2].call.kind === 'pass' && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === 'bid' && raw[3].call.level === 2 && raw[3].call.strain === 'NT'
    && raw[4].call.kind === 'pass') return cheapest(lengths.D > lengths.C ? 'D' : 'C');

  // Overcaller's answer to the forcing cuebid: repeat with a minimum, describe extras otherwise.
  if (raw.length === 5 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[1].seat === obs.seat && raw[1].call.kind === 'bid' && raw[1].call.strain !== raw[0].call.strain && raw[1].call.strain !== 'NT'
    && raw[2].call.kind === 'pass' && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === 'bid' && raw[3].call.level === 2 && raw[3].call.strain === raw[0].call.strain
    && raw[4].call.kind === 'pass') {
    const opened = raw[0].call.strain;
    const overcall = raw[1].call;
    const suit = overcall.strain;
    if (hcp <= 10) return cheapest(suit);
    if (balanced && stopper(opened)) {
      const nt = cheapest('NT'); if (nt) return nt;
    }
    const side = longest(SUITS.filter(candidate => candidate !== suit && candidate !== opened && lengths[candidate] >= 4));
    if (side) return cheapest(side);
    const low = cheapest(suit); const invitational = low && low.level < 7 ? bid(low.level + 1, suit) : undefined;
    if (hcp <= 12) return low;
    return invitational && available(invitational) ? invitational : low;
  }

  // A minimum response to our takeout double may be made with no values.  It
  // is neither a new opening nor evidence for game.  Once the opponents bid
  // again, a minimum doubler passes; only a genuinely strong doubler may show
  // a long suit.  A no-trump rebid is reserved for an invitational-or-better
  // response, an explicit 18-20 HCP range, and stoppers in every shown enemy
  // suit.  This also prevents a previously bad NT call from being raised to
  // game by counting the doubler's own values a second time.
  const ownTakeout = firstNatural?.call.kind === 'bid' && firstNatural.call.level <= 3 && firstNatural.call.strain !== 'NT'
    ? raw.findIndex((entry, index) => entry.seat === obs.seat && isTakeoutDoubleAt(obs.auction, firstBid + index)) : -1;
  const partnerResponse = ownTakeout >= 0 ? raw.find((entry, index) => index > ownTakeout
    && entry.seat === partnerOf(obs.seat) && entry.call.kind === 'bid') : undefined;
  if (ownTakeout >= 0 && !partnerResponse && hcp < 17) {
    const lastNonpass = raw.findLast(entry => entry.call.kind !== 'pass');
    if (lastNonpass?.call.kind === 'redouble' && firstNatural?.call.kind === 'bid'
      && firstNatural.call.strain !== 'NT') {
      const opened = firstNatural.call.strain;
      // First advancer may wait after XX. At the final decision, the doubler
      // must remove it unless the hand supplies a real defensive trump stack.
      if (lengths[opened] < 4 || quickTricks() < 3) {
        const unbid = SUITS.filter(suit => suit !== opened && lengths[suit] >= 4);
        const preferred = longest(unbid.filter(major)) ?? longest(unbid);
        return preferred ? cheapest(preferred) : cheapest(longest(SUITS.filter(suit => suit !== opened)));
      }
    }
    return PASS;
  }
  if (firstNatural?.call.kind === 'bid' && ownTakeout >= 0 && partnerResponse?.call.kind === 'bid') {
    const opened = firstNatural.call.strain as Suit;
    const response = partnerResponse.call;
    const responseIndex = raw.indexOf(partnerResponse);
    const bidBeforeResponse = raw.slice(0, responseIndex).findLast(entry => entry.call.kind === 'bid')!.call as Bid;
    const naturalResponseLevel = bidBeforeResponse.level
      + (bidValue(bid(1, response.strain)) <= bidValue(bid(1, bidBeforeResponse.strain)) ? 1 : 0);
    const partnerCue = response.strain === opened;
    const partnerWeak = !partnerCue && response.level <= naturalResponseLevel;
    const opponentBidAfterResponse = raw.some((entry, index) => index > responseIndex
      && sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid');
    const ownBidsAfterDouble = raw.filter((entry, index) => index > ownTakeout
      && entry.seat === obs.seat && entry.call.kind === 'bid');
    // The strong-hand exception to takeout shape is not permission to
    // replace partner's chosen game with an unsupported five-level suit.
    if (!opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue
      && response.level >= (response.strain === 'NT' ? 3 : major(response.strain) ? 4 : 5)) return PASS;
    if (partnerWeak && ownBidsAfterDouble.some(entry => entry.call.kind === 'bid' && entry.call.strain === 'NT') && opponentBidAfterResponse) return PASS;
    if (opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue) {
      if (response.strain !== 'NT' && major(response.strain) && hcp >= 17
        && lengths[response.strain] >= 5 && available(bid(3, response.strain))) return bid(3, response.strain);
      const ownSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      if (hcp >= 17 && ownSuit) return cheapest(ownSuit);
      const opponentSuits = [...new Set(raw.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
        && entry.call.kind === 'bid' && entry.call.strain !== 'NT').map(entry => (entry.call as Bid).strain as Suit))];
      if (!partnerWeak && balanced && hcp >= 18 && hcp <= 20 && opponentSuits.every(stopper)) return cheapest('NT') ?? PASS;
      return PASS;
    }
    if (!opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue) {
      if (response.strain === 'NT' && response.level === 1) {
        const longMajor = longest((['H', 'S'] as Suit[]).filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 7));
        if (longMajor && evaluateSuitFit(obs.hand, longMajor, 2).totalPoints + 6 >= 25 && available(bid(4, longMajor))) return bid(4, longMajor);
      }
      if (response.strain !== 'NT' && lengths[response.strain] >= 4) {
        const previous = raw.slice(0, responseIndex).findLast(entry => entry.call.kind === 'bid')?.call;
        const invited = previous?.kind === 'bid' && bidValue(response) - bidValue(previous) > 5;
        const supported = evaluateSuitFit(obs.hand, response.strain, invited ? 4 : 3).totalPoints + (invited ? 9 : 0);
        if (invited && supported >= (major(response.strain) ? 25 : 29)
          && available(bid(major(response.strain) ? 4 : 5, response.strain)))
          return bid(major(response.strain) ? 4 : 5, response.strain);
        const gameLevel = major(response.strain) ? 4 : 5;
        const level = Math.min(gameLevel, hcp >= 22 ? gameLevel : hcp >= 19 ? response.level + 2
          : hcp >= 16 ? response.level + 1 : response.level);
        if (level > response.level && available(bid(level, response.strain))) return bid(level, response.strain);
      }
      if (balanced && stopper(opened) && hcp >= 18) {
        const strongNt = bid(2, 'NT');
        const ntRange = noTrumpRangeAt([...obs.auction, { seat: obs.seat, call: strongNt }], obs.auction.length, system);
        if (hcp >= (ntRange?.min ?? 18) && available(strongNt)) return strongNt;
        const nt = cheapest('NT'); if (nt) return nt;
      }
      if (response.strain === 'NT' && response.level === 2 && hcp >= 14 && available(bid(3, 'NT'))) return bid(3, 'NT');
      const strongSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      if (hcp >= 17 && strongSuit) return cheapest(strongSuit);
      if (partnerWeak && hcp < 16) return PASS;
    }
  }

  // Continue a natural overcall after its forcing support cue. The cue shows
  // A takeout doubler's free new suit after our minimum natural answer
  // promises 17+ and five cards. A new suit answering our cue is compulsory
  // and carries no such strength promise.
  const partnerTakeout = obs.auction.findIndex((entry, index) => entry.seat === partnerOf(obs.seat)
    && isTakeoutDoubleAt(obs.auction, index));
  const afterPartnerTakeout = partnerTakeout >= 0 ? obs.auction.filter((entry, index) => index > partnerTakeout
    && sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid') : [];
  const ourAdvance = afterPartnerTakeout[0], strongRebid = afterPartnerTakeout[1];
  const beforeAdvance = ourAdvance && obs.auction.slice(0, obs.auction.indexOf(ourAdvance))
    .findLast(entry => entry.call.kind === 'bid')?.call;
  const minimumAdvance = ourAdvance?.call.kind === 'bid' && beforeAdvance?.kind === 'bid'
    && bidValue(ourAdvance.call) - bidValue(beforeAdvance) <= 5;
  if (afterPartnerTakeout.length === 2 && ourAdvance?.seat === obs.seat && strongRebid?.seat === partnerOf(obs.seat)
    && strongRebid.call.kind === 'bid') {
    if (strongRebid.call.strain === 'NT') {
      const range = noTrumpRangeAt(obs.auction, obs.auction.indexOf(strongRebid), system);
      if (range && hcp + range.min >= 25 && available(bid(3, 'NT'))) return bid(3, 'NT');
    } else if (minimumAdvance && ourAdvance?.call.kind === 'bid' && strongRebid.call.strain !== ourAdvance.call.strain
      && !enemyNaturalSuits.has(strongRebid.call.strain) && lengths[strongRebid.call.strain] <= 2 && hcp + 17 >= 25) {
      if (balanced && [...enemyNaturalSuits].every(stopper) && available(bid(3, 'NT'))) return bid(3, 'NT');
      const ownSuit = longest(SUITS.filter(suit => lengths[suit] >= 5 && !enemyNaturalSuits.has(suit)));
      if (ownSuit) return cheapest(ownSuit);
    }
  }
  if (afterPartnerTakeout.length === 2 && ourAdvance?.seat === obs.seat && ourAdvance.call.kind === 'bid'
    && enemyNaturalSuits.has(ourAdvance.call.strain as Suit)
    && strongRebid?.seat === partnerOf(obs.seat) && strongRebid.call.kind === 'bid'
    && strongRebid.call.strain !== 'NT' && !enemyNaturalSuits.has(strongRebid.call.strain)
    // The compulsory cue answer may be the doubler's best three-card suit.
    // Five cards here are needed before the public auction establishes a fit.
    && lengths[strongRebid.call.strain] >= 5 && firstNatural?.call.kind === 'bid') {
    const trump = strongRebid.call.strain;
    const minimum = firstNatural.call.level === 1 ? 12 : firstNatural.call.level === 2 ? 13 : 15;
    const points = evaluateSuitFit(obs.hand, trump, 3).totalPoints + minimum;
    if (points >= (major(trump) ? 25 : 29) && available(bid(major(trump) ? 4 : 5, trump)))
      return bid(major(trump) ? 4 : 5, trump);
  }
  if (afterPartnerTakeout.length === 2 && minimumAdvance && ourAdvance?.seat === obs.seat && ourAdvance.call.kind === 'bid'
    && ourAdvance.call.strain !== 'NT' && !enemyNaturalSuits.has(ourAdvance.call.strain)
    && strongRebid?.seat === partnerOf(obs.seat) && strongRebid.call.kind === 'bid'
    && strongRebid.call.strain !== 'NT' && strongRebid.call.strain !== ourAdvance.call.strain
    && !enemyNaturalSuits.has(strongRebid.call.strain) && lengths[strongRebid.call.strain] >= 3) {
    const trump = strongRebid.call.strain;
    const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints + 17;
    if (points >= (major(trump) ? 25 : 29) && available(bid(major(trump) ? 4 : 5, trump)))
      return bid(major(trump) ? 4 : 5, trump);
    if (points >= 23 && major(trump) && available(bid(3, trump))) return bid(3, trump);
  }

  // Continue a natural overcall after its forcing support cue. The cue shows
  // 10+ and three-card support; a minimum repeat does not show new values.
  const directOvercall = raw[1];
  const cueAdvance = raw[3];
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT'
    && directOvercall?.call.kind === 'bid' && directOvercall.call.strain !== 'NT'
    && directOvercall.call.strain !== firstNatural.call.strain
    && cueAdvance?.call.kind === 'bid' && cueAdvance.call.strain === firstNatural.call.strain
    && sideOf(directOvercall.seat) === sideOf(obs.seat)) {
    const sideCalls = raw.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
    if (obs.seat === cueAdvance.seat && sideCalls.length === 3) {
      const rebid = sideCalls[2].call as Bid;
      const suit = directOvercall.call.strain;
      const low = bidValue(bid(1, suit)) > bidValue(firstNatural.call) ? 1 : 2;
      const min = rebid.strain === suit && rebid.level === low + 1 ? (low === 1 ? 8 : 10) : 13;
      const supportedPoints = evaluateSuitFit(obs.hand, suit, 5).totalPoints + min;
      if (lengths[suit] >= 3 && supportedPoints >= (major(suit) ? 25 : 29)) return bid(major(suit) ? 4 : 5, suit);
      if (hcp + min >= 25 && stopper(firstNatural.call.strain)) return bid(3, 'NT');
      if (major(suit) && lengths[suit] >= 3 && (supportedPoints >= 23 || evaluateSuitFit(obs.hand, suit, 5).totalPoints >= 10)
        && available(bid(3, suit))) return bid(3, suit);
      if (rebid.strain !== suit && lengths[suit] >= 3) return cheapest(suit);
      return PASS;
    }
    if (obs.seat === directOvercall.seat && sideCalls.length === 4) {
      const advance = sideCalls[3].call as Bid;
      if (advance.strain === 'NT' && advance.level === 2 && hcp >= 15) return bid(3, 'NT');
      if (advance.strain === directOvercall.call.strain && advance.level === 3 && major(advance.strain)
        && hcp >= 15) return bid(4, advance.strain);
    }
  }

  // A strong takeout doubler bids a long suit after partner's forced response.
  if (raw.length === 5 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[1].seat === obs.seat && raw[1].call.kind === 'double' && raw[2].call.kind === 'pass'
    && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === 'bid' && raw[4].call.kind === 'pass' && hcp >= 17) {
    const ownSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
    if (ownSuit) return cheapest(ownSuit);
  }

  // Natural overcall continuations have public ranges too. A simple raise
  // shows constructive values; a new suit is nonforcing but not valueless.
  // Evaluate real fits before falling back to Pass in an extended auction.
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.strain !== 'NT'
    && sideOf(firstNatural.seat) !== sideOf(obs.seat)
    && directOvercall?.call.kind === 'bid' && directOvercall.call.strain !== 'NT'
    && directOvercall.call.strain !== firstNatural.call.strain
    && sideOf(directOvercall.seat) === sideOf(obs.seat)
    && bidValue(directOvercall.call) - bidValue(firstNatural.call) <= 5) {
    const ours = raw.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
    const partner = ours.findLast(entry => entry.seat === partnerOf(obs.seat));
    const enemies = new Set(raw.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid'
      && entry.call.strain !== 'NT').map(entry => (entry.call as Bid).strain as Suit));
    if (partner?.call.kind === 'bid' && partner.call.strain !== 'NT' && ours.at(-1) === partner
      && !enemies.has(partner.call.strain) && partner.call.level < (major(partner.call.strain) ? 4 : 5)) {
      const trump = partner.call.strain;
      const raisedOvercall = trump === directOvercall.call.strain && partner.seat !== directOvercall.seat;
      const partnerLength = raisedOvercall ? 3 : 5;
      const partnerMin = partner.seat === directOvercall.seat ? directOvercall.call.level === 1 ? 8 : 10
        : cueAdvance?.call.kind === 'bid' && cueAdvance.call.strain === firstNatural.call.strain ? 10
          : raisedOvercall ? 6 : 8;
      const points = evaluateSuitFit(obs.hand, trump, partnerLength).totalPoints + partnerMin;
      if (lengths[trump] + partnerLength >= 8) {
        const gameLevel = major(trump) ? 4 : 5;
        if (points >= (major(trump) ? 25 : 29) && available(bid(gameLevel, trump))) return bid(gameLevel, trump);
        if (points >= 23 && major(trump) && available(bid(3, trump))) return bid(3, trump);
      }
      if (balanced && hcp + partnerMin >= 25 && [...enemies].every(stopper) && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (balanced && hcp + partnerMin >= 23 && [...enemies].every(stopper) && available(bid(2, 'NT'))) return bid(2, 'NT');
    }
  }

  // A cuebid response to our takeout double is forcing, including when the
  // opener's partner bid before the cuebid. Describe a stopper or an unbid suit.
  if (firstNatural?.call.kind === 'bid' && ownTakeout >= 0) {
    const opened = firstNatural.call.strain;
    const partnerCue = [...raw].reverse().find(entry => entry.seat === partnerOf(obs.seat) && entry.call.kind === 'bid'
      && entry.call.strain === opened && raw.indexOf(entry) > ownTakeout);
    const lastOwnAction = [...raw].reverse().find(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind !== 'pass');
    if (partnerCue?.call.kind === 'bid' && lastOwnAction === partnerCue) {
      const shownEnemySuits = [...new Set(raw.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
        && entry.call.kind === 'bid' && entry.call.strain !== 'NT').map(entry => (entry.call as Bid).strain as Suit))];
      if (balanced && hcp >= 18 && hcp <= 20 && shownEnemySuits.every(stopper)) {
        const nt = cheapest('NT');
        if (nt) return nt;
      }
      const opponentSuits = raw.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid' && entry.call.strain !== 'NT')
        .map(entry => (entry.call as Bid).strain as Suit);
      const natural = longest(SUITS.filter(suit => !opponentSuits.includes(suit) && lengths[suit] >= 4));
      if (natural) return cheapest(natural);
      return cheapest(opened) ?? PASS;
    }
  }

  // Conservative penalty doubles after both partnerships have described
  // their hands. Direct doubles of suit openings and preempts remain takeout;
  // this branch is reached only in an established competitive auction. A
  // trump stack alone is insufficient: require trump quality, outside quick
  // tricks, partnership activity and enough high-card strength. Vulnerable
  // opponents lower the HCP threshold by one, but never the shape or quick-
  // trick requirements.
  const lastBidEntry = [...obs.auction].reverse().find(entry => entry.call.kind === 'bid');
  if (lastBidEntry?.call.kind === 'bid' && sideOf(lastBidEntry.seat) !== sideOf(obs.seat)
    && available({ kind: 'double' }) && lastBidEntry.call.level >= 1) {
    const ourNaturalBids = obs.auction.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
    const opponentBids = obs.auction.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid');
    const firstOurBid = ourNaturalBids[0]?.call;
    const targetStrain = lastBidEntry.call.strain;
    const artificialCue = isArtificialBidAt(obs.auction, obs.auction.indexOf(lastBidEntry), system)
      || firstOurBid?.kind === 'bid' && targetStrain !== 'NT'
      && ourNaturalBids.some(entry => entry.call.kind === 'bid' && entry.call.strain === targetStrain
        && obs.auction.indexOf(entry) < obs.auction.indexOf(lastBidEntry))
      && !opponentBids.slice(0, -1).some(entry => entry.call.kind === 'bid' && entry.call.strain === targetStrain);
    const opponentsVulnerable = obs.vulnerability === 'Both'
      || (obs.vulnerability === 'NS' && sideOf(lastBidEntry.seat) === 'NS')
      || (obs.vulnerability === 'EW' && sideOf(lastBidEntry.seat) === 'EW');
    if (!artificialCue && ourNaturalBids.length >= 1 && opponentBids.length >= 1
      && (ourNaturalBids.length >= 2 || obs.auction.indexOf(lastBidEntry) >= (firstNatural ? obs.auction.indexOf(firstNatural) + 3 : 3))) {
      const contract = lastBidEntry.call;
      if (contract.strain === 'NT') {
        const threshold = opponentsVulnerable ? 15 : 16;
        if (contract.level >= 3 && hcp >= threshold && quickTricks() >= 3.5) return { kind: 'double' };
      } else {
        const trump = contract.strain;
        const trumpRanks = obs.hand.filter(card => card.suit === trump).map(card => card.rank);
        const topTrumpHonors = trumpRanks.filter(rank => rank >= 11).length;
        const hasTopTrump = trumpRanks.some(rank => rank >= 12);
        const ownStrengthRedouble = obs.auction.some(entry => sideOf(entry.seat) === sideOf(obs.seat)
          && entry.call.kind === 'redouble');
        const threshold = (contract.level >= 4 ? 15 : ownStrengthRedouble ? 10 : 14) - (opponentsVulnerable ? 1 : 0);
        const requiredQuickTricks = contract.level >= 4 ? 3 : 2.5;
        // Generic quick-trick tables cap AKQJ at two. In a trump contract,
        // four consecutive top trumps can produce four defensive tricks.
        // Replace only the trump contribution; keep outside defenses and
        // all length, honor, strength and partnership-context requirements.
        let topTrumpRun = 0;
        for (let rank = 14; rank >= 2 && trumpRanks.includes(rank); rank--) topTrumpRun++;
        const trumpQuickTricks = trumpRanks.includes(14) ? trumpRanks.includes(13) ? 2
          : trumpRanks.includes(12) ? 1.5 : 1 : trumpRanks.includes(13)
            ? trumpRanks.includes(12) ? 1 : trumpRanks.length >= 2 ? 0.5 : 0 : 0;
        const defensiveTricks = quickTricks() + Math.max(0, topTrumpRun - trumpQuickTricks);
        if (lengths[trump] >= 4 && topTrumpHonors >= 2 && hasTopTrump
          && hcp >= threshold && defensiveTricks >= requiredQuickTricks) return { kind: 'double' };
      }
    }
  }
  return undefined;
}

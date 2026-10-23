import { bidValue, sameCall } from '../core/auction';
import { type Call, type Strain, type Suit, PASS, SUITS, partnerOf, sideOf } from '../core/types';
import { type BiddingObservation } from './observation';
import { evaluateHand } from './bidding-legacy';
import { type BiddingSystem } from './systems';
import { analyzeAuctionSemantics, classifyDoubleAt, isArtificialBidAt, isNaturalNoTrumpAt, isTakeoutDoubleAt, naturalSuitMinimum, noTrumpRangeAt, publicCallMeaningAt, publicNoTrumpQuestionAt, publicPlayerConstraints, publicTakeoutDoubleAt, publicInterruptedTransferBefore } from './bidding-semantics';
import { evaluateSuitFit, publicSupportMinimum } from './suit-evaluation';

type Bid = Extract<Call, { kind: 'bid' }>;
const bid = (level: number, strain: Strain): Bid => ({ kind: 'bid', level, strain });
const major = (suit: Suit): boolean => suit === 'H' || suit === 'S';

/** SAYC-style competitive methods shared by the natural defensive profile. */
export function chooseCompetitiveCall(obs: BiddingObservation, system: BiddingSystem): Call | undefined {
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const partnerTechnical = obs.auction.findLastIndex((entry, index) => entry.seat === partnerOf(obs.seat)
    && isTakeoutDoubleAt(obs.auction, index));
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
    return ranks.some(rank => rank >= 12) && (ranks.length >= 7
      || ranks.length >= 6 && ranks.filter(rank => rank >= 10).length >= 2);
  };
  const reasonableOvercallSuit = (suit: Suit, level: number) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    if (level === 1) return ranks.some(rank => rank >= 12) || ranks.length >= 6;
    return ranks.filter(rank => rank >= 10).length >= 2 && ranks.some(rank => rank >= 12)
      || ranks.length >= 6 && ranks.some(rank => rank >= 13);
  };
  const honorRichLongSuit = (suit: Suit) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    return ranks.length >= 6 && ranks.filter(rank => rank >= 12).length >= 2
      && ranks.filter(rank => rank >= 10).length >= 3;
  };
  const honorRichMajor = (suit: Suit) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    return ranks.length >= 5 && ranks.filter(rank => rank >= 12).length >= 2
      && ranks.filter(rank => rank >= 10).length >= 3 && ranks.some(rank => rank >= 13);
  };
  const cashTopRun = (suit: Suit) => {
    const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
    let run = 0;
    for (let rank = 14; rank >= 2 && ranks.includes(rank); rank--) run++;
    return run;
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
  // Equal-length choices of a two-suiter use our visible trump quality, then
  // prefer a major. Never infer which of partner's two suits is better.
  const preferredTwoSuitChoice = (suits: Suit[]) => [...suits].sort((a, b) => {
    const quality = (suit: Suit) => obs.hand.filter(card => card.suit === suit)
      .reduce((sum, card) => sum + Math.max(card.rank - 10, 0), 0);
    return lengths[b] - lengths[a] || quality(b) - quality(a)
      || Number(major(b)) - Number(major(a)) || SUITS.indexOf(b) - SUITS.indexOf(a);
  })[0];
  const firstBid = obs.auction.findIndex(entry => entry.call.kind === 'bid');
  const raw = firstBid < 0 ? obs.auction : obs.auction.slice(firstBid);
  const semantics = system === 'sayc' ? analyzeAuctionSemantics(obs.auction, obs.seat, system) : undefined;
  let naturalNfStop = false;
  const meaning = semantics?.convention ?? 'none';
  const firstNatural = raw.find(entry => entry.call.kind === 'bid');
  const enemyNaturalSuits = new Set(obs.auction.flatMap((entry, index) =>
    sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid' && entry.call.strain !== 'NT'
      && !isArtificialBidAt(obs.auction, index, system) ? [entry.call.strain] : []));
  const current = obs.auction.findLast(entry => entry.call.kind === 'bid');
  const partnerPublic = publicPlayerConstraints(obs.auction, partnerOf(obs.seat), system);
  const sideBids = obs.auction.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
  const latestPartnerBid = sideBids.findLast(entry => entry.seat === partnerOf(obs.seat));
  const ntQuestion = latestPartnerBid
    && publicNoTrumpQuestionAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system);
  const interruptedTransfer = publicInterruptedTransferBefore(obs.auction, obs.seat, system);
  if (interruptedTransfer?.target) {
    const target = interruptedTransfer.target;
    const accept = cheapest(target);
    return lengths[target] >= 3 && accept && accept.level <= 3 ? accept : PASS;
  }
  // An opposing 2H has removed the ordinary denial/heart answers. Preserve
  // a real four-card spade answer or the existing NT range, never promote
  // the blocked four-card heart answer into an undefined three-level cue.
  if (ntQuestion?.kind === 'stayman' && ntQuestion.platform.seat === obs.seat
    && ntQuestion.platform.call.level === 1 && ntQuestion.request.call.level === 2
    && current?.call.kind === 'bid' && current.call.level === 2 && current.call.strain === 'H'
    && sideOf(current.seat) !== sideOf(obs.seat)
    && obs.auction.indexOf(current) > ntQuestion.request.index) {
    if (lengths.S >= 4 && available(bid(2, 'S'))) return bid(2, 'S');
    if (stopper('H') && available(bid(2, 'NT'))) return bid(2, 'NT');
    return PASS;
  }
  const lastActionIndex = obs.auction.findLastIndex(entry => entry.call.kind !== 'pass');
  const lastAction = obs.auction[lastActionIndex];
  // A penalty conversion requests defense. A long offensive suit alone does
  // not authorize withdrawing partner's double into another partial contract.
  if (lastAction?.seat === partnerOf(obs.seat) && lastAction.call.kind === 'double'
    && classifyDoubleAt(obs.auction, lastActionIndex, system) === 'penalty') return PASS;
  if (lastAction?.seat === partnerOf(obs.seat) && lastAction.call.kind === 'double') {
    const technical = publicTakeoutDoubleAt(obs.auction, lastActionIndex, system);
    if (technical) {
      const ranks = obs.hand.filter(card => card.suit === technical.target).map(card => card.rank);
      const ace = ranks.includes(14), king = ranks.includes(13), queen = ranks.includes(12);
      const trumpQuick = ace ? king ? 2 : queen ? 1.5 : 1 : king ? queen ? 1 : 0.5 : 0;
      if (ranks.length >= 6 && (ace && king || queen && (ace || king))
        && hcp >= 10 && quickTricks() - trumpQuick >= 1) return PASS;
    }
  }
  const partnerMinimum = (trump: Suit) => publicSupportMinimum(trump, lengths[trump], partnerPublic);
  if (firstNatural?.seat === partnerOf(obs.seat) && firstNatural.call.kind === 'bid'
    && firstNatural.call.level >= 2 && firstNatural.call.level <= 3 && firstNatural.call.strain !== 'NT'
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(firstNatural), system)) {
    const trump = firstNatural.call.strain;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    const gameLevel = major(trump) ? 4 : 5;
    const unshownMajor = !major(trump) && hcp >= 13 && (['H', 'S'] as Suit[]).some(suit => lengths[suit] >= 5
      && partnerPublic.suitMinimums[suit] === 0 && (cheapest(suit)?.level ?? 7) <= 3);
    if (!unshownMajor && fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(trump) >= (major(trump) ? 25 : 29)
      && available(bid(gameLevel, trump))) return bid(gameLevel, trump);
  }
  if (!semantics?.mustBid && firstNatural?.seat === obs.seat && firstNatural.call.kind === 'bid'
    && firstNatural.call.level >= 2 && firstNatural.call.level <= 4 && firstNatural.call.strain !== 'NT'
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(firstNatural), system)
    && hcp <= 11 && lengths[firstNatural.call.strain] <= firstNatural.call.level + 4
    && !obs.auction.some(entry => entry.seat === partnerOf(obs.seat) && entry.call.kind !== 'pass')) return PASS;
  if (latestPartnerBid && current?.call.kind === 'bid' && sideOf(current.seat) !== sideOf(obs.seat)
    && obs.auction.indexOf(current) > obs.auction.indexOf(latestPartnerBid)
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(current), system)
    && current.call.level >= (current.call.strain === 'NT' ? 3 : major(current.call.strain) ? 4 : 5)) {
    const cueIndex = obs.auction.indexOf(latestPartnerBid);
    const cueState = analyzeAuctionSemantics(obs.auction.slice(0, cueIndex + 1), obs.seat, system);
    const cueMeaning = publicCallMeaningAt(obs.auction, cueIndex, system);
    const trump = cueMeaning.supportRange?.trump;
    if (cueState.forcing === 'one-round' && ['overcall-cue', 'competitive-cue'].includes(cueState.convention) && trump) {
      const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
      // Enemy game releases the one-round cue; a now-five-level cheapest
      // repeat is not a compulsory sacrifice when public strength is short.
      if (fit.knownCombinedTrumps < 8 || fit.totalPoints + partnerMinimum(trump) < (major(trump) ? 25 : 29)) return PASS;
    }
  }
  const quietFirstMajorResponse = sideBids.length === 1 && latestPartnerBid === firstNatural
    && latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.level === 1
    && latestPartnerBid.call.strain !== 'NT' && major(latestPartnerBid.call.strain)
    && !obs.auction.slice(obs.auction.indexOf(latestPartnerBid) + 1)
      .some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind !== 'pass');
  const initialNtAdvance = sideBids.length === 1 && latestPartnerBid?.call.kind === 'bid'
    && latestPartnerBid.call.strain === 'NT' && isNaturalNoTrumpAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system)
    && !obs.auction.slice(obs.auction.indexOf(latestPartnerBid) + 1)
      .some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind !== 'pass');
  // A known natural major game survives weak response bands and released
  // response obligations. Artificial questions still get their own answer.
  if (!quietFirstMajorResponse && !initialNtAdvance && !semantics?.mustBid && !semantics?.currentContractArtificial) {
    const games = (['H', 'S'] as Suit[]).filter(trump => {
      const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
      return partnerPublic.suitMinimums[trump] > 0 && fit.knownCombinedTrumps >= 8
        && fit.totalPoints + partnerMinimum(trump) >= 25 && available(bid(4, trump));
    });
    const game = longest(games);
    if (game) return bid(4, game);
  }
  if (hcp < 6 && partnerTechnical >= 0 && !semantics?.mustBid
    && !obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'bid')
    && obs.auction.slice(partnerTechnical + 1).some(entry => sideOf(entry.seat) !== sideOf(obs.seat)
      && entry.call.kind === 'bid')) return PASS;
  const supportCue = (trump: Suit, minimum: number): Bid | undefined => {
    const enemy = obs.auction.find((entry, index) => sideOf(entry.seat) !== sideOf(obs.seat)
      && entry.call.kind === 'bid' && entry.call.strain !== 'NT' && !isArtificialBidAt(obs.auction, index, system));
    if (enemy?.call.kind !== 'bid' || enemy.call.strain === 'NT') return undefined;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    if ((fit.knownCombinedTrumps >= 8 ? fit.totalPoints : hcp) < 10) return undefined;
    const cue = cheapest(enemy.call.strain);
    if (!cue) return undefined;
    const replyLevel = [1, 2, 3, 4, 5, 6, 7].find(level => bidValue(bid(level, trump)) > bidValue(cue));
    if (replyLevel === undefined) return undefined;
    // Four of a minor can answer F1 as a partscore. Five is a real game;
    // neither that game nor a four-major answer may be forced below its floor.
    return replyLevel <= 3 || !major(trump) && replyLevel === 4 && cue.level <= 3
      || fit.knownCombinedTrumps >= 8 && fit.totalPoints + Math.max(minimum, partnerMinimum(trump))
        >= (major(trump) ? 25 : 29) ? cue : undefined;
  };
  const affordableSupport = (trump: Suit, minimum: number): Call | undefined => {
    const low = cheapest(trump);
    if (!low) return undefined;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    const gameLevel = major(trump) ? 4 : 5;
    if (low.level >= gameLevel) return fit.knownCombinedTrumps >= 8
      && fit.totalPoints + Math.max(minimum, partnerMinimum(trump)) >= (major(trump) ? 25 : 29) ? low : PASS;
    if (low.level === 4) return fit.knownCombinedTrumps >= 9 && fit.totalPoints >= 10 ? low : PASS;
    return fit.totalPoints >= 6 ? low : PASS;
  };
  const realNtPlatform = (entry: typeof latestPartnerBid) => {
    if (entry?.call.kind !== 'bid' || entry.call.strain !== 'NT') return false;
    return isNaturalNoTrumpAt(obs.auction, obs.auction.indexOf(entry), system);
  };
  // The first genuine one-NT defense has the same defensive prerequisites
  // whether NT was an opening or a natural answer to a suit opening.
  if (current?.call.kind === 'bid' && current.call.level === 1 && current.call.strain === 'NT'
    && sideOf(current.seat) !== sideOf(obs.seat) && realNtPlatform(current)
    && !obs.auction.some(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind !== 'pass')
    && hcp >= 15 && quickTricks() >= 3 && available({ kind: 'double' })
    && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system) === 'penalty')
    return { kind: 'double' };
  if (!semantics?.mustBid && semantics?.forcing !== 'game' && latestPartnerBid?.call.kind === 'bid'
    && latestPartnerBid.call.level === 1 && realNtPlatform(latestPartnerBid)
    && current?.call.kind === 'bid' && current.call.strain !== 'NT'
    && sideOf(current.seat) !== sideOf(obs.seat)
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(current), system) && hcp >= 5 && hcp <= 9) {
    const minor = longest((['C', 'D'] as Suit[]).filter(suit => lengths[suit] >= 6
      && !enemyNaturalSuits.has(suit) && cheapest(suit)?.level === 3
      && publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: cheapest(suit)! }], obs.auction.length, system)
        .role === 'nt-competitive-minor-escape'));
    if (minor) return cheapest(minor);
  }
  const ownTechnicalIndex = obs.auction.findLastIndex((entry, index) => entry.seat === obs.seat
    && isTakeoutDoubleAt(obs.auction, index));
  const ownLongRebid = sideBids.findLast(entry => entry.seat === obs.seat && entry.call.kind === 'bid'
    && entry.call.strain !== 'NT' && !isArtificialBidAt(obs.auction, obs.auction.indexOf(entry), system));
  if (!semantics?.mustBid && ownLongRebid?.call.kind === 'bid' && ownLongRebid.call.strain !== 'NT'
    && current?.call.kind === 'bid' && sideOf(current.seat) !== sideOf(obs.seat)
    && obs.auction.indexOf(current) > obs.auction.indexOf(ownLongRebid)
    && !enemyNaturalSuits.has(ownLongRebid.call.strain) && hcp >= 10
    && lengths[ownLongRebid.call.strain] >= 7 && reasonableOvercallSuit(ownLongRebid.call.strain, 2)) {
    const repeat = cheapest(ownLongRebid.call.strain);
    if (repeat && repeat.level <= 2) return repeat;
  }
  if (system === 'sayc' && firstNatural?.seat === obs.seat && firstNatural.call.kind === 'bid'
    && firstNatural.call.level === 1 && (firstNatural.call.strain === 'C' || firstNatural.call.strain === 'D')
    && sideBids.filter(entry => entry.seat === obs.seat).length === 1
    && current?.call.kind === 'bid' && current.call.level === 1 && current.call.strain === 'NT'
    && sideOf(current.seat) !== sideOf(obs.seat) && realNtPlatform(current)) {
    const openingCall = firstNatural.call;
    const openingSuit = openingCall.strain;
    if (openingSuit === 'NT') return undefined;
    const afterNt = obs.auction.slice(obs.auction.indexOf(current) + 1);
    const twoPasses = afterNt.length === 2 && afterNt.every(entry => entry.call.kind === 'pass');
    const shape = Object.values(lengths).sort((a, b) => b - a).join('');
    if (twoPasses && hcp >= 19 && hcp <= 21 && (balanced || shape === '6322') && SUITS.every(stopper)
      && available(bid(2, 'NT'))) return bid(2, 'NT');
    // Failure of this bounded NT role does not create a penalty obligation.
    // A real alternative suit remains available; otherwise accept defense.
    const second = longest(SUITS.filter(suit => suit !== openingSuit && lengths[suit] >= 4));
    if (hcp >= 17 && second && (cheapest(second)?.level ?? 7) <= 2) return cheapest(second);
    const original = openingSuit;
    if (hcp >= 12 && lengths[original] >= 6 && reasonableOvercallSuit(original, 2)) return cheapest(original);
    return PASS;
  }
  if (!semantics?.mustBid && hcp >= 17 && ownTechnicalIndex >= 0
    && ownLongRebid?.call.kind === 'bid' && ownLongRebid.call.strain !== 'NT'
    && obs.auction.indexOf(ownLongRebid) > ownTechnicalIndex && current?.call.kind === 'bid'
    && sideOf(current.seat) !== sideOf(obs.seat) && !enemyNaturalSuits.has(ownLongRebid.call.strain)
    && lengths[ownLongRebid.call.strain] >= 6 && reasonableOvercallSuit(ownLongRebid.call.strain, 3)) {
    const repeat = cheapest(ownLongRebid.call.strain);
    if (repeat && repeat.level <= 3) return repeat;
  }
  // A natural, confirmed minor fit can compete at four without claiming a
  // five-level game or inventing invitational strength from the absolute level.
  if (!semantics?.mustBid && current?.call.kind === 'bid' && sideOf(current.seat) !== sideOf(obs.seat)
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(current), system)
    && latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.strain !== 'NT'
    && !major(latestPartnerBid.call.strain)
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system)) {
    const trump = latestPartnerBid.call.strain;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    const low = cheapest(trump);
    if (fit.knownCombinedTrumps >= 9 && low?.level === 4 && fit.totalPoints >= 10) {
      if (fit.totalPoints + partnerMinimum(trump) >= 29 && available(bid(5, trump))) return bid(5, trump);
      if (!sideBids.some(entry => entry.seat === obs.seat)) {
        const cue = supportCue(trump, partnerMinimum(trump));
        if (cue) return cue;
      }
      return low;
    }
  }
  // Enemy natural NT over a weak two changes the card's new-suit response
  // to constructive 10+ / five cards, nonforcing. The interference is public;
  // a clean weak-two auction retains its ordinary 13+ forcing response.
  if (!semantics?.mustBid && sideBids.length === 1 && latestPartnerBid === firstNatural
    && latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.level === 2
    && latestPartnerBid.call.strain !== 'NT' && (partnerPublic.hcpRange?.max ?? Infinity) <= 11
    && current?.call.kind === 'bid' && current.call.strain === 'NT'
    && sideOf(current.seat) !== sideOf(obs.seat) && realNtPlatform(current) && hcp >= 10) {
    const original = latestPartnerBid.call.strain;
    const natural = longest(SUITS.filter(suit => suit !== original && lengths[suit] >= 5
      && cheapest(suit)?.level === 3 && reasonableOvercallSuit(suit, 3)));
    if (natural) return cheapest(natural);
  }
  // Weak new-minor correction is a publicly recognizable role, not a private
  // hand-strength exception to an otherwise forcing new-suit response.
  if (!semantics?.mustBid && semantics?.forcing !== 'game' && latestPartnerBid?.call.kind === 'bid'
    && latestPartnerBid.call.strain !== 'NT' && latestPartnerBid.call.level <= 3
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system)
    && lengths[latestPartnerBid.call.strain] <= 1) {
    const badSuit = latestPartnerBid.call.strain;
    const oldFit = lengths[badSuit] + partnerPublic.suitMinimums[badSuit];
    const candidates = SUITS.filter(suit => suit !== badSuit && lengths[suit] >= 6
      && !enemyNaturalSuits.has(suit) && reasonableOvercallSuit(suit, 2));
    const escape = longest(candidates.filter(suit => {
      const low = cheapest(suit);
      const shown = publicPlayerConstraints(obs.auction, obs.seat, system).suitMinimums[suit];
      const partnerReturned = shown > 0 && sideBids.filter(entry => entry.seat === partnerOf(obs.seat)).length > 1;
      return low && low.level === 3 && hcp >= 5 && hcp <= 9 && oldFit < 8 && !partnerReturned
        && publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: low }], obs.auction.length, system).role === 'weak-minor-escape';
    }));
    if (escape) return cheapest(escape);
  }
  // Strength XX is public strength even before any natural response. A
  // strong takeout rebid likewise retains its range after later preferences.
  const ownStrengthXX = obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'redouble');
  const partnerStrongTakeoutRebid = partnerTechnical >= 0 && partnerPublic.pointSources.some(source =>
    source.index > partnerTechnical && source.type === 'hcp' && source.range.min >= 17);
  const latestStrongPartner = sideBids.findLast(entry => entry.seat === partnerOf(obs.seat));
  if (latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.strain !== 'NT'
    && !major(latestPartnerBid.call.strain) && !semantics?.mustBid
    && publicCallMeaningAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system).role === 'takeout-minor-invitation') {
    const trump = latestPartnerBid.call.strain;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    return fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(trump) >= 29
      && available(bid(5, trump)) ? bid(5, trump) : PASS;
  }
  const latestNaturalMajor = latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.strain !== 'NT'
    && major(latestPartnerBid.call.strain)
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system);
  const weakMajorPartner = latestNaturalMajor && latestPartnerBid.call.kind === 'bid'
    && latestPartnerBid.call.level === 2 && (partnerPublic.hcpRange?.max ?? Infinity) <= 11;
  const ownNaturalDescription = sideBids.some(entry => entry.seat === obs.seat && entry.call.kind === 'bid' && entry.call.strain !== 'NT'
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(entry), system));
  if (latestNaturalMajor && latestPartnerBid.call.kind === 'bid' && !semantics?.mustBid
    && (weakMajorPartner || ownNaturalDescription)) {
    const trump = latestPartnerBid.call.strain as Suit;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    const total = fit.totalPoints + partnerMinimum(trump);
    // Freed response obligations do not cancel a publicly known game. Leave
    // slam-strength continuations to the dedicated control/keycard branch.
    if (fit.knownCombinedTrumps >= 8 && total >= 25 && total < 33 && available(bid(4, trump))) return bid(4, trump);
  }
  if (partnerStrongTakeoutRebid && latestStrongPartner?.call.kind === 'bid' && latestStrongPartner.call.strain !== 'NT'
    && major(latestStrongPartner.call.strain) && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestStrongPartner), system)) {
    const trump = latestStrongPartner.call.strain;
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(trump) >= 25
      && available(bid(4, trump))) return bid(4, trump);
  }
  if (ownStrengthXX && firstNatural?.seat === partnerOf(obs.seat) && firstNatural.call.kind === 'bid'
    && firstNatural.call.strain !== 'NT' && major(firstNatural.call.strain) && lengths[firstNatural.call.strain] >= 3
    && evaluateSuitFit(obs.hand, firstNatural.call.strain, 5).totalPoints + partnerMinimum(firstNatural.call.strain) >= 25
    && available(bid(4, firstNatural.call.strain))) return bid(4, firstNatural.call.strain);
  if (!semantics?.currentContractArtificial && (ownStrengthXX || partnerStrongTakeoutRebid)
    && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25 && [...enemyNaturalSuits].every(stopper)
    && Math.min(...SUITS.map(suit => lengths[suit])) >= 2 && available(bid(3, 'NT')))
    return bid(3, 'NT');
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT' && major(firstNatural.call.strain)
    && firstNatural.seat === partnerOf(obs.seat) && lengths[firstNatural.call.strain] >= 3
    && obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'redouble')
    && !obs.auction.some(entry => entry.seat === obs.seat && entry.call.kind === 'bid')
    && evaluateSuitFit(obs.hand, firstNatural.call.strain, 5).totalPoints >= 10
    && available(bid(3, firstNatural.call.strain))) return bid(3, firstNatural.call.strain);
  const ownSideAction = obs.auction.some(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind !== 'pass');
  // A technical double is determined by the complete public auction. In
  // particular an opener can reopen after a passed response and a raise;
  // owning an opening bid does not turn shortness into a penalty double.
  if (system === 'sayc' && !semantics?.mustBid && available({ kind: 'double' })) {
    const proposed = [...obs.auction, { seat: obs.seat, call: { kind: 'double' } as Call }];
    const technical = publicTakeoutDoubleAt(proposed, obs.auction.length, system);
    if (technical && ['reopening', 'responsive', 'sandwich', 'repeat'].includes(technical.kind)
      && current?.call.kind === 'bid' && current.call.strain !== 'NT') {
      const target = technical.target;
      const preferred = technical.preferredSuits;
      const floor = technical.kind === 'responsive' ? (current.call.level >= 3 ? 8 : 6)
        : technical.kind === 'reopening' ? (current.call.level >= 3 ? 14 : 12) : 12;
      const partnerNaturalSuit = latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.strain !== 'NT'
        && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartnerBid), system)
        ? latestPartnerBid.call.strain : undefined;
      // With an ordinary raise available, show partner a real fit rather
      // than asking for the other suits. Weak doubles must cover both.
      const hasPartnerFit = technical.kind === 'responsive' && partnerNaturalSuit
        && lengths[partnerNaturalSuit] >= 3;
      const shape = lengths[target] <= 2 && preferred.length >= 2
        && preferred.every(suit => lengths[suit] >= 4)
        && technical.unbidSuits.every(suit => lengths[suit] >= 3);
      if (!hasPartnerFit && hcp >= floor && shape) return { kind: 'double' };
    }
  }
  if (!ownSideAction && firstNatural?.call.kind === 'bid' && firstNatural.call.strain !== 'NT'
    && current?.call.kind === 'bid' && current.call.strain !== 'NT' && current.call.level <= 3
    && sideOf(current.seat) !== sideOf(obs.seat) && raw.filter(entry => entry.call.kind === 'bid').length >= 2) {
    const unbid = SUITS.filter(suit => !enemyNaturalSuits.has(suit));
    const idealShortTakeout = hcp >= 12 && enemyNaturalSuits.size === 1
      && [...enemyNaturalSuits].every(suit => lengths[suit] <= 1)
      && unbid.every(suit => lengths[suit] >= 4);
    if (idealShortTakeout && available({ kind: 'double' })
      && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system) === 'takeout')
      return { kind: 'double' };
    if (hcp >= 17 && unbid.some(suit => lengths[suit] >= 5) && available({ kind: 'double' })
      && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system) === 'takeout')
      return { kind: 'double' };
    // A responder's new suit does not remove the first defender's weak jump.
    // This remains a seven-card preempt, not a low-HCP ordinary two-level bid.
    const delayedPreempt = longest(unbid.filter(suit => {
      const call = jump(suit);
      return enemyNaturalSuits.size >= 2 && call?.level === 3 && lengths[suit] >= 7 && hcp >= 5 && hcp <= 10
        && reasonablePreemptSuit(suit);
    }));
    if (delayedPreempt) return jump(delayedPreempt);
    const natural = longest(unbid.filter(suit => {
      const call = cheapest(suit);
      return call && hcp <= 16 && lengths[suit] >= 5 && reasonableOvercallSuit(suit, call.level)
        && hcp >= (call.level <= 2 ? lengths[suit] >= 7 ? 8 : 10
          : honorRichLongSuit(suit) || cashTopRun(suit) >= 5 && lengths[suit] >= 6 ? 10 : 14);
    }));
    if (natural) return cheapest(natural);
  }
  // A good original long suit remains a real source of play after responder
  // names a poor-fit major and an opponent intervenes. The cheapest repeat
  // is descriptive, not a strength-inventing jump invitation.
  if (!semantics?.mustBid && firstNatural?.seat === obs.seat && firstNatural.call.kind === 'bid'
    && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT'
    && !isArtificialBidAt(obs.auction, firstBid, system)
    && sideBids.filter(entry => entry.seat === obs.seat).length === 1
    && latestPartnerBid?.call.kind === 'bid' && latestPartnerBid.call.strain !== 'NT'
    && latestPartnerBid.call.strain !== firstNatural.call.strain && lengths[latestPartnerBid.call.strain] <= 1
    && current?.call.kind === 'bid' && sideOf(current.seat) !== sideOf(obs.seat) && current.call.level <= 2
    && hcp >= 12 && hcp <= 16 && honorRichLongSuit(firstNatural.call.strain)) {
    const repeat = cheapest(firstNatural.call.strain);
    if (repeat && repeat.level <= 3) return repeat;
  }
  // A strong natural opener's first second suit is not a fresh overcall.
  // Describe its real four-plus cards before a minimum original-suit repeat;
  // a passed partner supplies no game points and does not justify a GF jump.
  if (!semantics?.mustBid && firstNatural?.seat === obs.seat && firstNatural.call.kind === 'bid'
    && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT' && hcp >= 17
    && sideBids.filter(entry => entry.seat === obs.seat).length === 1
    && current?.call.kind === 'bid' && sideOf(current.seat) !== sideOf(obs.seat) && current.call.level <= 2) {
    const original = firstNatural.call.strain;
    const second = longest(SUITS.filter(suit => suit !== original && !enemyNaturalSuits.has(suit)
      && lengths[suit] >= 4 && (cheapest(suit)?.level ?? 7) <= 2));
    if (second) return cheapest(second);
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
      // Seven-card offensive hands can describe their major over a genuine
      // strong club opening before choosing a lead-directing double.
      if (!ownSideAction && firstNatural?.call.kind === 'bid' && firstNatural.call.level === 2
        && firstNatural.call.strain === 'C' && isArtificialBidAt(obs.auction, obs.auction.indexOf(firstNatural), system)) {
        const longMajor = longest((['H', 'S'] as Suit[]).filter(suit => lengths[suit] >= 7
          && hcp >= 10 && reasonableOvercallSuit(suit, 2)));
        const natural = longMajor && cheapest(longMajor);
        if (natural && natural.level <= 3) return natural;
      }
      if (current.call.strain !== 'NT' && available({ kind: 'double' })) {
        const leadSuit = current.call.strain;
        const ranks = obs.hand.filter(card => card.suit === leadSuit).map(card => card.rank);
        const leadHolding = ranks.length >= 3 && [14, 13].every(rank => ranks.includes(rank))
          || ranks.length >= 4 && ranks.filter(rank => rank >= 10).length >= 3
            && ranks.some(rank => rank >= 12)
          || ranks.length >= 5 && ([14, 12].every(rank => ranks.includes(rank))
            || [13, 12].every(rank => ranks.includes(rank))
            || [12, 11].every(rank => ranks.includes(rank)));
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
    return cheapest(preferredTwoSuitChoice(shown));
  }
  // Enemy natural bidding releases the compulsory Michaels advance, but
  // does not turn the artificial cue into a natural strength promise for NT.
  const ourFirst = obs.auction.find(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT'
    && ourFirst?.call.kind === 'bid' && ourFirst.seat === partnerOf(obs.seat)
    && isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system)
    && (ourFirst.call.level === 2 && ourFirst.call.strain === firstNatural.call.strain
      || ourFirst.call.level === 2 && ourFirst.call.strain === 'NT')
    && sideBids.some(entry => entry.seat === obs.seat) && !semantics?.mustBid) {
    const latestPartner = sideBids.findLast(entry => entry.seat === partnerOf(obs.seat));
    const ownAdvance = sideBids.findLast(entry => entry.seat === obs.seat && entry.call.kind === 'bid'
      && entry.call.strain !== 'NT' && !isArtificialBidAt(obs.auction, obs.auction.indexOf(entry), system));
    const trump = latestPartner?.call.kind === 'bid' && latestPartner.call.strain !== 'NT'
      && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartner), system) ? latestPartner.call.strain
      : ownAdvance?.call.kind === 'bid' ? ownAdvance.call.strain : undefined;
    if (trump && trump !== 'NT') {
      const partnerLength = naturalSuitMinimum(obs.auction, partnerOf(obs.seat), trump, system);
      const fit = evaluateSuitFit(obs.hand, trump, partnerLength);
      const minimum = partnerMinimum(trump);
      const level = major(trump) ? 4 : 5;
      if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + minimum >= (major(trump) ? 25 : 29)
        && available(bid(level, trump))) return bid(level, trump);
      const low = cheapest(trump);
      if (current && sideOf(current.seat) !== sideOf(obs.seat) && low && low.level <= (major(trump) ? 3 : 4)
        && fit.knownCombinedTrumps >= (major(trump) ? 8 : 9) && fit.totalPoints >= 10) return low;
      if (current === latestPartner || current && sideOf(current.seat) !== sideOf(obs.seat)) return PASS;
    }
  }
  if (firstNatural?.call.kind === 'bid' && firstNatural.call.level === 1 && firstNatural.call.strain !== 'NT'
    && ourFirst?.call.kind === 'bid' && ourFirst.seat === obs.seat && ourFirst.call.level === 2
    && ourFirst.call.strain === firstNatural.call.strain && isArtificialBidAt(obs.auction, obs.auction.indexOf(ourFirst), system)) {
    const advance = obs.auction.find((entry, index) => index > obs.auction.indexOf(ourFirst)
      && entry.seat === partnerOf(obs.seat) && entry.call.kind === 'bid');
    if (advance && current === advance && hcp <= 16 && !semantics?.mustBid
      && publicCallMeaningAt(obs.auction, obs.auction.indexOf(advance), system).role === 'two-suit-choice') return PASS;
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
      const points = evaluateSuitFit(obs.hand, preferred, 5).totalPoints + partnerMinimum(preferred);
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
      const overcallMinimum = partnerMinimum(trump);
      if (points + overcallMinimum >= (major(trump) ? 25 : 29)) {
        const game = bid(major(trump) ? 4 : 5, trump); if (available(game)) return game;
      }
      if (points >= 10 && firstNatural.call.strain !== 'NT') {
        const cue = supportCue(trump, overcallMinimum); if (cue) return cue;
        if (!major(trump) && points >= 13 && points <= 16 && available(bid(4, trump))) return bid(4, trump);
      }
      if (points >= 10 && major(trump) && ourFirst.call.level === 1 && available(bid(3, trump))) return bid(3, trump);
      return affordableSupport(trump, overcallMinimum);
    }
    if (ours.length === 1 && ourFirst.seat === partnerOf(obs.seat) && !weakJump) {
      const newMajor = longest((['H', 'S'] as Suit[]).filter(suit => suit !== trump && !enemyNaturalSuits.has(suit)
        && lengths[suit] >= 5 && (cheapest(suit)?.level ?? 7) <= 2
        && (hcp >= 8 || hcp === 7 && lengths[suit] >= 8 && honorRichMajor(suit))));
      if (newMajor) return cheapest(newMajor);
    }
    const latestPartner = ours.at(-1);
    if (latestPartner?.seat === partnerOf(obs.seat) && latestPartner.call.kind === 'bid'
      && !semantics?.mustBid && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartner), system)) {
      const partnerMeaning = publicCallMeaningAt(obs.auction, obs.auction.indexOf(latestPartner), system);
      if (latestPartner.call.strain !== 'NT') {
        const suit = latestPartner.call.strain;
        const partnerLength = naturalSuitMinimum(obs.auction, partnerOf(obs.seat), suit, system);
        const fit = evaluateSuitFit(obs.hand, suit, partnerLength);
        const minimum = partnerMinimum(suit);
        if (partnerMeaning.defined && fit.knownCombinedTrumps >= 8
          && fit.totalPoints + minimum >= (major(suit) ? 25 : 29)
          && available(bid(major(suit) ? 4 : 5, suit))) return bid(major(suit) ? 4 : 5, suit);
        const originalFit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
        const ourCue = ours.some(entry => {
          const shown = publicCallMeaningAt(obs.auction, obs.auction.indexOf(entry), system);
          return entry.seat === obs.seat && shown.role === 'cue' && !!shown.supportRange;
        });
        if (ourCue && suit !== trump && fit.knownCombinedTrumps < 8
          && originalFit.knownCombinedTrumps >= 8) {
          const preference = cheapest(trump);
          if (preference && preference.level <= (major(trump) ? 3 : 4)) return preference;
        }
        // The overcaller may first support advancer's real new suit. A safe
        // cue carries constructive support without making the lowest raise
        // an invitation or forcing a low combined floor past game.
        if (ours.length === 2 && ourFirst.seat === obs.seat
          && suit !== trump && fit.knownCombinedTrumps >= 8) {
          const cue = supportCue(suit, minimum);
          if (cue) return cue;
        }
      }
      if (partnerMeaning.defined && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25
        && Math.min(...SUITS.map(suit => lengths[suit])) >= 2 && [...enemyNaturalSuits].every(stopper)
        && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (partnerMeaning.intent === 'competitive' && current?.call.kind === 'bid'
        && current.call.level >= 4 && sideOf(current.seat) !== sideOf(obs.seat)
        && latestPartner.call.strain !== 'NT' && major(latestPartner.call.strain)) {
        const fit = evaluateSuitFit(obs.hand, latestPartner.call.strain, partnerPublic.suitMinimums[latestPartner.call.strain]);
        if (fit.knownCombinedTrumps < 10 && fit.totalPoints + partnerMinimum(latestPartner.call.strain) < 25) return PASS;
      }
      if (current === latestPartner) naturalNfStop = true;
    }
    if (latestPartner?.seat === partnerOf(obs.seat) && latestPartner.call.kind === 'bid'
      && !semantics?.mustBid && !isArtificialBidAt(obs.auction, obs.auction.indexOf(latestPartner), system)
      && latestPartner.call.strain !== 'NT' && latestPartner.call.level <= 3
      && lengths[latestPartner.call.strain] <= 2) {
      if (ourFirst.seat === obs.seat && lengths[trump] >= 6) {
        const repeat = cheapest(trump);
        if (repeat && repeat.level <= 3 && reasonableOvercallSuit(trump, repeat.level)) return repeat;
      }
      const escape = longest(SUITS.filter(suit => lengths[suit] >= 5 && !enemyNaturalSuits.has(suit)));
      if (escape && hcp >= 8 && (lengths[escape] >= 6 || lengths[latestPartner.call.strain] <= 1)) {
        const correction = cheapest(escape);
        // A low-level nonforcing correction is not a direct two-level
        // overcall: a queen-headed five-card suit can escape a known void.
        if (correction && correction.level <= 2 && reasonableOvercallSuit(escape, 1)) return correction;
        if (correction?.level === 3 && hcp >= 10 && lengths[escape] >= 6
          && reasonableOvercallSuit(escape, 3)) return correction;
      }
    }
  }
  // After a natural NT overcall, systems are on: transfers describe majors,
  // 2S relays to 3C for a weak long minor. A low-card club hand is not Stayman.
  const ntPosition = raw[3]?.call.kind === 'bid' && raw[3].call.strain === 'NT'
    && raw[1]?.call.kind === 'pass' && raw[2]?.call.kind === 'pass' ? 3 : 1;
  const ntOvercall = raw[ntPosition];
  if (raw[0]?.call.kind === 'bid' && raw[0].call.strain !== 'NT'
    && ntOvercall?.call.kind === 'bid' && ntOvercall.call.level <= 2 && ntOvercall.call.strain === 'NT'
    && realNtPlatform(ntOvercall)
    && (raw[0].call.level >= 2 || ntOvercall.call.level === 1)) {
    const base = ntOvercall.call.level + 1;
    const minimum = ntPosition === 3 && base === 2 ? 11 : 15;
    const game = 25 - minimum;
    const ourNtSide = sideOf(ntOvercall.seat) === sideOf(obs.seat);
    const sideBids = raw.filter(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind === 'bid');
    const request = sideBids[1]?.call;
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 1
      && current?.seat !== ntOvercall.seat && balanced && [...enemyNaturalSuits].every(stopper)
      && hcp >= (minimum === 11 ? 11 : 8) && available(bid(2, 'NT'))) return bid(2, 'NT');
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 1
      && hcp >= game && available(bid(3, 'NT'))
      && raw.slice(ntPosition + 1).some(entry => entry.call.kind === 'bid')) return bid(3, 'NT');
    if (ourNtSide && obs.seat === partnerOf(ntOvercall.seat) && sideBids.length === 1
      && raw.length === ntPosition + 2 && raw[ntPosition + 1].call.kind === 'pass') {
      const m = longest((['H', 'S'] as Suit[]).filter(suit => lengths[suit] >= 5));
      if (m) return bid(base, m === 'H' ? 'D' : 'H');
      const invitation = minimum === 11 ? 11 : 23 - minimum;
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
          return bid(hcp >= game ? 4 : 3, answer.strain);
        return bid(hcp >= game ? 3 : 2, 'NT');
      }
      if (request.level === base && (request.strain === 'D' || request.strain === 'H')) {
        const m: Suit = request.strain === 'D' ? 'H' : 'S';
        if (hcp >= game) return lengths[m] >= 6 ? bid(4, m) : bid(3, 'NT');
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
        || lengths[m] >= 3 && evaluateSuitFit(obs.hand, m, 5).totalPoints + partnerMinimum(m) >= 25))
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
      const technical = publicTakeoutDoubleAt(obs.auction, doubleIndex, system);
      const target = technical?.target ?? opened;
      const enemyBefore = obs.auction.slice(0, doubleIndex).filter((entry, index) => entry.call.kind === 'bid'
        && sideOf(entry.seat) !== sideOf(obs.seat) && !isArtificialBidAt(obs.auction, index, system));
      // A delayed takeout of opener's two-suit auction requests the two other
      // suits. Responder's earlier one-level suit does not erase our longest.
      const twoSuitOpening = enemyBefore.length === 3 && enemyBefore[0].seat === enemyBefore[2].seat
        && enemyBefore[0].call.kind === 'bid' && enemyBefore[2].call.kind === 'bid'
        && enemyBefore[0].call.level === 1 && enemyBefore[2].call.level === 2;
      const excluded = twoSuitOpening && enemyNaturalSuits.size < 3 ? new Set([enemyBefore[0].call, enemyBefore[2].call]
        .flatMap(call => call.kind === 'bid' && call.strain !== 'NT' ? [call.strain] : [])) : enemyNaturalSuits;
      const unbid = technical?.unbidSuits ?? SUITS.filter(suit => !excluded.has(suit));
      const preferred = longest((technical?.preferredSuits ?? unbid).filter(suit => major(suit) && lengths[suit] >= 4));
      const freeAfterIntervention = !semantics?.mustBid && obs.auction.slice(doubleIndex + 1)
        .some(entry => sideOf(entry.seat) !== sideOf(obs.seat) && entry.call.kind === 'bid');
      if (technical?.kind === 'responsive') {
        // We already described the original takeout/overcall. Partner's
        // responsive X asks us to choose, not to start a new 12+ cue cycle.
        const choices = technical.preferredSuits;
        const suit = preferredTwoSuitChoice(choices);
        if (suit) {
          const fit = evaluateSuitFit(obs.hand, suit, partnerPublic.suitMinimums[suit]);
          const gameLevel = major(suit) ? 4 : 5;
          if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(suit) >= (major(suit) ? 25 : 29)
            && available(bid(gameLevel, suit))) return bid(gameLevel, suit);
          const low = cheapest(suit);
          return low && (!freeAfterIntervention || low.level < gameLevel) ? low : PASS;
        }
      }
      // Over a three-level preempt the cheapest major is already game.
      // Do not cue past that game merely because advancer has 12 points.
      if (Math.min(...SUITS.map(suit => lengths[suit])) >= 2 && [...enemyNaturalSuits].every(stopper)
        && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25 && available(bid(3, 'NT'))) return bid(3, 'NT');
      const preferredCall = preferred && cheapest(preferred);
      if (!freeAfterIntervention && firstNatural.call.level === 3 && hcp < 19 && preferredCall?.level === 4) return preferredCall;
      if (hcp >= 12) {
        const cue = cheapest(target);
        const replySuit = preferred ?? longest(unbid);
        const replyLevel = cue && [1, 2, 3, 4, 5, 6, 7].find(level => bidValue(bid(level, replySuit)) > bidValue(cue));
        const fit = evaluateSuitFit(obs.hand, replySuit, partnerPublic.suitMinimums[replySuit]);
        if (cue && replyLevel && (replyLevel <= 3 || fit.knownCombinedTrumps >= 8
          && fit.totalPoints + partnerMinimum(replySuit) >= (major(replySuit) ? 25 : 29))) return cue;
      }
      // A real five-card major with invitation strength should first seek
      // that fit instead of hiding it in a minimum stopped NT response.
      // The jump is raw strength and own length, never a promise that a
      // possibly strong takeout doubler holds three cards in every suit.
      if (preferred && lengths[preferred] >= 5 && hcp >= 9 && hcp <= 11) {
        const invitation = preferredCall && bid(preferredCall.level + 1, preferred);
        if (invitation && invitation.level <= 3 && available(invitation)) {
          const advertised = publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: invitation }], obs.auction.length, system);
          if (advertised.invitation && advertised.hcpRange?.min === 9
            && advertised.hcpRange.max >= hcp) return invitation;
        }
      }
      const ntShapeSuitable = Math.min(...SUITS.map(suit => lengths[suit])) >= 2
        && Math.max(...SUITS.map(suit => lengths[suit])) <= 6;
      if (ntShapeSuitable && [...enemyNaturalSuits].every(stopper)) {
        if (hcp >= 13 && available(bid(3, 'NT'))) return bid(3, 'NT');
        if (hcp >= 11 && available(bid(2, 'NT'))) return bid(2, 'NT');
        if (hcp >= 6 && available(bid(1, 'NT'))) return bid(1, 'NT');
      }
      if (hcp <= 8 && preferred && preferredCall) {
        const minor = longest(unbid.filter(suit => !major(suit) && lengths[suit] >= 5));
        const minorCall = minor && cheapest(minor);
        if (minor && lengths[minor] === 5 && minorCall && preferredCall.level < minorCall.level
          && lengths[minor] + partnerPublic.suitMinimums[minor] < 8) return preferredCall;
      }
      if (technical?.kind === 'reopening' && !preferred) {
        const supported = longest(SUITS.filter(suit => lengths[suit] >= 5
          && partnerPublic.suitMinimums[suit] >= 3 && !enemyNaturalSuits.has(suit)
          && (cheapest(suit)?.level ?? 7) <= (major(suit) ? 3 : 4)));
        if (supported) return cheapest(supported);
      }
      const suit = longest(unbid);
      const low = cheapest(suit);
      const jumpFit = evaluateSuitFit(obs.hand, suit, partnerPublic.suitMinimums[suit]);
      const jumpedGame = jumpFit.knownCombinedTrumps >= 8 && jumpFit.totalPoints + partnerMinimum(suit) >= (major(suit) ? 25 : 29);
      if (freeAfterIntervention && low && low.level >= (major(suit) ? 4 : 5) && !jumpedGame) return PASS;
      return low && hcp >= 9 && lengths[suit] >= 4 && low.level <= 3
        && (low.level + 1 < (major(suit) ? 4 : 5) || jumpedGame) && available(bid(low.level + 1, suit))
        ? bid(low.level + 1, suit) : low;
    }
    if (meaning === 'negative-double') {
      const overcall = raw[1]?.call;
      if (overcall?.kind === 'bid' && hcp + (overcall.level === 1 ? 6 : 8) >= 25
        && stopper(overcall.strain as Suit) && available(bid(3, 'NT'))) return bid(3, 'NT');
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
        if (side && (lengths[opened as Suit] < 5 || hcp >= 17 || partnerPublic.suitMinimums[side] + lengths[side] >= 8)) return cheapest(side);
      }
      return cheapest(opened);
    }
    if (meaning === 'michaels-inquiry') return cheapest(lengths.D > lengths.C ? 'D' : 'C');
    if (meaning === 'overcall-stayman') return cheapest(lengths.H >= 4 ? 'H' : lengths.S >= 4 ? 'S' : 'D');
    if (meaning === 'overcall-cue' || meaning === 'competitive-cue') {
      const overcall = meaning === 'overcall-cue' ? raw[1]?.call : ownLongRebid?.call;
      if (overcall?.kind === 'bid' && overcall.strain !== 'NT') {
        const fit = evaluateSuitFit(obs.hand, overcall.strain, partnerPublic.suitMinimums[overcall.strain]);
        if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(overcall.strain) >= (major(overcall.strain) ? 25 : 29)
          && available(bid(major(overcall.strain) ? 4 : 5, overcall.strain))) return bid(major(overcall.strain) ? 4 : 5, overcall.strain);
        if (hcp <= 10) return cheapest(overcall.strain);
        const enemySuits = [...enemyNaturalSuits];
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
      const otherMajor = weakJumpSuit === 'H' ? 'S' : 'H';
      const excludesOtherMajor = call?.level === 2 && major(weakJumpSuit) && lengths[otherMajor] >= 4;
      if (call && !excludesOtherMajor && lengths[weakJumpSuit] >= requiredLength && hcp >= 5 && hcp <= maximum) return call;
    }

    // Show a sound six-card major directly below the strong-rebid floor.
    // Choosing X and then freely showing it would falsely promise 17+.
    const directMajor = longest((['H', 'S'] as Suit[]).filter(suit => suit !== opened && lengths[suit] >= 6
      && cheapest(suit) && reasonableOvercallSuit(suit, cheapest(suit)!.level)));
    if (directMajor && hcp >= 12 && hcp <= 16) return cheapest(directMajor);

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
    const suit = longest(SUITS.filter(candidate => hcp <= 16
      && (lengths[candidate] >= 6 && hcp >= 8 && reasonableOvercallSuit(candidate, 2)
        || major(candidate) && hcp >= 10 && honorRichMajor(candidate))));
    if (suit) return cheapest(suit);
    return undefined;
  }

  // Balancing seat after a one-level opening and two passes.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[1].call.kind === 'pass' && raw[2].call.kind === 'pass' && sideOf(raw[0].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const unbid = SUITS.filter(suit => suit !== opened);
    if (balanced && hcp >= 11 && hcp <= 14 && stopper(opened) && available(bid(1, 'NT'))) return bid(1, 'NT');
    const directMajor = longest((['H', 'S'] as Suit[]).filter(suit => suit !== opened && lengths[suit] >= 6
      && cheapest(suit) && reasonableOvercallSuit(suit, cheapest(suit)!.level)));
    if (directMajor && hcp >= 12 && hcp <= 16) return cheapest(directMajor);
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
      const points = evaluateSuitFit(obs.hand, opened, major(opened) ? 5 : 3).totalPoints;
      if (points + partnerMinimum(opened) >= (major(opened) ? 25 : 29) && available(bid(major(opened) ? 4 : 5, opened))) return bid(major(opened) ? 4 : 5, opened);
      if (points >= 10 && available(bid(3, opened))) return bid(3, opened);
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
    const idealShortTakeout = hcp >= 12 && lengths[opened] <= 1 && unbid.every(suit => lengths[suit] >= 4);
    if ((idealShortTakeout || strongTakeoutShape(opened)
      || (hcp >= (openingCall.level === 2 ? 13 : 15) && shapeTakeout)) && available({ kind: 'double' })) return { kind: 'double' };
    const natural = longest(unbid.filter(suit => {
      const call = cheapest(suit);
      const ranks = obs.hand.filter(card => card.suit === suit).map(card => card.rank);
      // The card's low-HCP exception is defined only for the lowest
      // three-level minor. Other majors/four-level bids keep their ordinary
      // source thresholds rather than relying on a later validator to Pass.
      const exceptionalLength = call?.level === 3 && !major(suit) && lengths[suit] >= 8 && hcp >= 7
        && ranks.filter(rank => rank >= 10).length >= 3 && ranks.some(rank => rank >= 13);
      if (!call || lengths[suit] < (openingCall.level === 2 ? 5 : 6)) return false;
      return exceptionalLength || hcp >= (honorRichLongSuit(suit) ? 10 : call.level === 2 ? 12 : 14)
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
    if (major(opened) && lengths[opened] >= 3 && support + partnerMinimum(opened) >= 25
      && available(bid(4, opened))) return bid(4, opened);
    if (support >= 13 && available(bid(4, opened))) return bid(4, opened);
    if (support >= 10 && available(bid(3, opened))) return bid(3, opened);
    if (support >= 6 && available(bid(2, opened))) return bid(2, opened);
    const longMajor = longest(unbidMajors.filter(suit => lengths[suit] >= 5));
    const naturalMajor = longMajor ? cheapest(longMajor) : undefined;
    if (naturalMajor && naturalMajor.level <= 2
      && (hcp >= (naturalMajor.level === 1 ? 6 : 10)
        || hcp >= 9 && lengths[longMajor!] >= 8 && honorRichLongSuit(longMajor!))) return naturalMajor;
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
      const publicGameHcp = hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25;
      if (publicGameHcp && balanced && stopper(overcalled) && available(bid(3, 'NT'))) return bid(3, 'NT');
      const natural = longest(SUITS.filter(suit => {
        const call = cheapest(suit);
        return suit !== opened && suit !== overcalled && lengths[suit] >= 5 && call
          && (call.level <= 3 || call.level === 4 && publicGameHcp);
      }));
      if (natural) return cheapest(natural);
      const fit = evaluateSuitFit(obs.hand, opened, partnerPublic.suitMinimums[opened]);
      if (!major(opened) && fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(opened) >= 29
        && available(bid(5, opened))) return bid(5, opened);
      const cue = cheapest(overcalled);
      if (cue && publicGameHcp) return cue;
    }
    return PASS;
  }

  // After enemy intervention, opener uses the negative double's actual suit
  // promises. Both majors already named means four of each minor, not support
  // for opener's original five-card major or an unconditional new obligation.
  if (raw.length === 4 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[0].seat === obs.seat && raw[1].call.kind === 'bid' && sideOf(raw[1].seat) !== sideOf(obs.seat)
    && raw[2].seat === partnerOf(obs.seat) && raw[2].call.kind === 'double'
    && raw[3].call.kind === 'bid' && sideOf(raw[3].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    const overcalled = raw[1].call.strain;
    const unbidMajors = (['H', 'S'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled);
    const shown = longest(unbidMajors.filter(suit => lengths[suit] >= 4));
    if (shown) {
      const fit = evaluateSuitFit(obs.hand, shown, partnerPublic.suitMinimums[shown]);
      if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(shown) >= 25
        && available(bid(4, shown))) return bid(4, shown);
      const call = cheapest(shown);
      if (call && (call.level < 4 || fit.knownCombinedTrumps >= 8
        && fit.totalPoints + partnerMinimum(shown) >= (call.level > 4 ? 29 : 25))) return call;
      return PASS;
    }
    const shownMinor = longest((['C', 'D'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled
      && partnerPublic.suitMinimums[suit] + lengths[suit] >= 8));
    if (shownMinor) {
      const fit = evaluateSuitFit(obs.hand, shownMinor, partnerPublic.suitMinimums[shownMinor]);
      if (fit.totalPoints + partnerMinimum(shownMinor) >= 29 && available(bid(5, shownMinor))) return bid(5, shownMinor);
      const call = cheapest(shownMinor);
      return call && (call.level < 5 || fit.totalPoints + partnerMinimum(shownMinor) >= 29) ? call : PASS;
    }
    if (hcp >= 16 && [...enemyNaturalSuits].every(stopper) && Math.min(...SUITS.map(suit => lengths[suit])) >= 2) {
      const nt = cheapest('NT');
      if (nt) return nt;
    }
    const fallback = lengths[opened as Suit] >= 6 && reasonableOvercallSuit(opened as Suit, 3) ? cheapest(opened) : undefined;
    if (fallback && fallback.level < (major(opened) ? 4 : 5)
      && (fallback.level <= 3 || hcp >= 14)) return fallback;
    return PASS;
  }

  // Advancer is free to pass when responder bids over the takeout double.
  // With values, choose an unbid suit; never accidentally cue with a weak hand.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.strain !== 'NT'
    && raw[1].seat === partnerOf(obs.seat) && raw[1].call.kind === 'double'
    && isTakeoutDoubleAt(obs.auction, firstBid + 1) && raw[2].call.kind !== 'pass') {
    const opened = raw[0].call.strain;
    if (hcp >= 12) {
      const cue = cheapest(opened);
      const replySuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 4));
      const replyLevel = cue && replySuit && [1, 2, 3, 4, 5, 6, 7].find(level => bidValue(bid(level, replySuit)) > bidValue(cue));
      if (cue && replyLevel && replyLevel <= 3) return cue;
    }
    if (hcp < 6) return PASS;
    const enemySuit = raw[2].call.kind === 'bid' ? raw[2].call.strain : opened;
    const suit = longest(SUITS.filter(s => s !== opened && s !== enemySuit && lengths[s] >= 4));
    if (!suit) return PASS;
    const low = cheapest(suit);
    if (!low) return PASS;
    const fit = evaluateSuitFit(obs.hand, suit, partnerPublic.suitMinimums[suit]);
    if (low.level >= (major(suit) ? 4 : 5)) return fit.knownCombinedTrumps >= 8
      && fit.totalPoints + partnerMinimum(suit) >= (major(suit) && low.level === 4 ? 25 : 29) ? low : PASS;
    return low;
  }

  // Advancer after opener's partner competes. The opponent's extra call does
  // not erase a real fit or the option to make a forcing support cuebid.
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level <= 3 && raw[0].call.strain !== 'NT'
    && sideOf(raw[0].seat) !== sideOf(obs.seat) && raw[1].seat === partnerOf(obs.seat)
    && raw[1].call.kind === 'bid' && raw[1].call.strain !== 'NT' && raw[1].call.strain !== raw[0].call.strain
    && bidValue(raw[1].call) - bidValue(raw[0].call) <= 5 && raw[2].call.kind === 'bid') {
    const trump = raw[1].call.strain;
    const minimum = partnerMinimum(trump);
    const supported = evaluateSuitFit(obs.hand, trump, 5).totalPoints;
    if (lengths[trump] >= 3) {
      const level = major(trump) ? 4 : 5;
      if (supported + minimum >= (major(trump) ? 25 : 29) && available(bid(level, trump))) return bid(level, trump);
      if (!major(trump) && supported + minimum >= 25 && available(bid(4, trump))) return bid(4, trump);
      if (supported >= 10 && raw[0].call.level === 1) {
        const cue = supportCue(trump, minimum); if (cue) return cue;
      }
      if (supported >= 6) return affordableSupport(trump, minimum);
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
      const minimum = partnerMinimum(trump);
      const points = evaluateSuitFit(obs.hand, trump, 5).totalPoints + minimum;
      if (points >= (major(trump) ? 25 : 29) && available(bid(major(trump) ? 4 : 5, trump)))
        return bid(major(trump) ? 4 : 5, trump);
      if (points >= 23 && major(trump) && available(bid(3, trump))) return bid(3, trump);
      const cue = supportCue(trump, minimum);
      if (cue) return cue;
      const support = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]).totalPoints;
      if (!major(trump) && support >= 13 && support <= 16 && available(bid(4, trump))) return bid(4, trump);
      if (evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]).totalPoints >= 6) return affordableSupport(trump, minimum);
    }
  }
  if (raw.length === 3 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && (raw[2].call.kind === 'pass' || raw[2].call.kind === 'double')
    && sideOf(raw[0].seat) !== sideOf(obs.seat) && raw[1].seat === partnerOf(obs.seat)
    && sideOf(raw[2].seat) !== sideOf(obs.seat)) {
    const opened = raw[0].call.strain;
    if (raw[1].call.kind === 'double') {
      const unbid = SUITS.filter(suit => suit !== opened); const suit = longest(unbid);
      if (Math.min(...SUITS.map(suit => lengths[suit])) >= 2 && [...enemyNaturalSuits].every(stopper)
        && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25 && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (hcp >= 12 && (cheapest(suit)?.level ?? 7) < (major(suit) ? 4 : 5)) return cheapest(opened);
      if (balanced && stopper(opened)) {
        if (hcp >= 13 && available(bid(3, 'NT'))) return bid(3, 'NT');
        if (hcp >= 11 && available(bid(2, 'NT'))) return bid(2, 'NT');
        if (hcp >= 6 && available(bid(1, 'NT'))) return bid(1, 'NT');
      }
      const low = cheapest(suit);
      const fit = evaluateSuitFit(obs.hand, suit, partnerPublic.suitMinimums[suit]);
      const gameStrength = fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(suit) >= (major(suit) ? 25 : 29);
      if (low && hcp >= 9 && lengths[suit] >= 4 && low.level < 7
        && (low.level + 1 < (major(suit) ? 4 : 5) || gameStrength) && available(bid(low.level + 1, suit))) return bid(low.level + 1, suit);
      return low ?? PASS;
    }
    if (raw[1].call.kind !== 'bid') return undefined;
    const intervention = raw[1].call;
    const michaels = intervention.level === 2 && intervention.strain === opened && !(system === 'precision' && opened === 'C');
    if (michaels) {
      if (!major(opened)) {
        const fit: Suit = lengths.S >= lengths.H ? 'S' : 'H';
        if (lengths[fit] >= 3 && evaluateSuitFit(obs.hand, fit, 5).totalPoints + partnerMinimum(fit) >= 25 && available(bid(4, fit))) return bid(4, fit);
        return cheapest(fit);
      }
      const other: Suit = opened === 'H' ? 'S' : 'H';
      if (lengths[other] >= 3) {
        if (evaluateSuitFit(obs.hand, other, 5).totalPoints + partnerMinimum(other) >= 25 && available(bid(4, other))) return bid(4, other);
        return cheapest(other);
      }
      return available(bid(2, 'NT')) ? bid(2, 'NT') : cheapest(other);
    }
    if (intervention.level === 2 && intervention.strain === 'NT') {
      const shown = SUITS.filter(suit => suit !== opened).sort((a, b) => SUITS.indexOf(a) - SUITS.indexOf(b)).slice(0, 2);
      return cheapest(preferredTwoSuitChoice(shown));
    }
    // An enemy negative double requests its opener's description; it does
    // not convert our weak jump overcall to a penalty contract to defend.
    if (raw[2].call.kind === 'double'
      && classifyDoubleAt(obs.auction, firstBid + 2, system) !== 'negative') return undefined;
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
      const fit = evaluateSuitFit(obs.hand, overcalled, partnerPublic.suitMinimums[overcalled]);
      if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(overcalled) >= (major(overcalled) ? 25 : 29)
        && available(bid(major(overcalled) ? 4 : 5, overcalled))) return bid(major(overcalled) ? 4 : 5, overcalled);
      if (hcp >= 15) {
        const ask = cheapest('NT'); if (ask) return ask;
      }
      if (lengths[overcalled] >= 3) {
        const raise = cheapest(overcalled); if (raise) return raise;
      }
      return undefined;
    }
    if (lengths[overcalled] >= 3) {
      if (evaluateSuitFit(obs.hand, overcalled, partnerPublic.suitMinimums[overcalled]).totalPoints >= 10) {
        const cue = supportCue(overcalled, intervention.level === 1 ? 8 : 10); if (cue) return cue;
      }
      const raise = bid(Math.min(7, intervention.level + 1), overcalled);
      if (evaluateSuitFit(obs.hand, overcalled, 5).totalPoints >= 6 && available(raise)) return raise;
    }
    const newSuit = longest(SUITS.filter(suit => suit !== opened && suit !== overcalled && lengths[suit] >= 5));
    if (newSuit && hcp >= 8) return cheapest(newSuit);
    const majorResponse = longest((['H', 'S'] as Suit[]).filter(suit => suit !== opened && suit !== overcalled && lengths[suit] >= 4
      && cheapest(suit)?.level === 1));
    if (majorResponse && hcp >= 8) return cheapest(majorResponse);
    if (Math.min(...SUITS.map(suit => lengths[suit])) >= 2 && [...enemyNaturalSuits].every(stopper) && hcp >= 9) return hcp + (intervention.level === 1 ? 8 : 10) >= 25 && available(bid(3, 'NT'))
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
    const suit = overcall.strain as Suit;
    const fit = evaluateSuitFit(obs.hand, suit, partnerPublic.suitMinimums[suit]);
    if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(suit) >= (major(suit) ? 25 : 29)
      && available(bid(major(suit) ? 4 : 5, suit))) return bid(major(suit) ? 4 : 5, suit);
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
  if (ownTakeout >= 0 && !partnerResponse && hcp >= 17
    && !raw.slice(ownTakeout + 1).some(entry => entry.seat === obs.seat && entry.call.kind === 'bid')) {
    // Opposing rebids may leave advancer free to pass. They do not erase the
    // doubler's as-yet-undescribed strong hand or its honest long suit.
    const ownSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
    const ownCall = ownSuit && cheapest(ownSuit);
    if (ownSuit && ownCall && ownCall.level <= 3 && reasonableOvercallSuit(ownSuit, ownCall.level)) return ownCall;
    const nt = cheapest('NT');
    if (balanced && hcp >= 18 && hcp <= 20 && [...enemyNaturalSuits].every(stopper)
      && nt && nt.level <= 2) return nt;
  }
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
    const partnerCue = response.strain === opened
      && isArtificialBidAt(obs.auction, firstBid + responseIndex, system);
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
      if (response.strain !== 'NT' && major(response.strain) && lengths[response.strain] >= 4 && hcp >= 12 && hcp <= 16) {
        const support = cheapest(response.strain);
        if (support?.level === 2) return support;
      }
      if (response.strain !== 'NT' && major(response.strain) && hcp >= 17
        && lengths[response.strain] >= 5 && available(bid(3, response.strain))) return bid(3, response.strain);
      const ownSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      if (hcp >= 17 && ownSuit) return cheapest(ownSuit);
      const opponentSuits = [...new Set(raw.filter(entry => sideOf(entry.seat) !== sideOf(obs.seat)
        && entry.call.kind === 'bid' && entry.call.strain !== 'NT').map(entry => (entry.call as Bid).strain as Suit))];
      if (balanced && hcp >= 18 && hcp <= 20 && opponentSuits.every(stopper)) {
        const nt = cheapest('NT');
        if (nt && (nt.level <= 2 || hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25)) return nt;
      }
      return PASS;
    }
    if (!opponentBidAfterResponse && ownBidsAfterDouble.length === 0 && !partnerCue) {
      if (!partnerWeak && response.strain !== 'NT' && lengths[response.strain] < 4
        && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25 && [...enemyNaturalSuits].every(stopper)
        && Math.min(...SUITS.map(suit => lengths[suit])) >= 2 && available(bid(3, 'NT'))) return bid(3, 'NT');
      const longStrong = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      const longCall = longStrong && cheapest(longStrong);
      if (hcp >= 17 && longStrong && longCall && response.strain !== 'NT'
        && lengths[response.strain] + partnerPublic.suitMinimums[response.strain] < 8
        && (longCall.level <= 3 || lengths[longStrong] + partnerPublic.suitMinimums[longStrong] >= 8
          && evaluateSuitFit(obs.hand, longStrong, partnerPublic.suitMinimums[longStrong]).totalPoints
            + partnerMinimum(longStrong) >= (major(longStrong) ? 25 : 29))) return longCall;
      if (response.strain === 'NT' && response.level === 1) {
        const longMajor = longest((['H', 'S'] as Suit[]).filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 7));
        if (longMajor) {
          const fit = evaluateSuitFit(obs.hand, longMajor, partnerPublic.suitMinimums[longMajor]);
          if (fit.knownCombinedTrumps >= 8 && fit.totalPoints + partnerMinimum(longMajor) >= 25
            && available(bid(4, longMajor))) return bid(4, longMajor);
        }
      }
      if (response.strain !== 'NT' && lengths[response.strain] >= 4) {
        const previous = raw.slice(0, responseIndex).findLast(entry => entry.call.kind === 'bid')?.call;
        const invited = previous?.kind === 'bid' && bidValue(response) - bidValue(previous) > 5;
        const fit = evaluateSuitFit(obs.hand, response.strain, partnerPublic.suitMinimums[response.strain]);
        const supported = fit.totalPoints + partnerMinimum(response.strain);
        if (fit.knownCombinedTrumps >= 8 && supported >= (major(response.strain) ? 25 : 29)
          && available(bid(major(response.strain) ? 4 : 5, response.strain)))
          return bid(major(response.strain) ? 4 : 5, response.strain);
        const gameLevel = major(response.strain) ? 4 : 5;
        // The doubler's simple invitation is a defined range, not a generic
        // raw-16 license to raise a forced two-level reply to three.
        const invitationMinimum = response.level === 1 ? 16 : 18;
        const invitationMaximum = response.level === 1 ? 18 : 20;
        // A lowest four-minor invitation has no artificial twenty-point cap.
        // Five opposite the compelled three establishes eight; a stronger
        // hand still below public game must describe it instead of asking
        // keycards on its partner's unshown strength.
        if (!major(response.strain) && response.level === 3 && lengths[response.strain] >= 5
          && fit.knownCombinedTrumps >= 8 && fit.totalPoints >= 18
          && available(bid(4, response.strain))) return bid(4, response.strain);
        if (!invited && fit.totalPoints >= invitationMinimum && fit.totalPoints <= invitationMaximum
          && !(response.level === 3 && !major(response.strain))
          && response.level + 1 < gameLevel && available(bid(response.level + 1, response.strain)))
          return bid(response.level + 1, response.strain);
      }
      if (balanced && stopper(opened) && hcp >= 18) {
        const strongNt = bid(2, 'NT');
        const ntRange = noTrumpRangeAt([...obs.auction, { seat: obs.seat, call: strongNt }], obs.auction.length, system);
        if (hcp >= (ntRange?.min ?? 18) && available(strongNt)) return strongNt;
        const nt = cheapest('NT');
        if (nt && (nt.level <= 2 || hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25)) return nt;
      }
      if (response.strain === 'NT' && response.level === 2
        && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25 && available(bid(3, 'NT'))) return bid(3, 'NT');
      const strongSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
      if (hcp >= 17 && strongSuit && (cheapest(strongSuit)?.level ?? 7) <= 3) return cheapest(strongSuit);
      // All honest strong suit/NT/invitation routes were considered above.
      // A zero-floor forced reply cannot supply the missing game points just
      // because its height has removed a cheaper invitation.
      if (partnerWeak) return PASS;
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
    if (ourAdvance.call.kind === 'bid' && strongRebid.call.strain === ourAdvance.call.strain
      && strongRebid.call.strain !== 'NT' && major(strongRebid.call.strain)) {
      const beforeRebid = obs.auction.slice(0, obs.auction.indexOf(strongRebid)).findLast(entry => entry.call.kind === 'bid')?.call;
      if (beforeRebid?.kind === 'bid' && bidValue(strongRebid.call) - bidValue(beforeRebid) > 5
        && lengths[strongRebid.call.strain] + partnerPublic.suitMinimums[strongRebid.call.strain] >= 8
        && evaluateSuitFit(obs.hand, strongRebid.call.strain, partnerPublic.suitMinimums[strongRebid.call.strain]).totalPoints
          + partnerMinimum(strongRebid.call.strain) >= 25
        && available(bid(4, strongRebid.call.strain))) return bid(4, strongRebid.call.strain);
    }
    if (strongRebid.call.strain === 'NT') {
      const range = noTrumpRangeAt(obs.auction, obs.auction.indexOf(strongRebid), system);
      if (range && hcp + range.min >= 25 && available(bid(3, 'NT'))) return bid(3, 'NT');
    } else if (minimumAdvance && ourAdvance?.call.kind === 'bid'
      && !isArtificialBidAt(obs.auction, obs.auction.indexOf(ourAdvance), system) && strongRebid.call.strain !== ourAdvance.call.strain
      && !enemyNaturalSuits.has(strongRebid.call.strain) && lengths[strongRebid.call.strain] <= 2
      && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25) {
      if (Math.min(...SUITS.map(suit => lengths[suit])) >= 2
        && [...enemyNaturalSuits].every(stopper) && available(bid(3, 'NT'))) return bid(3, 'NT');
      const ownSuit = longest(SUITS.filter(suit => lengths[suit] >= 5 && !enemyNaturalSuits.has(suit)));
      if (ownSuit) return cheapest(ownSuit);
    }
  }
  if (afterPartnerTakeout.length === 2 && ourAdvance?.seat === obs.seat && ourAdvance.call.kind === 'bid'
    && isArtificialBidAt(obs.auction, obs.auction.indexOf(ourAdvance), system)
    && enemyNaturalSuits.has(ourAdvance.call.strain as Suit)
    && strongRebid?.seat === partnerOf(obs.seat) && strongRebid.call.kind === 'bid'
    && strongRebid.call.strain !== 'NT' && !enemyNaturalSuits.has(strongRebid.call.strain)
    && firstNatural?.call.kind === 'bid') {
    const trump = strongRebid.call.strain;
    const minimum = partnerMinimum(trump);
    // A compelled cue answer can show only three cards. Keep that minimum
    // rather than turning it into a five-card strong rebid after the answer.
    const fit = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]);
    const points = fit.totalPoints + minimum;
    if (fit.knownCombinedTrumps >= 8 && points >= (major(trump) ? 25 : 29)
      && available(bid(major(trump) ? 4 : 5, trump)))
      return bid(major(trump) ? 4 : 5, trump);
    if (fit.knownCombinedTrumps < 8 && hcp >= 12) {
      const ownMajor = longest((['H', 'S'] as Suit[]).filter(suit => suit !== trump
        && !enemyNaturalSuits.has(suit) && lengths[suit] >= 5 && reasonableOvercallSuit(suit, 3)));
      const continuation = ownMajor && cheapest(ownMajor);
      if (continuation && continuation.level <= 3) return continuation;
    }
  }
  if (afterPartnerTakeout.length === 2 && minimumAdvance && ourAdvance?.seat === obs.seat && ourAdvance.call.kind === 'bid'
    && !isArtificialBidAt(obs.auction, obs.auction.indexOf(ourAdvance), system)
    && ourAdvance.call.strain !== 'NT' && !enemyNaturalSuits.has(ourAdvance.call.strain)
    && strongRebid?.seat === partnerOf(obs.seat) && strongRebid.call.kind === 'bid'
    && strongRebid.call.strain !== 'NT' && strongRebid.call.strain !== ourAdvance.call.strain
    && !enemyNaturalSuits.has(strongRebid.call.strain) && lengths[strongRebid.call.strain] >= 3
    && publicCallMeaningAt(obs.auction, obs.auction.indexOf(strongRebid), system).role === 'takeout-strong-rebid') {
    const trump = strongRebid.call.strain;
    const points = evaluateSuitFit(obs.hand, trump, partnerPublic.suitMinimums[trump]).totalPoints + partnerMinimum(trump);
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
      const partnerLength = partnerPublic.suitMinimums[suit];
      const fit = evaluateSuitFit(obs.hand, suit, partnerLength);
      const supportedPoints = fit.totalPoints + partnerMinimum(suit);
      // A minimum answer may have been raised by an intervening enemy bid.
      // Its absolute level cannot manufacture a new13-HCP partner minimum.
      if (fit.knownCombinedTrumps >= 8 && supportedPoints >= (major(suit) ? 25 : 29)
        && available(bid(major(suit) ? 4 : 5, suit))) return bid(major(suit) ? 4 : 5, suit);
      if (hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25 && [...enemyNaturalSuits].every(stopper)
        && Math.min(...SUITS.map(candidate => lengths[candidate])) >= 2 && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (major(suit) && lengths[suit] >= 3 && (supportedPoints >= 23 || evaluateSuitFit(obs.hand, suit, 5).totalPoints >= 10)
        && available(bid(3, suit))) return bid(3, suit);
      if (rebid.strain !== suit && lengths[suit] >= 3) return cheapest(suit);
      return PASS;
    }
    if (obs.seat === directOvercall.seat && sideCalls.length === 4) {
      const advance = sideCalls[3].call as Bid;
      if (advance.strain === 'NT' && advance.level === 2 && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 25
        && [...enemyNaturalSuits].every(stopper) && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (advance.strain === directOvercall.call.strain && advance.level === 3 && major(advance.strain)
        && lengths[advance.strain] + partnerPublic.suitMinimums[advance.strain] >= 8
        && evaluateSuitFit(obs.hand, advance.strain, partnerPublic.suitMinimums[advance.strain]).totalPoints
          + partnerMinimum(advance.strain) >= 25 && available(bid(4, advance.strain))) return bid(4, advance.strain);
    }
  }

  // A strong takeout doubler bids a long suit after partner's forced response.
  if (raw.length === 5 && raw[0].call.kind === 'bid' && raw[0].call.level === 1 && raw[0].call.strain !== 'NT'
    && raw[1].seat === obs.seat && raw[1].call.kind === 'double' && raw[2].call.kind === 'pass'
    && raw[3].seat === partnerOf(obs.seat) && raw[3].call.kind === 'bid' && raw[4].call.kind === 'pass' && hcp >= 17) {
    const ownSuit = longest(SUITS.filter(suit => !enemyNaturalSuits.has(suit) && lengths[suit] >= 5));
    if (ownSuit && (cheapest(ownSuit)?.level ?? 7) <= 3) return cheapest(ownSuit);
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
    const enemies = enemyNaturalSuits;
    if (partner?.call.kind === 'bid' && partner.call.strain !== 'NT' && ours.at(-1) === partner
      && !enemies.has(partner.call.strain) && partner.call.level < (major(partner.call.strain) ? 4 : 5)) {
      const trump = partner.call.strain;
      const partnerLength = naturalSuitMinimum(obs.auction, partnerOf(obs.seat), trump, system);
      const partnerMin = partnerMinimum(trump);
      const points = evaluateSuitFit(obs.hand, trump, partnerLength).totalPoints + partnerMin;
      if (lengths[trump] + partnerLength >= 8) {
        const gameLevel = major(trump) ? 4 : 5;
        if (points >= (major(trump) ? 25 : 29) && available(bid(gameLevel, trump))) return bid(gameLevel, trump);
        if (points >= 23 && major(trump) && available(bid(3, trump))) return bid(3, trump);
      }
      const publicHcp = partnerPublic.hcpRange?.min ?? 0;
      if (balanced && hcp + publicHcp >= 25 && [...enemies].every(stopper) && available(bid(3, 'NT'))) return bid(3, 'NT');
      if (balanced && hcp + publicHcp >= 23 && [...enemies].every(stopper) && available(bid(2, 'NT'))) return bid(2, 'NT');
    }
  }

  // A cuebid response to our takeout double is forcing, including when the
  // opener's partner bid before the cuebid. Describe a stopper or an unbid suit.
  if (firstNatural?.call.kind === 'bid' && ownTakeout >= 0) {
    const opened = publicTakeoutDoubleAt(obs.auction, firstBid + ownTakeout, system)?.target ?? firstNatural.call.strain;
    const partnerCue = [...raw].reverse().find(entry => entry.seat === partnerOf(obs.seat) && entry.call.kind === 'bid'
      && entry.call.strain === opened && raw.indexOf(entry) > ownTakeout
      && isArtificialBidAt(obs.auction, firstBid + raw.indexOf(entry), system));
    const lastOwnAction = [...raw].reverse().find(entry => sideOf(entry.seat) === sideOf(obs.seat) && entry.call.kind !== 'pass');
    if (partnerCue?.call.kind === 'bid' && lastOwnAction === partnerCue) {
      const shownEnemySuits = [...enemyNaturalSuits];
      if (balanced && hcp >= 18 && hcp <= 20 && shownEnemySuits.every(stopper)) {
        const nt = cheapest('NT');
        if (nt) return nt;
      }
      const opponentSuits = [...enemyNaturalSuits];
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
    const artificialCue = isArtificialBidAt(obs.auction, obs.auction.indexOf(lastBidEntry), system);
    const opponentsVulnerable = obs.vulnerability === 'Both'
      || (obs.vulnerability === 'NS' && sideOf(lastBidEntry.seat) === 'NS')
      || (obs.vulnerability === 'EW' && sideOf(lastBidEntry.seat) === 'EW');
    if (!artificialCue && classifyDoubleAt([...obs.auction, { seat: obs.seat, call: { kind: 'double' } }], obs.auction.length, system) === 'penalty'
      && ourNaturalBids.length >= 1 && opponentBids.length >= 1
      && (ourNaturalBids.length >= 2 || obs.auction.indexOf(lastBidEntry) >= (firstNatural ? obs.auction.indexOf(firstNatural) + 3 : 3))) {
      const contract = lastBidEntry.call;
      if (contract.strain === 'NT') {
        const threshold = opponentsVulnerable ? 15 : 16;
        if (contract.level >= 3 && hcp >= threshold && quickTricks() >= 3.5) return { kind: 'double' };
      } else {
        const trump = contract.strain;
        const trumpRanks = obs.hand.filter(card => card.suit === trump).map(card => card.rank);
        const topTrumpHonors = trumpRanks.filter(rank => rank >= 11).length;
        const ownStrengthRedouble = obs.auction.some(entry => sideOf(entry.seat) === sideOf(obs.seat)
          && entry.call.kind === 'redouble');
        const hasTopTrump = trumpRanks.filter(rank => rank >= 12).length >= 2
          || ownStrengthRedouble && trumpRanks.includes(14) && trumpRanks.includes(11)
            && hcp + (partnerPublic.hcpRange?.min ?? 0) >= 22;
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
  // After a fulfilled natural/cue answer, an enemy higher bid does not make
  // a bare minimum five-card repeat a playing source at three or four.
  if (!semantics?.mustBid && semantics?.forcing !== 'game' && current?.call.kind === 'bid'
    && sideOf(current.seat) !== sideOf(obs.seat) && ownLongRebid?.call.kind === 'bid'
    && ownLongRebid.call.strain !== 'NT' && !enemyNaturalSuits.has(ownLongRebid.call.strain)) {
    const suit = ownLongRebid.call.strain;
    const low = cheapest(suit);
    const fit = evaluateSuitFit(obs.hand, suit, partnerPublic.suitMinimums[suit]);
    if (low && fit.knownCombinedTrumps < 8 && hcp < 17
      && low.level >= (major(suit) ? 3 : 4)) {
      if (low.level === 3 && lengths[suit] >= 6 && hcp >= 10 && honorRichLongSuit(suit)) return low;
      return PASS;
    }
  }
  return naturalNfStop ? PASS : undefined;
}

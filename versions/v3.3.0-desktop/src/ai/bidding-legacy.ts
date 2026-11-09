import { type Call, type Card, type Suit, type Strain, PASS, SUITS, partnerOf, sideOf } from '../core/types';
import { sameCall, auctionStatus, bidValue } from '../core/auction';
import { type BiddingObservation } from './observation';

export function evaluateHand(hand: Card[]) {
  const hcp = hand.reduce((points, card) => points + Math.max(0, card.rank - 10), 0);
  const lengths = Object.fromEntries(SUITS.map(suit => [suit, hand.filter(c => c.suit === suit).length])) as Record<Suit, number>;
  const shape = Object.values(lengths).sort((a, b) => b - a).join('');
  return { hcp, lengths, balanced: ['4333', '4432', '5332'].includes(shape) };
}

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
function minimumPoints(call: Call): number {
  if (call.kind !== 'bid') return 0;
  if (call.strain === 'NT') return call.level === 1 ? 15 : call.level === 2 ? 8 : 10;
  return call.level === 1 ? 6 : call.level === 2 ? 6 : call.level === 3 ? 10 : 12;
}

/** BridgeLab Natural Lite. Heuristics are replaceable; they never determine legality. */
export function chooseBid(obs: BiddingObservation): Call {
  const { hcp, lengths, balanced } = evaluateHand(obs.hand);
  const available = (call: Call) => obs.legalCalls.some(c => sameCall(call, c));
  const pick = (...calls: Call[]) => calls.find(available) ?? PASS;
  const partner = partnerOf(obs.seat);
  const ours = obs.auction.filter(a => a.seat === obs.seat && a.call.kind === 'bid');
  const partners = obs.auction.filter(a => a.seat === partner && a.call.kind === 'bid');
  const partnerLast = partners.at(-1)?.call;
  const { lastBid, doubled } = auctionStatus(obs.auction);
  const longest = [...SUITS].sort((a, b) => lengths[b] - lengths[a] || SUITS.indexOf(b) - SUITS.indexOf(a))[0];
  const majors = (['S', 'H'] as Suit[]).filter(s => lengths[s] >= 5).sort((a, b) => lengths[b] - lengths[a]);
  const openingSuit = majors[0] ?? (lengths.D > lengths.C ? 'D' : 'C');
  if (!lastBid) {
    if (balanced && hcp >= 23) return pick(bid(3, 'NT'));
    if (balanced && hcp >= 20) return pick(bid(2, 'NT'));
    if (balanced && hcp >= 15 && hcp <= 17) return pick(bid(1, 'NT'));
    if (hcp >= 12) return pick(bid(1, openingSuit));
    if (hcp >= 7 && hcp <= 11 && lengths[longest] >= 6 && longest !== 'C') return pick(bid(2, longest));
    return PASS;
  }
  if (doubled === 1 && lastBid.call.kind === 'bid' && sideOf(lastBid.seat) === sideOf(obs.seat) && hcp >= 12 && ours.length === 0) return pick({ kind: 'redouble' });

  // Limit rebidding to avoid inventing an auction from increasingly optimistic estimates.
  if (ours.length >= 2) return PASS;
  if (partnerLast?.kind === 'bid' && sideOf(lastBid.seat) === sideOf(obs.seat)) {
    const p = partnerLast;
    const partnerOpening = partners[0];
    const firstPartnershipBid = obs.auction.find(a => sideOf(a.seat) === sideOf(obs.seat) && a.call.kind === 'bid');
    const partnerOpened = firstPartnershipBid?.seat === partner;
    if (!ours.length) {
      if (p.strain === 'NT') {
        if (p.level === 1) {
          if (majors[0] && lengths[majors[0]] >= 6 && hcp >= 10) return pick(bid(4, majors[0]));
          if (majors[0] && hcp >= 8) return pick(bid(2, majors[0]));
          if (hcp >= 10) return pick(bid(3, 'NT'));
          if (hcp >= 8) return pick(bid(2, 'NT'));
        } else if (p.level === 2 && hcp >= (partnerOpened ? 5 : 12)) return pick(bid(3, 'NT'));
        return PASS;
      }
      if ((p.strain === 'S' || p.strain === 'H') && lengths[p.strain] >= 3) {
        if (p.level === 1) {
          if (hcp >= 13) return pick(bid(4, p.strain));
          if (hcp >= 10) return pick(bid(3, p.strain));
          if (hcp >= 6) return pick(bid(2, p.strain));
        } else if (p.level === 2 && hcp >= 15) return pick(bid(4, p.strain));
        return PASS;
      }
      if (p.level === 1) {
        const newMajor = (['S', 'H'] as Suit[]).filter(s => lengths[s] >= 4 && s !== p.strain && available(bid(1, s))).sort((a, b) => lengths[b] - lengths[a])[0];
        if (newMajor && hcp >= 6) return bid(1, newMajor);
        if (balanced && hcp >= 13) return pick(bid(3, 'NT'));
        if (balanced && hcp >= 11) return pick(bid(2, 'NT'));
        if (lengths[longest] >= 5 && longest !== p.strain && hcp >= 10) return pick(bid(2, longest));
        if (lengths[p.strain] >= 4 && hcp >= 6) return pick(bid(hcp >= 10 ? 3 : 2, p.strain));
        if (hcp >= 6) return pick(bid(1, 'NT'));
      }
      return PASS;
    }

    const firstOwn = ours[0].call;
    if (firstOwn.kind !== 'bid') return PASS;
    if (firstOwn.strain === 'NT' && firstOwn.level === 1 && p.strain === 'NT' && p.level === 2) return hcp >= 16 ? pick(bid(3, 'NT')) : PASS;
    const pMin = partnerOpened && partnerOpening.call.kind === 'bid' ?
      (partnerOpening.call.strain === 'NT' ? (partnerOpening.call.level === 1 ? 15 : 20) : partnerOpening.call.level === 1 ? 12 : 7) : minimumPoints(p);
    const combined = hcp + pMin;
    if (p.strain !== 'NT' && lengths[p.strain] >= (p.strain === 'S' || p.strain === 'H' ? 3 : 4)) {
      const gameLevel = p.strain === 'S' || p.strain === 'H' ? 4 : 5;
      if (combined >= (gameLevel === 4 ? 25 : 28)) return pick(bid(gameLevel, p.strain));
      if (p.level === 1 && hcp >= 12) return pick(bid(2, p.strain));
      if (p.level === 2 && hcp >= 17) return pick(bid(3, p.strain));
    }
    if (balanced && combined >= 25) return pick(bid(3, 'NT'));
    if (balanced && hcp >= 18 && p.level <= 1) return pick(bid(2, 'NT'));
    if (lengths[firstOwn.strain as Suit] >= 6 && p.level <= 1 && hcp >= 13) return pick(bid(2, firstOwn.strain));
    return PASS;
  }

  // Natural competition: support a known fit, a five-card overcall, or a strong NT.
  if (lastBid.call.kind !== 'bid' || sideOf(lastBid.seat) === sideOf(obs.seat)) return PASS;
  const opposing = lastBid.call;
  if (partnerLast?.kind === 'bid' && partnerLast.strain !== 'NT' && lengths[partnerLast.strain] >= 3 && hcp >= 8) {
    const cap = hcp >= 13 ? 4 : 2;
    for (let level = partnerLast.level + 1; level <= cap; level++) if (available(bid(level, partnerLast.strain))) return bid(level, partnerLast.strain);
  }
  const stopped = opposing.strain === 'NT' || obs.hand.some(c => c.suit === opposing.strain && (c.rank === 14 || (c.rank === 13 && lengths[c.suit] >= 2) || (c.rank === 12 && lengths[c.suit] >= 3)));
  if (!ours.length && balanced && hcp >= 16 && hcp <= 18 && stopped && available(bid(1, 'NT'))) return bid(1, 'NT');
  if (!ours.length && lengths[longest] >= 5) {
    for (let level = 1; level <= 2; level++) if (hcp >= (level === 1 ? 10 : 13) && available(bid(level, longest))) return bid(level, longest);
  }
  if (!ours.length && hcp >= 17 && opposing.level <= 2 && opposing.strain !== 'NT' && lengths[opposing.strain] <= 2) return pick({ kind: 'double' });
  if (hcp >= 18 && opposing.level >= 3 && opposing.strain !== 'NT' && lengths[opposing.strain] >= 4 && bidValue(opposing) >= 10) return pick({ kind: 'double' });
  return PASS;
}

import { deck, seededRandom, sortCards } from '../core/deal';
import { SEATS, type Card, type Hands, type Seat, type Suit } from '../core/types';
import { type BiddingSystem } from './systems';
import { type PlayObservation } from './observation';
import { buildPublicPlayModel } from './play-public-model';
import { type PublicPlayModel, type SampledDeal } from './play-advisor-types';

export const CONSTRAINED_EMPTY = '无法根据公开信息生成一致的隐藏手牌样本';
const canonicalDeck = deck();
const canonicalById = new Map(canonicalDeck.map(card => [card.id, card]));

/** Physical facts only. Auction point/shape tendencies do not enter this validation. */
function assertPublicFacts(obs: PlayObservation, model: PublicPlayModel): void {
  for (const seat of SEATS) {
    if (!Number.isInteger(model.remainingCounts[seat]) || model.remainingCounts[seat] < 0
      || model.remainingCounts[seat] + model.playedBySeat[seat].length !== 13) throw new Error('公开牌张数与十三张初手不一致');
    if (model.knownHands[seat]?.some(card => model.voids[seat].includes(card.suit))) throw new Error('已知手牌与公开缺门互相矛盾');
    for (const card of [...model.playedBySeat[seat], ...(model.knownHands[seat] ?? [])]) {
      const canonical = canonicalById.get(card.id);
      if (!canonical || canonical.suit !== card.suit || canonical.rank !== card.rank) throw new Error('公开牌张身份不一致');
    }
  }
  const voids: Record<Seat, Set<Suit>> = { N: new Set(), E: new Set(), S: new Set(), W: new Set() };
  for (const plays of [...obs.completedTricks.map(trick => trick.plays), obs.currentTrick]) {
    const led = plays[0]?.card.suit;
    for (const play of plays) {
      if (voids[play.seat].has(play.card.suit)) throw new Error('公开出牌记录与已确认缺门互相矛盾');
      if (led && play.card.suit !== led) voids[play.seat].add(led);
    }
  }
}

const hcp = (cards: Card[]) => cards.reduce((sum, card) => sum + Math.max(0, card.rank - 10), 0);

function openingRange(obs: PlayObservation, system: BiddingSystem): { seat: Seat; min: number; max: number } | null {
  const firstBidIndex = obs.auction.findIndex(entry => entry.call.kind === 'bid');
  if (firstBidIndex < 0) return null;
  const entry = obs.auction[firstBidIndex];
  if (obs.auction.slice(0, firstBidIndex).some(call => call.call.kind !== 'pass') || entry.call.kind !== 'bid') return null;
  const { level, strain } = entry.call;
  if (system === 'precision') {
    if (level === 1 && strain === 'C') return { seat: entry.seat, min: 16, max: 40 };
    if (level === 1 && strain === 'NT') return { seat: entry.seat, min: 13, max: 15 };
    if (level === 2 && strain === 'NT') return { seat: entry.seat, min: 22, max: 23 };
    if ((level === 1 && strain !== 'NT') || (level === 2 && (strain === 'C' || strain === 'D'))) return { seat: entry.seat, min: 11, max: 15 };
    if (level === 2 && (strain === 'H' || strain === 'S')) return { seat: entry.seat, min: 6, max: 10 };
    return null;
  }
  if (level === 1 && strain === 'NT') return { seat: entry.seat, min: 15, max: 17 };
  if (level === 2 && strain === 'NT') return { seat: entry.seat, min: 20, max: 21 };
  if (level === 2 && strain === 'C') return { seat: entry.seat, min: 22, max: 40 };
  if (level === 2 && (strain === 'D' || strain === 'H' || strain === 'S')) return { seat: entry.seat, min: 6, max: 10 };
  if (level === 1 && strain !== 'NT') return { seat: entry.seat, min: 11, max: 22 };
  return null;
}

function compatibleWithAuction(obs: PlayObservation, system: BiddingSystem, hands: Hands, playedBySeat: Record<Seat, Card[]>): boolean {
  const range = openingRange(obs, system);
  if (!range) return true;
  const points = hcp([...hands[range.seat], ...playedBySeat[range.seat]]);
  return points >= range.min && points <= range.max;
}

function shuffled<T>(items: T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function assignUnknown(cards: Card[], capacities: Record<Seat, number>, voids: Record<Seat, string[]>, random: () => number,
  expired?: () => boolean): Record<Seat, Card[]> | null {
  const assigned: Record<Seat, Card[]> = { N: [], E: [], S: [], W: [] };
  const remaining = { ...capacities };
  const ordered = shuffled(cards, random).sort((a, b) => {
    const ea = SEATS.filter(seat => remaining[seat] > 0 && !voids[seat].includes(a.suit)).length;
    const eb = SEATS.filter(seat => remaining[seat] > 0 && !voids[seat].includes(b.suit)).length;
    return ea - eb;
  });
  const feasible = (from: number) => SEATS.every(seat => {
    if (remaining[seat] < 0) return false;
    let eligible = 0;
    for (let i = from; i < ordered.length; i++) if (!voids[seat].includes(ordered[i].suit)) eligible++;
    return eligible >= remaining[seat];
  });
  let nodes = 0;
  const place = (index: number): boolean => {
    // Bounds apply only to physical rescue; the default legacy stream stays unchanged.
    if (expired && (expired() || ++nodes > 20000)) return false;
    if (index === ordered.length) return SEATS.every(seat => remaining[seat] === 0);
    const card = ordered[index];
    const seats = shuffled(SEATS.filter(seat => remaining[seat] > 0 && !voids[seat].includes(card.suit)), random)
      .sort((a, b) => remaining[b] - remaining[a]);
    for (const seat of seats) {
      if (expired?.()) return false;
      remaining[seat]--; assigned[seat].push(card);
      if (feasible(index + 1) && place(index + 1)) return true;
      assigned[seat].pop(); remaining[seat]++;
    }
    return false;
  };
  return (!expired || feasible(0)) && place(0) ? assigned : null;
}

export function sampleDeals(obs: PlayObservation, system: BiddingSystem, count: number): { samples: SampledDeal[]; attempts: number } {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('采样数量必须在 1 到 64 之间');
  const model = buildPublicPlayModel(obs);
  const used = new Set([...model.playedIds, ...SEATS.flatMap(seat => (model.knownHands[seat] ?? []).map(card => card.id))]);
  const unknown = deck().filter(card => !used.has(card.id));
  const capacities = Object.fromEntries(SEATS.map(seat => [seat, model.remainingCounts[seat] - (model.knownHands[seat]?.length ?? 0)])) as Record<Seat, number>;
  if (Object.values(capacities).some(value => value < 0) || Object.values(capacities).reduce((a, b) => a + b, 0) !== unknown.length) throw new Error('公开信息无法组成完整的剩余牌局');
  const samples: SampledDeal[] = [];
  const seen = new Set<string>();
  let attempts = 0;
  const maxAttempts = Math.max(64, count * 96);
  while (samples.length < count && attempts < maxAttempts) {
    const random = seededRandom(`${model.key}|sample|${attempts++}`);
    const assignment = assignUnknown(unknown, capacities, model.voids, random);
    if (!assignment) break;
    const hands = Object.fromEntries(SEATS.map(seat => [seat, sortCards([...(model.knownHands[seat] ?? []), ...assignment[seat]])])) as Hands;
    if (!compatibleWithAuction(obs, system, hands, model.playedBySeat)) continue;
    const key = SEATS.map(seat => hands[seat].map(card => card.id).sort().join(',')).join('|');
    if (seen.has(key)) continue;
    seen.add(key); samples.push({ hands, key });
  }
  if (!samples.length) throw new Error(CONSTRAINED_EMPTY);
  return { samples, attempts };
}

/** Fresh equal-weight proposals used only after the legacy sampler reports constrained-empty. */
export function samplePhysicalDeals(obs: PlayObservation, count: number,
  options: { deadlineMs?: number; now?: () => number } = {}): { samples: SampledDeal[]; attempts: number } {
  if (!Number.isInteger(count) || count < 1 || count > 64) throw new Error('采样数量必须在 1 到 64 之间');
  const now = options.now ?? (() => performance.now());
  const expired = () => options.deadlineMs !== undefined && now() >= options.deadlineMs;
  const samples: SampledDeal[] = [];
  let attempts = 0;
  if (expired()) return { samples, attempts };
  const model = buildPublicPlayModel(obs);
  assertPublicFacts(obs, model);
  const used = new Set([...model.playedIds, ...SEATS.flatMap(seat => (model.knownHands[seat] ?? []).map(card => card.id))]);
  const unknown = canonicalDeck.filter(card => !used.has(card.id));
  const capacities = Object.fromEntries(SEATS.map(seat => [seat, model.remainingCounts[seat] - (model.knownHands[seat]?.length ?? 0)])) as Record<Seat, number>;
  if (Object.values(capacities).some(value => value < 0) || Object.values(capacities).reduce((a, b) => a + b, 0) !== unknown.length) throw new Error('公开信息无法组成完整的剩余牌局');
  const seen = new Set<string>();
  const maxAttempts = Math.max(64, count * 96);
  while (samples.length < count && attempts < maxAttempts && !expired()) {
    const random = seededRandom(`${model.key}|sample|${attempts++}`);
    const assignment = assignUnknown(unknown, capacities, model.voids, random, expired);
    if (!assignment) continue;
    const hands = Object.fromEntries(SEATS.map(seat => [seat,
      sortCards([...(model.knownHands[seat] ?? []), ...assignment[seat]]).map(card => ({ ...card }))])) as Hands;
    const key = SEATS.map(seat => hands[seat].map(card => card.id).sort().join(',')).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    samples.push({ hands, key });
  }
  return { samples, attempts };
}

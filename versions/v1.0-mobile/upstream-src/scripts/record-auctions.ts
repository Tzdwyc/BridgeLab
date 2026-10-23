import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { applyCall, newGame } from '../src/core/game';
import { type Call, type Card, type Suit, sideOf } from '../src/core/types';

const label = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'P' : call.kind === 'double' ? 'X' : 'XX';
const textHand = (hand: Card[]) => ['S', 'H', 'D', 'C'].map(suit => hand.filter(card => card.suit === suit)
  .sort((a, b) => b.rank - a.rank).map(card => '23456789TJQKA'[card.rank - 2]).join('') || '-').join('.');
const tag = process.env.BRIDGE_REVIEW_TAG ?? 'foundation-1';
const boards = Number(process.env.BRIDGE_REVIEW_BOARDS ?? 10000);
const stats = { boards: 0, steps: 0, competing: 0, severe: 0, long: 0, slams: 0, passedOut: 0 };
type Sample = { board: number; step: number; hand: string; hcp: number; auction: string; call: string };
const groups = new Map<string, { count: number; hcp: [number, number]; lengths: Record<Suit, [number, number]>; samples: Sample[] }>();
mkdirSync('artifacts', { recursive: true });
const gzip = createGzip();
const output = createWriteStream(`artifacts/bidding-review-${tag}-traces.jsonl.gz`);
gzip.pipe(output);
for (let index = 0; index < boards; index++) {
  let game = newGame(index % 16 + 1, `v031-model-review-${index}`);
  const steps = [];
  for (let guard = 0; game.phase === 'auction'; guard++) {
    if (guard >= 100) throw new Error(`Nonterminating auction ${index}`);
    const obs = observe(game) as BiddingObservation;
    const call = chooseBid(obs, 'sayc');
    const e = evaluateHand(obs.hand);
    const meaning = describeCall(obs.auction, obs.seat, call, 'sayc');
    const semantics = analyzeAuctionSemantics(obs.auction, obs.seat, 'sayc');
    const sample: Sample = { board: index, step: guard + 1, hand: textHand(obs.hand), hcp: e.hcp,
      auction: obs.auction.map(entry => `${entry.seat}:${label(entry.call)}`).join(' '), call: label(call) };
    const key = `${label(call)} | ${meaning}`;
    const group = groups.get(key) ?? { count: 0, hcp: [e.hcp, e.hcp],
      lengths: Object.fromEntries(Object.entries(e.lengths).map(([suit, length]) => [suit, [length, length]])) as Record<Suit, [number, number]>, samples: [] };
    group.count++;
    if (e.hcp < group.hcp[0] || e.hcp > group.hcp[1] || group.samples.length < 3) group.samples.push(sample);
    group.hcp = [Math.min(group.hcp[0], e.hcp), Math.max(group.hcp[1], e.hcp)];
    for (const suit of ['S', 'H', 'D', 'C'] as Suit[]) group.lengths[suit] = [Math.min(group.lengths[suit][0], e.lengths[suit]), Math.max(group.lengths[suit][1], e.lengths[suit])];
    groups.set(key, group);
    steps.push({ ...sample, seat: obs.seat, lengths: e.lengths, balanced: e.balanced, meaning,
      publicAuctionState: semantics, legalCalls: obs.legalCalls.map(label) });
    stats.steps++;
    game = applyCall(game, game.turn, call);
  }
  const active = game.auction.filter(entry => entry.call.kind !== 'pass');
  const competing = new Set(active.map(entry => sideOf(entry.seat))).size === 2;
  stats.boards++;
  if (competing) stats.competing++;
  if (competing && ['NS', 'EW'].every(side => active.filter(entry => sideOf(entry.seat) === side).length >= 2)
    && (active.some(entry => entry.call.kind === 'double' || entry.call.kind === 'redouble') || (game.contract?.level ?? 0) >= 3)) stats.severe++;
  if (game.auction.length >= 12) stats.long++;
  if ((game.contract?.level ?? 0) >= 6) stats.slams++;
  if (game.phase === 'passedOut') stats.passedOut++;
  const record = { board: index, seed: game.seed, dealer: game.dealer, vulnerability: game.vulnerability,
    hands: Object.fromEntries(Object.entries(game.initialHands).map(([seat, hand]) => [seat, textHand(hand)])),
    steps, contract: game.contract, auction: game.auction.map(entry => `${entry.seat}:${label(entry.call)}`).join(' ') };
  if (!gzip.write(JSON.stringify(record) + '\n')) await once(gzip, 'drain');
}
gzip.end(); await once(output, 'finish');
writeFileSync(`artifacts/bidding-review-${tag}-groups.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
  purpose: 'Recording and grouping only. No automatic bidding-correctness verdicts.', stats,
  groups: [...groups].map(([meaning, value]) => ({ meaning, ...value })) }, null, 2));
console.log(JSON.stringify(stats));

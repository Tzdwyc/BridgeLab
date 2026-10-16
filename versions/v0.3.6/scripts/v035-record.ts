// Observation recording only. GPT reviewers, not this script, judge calls and meanings.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { deal, boardInfo } from '../src/core/deal';
import { newGameFromDeal, applyCall } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { SEATS, type Card, type Call, sideOf } from '../src/core/types';

const tag = process.env.BRIDGE_V035_TAG ?? 'baseline';
const codeRoot = resolve(process.env.BRIDGE_CODE_ROOT ?? '.');
const label = (c: Call) => c.kind === 'bid' ? `${c.level}${c.strain}` : c.kind === 'pass' ? 'P' : c.kind === 'double' ? 'X' : 'XX';
const handText = (cards: Card[]) => ['S', 'H', 'D', 'C'].map(s => cards.filter(c => c.suit === s)
  .sort((a, b) => b.rank - a.rank).map(c => '23456789TJQKA'[c.rank - 2]).join('') || '-').join('.');
const sha = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const manifestPath = 'artifacts/v035-200-deals.json';
mkdirSync('artifacts', { recursive: true });
const strata = ['four-way-values', 'two-suiters', 'long-suit-preemption', 'multiple-shortages', 'extreme-distribution'];
if (!existsSync(manifestPath)) {
  const counts = Object.fromEntries(strata.map(s => [s, 0]));
  const selected = [];
  let attempts = 0;
  while (selected.length < 200 && attempts < 300000) {
    const seed = `v035-new-skewed-20261016-${attempts++}`;
    const hands = deal(seed);
    const es = SEATS.map(s => evaluateHand(hands[s]));
    const shapes = es.map(e => Object.values(e.lengths).sort((a, b) => b - a));
    const shortHands = shapes.filter(s => s[3] <= 1).length;
    const voids = shapes.filter(s => s[3] === 0).length;
    const bothValues = es[0].hcp + es[2].hcp >= 14 && es[1].hcp + es[3].hcp >= 14;
    const features = [es.every(e => e.hcp >= 7) && shortHands >= 2,
      shapes.filter(s => s[0] >= 5 && s[1] >= 4).length >= 2 && bothValues,
      shapes.some(s => s[0] >= 7) && shortHands >= 2 && bothValues,
      shortHands >= 3 && voids >= 1 && bothValues,
      shapes.some(s => s[0] >= 8) && shortHands >= 3 && bothValues];
    const index = features.findIndex((v, i) => v && counts[strata[i]] < 40);
    if (index < 0) continue;
    const number = selected.length + 1;
    const stratum = strata[index]; counts[stratum]++;
    selected.push({ board: number, seed, stratum, ...boardInfo(number),
      hands: Object.fromEntries(SEATS.map(s => [s, handText(hands[s])])),
      lengths: Object.fromEntries(SEATS.map((s, i) => [s, es[i].lengths])),
      hcp: Object.fromEntries(SEATS.map((s, i) => [s, es[i].hcp])) });
  }
  if (selected.length !== 200) throw new Error(`Insufficient skewed deals: ${JSON.stringify(counts)}`);
  writeFileSync(manifestPath, JSON.stringify({ createdAt: new Date().toISOString(), attempts,
    selection: 'Seeded fresh deals filtered only by shape and HCP strata before any auction; no quality selection',
    counts, boards: selected }, null, 2));
}
const corpus = JSON.parse(readFileSync(manifestPath, 'utf8'));
const code = createHash('sha256');
const files: Record<string, string> = {};
for (const name of ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts']) {
  const data = readFileSync(resolve(codeRoot, 'src/ai', name));
  code.update(name).update(data); files[name] = sha(data);
}
const initialDigest = code.digest('hex');
const boards = corpus.boards.map((b: {board: number; seed: string; stratum: string}) => {
  const info = boardInfo(b.board);
  let game = newGameFromDeal(b.board, b.seed, deal(b.seed), info.dealer, info.vulnerability);
  const steps = [];
  while (game.phase === 'auction') {
    if (steps.length >= 100) throw new Error(`Nonterminating auction: ${b.board}`);
    const obs = observe(game) as BiddingObservation;
    const call = chooseBid(obs, 'sayc');
    steps.push({ step: steps.length + 1, seat: obs.seat, hand: handText(obs.hand), hcp: evaluateHand(obs.hand).hcp,
      publicHistory: obs.auction.map(e => `${e.seat}:${label(e.call)}`).join(' '),
      call: label(call), meaning: describeCall(obs.auction, obs.seat, call, 'sayc') });
    game = applyCall(game, game.turn, call);
  }
  const active = game.auction.filter(e => e.call.kind !== 'pass');
  return { ...b, ...info, hands: Object.fromEntries(SEATS.map(s => [s, handText(game.initialHands[s])])),
    steps, contract: game.contract, result: game.phase === 'passedOut' ? 'passedOut' : `${game.contract!.level}${game.contract!.strain}`,
    competing: new Set(active.map(e => sideOf(e.seat))).size === 2,
    doubles: active.filter(e => e.call.kind === 'double').length };
});
for (const [name, digest] of Object.entries(files))
  if (sha(readFileSync(resolve(codeRoot, 'src/ai', name))) !== digest) throw new Error(`Source changed while recording: ${name}`);
const out = `artifacts/v035-${tag}-auctions.json`;
if (existsSync(out)) throw new Error(`Refusing to replace observation generation: ${out}`);
const report = { generatedAt: new Date().toISOString(), codeSha256: initialDigest, sourceFiles: files,
  corpusSha256: sha(readFileSync(manifestPath)), purpose: 'Full auction observation only; no automated quality verdict',
  boards, totalSteps: boards.reduce((n: number, b: { steps: unknown[] }) => n + b.steps.length, 0) };
writeFileSync(out, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ tag, boards: boards.length, steps: report.totalSteps, competing: boards.filter((b: {competing: boolean}) => b.competing).length,
  long: boards.filter((b: {steps: unknown[]}) => b.steps.length >= 12).length, codeSha256: initialDigest, observationSha256: sha(readFileSync(out)) }));

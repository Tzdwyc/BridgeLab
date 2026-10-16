// Record complete new auctions for previously GPT-reviewed deals.
// This is an observation recorder, with no bidding-quality verdicts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { newGame, applyCall } from '../src/core/game';
import { type Call, type Card } from '../src/core/types';

const ids = (process.env.BRIDGE_REPAIR_BOARDS ?? '355,374,426,436,480,491,494,507,518,3832,3867,3881,3887,3916,3917,3936,3993,4010,4017,4027,2600,2604,2623,2625,2628,2630,2631,2632,2635,2636,2641,2659,2661,2668,2674,2678,2680,2686,2687,2688,2694,2695,2712,2718,2720,2721,2727,2730,2736,2737,2748,7010,7034,7045,7124')
  .split(',').filter(Boolean).map(Number);
const label = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'P' : call.kind === 'double' ? 'X' : 'XX';
const holding = (hand: Card[]) => ['S', 'H', 'D', 'C'].map(suit => hand.filter(card => card.suit === suit)
  .sort((a, b) => b.rank - a.rank).map(card => '23456789TJQKA'[card.rank - 2]).join('') || '-').join('.');
const hash = createHash('sha256');
for (const file of ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts'])
  hash.update(file).update(readFileSync(`src/ai/${file}`));
const boards = ids.map(id => {
  let game = newGame(id % 16 + 1, `v031-model-review-${id}`);
  const steps = [];
  while (game.phase === 'auction') {
    if (steps.length >= 100) throw new Error(`Auction did not terminate: ${id}`);
    const obs = observe(game) as BiddingObservation;
    const call = chooseBid(obs, 'sayc');
    steps.push({ step: steps.length + 1, seat: obs.seat, hand: holding(obs.hand), hcp: evaluateHand(obs.hand).hcp,
      publicHistory: obs.auction.map(entry => `${entry.seat}:${label(entry.call)}`).join(' '),
      call: label(call), meaning: describeCall(obs.auction, obs.seat, call, 'sayc') });
    game = applyCall(game, game.turn, call);
  }
  return { board: id, seed: game.seed, dealer: game.dealer, vulnerability: game.vulnerability, steps,
    result: game.phase === 'passedOut' ? 'passedOut' : `${game.contract!.level}${game.contract!.strain}` };
});
const report = { generatedAt: new Date().toISOString(), codeSha256: hash.digest('hex'),
  purpose: 'Complete auction observations for GPT re-review; no automatic bidding or meaning judgments.',
  boards, totalSteps: boards.reduce((sum, board) => sum + board.steps.length, 0) };
writeFileSync('artifacts/v032-reviewed-board-replays.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ boards: boards.length, steps: report.totalSteps, codeSha256: report.codeSha256 }));

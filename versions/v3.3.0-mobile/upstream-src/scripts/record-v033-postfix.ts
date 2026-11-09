// Record complete new auctions for 2000 previously unreviewed original deal seeds.
// This is an observation recorder, with no bidding-quality verdicts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { newGame, applyCall } from '../src/core/game';
import { type Call, type Card } from '../src/core/types';

const ids = JSON.parse(readFileSync('artifacts/v033-review-selection.json', 'utf8')).boardIds as number[];
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
    let call: Call;
    try {
      call = chooseBid(obs, 'sayc');
    } catch (error) {
      console.error(JSON.stringify({ board: id, step: steps.length + 1, seat: obs.seat,
        hand: holding(obs.hand), publicHistory: obs.auction.map(entry => `${entry.seat}:${label(entry.call)}`).join(' '),
        purpose: 'Runtime failure context only; no bidding-quality verdict' }));
      throw error;
    }
    steps.push({ step: steps.length + 1, seat: obs.seat, hand: holding(obs.hand), hcp: evaluateHand(obs.hand).hcp,
      publicHistory: obs.auction.map(entry => `${entry.seat}:${label(entry.call)}`).join(' '),
      call: label(call), meaning: describeCall(obs.auction, obs.seat, call, 'sayc') });
    game = applyCall(game, game.turn, call);
  }
  return { board: id, seed: game.seed, dealer: game.dealer, vulnerability: game.vulnerability, steps,
    result: game.phase === 'passedOut' ? 'passedOut' : `${game.contract!.level}${game.contract!.strain}` };
});
const report = { generatedAt: new Date().toISOString(), codeSha256: hash.digest('hex'),
  purpose: 'Post-repair complete auction observations for GPT review; no automatic bidding or meaning judgments.',
  boards, totalSteps: boards.reduce((sum, board) => sum + board.steps.length, 0) };
writeFileSync(process.argv[2] ?? 'artifacts/v033-postfix-auctions.json', JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ boards: boards.length, steps: report.totalSteps, codeSha256: report.codeSha256 }));

// Record only calls, public descriptions and actual HCP. GPT writes verdicts.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { observe } from '../src/ai/observation';
import { newGame, applyCall } from '../src/core/game';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
const decode = (s: string): Call => s === 'P' ? PASS : s === 'X' ? { kind: 'double' } : s === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +s[0], strain: s.slice(1) as Strain };
const label = (c: Call) => c.kind === 'bid' ? `${c.level}${c.strain}` : c.kind === 'pass' ? 'P' : c.kind === 'double' ? 'X' : 'XX';
const handOf = (holding: string): Card[] => holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
  const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
  return { suit, rank, id: `${suit}${rank}` };
}));
const hash = createHash('sha256');
for (const file of ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts']) hash.update(file).update(readFileSync(`src/ai/${file}`));
const sourceSha256 = hash.digest('hex');
const rows = JSON.parse(readFileSync('artifacts/v033-final-core-target-input.json', 'utf8')).map((row: any) => {
  const hand = handOf(row.hand), auction: AuctionEntry[] = row.publicHistory.split(' ').filter(Boolean).map((token: string) => {
    const [seat, call] = token.split(':'); return { seat: seat as Seat, call: decode(call) };
  });
  const call = chooseBid({ phase: 'auction', board: row.board % 16 + 1, vulnerability: 'None', seat: row.seat, actingSeat: row.seat, hand, auction, legalCalls: legalCalls(auction, row.seat) }, 'sayc');
  return { ...row, hcp: evaluateHand(hand).hcp, newCall: label(call), newMeaning: describeCall(auction, row.seat, call, 'sayc') };
});
let game = newGame(7468 % 16 + 1, 'v031-model-review-7468');
const steps = [];
while (game.phase === 'auction' && steps.length < 40) {
  const seat = game.turn, obs = observe(game, seat), call = chooseBid(obs, 'sayc');
  steps.push({ step: steps.length + 1, seat, hcp: evaluateHand(obs.hand).hcp,
    hand: ['S', 'H', 'D', 'C'].map(suit => obs.hand.filter(c => c.suit === suit).sort((a,b) => b.rank-a.rank).map(c => '23456789TJQKA'[c.rank-2]).join('') || '-').join('.'),
    publicHistory: game.auction.map(e => `${e.seat}:${label(e.call)}`).join(' '), call: label(call), meaning: describeCall(obs.auction, seat, call, 'sayc') });
  game = applyCall(game, seat, call);
}
writeFileSync(process.argv[2] ?? 'artifacts/v033-final-core-target-observations.json', JSON.stringify({ sourceSha256, purpose: 'Observations only; no automatic quality judgments.', rows, complete7468: steps }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ sourceSha256, positions: rows.length, board7468Steps: steps.length }));

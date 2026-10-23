// Replay frozen reviewed positions after repairs. Every quality verdict remains GPT-authored.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
const decode = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' } : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +text[0], strain: text.slice(1) as Strain };
const label = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'P' : call.kind === 'double' ? 'X' : 'XX';
const hash = createHash('sha256');
for (const file of ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts']) hash.update(file).update(readFileSync(`src/ai/${file}`));
const sourceSha256 = hash.digest('hex');
const coverage = JSON.parse(readFileSync('artifacts/v033-model-review-coverage.json', 'utf8'));
if (!coverage.complete) throw Error('Complete all 2000 baseline GPT reviews before replaying repairs.');
const findings = JSON.parse(readFileSync('artifacts/v033-model-review-findings.json', 'utf8'));
const baseline = JSON.parse(readFileSync('artifacts/v033-baseline-auctions.json', 'utf8'));
const vulnerabilities = new Map(baseline.boards.map((board: any) => [board.board, board.vulnerability]));
const rows = findings.filter((row: any) => row.callVerdict === 'error' || row.meaningVerdict === 'error').map((row: any) => {
  const hand: Card[] = row.hand.split('.').flatMap((text: string, i: number) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  const auction: AuctionEntry[] = row.publicHistory.split(' ').filter(Boolean).map((token: string) => {
    const [seat, bid] = token.split(':'); return { seat: seat as Seat, call: decode(bid) };
  });
  const obs: BiddingObservation = { phase: 'auction', board: row.board % 16 + 1, seat: row.seat, actingSeat: row.seat, vulnerability: vulnerabilities.get(row.board) as BiddingObservation['vulnerability'], auction, hand, legalCalls: legalCalls(auction, row.seat) };
  const chosen = chooseBid(obs, 'sayc');
  return { ...row, hcp: evaluateHand(hand).hcp, baselineSourceSha256: row.sourceSha256, sourceSha256, newCall: label(chosen), newMeaning: describeCall(auction, row.seat, chosen, 'sayc'), originalCallNewMeaning: describeCall(auction, row.seat, decode(row.call), 'sayc') };
});
writeFileSync(process.argv[2] ?? 'artifacts/v033-findings-replay-observations.json', JSON.stringify({ sourceSha256, purpose: 'Observations only; GPT must judge repaired calls and explanations.', rows }, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ positions: rows.length, changedCalls: rows.filter((r: any) => r.call !== r.newCall).length, changedOriginalMeanings: rows.filter((r: any) => r.meaning !== r.originalCallNewMeaning).length, sourceSha256 }));

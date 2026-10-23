// Reproduce the exact public context of GPT-reviewed steps with current code.
// This recorder supplies observations; it never labels bidding correctness.
import { readFileSync, writeFileSync, createReadStream } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Suit } from '../src/core/types';

const label = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'P' : call.kind === 'double' ? 'X' : 'XX';
const parseCall = (text: string): Call => text === 'P' ? { kind: 'pass' } : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Extract<Call, { kind: 'bid' }>['strain'] };
const parseHand = (text: string): Card[] => text.split('.').flatMap((cards, i) => cards === '-' ? []
  : [...cards].map(symbol => { const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { id: `${suit}${rank}`, suit, rank }; }));
const requested = new Set((process.env.BRIDGE_REPLAY_IDS ?? '').split(',').filter(Boolean).map(Number));
const source = 'artifacts/bidding-review-foundation-6-traces.jsonl.gz';
const codeHash = createHash('sha256');
for (const path of ['bidding.ts', 'bidding-semantics.ts', 'competition.ts', 'systems.ts', 'suit-evaluation.ts'])
  codeHash.update(path).update(readFileSync(`src/ai/${path}`));
const tag = (process.env.BRIDGE_REPLAY_TAG ?? 'current').replace(/[^a-zA-Z0-9_-]/g, '_');
const lines = createInterface({ input: createReadStream(source).pipe(createGunzip()) });
const output: unknown[] = [];
for await (const line of lines) {
  const board = JSON.parse(line);
  if (!requested.has(board.board)) continue;
  for (const step of board.steps) {
    const auction: AuctionEntry[] = step.auction ? step.auction.split(' ').map((entry: string) => {
      const [seat, text] = entry.split(':'); return { seat: seat as Seat, call: parseCall(text) };
    }) : [];
    const obs: BiddingObservation = { board: board.board, phase: 'auction', seat: step.seat, actingSeat: step.seat,
      hand: parseHand(step.hand), auction, vulnerability: board.vulnerability, legalCalls: legalCalls(auction, step.seat) };
    const call = chooseBid(obs, 'sayc');
    output.push({ board: board.board, step: step.step, hand: step.hand, hcp: step.hcp, auction: step.auction,
      originalCall: step.call, originalMeaning: step.meaning, currentCall: label(call),
      currentMeaning: describeCall(auction, step.seat, call, 'sayc'), state: analyzeAuctionSemantics(auction, step.seat, 'sayc') });
  }
}
writeFileSync(`artifacts/chat-context-replay-${tag}.jsonl`, output.map(row => JSON.stringify(row)).join('\n') + '\n');
writeFileSync(`artifacts/chat-context-replay-${tag}-manifest.json`, JSON.stringify({ generatedAt: new Date().toISOString(),
  source, sourceSha256: createHash('sha256').update(readFileSync(source)).digest('hex'),
  codeSha256: codeHash.digest('hex'), requestedBoards: [...requested], contexts: output.length,
  purpose: 'Public-context replay only. GPT must supply every correctness judgment.' }, null, 2));
console.log(JSON.stringify({ contexts: output.length, purpose: 'Observation replay only; no correctness verdicts.' }));

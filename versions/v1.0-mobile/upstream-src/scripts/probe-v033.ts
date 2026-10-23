// Replay GPT-selected observations. This reports decisions, never judges quality.
import { readFileSync } from 'node:fs';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { legalCalls } from '../src/core/auction';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
const call = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' } : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +text[0], strain: text.slice(1) as Strain };
const baseline = JSON.parse(readFileSync('artifacts/v033-baseline-auctions.json', 'utf8'));
for (const key of process.argv.slice(2)) {
  const [id, step] = key.split('/').map(Number);
  const board = baseline.boards.find((b: any) => b.board === id);
  const row = board.steps[step - 1];
  const hand: Card[] = row.hand.split('.').flatMap((text: string, i: number) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[i], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  const auction: AuctionEntry[] = row.publicHistory.split(' ').filter(Boolean).map((token: string) => {
    const [seat, bid] = token.split(':'); return { seat: seat as Seat, call: call(bid) };
  });
  const obs: BiddingObservation = { phase: 'auction', board: id % 16 + 1, seat: row.seat, actingSeat: row.seat, vulnerability: board.vulnerability, auction, hand, legalCalls: legalCalls(auction, row.seat) };
  const chosen = chooseBid(obs, 'sayc');
  console.log(JSON.stringify({ key, baselineCall: row.call, chosen, meaning: describeCall(auction, row.seat, chosen, 'sayc'), semantics: analyzeAuctionSemantics(auction, row.seat, 'sayc') }));
}

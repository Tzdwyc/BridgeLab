// Presentation only: show the frozen provider's contract for previously
// ambiguous observations, without choosing or grading any call.
import { readFileSync } from 'node:fs';
import { describeCall } from '../src/ai/bidding';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
const parse = (text: string): Call => text === 'P' ? { kind: 'pass' } : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +text[0], strain: text.slice(1) as Strain };
const review = JSON.parse(readFileSync('artifacts/v033-release6b-auctions-core-gpt-review.json', 'utf8').replace(/^\uFEFF/, ''));
for (const row of review.rows.filter((row: any) => [row.callVerdict, row.meaningVerdict].includes('needs-system-definition'))) {
  const auction: AuctionEntry[] = row.publicHistory.split(' ').filter(Boolean).map((token: string) => {
    const [seat, text] = token.split(':'); return { seat: seat as Seat, call: parse(text) };
  });
  const candidate = parse(row.call), meaning = publicCallMeaningAt([...auction, { seat: row.seat, call: candidate }], auction.length, 'sayc');
  console.log(row.board, row.step, row.hand, row.hcp, row.publicHistory, row.call,
    JSON.stringify(meaning), describeCall(auction, row.seat, candidate, 'sayc'));
}

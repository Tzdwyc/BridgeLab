// Public-contract presentation, never private hand scoring or verdicts.
import { publicPlayerConstraints, publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
const parse = (text: string): Call => text === 'P' ? {kind:'pass'} : text === 'X' ? {kind:'double'}
  : text === 'XX' ? {kind:'redouble'} : {kind:'bid',level:+text[0],strain:text.slice(1) as Strain};
const auction: AuctionEntry[] = process.argv[2].split(' ').filter(Boolean).map(token => {
  const [seat,text]=token.split(':');return {seat:seat as Seat,call:parse(text)};
});
const seat = process.argv[3] as Seat;
console.log(JSON.stringify(publicPlayerConstraints(auction,seat,'sayc')));
for(let i=0;i<auction.length;i++) if(auction[i].seat===seat && auction[i].call.kind!=='pass') console.log(i,JSON.stringify(publicCallMeaningAt(auction,i,'sayc')));

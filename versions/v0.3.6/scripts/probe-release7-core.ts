import { readFileSync } from 'node:fs';
import { publicPlayerConstraints, analyzeAuctionSemantics, publicControlCueAt, publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { evaluateSuitFit, publicSupportMinimum } from '../src/ai/suit-evaluation';
import { legalCalls } from '../src/core/auction';
import { chooseBid } from '../src/ai/bidding';
import { type Call, type Seat, type Suit, type AuctionEntry, type Strain, partnerOf } from '../src/core/types';
const parse = (text:string):Call => text === 'P' ? {kind:'pass'} : text === 'X' ? {kind:'double'}
  : text === 'XX' ? {kind:'redouble'} : {kind:'bid',level:+text[0],strain:text.slice(1) as Strain};
const source = JSON.parse(readFileSync('artifacts/v033-release6b-auctions.json','utf8').replace(/^\uFEFF/,''));
{
const auction:AuctionEntry[]='N:3D E:P S:3H W:P N:4D E:P'.split(' ').map(t=>{const [seat,c]=t.split(':');return{seat:seat as Seat,call:parse(c)}});
console.log('preempt',publicPlayerConstraints(auction,'N','sayc'),publicCallMeaningAt(auction,4,'sayc'),analyzeAuctionSemantics(auction,'S','sayc'));
}
for (const [board,step] of [[721,7],[610,7],[7759,8],[7393,12],[7481,9],[7344,5],[7408,6]] as const) {
 const b=source.boards.find((b:any)=>b.board===board), s=b.steps.find((s:any)=>s.step===step);
 const auction:AuctionEntry[]=s.publicHistory.split(' ').filter(Boolean).map((t:string)=>{const [seat,c]=t.split(':');return{seat:seat as Seat,call:parse(c)}});
 const hand=s.hand.split('.').flatMap((t:string,i:number)=>[...t.replace('-','')].map(r=>({suit:(['S','H','D','C'] as Suit[])[i],rank:'23456789TJQKA'.indexOf(r)+2,id:r+i})));
 const seat=s.seat as Seat, pub=publicPlayerConstraints(auction,partnerOf(seat),'sayc');
 console.log({board,step, pub, meaning:publicCallMeaningAt(auction,auction.length-2,'sayc'),
 cue:publicControlCueAt([...auction,{seat,call:parse('4D')}],auction.length,'sayc'),semantics:analyzeAuctionSemantics(auction,seat,'sayc'),
 support:(['H','S','C','D'] as Suit[]).map(t=>[t,evaluateSuitFit(hand,t,pub.suitMinimums[t]).totalPoints,publicSupportMinimum(t,hand.filter((c:any)=>c.suit===t).length,pub)]),
 call:chooseBid({phase:'auction',board:1,vulnerability:'None',seat,actingSeat:seat,hand,auction,legalCalls:legalCalls(auction,seat)},'sayc')});
}

import { bidValue, sameCall } from '../core/auction';
import { partnerOf, sideOf, type AuctionEntry, type Call, type Seat, type Strain, type Suit, type Card } from '../core/types';
import type { BiddingSystem } from './systems';
type Bid = Extract<Call,{kind:'bid'}>;
export interface StandardAceContext {
 kind:'blackwood'|'gerber'; phase:'ask'|'answer'|'king-ask'|'king-answer'|'finish';
 askIndex:number; asker:Seat; responder:Seat; trump?:Suit;
 replies:{call:Call;counts:number[]}[]; answerIndex?:number; kingAskIndex?:number; kingAnswerIndex?:number;
 aceCounts?:number[]; kingCounts?:number[]; interference:'none'|'DOPI'|'ROPI';
}
const bid=(level:number,strain:Strain):Bid=>({kind:'bid',level,strain});
function responses(auction:AuctionEntry[],index:number,kind:'blackwood'|'gerber',kings=false) {
 const q=auction[index],enemy=auction[index+1];
 const level=kind==='blackwood'?(kings?6:5):(kings?5:4);
 const strains:Strain[]=kind==='blackwood'?['C','D','H','S']:['D','H','S','NT'];
 if(enemy && sideOf(enemy.seat)!==sideOf(q.seat) && ['bid','double'].includes(enemy.call.kind)) {
  const doubled=enemy.call.kind==='double';
  const last=enemy.call.kind==='bid'?enemy.call:q.call as Bid;
  const steps=Array.from({length:7},(_,i)=>i+1).flatMap(l=>(['C','D','H','S','NT'] as Strain[]).map(s=>bid(l,s))).filter(c=>bidValue(c)>bidValue(last)).slice(0,3);
  return {interference:(doubled?'ROPI':'DOPI') as 'ROPI'|'DOPI',replies:[
   {call:{kind:doubled?'redouble':'double'} as Call,counts:[0]}, {call:{kind:'pass'} as Call,counts:[1]},
   ...steps.map((call,i)=>({call,counts:[i+2]}))]};
 }
 return {interference:'none' as const,replies:strains.map((s,i)=>({call:bid(level,s),counts:i===0?[0,4]:[i]}))};
}
/** Auction-only standard-SAYC ace asks. Natural/Precise retain 1430.
 * NT callbacks are public semantic predicates and never receive private cards. */
export function standardAceContext(auction:AuctionEntry[],system:BiddingSystem,
 trumpAt:(a:AuctionEntry[],i:number,s:BiddingSystem)=>Strain|undefined,
 naturalNT:(a:AuctionEntry[],i:number,s:BiddingSystem)=>boolean):StandardAceContext|undefined {
 if(system!=='sayc')return undefined;
 for(let index=0;index<auction.length;index++) {
  const q=auction[index];if(q.call.kind!=='bid'||q.call.level!==4||!['C','NT'].includes(q.call.strain))continue;
  const before=auction.flatMap((e,i)=>i<index&&sideOf(e.seat)===sideOf(q.seat)&&e.call.kind==='bid'?[{...e,index:i}]:[]);
  const prior=before.at(-1);let kind:'blackwood'|'gerber',trump:Suit|undefined;
  if(q.call.strain==='NT') {const t=trumpAt(auction.slice(0,index+1),index,system);if(!t||t==='NT')continue;kind='blackwood';trump=t;}
  else {
   if(!prior||prior.seat!==partnerOf(q.seat)||prior.call.kind!=='bid'||prior.call.strain!=='NT'||prior.call.level>2
     || !naturalNT(auction.slice(0,index),prior.index,system)
     || !(prior.index===before[0].index||before.some(e=>e.index<prior.index&&e.seat===prior.seat)))continue;
   kind='gerber';
  }
  const responder=partnerOf(q.seat),responseIndex=auction.findIndex((e,i)=>i>index&&e.seat===responder);
  const first=responses(auction,index,kind);
  const ctx:StandardAceContext={kind,phase:'ask',askIndex:index,asker:q.seat,responder,trump,...first};
  if(responseIndex<0)return ctx;
  ctx.phase='answer';ctx.answerIndex=responseIndex;ctx.aceCounts=first.replies.find(r=>sameCall(r.call,auction[responseIndex].call))?.counts;
  const nextIndex=auction.findIndex((e,i)=>i>responseIndex&&e.seat===q.seat);
  if(nextIndex<0)return ctx;
  const next=auction[nextIndex].call;
  if(next.kind!=='bid'||next.level!==5||next.strain!==(kind==='blackwood'?'NT':'C'))return {...ctx,phase:'finish'};
  ctx.phase='king-ask';ctx.kingAskIndex=nextIndex;Object.assign(ctx,responses(auction,nextIndex,kind,true));
  const kingReply=auction.findIndex((e,i)=>i>nextIndex&&e.seat===responder);
  if(kingReply<0)return ctx;
  ctx.phase='king-answer';ctx.kingAnswerIndex=kingReply;
  ctx.kingCounts=ctx.replies.find(r=>sameCall(r.call,auction[kingReply].call))?.counts;
  if(auction.some((e,i)=>i>kingReply&&e.seat===q.seat))ctx.phase='finish';
  return ctx;
 }
 return undefined;
}
export const countedStandardReply=(ctx:StandardAceContext,count:number)=>ctx.replies.find(r=>r.counts.includes(count))?.call;
export const standardReplyActor=(ctx:StandardAceContext,seat:Seat)=>
 (ctx.phase==='ask'||ctx.phase==='king-ask')&&seat===ctx.responder;

/** Bound a reported ace count with own cards and partner's public HCP range. */
export function feasibleStandardAces(hand:Card[],range:{min:number;max:number}|undefined,reported:number[]) {
 const ours=hand.filter(c=>c.rank===14).length;
 const nonAce=hand.filter(c=>c.rank!==14).reduce((n,c)=>n+Math.max(0,c.rank-10),0);
 return reported.filter(n=>n+ours<=4&&n*4<=(range?.max??40)
  &&n*4+24-nonAce>=(range?.min??0));
}

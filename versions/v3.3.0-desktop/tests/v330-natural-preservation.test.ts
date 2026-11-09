/** Existing fixed observations and supplied Drury unit prefixes only; no new deals or training. */
import { expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { chooseBid as oldChoose, describeCall as oldDescribe } from './fixtures/v329/src/ai/bidding';
import * as oldSemantics from './fixtures/v329/src/ai/bidding-semantics';
import { assessCandidates as oldAssess } from './fixtures/v329/src/ai/constrained-sl';
import { suggestSystemBid as oldSuggest } from './fixtures/v329/src/ai/bid-strategy';
import { setSLProfile as oldProfile } from './fixtures/v329/src/ai/neural/browser-model';
import { chooseBid, describeCall } from '../src/ai/bidding';
import * as semantics from '../src/ai/bidding-semantics';
import { assessCandidates } from '../src/ai/constrained-sl';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { getSLModelState, setSLProfile, suggestSLBid, SL_PROFILES, recordAppliedSLBid } from '../src/ai/neural/browser-model';
import { getSLModelState as frozenState } from '../src/ai/natural-v329/neural/browser-model';
import { legalCalls } from '../src/core/auction';
import { parseAuction } from './fixtures/android-stack-incident';
import { SEATS, type Card, type Suit, type Call } from '../src/core/types';
import type { BiddingObservation } from '../src/ai/observation';

const input = 'artifacts/v330-systems-drury-20261109/existing-fixed33.json';
const evidence = JSON.parse(readFileSync(input,'utf8')) as { rows: {pointId:string;system:string;frozenObservation:BiddingObservation}[] };
const rows=evidence.rows.filter(row=>row.system==='sayc');
const full=(o:BiddingObservation,c:Call)=>[...o.auction,{seat:o.seat,call:c}];
function observation(prefix:string, holding:string):BiddingObservation {
 const auction=parseAuction(prefix),seat=SEATS[auction.length%4];
 const hand=holding.split('.').flatMap((part,i)=>[...part].map(r=>{const suit=(['S','H','D','C'] as Suit[])[i],rank='23456789TJQKA'.indexOf(r)+2;return {suit,rank,id:`${suit}${rank}`};})) as Card[];
 return {board:1,seat,actingSeat:seat,phase:'auction',vulnerability:'None',hand,auction,legalCalls:legalCalls(auction,seat)};
}
it('preserves all old default SAYC rule, public meaning and assessment results on the existing 33 contexts',()=>{
 expect(rows).toHaveLength(33);
 for(const row of rows){
  const o=row.frozenObservation,c=oldChoose(o,'sayc');
  expect(chooseBid(o,'two-over-one'),row.pointId).toEqual(c);
  expect(semantics.analyzeAuctionSemantics(o.auction,o.seat,'two-over-one'),row.pointId).toEqual(oldSemantics.analyzeAuctionSemantics(o.auction,o.seat,'sayc'));
  expect(semantics.publicPlayerConstraints(o.auction,o.seat,'two-over-one'),row.pointId).toEqual(oldSemantics.publicPlayerConstraints(o.auction,o.seat,'sayc'));
  expect(assessCandidates(o,'two-over-one'),row.pointId).toEqual(oldAssess(o,'sayc'));
  expect(semantics.publicCallMeaningAt(full(o,c),o.auction.length,'two-over-one'),row.pointId).toEqual(oldSemantics.publicCallMeaningAt(full(o,c),o.auction.length,'sayc'));
  expect(describeCall(o.auction,o.seat,c,'two-over-one'),row.pointId).toBe(oldDescribe(o.auction,o.seat,c,'sayc'));
 }
},120000);

it('keeps both real model profiles, traces and the active singleton equal to the original default SAYC route',async()=>{
 const storage=new Map<string,string>();
 vi.stubGlobal('localStorage',{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value)});
 vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>new Response(new Uint8Array(readFileSync(new URL('../public'+new URL(String(input),'http://localhost/').pathname,import.meta.url)))));
 const results:unknown[]=[];
 try {
  expect(frozenState).toBe(getSLModelState);
  for(const profile of ['seed101-epoch08','original-sl'] as const){
   await oldProfile(profile); await setSLProfile(profile);
   expect(getSLModelState().loadedWeightsSHA256).toBe(SL_PROFILES[profile].weightsSHA256);
   expect(getSLModelState().lookaheadEnabled).toBe(false);
   for(const row of rows){
    const old=await oldSuggest(row.frozenObservation,{system:'sayc',allowLookahead:false});
    const current=await suggestSystemBid(row.frozenObservation,{system:'two-over-one',allowLookahead:false});
    expect(current,`${row.pointId}/${profile}`).toEqual(old);
    results.push({pointId:row.pointId,profile,old,current,equal:true});
   }
   const raw=await suggestSLBid(rows[0].frozenObservation,{system:'sayc',postprocess:false});
   expect(raw.trace.route).toBe('sl-legal');expect(raw.call).toEqual(raw.trace.baselineCall);
   const before=getSLModelState().appliedBids;recordAppliedSLBid(raw.trace);
   expect(frozenState().appliedBids).toBe(before+1);
  }
  writeFileSync('artifacts/v330-systems-drury-20261109/NATURAL_V329_MODEL_PARITY.json',JSON.stringify({input,contexts:rows.length,profiles:2,newMotherDeals:0,training:0,results},null,2)+'\n');
 } finally { vi.unstubAllGlobals(); }
},120000);

it('preserves legacy NT ranges, mixed 2/1, 1430 and the minor two-suit 4NT opening',()=>{
 for(const prefix of ['1C P 2NT','1C P 3NT','1S P 2C','1H P 2NT P 4NT P 5C','4NT']){
  const a=parseAuction(prefix),index=a.length-1;
  expect(semantics.publicCallMeaningAt(a,index,'two-over-one')).toEqual(oldSemantics.publicCallMeaningAt(a,index,'sayc'));
 }
});

it('uses Drury without club promises throughout later continuations and competition',()=>{
 for(const prefix of ['P P 1S P','P P P 1S P']){
  const o=observation(prefix,'KQ4.J832.A654.9'),c=chooseBid(o,'two-over-one'),a=full(o,c);
  expect(c).toEqual({kind:'bid',level:2,strain:'C'});
  expect(assessCandidates(o,'two-over-one').find(row=>row.call.kind==='bid'&&row.call.level===2&&row.call.strain==='C')?.allowed).toBe(true);
  for(const suffix of ['', ' P 2S P',' P 2D P 3S P',' P 2D 2H']){
   const continuation=suffix?parseAuction(prefix+' 2C'+suffix):a;
   expect(semantics.publicCallMeaningAt(continuation,a.length-1,'two-over-one')).toMatchObject({role:'drury-inquiry',artificial:true,suitMinimums:{S:3}});
   expect(semantics.publicPlayerConstraints(continuation,o.seat,'two-over-one').suitMinimums.C).toBe(0);
   expect(semantics.naturalSuitMinimum(continuation,o.seat,'C','two-over-one')).toBe(0);
  }
 }
});

it('keeps all non-2C candidates unchanged on a potential Drury platform',()=>{
 const o=observation('P P 1S P','KQ43.J832.A654.9');
 expect(chooseBid(o,'two-over-one')).toEqual(oldChoose(o,'sayc'));
 expect(assessCandidates(o,'two-over-one').filter(row=>!(row.call.kind==='bid'&&row.call.level===2&&row.call.strain==='C')))
  .toEqual(oldAssess(o,'sayc').filter(row=>!(row.call.kind==='bid'&&row.call.level===2&&row.call.strain==='C')));
});

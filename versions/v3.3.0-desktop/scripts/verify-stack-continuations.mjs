// Extra UI-contract regression: every control through the RKCB Q/K continuations.
// Does not choose bids, rewrite saves or modify runtime code.
import { build } from 'esbuild';
const code = String.raw`
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describeCall } from './src/ai/bidding';
import { publicCallMeaningAt, analyzeAuctionSemantics, isArtificialBidAt, noTrumpRangeAt,
  classifyDoubleAt, clearPublicMeaningCaches } from './src/ai/bidding-semantics';
import { legalCalls, sameCall } from './src/core/auction';
import { nextSeat, partnerOf, SEATS } from './src/core/types';
import { parseAuction, allBiddingButtons } from './tests/fixtures/android-stack-incident';
const sourceFile = 'src/ai/bidding-semantics.ts';
const hash = () => createHash('sha256').update(readFileSync(sourceFile)).digest('hex');
const startHash=hash();
const scenarios = [
 {text:'1S P 3S P 4NT P 5D P 5H', role:'queen-ask', answerPending:true, artificial:true},
 {text:'1S P 3S P 4NT P 5D P 5H X', queriedIndex:8, role:'queen-ask', answerPending:true, artificial:true},
 {text:'1S P 3S P 4NT P 5D P 5H P 5S', role:'queen-answer', artificial:false},
 {text:'1S P 3S P 4NT P 5D P 5NT', role:'king-ask', answerPending:true, artificial:true},
 {text:'1S P 3S P 4NT P 5D P 5NT X', queriedIndex:8, role:'king-ask', answerPending:true, artificial:true},
 {text:'1S P 3S P 4NT P 5D P 5NT P 6C', role:'king-answer', artificial:true},
];
const rows=[];
let prefixes=0,buttonExplanations=0,historicalGroups=0;
let southUIPrefixes=0,southUIExplanations=0,southOutOfTurnPrefixes=0;
for (const system of ['sayc','two-over-one','precision']) for (const dealer of SEATS) for (const scenario of scenarios) {
 const auction=parseAuction(scenario.text,dealer);
 clearPublicMeaningCaches();
 for(let end=0;end<=auction.length;end++) {
  const prefix=auction.slice(0,end),seat=end?nextSeat(prefix.at(-1).seat):dealer;
  if(end<auction.length) assert(legalCalls(prefix,seat).some(call=>sameCall(call,auction[end].call)));
  for(const call of allBiddingButtons) {
   assert(describeCall(prefix,seat,call,system).trim().length>0);
   buttonExplanations++;
  }
  // The real BiddingBox always describes South, even while its controls are
  // disabled on another player's turn. Do not assume candidate legality or turn.
  for(const call of allBiddingButtons) {
   assert(describeCall(prefix,'S',call,system).trim().length>0);
   southUIExplanations++;
  }
  southUIPrefixes++;
  if(seat!=='S') southOutOfTurnPrefixes++;
  for(let at=0;at<prefix.length;at++) {
   const own=prefix.slice(0,at+1),before=prefix.slice(0,at),entry=prefix[at];
   assert(describeCall(before,entry.seat,entry.call,system).trim().length>0);
   assert.deepEqual(publicCallMeaningAt(prefix,at,system),publicCallMeaningAt(own,at,system));
   assert.equal(isArtificialBidAt(prefix,at,system),isArtificialBidAt(own,at,system));
   assert.deepEqual(noTrumpRangeAt(prefix,at,system),noTrumpRangeAt(own,at,system));
   assert.equal(classifyDoubleAt(prefix,at,system),classifyDoubleAt(own,at,system));
   historicalGroups++;
  }
  prefixes++;
 }
 const at=scenario.queriedIndex??auction.length-1;
 const meaning=publicCallMeaningAt(auction,at,system);
 assert.equal(meaning.role,scenario.role);
 assert.equal(meaning.artificial,scenario.artificial);
 const actor=partnerOf(auction[at].seat);
 const state=analyzeAuctionSemantics(auction,actor,system);
 if(scenario.answerPending) assert.equal(state.mustBid,true);
 const tooltip=describeCall(auction.slice(0,at),auction[at].seat,auction[at].call,system);
 rows.push({system,dealer,auction:scenario.text,queriedIndex:at,role:meaning.role,
  artificial:meaning.artificial,state,tooltip});
}
const uiOnlySequences=[
 '2D P','2H X','2S 3C','P P 2H X','2H X XX P 2NT',
 '1C 2D P 2NT','1C 2D X 2NT','1C 2D 2H 2NT',
 '1C 2D X XX 2H 2NT','1C 2C X 2H P','1S 2NT X 3C P',
 '1C 1H P 2C X 2H P','1NT P 2C X','1NT P 2D X',
 '1NT P 2D 2S','2C P 2D P 2H P 3C P','1C P 1H P 1S P 2D P',
 '1C P 1S P 1NT P 2D P'
];
for(const system of ['sayc','two-over-one','precision']) for(const dealer of SEATS) for(const text of uiOnlySequences) {
 const auction=parseAuction(text,dealer);
 clearPublicMeaningCaches();
 for(let end=0;end<=auction.length;end++) {
  const prefix=auction.slice(0,end),actual=end?nextSeat(prefix.at(-1).seat):dealer;
  if(end<auction.length) assert(legalCalls(prefix,actual).some(call=>sameCall(call,auction[end].call)));
  for(const call of allBiddingButtons) {
   assert(describeCall(prefix,'S',call,system).trim().length>0);
   southUIExplanations++;
  }
  southUIPrefixes++;
  if(actual!=='S') southOutOfTurnPrefixes++;
 }
}
assert.equal(hash(),startHash);
const report={sourceSha256:startHash,sourceUnchanged:true,scenarios:rows.length,prefixes,
 buttonExplanations,historicalGroups,southUIPrefixes,southUIExplanations,southOutOfTurnPrefixes,
 additionalUISequences:uiOnlySequences.length*3*4,passed:true,failures:[],rows,
 boundary:'Explicit Q/K continuation facts plus complete UI-control and history queries; counts include repeated shared prefixes.'};
writeFileSync('artifacts/stack-hotfix-qk-continuations.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({scenarios:rows.length,prefixes,buttonExplanations,historicalGroups,
 southUIPrefixes,southUIExplanations,southOutOfTurnPrefixes,passed:true,sourceSha256:startHash}));
`;
const compiled = await build({ stdin: { contents: code, resolveDir: process.cwd(), loader: 'ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
await import('data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));

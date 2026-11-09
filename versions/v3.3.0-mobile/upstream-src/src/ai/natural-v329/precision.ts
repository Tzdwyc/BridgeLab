/** Isolated research entry: an unsupported agreement is data, never an invented bid. */
import {type Call,partnerOf} from '../../core/types';
import {sameCall} from '../../core/auction';
import {type BiddingObservation} from './observation';
import {analyzeAuctionSemantics,publicPlayerConstraints} from './bidding-semantics';
import {evaluateHand} from './bidding-legacy';
import {chooseBid} from './bidding';
import {assessCandidates,type CandidateAssessment} from './constrained-sl';
export type PrecisionDecision =
 | {status:'supported';system:'precision';call:Call;candidates:CandidateAssessment[];selection?:'rules'|'qualified-natural';rejectedRuleCall?:Call}
 | {status:'unsupported';system:'precision';code:'unagreed-interference'|'no-qualified-candidate'|'rule-candidate-conflict';message:string;candidates:CandidateAssessment[];proposedCall?:Call};
export function diagnosePrecisionBid(obs:BiddingObservation):PrecisionDecision {
 const candidates=assessCandidates(obs,'precision');
 if(!candidates.some(c=>c.allowed))return {status:'unsupported',system:'precision',code:'no-qualified-candidate',message:'公开协议与本手未找到合格候选；保留审计，不用Pass替代。',candidates};
 const proposedCall=chooseBid(obs,'precision'),selected=candidates.find(c=>sameCall(c.call,proposedCall));
 if(selected?.allowed)return {status:'supported',system:'precision',call:proposedCall,candidates,selection:'rules'};
 // The production card has a deterministic natural continuation after the
 // ordered rules. Every choice has already passed the same public promises.
 const allowed=candidates.filter(c=>c.allowed),{hcp,lengths,balanced}=evaluateHand(obs.hand);
 const state=analyzeAuctionSemantics(obs.auction,obs.seat,'precision');
 const partner=publicPlayerConstraints(obs.auction,partnerOf(obs.seat),'precision');
 const score=(c:CandidateAssessment)=>{
   const call=c.call,m=c.meaning;
   if(call.kind==='pass')return !state.mustBid?200:0;
   if(call.kind==='double')return 35;
   if(call.kind==='redouble')return m.role==='precision-positive'?120:0;
   if(m.artificial)return m.intent==='answer'?140:m.role==='precision-positive'?110:10-call.level;
   if(call.strain==='NT')return (balanced?50:20)+(hcp+(partner.hcpRange?.min??0)>=25&&call.level===3?30:0)-call.level*3;
   const fit=lengths[call.strain]+partner.suitMinimums[call.strain];
   return lengths[call.strain]*4+(fit>=8?30:0)+(fit>=8&&call.level===(['H','S'].includes(call.strain)?4:5)?15:0)-call.level*4;
 };
 const qualified=allowed.sort((a,b)=>score(b)-score(a)||a.action-b.action)[0];
 return {status:'supported',system:'precision',call:qualified.call,candidates,selection:'qualified-natural',rejectedRuleCall:proposedCall};
}

/** Production endpoint. Unsupported audit states fail visibly; no arbitrary Pass. */
export function decidePrecisionBid(obs:BiddingObservation):Call {
 const decision=diagnosePrecisionBid(obs);
 if(decision.status==='unsupported') throw new Error(`Precision agreement ${decision.code}: ${decision.message}`);
 return decision.call;
}

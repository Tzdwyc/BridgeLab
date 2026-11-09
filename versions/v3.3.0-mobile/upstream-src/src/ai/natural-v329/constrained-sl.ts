/** Untrained SL adaptation. All constraints use own hand + public prefix. */
import {bidValue,sameCall,legalCalls} from '../../core/auction';
import {type Call,type Suit,SUITS,partnerOf,sideOf} from '../../core/types';
import {type BiddingObservation} from './observation';
import {type BiddingSystem} from './systems';
import {evaluateHand} from './bidding-legacy';
import {describeCall} from './bidding';
import {analyzeAuctionSemantics,publicCallMeaningAt,publicPlayerConstraints,publicTakeoutDoubleAt,
  publicKeycardTrumpAt,publicPendingResponse,pendingResponseViolation,publicPenaltyConversionBefore,classifyDoubleAt,quantitativeNoTrumpPlatformBefore,noTrumpRangeAt,quantitativeSmallInvitationMinimum,type PublicCallMeaning} from './bidding-semantics';
import {evaluateSuitFit,countKeycards,hasTrumpQueen,rkcb1430Response,publicSupportMinimum,feasiblePublicKeycardCounts} from './suit-evaluation';
import {infer,encodeObservation,actionToCall,callToAction,type NeuralModel} from './neural/index';

type Bid=Extract<Call,{kind:'bid'}>;
const isMajor=(s:string)=>s==='H'||s==='S';
const gameLevel=(s:string)=>s==='NT'?3:isMajor(s)?4:5;
const bid=(level:number,strain:Bid['strain']):Bid=>({kind:'bid',level,strain});
export interface CandidateAssessment {call:Call; action:number; allowed:boolean; reasons:string[]; meaning:PublicCallMeaning}
export interface AdaptedDecision {
 call:Call; action:number; rawLegalAction:number; route:'sl-constrained'; logits:number[];
 filtered:boolean; allowedCount:number; retainedProbabilityMass:number;
 candidates:CandidateAssessment[]; meaning:string;
}
export class CandidateExhaustion extends Error {
 readonly candidates:CandidateAssessment[];
 constructor(candidates:CandidateAssessment[]){super('No convention-qualified candidate; explicit audit required');this.name='CandidateExhaustion';this.candidates=candidates;}
}
export function quickTricks(hand:BiddingObservation['hand']):number {
 return SUITS.reduce((sum,s)=>{const r=hand.filter(c=>c.suit===s).map(c=>c.rank);
  return sum+(r.includes(14)?r.includes(13)?2:r.includes(12)&&r.length>=2?1.5:1:r.includes(13)&&r.length>=2?r.includes(12)?1:.5:0);},0);
}
function losingTricks(hand:BiddingObservation['hand']):number {
 return SUITS.reduce((sum,s)=>{const r=hand.filter(c=>c.suit===s).map(c=>c.rank);
  return sum+Number(r.length>0&&!r.includes(14))+Number(r.length>1&&!r.includes(13))+Number(r.length>2&&!r.includes(12));},0);
}
export function assessCandidates(obs:BiddingObservation,system:BiddingSystem='sayc'):CandidateAssessment[] {
 if(obs.phase!=='auction'||obs.seat!==obs.actingSeat)throw new Error('Only acting own-hand observations accepted');
 const authoritative=legalCalls(obs.auction,obs.seat);
 if(authoritative.length!==obs.legalCalls.length||authoritative.some(c=>!obs.legalCalls.some(d=>sameCall(c,d))))throw new Error('Untrusted legal-call list');
 const {hcp,lengths}=evaluateHand(obs.hand),shape=Object.values(lengths).sort((a,b)=>b-a).join('');
 const before=analyzeAuctionSemantics(obs.auction,obs.seat,system);
 const partner=publicPlayerConstraints(obs.auction,partnerOf(obs.seat),system),own=publicPlayerConstraints(obs.auction,obs.seat,system);
 const pending=publicPendingResponse(obs.auction,obs.seat,system);
 const full=(c:Call)=>[...obs.auction,{seat:obs.seat,call:c}];
 const ranks=(s:Suit)=>obs.hand.filter(c=>c.suit===s).map(c=>c.rank);
 const stopper=(s:Suit)=>ranks(s).includes(14)||ranks(s).includes(13)&&lengths[s]>=2||ranks(s).includes(12)&&lengths[s]>=3;
 const control=(s:Suit)=>lengths[s]<=1||ranks(s).includes(14)||ranks(s).includes(13)&&lengths[s]>=2;
 const naturalBids=obs.auction.flatMap((e,i)=>e.call.kind==='bid'?[{...e,index:i,call:e.call as Bid}]:[]);
 const last=naturalBids.at(-1),p=naturalBids.findLast(e=>e.seat===partnerOf(obs.seat));
 const ownBids=naturalBids.filter(e=>e.seat===obs.seat);
 const quantInvitation=p&&p.call.strain==='NT'&&[4,5].includes(p.call.level)&&!publicCallMeaningAt(obs.auction,p.index,system).artificial&&['invitation','grand-inv'].includes(publicCallMeaningAt(obs.auction,p.index,system).intent)?p:undefined;
 const enemies=naturalBids.filter(e=>sideOf(e.seat)!==sideOf(obs.seat));
 const supportTotal=(tr:Suit)=>evaluateSuitFit(obs.hand,tr,partner.suitMinimums[tr]).totalPoints+publicSupportMinimum(tr,lengths[tr],partner);
 const knownGameFits=SUITS.filter(tr=>lengths[tr]+partner.suitMinimums[tr]>=8&&supportTotal(tr)>=(isMajor(tr)?25:29));
 const keys=naturalBids.findLast(e=>sideOf(e.seat)===sideOf(obs.seat)&&e.call.level===4&&e.call.strain==='NT'&&publicKeycardTrumpAt(obs.auction,e.index,system));
 const trump=keys&&publicKeycardTrumpAt(obs.auction,keys.index,system) as Suit|undefined;
 return authoritative.map(call=>{
  const prefix=full(call),m=publicCallMeaningAt(prefix,obs.auction.length,system),reasons:string[]=[];
  const fail=(reason:string)=>{if(!reasons.includes(reason))reasons.push(reason);};
  // Complete an enumerated inquiry answer before making a contract choice.
  // A broad natural-only obligation is not an exact response protocol.
  const exactInquiryAnswer=m.intent==='answer'&&!!pending?.allowedCalls?.some(c=>sameCall(c,call))
   &&(!pending.allowedRoles||pending.allowedRoles.includes(m.role));
  const boundary=m.ntBoundaryGameQualification;
  const boundaryGameQualified=!!boundary&&hcp>=boundary.minHcp&&hcp<=boundary.maxHcp
   &&partner.hcpRange?.min===boundary.platformMin&&partner.hcpRange.max===boundary.platformMax
   &&(!boundary.trump||lengths[boundary.trump]+partner.suitMinimums[boundary.trump]>=(boundary.minFit??8));
  if(!m.defined||m.role.startsWith('unmapped'))fail('undefined-convention');
  if(pending){
   if(pending.kind==='feature'&&pending.trump&&call.kind==='bid'){
    const feature=SUITS.find(s=>s!==pending.trump&&ranks(s).some(r=>r>=13));
    const featureCall=feature&&bid(3,feature);
    const featureMeaning=featureCall&&publicCallMeaningAt(full(featureCall),obs.auction.length,system);
    const featureMinimum=featureMeaning?.hcpRange?.min??(system==='sayc'?9:8);
    const expected=hcp>=featureMinimum&&featureCall?featureCall:bid(3,pending.trump);
    if(!sameCall(call,expected))fail('weak-feature-exact-answer');
   }
   if(pending.kind==='cue-response'){
    // Natural replies and the card's recognized artificial alternatives use
    // the same membership rule as their public meaning. Resource checks below remain active.
    if(pendingResponseViolation(pending,call,m.artificial,m.role))fail('pending-'+pending.kind);
   }else{
    if(pending.allowedCalls&&!pending.allowedCalls.some(c=>sameCall(c,call)))fail('pending-'+pending.kind);
    if(pending.allowedRoles&&!pending.allowedRoles.includes(m.role))fail('pending-'+pending.kind);
    if(pending.naturalOnly&&(call.kind!=='bid'||m.artificial))fail('pending-'+pending.kind);
   }
  }
  if(quantInvitation){
   const total=hcp+(publicCallMeaningAt(obs.auction,quantInvitation.index,system).hcpRange?.min??0);
   if(quantInvitation.call.level===4&&total>=33&&call.kind==='pass')fail('quantitative-invitation-acceptance');
   if(quantInvitation.call.level===5&&call.kind==='bid'&&call.strain==='NT'&&call.level===7&&total<37)fail('quantitative-grand-acceptance');
  }
  if(call.kind==='pass'){
   const explicitNegative=['strong-club-negative-pass','precision-negative-pass'].includes(m.role);
   const converted=!!publicPenaltyConversionBefore(obs.auction,obs.seat,system);
   if((explicitNegative||system==='precision')&&m.hcpRange&&(hcp<m.hcpRange.min||hcp>m.hcpRange.max))fail('negative-pass-hcp');
   if(before.mustBid&&!explicitNegative&&!converted&&m.role!=='precision-waiting-pass')fail('unfulfilled-forcing-obligation');
   if(converted&&last&&last.call.strain!=='NT'&&(lengths[last.call.strain]<6||ranks(last.call.strain).filter(r=>r>=11).length<2||quickTricks(obs.hand.filter(c=>c.suit!==last.call.strain))<1))fail('penalty-conversion-defense');
   if(!explicitNegative&&p&&last?.seat===p.seat&&p.call.level<gameLevel(p.call.strain)&&!publicCallMeaningAt(obs.auction,p.index,system).artificial){
    const publicGame=p.call.strain==='NT'?hcp+(partner.hcpRange?.min??0)>=25
     : lengths[p.call.strain]+partner.suitMinimums[p.call.strain]>=8&&evaluateSuitFit(obs.hand,p.call.strain,partner.suitMinimums[p.call.strain]).totalPoints+publicSupportMinimum(p.call.strain,lengths[p.call.strain],partner)>=(isMajor(p.call.strain)?25:29);
    if(publicGame)fail('explicit-public-game-strength');
   }
  }
  if(call.kind==='double'){
   const doubleKind=classifyDoubleAt(prefix,obs.auction.length,system);
   if(doubleKind==='takeout'){
    const t=publicTakeoutDoubleAt(prefix,obs.auction.length,system);
    if(!t)fail('unclassified-takeout');
    else{
     const strongException=hcp>=17&&['direct','balancing','sandwich','repeat'].includes(t.kind);
     const needed=t.kind==='responsive'?4:3;
     const enemyBid=obs.auction[t.targetIndex].call;
     if(hcp===12&&t.kind==='direct'&&enemyBid.kind==='bid'&&enemyBid.level===2&&!(lengths[t.target]<=1&&t.unbidSuits.every(s=>lengths[s]>=4)))fail('weak-two-takeout-twelve-point-exception');
     const shortEnemy=lengths[t.target]<=2;
     if(!strongException&&(!shortEnemy||t.preferredSuits.some(s=>lengths[s]<needed)))fail('takeout-shape');
    }
   }else if(doubleKind==='penalty'){
    if(last?.call.strain==='NT'){
     if(last.call.level===1&&(hcp<15||quickTricks(obs.hand)<3))fail('nt-penalty-defense');
     else if(last.call.level>1&&(hcp<12||quickTricks(obs.hand)<3))fail('high-nt-penalty-defense');
    }else if(last){
     const s=last.call.strain;
     if(lengths[s]<4||ranks(s).filter(r=>r>=11).length<2||quickTricks(obs.hand)<2||hcp<10)fail('penalty-trump-defense');
    }
   }else if(doubleKind==='lead-directing'&&last&&last.call.strain!=='NT'){
    const r=ranks(last.call.strain),q=r.filter(x=>x>=10).length;
    if(hcp<8||!(r.length>=3&&r.includes(14)&&r.includes(13)||r.length>=4&&q>=3&&r.some(x=>x>=12)||r.length>=5&&r.includes(12)&&r.some(x=>x===14||x===13||x===11)))fail('lead-double-quality');
   }
  }
  if(call.kind!=='pass'){
   if(m.weakMinorRelayQualification){const q=m.weakMinorRelayQualification;
    if(!q.suits.some(s=>lengths[s]>=q.minLength))fail('weak-minor-relay-length-alternative');}
   if(boundary&&hcp<=boundary.maxHcp&&!boundaryGameQualified)fail('nt-boundary-game-qualification');
   if(m.preemptNTResources){const q=m.preemptNTResources,r=ranks(q.sourceSuit);
    const queens=r.filter(x=>x>=12).length,tens=r.filter(x=>x>=10).length;
    const entry=SUITS.some(s=>s!==q.sourceSuit&&(ranks(s).includes(14)||ranks(s).includes(13)&&lengths[s]>=2));
    const ordinary=hcp>=q.strongHcp&&r.length>=q.minCashableLength&&queens>=2&&tens>=3;
    const cashable=hcp>=q.cashableHcp&&r.length>=q.minCashableLength&&[14,13,12].every(x=>r.includes(x))
     &&queens>=q.minSourceTopHonors&&tens>=q.minSourceTenHonors;
    const funded=hcp+q.partnerHcpMinimum>=25&&r.length>=5&&queens>=2&&tens>=3;
    if(hcp<q.minHcp||!entry||!(ordinary||cashable||funded))fail('preempt-nt-playing-resources');
   }
   const comp=m.playingSourceCompensation;
   let compensated=false;
   if(comp){
    const r=ranks(comp.suit);const k=r.filter(x=>x>=13).length,q=r.filter(x=>x>=12).length,t=r.filter(x=>x>=10).length;
    const ordinary=hcp>=comp.normalHcpMinimum&&k>=(comp.normalMinKingOrAce??0)&&q>=(comp.normalMinQueenOrHigher??0)&&t>=(comp.normalMinTenOrHigher??0);
    compensated=hcp>=comp.minHcp&&r.length>=comp.minLength&&k>=comp.minKingOrAce&&q>=comp.minQueenOrHigher&&t>=comp.minTenOrHigher&&(!comp.maxOtherSuitLength||lengths[comp.maxOtherSuitLength.suit]<=comp.maxOtherSuitLength.max);
    const ex=comp.extraLongAlternative;
    compensated ||= !!ex&&hcp>=ex.minHcp&&r.length>=ex.minLength&&k>=ex.minKingOrAce&&q>=ex.minQueenOrHigher&&t>=ex.minTenOrHigher;
    if(!ordinary&&!compensated)fail('playing-source-qualification');
   }
   const min=m.hcpRange?.min,max=m.hcpRange?.max;
   if(system==='precision'&&m.roleLabel==='精确限制开叫的形状逆叫'&&(hcp<14||hcp>15))fail('precision-reverse-hcp');
   const newMin=min!==undefined&&(min>(own.hcpRange?.min??-1)||m.invitation||ownBids.length===0);
   const newMax=max!==undefined&&(max<(own.hcpRange?.max??41)||m.invitation||ownBids.length===0);
   if(newMin&&hcp<min!&&!compensated)fail('hcp-minimum');
   if(newMax&&hcp>max!)fail('hcp-maximum');
   if(SUITS.some(s=>lengths[s]<(m.suitMinimums[s]??0)))fail('natural-suit-minimum');
   if(SUITS.some(s=>lengths[s]>(m.suitMaximums?.[s]??13)))fail('natural-suit-maximum');
   if(m.strictBalancedShapeFamily&&!m.strictBalancedShapeFamily.includes(shape as any))fail('strict-nt-shape');
   if(m.allowedShapeFamily&&!m.allowedShapeFamily.includes(shape as any))fail('allowed-shape-family');
   if(m.supportRange){const q=m.supportRange;const v=evaluateSuitFit(obs.hand,q.trump,partner.suitMinimums[q.trump]).totalPoints;
    if(v<q.min||v>q.max)fail('support-point-range');}
   if(m.controlSuits&&SUITS.some(s=>m.controlSuits?.[s]&&!control(s)))fail('control-promise');
   if(m.stopperSources.some(source=>source.seat===obs.seat&&source.index===obs.auction.length&&!stopper(source.suit)))fail('nt-stopper');
  }
  if(call.kind==='bid'){
   if(system==='precision'&&m.role==='precision-opening'&&call.level===2&&call.strain==='C'
    &&!(lengths.C>=6||lengths.C===5&&(lengths.H===4||lengths.S===4)))fail('precision-club-shape');
   if(m.role==='natural-opening'&&call.strain!=='NT'&&call.level>=2&&obs.auction.every(e=>e.call.kind==='pass')){
    const r=ranks(call.strain),position=obs.auction.length+1;
    if(call.level===2&&call.strain!=='C'){
     if(r.filter(x=>x>=10).length<2||!r.some(x=>x>=12))fail('weak-two-suit-quality');
     const otherMajors=(['H','S'] as Suit[]).filter(x=>x!==call.strain);
     if(position<=2&&otherMajors.some(x=>lengths[x]>=4)||position===3&&otherMajors.some(x=>lengths[x]>=5)||position>=4)fail('weak-two-position-shape');
    }
    if(call.level===3&&!r.some(x=>x>=12))fail('three-level-preempt-quality');
   }
   if(m.role==='natural-opening'&&call.level===1&&call.strain!=='NT'&&system==='sayc'){
    const longest=Object.values(lengths).sort((a,b)=>b-a);if(hcp<13&&!(hcp===12&&hcp+longest[0]+longest[1]>=20))fail('rule-of-20-opening');
   }
   if(m.minorInvitationShape){const q=m.minorInvitationShape;if(!(lengths[q.primary]>=q.ordinaryLength||lengths[q.primary]>=5&&lengths[q.secondary]>=q.secondaryMinimum&&lengths[q.originalMajor]<=q.maxOriginal))fail('minor-invitation-shape');}
   if(m.longMinorNTAlternative&&!['4333','4432','5332'].includes(shape)){
    const q=m.longMinorNTAlternative,r=ranks(q.suit);const seven=hcp>=q.minHcp&&r.length>=q.minLength&&[14,13,12].every(x=>r.includes(x))&&obs.hand.filter(c=>c.suit!==q.suit&&c.rank===14).length>=q.minSideAces;
    const z=q.sixCardSource;const six=!!z&&hcp>=z.minHcp&&r.length>=z.minLength&&(r.includes(14)&&r.includes(13)||r.includes(14)&&r.includes(12)&&shape==='6322'||r.filter(x=>x>=12).length>=z.alternativeMinQueenHigher&&r.filter(x=>x>=10).length>=z.alternativeMinTenHigher)&&SUITS.filter(s=>s!==q.suit&&ranks(s).some(x=>x>=13)).length>=z.minSideAKSuits;
    if(!seven&&!six)fail('nt-long-minor-source');
   }
   if(m.selfLongGameQualification){const q=m.selfLongGameQualification;
    const normal=hcp>=q.normalHcpMinimum&&lengths[q.primarySuit]>=q.minPrimaryLength;
    const ex=q.allowEighteenException&&hcp>=q.minHcp&&lengths[q.primarySuit]>=q.minPrimaryLength&&lengths[q.secondarySuit]>=q.minSecondaryLength&&quickTricks(obs.hand)>=q.minQuickTricks&&losingTricks(obs.hand)<=q.maxLosingTricks&&SUITS.filter(s=>s!==q.primarySuit).every(control);
    if(!normal&&!ex)fail('independent-major-game');
   }
   if(m.role==='keycard-answer'&&trump){if(!sameCall(call,rkcb1430Response(countKeycards(obs.hand,trump),hasTrumpQueen(obs.hand,trump))))fail('rkcb-exact-keycard-answer');}
   if(m.role==='king-answer'&&trump){
    const lowest=SUITS.map(s=>bid(6,s)).find(c=>c.strain!==trump&&bidValue(c)<bidValue(bid(6,trump))&&ranks(c.strain as Suit).includes(13))??bid(6,trump);
    if(!sameCall(call,lowest))fail('lowest-safe-side-king-answer');
   }
   if(m.role==='queen-answer'&&trump){
    const sideKing=SUITS.map(s=>bid(6,s)).find(c=>c.strain!==trump&&bidValue(c)<bidValue(bid(6,trump))&&authoritative.some(a=>sameCall(a,c))&&ranks(c.strain as Suit).includes(13));
    const expected=hasTrumpQueen(obs.hand,trump)?sideKing??bid(6,trump):bid(5,trump);
    if(!sameCall(call,expected))fail('queen-exact-answer');
   }
   if(m.role==='keycard-ask'){
    const tr=m.agreedTrump??publicKeycardTrumpAt(prefix,obs.auction.length,system) as Suit|undefined;
    if(!tr||lengths[tr]+partner.suitMinimums[tr]<8)fail('keycard-without-public-fit');
    else {
     if(SUITS.filter(s=>s!==tr).some(s=>!control(s)&&!partner.controlSuits?.[s]&&(partner.suitMaximums?.[s]??13)>1))fail('keycard-missing-side-control');
     if(evaluateSuitFit(obs.hand,tr,partner.suitMinimums[tr]).totalPoints+publicSupportMinimum(tr,lengths[tr],partner)<33)fail('keycard-slam-strength');
     if(!ranks(tr).some(x=>x>=12)&&lengths[tr]>=5)fail('keycard-trump-anchor');
    }
   }
   if(m.role==='king-ask'&&trump){
    const answer=naturalBids.findLast(e=>e.seat===partnerOf(obs.seat)&&publicCallMeaningAt(obs.auction,e.index,system).role==='keycard-answer');
    const queenAnswer=naturalBids.findLast(e=>e.seat===partnerOf(obs.seat)&&publicCallMeaningAt(obs.auction,e.index,system).role==='queen-answer');
    if(answer){const am=publicCallMeaningAt(obs.auction,answer.index,system);let possible:number[]=[];
     if(am.role==='keycard-answer')possible=answer.call.strain==='C'?[1,4]:answer.call.strain==='D'?[0,3]:[2,5];
     const total=countKeycards(obs.hand,trump);
     if(possible.length){const prior=keys?publicPlayerConstraints(obs.auction.slice(0,keys.index),partnerOf(obs.seat),system):partner;const feasible=feasiblePublicKeycardCounts(obs.hand,trump,prior,possible);if(!feasible.length||!feasible.every(k=>k+total===5))fail('king-ask-without-all-keycards');}
     const queenKnown=hasTrumpQueen(obs.hand,trump)||!!queenAnswer&&!(queenAnswer.call.level===5&&queenAnswer.call.strain===trump)||am.role==='keycard-answer'&&answer.call.strain==='S';
     if(!queenKnown)fail('king-ask-without-trump-queen');
    }else fail('king-ask-without-keycard-reply');
   }
   if(keys&&keys.seat===obs.seat&&trump&&call.strain===trump&&call.level>=6&&!m.artificial&&!['keycard-answer','queen-answer','king-answer'].includes(m.role)){
    const answer=naturalBids.findLast(e=>e.seat===partnerOf(obs.seat)&&publicCallMeaningAt(obs.auction,e.index,system).role==='keycard-answer');
    if(answer){
     const possible=answer.call.strain==='C'?[1,4]:answer.call.strain==='D'?[0,3]:[2,5];
     const prior=publicPlayerConstraints(obs.auction.slice(0,keys.index),partnerOf(obs.seat),system),feasible=feasiblePublicKeycardCounts(obs.hand,trump,prior,possible),ours=countKeycards(obs.hand,trump);
     const qAnswer=naturalBids.findLast(e=>e.seat===partnerOf(obs.seat)&&publicCallMeaningAt(obs.auction,e.index,system).role==='queen-answer');
     const q=hasTrumpQueen(obs.hand,trump)||answer.call.strain==='S'||!!qAnswer&&!(qAnswer.call.level===5&&qAnswer.call.strain===trump);
     if(!feasible.length||feasible.some(k=>k+ours<(call.level===7?5:4)))fail('slam-missing-keycards');
     if(!q&&!(call.level===6&&lengths[trump]+partner.suitMinimums[trump]>=10&&feasible.length&&feasible.every(k=>k+ours===5)))fail('slam-missing-trump-queen');
     if(call.level===7&&evaluateSuitFit(obs.hand,trump,partner.suitMinimums[trump]).totalPoints+publicSupportMinimum(trump,lengths[trump],partner)<37)fail('grand-slam-without-thirteen-trick-basis');
    }
   }
   if(m.jointSupportFloor){const q=m.jointSupportFloor;const val=evaluateSuitFit(obs.hand,q.trump,partner.suitMinimums[q.trump]).totalPoints+publicSupportMinimum(q.trump,lengths[q.trump],partner);
    if(val<q.total)fail('joint-support-minimum');}
   if(call.strain==='NT'&&!m.artificial&&call.level===4&&m.intent!=='invitation')fail('unsupported-natural-four-nt');
   if(call.strain==='NT'&&!m.artificial&&call.level===5&&m.intent!=='grand-inv')fail('unsupported-natural-five-nt');
   if(call.strain==='NT'&&!m.artificial&&((call.level===4&&m.intent==='invitation')||(call.level===5&&m.intent==='grand-inv'))){
    const platform=quantitativeNoTrumpPlatformBefore(prefix,obs.auction.length,system),range=platform&&noTrumpRangeAt(obs.auction,platform.index,system);
    const unfunded=!!range&&(call.level===4 ? hcp<quantitativeSmallInvitationMinimum(range)
      : hcp+range.min<35||hcp+range.max<37);
    if(!platform||platform.seat!==partnerOf(obs.seat)||!range||unfunded||Object.values(lengths).some(x=>x<2))fail('quantitative-invitation-platform');
   }
   if(call.strain==='NT'&&!m.artificial&&call.level>=6){
    if(hcp+(partner.hcpRange?.min??0)<(call.level===7?37:33)&&!(p?.call.level===5&&p.call.strain==='NT'&&publicCallMeaningAt(obs.auction,p.index,system).intent==='grand-inv'&&call.level===6))fail('quantitative-slam-strength');
   }
   if(!exactInquiryAnswer&&!m.artificial&&m.forcing==='none'&&call.level<gameLevel(call.strain)&&p&&last?.seat===p.seat){
    const tr=call.strain;const ntGame=p.call.strain==='NT'&&hcp+(partner.hcpRange?.min??0)>=25;
    const suitGame=tr!=='NT'&&lengths[tr]+partner.suitMinimums[tr]>=8&&evaluateSuitFit(obs.hand,tr,partner.suitMinimums[tr]).totalPoints+publicSupportMinimum(tr,lengths[tr],partner)>=(isMajor(tr)?25:29);
    if(ntGame||suitGame||knownGameFits.length)fail('underbid-explicit-public-game');
   }
   if(call.strain!=='NT'&&!m.artificial&&call.level>=gameLevel(call.strain)&&call.level<6&&!before.mustBid&&!m.selfLongGameQualification&&!boundaryGameQualified&&lengths[call.strain]+partner.suitMinimums[call.strain]>=8&&supportTotal(call.strain)<(isMajor(call.strain)?25:29))fail('unsupported-suit-game-strength');
   if(call.strain!=='NT'&&!m.artificial&&call.level>=6&&m.role!=='keycard-signoff'&&!['keycard-answer','queen-answer','king-answer'].includes(m.role)&&!(keys&&call.strain===trump)){
    if(lengths[call.strain]+partner.suitMinimums[call.strain]<8)fail('slam-without-public-fit');
    if(evaluateSuitFit(obs.hand,call.strain,partner.suitMinimums[call.strain]).totalPoints+publicSupportMinimum(call.strain,lengths[call.strain],partner)<(call.level===7?37:33))fail('slam-support-strength');
   }
  }
  return {call,action:callToAction(call),allowed:reasons.length===0,reasons,meaning:m};
 });
}
/** Preserve raw logits. Semantic restrictions never add probabilities or retrain weights. */
export function chooseConstrainedBid(obs:BiddingObservation,model:NeuralModel,system:BiddingSystem='sayc'):AdaptedDecision {
 const {logits}=infer(model,encodeObservation(obs));
 if(logits.length!==38||Array.from(logits).some(x=>!Number.isFinite(x)))throw new Error('Non-finite SL logits');
 const candidates=assessCandidates(obs,system),ranked=[...candidates].sort((a,b)=>logits[b.action]-logits[a.action]||a.action-b.action);
 const allowed=ranked.filter(c=>c.allowed);if(!allowed.length)throw new CandidateExhaustion(candidates);
 const chosen=allowed[0],max=Math.max(...Array.from(logits)),weights=Array.from(logits,x=>Math.exp(x-max)),total=weights.reduce((a,b)=>a+b,0);
 return {call:chosen.call,action:chosen.action,rawLegalAction:ranked[0].action,route:'sl-constrained',logits:Array.from(logits),filtered:chosen.action!==ranked[0].action,allowedCount:allowed.length,retainedProbabilityMass:allowed.reduce((sum,c)=>sum+weights[c.action],0)/total,candidates,meaning:describeCall(obs.auction,obs.seat,chosen.call,system)};
}




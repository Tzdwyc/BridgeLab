import {describe,it,expect} from 'vitest';
import{auction,obs,meaning,text,call}from'./precision-fixtures';
import{decidePrecisionBid,diagnosePrecisionBid}from'../src/ai/precision';
import{assessCandidates}from'../src/ai/constrained-sl';
import{analyzeAuctionSemantics,publicPlayerConstraints,publicNoTrumpQuestionAt,classifyDoubleAt,publicCallMeaningAt,naturalSuitMinimum,isArtificialBidAt}from'../src/ai/bidding-semantics';
const candidate=(a:string,h:Parameters<typeof obs>[1],c:string)=>assessCandidates(obs(a,h),'precision').find(x=>text(x.call)===c)!;
describe('Precision closed public obligations',()=>{
 it.each([
  ['1C P 1D 1S',{S:'962',H:'A52',D:'AKJ3',C:'AK9'},'2D'],
  ['1C 1S P 2S',{S:'932',H:'AK75',D:'AK6',C:'K92'},'3H'],
  ['1C 1S P 2C',{S:'A53',H:'AKJ5',D:'KJ75',C:'T7'},'2H'],
 ]as const)('describes a real first four-card suit after%s',(a,h,c)=>{
  expect(candidate(a,h,c).allowed).toBe(true);
  expect(meaning(a,c)).toMatchObject({artificial:false,hcpRange:{min:16,max:40},suitMinimums:{[c.slice(1)]:4}});
  expect(candidate(a,h,'P').allowed).toBe(false);
  const d=diagnosePrecisionBid(obs(a,h));expect(d.status).toBe('supported');
  if(d.status==='supported')expect(d.candidates.find(x=>text(x.call)===text(d.call))?.allowed).toBe(true);
  const updated=auction(a+' '+c);expect(publicPlayerConstraints(updated,'N','precision').suitMinimums[c.slice(1)as'H'|'D']).toBe(4);
 });
 it('does not turn3real cards into4or eliminate natural NT stopper checks',()=>{
  const h={S:'962',H:'A52',D:'AKJ3',C:'AK9'};
  expect(candidate('1C P 1D 1S',h,'2C').allowed).toBe(false);
  expect(candidate('1C P 1D 1S',h,'2NT').allowed).toBe(false);
  expect(candidate('1C P 1D 1S',h,'X').allowed).toBe(false);
 });
 it('carries the active system through technical doubles of natural Precision2C',()=>{
  const h={S:'JT92',H:'J742',D:'Q65',C:'A7'};
  const a=auction('P 2C X P');expect(classifyDoubleAt(a,2,'precision')).toBe('takeout');
  expect(classifyDoubleAt(a,2,'sayc')).toBe('lead-directing');
  expect(analyzeAuctionSemantics(a,'N','precision')).toMatchObject({mustBid:true,convention:'takeout-response'});
  expect(meaning('P 2C X P','2H')).toMatchObject({role:'takeout-minimum-response',hcpRange:{min:0,max:40},suitMinimums:{H:3}});
  expect(candidate('P 2C X P',h,'2H').allowed).toBe(true);
  expect(candidate('P 2C X P',h,'P').allowed).toBe(false);
  expect(decidePrecisionBid(obs('P 2C X P',h)).kind).toBe('bid');
 });
 it.each([['2S P 2NT P 3H P','3S'],['2H P 2NT P 3S P','4H']]as const)('requires a real contract after feature information:%s',(a,c)=>{
  const h={S:'Q32',H:'AJ4',D:'KQJ2',C:'K32'},o=obs(a,h);
  const state=analyzeAuctionSemantics(o.auction,o.seat,'precision');expect(state).toMatchObject({mustBid:true,currentContractArtificial:true,convention:'artificial-answer'});
  expect(candidate(a,h,'P').allowed).toBe(false);
  const d=diagnosePrecisionBid(o);expect(d.status).toBe('supported');if(d.status==='supported')expect(d.call.kind).toBe('bid');
  expect(analyzeAuctionSemantics(auction(a+' P P P P'),o.seat,'precision')).toMatchObject({mustBid:true,currentContractArtificial:true});
 });
 it('retains the approved real1NT Stayman2D NF exception',()=>{
  const a=auction('1D P P 1NT P 2C P 2D P'),h={S:'A975',H:'AK5',D:'J762',C:'87'},o=obs('1D P P 1NT P 2C P 2D P',h);
  expect(analyzeAuctionSemantics(a,o.seat,'precision')).toMatchObject({mustBid:false,forcing:'none'});
  const question=publicNoTrumpQuestionAt(a,5,'precision');expect(question).toMatchObject({kind:'stayman',platform:{call:call('1NT')}});
  expect(publicCallMeaningAt(a,7,'precision')).toMatchObject({role:'stayman-answer',artificial:true});
  expect(candidate('1D P P 1NT P 2C P 2D P',h,'P').allowed).toBe(true);
  expect(analyzeAuctionSemantics(auction('2NT P 3C P 3D P'),'S','precision').mustBid).toBe(true);
 });
 it('does not reinterpret an enemy-suit cue as transfer without a true NT-question platform',()=>{
  const a='1C 1D P 1S 2NT P',h={S:'T9',H:'KJ875',D:'T43',C:'Q64'};
  const hypothetical=auction(a+' 3D');
  expect(publicNoTrumpQuestionAt(hypothetical,hypothetical.length-1,'precision')).toBeUndefined();
  const m=meaning(a,'3D');expect(m.role).not.toBe('transfer');expect(m.suitMinimums.H).toBeUndefined();
  expect(candidate(a,h,'3D').allowed).toBe(false);
  const d=diagnosePrecisionBid(obs(a,h));expect(d.status).toBe('supported');
 });
 it('preserves genuine bounded strong-club NT transfer membership and exact reply',()=>{
  const a='1C P 1D P 2NT P';
  expect(meaning(a,'3D')).toMatchObject({role:'transfer',suitMinimums:{H:5}});
  const withQuestion=auction(a+' 3D P');
  expect(publicNoTrumpQuestionAt(withQuestion,6,'precision')).toMatchObject({kind:'transfer',target:'H'});
  expect(analyzeAuctionSemantics(withQuestion,'N','precision')).toMatchObject({mustBid:true});
  expect(meaning(a+' 3D P','3H')).toMatchObject({role:'transfer-acceptance'});
 });

 it('keeps the natural weak-two public5–11 floor while Precision remains6–10',()=>{
  const a=auction('2S');
  for(const system of ['sayc','two-over-one']as const)
   expect(publicCallMeaningAt(a,0,system).hcpRange).toEqual({min:5,max:11});
  expect(publicCallMeaningAt(a,0,'precision').hcpRange).toEqual({min:6,max:10});
 });

 it('shares limited-reverse original-five evidence across every public API and game support',()=>{
  const a='P 1D P 2D P 2H P',h={S:'QJ9',H:'K2',D:'QT432',C:'853'},aa=auction(a);
  expect(publicPlayerConstraints(aa,'E','precision').suitMinimums.D).toBe(5);
  expect(naturalSuitMinimum(aa,'E','D','precision')).toBe(5);
  expect(meaning(a,'5D')).toMatchObject({suitMinimums:{D:5},artificial:false});
  expect(candidate(a,h,'5D').allowed).toBe(true);
  expect(decidePrecisionBid(obs(a,h))).toEqual(call('5D'));
 });
 it('lets5–7 negative responders describe a lowest real five-card major without becoming8+',()=>{
  const a='1C P 1D P 2D P',h={S:'986',H:'AQ432',D:'2',C:'9872'};
  expect(meaning(a,'2H')).toMatchObject({hcpRange:{min:5,max:7},suitMinimums:{H:5},artificial:false,forcing:'one-round'});
  expect(candidate(a,h,'2H').allowed).toBe(true);
  expect(decidePrecisionBid(obs(a,h))).toEqual(call('2H'));
  expect(candidate(a,{S:'9862',H:'AQ43',D:'2',C:'9872'},'2H').allowed).toBe(false);
  expect(candidate(a,{S:'986',H:'AT432',D:'2',C:'9872'},'2H').allowed).toBe(false);
 });

 it('allows the lowest real eight-card support after a5–7negative without an extra invitation',()=>{
  const a='1C P 1D P 2C P',h={S:'JT62',H:'A74',D:'T2',C:'JT73'};
  expect(meaning(a,'3C')).toMatchObject({role:'natural-support',hcpRange:{min:5,max:7},suitMinimums:{C:4},forcing:'none',invitation:false});
  expect(candidate(a,h,'3C').allowed).toBe(true);
  expect(diagnosePrecisionBid(obs(a,h)).status).toBe('supported');
  expect(candidate(a,{S:'JT62',H:'A74',D:'T92',C:'JT7'},'3C').allowed).toBe(false);
  expect(candidate(a,{S:'JT62',H:'T74',D:'T2',C:'JT73'},'3C').allowed).toBe(false);
 });
 it.each(['1S 1NT P 2H P 2S','1H 1NT P 2D P 2H'])('treats a genuine transferred enemy suit as a natural acceptance:%s',a=>{
  const aa=auction(a),index=aa.length-1;
  expect(publicCallMeaningAt(aa,index,'precision').role).toBe('transfer-acceptance');
  expect(isArtificialBidAt(aa,index,'precision')).toBe(false);
  const seat=aa[index].seat,suit=aa[index].call.kind==='bid'?aa[index].call.strain as'H'|'S':'S';
  expect(naturalSuitMinimum(aa,seat,suit,'precision')).toBe(2);
  expect(analyzeAuctionSemantics(auction(a+' P P P'),seat,'precision').currentContractArtificial).toBe(false);
 });
 it('keeps an enemy-suit cue artificial without a genuine transfer question',()=>{
  const aa=auction('1S 2C P 2S');
  expect(isArtificialBidAt(aa,aa.length-1,'precision')).toBe(true);
 });
});

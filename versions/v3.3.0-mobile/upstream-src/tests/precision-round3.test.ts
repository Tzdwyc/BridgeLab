import {describe,it,expect} from 'vitest';
import {diagnosePrecisionBid} from '../src/ai/precision';
import {describeCall,evaluateHand} from '../src/ai/bidding';
import {assessCandidates} from '../src/ai/constrained-sl';
import {analyzeAuctionSemantics,publicPlayerConstraints,clearPublicMeaningCaches,publicCallMeaningAt,isArtificialBidAt} from '../src/ai/bidding-semantics';
import {auction,obs,meaning,call,text,allCalls} from './precision-fixtures';
const nine={S:'4',H:'5432',D:'AQ65',C:'K872'},weak={S:'432',H:'432',D:'432',C:'5432'};
const strong={S:'AKJ43',H:'A32',D:'K65',C:'K2'},reverse={S:'Q2',H:'AK43',D:'KJ765',C:'J2'};
const candidate=(a:string,h:Parameters<typeof obs>[1],c:string)=>assessCandidates(obs(a,h),'precision').find(x=>text(x.call)===c)!;
describe('round3 approved precision agreements',()=>{
 it.each(['1C 1H','1C 2H','P P 1C 1H'])('lowest enemy cue is artificial 8+ GF: %s',a=>{
  const c=a.includes('2H')?'3H':'2H',m=meaning(a,c);
  expect(m).toMatchObject({role:'precision-positive',artificial:true,forcing:'game',hcpRange:{min:8,max:a.startsWith('P')?12:40},suitMinimums:{},stopperSources:[]});
  const o=obs(a,nine);expect(o.hand).toHaveLength(13);expect(evaluateHand(o.hand).hcp).toBe(9);
  expect(diagnosePrecisionBid(o)).toMatchObject({status:'supported',call:call(c)});
  expect(candidate(a,weak,c).allowed).toBe(false);expect(candidate(a,nine,'P').allowed).toBe(false);
 });
 it.each(['1C X','P P 1C X'])('doubled strong club has negative / positive split: %s',a=>{
  expect(diagnosePrecisionBid(obs(a,weak))).toMatchObject({status:'supported',call:call('1D')});
  expect(diagnosePrecisionBid(obs(a,nine))).toMatchObject({status:'supported',call:call('XX')});
  expect(meaning(a,'1D')).toMatchObject({artificial:true,hcpRange:{min:0,max:7},suitMinimums:{},forcing:'one-round'});
  expect(meaning(a,'XX')).toMatchObject({artificial:true,hcpRange:{min:8,max:a.startsWith('P')?12:40},suitMinimums:{},stopperSources:[],forcing:'game'});
  for(const c of ['P','1NT','2NT','4NT'])expect(meaning(a,c).defined).toBe(false);
  expect(candidate(a,weak,'XX').allowed).toBe(false);expect(candidate(a,nine,'1D').allowed).toBe(false);
 });
 it.each([
  ['1H',{S:'432',H:'AKJ43',D:'765',C:'32'}],
  ['1S',{S:'AKJ43',H:'432',D:'765',C:'32'}],
  ['2C',{S:'432',H:'765',D:'32',C:'AKJ43'}],
  ['2D',{S:'432',H:'765',D:'AKJ43',C:'32'}],
 ] as const)('doubled strong club preserves natural five-card %s',(c,h)=>{
  expect(diagnosePrecisionBid(obs('1C X',h))).toMatchObject({status:'supported',call:call(c)});
  expect(meaning('1C X',c)).toMatchObject({artificial:false,forcing:'game',hcpRange:{min:8,max:40}});
 });
 it('keeps own five-card positive and penalty X',()=>{
  expect(diagnosePrecisionBid(obs('1C X',{S:'AKJ43',H:'432',D:'765',C:'32'}))).toMatchObject({status:'supported',call:call('1S')});
  expect(meaning('1C X','1S')).toMatchObject({suitMinimums:{S:5},forcing:'game'});
  expect(candidate('1C X',nine,'1H').allowed).toBe(false);
  expect(diagnosePrecisionBid(obs('1C 1H',{S:'4',H:'AKQJ',D:'8765',C:'5432'}))).toMatchObject({status:'supported',call:call('X')});
 });
 it.each(['1C 1H 2H P','1C X XX P','1C X XX 1H'])('artificial response requires real minimum opener answer: %s',a=>{
  const expected=a.startsWith('1C 1H')?'2S':'1S';
  expect(diagnosePrecisionBid(obs(a,strong))).toMatchObject({status:'supported',call:call(expected)});
  expect(meaning(a,expected)).toMatchObject({role:'precision-natural-answer',artificial:false,suitMinimums:{S:4},hcpRange:{min:16,max:40},forcing:'game'});
  expect(candidate(a,strong,'P').allowed).toBe(false);
 });
 it('three-level pressure selects a qualified stopped 3NT without widening point window',()=>{
  expect(diagnosePrecisionBid(obs('1C 2H 3H P',strong))).toMatchObject({status:'supported',call:call('3NT')});
  expect(meaning('1C 2H 3H P','3NT').stopperSources).toContainEqual({suit:'H',seat:'N',index:4});
  expect(meaning('1C 2H 3H P','3NT').hcpRange?.min).toBe(16);
 });
 it('GF survives after natural answer and ends only at natural game',()=>{
  for(const a of ['1C X XX P 1S P','1C 1H 2H P 2S P']){
   expect(analyzeAuctionSemantics(auction(a),'S','precision')).toMatchObject({forcing:'game',mustBid:true,currentContractArtificial:false});
   expect(candidate(a,nine,'P').allowed).toBe(false);
  }
  expect(analyzeAuctionSemantics(auction('1C X XX P 1S P 3NT P'),'N','precision')).toMatchObject({forcing:'none',mustBid:false});
  expect(publicPlayerConstraints(auction('1C X XX P 1S P'),'S','precision')).toMatchObject({hcpRange:{min:8,max:40},suitMinimums:{S:0,H:0,D:0,C:0}});
 });
 it('negative after X preserves weak stop and has no automatic GF',()=>{
  expect(candidate('1C X 1D P',strong,'P').allowed).toBe(false);
  expect(diagnosePrecisionBid(obs('1C X 1D P 1S P',weak))).toMatchObject({status:'supported',call:call('P')});
  expect(analyzeAuctionSemantics(auction('1C X 1D P 1S P'),'S','precision').forcing).toBe('none');
 });
 it.each(['1C 1NT','1C 3H','1C X XX 2NT','1C X XX 3H','1C X 1D 3H','1C 1H 2H 3D'])('v3 closes NT / high interference with qualified natural candidates: %s',a=>{
  const d=diagnosePrecisionBid(obs(a,strong));expect(d.status).toBe('supported');
  expect(d.candidates.some(c=>c.allowed)).toBe(true);
  if(d.status==='supported')expect(d.candidates.find(c=>text(c.call)===text(d.call))?.allowed).toBe(true);
 });
 it.each([13,14,15,16])('limited reverse checks actual %i HCP',hcp=>{
  const hands:Record<number,Parameters<typeof obs>[1]>={13:{...reverse,C:'32'},14:reverse,15:{...reverse,C:'Q2'},16:{...reverse,C:'K2'}};
  expect(evaluateHand(obs('1D P 1S P',hands[hcp]).hand).hcp).toBe(hcp);
  expect(candidate('1D P 1S P',hands[hcp],'2H').allowed).toBe(hcp>=14&&hcp<=15);
  if(hcp===14||hcp===15)expect(diagnosePrecisionBid(obs('1D P 1S P',hands[hcp]))).toMatchObject({status:'supported',call:call('2H')});
 });
 it('reverse requires original five / new four, and retains public 14–15 after answers',()=>{
  expect(meaning('1D P 1S P','2H')).toMatchObject({hcpRange:{min:14,max:15},suitMinimums:{D:5,H:4},forcing:'one-round'});
  expect(candidate('1D P 1S P',{S:'Q32',H:'AK43',D:'KJ76',C:'J2'},'2H').allowed).toBe(false);
  expect(candidate('1D P 1S P',{S:'Q32',H:'AK4',D:'KJ765',C:'J2'},'2H').allowed).toBe(false);
  for(const answer of ['3D','2NT']){
   const a='1D P 1S P 2H P '+answer+' P';
   expect(analyzeAuctionSemantics(auction(a),'N','precision').mustBid).toBe(false);
   expect(diagnosePrecisionBid(obs(a,reverse))).toMatchObject({status:'supported',call:call('P')});
   expect(publicPlayerConstraints(auction(a),'N','precision')).toMatchObject({hcpRange:{min:14,max:15},suitMinimums:{D:5,H:4}});
   expect(describeCall(auction('1D P 1S P 2H P'),'S',call(answer),'precision')).not.toContain('17');
  }
 });
 it.each([['1D P 2C P','2H','D','H'],['1H P 2C P','2S','H','S'],['1H P 2D P','2S','H','S']])('two-level natural response retains approved precision reverse %s',(a,c,original,newSuit)=>{
  expect(meaning(a,c)).toMatchObject({hcpRange:{min:14,max:15},suitMinimums:{[original]:5,[newSuit]:4},forcing:'one-round'});
  expect(analyzeAuctionSemantics(auction(a+' '+c+' P'),'S','precision').mustBid).toBe(true);
 });
 it('under pressure real four-card low suit and 24-point existing GF minor game stay available',()=>{
  const a='1C 2H 3H P 3S P',eight={S:'4',H:'J432',D:'A765',C:'K872'};
  expect(meaning(a,'4C')).toMatchObject({artificial:false,suitMinimums:{C:4},hcpRange:{min:8,max:40},forcing:'game'});
  expect(diagnosePrecisionBid(obs(a,eight))).toMatchObject({status:'supported',call:call('4C')});
  expect(candidate(a,eight,'3NT').allowed).toBe(false);
  const minimum={S:'KQT83',H:'76',D:'KJ',C:'AQJ9'};
  expect(evaluateHand(obs(a,minimum).hand).hcp).toBe(16);
  expect(diagnosePrecisionBid(obs(a+' 4C P',minimum))).toMatchObject({status:'supported',call:call('5C')});
  expect(meaning(a+' 4C P','5C').suitMinimums.C).toBe(4);
 });
 it('limited jump shift is14–15 with real5+4, while unfunded high jumps are rejected',()=>{
  expect(meaning('1D P 1S P','3H')).toMatchObject({defined:true,hcpRange:{min:14,max:15},suitMinimums:{D:5,H:4},forcing:'one-round'});
  expect(candidate('1D P 1S P',reverse,'3H').allowed).toBe(true);
  for(const c of ['4H','5H'])expect(candidate('1D P 1S P',reverse,c).allowed).toBe(false);
 });
 it('honors approved artificial GF at its real 24-point floor without changing ordinary NT',()=>{
  const a='1C X XX P 1S P 1NT P 2S P 3H P 3S P',h={S:'4',H:'Q543',D:'A865',C:'Q872'};
  expect(diagnosePrecisionBid(obs(a,h))).toMatchObject({status:'supported',call:call('3NT')});
  expect(meaning(a,'3NT').hcpRange?.min).toBe(8);
  expect(meaning('1C 2H','3NT').hcpRange?.min).toBe(9);expect(candidate(a,h,'P').allowed).toBe(false);
 });
});

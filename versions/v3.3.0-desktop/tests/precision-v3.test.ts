import {describe,it,expect} from 'vitest';
import {decidePrecisionBid,diagnosePrecisionBid} from '../src/ai/precision';
import {assessCandidates} from '../src/ai/constrained-sl';
import {analyzeAuctionSemantics,publicPlayerConstraints,publicCallMeaningAt} from '../src/ai/bidding-semantics';
import {auction,obs,meaning,text,call} from './precision-fixtures';
const nine={S:'4',H:'5432',D:'AQ65',C:'K872'};
const strong={S:'AKJ43',H:'A32',D:'K65',C:'K2'};
const reverse={S:'Q2',H:'AK43',D:'KJ765',C:'J2'};
const weak={S:'432',H:'432',D:'432',C:'5432'};
const candidate=(a:string,h:Parameters<typeof obs>[1],c:string)=>assessCandidates(obs(a,h),'precision').find(x=>text(x.call)===c)!;
describe('v3 finite natural Precision card',()=>{
 it('exports a production Call and a matching explicit diagnostic',()=>{
  for(const a of ['','1C X','1C 1H','1C 1NT','1C 3H']){
   const o=obs(a,nine),d=diagnosePrecisionBid(o);expect(d.status).toBe('supported');
   if(d.status==='supported'){expect(decidePrecisionBid(o)).toEqual(d.call);expect(d.candidates.find(c=>text(c.call)===text(d.call))?.allowed).toBe(true);}
  }
 });
 it('uses neutral NT waiting for9HCP4441 without a five-card suit or balanced NT',()=>{
  const o=obs('1C 1NT',nine);expect(decidePrecisionBid(o)).toEqual(call('P'));
  expect(meaning('1C 1NT','P')).toMatchObject({defined:true,role:'precision-waiting-pass',forcing:'one-round'});
  expect(meaning('1C 1NT','P').hcpRange).toBeUndefined();
  expect(candidate('1C 1NT',nine,'2NT').allowed).toBe(false);
  expect(candidate('1C 1NT',nine,'3NT').allowed).toBe(false);
  expect(analyzeAuctionSemantics(auction('1C 1NT P P'),'N','precision')).toMatchObject({mustBid:true,forcing:'one-round'});
  const next=decidePrecisionBid(obs('1C 1NT P P',strong));expect(next.kind).toBe('bid');
 });
 it('does not invent NT penalty defense in a weak waiter',()=>{
  expect(candidate('1C 1NT',nine,'X').allowed).toBe(false);
  expect(decidePrecisionBid(obs('1C 1NT',weak))).toEqual(call('P'));
 });
 it('keeps low-level natural NT interference real five-card positives and GF',()=>{
  const h={S:'AKJ43',H:'432',D:'765',C:'32'};
  expect(meaning('1C 1NT','2S')).toMatchObject({defined:true,artificial:false,hcpRange:{min:8,max:40},suitMinimums:{S:5},forcing:'game'});
  expect(candidate('1C 1NT',h,'2S').allowed).toBe(true);
  expect(meaning('1C 1NT','2NT')).toMatchObject({hcpRange:{min:14,max:40},suitMaximums:{C:4,D:4,H:4,S:4}});
 });
 it('permits high neutral defense without promoting every8HCP hand to GF',()=>{
  expect(decidePrecisionBid(obs('1C 3H',nine))).toEqual(call('P'));
  expect(meaning('1C 3H','P').hcpRange).toBeUndefined();
  expect(analyzeAuctionSemantics(auction('1C 3H'),'S','precision')).toMatchObject({mustBid:false,forcing:'none'});
  expect(candidate('1C 3H',nine,'3S').allowed).toBe(false);
  expect(meaning('1C 3H','3S')).toMatchObject({hcpRange:{min:12,max:40},suitMinimums:{S:5},forcing:'game'});
  expect(meaning('1C 3H','4C')).toMatchObject({hcpRange:{min:13,max:40},suitMinimums:{C:5},forcing:'game'});
 });
 it('keeps high natural NT stopped and its original positive range',()=>{
  expect(candidate('1C 3H',{S:'A432',H:'432',D:'Q65',C:'K87'},'3NT').allowed).toBe(false);
  expect(candidate('1C 3H',{S:'432',H:'A32',D:'Q65',C:'K872'},'3NT').allowed).toBe(true);
 });
 it.each(['1C P 1H 4S','1C X XX 4S','1C 1H 2H 4S'])('natural enemy game converts offense to defense uniformly:%s',a=>{
  expect(analyzeAuctionSemantics(auction(a),'N','precision')).toMatchObject({mustBid:false,forcing:'none'});
  expect(meaning(a,'P')).toMatchObject({defined:true,forcing:'none',intent:'signoff'});
  expect(meaning(a,'P').hcpRange).toBeUndefined();
  expect(publicPlayerConstraints(auction(a),'S','precision').hcpRange?.min).toBe(8);
  expect(candidate(a,strong,'P').allowed).toBe(true);
 });
 it('preserves offensive GF belowgame and against artificial enemy RKCB',()=>{
  expect(analyzeAuctionSemantics(auction('1C P 1H 3S'),'N','precision')).toMatchObject({mustBid:true,forcing:'game'});
  expect(candidate('1C P 1H 3S',strong,'P').allowed).toBe(false);
  const a=auction('1C 1S 2C 2S 3C 4NT');
  expect(publicCallMeaningAt(a,5,'precision').artificial).toBe(true);
  expect(analyzeAuctionSemantics(a,'S','precision')).toMatchObject({mustBid:true,forcing:'game'});
  expect(candidate('1C 1S 2C 2S 3C 4NT',nine,'P').allowed).toBe(false);
 });
 it('natural own game releases priorGF without an artificial game-height bypass',()=>{
  expect(analyzeAuctionSemantics(auction('1C P 1H P 4H P'),'S','precision')).toMatchObject({mustBid:false,forcing:'none'});
  expect(analyzeAuctionSemantics(auction('1C 2H 3H P'),'N','precision')).toMatchObject({mustBid:true,forcing:'game'});
 });
 it('bounds limited jump shifts by14–15 and real5+4',()=>{
  expect(candidate('1D P 1S P',reverse,'3H').allowed).toBe(true);
  expect(candidate('1D P 1S P',{S:'Q2',H:'AK43',D:'K765',C:'J32'},'3H').allowed).toBe(false);
  expect(candidate('1D P 1S P',{S:'Q2',H:'AK43',D:'K7652',C:'32'},'3H').allowed).toBe(false);
  expect(analyzeAuctionSemantics(auction('1D P 1S P 3H P'),'S','precision')).toMatchObject({mustBid:true,forcing:'one-round'});
  expect(analyzeAuctionSemantics(auction('1D P 1S P 3H P 3D P'),'N','precision')).toMatchObject({mustBid:false,forcing:'none'});
 });
 it('never replaces missing penalty resources with partner strong-club HCP',()=>{
  const noDefense={S:'432',H:'AKJ43',D:'AK6',C:'K2'};
  expect(candidate('1C P 1H 4S',noDefense,'X').allowed).toBe(false);
  expect(decidePrecisionBid(obs('1C P 1H 4S',noDefense))).toEqual(call('P'));
 });
});

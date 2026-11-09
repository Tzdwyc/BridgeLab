import {describe,it,expect} from 'vitest';
import {diagnosePrecisionBid} from '../src/ai/precision';
import {chooseBid,describeCall} from '../src/ai/bidding';
import {assessCandidates} from '../src/ai/constrained-sl';
import {analyzeAuctionSemantics,publicPlayerConstraints,noTrumpRangeAt,classifyDoubleAt} from '../src/ai/bidding-semantics';
import {auction,obs,meaning,call,text} from './precision-fixtures';
const allowed=(a:string,h:Parameters<typeof obs>[1],c:string)=>assessCandidates(obs(a,h),'precision').find(x=>text(x.call)===c)?.allowed;
const weak={S:'432',H:'432',D:'432',C:'5432'},eight={S:'KJ43',H:'Q43',D:'Q43',C:'432'};
describe('existing Precision card',()=>{
 it('keeps artificial strong club and short natural diamond separate',()=>{expect(meaning('','1C')).toMatchObject({artificial:true,hcpRange:{min:16,max:40},suitMinimums:{}});expect(meaning('','1D')).toMatchObject({artificial:false,hcpRange:{min:11,max:15},suitMinimums:{D:2}});expect(allowed('',{S:'AKQ3',H:'A32',D:'K43',C:'432'},'1D')).toBe(false);});
 it('splits seven/eight-point negative and positive without inventing diamond length',()=>{expect(meaning('1C P','1D')).toMatchObject({artificial:true,hcpRange:{min:0,max:7},suitMinimums:{},forcing:'one-round'});expect(allowed('1C P',weak,'1D')).toBe(true);expect(allowed('1C P',eight,'1D')).toBe(false);expect(allowed('1C P',eight,'1NT')).toBe(true);expect(allowed('1C P',weak,'1NT')).toBe(false);expect(allowed('1C P',{S:'KJ432',H:'Q43',D:'Q43',C:'43'},'1NT')).toBe(false);expect(allowed('1C P',{S:'KJ432',H:'Q43',D:'Q43',C:'43'},'1S')).toBe(true);});
 it('keeps passed positive responder 8–12 and game force',()=>{expect(meaning('P P 1C P','1H')).toMatchObject({hcpRange:{min:8,max:12},forcing:'game',suitMinimums:{H:5}});expect(meaning('P P 1C P','1H').description).not.toContain('二盖一');});
 it.each(['1H','1S','2C','2D'])('does not cap strong club natural rebid %s at 21',c=>{const m=meaning('1C P 1D P',c);expect(m.hcpRange).toEqual({min:16,max:40});expect(m.forcing).toBe('none');expect(m.suitMinimums.C??0).toBe(c==='2C'?m.suitMinimums.C:0);});
 it.each([['1NT',16,18],['2NT',19,21],['3NT',24,37]] as const)('preserves negative NT rebid %s range and balance',(c,min,max)=>{expect(meaning('1C P 1D P',c)).toMatchObject({hcpRange:{min,max},strictBalancedShapeFamily:['4333','4432','5332']});});
 it('releases negative-pass continuation without creating a positive responder',()=>{expect(analyzeAuctionSemantics(auction('1C 1H P P'),'N','precision').mustBid).toBe(true);expect(analyzeAuctionSemantics(auction('1C 1H P P 1S P'),'S','precision').forcing).not.toBe('game');expect(text(chooseBid(obs('1C 1H',{S:'KJ64',H:'432',D:'Q65',C:'872'}),'precision'))).toBe('P');});
 it('keeps strong club interference X penalty and ordinary natural X negative',()=>{expect(classifyDoubleAt(auction('1C 1H X'),2,'precision')).toBe('penalty');expect(classifyDoubleAt(auction('1D 1H X'),2,'precision')).toBe('negative');expect(allowed('1C 1H',{S:'KJ64',H:'432',D:'Q65',C:'872'},'X')).toBe(false);});
 it('uses approved negative 1D after X and leaves Pass / four NT undefined',()=>{expect(diagnosePrecisionBid(obs('1C X',weak))).toMatchObject({status:'supported',call:call('1D')});for(const c of ['P','4NT'])expect(meaning('1C X',c).defined).toBe(false);});
 it('does not silently add natural 17+ reverse to limited openings',()=>{const m=meaning('1D P 1S P','2H');expect(m.defined).toBe(true);expect(m.hcpRange).toEqual({min:14,max:15});expect(meaning('1D P 1H P','1NT')).toMatchObject({hcpRange:{min:11,max:12}});expect(publicPlayerConstraints(auction('1D P 1H P 1NT'),'N','precision').hcpRange).toEqual({min:11,max:12});});
 it('validates actual club opening alternative and club inquiry denial',()=>{expect(allowed('',{S:'AK2',H:'Q32',D:'K2',C:'J5432'},'2C')).toBe(false);expect(allowed('',{S:'AKJ2',H:'Q83',D:'2',C:'K8732'},'2C')).toBe(true);expect(meaning('2C P 2D P','3C')).toMatchObject({hcpRange:{min:11,max:13},suitMinimums:{C:6},suitMaximums:{H:3,S:3},forcing:'none'});expect(meaning('2C P 2D P','2NT')).toMatchObject({hcpRange:{min:14,max:15},suitMinimums:{C:6},suitMaximums:{H:3,S:3}});expect(meaning('2C P 2D P','2H').suitMinimums).toEqual({C:5,H:4});});
 it.each([['3C',{S:4,H:4,D:1,C:4}],['3D',{S:4,H:4,D:0,C:5}],['3H',{S:4,H:3,D:1,C:5}],['3S',{S:3,H:4,D:1,C:5}]] as const)('retains exact short-diamond shape %s and forces natural signoff',(c,shape)=>{const m=meaning('2D P 2NT P',c);expect(m.suitMaximums).toEqual(shape);expect(m.forcing).toBe('one-round');expect(m.artificial).toBe(true);expect(analyzeAuctionSemantics(auction('2D P 2NT P '+c+' P'),'S','precision').mustBid).toBe(true);});
 it('uses weak NT 10–11 invitation and 12-point game thresholds',()=>{expect(meaning('1NT P','2C').hcpRange?.min).toBe(10);expect(allowed('1NT P',eight,'2C')).toBe(false);expect(allowed('1NT P',{S:'KJ43',H:'Q43',D:'K43',C:'J32'},'2C')).toBe(true);expect(meaning('1NT P 2D P 2H P','2NT').hcpRange).toEqual({min:10,max:11});expect(meaning('1NT P','3NT').hcpRange?.min).toBe(12);});
 it('does not change real natural 15–18 NT overcall into weak opening range',()=>{expect(noTrumpRangeAt(auction('1D 1NT'),1,'precision')).toEqual({min:15,max:18});expect(meaning('1D 1NT P','2C').hcpRange?.min).toBe(8);});
 it('rejects direct undefined 3NT and nonbalanced weak NT',()=>{expect(meaning('','3NT').defined).toBe(false);expect(allowed('',{S:'AKJ2',H:'Q832',D:'2',C:'K873'},'1NT')).toBe(false);expect(allowed('',{S:'AKJ32',H:'Q83',D:'K43',C:'32'},'1NT')).toBe(false);});
 it('uses the exact prior prefix in hover descriptions',()=>{const a=auction('1C P 1D P');const description=describeCall(a,'N',call('1H'),'precision');expect(description).toContain('精确强梅花后的自然描述');expect(description).toContain('16+点');expect(description).toContain('红心4+张');expect(description).not.toContain('方块4+张');});
});

describe('bounded continuation corrections',()=>{
 it('honors the existing 0–4 pass and 5–7 continuation after negative suit rebid',()=>{
  expect(meaning('1C P 1D P 1H P','P').hcpRange).toEqual({min:0,max:4});
  expect(allowed('1C P 1D P 1H P',weak,'P')).toBe(true);
  const five={S:'K432',H:'Q32',D:'432',C:'432'};
  expect(allowed('1C P 1D P 1H P',five,'P')).toBe(false);
  expect(allowed('1C P 1D P 1H P',five,'1S')).toBe(true);
  expect(allowed('1C P 1D P 1H P',five,'1NT')).toBe(true);
 });
 it('rejects unqualified penalty X and uses the approved positive cue',()=>{
  expect(diagnosePrecisionBid(obs('1C 1H',{S:'4',H:'5432',D:'AQ65',C:'K872'}))).toMatchObject({status:'supported',call:call('2H')});
  expect(diagnosePrecisionBid(obs('1C 1H',{S:'4',H:'AKQJ',D:'8765',C:'5432'}))).toMatchObject({status:'supported',call:{kind:'double'}});
 });
 it('approved lowest enemy-suit cue creates a strong-club positive GF',()=>{
  expect(analyzeAuctionSemantics(auction('1C 1H 2H P'),'N','precision').forcing).toBe('game');
 });
 it('describes a passed defender first genuine overcall from public semantics',()=>{
  const a=auction('P P P 1C');expect(describeCall(a,'N',call('1D'),'precision')).not.toContain('未约定的后续竞争');
 });
 it.each([['3C',{S:'AKJ2',H:'Q832',D:'2',C:'K873'}],['3D',{S:'AKJ2',H:'Q832',D:'',C:'K8732'}],['3H',{S:'AKJ2',H:'Q83',D:'2',C:'K8732'}],['3S',{S:'AKJ',H:'Q832',D:'2',C:'K8732'}]] as const)('answers short-diamond shape exactly with %s',(c,h)=>{
  const o=obs('2D P 2NT P',h),d=diagnosePrecisionBid(o);expect(d).toMatchObject({status:'supported',call:call(c)});
 });
});

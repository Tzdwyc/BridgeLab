import {describe,it,expect} from 'vitest';
import {diagnosePrecisionBid} from '../src/ai/precision';
import {chooseBid,evaluateHand} from '../src/ai/bidding';
import {assessCandidates} from '../src/ai/constrained-sl';
import {obs,meaning,text,call} from './precision-fixtures';
const nine={S:'4',H:'AKQ2',D:'8765',C:'5432'};
const absentStop={S:'4',H:'5432',D:'AQ65',C:'K872'};
describe('第二轮精确竞争正应覆盖',()=>{
 it.each([
  ['1C 1H',nine,9,'1NT'],
  ['1C 1H',{S:'4',H:'AQJ2',D:'J765',C:'5432'},8,'1NT'],
  ['1C 1H',{S:'4',H:'Q432',D:'AK65',C:'KJ32'},13,'1NT'],
  ['1C 1H',{S:'4',H:'Q432',D:'AK65',C:'AJ32'},14,'2NT'],
  ['1C 2H',nine,9,'3NT'],
  ['1C 1S',{S:'AKQ2',H:'4',D:'8765',C:'5432'},9,'1NT'],
  ['1C 1D',{S:'4',H:'5432',D:'AKQ2',C:'8765'},9,'1NT'],
  ['P P 1C 1H',nine,9,'1NT'],
 ] as const)('公开候选内选择 %s 的真实 NT 应叫',(a,h,hcp,expected)=>{
  const o=obs(a,h);expect(o.hand).toHaveLength(13);expect(new Set(o.hand.map(c=>c.id)).size).toBe(13);
  expect(evaluateHand(o.hand).hcp).toBe(hcp);
  const d=diagnosePrecisionBid(o);expect(d).toMatchObject({status:'supported',call:call(expected)});
  expect(text(chooseBid(o,'precision'))).toBe(expected);
  expect(d.candidates.find(c=>text(c.call)===expected)?.allowed).toBe(true);
 });
 it('保留七点负应及九点已批准人工扣叫',()=>{
  expect(diagnosePrecisionBid(obs('1C 1H',{S:'4',H:'AQJ2',D:'8765',C:'5432'}))).toMatchObject({status:'supported',call:call('P')});
  const d=diagnosePrecisionBid(obs('1C 1H',absentStop));expect(d).toMatchObject({status:'supported',call:call('2H')});
  expect(d.candidates.filter(c=>c.allowed).map(c=>text(c.call))).toEqual(['2H']);
  expect(d.candidates.find(c=>text(c.call)==='1NT')?.reasons).toContain('nt-stopper');
 });
 it('二阶干扰后八点人工扣叫不冒充九点自然3NT',()=>{
  expect(diagnosePrecisionBid(obs('1C 2H',{S:'4',H:'AQJ2',D:'J765',C:'5432'}))).toMatchObject({status:'supported',call:call('3H')});
 });
 it('保留合格惩罚 X 与五张真实新套的既有优先级',()=>{
  expect(diagnosePrecisionBid(obs('1C 1H',{S:'4',H:'AKQJ',D:'8765',C:'5432'}))).toMatchObject({status:'supported',call:call('X')});
  expect(diagnosePrecisionBid(obs('1C 1H',{S:'AKJ43',H:'432',D:'765',C:'32'}))).toMatchObject({status:'supported',call:call('1S')});
 });
 it('不改变公开 NT 承诺或未约定干扰边界',()=>{
  const m=meaning('1C 1H','1NT');expect(m.hcpRange).toEqual({min:8,max:13});expect(m.strictBalancedShapeFamily).toBeUndefined();
  expect(m.stopperSources).toContainEqual({suit:'H',seat:'S',index:2});
  expect(m.forcing).toBe('game');
  for(const a of ['1C 1NT','1C 3H'])expect(diagnosePrecisionBid(obs(a,nine))).toMatchObject({status:'supported'});
  expect(assessCandidates(obs('1C 1H',nine),'precision').find(c=>text(c.call)==='X')?.allowed).toBe(false);
 });
});
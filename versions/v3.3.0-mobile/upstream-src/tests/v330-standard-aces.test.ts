import { describe, expect, it } from 'vitest';
import { chooseBid,describeCall } from '../src/ai/bidding';
import { publicCallMeaningAt,analyzeAuctionSemantics } from '../src/ai/bidding-semantics';
import { assessCandidates } from '../src/ai/constrained-sl';
import { parseAuction } from './fixtures/android-stack-incident';
import { legalCalls } from '../src/core/auction';
import { SEATS,type Card,type Suit,type Call } from '../src/core/types';
import type { BiddingObservation } from '../src/ai/observation';
const holdings=['KQ4.KQJ9.J65.J98','AQ4.KQJ9.J65.J98','AQ4.KQJ9.A65.J98','AQ4.KQJ9.A65.A98','AQ4.AQJ9.A65.A98'];
const ntHands=['KQJ.KQJ9.Q65.J98','AQJ.KQJ9.Q65.J98','AQJ.KQJ9.A65.987','AQ4.KT98.A65.A98','A94.AT98.A65.A98'];
function obs(prefix:string,text:string):BiddingObservation {
 const auction=parseAuction(prefix),seat=SEATS[auction.length%4];
 const hand=text.split('.').flatMap((p,i)=>[...p].map(r=>({suit:(['S','H','D','C'] as Suit[])[i],rank:'23456789TJQKA'.indexOf(r)+2,id:`${i}${r}`}))) as Card[];
 return {board:1,seat,actingSeat:seat,phase:'auction',vulnerability:'None',hand,auction,legalCalls:legalCalls(auction,seat)};
}
const c=(level:number,strain:any):Call=>({kind:'bid',level,strain});
const assess=(o:BiddingObservation,call:Call)=>assessCandidates(o,'sayc').find(a=>JSON.stringify(a.call)===JSON.stringify(call));
describe('standard SAYC asks do not inherit 1430',()=>{
 it.each([0,1,2,3,4])('Blackwood answers %i aces and qualifies the actual cards',n=>{
  const o=obs('1H P 2NT P 4NT P',holdings[n]),expected=c(5,['C','D','H','S','C'][n]);
  expect(chooseBid(o,'sayc')).toEqual(expected);expect(assess(o,expected)?.allowed).toBe(true);
  expect(describeCall(o.auction,o.seat,expected,'sayc')).toContain(n===0||n===4?'0或4张A':`${n}张A`);
 });
 it.each([0,1,2,3,4])('Gerber answers %i aces, not natural clubs',n=>{
  const o=obs('1NT P 4C P',ntHands[n]),expected=c(4,['D','H','S','NT','D'][n]);
  expect(chooseBid(o,'sayc')).toEqual(expected);expect(assess(o,expected)?.allowed).toBe(true);
  expect(describeCall(parseAuction('1NT P'),'S',c(4,'C'),'sayc')).toContain('Gerber');
 });
 it('Natural retains 1430 including the trump king',()=>{
  const o=obs('1H P 2NT P 4NT P',holdings[1]);
  expect(chooseBid(o,'two-over-one')).toEqual(c(5,'S'));
  expect(describeCall(o.auction,o.seat,c(5,'S'),'two-over-one')).toContain('RKCB');
 });
 it.each([0,1,2,3,4])('DOPI actual response for %i aces',n=>{
  const o=obs('1H P 2NT P 4NT 5D',holdings[n]);
  const expected:Call=n===0?{kind:'double'}:n===1?{kind:'pass'}:c(5,['H','S','NT'][n-2]);
  expect(chooseBid(o,'sayc')).toEqual(expected);expect(assess(o,expected)?.allowed).toBe(true);
  expect(describeCall(o.auction,o.seat,expected,'sayc')).toContain('DOPI');
 });
 it.each([0,1,2,3,4])('ROPI actual response for %i aces',n=>{
  const o=obs('1H P 2NT P 4NT X',holdings[n]);
  const expected:Call=n===0?{kind:'redouble'}:n===1?{kind:'pass'}:c(5,['C','D','H'][n-2]);
  expect(chooseBid(o,'sayc')).toEqual(expected);expect(assess(o,expected)?.allowed).toBe(true);
 });
 it('quantitative 4NT after NT is still an invitation',()=>{
  const a=parseAuction('1NT P 4NT');expect(publicCallMeaningAt(a,2,'sayc').standardAce).toBeUndefined();
  expect(analyzeAuctionSemantics([...a,{seat:'W',call:{kind:'pass'}}],'N','sayc').mustBid).toBe(false);
 });
 it('SAYC minor 2NT is 13–15 GF while 3NT shows 16–18',()=>{
  const a=parseAuction('1C P 2NT');expect(publicCallMeaningAt(a,2,'sayc')).toMatchObject({hcpRange:{min:13,max:15},forcing:'game'});
  const b=parseAuction('1D P 3NT');expect(publicCallMeaningAt(b,2,'sayc').hcpRange).toEqual({min:16,max:18});
 });
 it('does not call the Natural 4NT double-minor opening a SAYC convention',()=>{
  const a=parseAuction('4NT');expect(publicCallMeaningAt(a,0,'two-over-one').artificial).toBe(true);
  expect(publicCallMeaningAt(a,0,'sayc').standardAce).toBeUndefined();
 });
});

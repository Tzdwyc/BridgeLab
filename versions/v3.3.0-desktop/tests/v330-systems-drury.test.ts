import { chooseBid as oldChooseBid } from './fixtures/v329/src/ai/bidding';
import { describe, it, expect } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { analyzeAuctionSemantics, publicCallMeaningAt, publicPlayerConstraints, isArtificialBidAt } from '../src/ai/bidding-semantics';
import { assessCandidates } from '../src/ai/constrained-sl';
import { parseAuction } from './fixtures/android-stack-incident';
import { legalCalls } from '../src/core/auction';
import { SEATS, type Card, type Suit } from '../src/core/types';
import type { BiddingObservation } from '../src/ai/observation';
import { SYSTEMS } from '../src/ai/systems';
const hand = (text:string):Card[] => text.split('.').flatMap((part,i)=>[...part].map(rank=>{
 const value='23456789TJQKA'.indexOf(rank)+2; const suit=(['S','H','D','C'] as Suit[])[i];
 return {suit,rank:value as Card['rank'],id:`${suit}${value}`}; }));
function obs(prefix:string, holding:string):BiddingObservation {
 const auction=parseAuction(prefix),seat=SEATS[auction.length%4];
 return {board:1,seat,actingSeat:seat,phase:'auction',vulnerability:'None',hand:hand(holding),auction,legalCalls:legalCalls(auction,seat)};
}
const meaning=(prefix:string,system:'sayc'|'two-over-one')=>{const a=parseAuction(prefix);return publicCallMeaningAt(a,a.length-1,system);};
describe('separate natural agreements and reverse Drury',()=>{
 it('uses the requested three visible names',()=>{expect(SYSTEMS.sayc.name).toBe('标准（SAYC）');expect(SYSTEMS['two-over-one'].name).toBe('自然（Natural）');expect(SYSTEMS.precision.name).toBe('精确（Precise）');});
 it('SAYC 2/1 forces one round; Natural forces game',()=>{
  expect(analyzeAuctionSemantics(parseAuction('1S P 2C P'),'N','sayc').forcing).toBe('one-round');
  expect(analyzeAuctionSemantics(parseAuction('1S P 2C P'),'N','two-over-one').forcing).toBe('game');
  expect(meaning('1S P 2C','sayc').hcpRange?.min).toBe(10);
 });
 it('SAYC 1NT is 6–10 NF, Natural remains semi-forcing',()=>{
  expect(meaning('1S P 1NT','sayc')).toMatchObject({hcpRange:{min:6,max:10},forcing:'none',role:'natural-nt'});
  expect(meaning('1S P 1NT','two-over-one').role).toBe('semi-forcing-nt');
 });
 it.each(['P P 1S P','P P P 1S P'])('passed hand uses qualified Drury after %s',prefix=>{
  const o=obs(prefix,'KQ4.J83.A65.9872'), c=chooseBid(o,'two-over-one');
  expect(c).toEqual({kind:'bid',level:2,strain:'C'});
  expect(assessCandidates(o,'two-over-one').find(x=>JSON.stringify(x.call)===JSON.stringify(c))?.allowed).toBe(true);
  const m=publicCallMeaningAt([...o.auction,{seat:o.seat,call:c}],o.auction.length,'two-over-one');
  expect(m).toMatchObject({role:'drury-inquiry',artificial:true,forcing:'one-round',suitMinimums:{S:3}});
  expect(m.suitMinimums.C).toBeUndefined();
  expect(describeCall(o.auction,o.seat,c,'two-over-one')).toContain('Drury');
 });
 it('weak opener signs off in 2S, Drury responder stops',()=>{
  expect(chooseBid(obs('P P 1S P 2C P','KQT76.A43.87.654'),'two-over-one')).toEqual({kind:'bid',level:2,strain:'S'});
  expect(chooseBid(obs('P P 1S P 2C P 2S P','KQ4.J83.A65.9872'),'two-over-one')).toEqual({kind:'pass'});
  expect(analyzeAuctionSemantics(parseAuction('P P 1S P 2C P'),'S','two-over-one').mustBid).toBe(true);
 });
 it('constructive opener answers artificial 2D without promising diamonds',()=>{
  expect(chooseBid(obs('P P 1S P 2C P','AKQ76.K43.J8.654'),'two-over-one')).toEqual({kind:'bid',level:2,strain:'D'});
  expect(meaning('P P 1S P 2C P 2D','two-over-one')).toMatchObject({artificial:true,suitMinimums:{},forcing:'one-round'});
 });
 it.each(['1S P 2C','P 1S P 2C','P P 1S X 2C','P P 1S 2D 2C'])('does not mistake natural/competitive %s for Drury',prefix=>{
  expect(meaning(prefix,'two-over-one').role).not.toBe('drury-inquiry');
 });
 it('SAYC passed-hand 2C remains natural',()=>{expect(meaning('P P 1S P 2C','sayc').artificial).toBe(false);});
 it('Drury with a singleton club does not acquire a club length promise',()=>{
  const o=obs('P P 1S P','KQ4.J832.A654.9'),c=chooseBid(o,'two-over-one');
  expect(c).toEqual({kind:'bid',level:2,strain:'C'});
  expect(assessCandidates(o,'two-over-one').find(x=>JSON.stringify(x.call)===JSON.stringify(c))?.allowed).toBe(true);
  const a=[...o.auction,{seat:o.seat,call:c}];
  expect(isArtificialBidAt(a,a.length-1,'two-over-one')).toBe(true);
  const constraints=publicPlayerConstraints(a,o.seat,'two-over-one');
  expect(constraints.suitMinimums.C).toBe(0);expect(constraints.suitMinimums.S).toBe(3);
 });
 it('both artificial questions require a response but a signoff ends that obligation',()=>{
  for (const prefix of ['P P 1S P 2C P','P P 1S P 2C P 2D P']) {
   const o=obs(prefix,'KQ4.J83.A65.9872');
   expect(assessCandidates(o,'two-over-one').find(x=>x.call.kind==='pass')?.allowed).toBe(false);
  }
  expect(analyzeAuctionSemantics(parseAuction('P P 1S P 2C P 2S P'),'N','two-over-one').mustBid).toBe(false);
 });
 it('SAYC requires responders promised second bid, then allows a limited stop',()=>{
  expect(analyzeAuctionSemantics(parseAuction('1S P 2C P 2S P'),'S','sayc').mustBid).toBe(true);
  expect(analyzeAuctionSemantics(parseAuction('1S P 2C P 2S P 2NT P'),'N','sayc').forcing).not.toBe('game');
 });
 it('hearts also support Drury without natural clubs',()=>{expect(meaning('P P 1H P 2C','two-over-one')).toMatchObject({artificial:true,suitMinimums:{H:3}});});
 it('a constructive Drury hand can invite, while the minimum can stop',()=>{
  expect(chooseBid(obs('P P 1S P 2C P 2D P','KQ4.J83.A65.9872'),'two-over-one')).toEqual({kind:'bid',level:2,strain:'S'});
  expect(chooseBid(obs('P P 1S P 2C P 2D P','KQ4.Q83.A65.9872'),'two-over-one')).toEqual({kind:'bid',level:3,strain:'S'});
 });

 it('outside the Drury point window, retains the pre-existing passed-hand selection',()=>{
  const position=obs('P P 1S P','KQ43.J832.A654.9');
  expect(chooseBid(position,'two-over-one')).toEqual(oldChooseBid(position,'two-over-one'));
 });

 it('a double after the artificial ask does not permit passing out Drury',()=>{
  const o=obs('P P 1S P 2C X','KQT76.A43.87.654');
  expect(analyzeAuctionSemantics(o.auction,o.seat,'two-over-one').mustBid).toBe(true);
  expect(chooseBid(o,'two-over-one')).toEqual({kind:'bid',level:2,strain:'S'});
  expect(assessCandidates(o,'two-over-one').find(x=>x.call.kind==='pass')?.allowed).toBe(false);
 });

 it('the same ten-point long-club hand responds differently under the two foundations',()=>{
  const o=obs('1S P','K4.Q83.A65.J9872');
  expect(chooseBid(o,'sayc')).toEqual({kind:'bid',level:2,strain:'C'});
  expect(chooseBid(o,'two-over-one')).toEqual({kind:'bid',level:1,strain:'NT'});
  expect(assessCandidates(o,'sayc').find(x=>x.call.kind==='bid'&&x.call.level===2&&x.call.strain==='C')?.allowed).toBe(true);
 });
 it('a minimum balanced SAYC opener has a qualified cheap 2NT reply',()=>{
  const o=obs('1S P 2C P','KJ765.A43.K8.Q54'),c=chooseBid(o,'sayc');
  expect(c).toEqual({kind:'bid',level:2,strain:'NT'});
  expect(assessCandidates(o,'sayc').find(x=>x.call.kind==='bid'&&x.call.level===2&&x.call.strain==='NT')?.allowed).toBe(true);
 });

 it('a weak SAYC responder can fulfill the second bid without inventing extra length',()=>{
  const o=obs('1S P 2C P 2NT P','K4.Q83.A65.J9872'),c=chooseBid(o,'sayc');
  const a=assessCandidates(o,'sayc').find(x=>JSON.stringify(x.call)===JSON.stringify(c));
  expect(c.kind,JSON.stringify({c,reasons:a?.reasons})).toBe('bid');
  expect(a?.allowed,JSON.stringify({c,reasons:a?.reasons})).toBe(true);
 });

});

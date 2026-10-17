import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, publicCallMeaningAt, noTrumpRangeAt, naturalSuitMinimum, publicPlayerConstraints } from '../src/ai/bidding-semantics';
const seats: Seat[] = ['N','E','S','W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token,index) => ({seat:seats[index%4],call:token==='P'?{kind:'pass'}:token==='X'?{kind:'double'}:{kind:'bid',level:+token[0],strain:token.slice(1) as Strain} as Call}));
const meaning = (text: string) => {const a=auction(text);return publicCallMeaningAt(a,a.length-1);};
describe('release11 exact public context repairs',()=>{
 it('completed one-NT Stayman denial permits a natural partial contract even after a lead double',()=>{
  expect(analyzeAuctionSemantics(auction('1C 1NT P 2C X 2D P'),'W','sayc')).toMatchObject({mustBid:false,currentContractArtificial:false});
  expect(analyzeAuctionSemantics(auction('2NT P 3C P 3D P'),'S','sayc').mustBid).toBe(true);
 });
 it('natural game completes strong-club positive GF',()=>{
  expect(analyzeAuctionSemantics(auction('2C P 2D P 3C P 3D P 5D P'),'S','sayc')).toMatchObject({mustBid:false,forcing:'none',currentContractArtificial:false});
 });
 it('enemy natural game releases an ordinary cue force',()=>{
  expect(analyzeAuctionSemantics(auction('1C 1H P 2C 4S'),'E','sayc').mustBid).toBe(false);
 });
 it.each(['1H 1NT P 2C 2H 2S','1H 1NT P 2C 2H 2NT'])('interrupted Stayman retains actual NT platform: %s',text=>{
  const m=meaning(text);expect(m.defined).toBe(true);expect(m.hcpRange).toEqual({min:15,max:18});expect(m.forcing).toBe('none');
  if(text.endsWith('2S'))expect(m.suitMinimums.S).toBe(4);else expect(noTrumpRangeAt(auction(text),5,'sayc')).toEqual({min:15,max:18});
 });
 it('weak unbid responder may cheaply prefer the original natural suit',()=>{
  const a=auction('1S X P 1NT 2H P 2S');const m=publicCallMeaningAt(a,6);
  expect(m).toMatchObject({role:'natural-preference',hcpRange:{min:0,max:40},forcing:'none'});
  expect(m.supportRange).toBeUndefined();expect(naturalSuitMinimum(a,'S','S','sayc')).toBe(2);
 });
 it('answered genuine NT questions permit a truthful six-minor game',()=>{
  const m=meaning('1NT P 2C P 2D P 5C');expect(m).toMatchObject({defined:true,role:'natural-support',suitMinimum:6,forcing:'none'});
  expect(m.supportRange?.trump).toBe('C');
 });
 it('lowest Unusual choice may be only two cards; jumping to game is a distinct commitment',()=>{
  expect(meaning('1S 2NT P 3C')).toMatchObject({role:'two-suit-choice',suitMinimum:1,forcing:'none'});
  const m=meaning('1C 2C P 4H');expect(m.suitMinimum).toBe(3);expect(m.supportRange?.trump).toBe('H');expect(m.description).toContain('主动成局');
 });
 it.each(['1D X P 1NT 2S','1C 2D P P 2H','1D 1S P 2D 2H'])('competitive minor-opener reverse has four-four and17+ contract: %s',text=>{
  const m=meaning(text);expect(m.hcpRange).toEqual({min:17,max:21});expect(m.suitMinimum).toBe(4);expect(m.forcing).toBe('one-round');
 });
 it('lead and natural NT penalty doubles publish numeric quality thresholds',()=>{
  expect(meaning('1NT P 2H X').description).toContain('至少三张T以上');
  expect(meaning('1C P 1NT X').description).toContain('15+ HCP且至少3个快速赢墩');
  expect(meaning('1C 2NT X').description).toContain('10+ HCP');
 });
 it('positive four-club response is not described as a second negative',()=>{
  expect(meaning('2C P 2D P 2S P 4C P 4S').description).not.toContain('二次负应');
 });
 it('transfer return to game describes support instead of own long suit',()=>{
  expect(meaning('1NT P 2H P 2S P 3H P 4S').description).not.toContain('自己的长套');
 });
 it('forced natural takeout-cue answer retains the original double strength',()=>{
  const m=meaning('1H X P 2H P 2S');expect(m.hcpRange?.min).toBe(12);expect(m.description).toContain('原技术X的12+');
 });
 it('opener cheapest rebid after a balancing double is not a forcing response',()=>{
  expect(analyzeAuctionSemantics(auction('1C P P X 1S P'),'S','sayc')).toMatchObject({mustBid:false,forcing:'none'});
 });
 it('late NT windows are exact rather than inherited open ranges',()=>{
  expect(meaning('1C P 1D 1S P P 1NT').hcpRange).toEqual({min:6,max:10});
  expect(meaning('1C 1D P 1NT').hcpRange).toEqual({min:8,max:11});
  expect(meaning('1C 1D P 2NT').hcpRange).toEqual({min:12,max:14});
  expect(meaning('1C 1S X P 1NT P 2NT')).toMatchObject({hcpRange:{min:11,max:12},invitation:true});
 });
 it('preempt natural NT distinguishes first balanced response from late six-minor source',()=>{
  expect(meaning('3D P 3NT')).toMatchObject({role:'preempt-natural-nt',hcpRange:{min:16,max:40},suitMinimums:{C:2,D:2,H:2,S:2}});
  expect(meaning('2H P 3C P 3H P 3NT')).toMatchObject({role:'preempt-natural-nt',hcpRange:{min:19,max:40},suitMinimums:{C:6}});
 });
 it('a real voluntary four-minor jump after a stop cue announces extra strength',()=>{
  expect(meaning('1C 1S 2D P 2S X 4D')).toMatchObject({role:'minor-slam-try',hcpRange:{min:16,max:40},suitMinimum:6,invitation:true,forcing:'none'});
 });
 it('late opener preference does not fabricate a fourth card',()=>{
  expect(meaning('1C P 1H P 1S P 2C P 2H').suitMinimum).toBe(3);
 });
 it('lowest fourth-level minor support uses three opposite five, without inventing game',()=>{
  expect(meaning('P P 1S P 2D P 2S P 3D P 4D').suitMinimum).toBe(3);
 }); it('negative-X requested major remains an ordinary four-card answer, not a reverse',()=>{
  expect(meaning('1D 1S X P 2H')).toMatchObject({suitMinimum:4,hcpRange:{min:12,max:21}});
  expect(meaning('1C P 1D 1H 2S').hcpRange?.min).toBe(19);
 });
 it('lowest opener one-spade second suit has four rather than five',()=>{
  expect(meaning('1D 1H P P 1S').suitMinimum).toBe(4);
 });
 it('strong-club ongoing GF can return five spades at the cheapest game level',()=>{
  expect(meaning('2C P 2D P 3D P 3S P 4D P 4S').suitMinimum).toBe(5);
 });
 it('strong takeout late cue makes the original-point game force explicit',()=>{
  expect(meaning('1H X P 2C P 2D P 3H')).toMatchObject({role:'cue',hcpRange:{min:8,max:40},forcing:'game',suitMinimums:{}});
  expect(meaning('1D 2S X P 3S')).toMatchObject({role:'cue',hcpRange:{min:17,max:21},forcing:'game',suitMinimums:{}});
 });
 it('a strong takeout-cue natural continuation preserves a proven raw game force',()=>{
  const a=auction('1C P P X P 2C P 2S P 3D P 3H');
  expect(publicCallMeaningAt(a,9)).toMatchObject({hcpRange:{min:16,max:40},forcing:'game'});
  expect(publicCallMeaningAt(a,11)).toMatchObject({suitMinimum:4,hcpRange:{min:9,max:40},forcing:'game'});
 });
 it('weak five-spade return includes a different lower second minor but not a forced reverse',()=>{
  expect(meaning('1D P 1S P 2C P 2S')).toMatchObject({suitMinimum:5,hcpRange:{min:6,max:9},forcing:'none'});
  expect(meaning('1C P 1S P 2D P 2S').hcpRange?.max).not.toBe(9);
 });
 it('NT new-minor continuation uses the precise platform strength and source',()=>{
  expect(meaning('1NT P 2D P 2H P 3D')).toMatchObject({role:'responder-second-suit',suitMinimum:5,hcpRange:{min:10,max:40},forcing:'game'});
  expect(meaning('1D P 1H P 1NT P 3C')).toMatchObject({role:'long-minor-invitation',suitMinimum:6,hcpRange:{min:10,max:12},forcing:'none'});
 });
 it('autonomous repeated NT without a new numeric contract remains unmapped',()=>{
  expect(meaning('1C 1H 1NT 2S P P 2NT').defined).toBe(false);
 });
 it('Unusual unshown suit is not mislabeled as choosing a shown five-card suit',()=>{
  expect(meaning('1D 2NT P 3S')).toMatchObject({role:'unknown',defined:false});
 }); it('negative-X completed by minimum NT permits six-minor invitation',()=>{
  expect(meaning('1D 1S X P 1NT P 3C')).toMatchObject({role:'long-minor-invitation',suitMinimum:6,hcpRange:{min:10,max:12},forcing:'none'});
 });
 it('two-NT overcall denial permits the approved six-minor NF escape',()=>{
  expect(meaning('2H 2NT P 3C P 3D P 4C')).toMatchObject({role:'weak-minor-escape',suitMinimum:6,forcing:'none'});
  expect(analyzeAuctionSemantics(auction('2H 2NT P 3C P 3D P 4C P'),'E','sayc').mustBid).toBe(false);
 });
 it('semiNT new club invitation publishes honest five while retaining the six-or-five-five condition',()=>{
  const m=meaning('1S P 1NT P 2S P 3C');
  expect(m).toMatchObject({suitMinimum:5,hcpRange:{min:10,max:12},minorInvitationShape:{primary:'C',ordinaryLength:6,secondary:'D',secondaryMinimum:5,originalMajor:'S',maxOriginal:1}});
  expect(publicPlayerConstraints(auction('1S P 1NT P 2S P 3C'),'S').pointSources.at(-1)?.minorInvitationShape).toBeDefined();
 });
 it('unfitted four-minor retains sixteen/six or the bounded original-seven alternative',()=>{
  expect(meaning('3D 4C')).toMatchObject({suitMinimum:6,hcpRange:{min:16,max:40},forcing:'none'});
  // Original opener is now at the cheapest legal club level over enemy3H.
  // Public12/six is the union floor; private holdings must satisfy either
  // sixteen/six or twelve/seven with the separately published honor quality.
  expect(meaning('1C 1S P 2H 2C 3H P P 4C')).toMatchObject({suitMinimum:6,hcpRange:{min:12,max:21},forcing:'none',playingSourceCompensation:{normalHcpMinimum:16,minHcp:12,minLength:7,minQueenOrHigher:2,minTenOrHigher:3}});
 }); it('original seven-minor playing source remains a bounded alternative at the cheapest fourth level',()=>{
  expect(meaning('1C 2NT X 3H 4C')).toMatchObject({suitMinimum:6,hcpRange:{min:12,max:21},playingSourceCompensation:{normalHcpMinimum:16,minHcp:12,minLength:7,minQueenOrHigher:2,minTenOrHigher:3}});
 });});

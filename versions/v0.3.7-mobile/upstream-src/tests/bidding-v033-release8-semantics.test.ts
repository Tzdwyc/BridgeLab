import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { analyzeAuctionSemantics, isArtificialBidAt, naturalSuitMinimum, noTrumpRangeAt,
  publicCallMeaningAt, publicNoTrumpQuestionAt, publicPlayerConstraints, publicWeakMinorRelayAt } from '../src/ai/bidding-semantics';
const seats: Seat[] = ['N', 'E', 'S', 'W'];
const auction = (text: string): AuctionEntry[] => text.split(' ').map((token,index) => ({ seat: seats[index%4],
  call: token === 'P' ? { kind:'pass' } : token === 'X' ? { kind:'double' } : { kind:'bid',level:+token[0],strain:token.slice(1) as Strain } as Call }));
const meaning = (text: string, system: 'sayc'|'precision'='sayc') => { const a=auction(text); return publicCallMeaningAt(a,a.length-1,system); };
describe('release8 public temporal and convention contracts', () => {
  it.each(['1NT P 2S', '1H 1NT P 2S', '1C P P 1NT P 2S'])('weak-minor request has no spade length: %s', text => {
    const a=auction(text), m=publicCallMeaningAt(a,a.length-1);
    expect(m).toMatchObject({role:'weak-minor-relay', artificial:true, hcpRange:{min:0,max:9}, forcing:'one-round'});
    expect(m.suitMinimums.S).toBeUndefined();
    expect(publicWeakMinorRelayAt(a,a.length-1)?.stage).toBe('request');
  });
  it('doubled relay still requires the platform bidder to accept, then natural correction can stop', () => {
    const request=auction('1H 1NT P 2S X');
    expect(analyzeAuctionSemantics(request,'E','sayc')).toMatchObject({mustBid:true, convention:'weak-minor-relay'});
    expect(meaning('1H 1NT P 2S X 3C')).toMatchObject({role:'weak-minor-relay-acceptance', suitMinimum:2, forcing:'none'});
    expect(meaning('1H 1NT P 2S X 3C P 3D')).toMatchObject({role:'weak-minor-relay-correction', suitMinimum:6,hcpRange:{min:0,max:9},forcing:'none'});
  });
  it('ordinary suit-opening NT rebid is not a transfer or weak-minor relay platform', () => {
    for (const text of ['1C P 1H P 1NT P 2S','1C P 1H P 2NT P 3D','1D P 1NT P 2S','1H P 1NT P 2S']) {
      const a=auction(text); expect(publicNoTrumpQuestionAt(a,a.length-1)).toBeUndefined();
    }
  });
  it('strong 2C balanced rebid is a genuine NT question platform', () => {
    const a=auction('2C P 2D P 2NT P 3D');
    expect(publicNoTrumpQuestionAt(a,6)).toMatchObject({kind:'transfer',target:'H',platform:{index:4}});
  });
  it('original SAYC 3NT opening supports four-club Stayman and four-major transfers', () => {
    expect(meaning('3NT P 4C').role).toBe('stayman');
    expect(meaning('3NT P 4H')).toMatchObject({role:'transfer', suitMinimums:{S:5}});
  });
  it('support point sources retain the source-time actor and partner lengths', () => {
    const c=publicPlayerConstraints(auction('1H P 2H P 3H'),'S');
    expect(c.pointSources.find(s=>s.type==='support')).toMatchObject({index:2,sourceTrumpMinimum:3,sourcePartnerTrumpMinimum:5,range:{min:6,max:9}});
  });
  it('technical strong cue takes precedence over Michaels and its natural continuation shows honest shape', () => {
    const a=auction('1C X P 2C P 2S P 3H');
    expect(publicCallMeaningAt(a,3)).toMatchObject({role:'cue',hcpRange:{min:12,max:40},suitMinimums:{}});
    expect(publicCallMeaningAt(a,7)).toMatchObject({role:'takeout-cue-continuation',hcpRange:{min:12,max:40},suitMinimum:5,forcing:'none'});
    expect(publicPlayerConstraints(a,'W').suitMinimums.S).toBe(0);
    expect(meaning('1C X P 2C P 2S P 3D')).toMatchObject({role:'takeout-cue-continuation',hcpRange:{min:16,max:40},suitMinimum:4,forcing:'game'});
  });
  it('an artificial support cue does not turn a later game return into a sixth-card promise', () => {
    const a=auction('1D 1S P 2D P 4S');
    expect(naturalSuitMinimum(a,'E','S','sayc')).toBe(5);
    expect(publicCallMeaningAt(a,5).description).toContain('搭档支持');
  });
  it('balanced low-platform NT invitation uses its own range and acceptance keeps the upper limit', () => {
    const a=auction('1C P P 1NT P 2C P 2D P 2NT P 3NT');
    expect(noTrumpRangeAt(a,9,'sayc')).toEqual({min:11,max:12});
    expect(noTrumpRangeAt(a,11,'sayc')).toEqual({min:14,max:14});
  });
  it('NT completion retains an earlier limited raw range, and strong rebid range survives natural minor', () => {
    expect(meaning('1H P 1NT P 3C P 3NT').hcpRange).toEqual({min:6,max:12});
    expect(meaning('1H P 1S P 2NT P 3C P 3NT').hcpRange).toEqual({min:18,max:19});
  });
  it('first minor rebid invitation may support the newly public five-card minor with three', () => {
    expect(meaning('1C P 1H P 2C P 3C')).toMatchObject({suitMinimum:3,supportRange:{trump:'C',min:10,max:12}});
  });
  it('strong opener game jump preserves its nineteen-to-twenty-one point contract', () => {
    expect(meaning('1H P 1S P 4S')).toMatchObject({supportRange:{trump:'S',min:19,max:21},suitMinimum:4});
    expect(meaning('1S P 1NT P 4S')).toMatchObject({hcpRange:{min:19,max:21},suitMinimum:6});
  });
  it('Precision interference allows a public negative Pass rather than private-hand-dependent forcing', () => {
    expect(analyzeAuctionSemantics(auction('1C 1S'),'S','precision')).toMatchObject({mustBid:false,forcing:'one-round'});
    expect(meaning('1C 1S P','precision')).toMatchObject({role:'precision-negative-pass',hcpRange:{min:0,max:7}});
    expect(analyzeAuctionSemantics(auction('1C 1S P P'),'N','precision')).toMatchObject({mustBid:true,convention:'precision-negative-pass'});
    expect(isArtificialBidAt(auction('1C 1S 2H'),2,'precision')).toBe(false);
    expect(meaning('1C 1S 2H','precision')).toMatchObject({role:'natural-response',hcpRange:{min:8,max:40},suitMinimum:5,forcing:'game'});
  });
  it('interfered Stayman answer at the minimum available three level is a natural four-card answer', () => {
    expect(meaning('1NT P 2C 2H 3H')).toMatchObject({role:'stayman-answer',artificial:false,suitMinimum:4});
  });
  it('NT interference weak major and long minor escape are separate natural NF contracts', () => {
    expect(meaning('1NT 2C 2H')).toMatchObject({role:'nt-competitive-weak-response',suitMinimum:5,hcpRange:{min:5,max:12},forcing:'none'});
    expect(meaning('1NT 2H 3C')).toMatchObject({role:'nt-competitive-minor-escape',suitMinimum:6,hcpRange:{min:5,max:9},forcing:'none'});
    expect(analyzeAuctionSemantics(auction('1NT 2H 3C P'),'N','sayc').mustBid).toBe(false);
  });
  it('higher voluntary minor invitation is distinct from minimum competition and ordinary invitation', () => {
    expect(meaning('1D 1S 4D')).toMatchObject({role:'stronger-minor-invitation',invitation:true,supportRange:{trump:'D',min:13,max:16},suitMinimum:5});
    expect(meaning('1D 3S 4D')).toMatchObject({invitation:false,supportRange:{trump:'D',min:6,max:40}});
    expect(meaning('1D P 3D')).toMatchObject({invitation:true,supportRange:{trump:'D',min:10,max:12}});
  });
  it('a prior Pass after an enemy opening is not a passed-hand twelve-point ceiling', () => {
    expect(meaning('1D P 1H 1S P 2C')).toMatchObject({hcpRange:{min:8,max:40},suitMinimum:5,forcing:'none'});
  });
  it('strong takeout rebid does not retain conditional unbid-major promises', () => {
    const a=auction('2D X P 2H P 3C');
    expect(publicCallMeaningAt(a,1).hcpRange).toEqual({min:12,max:40});
    const c=publicPlayerConstraints(a,'E');
    expect(c.hcpRange?.min).toBe(17); expect(c.suitMinimums.H).toBe(0); expect(c.suitMinimums.S).toBe(0);
  });
  it('pending genuine Stayman does not acquire an unmapped natural NT game answer', () => {
    const a=auction('1NT P 2C P');
    expect(analyzeAuctionSemantics(a,'N','sayc')).toMatchObject({mustBid:true,currentContractArtificial:true});
    expect(meaning('1NT P 2C P 3NT')).toMatchObject({defined:false,role:'unknown'});
    expect(meaning('1NT P 2C P 2D P 3NT')).toMatchObject({defined:true,role:'natural-nt',forcing:'none'});
  });
  it.each(['2C P 2D P 3D','P P 2C P 2D P 3D','2C P 2D P 2H P 3C P 3D'])('strong club four-card natural minor is not a six-card repeat: %s', text => {
    expect(meaning(text)).toMatchObject({suitMinimum:4});
  });
  it('no-fit minor cue is an honest raw stopper inquiry without fabricated diamond support', () => {
    const m=meaning('1D 2H 3H');
    // No public fit: opening12 plus inquiry13 establishes the raw25 game floor.
    expect(m).toMatchObject({role:'cue',hcpRange:{min:13,max:40},forcing:'one-round'});
    expect(m.supportRange).toBeUndefined(); expect(m.suitMinimums.D).toBeUndefined();
    expect(publicPlayerConstraints(auction('1D 2H 3H'),'S').suitMinimums.D).toBe(0);
  });
  it('negative double natural answer shows four; its responder later five-card continuation is a new public fact', () => {
    expect(meaning('1C 1H X P 1S')).toMatchObject({suitMinimum:4});
    expect(meaning('P P 1D 2S X P 3C P 3H')).toMatchObject({role:'responder-second-suit',suitMinimum:5,hcpRange:{min:10,max:12},forcing:'none'});
  });
  it('semiNT weak five-card new major differs from a naturally responding hand second four-card major', () => {
    expect(meaning('1S P 1NT P 2C P 2H')).toMatchObject({role:'semi-nt-new-major',suitMinimum:5,hcpRange:{min:5,max:12},forcing:'none'});
    expect(meaning('1C P 1S P 2C P 2H')).toMatchObject({role:'responder-second-suit',suitMinimum:4,hcpRange:{min:6,max:40},forcing:'one-round'});
  });
  it('accepting a supported minor invitation publishes a joint floor, not a fictional individual floor', () => {
    const a=auction('2D X P 3C P 4C P 5C');
    expect(publicCallMeaningAt(a,7)).toMatchObject({role:'accepted-invitation',suitMinimum:3,jointSupportFloor:{trump:'C',total:29,invitationIndex:5}});
    expect(publicCallMeaningAt(a,7).supportRange).toBeUndefined();
    expect(publicPlayerConstraints(a,'W')).toMatchObject({hcpRange:{min:0,max:40},jointSupportSources:[{index:7,trump:'C',total:29,invitationIndex:5}]});
  });
  it('opener stopper cue after a natural five-card responder suit does not invent support', () => {
    const m=meaning('1C 1S 2D P 2S');
    // Competitive2D promises10, so the unsupported stopper cue needs15 raw.
    expect(m).toMatchObject({role:'cue',hcpRange:{min:15,max:21}});
    expect(m.suitMinimums.D).toBeUndefined();
    expect(meaning('1C 1S 2D P 2NT')).toMatchObject({role:'natural-nt',hcpRange:{min:12,max:14}});
  });
  it('negative-double game support retains four, and Precision positive support may be three', () => {
    expect(meaning('1C 1H X P 3S P 4S')).toMatchObject({suitMinimum:4,role:'accepted-invitation',jointSupportFloor:{trump:'S',total:25,invitationIndex:4}});
    expect(meaning('1C 1S 2H P 4H','precision')).toMatchObject({suitMinimum:3,role:'natural-support'});
    expect(meaning('1C 1S 2H P 4H','precision').supportRange).toBeUndefined();
  });
  it('a new minor in 2/1 force remains a four-card natural description', () => {
    expect(meaning('1S P 2D P 2S P 3C')).toMatchObject({role:'responder-second-suit',suitMinimum:4,forcing:'game'});
  });
  it('forced original-major returns after reverse or strong jump need five, not quiet-six', () => {
    expect(meaning('1C P 1S P 2H P 2S')).toMatchObject({suitMinimum:5});
    expect(meaning('1H P 1S P 3D P 3S')).toMatchObject({suitMinimum:5,forcing:'game'});
  });
  it('true opener jump supports the public four-card response with four and sixteen-to-eighteen support', () => {
    expect(meaning('1D P 1H 1S 3H')).toMatchObject({suitMinimum:4,supportRange:{trump:'H',min:16,max:18},invitation:true});
    expect(meaning('1D P 1H 2S 3H').invitation).toBe(false);
  });
  it('Precision fixed shape replies are typed information and the known four-card major allows four-card support', () => {
    expect(meaning('2C','precision')).toMatchObject({role:'precision-opening',hcpRange:{min:11,max:15},suitMinimum:5,artificial:false});
    expect(meaning('2D','precision')).toMatchObject({role:'precision-opening',hcpRange:{min:11,max:15},suitMinimums:{C:4,H:3,S:3},suitMaximums:{D:1},artificial:true});
    expect(meaning('2D P 2NT P 3H','precision')).toMatchObject({role:'precision-answer',suitMinimums:{S:4,H:3,D:1,C:5},hcpRange:{min:11,max:15},artificial:true});
    expect(meaning('2D P 2NT P 3H P 4S','precision')).toMatchObject({role:'natural-support',suitMinimum:4});
    expect(meaning('2D P 2NT P 3S P 4H','precision')).toMatchObject({role:'natural-support',suitMinimum:4});
  });
  it('weak-two blocking raises do not acquire a six-point constructive support promise', () => {
    expect(meaning('2S P 3S').supportRange).toBeUndefined();
  });
  it('first support cue for the advancer new major preserves the overcaller own original suit', () => {
    const a=auction('1D 1S P 2H P 3D'),m=publicCallMeaningAt(a,5);
    expect(m).toMatchObject({role:'cue',supportRange:{trump:'H',min:10,max:40},suitMinimums:{H:3},forcing:'one-round'});
    expect(m.hcpRange).toBeUndefined();
    expect(publicPlayerConstraints(a,'E')).toMatchObject({hcpRange:{min:8,max:16},suitMinimums:{S:5,H:3}});
  });
  it('long-source compensation is a public alternative while ordinary suit length stays five', () => {
    expect(meaning('2S 3D')).toMatchObject({suitMinimum:5,hcpRange:{min:7,max:16},playingSourceCompensation:{normalHcpMinimum:10,minHcp:7,minLength:8,minKingOrAce:1,minTenOrHigher:3}});
    expect(meaning('1H 2D 2S')).toMatchObject({suitMinimum:5,hcpRange:{min:9,max:40},playingSourceCompensation:{normalHcpMinimum:10,minHcp:9,minLength:8,minQueenOrHigher:2,minTenOrHigher:3}});
    expect(meaning('1C 1S 2H','precision')).toMatchObject({hcpRange:{min:8,max:40}});
  });
  it('weak-two strong responder bounded four-minor correction publishes its original-suit shortage', () => {
    expect(meaning('2S P 3H P 3S P 4C')).toMatchObject({role:'weak-preempt-minor-correction',hcpRange:{min:16,max:40},suitMinimum:4,suitMaximums:{S:1},forcing:'none'});
    expect(meaning('2S P 4C').role).not.toBe('weak-preempt-minor-correction');
    expect(meaning('1S P 2H P 3S P 4C').role).not.toBe('weak-preempt-minor-correction');
  });
  it.each(['3C','3D','3H','3S'])('Precision artificial shape answer %s requires a natural continuation, then the duty expires', answer => {
    const text=`2D P 2NT P ${answer} P`;
    expect(analyzeAuctionSemantics(auction(text),'S','precision')).toMatchObject({forcing:'one-round',mustBid:true,currentContractArtificial:true});
    expect(meaning(`2D P 2NT P ${answer}`,'precision')).toMatchObject({role:'precision-answer',forcing:'one-round',artificial:true});
    expect(analyzeAuctionSemantics(auction(`${text} 3NT P`),'N','precision')).toMatchObject({forcing:'none',mustBid:false,currentContractArtificial:false});
  });
  it('Precision natural club-query answers are playable while natural major supports finish shape inquiry', () => {
    expect(analyzeAuctionSemantics(auction('2C P 2D P 2H P'),'S','precision')).toMatchObject({forcing:'none',mustBid:false,currentContractArtificial:false});
    expect(analyzeAuctionSemantics(auction('2D P 2NT P 3H P 4S P'),'N','precision')).toMatchObject({forcing:'none',mustBid:false,currentContractArtificial:false});
    expect(analyzeAuctionSemantics(auction('2D P 2NT P 3S P 4H P'),'N','precision')).toMatchObject({forcing:'none',mustBid:false,currentContractArtificial:false});
  });
});

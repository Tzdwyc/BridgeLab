import { beforeEach, expect, it, vi } from 'vitest';
import { suggestSystemBid } from '../src/ai/bid-strategy';
import { suggestSLBid } from '../src/ai/neural/browser-model';
import { parseAuction } from './fixtures/android-stack-incident';
import { legalCalls } from '../src/core/auction';
import { SEATS, type Card, type Suit } from '../src/core/types';
import type { BiddingObservation } from '../src/ai/observation';
vi.mock('../src/ai/neural/browser-model',()=>({suggestSLBid:vi.fn(),recordAppliedSLBid:vi.fn()}));
function obs(prefix:string, holding='KQ4.J83.A65.9872'):BiddingObservation {
 const auction=parseAuction(prefix),seat=SEATS[auction.length%4];
 const hand=holding.split('.').flatMap((p,i)=>[...p].map(r=>({suit:(['S','H','D','C'] as Suit[])[i],rank:'23456789TJQKA'.indexOf(r)+2,id:`${i}${r}`}))) as Card[];
 return {board:1,seat,actingSeat:seat,phase:'auction',vulnerability:'None',hand,auction,legalCalls:legalCalls(auction,seat)};
}
beforeEach(()=>{vi.resetAllMocks();});
it.each(['seed101-epoch08','original-sl'])('the actual dispatcher executes Drury with %s',async profileId=>{
 vi.mocked(suggestSLBid).mockResolvedValue({call:{kind:'pass'},trace:{profileId,call:{kind:'pass'},route:'sl-legal',baselineCall:{kind:'pass'}}} as any);
 const selected=await suggestSystemBid(obs('P P 1S P'),{system:'two-over-one'});
 expect(selected.call).toEqual({kind:'bid',level:2,strain:'C'});expect(selected.trace?.route).toBe('agreement-flow');expect(selected.trace?.profileId).toBe(profileId);
});
it('SAYC does not inherit the old model refusal of a 10-point two-level response',async()=>{
 vi.mocked(suggestSLBid).mockResolvedValue({call:{kind:'pass'},trace:{profileId:'seed101-epoch08',call:{kind:'pass'},route:'sl-legal',baselineCall:{kind:'pass'}}} as any);
 const o=obs('1S P','K4.Q83.A65.J9872');
 const selected=await suggestSystemBid(o,{system:'sayc'});
 expect(selected.call).toEqual({kind:'bid',level:2,strain:'C'});expect(selected.trace?.route).toBe('agreement-flow');
});

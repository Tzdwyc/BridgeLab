import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { analyzeAuctionSemantics, publicPlayerConstraints, publicCallMeaningAt, publicStrongMinorTrialAt } from '../src/ai/bidding-semantics';
import { feasiblePublicKeycardCounts, publicSupportMinimum } from '../src/ai/suit-evaluation';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS, partnerOf } from '../src/core/types';

const call = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
function position(seat: Seat, holding: string, prefix: string): BiddingObservation {
  const hand: Card[] = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map(token => {
    const [actor, text] = token.split(':'); return { seat: actor as Seat, call: call(text) };
  });
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat,
    hand, auction, legalCalls: legalCalls(auction, seat) };
}
it('7519 safe Pass cannot reintroduce a rejected sixteen-point four-minor bid',()=>{
 const o=position('N','A.K7.QJT762.K873','W:P N:1D E:P S:1S W:2H N:P E:3D S:3S W:P');
 expect(publicCallMeaningAt([...o.auction,{seat:o.seat,call:call('4D')}],o.auction.length,'sayc').hcpRange?.min).toBe(16);
 expect(chooseBid(o,'sayc')).toEqual(PASS);
});
const transferHeartGame='S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P N:4D E:P S:4H W:P';
it('post-game control cue needs actual spade control and33 support',()=>{
 expect(chooseBid(position('N','A53.AQ974.JT754.-',transferHeartGame),'sayc')).toEqual(call('4S'));
 expect(chooseBid(position('N','Q53.AQ974.JT754.-',transferHeartGame),'sayc')).not.toEqual(call('4S'));
 expect(chooseBid(position('N','A53.Q9743.T8754.-',transferHeartGame),'sayc')).not.toEqual(call('4S'));
});
it('Precision negative responder may invite the completed16-18 NT platform withseven',()=>{
 const o=position('N','T98.T98.T987.AK2','S:1C W:P N:1D E:P S:1NT W:P');
 expect(chooseBid(o,'precision')).toEqual(call('2NT'));
});
it('7702 entire public auction explores controls before keycards and stops at small slam',()=>{
 const hands:Record<Seat,string>={S:'KQ8.K63.AK9.AK76',W:'JT9762.52.-.98432',N:'A53.AQ974.JT754.-',E:'4.JT8.Q8632.QJT5'};
 const seats:Seat[]=['S','W','N','E'];const tokens:string[]=[];
 for(let step=0;step<40;step++){
  const seat=seats[step%4];const chosen=chooseBid(position(seat,hands[seat],tokens.join(' ')),'sayc');
  const text=chosen.kind==='pass'?'P':chosen.kind==='double'?'X':chosen.kind==='redouble'?'XX':`${chosen.level}${chosen.strain}`;
  tokens.push(`${seat}:${text}`);
  if(tokens.length>4&&tokens.slice(-3).every(token=>token.endsWith(':P')))break;
 }
 expect(tokens.join(' ')).toBe('S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P N:4D E:P S:4H W:P N:4S E:P S:4NT W:P N:5S E:P S:6H W:P N:P E:P');
});

import fs from 'node:fs';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
const source = JSON.parse(fs.readFileSync('artifacts/v033-release7-auctions.json', 'utf8'));
const refs = process.argv.slice(2).length ? process.argv.slice(2) : ['553/7','647/13','744/8','754/6','779/6','795/9','818/10','825/11','827/5','830/5','845/5','856/8','1118/5','1187/6','4092/11','4144/9','4209/7','4225/9','4242/14','4253/10','4255/8','4352/5','4362/5','4449/8','7759/10','7805/10'];
const parse = (text: string): Call => text === 'P' ? PASS : text === 'X' ? {kind:'double'} : text === 'XX' ? {kind:'redouble'} : {kind:'bid', level:Number(text[0]), strain:text.slice(1) as Strain};
for (const ref of refs) {
  const [id, step] = ref.split('/').map(Number), board = source.boards.find((b: any) => b.board === id), old = board.steps.find((s: any) => s.step === step);
  if (!old) { console.log(ref, 'missing'); continue; }
  const hand: Card[] = old.hand.split('.').flatMap((text: string, index: number) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S','H','D','C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol)+2; return {suit,rank,id:`${suit}${rank}`};
  }));
  const auction: AuctionEntry[] = board.steps.slice(0,step-1).map((s: any) => ({seat:s.seat as Seat,call:parse(s.call)}));
  const decision = chooseBid({phase:'auction',board:id,vulnerability:board.vulnerability,seat:old.seat,actingSeat:old.seat,hand,auction,legalCalls:legalCalls(auction,old.seat)}, 'sayc');
  const text = decision.kind==='bid'?`${decision.level}${decision.strain}`:decision.kind;
  console.log(JSON.stringify({ref,hand:old.hand,hcp:old.hcp,lengths:evaluateHand(hand).lengths,prefix:board.steps.slice(0,step-1).map((s:any)=>`${s.seat}:${s.call}`).join(' '),old:old.call,current:text,meaning:publicCallMeaningAt([...auction,{seat:old.seat,call:decision}],auction.length,'sayc'),hover:describeCall(auction,old.seat,decision,'sayc'),partner:publicPlayerConstraints(auction,({N:'S',S:'N',E:'W',W:'E'} as any)[old.seat],'sayc')}));
  if (process.env.BRIDGE_PROBE_CANDIDATES) for (const value of process.env.BRIDGE_PROBE_CANDIDATES.split(',')) {
    const candidate = parse(value);
    console.log(JSON.stringify({ref,candidate:value,meaning:publicCallMeaningAt([...auction,{seat:old.seat,call:candidate}],auction.length,'sayc')}));
  }
}

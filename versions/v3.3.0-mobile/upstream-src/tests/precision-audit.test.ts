import {it,expect} from 'vitest';
import {writeFileSync,mkdirSync} from 'node:fs';
import {describeCall} from '../src/ai/bidding';
import {publicCallMeaningAt,clearPublicMeaningCaches} from '../src/ai/bidding-semantics';
import {diagnosePrecisionBid} from '../src/ai/precision';
import {auctionStatus,legalCalls,sameCall} from '../src/core/auction';
import {deal} from '../src/core/deal';
import {type AuctionEntry,SEATS} from '../src/core/types';
import {auction,allCalls,text} from './precision-fixtures';
const evidenceDirectory=process.env.PRECISION_EVIDENCE_DIRECTORY??'../artifacts/precision/';
mkdirSync(new URL(evidenceDirectory,import.meta.url),{recursive:true});
const lines=[
 '1C X XX P 1S P 3NT P P P',
 '1C X XX 1H 1S P 3NT P P P',
 '1C X XX 3H', '1C X 1D 3H', '1C X XX 2NT',
 '1C X 1D P 1S P P P',
 '1C X 1D P 1H P 1S P 2S P P P',
 '1C 1H 2H P 2S P 3C P 3NT P P P',
 '1C 2H 3H P 3NT P P P',
 '1C 2H 3H P 3S P 4C P 5C P P P',
 '1D P 1S P 2H P 3D P P P',
 '1D P 1S P 2H P 2NT P P P',
 '1D P 2C P 2H P 3D P P P',
 '1H P 2C P 2S P 3H P P P',
 '1H P 2D P 2S P 2NT P P P',
 '1C 1H 1NT P 3NT P P P',
 '1C 2H 3NT P P P',
 '1C 1H 2NT P 3NT P P P',
 '1C P 1D P 1H P P P',
 '1C P 1D P 1NT P 2NT P 3NT P P P',
 '1C P 1H P 2H P 4NT P 5D P 6H P P P',
 '1C 1H P P 1S P 2S P 4S P P P',
 '1C 1H 2C P 2D P 3NT P P P',
 'P P 1C P 1H P 2H P 4H P P P',
 '1D P 1H P 1NT P P P',
 '1S P 1NT P 2S P P P',
 '2C P 2D P 2H P 4H P P P',
 '2C P 2D P 2NT P 3C P P P',
 '2C P 2D P 3C P P P',
 '2D P 2NT P 3C P 4H P P P',
 '2D P 2NT P 3D P 4S P P P',
 '2D P 2NT P 3H P 3NT P P P',
 '2D P 2NT P 3S P 4H P P P',
 '1NT P 2C P 2H P 2S P 2NT P P P',
 '1NT P 2D X 2H P 2NT P 3NT P P P',
 '1D 1NT P 2C P 2D P 3NT P P P',
 '1H X P 2C P 2D P P P',
 '1H 1S P 2H P 2S P P P',
 '1C X', '1C 1NT','1C 3H','1C 1H 2H'
];
it('records all 38 legal and unavailable call descriptions for every distinct tested historical prefix',()=>{
 const unique=new Map<string,AuctionEntry[]>();for(const line of lines){const a=auction(line);for(let i=0;i<=a.length;i++){const p=a.slice(0,i);if(!auctionStatus(p).ended)unique.set(JSON.stringify(p),p);}}
 const snapshots=[];let historicalChecks=0;
 for(const a of unique.values()){
  const seat=SEATS[a.length%4],legal=legalCalls(a,seat),rows=[];
  for(const c of allCalls){const full=[...a,{seat,call:c}],m=publicCallMeaningAt(full,a.length,'precision'),description=describeCall(a,seat,c,'precision');expect(description.length).toBeGreaterThan(3);if(m.hcpRange)expect(m.hcpRange.min).toBeLessThanOrEqual(m.hcpRange.max);
   rows.push({call:text(c),legal:legal.some(v=>sameCall(v,c)),meaning:m,description});}
  expect(rows).toHaveLength(38);
  for(let i=0;i<a.length;i++){clearPublicMeaningCaches();const before=publicCallMeaningAt(a.slice(0,i+1),i,'precision');clearPublicMeaningCaches();const after=publicCallMeaningAt([...a,{seat,call:{kind:'bid',level:7,strain:'NT'}}],i,'precision');expect(after).toEqual(before);historicalChecks++;}
  snapshots.push({prefix:a.map(e=>`${e.seat}:${text(e.call)}`).join(' '),rows});
 }
 writeFileSync(new URL(`${evidenceDirectory}precision-all38-prefixes.json`,import.meta.url),JSON.stringify({scope:'public semantic consistency; not proof of strategic correctness',prefixes:snapshots.length,descriptions:snapshots.length*38,historicalChecks,snapshots},null,2));
 console.log(JSON.stringify({prefixes:snapshots.length,descriptions:snapshots.length*38,historicalChecks}));
},60000);
it('runs 32 reproducible complete deals through the typed research decision boundary',()=>{
 const boards=[];let completed=0,unsupported=0,actions=0;
 for(let i=0;i<32;i++){
  const seed=`precision-regression-${i}`,hands=deal(seed),a:AuctionEntry[]=[],decisions=[];let issue:unknown;
  for(let step=0;step<80&&!auctionStatus(a).ended;step++){
   const seat=SEATS[(i+step)%4],o={phase:'auction' as const,board:i+1,seat,actingSeat:seat,vulnerability:'None' as const,auction:a,hand:hands[seat],legalCalls:legalCalls(a,seat)};
   const all38=allCalls.map(c=>({call:text(c),legal:o.legalCalls.some(v=>sameCall(v,c)),meaning:publicCallMeaningAt([...a,{seat,call:c}],a.length,'precision'),description:describeCall(a,seat,c,'precision')}));expect(all38).toHaveLength(38);
   const decision=diagnosePrecisionBid(o);actions++;
   if(decision.status==='unsupported'){unsupported++;issue={...decision,candidates:decision.candidates.map(c=>({call:text(c.call),allowed:c.allowed,reasons:c.reasons,meaning:c.meaning}))};break;}
   expect(o.legalCalls.some(c=>sameCall(c,decision.call))).toBe(true);
   decisions.push({seat,call:text(decision.call),description:describeCall(a,seat,decision.call,'precision'),all38});a.push({seat,call:decision.call});
  }
  if(auctionStatus(a).ended)completed++;
  else if(!issue)issue={code:'step-limit'};
  boards.push({seed,hands,auction:a,decisions,issue});
 }
 writeFileSync(new URL(`${evidenceDirectory}precision-random32.json`,import.meta.url),JSON.stringify({boards:32,completed,unsupported,actions,descriptions:actions*38,scope:'full deals with own-hand/public-prefix decision input; unsupported boards are stopped and retained',results:boards},null,2));
 console.log(JSON.stringify({randomBoards:32,completed,unsupported,actions}));expect(completed+unsupported).toBe(32);
},60000);

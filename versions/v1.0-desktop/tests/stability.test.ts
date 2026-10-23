import { it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SEATS, STRAINS, sideOf } from '../src/core/types';
import { newGame, assertGameIntegrity, isFinished, replay, toRecord } from '../src/core/game';
import { legalCards } from '../src/core/play';
import { robotStep } from '../src/controller/robot';
import { scoreContract } from '../src/core/scoring';

it('1,000 seeded random automatic boards: legal, unique, finite, correctly scored', async () => {
  const started=Date.now();const stats={boards:1000,completed:0,passedOut:0,actions:0,plays:0,maxActions:0,aiFallbacks:0,contracts:Object.fromEntries(STRAINS.map(s=>[s,0])),declarers:Object.fromEntries(SEATS.map(s=>[s,0]))};
  for(let board=1;board<=1000;board++) {
    let g=newGame(board,`BridgeLab-stability-v1-${board}`);assertGameIntegrity(g);
    for(let guard=0;guard<400&&!isFinished(g);guard++) {
      const before=g;const result=robotStep(g);g=result.game;
      if(result.warning)stats.aiFallbacks++;
      const action=g.actions.at(-1)!;
      if(action.kind==='play') {
        expect(legalCards(before.hands[before.turn],before.currentTrick).some(c=>c.id===action.cardId)).toBe(true);stats.plays++;
      }
      assertGameIntegrity(g);
    }
    expect(isFinished(g),`Board ${board} must finish`).toBe(true);stats.actions+=g.actions.length;stats.maxActions=Math.max(stats.maxActions,g.actions.length);
    if(g.phase==='passedOut'){stats.passedOut++;expect(g.auction).toHaveLength(4);expect(g.result?.scoreNS).toBe(0);}
    else {
      stats.completed++;expect(g.completedTricks).toHaveLength(13);expect(g.tricksWon.NS+g.tricksWon.EW).toBe(13);expect(g.actions.filter(a=>a.kind==='play')).toHaveLength(52);
      const contract=g.contract!;stats.contracts[contract.strain]++;stats.declarers[contract.declarer]++;
      const vulnerable=g.vulnerability==='Both'||g.vulnerability===sideOf(contract.declarer);
      const score=scoreContract(contract,g.result!.declarerTricks,vulnerable).total;
      expect(g.result!.scoreNS).toBe(score*(sideOf(contract.declarer)==='NS'?1:-1));
    }
    if(board%100===0)expect(replay(toRecord(g))).toEqual(g);
    // Keep the worker responsive to the test runner during the long CPU loop.
    if(board%25===0)await new Promise<void>(resolve=>setTimeout(resolve,0));
  }
  expect(stats.completed).toBeGreaterThan(0);expect(stats.passedOut).toBeGreaterThan(0);expect(stats.aiFallbacks).toBe(0);
  const report={...stats,passed:true,seedPattern:'BridgeLab-stability-v1-{1..1000}',elapsedMs:Date.now()-started,executedAt:new Date().toISOString()};
  mkdirSync(resolve('artifacts'),{recursive:true});writeFileSync(resolve('artifacts/stability.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}, 180000);

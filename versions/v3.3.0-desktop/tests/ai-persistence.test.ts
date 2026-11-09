import { describe, expect, it } from 'vitest';
import { type Card, type Call, PASS, SEATS } from '../src/core/types';
import { applyCall, controllerFor, isFinished, newGame, playCard, replay, toRecord } from '../src/core/game';
import { legalCards } from '../src/core/play';
import { legalCalls, sameCall } from '../src/core/auction';
import { observe, type BiddingObservation, type PlayObservation } from '../src/ai/observation';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { chooseCard } from '../src/ai/playing';
import { robotStep, naturalStrategy } from '../src/controller/robot';
import { decodeSession, encodeSession, emptySession, loadSession, STORAGE_KEY } from '../src/persistence/session';

const c = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}${rank}`, suit, rank });
const finish = (seed: string, board = 1) => {
  let g = newGame(board, seed); let count = 0;
  while (!isFinished(g) && count++ < 400) g = robotStep(g).game;
  expect(isFinished(g)).toBe(true); return g;
};
const playStart = () => {
  let g = newGame(1, 'observe');
  for (const call of [{ kind:'bid',level:1,strain:'NT' },PASS,PASS,PASS] as Call[]) g=applyCall(g,g.turn,call);
  return g;
};

describe('restricted observations and basic AI', () => {
  it('evaluates HCP, suit length and balanced shapes', () => {
    const hand = [c('S',14),c('S',13),c('S',12),c('S',11),c('H',10),c('H',9),c('H',8),c('D',7),c('D',6),c('D',5),c('C',4),c('C',3),c('C',2)];
    expect(evaluateHand(hand)).toEqual({ hcp:10,lengths:{C:3,D:3,H:3,S:4},balanced:true });
  });
  it('1NT requires balanced 15–17 HCP', () => {
    let candidate: BiddingObservation | null = null;
    for (let i=0;i<1000;i++) {
      const obs=observe(newGame(1,`NT-${i}`)) as BiddingObservation;
      const hand=evaluateHand(obs.hand); if(hand.balanced&&hand.hcp>=15&&hand.hcp<=17) { candidate=obs;break; }
    }
    expect(candidate).not.toBeNull(); expect(chooseBid(candidate!)).toEqual({kind:'bid',level:1,strain:'NT'});
  });
  it('raises partners major with a three-card fit and responding strength', () => {
    let g=newGame(3,'response'); g=applyCall(g,'S',{kind:'bid',level:1,strain:'S'});g=applyCall(g,'W',PASS);
    const obs=observe(g) as BiddingObservation;
    obs.hand=[c('S',14),c('S',7),c('S',6),c('H',13),c('H',8),c('H',4),c('D',11),c('D',9),c('D',5),c('C',10),c('C',8),c('C',6),c('C',3)];
    expect(chooseBid(obs)).toEqual({kind:'bid',level:2,strain:'S'});
  });
  it('auction observation contains only own hand and public information', () => {
    const g=newGame(1,'private'); const obs=observe(g) as BiddingObservation;
    expect(obs.hand).toEqual(g.hands.N); expect(Object.keys(obs).sort()).toEqual(['actingSeat','auction','board','hand','legalCalls','phase','seat','vulnerability'].sort());
    obs.hand[0].rank=99; expect(g.hands.N[0].rank).not.toBe(99);
  });
  it('opening leader cannot see dummy or declarers hand before opening lead', () => {
    const g=playStart(); const obs=observe(g) as PlayObservation;
    expect(obs.seat).toBe('E'); expect(obs.dummy).toBeNull(); expect(obs.hand).toEqual(g.hands.E);
    expect(obs.actingHand).toEqual(g.hands.E); expect(obs).not.toHaveProperty('hands'); expect(obs).not.toHaveProperty('seed');
  });
  it('declarer AI sees its own hand and revealed dummy, controls dummy play', () => {
    let g=playStart();g=playCard(g,'E',g.hands.E[0].id);
    const obs=observe(g) as PlayObservation;
    expect(controllerFor(g)).toBe('N');expect(obs.seat).toBe('N');expect(obs.actingSeat).toBe('S');
    expect(obs.hand).toEqual(g.hands.N);expect(obs.actingHand).toEqual(g.hands.S);expect(obs.dummy?.cards).toEqual(g.hands.S);
    const next=robotStep(g).game;expect(next.actions.at(-1)?.seat).toBe('S');
  });
  it('defender sees its own hand and public dummy; hidden-hand swaps do not affect strategy', () => {
    let g=playStart();g=playCard(g,'E',g.hands.E[0].id);g=playCard(g,'S',legalCards(g.hands.S,g.currentTrick)[0].id);
    expect(g.turn).toBe('W'); const altered=structuredClone(g);
    [altered.hands.N[0],altered.hands.E[0]]=[altered.hands.E[0],altered.hands.N[0]];
    const obs=observe(g) as PlayObservation;
    expect(obs.hand).toEqual(g.hands.W);expect(obs.dummy?.cards).toEqual(g.hands.S);
    expect(observe(altered)).toEqual(obs);expect(chooseCard(observe(altered) as PlayObservation)).toBe(chooseCard(obs));
  });
  it('bidding decisions do not change when all other hands are swapped', () => {
    const g=newGame(1,'same-public');const altered=structuredClone(g);[altered.hands.E,altered.hands.W]=[altered.hands.W,altered.hands.E];
    expect(observe(g)).toEqual(observe(altered));expect(chooseBid(observe(g) as BiddingObservation)).toEqual(chooseBid(observe(altered) as BiddingObservation));
  });
  it('throws or invalid AI bids recompute a legal public-information action rather than stall', () => {
    const g=newGame(1,'fallback');
    expect(robotStep(g,{...naturalStrategy,bid:()=>({kind:'double'})}).game.actions).toHaveLength(1);
    const result=robotStep(g,{...naturalStrategy,bid:()=>{throw new Error('test strategy error');}});
    expect(legalCalls(g.auction,g.turn).some(call=>sameCall(call,result.game.auction[0].call))).toBe(true);expect(result.warning).toContain('备用');
  });
  it('invalid and exception-throwing play strategies use a legal card', () => {
    const g=playStart();for(const play of [()=> 'NOT_A_CARD',()=>{throw new Error('test');}]) {
      const result=robotStep(g,{...naturalStrategy,play});expect(result.game.actions).toHaveLength(g.actions.length+1);expect(result.warning).not.toBeNull();
    }
  });
  it('even a strategy that mutates its observation cannot corrupt the engine or fallback', () => {
    const g=playStart();const before=structuredClone(g);
    const result=robotStep(g,{...naturalStrategy,play:obs=>{obs.legalCards.splice(0);obs.hand[0].rank=100;throw new Error('mutated observation');}});
    expect(g).toEqual(before);expect(result.game.actions).toHaveLength(g.actions.length+1);expect(result.warning).not.toBeNull();
  });
  it('never returns an illegal call or card across complete live games', () => {
    for(let i=0;i<30;i++) {
      let g=newGame(i+1,`legal-${i}`);let n=0;
      while(!isFinished(g)&&n++<400) {
        const obs=observe(g);
        if(obs.phase==='auction') expect(legalCalls(g.auction,g.turn).some(c=>sameCall(c,chooseBid(obs)))).toBe(true);
        else expect(legalCards(g.hands[g.turn],g.currentTrick).some(c=>c.id===chooseCard(obs))).toBe(true);
        expect(robotStep(g).warning).toBeNull();g=robotStep(g).game;
      }
      expect(isFinished(g)).toBe(true);
    }
  });
});

describe('versioned save, replay, meaningful undo', () => {
  it('round trips an auction save, including unicode seed', () => {
    let game=newGame(1,'固定牌例甲');game=robotStep(game).game;
    const s={...emptySession(),game};expect(decodeSession(encodeSession(s))).toEqual(s);
  });
  it('round trips a completed board and next board with cumulative raw score', () => {
    const first=finish('saved-board');const s={...emptySession(),game:newGame(2,'next'),history:[first]};
    expect(decodeSession(encodeSession(s))).toEqual(s);
  });
  it('restores play phase by validating and replaying each actual action', () => {
    let game=playStart();for(let i=0;i<12;i++)game=robotStep(game).game;
    expect(replay(toRecord(game))).toEqual(game);expect(decodeSession(encodeSession({...emptySession(),game})).game).toEqual(game);
  });
  it('undo rewinds through following AI actions to a South human decision', () => {
    let game=newGame(1,'undo');while(game.turn!=='S')game=robotStep(game).game;
    const before=game;const point=game.actions.length;
    game=applyCall(game,'S',PASS);while(!isFinished(game)&&controllerFor(game)!=='S')game=robotStep(game).game;
    const saved=decodeSession(encodeSession({...emptySession(),game,undo:[point]}));
    const restored=replay({board:game.board,seed:game.seed,actions:saved.game!.actions.slice(0,saved.undo[0])});
    expect(restored).toEqual(before);expect(controllerFor(restored)).toBe('S');
  });
  it('reconstructs all played cards with no duplication on save/load', () => {
    const g=finish('whole-board');expect(SEATS.flatMap(s=>g.initialHands[s])).toHaveLength(52);expect(replay(toRecord(g))).toEqual(g);
  });
  it('rejects corrupt JSON, unknown versions, illegal actions and invalid undo points', () => {
    expect(()=>decodeSession('{bad')).toThrow();
    const file=JSON.parse(encodeSession({...emptySession(),game:newGame(1,'corrupt')}));
    file.version=2;expect(()=>decodeSession(JSON.stringify(file))).toThrow();file.version=1;
    file.playStrength='impossible';expect(()=>decodeSession(JSON.stringify(file))).toThrow();file.playStrength='challenge';
    file.current.actions=[{kind:'play',seat:'N',cardId:'S14'}];expect(()=>decodeSession(JSON.stringify(file))).toThrow();
    file.current.actions=[];file.undo=[0];expect(()=>decodeSession(JSON.stringify(file))).toThrow();
  });
  it('rejects unfinished history, negative board number and inconsistent sequence', () => {
    const file=JSON.parse(encodeSession({...emptySession(),game:newGame(1,'bad')}));
    file.history=[file.current];expect(()=>decodeSession(JSON.stringify(file))).toThrow();file.history=[];
    file.current.board=-1;expect(()=>decodeSession(JSON.stringify(file))).toThrow();file.current.board=2;expect(()=>decodeSession(JSON.stringify(file))).toThrow();
  });
  it('preserves a rejected save and recovers to a playable empty session', () => {
    const values=new Map([[STORAGE_KEY,'broken-json']]);const storage={getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>{values.set(key,value);}};
    const loaded=loadSession(storage);expect(loaded.session.game).toBeNull();expect(loaded.notice).toContain('备份');
    expect([...values.keys()].some(key=>key.includes('.rejected.'))).toBe(true);expect(values.get(STORAGE_KEY)).toBe('broken-json');
  });
  it('storage exceptions are recoverable without ending the application', () => {
    expect(loadSession({getItem:()=>{throw new Error('denied');},setItem:()=>{throw new Error('denied');}}).notice).toContain('仍可游戏');
  });
});

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { decodeSession, encodeSession, emptySession } from '../src/persistence/session';
import { replay, toRecord } from '../src/core/game';
import { observe, type PlayObservation } from '../src/ai/observation';
import { robotStepWithAdvisor } from '../src/controller/robot';
import { createMatch } from '../src/match/engine';
const original=JSON.parse(readFileSync('artifacts/v330-systems-drury-20261109/existing-board940.json','utf8')).record;
const record={...original,board:1,actions:original.actions.filter((a:any)=>a.kind==='call')};
describe('fixed product playing engine',()=>{
 it.each(['basic','standard','challenge'] as const)('old %s preferences load as challenge without changing the saved game',strength=>{
  const source=JSON.stringify({version:1,current:record,history:[],undo:[],delay:650,biddingSystem:'precision',gameSystem:'precision',playStrength:strength});
  const session=decodeSession(source);
  expect(session.playStrength).toBe('challenge');expect(toRecord(session.game!)).toEqual(record);
  expect(decodeSession(encodeSession(session)).playStrength).toBe('challenge');
 });
 it('keeps an old active match serializable while overriding only its runtime strength',()=>{
  const match=createMatch('v330-config',{mode:'imp',boardCount:8},{biddingSystem:'sayc',playStrength:'challenge'});
  match.config.playStrength='basic';
  const raw=JSON.stringify({version:1,current:match.boards[0].main,activeMatch:match,history:[],undo:[],delay:650,biddingSystem:'sayc',gameSystem:'sayc',playStrength:'basic'});
  const session=decodeSession(raw);expect(session.playStrength).toBe('challenge');
  expect(session.activeMatch!.config.playStrength).toBe('basic');
  expect(decodeSession(encodeSession(session)).playStrength).toBe('challenge');
 });
 it('new matches cannot select a weaker engine',()=>{
  expect(createMatch('v330-config',{mode:'imp',playStrength:'basic'},{biddingSystem:'sayc',playStrength:'standard'}).config.playStrength).toBe('challenge');
 });
 it('the actual robot entry requests challenge even if its caller passes basic',async()=>{
  const game=replay(record),o=observe(game) as PlayObservation;
  const advise=vi.fn(async()=>({cardId:o.legalCards[0].id,fallback:false,reasonTags:[],engine:'sampled-dds'} as any));
  await robotStepWithAdvisor(game,'precision','basic',{advise});
  expect(advise).toHaveBeenCalledTimes(1);expect(advise.mock.calls[0]).toBeDefined();
  expect((advise as any).mock.calls[0][0].strength).toBe('challenge');
 });
});

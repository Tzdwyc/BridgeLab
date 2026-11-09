import { describe, expect, it } from 'vitest';
import { applyCall, applyClaim, assertGameIntegrity, controllerFor, playCard, replay, toRecord, newGame } from '../src/core/game';
import { legalCards } from '../src/core/play';
import { PASS, type Call, type Strain } from '../src/core/types';
import { guaranteedClaimTricks } from '../src/controller/claim';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });

function southDeclarerAfterLead() {
  let game = newGame(1, 'claim-south-declarer');
  for (const call of [PASS, PASS, bid(1, 'NT'), PASS, PASS, PASS]) game = applyCall(game, game.turn, call);
  game = playCard(game, game.turn, legalCards(game.hands[game.turn], game.currentTrick)[0].id);
  expect(controllerFor(game)).toBe('S');
  return game;
}

function eastDeclarerOnOpeningLead() {
  let game = newGame(1, 'claim-east-declarer');
  for (const call of [PASS, bid(1, 'NT'), PASS, PASS, PASS]) game = applyCall(game, game.turn, call);
  expect(game.turn).toBe('S'); expect(controllerFor(game)).toBe('S');
  return game;
}

describe('DDS-adjudicated claim settlement', () => {
  it('records an accepted declarer-side claim, scores it, reloads it and preserves unplayed cards', () => {
    const before = southDeclarerAfterLead();
    const claimed = applyClaim(before, 'S', 7);
    expect(claimed.phase).toBe('complete');
    expect(claimed.claim).toEqual({ seat: 'S', tricks: 7, remainingTricks: 13 });
    expect(claimed.tricksWon).toEqual({ NS: 7, EW: 6 });
    expect(claimed.result?.declarerTricks).toBe(7);
    expect(claimed.actions.at(-1)).toEqual({ kind: 'claim', seat: 'S', tricks: 7 });
    expect(Object.values(claimed.hands).flat().length).toBe(51);
    assertGameIntegrity(claimed);
    expect(replay(toRecord(claimed))).toEqual(claimed);
  });

  it('settles a defender-side claim from the claiming partnership perspective', () => {
    const before = eastDeclarerOnOpeningLead();
    const claimed = applyClaim(before, 'S', 4);
    expect(claimed.tricksWon).toEqual({ NS: 4, EW: 9 });
    expect(claimed.result?.declarerTricks).toBe(9);
    assertGameIntegrity(claimed);
  });

  it('converts a DDS declarer total into the guaranteed remaining tricks for either side', () => {
    expect(guaranteedClaimTricks(southDeclarerAfterLead(), 'S', 8)).toBe(8);
    expect(guaranteedClaimTricks(eastDeclarerOnOpeningLead(), 'S', 9)).toBe(4);
  });

  it('rejects out-of-range, out-of-turn and post-settlement claims', () => {
    let beforeLead = newGame(1, 'claim-invalid');
    for (const call of [PASS, PASS, bid(1, 'NT'), PASS, PASS, PASS]) beforeLead = applyCall(beforeLead, beforeLead.turn, call);
    expect(() => applyClaim(beforeLead, 'S', 1)).toThrow('控制者');
    const playable = southDeclarerAfterLead();
    expect(() => applyClaim(playable, 'S', 14)).toThrow('不合法');
    const complete = applyClaim(playable, 'S', 0);
    expect(() => applyClaim(complete, 'S', 0)).toThrow('打牌阶段');
  });
});

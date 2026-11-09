import { newGameFromDeal, applyCall, playCard, assertGameIntegrity } from '../../src/core/game';
import { observe, type PlayObservation } from '../../src/ai/observation';
import { type Card, type Hands, type Seat, type Suit, type GameState, SEATS } from '../../src/core/types';

/** Constructed to match the supplied visible facts; this is NOT the user's original replay/seed. */
export const CROSSRUFF_PROVENANCE = 'synthetic_reconstruction';
export const crossruffCard = (id: string): Card => ({ id, suit: id[0] as Suit, rank: Number(id.slice(1)) });
const initialIds: Record<Seat, string[]> = {
  N: ['S14','S10','S9','S5','H8','H6','D13','D5','D3','C13','C12','C8','C5'],
  E: ['S13','S11','S4','H14','H9','H7','H5','D11','D10','D7','D6','C11','C2'],
  S: ['S12','S8','S7','S3','S2','H12','H3','H2','C14','C9','C7','C4','C3'],
  W: ['S6','H13','H11','H10','H4','D14','D12','D9','D8','D4','D2','C10','C6']
};
export const syntheticCrossruffPlays: [Seat, string][] = [
 ['E','H14'],['S','H12'],['W','H13'],['N','H6'],
 ['E','C2'],['S','C9'],['W','C6'],['N','C13'],
 ['N','C8'],['E','C11'],['S','C14'],['W','C10'],
 ['S','H3'],['W','H4'],['N','H8'],['E','H5'],
 ['N','C5'],['E','S11'],['S','C3'],['W','D8'],
 ['E','H9'],['S','H2'],['W','H10'],['N','S5'],
 ['N','D5'],['E','D6'],['S','S2'],['W','D4'],
 ['S','S12'],['W','S6'],['N','S14'],['E','S4'],
 ['N','S10'],['E','S13'],['S','S7'],['W','D2'],
 ['E','H7'],['S','S3'],['W','H11'],['N','D3'],
 ['S','C7'],['W','D9'],['N','C12'],['E','D7']
];
export function syntheticCrossruffState(): GameState {
 const hands = Object.fromEntries(Object.entries(initialIds).map(([seat, ids]) => [seat, ids.map(crossruffCard)])) as Hands;
 let state = newGameFromDeal(1, 'synthetic-reconstruction-v321-crossruff-not-user-seed', hands, 'N', 'EW');
 state = applyCall(state, 'N', {kind:'bid',level:4,strain:'S'});
 state = applyCall(state, 'E', {kind:'double'});
 for (const seat of ['S','W','N'] as const) state = applyCall(state,seat,{kind:'pass'});
 for (const [seat,id] of syntheticCrossruffPlays) state = playCard(state,seat,id);
 assertGameIntegrity(state);
 return state;
}
export function syntheticCrossruffObservation(): PlayObservation {
 return observe(syntheticCrossruffState()) as PlayObservation;
}

const counterexamplePrefixes = [{"name":"no_crossruff_needed_two_top_trumps","provenance":"synthetic_reconstruction","initialHands":{"N":["S14","S10","S9","S5","H8","H6","S8","D5","D3","C13","C12","C8","C5"],"E":["S13","S11","S4","H14","H9","H7","H5","D11","D10","D7","D6","C11","C2"],"S":["S12","D13","S7","S3","S2","H12","H3","H2","C14","C9","C7","C4","C3"],"W":["S6","H13","H11","H10","H4","D14","D12","D9","D8","D4","D2","C10","C6"]},"plays":[["E","H14"],["S","H3"],["W","H10"],["N","H6"],["E","C2"],["S","C9"],["W","C10"],["N","C12"],["N","C5"],["E","C11"],["S","C14"],["W","C6"],["S","S3"],["W","S6"],["N","S14"],["E","S4"],["N","S5"],["E","S11"],["S","S12"],["W","D2"],["S","C3"],["W","D9"],["N","C13"],["E","D6"],["N","H8"],["E","H5"],["S","H2"],["W","H13"],["W","H11"],["N","D5"],["E","H7"],["S","H12"],["S","C7"],["W","D8"],["N","C8"],["E","S13"],["E","H9"],["S","S7"],["W","H4"],["N","D3"],["S","S2"],["W","D4"],["N","S10"],["E","D7"]],"strain":"S"},{"name":"no_trump_contract","provenance":"synthetic_reconstruction","initialHands":{"N":["S14","S10","S9","S5","H8","H6","D13","D5","D3","C13","C12","C8","C5"],"E":["S13","S11","S4","H14","H9","H7","H5","D11","D10","D7","D6","C11","C2"],"S":["S12","S8","S7","S3","S2","H12","H3","H2","C14","C9","C7","C4","C3"],"W":["S6","H13","H11","H10","H4","D14","D12","D9","D8","D4","D2","C10","C6"]},"plays":[["E","H14"],["S","H3"],["W","H11"],["N","H8"],["E","H5"],["S","H2"],["W","H13"],["N","H6"],["W","S6"],["N","S14"],["E","S4"],["S","S3"],["N","C12"],["E","C2"],["S","C9"],["W","C6"],["N","C5"],["E","C11"],["S","C14"],["W","C10"],["S","C7"],["W","H4"],["N","C13"],["E","H9"],["N","C8"],["E","S13"],["S","C3"],["W","D4"],["N","D5"],["E","D6"],["S","S2"],["W","D2"],["E","S11"],["S","S12"],["W","D8"],["N","S5"],["S","H12"],["W","H10"],["N","D3"],["E","H7"],["S","S7"],["W","D9"],["N","S10"],["E","D7"]],"strain":"NT"},{"name":"must_draw_trumps_before_side_winners","provenance":"synthetic_reconstruction","initialHands":{"N":["S9","D14","C14","C9","S13","C7","D3","S10","H11","D5","S3","C13","S2"],"E":["S7","H13","H12","H3","D7","H2","C6","H9","D4","S4","S14","H6","C4"],"S":["S8","D2","C2","S6","C12","C3","H8","S11","D9","H10","C11","H5","D10"],"W":["D13","D12","D11","C5","D8","C8","H7","D6","S5","H14","C10","S12","H4"]},"plays":[["E","H3"],["S","H8"],["W","H7"],["N","H11"],["N","C9"],["E","C4"],["S","C11"],["W","C8"],["S","C3"],["W","C10"],["N","C7"],["E","C6"],["W","S12"],["N","S3"],["E","S4"],["S","S6"],["W","S5"],["N","S13"],["E","S14"],["S","S11"],["E","H6"],["S","H5"],["W","H4"],["N","S10"],["N","C13"],["E","D7"],["S","C12"],["W","C5"],["N","D3"],["E","D4"],["S","D10"],["W","D6"],["S","D9"],["W","D8"],["N","D5"],["E","H9"],["S","H10"],["W","H14"],["N","S2"],["E","H2"]],"strain":"S"}] as const;
export function syntheticCrossruffCounterexamples() {
 return counterexamplePrefixes.map(item=>{
  const hands=Object.fromEntries(SEATS.map(seat=>[seat,item.initialHands[seat].map(crossruffCard)])) as Hands;
  let state=newGameFromDeal(1,'synthetic-counterexample-not-user-replay',hands,'N','EW');
  state=applyCall(state,'N',{kind:'bid',level:4,strain:item.strain});
  state=applyCall(state,'E',{kind:'double'});
  for(const seat of ['S','W','N'] as const)state=applyCall(state,seat,{kind:'pass'});
  for(const [seat,id] of item.plays)state=playCard(state,seat,id);
  assertGameIntegrity(state);return {name:item.name,state};
 });
}

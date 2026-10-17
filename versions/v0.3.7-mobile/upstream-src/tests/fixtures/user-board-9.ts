import { type GameState, type Hands, type Suit, SEATS } from '../../src/core/types';
import { newGame, playCard, assertGameIntegrity } from '../../src/core/game';

// Transcribed from the user's screenshot; not an exported original save/seed.
const pbn = ['65.T52.QJ92.KT75', 'JT2.AKJ7.543.Q62', 'AK73.863.KT76.A9', 'Q984.Q94.A8.J843'];
export const USER_TRICKS = [
  ['S4', 'S5', 'S10', 'S13'], ['S14', 'S8', 'S6', 'S2'], ['S3', 'S9', 'D9', 'S11'],
  ['C5', 'C6', 'C14', 'C3'], ['C9', 'C11', 'C13', 'C2'], ['C7', 'C12', 'D6', 'C4'],
  ['S7', 'S12', 'D11', 'D3'], ['C10', 'D4', 'D7', 'C8'], ['D13', 'D14', 'D2', 'D5'],
  ['H4', 'H2', 'H7', 'H8'], ['D10', 'D8', 'D12', 'H11'], ['H5', 'H13', 'H3', 'H9'], ['H14', 'H6', 'H12', 'H10']
];
export function userBoardStates(): GameState[] {
  const hands = Object.fromEntries(SEATS.map((seat, index) => [seat, pbn[index].split('.').flatMap((ranks, suitIndex) => ranks.split('').map(rank => {
    const suit: Suit = (['S', 'H', 'D', 'C'] as const)[suitIndex]; const value = '23456789TJQKA'.indexOf(rank) + 2;
    return { id: `${suit}${value}`, suit, rank: value };
  }))])) as Hands;
  let state: GameState = { ...newGame(9, 'user-screenshot-reconstruction'), initialHands: hands, hands, phase: 'play',
    contract: { level: 2, strain: 'D', doubled: 0, declarer: 'S', dummy: 'N', leader: 'W' }, turn: 'W', trickLeader: 'W' };
  const states = [state];
  for (const card of USER_TRICKS.flat()) { state = playCard(state, state.turn, card); assertGameIntegrity(state); states.push(state); }
  return states;
}

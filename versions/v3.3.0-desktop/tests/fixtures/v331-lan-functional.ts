import { newGame, applyCall } from '../../src/core/game';
import { PASS, type Seat, type Strain } from '../../src/core/types';

/** Eight fixed functional inputs, independent of all policy-evaluation boards. */
export const LAN_FUNCTIONAL_CASES: { id: number; seed: string; humans: Seat[]; strain: Strain; declarer: Seat }[] = [
  { id: 1, seed: 'v331-lan-functional-01', humans: ['S'], strain: 'NT', declarer: 'N' },
  { id: 2, seed: 'v331-lan-functional-02', humans: ['N', 'S'], strain: 'NT', declarer: 'N' },
  { id: 3, seed: 'v331-lan-functional-03', humans: ['E', 'W'], strain: 'S', declarer: 'N' },
  { id: 4, seed: 'v331-lan-functional-04', humans: ['N', 'E', 'W'], strain: 'H', declarer: 'N' },
  { id: 5, seed: 'v331-lan-functional-05', humans: ['S', 'E'], strain: 'D', declarer: 'N' },
  { id: 6, seed: 'v331-lan-functional-06', humans: ['S'], strain: 'NT', declarer: 'N' },
  { id: 7, seed: 'v331-lan-functional-07', humans: ['N', 'S'], strain: 'S', declarer: 'N' },
  { id: 8, seed: 'v331-lan-functional-08', humans: ['N', 'S'], strain: 'D', declarer: 'N' }
];

export function functionalGame(item = LAN_FUNCTIONAL_CASES[0]) {
  let game = newGame(item.id, item.seed);
  while (game.turn !== item.declarer) game = applyCall(game, game.turn, PASS);
  game = applyCall(game, game.turn, { kind: 'bid', level: item.strain === 'NT' ? 3 : ['S', 'H'].includes(item.strain) ? 4 : 5, strain: item.strain });
  for (let n = 0; n < 3; n++) game = applyCall(game, game.turn, PASS);
  return game;
}

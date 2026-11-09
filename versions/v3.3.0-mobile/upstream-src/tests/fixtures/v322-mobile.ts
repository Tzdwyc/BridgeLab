import { applyCall, controllerFor, newGame, playCard } from '../../src/core/game';
import { legalCards } from '../../src/core/play';
import { PASS, STRAINS, type Seat } from '../../src/core/types';

/** Small legal UI fixtures, with no robot policy or strength evaluation. */
export function mobilePlay(declarer: Seat = 'E', doubled: 0 | 1 | 2 = 0) {
  let game = newGame(1, `v322-mobile-${declarer}-${doubled}`);
  while (game.turn !== declarer) game = applyCall(game, game.turn, PASS);
  game = applyCall(game, game.turn, { kind: 'bid', level: 3, strain: 'NT' });
  if (doubled) game = applyCall(game, game.turn, { kind: 'double' });
  if (doubled === 2) game = applyCall(game, game.turn, { kind: 'redouble' });
  for (let i = 0; i < 3; i++) game = applyCall(game, game.turn, PASS);
  for (let i = 0; i < 48; i++) {
    if (game.completedTricks.length && game.dummyRevealed && controllerFor(game) === 'S') break;
    game = playCard(game, game.turn, legalCards(game.hands[game.turn], game.currentTrick)[0].id);
  }
  return game;
}

export function mobileLongAuction() {
  let game = newGame(1, 'v322-mobile-long-auction');
  for (let i = 0; i < 18; i++) game = applyCall(game, game.turn, { kind: 'bid', level: Math.floor(i / 5) + 1, strain: STRAINS[i % 5] });
  return game;
}

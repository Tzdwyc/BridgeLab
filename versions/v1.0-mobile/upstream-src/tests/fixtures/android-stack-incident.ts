import { applyCall, newGame } from '../../src/core/game';
import { emptySession } from '../../src/persistence/session';
import { PASS, SEATS, type AuctionEntry, type Call, type Seat, type Strain } from '../../src/core/types';

export const incidentSeed = 'd6753ea2-3fef-4cc7-be8d-93eecd089602';
export const allBiddingButtons: Call[] = [PASS,
  ...Array.from({ length: 7 }, (_, i) => i + 1).flatMap(level =>
    (['C', 'D', 'H', 'S', 'NT'] as Strain[]).map(strain => ({ kind: 'bid' as const, level, strain }))),
  { kind: 'double' }, { kind: 'redouble' }];

export function parseAuction(text: string, dealer: Seat = 'N'): AuctionEntry[] {
  return text.split(' ').filter(Boolean).map((token, i) => ({ seat: SEATS[(SEATS.indexOf(dealer) + i) % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : { kind: 'bid', level: +token[0], strain: token.slice(1) as Strain } as Call }));
}

export function incidentGame() {
  let game = newGame(20, incidentSeed);
  for (const call of [PASS, { kind: 'bid', level: 2, strain: 'H' }, { kind: 'double' }] as Call[])
    game = applyCall(game, game.turn, call);
  return game;
}

export function incidentSession() {
  // Only board 20's seed/actions were reported. These are synthetic continuity
  // records, not recovered private games or evidence about boards 1–19.
  const history = Array.from({ length: 19 }, (_, i) => {
    let game = newGame(i + 1, `synthetic-history-${i + 1}`);
    for (let j = 0; j < 4; j++) game = applyCall(game, game.turn, PASS);
    return game;
  });
  return { ...emptySession(), game: incidentGame(), history, delay: 1100, playStrength: 'basic' as const };
}

import { registerHooks } from 'node:module';
import { statSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.startsWith('.') && context.parentURL?.startsWith('file:') && !/\.[cm]?[jt]s$/.test(specifier)) {
    for (const suffix of ['.ts', '/index.ts']) {
      const url = new URL(specifier + suffix, context.parentURL);
      if (statSync(fileURLToPath(url), { throwIfNoEntry: false })?.isFile()) return next(url.href, context);
    }
  }
  return next(specifier, context);
} });
const { deal, boardInfo } = await import('../src/core/deal.ts');
const seats = ['N', 'E', 'S', 'W'];
const parseCall = token => token === 'P' ? { kind: 'pass' }
  : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) };
const inputs = JSON.parse(readFileSync(new URL('../artifacts/v324-fixture-input.json', import.meta.url)));
const fixtures = inputs.map(row => {
  const { dealer, vulnerability } = boardInfo(row.sourceBoard);
  const hands = deal(row.seed);
  const actions = row.prefix.map((token, index) => ({ kind: 'call',
    seat: seats[(seats.indexOf(dealer) + index) % 4], call: parseCall(token) }));
  const current = { board: 1, seed: row.seed, actions, customSetup: { dealer, vulnerability, hands },
    biddingSystem: 'two-over-one', agreementVersion: 'two-over-one-v2.2' };
  return { id: row.id, expected: row.expected, turn: seats[(seats.indexOf(dealer) + actions.length) % 4],
    originalSourceBoard: row.sourceBoard,
    provenance: 'Original fixed seed, dealer, vulnerability, hands and prefix; board1 custom deal for existing session import; no AI generation',
    raw: JSON.stringify({ version: 1, current, undo: [], history: [], delay: 1100,
      biddingSystem: 'two-over-one', gameSystem: 'two-over-one', playStrength: 'basic' }) };
});
writeFileSync(new URL('../artifacts/v324-production-sessions.json', import.meta.url), JSON.stringify(fixtures, null, 2));
console.log(JSON.stringify(fixtures.map(({ id, expected, turn }) => ({ id, expected, turn }))));
// Existing UI seed, deterministic legal first-card replay only: no AI or DDS.
const { newGame, applyCall, playCard, toRecord, assertGameIntegrity, controllerFor } = await import('../src/core/game.ts');
const { legalCards } = await import('../src/core/play.ts');
let play = newGame(1, 'v322-mobile-E-0', { biddingSystem: 'two-over-one', agreementVersion: 'two-over-one-v2.2' });
play = applyCall(play, play.turn, parseCall('P'));
play = applyCall(play, play.turn, parseCall('3NT'));
for (let index = 0; index < 3; index++) play = applyCall(play, play.turn, parseCall('P'));
for (let index = 0; index < 48; index++) {
  const legal = legalCards(play.hands[play.turn], play.currentTrick);
  if (controllerFor(play) === 'S' && play.currentTrick.length > 0 && legal.length < play.hands.S.length) break;
  play = playCard(play, play.turn, legal[0].id);
}
assertGameIntegrity(play);
const legal = legalCards(play.hands[play.turn], play.currentTrick);
const illegal = play.hands.S.find(card => !legal.some(allowed => allowed.id === card.id));
if (play.turn !== 'S' || !illegal) throw Error('Expected existing UI seed to provide a South follow-suit restriction');
const notice = { id: 'play-notices', legalId: legal[0].id, illegalId: illegal.id, actions: play.actions.length,
  provenance: 'Existing v322-mobile-E-0 UI seed; fixed legal replay, no AI policy or strength run',
  raw: JSON.stringify({ version: 1, current: toRecord(play), undo: [], history: [], delay: 1100,
    biddingSystem: 'two-over-one', gameSystem: 'two-over-one', playStrength: 'basic' }) };
writeFileSync(new URL('../artifacts/v324-notice-session.json', import.meta.url), JSON.stringify(notice, null, 2));
console.log(JSON.stringify({ noticeActions: notice.actions, legalId: notice.legalId, illegalId: notice.illegalId }));
const snapshot = Object.fromEntries(['board', 'dealer', 'vulnerability', 'phase', 'auction', 'turn', 'contract',
  'dummyRevealed', 'currentTrick', 'completedTricks', 'tricksWon', 'result'].map(key => [key, play[key]]));
Object.assign(snapshot, { roomCode: 'QUI324', biddingSystem: 'two-over-one', agreementVersion: 'two-over-one-v2.2',
  revision: 24, seat: 'S', seats: { N: 'robot', E: 'robot', S: 'connected', W: 'robot' },
  readiness: { N: true, E: true, S: true, W: true }, status: 'active', controller: 'S', hand: play.hands.S,
  dummy: { seat: play.contract.dummy, hand: play.hands[play.contract.dummy] },
  handCounts: Object.fromEntries(seats.map(seat => [seat, play.hands[seat].length])),
  legalCalls: [], legalCardIds: legal.map(card => card.id), canNextBoard: false });
writeFileSync(new URL('../artifacts/v324-lan-notice-snapshot.json', import.meta.url), JSON.stringify(snapshot, null, 2));

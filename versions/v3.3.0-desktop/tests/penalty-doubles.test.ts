import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { adjustPenaltyDouble } from '../src/ai/penalty-doubles';
import type { BiddingObservation } from '../src/ai/observation';
import { getSLModelState, setLookaheadEnabled, setSLProfile } from '../src/ai/neural/browser-model';
import { robotStepWithAdvisor } from '../src/controller/robot';
import { legalCalls } from '../src/core/auction';
import { applyCall, newGameFromDeal } from '../src/core/game';
import { type Call, type Strain, type Suit, type Vulnerability, PASS, SEATS } from '../src/core/types';
import { createJoinNonce, LAN_SUPPORTED_AGREEMENTS, type RoomAction, type RoomResponse } from '../src/online/protocol';
import { LanRoom } from '../src/online/room';

const highLevelPrefix = '1H 1S 4H 4S';
const adequateDefense = 'AQT9.K9876.A84.J KJ876.5.KJT.Q932 2.AQT43.Q765.AT5 543.J2.932.K8764';
const shortTrump = '2.K9876.A84.KQJ2 AKQJ876.5.KJT.93 9.AQT43.Q765.AT5 T543.J2.932.8764';
const thinTrump = 'QJT9.AK876.K84.J AK876.5.AJT.Q932 2.QT943.Q765.AT5 543.J2.932.K8764';
const slamWithoutDefense = '2.K9876.T84.KQJ2 AKQJ876.5.AKQJ.A 9.AQT43.7652.T95 T543.J2.93.87643';
const twoTopTrumps = 'AK.K9876.AK84.QJ QJT9876.5.JT.932 2.AQT43.Q765.AT5 543.J2.932.K8764';
const slamPrefix = '1H 1S 4H 6S';
const diamondFitPrefix = '1D 1S 2D 3NT';
const strongNtDefense = 'AKT9.A84.A9876.J QJ876.KJT.5.Q932 2.Q765.KQT43.AT5 543.932.J2.K8764';
const thinNtDefense = 'KQJ9.KJ4.KQJ76.J AT876.QT8.5.Q932 2.A765.AT943.AT5 543.932.82.K8764';
type HighLevelCase = [description: string, deal: string, vulnerability: Vulnerability, desktop: string,
  baseline: string, prefix: string, lan?: string];
const highLevelCases: HighLevelCase[] = [
  ['vulnerable opponents and sufficient defense', adequateDefense, 'EW', 'X', 'X', highLevelPrefix],
  ['the same hand against nonvulnerable opponents', adequateDefense, 'None', 'P', 'X', highLevelPrefix],
  ['vulnerable opponents and a singleton trump', shortTrump, 'EW', 'P', 'P', highLevelPrefix],
  ['vulnerable opponents and only one top trump honor', thinTrump, 'EW', 'P', 'X', highLevelPrefix],
  ['a small slam and four strong trumps', adequateDefense, 'EW', 'X', 'X', slamPrefix],
  ['a small slam and insufficient defense', slamWithoutDefense, 'EW', 'P', 'P', slamPrefix],
  ['a small slam and the doubleton trump AK', twoTopTrumps, 'EW', 'X', 'X', slamPrefix],
  ['the same doubleton trump AK against a five-level contract', twoTopTrumps, 'EW', 'P', 'X', '1H 1S 4H 5S'],
  ['3NT where the estimated penalty beats the 5D ceiling', strongNtDefense, 'EW', 'X', 'X', diamondFitPrefix],
  ['the same 3NT when the vulnerable 5D ceiling is higher', strongNtDefense, 'Both', 'X', 'X', diamondFitPrefix, '5D'],
  ['3NT where the established defensive gate vetoes a double', thinNtDefense, 'EW', '5D', 'X', diamondFitPrefix],
];

function highLevelGame(deal: string, vulnerability: Vulnerability, prefix: string) {
  const [N, E, S, W] = deal.split(' ').map(cards);
  let game = newGameFromDeal(1, 'high-level-penalty', {
    N, E, S, W,
  }, 'N', vulnerability);
  for (const text of prefix.split(' ')) game = applyCall(game, game.turn, call(text));
  return game;
}

function serveFrozenModel() {
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost/').pathname;
    return new Response(new Uint8Array(readFileSync(new URL('../public/' + path.slice(1), import.meta.url))));
  });
}

it.each(highLevelCases)('uses the 2/1 defensive gate in the real SL controller with %s', async (_description, deal, vulnerability, expected, baseline, prefix) => {
  serveFrozenModel();
  try {
    await setSLProfile('seed101-epoch08');
    const advisor = { advise: vi.fn(async () => { throw new Error('Unexpected play advice'); }) };
    const result = await robotStepWithAdvisor(highLevelGame(deal, vulnerability, prefix), 'two-over-one', 'basic', advisor, true);
    expect(result.game.auction.at(-1)).toEqual({ seat: 'N', call: call(expected) });
    expect(getSLModelState().lastBid).toMatchObject({ baselineCall: call(baseline),
      route: expected === baseline ? 'sl-legal' : 'penalty-double' });
    expect(advisor.advise).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

it('keeps the supported penalty in the controller when v16 would undo it', async () => {
  const deal = 'AK.J43.AJ9542.A8 QJT987.A9..KT963 43.QT85.QT876.42 652.K762.K3.QJ75';
  serveFrozenModel();
  try {
    await setSLProfile('seed101-epoch08');
    setLookaheadEnabled(true);
    const advisor = { advise: vi.fn(async () => { throw new Error('Unexpected play advice'); }) };
    const result = await robotStepWithAdvisor(highLevelGame(deal, 'None', diamondFitPrefix), 'two-over-one', 'basic', advisor, true);
    expect(result.game.auction.at(-1)).toEqual({ seat: 'N', call: call('X') });
    expect(getSLModelState().lastBid).toMatchObject({ route: 'sl-legal', baselineCall: call('X') });
  } finally {
    setLookaheadEnabled(false);
    vi.unstubAllGlobals();
  }
});

function successfulRoomResponse(response: RoomResponse) {
  if (!response.ok) throw new Error(`${response.code}: ${response.message}`);
  return response;
}

it.each(highLevelCases)('applies the defensive gate on a LAN host poll with %s', (_description, deal, vulnerability, expected, _baseline, prefix, expectedLan = expected) => {
  if (!globalThis.crypto) vi.stubGlobal('crypto', webcrypto);
  try {
    const room = new LanRoom();
    const join = successfulRoomResponse(room.request({ kind: 'join', roomCode: room.roomCode, seat: 'E', nonce: createJoinNonce(), supportedAgreements: LAN_SUPPORTED_AGREEMENTS }));
    const act = (id: string, revision: number, action: RoomAction) =>
      successfulRoomResponse(room.request({ kind: 'action', token: join.token!, id, revision, action, supportedAgreements: LAN_SUPPORTED_AGREEMENTS }));
    const ready = act('ready', join.snapshot.revision, { kind: 'ready', ready: true });
    const started = act('start', ready.snapshot.revision, { kind: 'startWithRobots' });
    expect(started.snapshot.seats.N).toBe('robot');
    // Seed the already active room with a deterministic auction so the next host poll runs North's real robot turn.
    Object.assign(room, { game: highLevelGame(deal, vulnerability, prefix) });
    const { snapshot } = successfulRoomResponse(room.request({ kind: 'poll', token: join.token!, supportedAgreements: LAN_SUPPORTED_AGREEMENTS }));
    expect(snapshot.auction).toHaveLength(5);
    expect(snapshot.auction.at(-1)).toEqual({ seat: 'N', call: call(expectedLan) });
  } finally {
    vi.unstubAllGlobals();
  }
});

function call(text: string): Call {
  if (text === 'P') return PASS;
  if (text === 'X') return { kind: 'double' };
  if (text === 'XX') return { kind: 'redouble' };
  return { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
}

function cards(holding: string) {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const hand = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit: suits[index], rank, id: `${suits[index]}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  return hand;
}

function position(prefix: string, holding: string, vulnerability: Vulnerability = 'None'): BiddingObservation {
  const auction = prefix.split(' ').map((text, index) => ({ seat: SEATS[index % 4], call: call(text) }));
  const seat = SEATS[auction.length % 4];
  const hand = cards(holding);
  return { phase: 'auction', board: 1, seat, actingSeat: seat, vulnerability, hand, auction, legalCalls: legalCalls(auction, seat) };
}

describe('penalty decisions over the frozen model call', () => {
  it.each(['sayc', 'two-over-one'] as const)('uses a real NT penalty double and rejects a thin one in %s', system => {
    const strong = position('1NT', 'AK32.AQ2.K84.932');
    expect(adjustPenaltyDouble(strong, PASS, system)).toEqual({ call: call('X'), reason: 'make-penalty-double' });
    expect(adjustPenaltyDouble(strong, call('X'), system)).toBeUndefined();

    // Fifteen points, but two quick tricks: KQJ in two suits with no ace.
    const thin = position('1NT', 'KQJ2.KQJ.QJ2.932');
    expect(adjustPenaltyDouble(thin, call('X'), system)).toMatchObject({ reason: 'avoid-penalty-double' });
    expect(adjustPenaltyDouble(thin, PASS, system)).toBeUndefined();
  });

  it('uses the established competitive penalty decision and its vulnerability adjustment', () => {
    const holding = 'AQT9.K9876.A84.2';
    expect(adjustPenaltyDouble(position('1H 1S 2H 2S', holding), PASS, 'sayc')).toBeUndefined();
    expect(adjustPenaltyDouble(position('1H 1S 2H 2S', holding, 'EW'), PASS, 'sayc'))
      .toEqual({ call: call('X'), reason: 'make-penalty-double' });
  });

  it('leaves the model free to choose a non-Pass contract when it could double', () => {
    const obs = position('1NT', 'AK32.AQ2.K84.932');
    expect(adjustPenaltyDouble(obs, call('2S'), 'sayc')).toBeUndefined();
  });

  it('adds the established high-level double over a model Pass while keeping a natural bid', () => {
    const obs = position(highLevelPrefix, 'AQT9.K9876.A84.J', 'EW');
    expect(adjustPenaltyDouble(obs, PASS, 'two-over-one')).toEqual({ call: call('X'), reason: 'make-penalty-double' });
    expect(adjustPenaltyDouble(obs, call('5H'), 'two-over-one')).toBeUndefined();
  });

  it('adds the small-slam double over a model Pass only with sufficient defense', () => {
    const strong = position(slamPrefix, 'AK.K9876.AK84.QJ', 'EW');
    expect(adjustPenaltyDouble(strong, PASS, 'two-over-one'))
      .toEqual({ call: call('X'), reason: 'make-penalty-double' });
    for (const holding of ['AQ.K9876.AK84.QJ', 'AK.98765.A84.932', 'AK.QJ876.QJ84.J2']) {
      expect(adjustPenaltyDouble(position(slamPrefix, holding, 'EW'), PASS, 'two-over-one')).toBeUndefined();
    }
  });

  it('keeps partner’s active penalty X through intervening Passes', () => {
    const obs = position('1NT X P', '2.AQJ987.K842.93');
    expect(adjustPenaltyDouble(obs, call('2H'), 'sayc')).toEqual({ call: PASS, reason: 'keep-partner-penalty-double' });
  });

  it.each([
    ['1H X P', '2C'],     // Partner’s takeout X.
    ['1NT X XX', '2H'],   // Partner’s penalty X has been redoubled.
    ['1NT X 2D', '2H'],   // The doubled contract has been replaced.
    ['1C 1D X P', '1H'],  // Partner’s negative X.
    ['1NT P 2C X', '2D'], // Enemy lead-direction against Stayman.
    ['1NT P 2D X', '2H'], // Enemy lead-direction against a transfer.
    ['1C 2C X P', '2S'],  // Partner’s strength X against Michaels.
  ])('preserves decisions in %s', (prefix, modelCall) => {
    const obs = position(prefix, '2.AQJ987.K842.93');
    expect(adjustPenaltyDouble(obs, call(modelCall), 'sayc')).toBeUndefined();
  });

  it('runs to a real second suit when the known escape is doubled and we have a void', () => {
    const obs = position('P 1D X XX P P 1S X', '-.J63.T86543.J975');
    expect(adjustPenaltyDouble(obs, PASS, 'sayc')).toEqual({ call: call('2C'), reason: 'escape-penalty-double' });
    expect(adjustPenaltyDouble(obs, call('XX'), 'sayc')).toEqual({ call: call('2C'), reason: 'escape-penalty-double' });
    const supported = position('P 1D X XX P P 1S X', '94.J63.T8543.J97');
    expect(adjustPenaltyDouble(supported, PASS, 'sayc')).toBeUndefined();
  });

  it('allows the established seven-card escape from doubled semi-forcing 1NT', () => {
    const obs = position('1H P 1NT X', 'A2.KQJ9876.A82.9');
    expect(adjustPenaltyDouble(obs, PASS, 'sayc')).toEqual({ call: call('2H'), reason: 'escape-penalty-double' });
  });

  it('keeps the existing treatment of a direct double of our 1NT opening', () => {
    const obs = position('1NT X', '2.Q98762.842.932');
    expect(adjustPenaltyDouble(obs, PASS, 'sayc')).toBeUndefined();
  });
});

it.each([
  {
    description: 'makes a penalty double that the shipped SL missed',
    prefix: 'P 1H X XX P P 1S P P',
    holdings: { N: '32.543.6543.7653', E: 'AKQJ.QT762.T.QJ8', S: 'T9876.8.AKJ2.A42', W: '54.AKJ9.Q987.KT9' },
    seat: 'E', before: 'P', after: 'X', action: 1, rawTopAction: 0,
  },
  {
    description: 'preserves partner’s penalty double that the shipped SL withdrew',
    prefix: '1H 1S 2H 2S X P',
    holdings: { N: 'AKQJ.AKT76.T9.T8', E: 'T9876.54.AKJ3.K4', S: '2.QJ98.842.QJ932', W: '543.32.Q765.A765' },
    seat: 'S', before: '4H', after: 'P', action: 0, rawTopAction: 20,
  },
])('$description in the robot controller', async ({ prefix, holdings, seat, before, after, action, rawTopAction }) => {
  serveFrozenModel();
  try {
    await setSLProfile('seed101-epoch08');
    let game = newGameFromDeal(1, 'penalty-double-live', {
      N: cards(holdings.N), E: cards(holdings.E), S: cards(holdings.S), W: cards(holdings.W),
    }, 'N', 'None');
    for (const text of prefix.split(' ')) game = applyCall(game, game.turn, call(text));
    const advisor = { advise: vi.fn(async () => { throw new Error('Unexpected play advice'); }) };
    const result = await robotStepWithAdvisor(game, 'sayc', 'basic', advisor);
    expect(result.game.auction.at(-1)).toEqual({ seat, call: call(after) });
    expect(getSLModelState().lastBid).toMatchObject({ route: 'penalty-double', baselineCall: call(before), action, rawTopAction });
    expect(advisor.advise).not.toHaveBeenCalled();
  } finally {
    vi.unstubAllGlobals();
  }
});

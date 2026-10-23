import { afterAll, describe, expect, it } from 'vitest';
import { createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createGzip } from 'node:zlib';
import { chooseBid, describeCall, evaluateHand } from '../src/ai/bidding';
import { noTrumpRangeAt } from '../src/ai/bidding-semantics';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { applyCall, newGame } from '../src/core/game';
import { bidValue, sameCall } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type GameState, type Seat, type Strain, PASS, partnerOf, sideOf } from '../src/core/types';

type Bid = Extract<Call, { kind: 'bid' }>;
const bid = (level: number, strain: Strain): Bid => ({ kind: 'bid', level, strain });
const major = (strain: Strain) => strain === 'H' || strain === 'S';
const label = (call: Call) => call.kind === 'bid' ? `${call.level}${call.strain}` : call.kind === 'pass' ? 'Pass' : call.kind === 'double' ? 'X' : 'XX';
const isGame = (call: Bid) => call.level >= (call.strain === 'NT' ? 3 : major(call.strain) ? 4 : 5);
const tag = process.env.BRIDGE_AUDIT_TAG ?? 'release';
const seedTag = process.env.BRIDGE_AUDIT_SEED_TAG ?? tag;
const boardCount = Number(process.env.BRIDGE_AUDIT_BOARDS ?? 50000);
const counts: Record<string, number> = {};
const violations: Record<string, number> = {};
const examples: Array<{ seed: string; seat: Seat; hand: string; auction: string; proposed: string; rule: string }> = [];
const stats = { boards: 0, decisions: 0, competing: 0, severe: 0, long: 0, slams: 0, uncontested: 0 };

function handText(hand: Card[]) {
  return ['S', 'H', 'D', 'C'].map(suit => hand.filter(card => card.suit === suit)
    .sort((a, b) => b.rank - a.rank).map(card => '23456789TJQKA'[card.rank - 2]).join('')).join('.');
}

// The oracle below is intentionally independent of the production forcing
// interpreter. It checks the promises made by each contextual natural call,
// not whether the engine agrees with its own explanation or ends the auction.
function audit(game: GameState, call: Call): string[] {
  const seat = game.turn;
  const { hcp, lengths, balanced } = evaluateHand(game.initialHands[seat]);
  const checks: string[] = [];
  const explanation = describeCall(game.auction, seat, call, 'sayc');
  const check = (rule: string, valid: boolean) => {
    counts[rule] = (counts[rule] ?? 0) + 1;
    checks.push(rule);
    if (valid) return;
    violations[rule] = (violations[rule] ?? 0) + 1;
    if (examples.filter(example => example.rule === rule).length < 5) examples.push({
      seed: game.seed, seat, hand: handText(game.initialHands[seat]),
      auction: game.auction.map(entry => `${entry.seat}:${label(entry.call)}`).join(' '), proposed: label(call), rule
    });
  };
  const all = game.auction.flatMap((entry, index) => entry.call.kind === 'bid' ? [{ seat: entry.seat, call: entry.call, index }] : []);
  const us = all.filter(entry => sideOf(entry.seat) === sideOf(seat));
  const opening = us[0], response = us[1];
  const genuineOpening = opening && opening.index === all[0].index;
  const own = us.filter(entry => entry.seat === seat);
  const unpassed = opening && !game.auction.slice(0, opening.index).some(entry => entry.seat === (response?.seat ?? seat) && entry.call.kind === 'pass');
  const cleanResponse = genuineOpening && response && !game.auction.slice(opening.index + 1, response.index).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== 'pass');
  const twoOne = cleanResponse && unpassed && opening.call.level === 1 && opening.call.strain !== 'NT'
    && response.call.level === 2 && response.call.strain !== 'NT' && response.call.strain !== opening.call.strain
    && bidValue(response.call) - bidValue(opening.call) <= 5;
  check('legality', observe(game).phase === 'auction' && (observe(game) as BiddingObservation).legalCalls.some(legal => sameCall(legal, call)));
  if (twoOne && !us.some(entry => isGame(entry.call))) check('independent 2/1 force remains alive', call.kind !== 'pass');
  const jacoby = cleanResponse && opening.call.level === 1 && major(opening.call.strain)
    && response.call.level === 2 && response.call.strain === 'NT';
  const minorNtForce = cleanResponse && opening.call.level === 1 && (opening.call.strain === 'C' || opening.call.strain === 'D')
    && response.call.level === 2 && response.call.strain === 'NT';
  if ((jacoby || minorNtForce) && !us.some(entry => isGame(entry.call))) check('independent forcing 2NT remains alive', call.kind !== 'pass');
  const latest = all.at(-1);
  if (genuineOpening && us.length === 2 && response.seat === partnerOf(seat) && latest?.index === response.index
    && opening.call.level === 2 && opening.call.strain !== 'NT' && opening.call.strain !== 'C'
    && response.call.strain !== 'NT' && response.call.strain !== opening.call.strain) check('new suit over weak two forces opener once', call.kind !== 'pass');
  const globalOpening = all[0];
  const intervention = all[1];
  if (globalOpening?.call.level === 1 && globalOpening.call.strain !== 'NT' && sideOf(globalOpening.seat) !== sideOf(seat)
    && intervention?.seat === partnerOf(seat) && intervention.index === globalOpening.index + 1
    && intervention.call.level === 2 && latest?.index === intervention.index) {
    const michaels = intervention.call.strain === globalOpening.call.strain;
    if (michaels || intervention.call.strain === 'NT') check('independent two-suit artificial contract removed', call.kind !== 'pass');
    if (michaels) {
      const shown = major(globalOpening.call.strain) ? [globalOpening.call.strain === 'H' ? 'S' : 'H'] as const : ['S', 'H'] as const;
      const fit = shown.find(suit => lengths[suit] >= 3);
      const publicMinimum = major(globalOpening.call.strain) ? 10 : 8;
      if (fit && hcp + publicMinimum >= 25) check('Michaels advance does not miss publicly proven major game', call.kind === 'bid' && isGame(call));
    }
  }

  if (call.kind !== 'bid') return checks;
  // Explanation oracles use concrete public roles rather than comparing
  // the description to the same production convention interpreter.
  const ntOpening = genuineOpening ? opening.call.strain === 'NT' ? opening
    : opening.call.level === 2 && opening.call.strain === 'C' && us[2]?.call.strain === 'NT' ? us[2] : undefined : undefined;
  const ntPos = ntOpening ? us.indexOf(ntOpening) : -1;
  const ntCalls = ntOpening ? us.slice(ntPos) : [];
  const request = ntCalls[1];
  if (cleanAuctionFor(game, seat, opening) && ntOpening && request && ntCalls.length === 2 && ntOpening.seat === seat) {
    const base = ntOpening.call.level + 1;
    if (request.call.level === base && (request.call.strain === 'D' || request.call.strain === 'H')
      && call.level === base && call.strain === (request.call.strain === 'D' ? 'H' : 'S')) check('tooltip distinguishes transfer acceptance from a natural suit', explanation.includes('转移接受'));
    if (request.call.level === base && request.call.strain === 'C' && call.level === base && call.strain === 'D') {
      check('Stayman denial has no four-card major', lengths.H < 4 && lengths.S < 4);
      check('tooltip describes Stayman denial without inventing diamonds', explanation.includes('否认四张高花'));
    }
  }
  if (genuineOpening && us.length === 1 && opening.call.level === 2 && opening.call.strain === 'C'
    && call.level === 2 && call.strain === 'D') check('tooltip distinguishes strong-club waiting from natural diamonds', explanation.includes('等待应叫'));
  if (all.length === 1 && all[0].index + 1 === game.auction.length && sideOf(all[0].seat) !== sideOf(seat)
    && all[0].call.level === 1 && all[0].call.strain !== 'NT' && call.level === 2 && call.strain === 'C'
    && all[0].call.strain !== 'C') check('tooltip distinguishes natural club overcall from strong opening', explanation.includes('二阶自然争叫'));
  if (genuineOpening && own.length === 0 && cleanAuctionFor(game, seat, opening) && unpassed && opening.call.level === 1
    && opening.call.strain !== 'NT' && call.level === 2 && call.strain !== 'NT' && call.strain !== opening.call.strain
    && bidValue(call) - bidValue(opening.call) <= 5) check('tooltip states default 2/1 game force', explanation.includes('进局逼叫'));
  if (genuineOpening && twoOne && us.length === 3 && opening.call.strain !== 'NT' && major(opening.call.strain)
    && us[2].call.strain === opening.call.strain && call.strain === opening.call.strain && call.level === 4
    && response.seat === seat) check('2/1 repeated major does not invent a sixth trump', lengths[opening.call.strain] >= 3);
  if (!genuineOpening && opening?.call.level === 2 && opening.call.strain === 'C' && opening.index === all[0]?.index + 1
    && call.level === 4 && call.strain === 'NT' && own.length > 0 && opening.seat !== seat) {
    const promisedClubs = us.filter(entry => entry.seat === opening.seat && entry.call.strain === 'C').length >= 2 ? 6 : 5;
    const support = lengths.C + promisedClubs;
    const shortness = support >= 8 ? (['S', 'H', 'D'] as const).reduce((n, suit) => n
      + (lengths[suit] === 0 ? 4 : lengths[suit] === 1 ? lengths.C >= 4 ? 3 : 2 : lengths[suit] === 2 ? 1 : 0), 0) : 0;
    check('natural club overcall does not invent 22+ for slam', hcp + shortness + Math.max(0, support - 8) + 16 >= 33);
  }
  if (!all.length) {
    if (call.level === 1 && call.strain !== 'NT') check('opening natural suit length', lengths[call.strain] >= (major(call.strain) ? 5 : 3));
    return checks;
  }
  if (genuineOpening && own.length === 0 && us.length === 1 && opening.call.level === 1 && opening.call.strain !== 'NT') {
    const clean = !game.auction.slice(opening.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== 'pass');
    const passed = game.auction.slice(0, opening.index).some(entry => entry.seat === seat && entry.call.kind === 'pass');
    if (clean && !passed && call.level === 2 && call.strain !== 'NT' && call.strain !== opening.call.strain
      && bidValue(call) - bidValue(opening.call) <= 5) check('2/1 response promises 13 HCP', hcp >= 13);
    if (clean && call.level === 1 && call.strain !== 'NT' && call.strain !== opening.call.strain) check('one-over-one promises four cards', lengths[call.strain] >= 4);
    if (clean && major(opening.call.strain) && call.level === 1 && call.strain === 'NT') check('semi-forcing 1NT upper bound', hcp >= 5 && hcp <= 12);
    if (clean && !major(opening.call.strain) && call.strain === 'NT' && call.level === 2) check('minor 2NT promises balanced 13-15', balanced && hcp >= 13 && hcp <= 15);
    if (clean && !major(opening.call.strain) && call.strain === 'NT' && call.level === 3) check('minor 3NT promises balanced 16-18', balanced && hcp >= 16 && hcp <= 18);
  }
  const cleanAuction = genuineOpening && !game.auction.slice(opening.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== 'pass');
  if (cleanAuction && opening.seat === seat && own.length === 1 && us.length === 2
    && opening.call.level === 1 && opening.call.strain !== 'NT' && response.call.level === 1) {
    if (call.strain === 'NT' && call.level === 1 && response.call.strain !== 'NT') {
      const availableMajor = (['H', 'S'] as const).some(suit => lengths[suit] >= 4
        && (observe(game) as BiddingObservation).legalCalls.some(legal => sameCall(legal, bid(1, suit))));
      check('minimum opener shows an available four-card major', !availableMajor);
    }
    if (call.strain === 'NT' && call.level === 2) check('nongameforce opener 2NT promises balanced 18-19', balanced && hcp >= 18 && hcp <= 19);
    if (call.strain !== 'NT' && call.strain !== opening.call.strain && call.strain !== response.call.strain && call.level === 2
      && bidValue(bid(1, call.strain)) > bidValue(opening.call)) check('nongameforce reverse promises 17+', hcp >= 17 && lengths[call.strain] >= 4);
    if (call.strain === response.call.strain && major(call.strain)) check('opener raises one-over-one major with four cards', lengths[call.strain] >= 4);
  }
  const following: AuctionEntry[] = [...game.auction, { seat, call }];
  const promisedRange = noTrumpRangeAt(following, following.length - 1, 'sayc');
  if (promisedRange) check('interpreted NT range contains actual HCP', hcp >= promisedRange.min && hcp <= promisedRange.max);
  return checks;
}

function cleanAuctionFor(game: GameState, seat: Seat, opening?: { index: number }) {
  return !!opening && !game.auction.slice(opening.index + 1).some(entry => sideOf(entry.seat) !== sideOf(seat) && entry.call.kind !== 'pass');
}

afterAll(() => {
  mkdirSync('artifacts', { recursive: true });
  writeFileSync(`artifacts/bidding-diverse-${tag}.json`, JSON.stringify({
    version: '0.3.1', system: 'SAYC＋2/1进局逼叫＋RKCB 1430', generatedAt: new Date().toISOString(),
    oracle: 'independent contextual point, length and forcing promises', stats, checks: counts, violations, examples,
    trace: `bidding-diverse-${tag}-traces.jsonl.gz`
  }, null, 2));
});

describe('diverse independently audited complete auctions', () => {
  it('records and audits every decision on fresh random deals, seats and vulnerabilities', async () => {
    mkdirSync('artifacts', { recursive: true });
    const output = createWriteStream(`artifacts/bidding-diverse-${tag}-traces.jsonl.gz`);
    const gzip = createGzip(); gzip.pipe(output);
    for (let index = 0; index < boardCount; index++) {
      const uncontested = index % 4 === 0;
      let game = newGame(index % 16 + 1, `v031-diverse-${seedTag}-${index}`);
      const steps: Array<{ seat: Seat; call: string; hcp: number; shape: string; checks: string[]; meaning: string }> = [];
      for (let guard = 0; guard < 80 && game.phase === 'auction'; guard++) {
        const observeThis = observe(game) as BiddingObservation;
        const call = uncontested && sideOf(game.turn) === 'EW' ? PASS : chooseBid(observeThis, 'sayc');
        const checkThis = uncontested && sideOf(game.turn) === 'EW' ? [] : audit(game, call);
        const evaluation = evaluateHand(game.initialHands[game.turn]);
        steps.push({ seat: game.turn, call: label(call), hcp: evaluation.hcp,
          shape: ['S', 'H', 'D', 'C'].map(suit => evaluation.lengths[suit as keyof typeof evaluation.lengths]).join('-'),
          checks: checkThis, meaning: describeCall(game.auction, game.turn, call, 'sayc') });
        stats.decisions++;
        game = applyCall(game, game.turn, call);
      }
      expect(game.phase).not.toBe('auction');
      const active = game.auction.filter(entry => entry.call.kind !== 'pass');
      const sides = new Set(active.map(entry => sideOf(entry.seat)));
      stats.boards++;
      if (uncontested) stats.uncontested++;
      if (sides.size === 2) stats.competing++;
      if (sides.size === 2 && ['NS', 'EW'].every(side => active.filter(entry => sideOf(entry.seat) === side).length >= 2)
        && (active.some(entry => entry.call.kind === 'double' || entry.call.kind === 'redouble') || (game.contract?.level ?? 0) >= 3)) stats.severe++;
      if (game.auction.length >= 12) stats.long++;
      if ((game.contract?.level ?? 0) >= 6) stats.slams++;
      const record = { seed: game.seed, dealer: game.dealer, vulnerability: game.vulnerability, uncontested,
        hands: Object.fromEntries(Object.entries(game.initialHands).map(([seat, hand]) => [seat, handText(hand)])), steps, contract: game.contract };
      if (!gzip.write(JSON.stringify(record) + '\n')) await once(gzip, 'drain');
    }
    gzip.end(); await once(output, 'finish');
    expect(stats.boards).toBe(boardCount);
    expect(violations, JSON.stringify(examples.slice(0, 30), null, 2)).toEqual({});
  }, 300000);
});

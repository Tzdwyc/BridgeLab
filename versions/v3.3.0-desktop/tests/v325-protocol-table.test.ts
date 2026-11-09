import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { deck } from '../src/core/deal';
import { applyCall, assertGameIntegrity, newGameFromDeal } from '../src/core/game';
import { SEATS, SUITS, type Card, type Call, type Hands, type Seat, type Strain } from '../src/core/types';
import { observe } from '../src/ai/observation';
import { agreementVersionFor } from '../src/ai/bid-strategy';
import { assessCandidates } from '../src/ai/constrained-sl';
import { publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';
import { presentCall } from '../src/ai/bidding-presentation';
import { setLookaheadEnabled, setSLProfile, getSLModelState } from '../src/ai/neural/browser-model';
import { robotStepWithAdvisor } from '../src/controller/robot';

const folder = 'artifacts/v325-consistency-20261108';
const parse = (token: string): Call => token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' }
  : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
function holding(text: string): Card[] {
  return text.split('.').flatMap((cards, i) => [...cards].filter(c => c !== '-').map(c => {
    const suit = (['S', 'H', 'D', 'C'] as const)[i], rank = '23456789TJQKA'.indexOf(c) + 2;
    return { id: `${suit}${rank}`, suit, rank };
  }));
}
function position(prefix: string, own: Card[], dealer: Seat, system: 'sayc' | 'two-over-one', fourNT = false) {
  const tokens = prefix.split(' ').filter(Boolean), actor = SEATS[(SEATS.indexOf(dealer) + tokens.length) % 4];
  const hands = Object.fromEntries(SEATS.map(seat => [seat, []])) as unknown as Hands;
  hands[actor] = own;
  const ids = new Set(own.map(c => c.id));
  let rest = deck().filter(c => !ids.has(c.id));
  if (fourNT) {
    // Engine padding only: make the already-entered opener satisfy the new
    // public C5D5 promise. None of these hidden cards enters observe().
    const minors = ['C', 'D'].flatMap(suit => rest.filter(c => c.suit === suit).slice(0, 5));
    const chosen = new Set(minors.map(c => c.id));
    const others = rest.filter(c => !chosen.has(c.id)).slice(0, 3);
    hands[dealer] = [...minors, ...others];
    const used = new Set(hands[dealer].map(c => c.id));
    rest = rest.filter(c => !used.has(c.id));
  }
  for (const seat of SEATS) if (!hands[seat].length) hands[seat] = rest.splice(0, 13);
  let game = newGameFromDeal(1, 'v325-existing-protocol-integration', hands, dealer, 'None');
  game = { ...game, biddingSystem: system, agreementVersion: agreementVersionFor(system) };
  for (const token of tokens) game = applyCall(game, game.turn, parse(token));
  assertGameIntegrity(game);
  const obs = observe(game);
  if (obs.phase !== 'auction') throw Error('Expected existing auction context');
  expect(obs.hand).toEqual(own);
  return { game, obs };
}

it.skipIf(process.env.V325_PROTOCOL_RUN !== '1')('records bounded existing convention/preempt cases and opening-4NT responses at the actual table', async () => {
  const output = process.env.V325_PROTOCOL_OUTPUT ?? `${folder}/protocol-table-final.json`;
  if (existsSync(output)) throw Error('Preserve completed protocol evidence before running again');
  const matrix = JSON.parse(readFileSync(`${folder}/existing-conventions-readonly-audit.json`, 'utf8')).recommendedMatrix;
  const saved = JSON.parse(readFileSync('artifacts/v324-three-system-notes-20261108/natural-two-over-one-actual-001.json', 'utf8')).rows;
  const storage = new Map<string, string>();
  const rows: unknown[] = [], fourNtRows: unknown[] = [];
  const advisor = { advise: vi.fn(async () => { throw Error('No play/DDS allowed'); }) };
  vi.stubGlobal('localStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => { storage.set(k, v); } });
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => new Response(new Uint8Array(readFileSync(new URL('../public' + new URL(String(input), 'http://local/').pathname, import.meta.url)))));
  try {
    setLookaheadEnabled(false); await setSLProfile('seed101-epoch08');
    for (const system of ['sayc', 'two-over-one'] as const) {
      for (const fixture of matrix) {
        // Exact expansion of the existing [7,2,2,2]/7HCP generator fixture.
        const text = fixture.holding ?? 'T987654.T9.T9.AK';
        const { game, obs } = position(fixture.prefix, holding(text), fixture.dealer ?? 'N', system);
        const step = await robotStepWithAdvisor(game, system, 'basic', advisor, false);
        assertGameIntegrity(step.game);
        const selected = step.game.auction.at(-1)!.call;
        const meaning = publicCallMeaningAt(step.game.auction, game.auction.length, system);
        const candidate = assessCandidates(obs, system).find(c => JSON.stringify(c.call) === JSON.stringify(selected));
        rows.push({ id: fixture.id, source: fixture.source, system, holding: text, prefix: fixture.prefix,
          actual: selected, trace: getSLModelState().lastBid, meaning, notes: presentCall(game.auction, obs.seat, selected, system),
          publicConstraints: publicPlayerConstraints(step.game.auction, obs.seat, system),
          qualification: candidate, referenceOnlySaycRuleExpected: fixture.existingSaycRuleExpected,
          unresolved: !meaning.defined || !candidate?.allowed });
        expect(step.game.actions).toHaveLength(game.actions.length + 1);
        expect(step.warning).toBeNull();
      }
      for (const [pointId, expected] of (process.env.V325_PROTOCOL_MATRIX_ONLY === '1' ? [] : [['B1-dev-long-0030-P1', 'C'], ['B1-dev-long-0028-P1', 'D']]) as Array<readonly [string, string]>) {
        const old = saved.find((r: any) => r.pointId === pointId && r.system === system);
        for (const response of ['P', 'X']) {
          const { game, obs } = position(`4NT ${response}`, old.observation.hand, 'N', system, true);
          const step = await robotStepWithAdvisor(game, system, 'basic', advisor, false);
          const actual = step.game.auction.at(-1)!.call;
          expect(actual).toEqual({ kind: 'bid', level: 5, strain: expected });
          const meaning = publicCallMeaningAt(step.game.auction, game.auction.length, system);
          expect(meaning).toMatchObject({ role: 'two-suit-choice', artificial: false, forcing: 'none' });
          const notes = presentCall(game.auction, obs.seat, actual, system);
          expect(notes).toContain('完成低花选择，可停');
          fourNtRows.push({ sourceExistingHand: pointId, system, prefix: `4NT ${response}`, actual, meaning, notes,
            openingNotes: presentCall([], 'N', { kind: 'bid', level: 4, strain: 'NT' }, system), trace: getSLModelState().lastBid });
        }
      }
    }
    expect(rows).toHaveLength(24); expect(fourNtRows).toHaveLength(process.env.V325_PROTOCOL_MATRIX_ONLY === '1' ? 0 : 8);
    expect(advisor.advise).not.toHaveBeenCalled();
    writeFileSync(output, JSON.stringify({ scope: 'Existing test holdings and public prefixes; deterministic hidden padding only for engine integrity. Single-step queries, no new mother-deal performance cohort, training, continuation or DDS.', actualQueries: rows.length + fourNtRows.length, rows, fourNtRows }, null, 2));
  } finally { vi.unstubAllGlobals(); }
});

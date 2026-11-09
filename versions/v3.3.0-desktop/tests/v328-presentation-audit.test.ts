import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { SEATS, type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { type BiddingSystem } from '../src/ai/systems';
import { presentCall } from '../src/ai/bidding-presentation';
import { publicCallMeaningAt } from '../src/ai/bidding-semantics';
import { formatPointRange } from '../src/ai/bidding-meaning-format';

const parse = (value: string): Call => value === 'P' || value === 'pass' ? { kind: 'pass' } : value === 'X' ? { kind: 'double' }
  : value === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: +value[0], strain: value.slice(1) as Strain };
export function shown(prefix: string, next: string, system: BiddingSystem = 'sayc') {
  const a: AuctionEntry[] = prefix.split(' ').filter(Boolean).map((token, i) => ({ seat: SEATS[i % 4], call: parse(token) }));
  const seat = SEATS[a.length % 4], call = parse(next);
  return { text: presentCall(a, seat, call, system), meaning: publicCallMeaningAt([...a, { seat, call }], a.length, system) };
}

it.skipIf(process.env.V328_HINT_AUDIT !== '1')('audits saved public calls without selecting bids or passing hands into presentation', () => {
  const output = process.env.V328_HINT_OUTPUT ?? 'artifacts/v328-hints-and-cue-20261108/presentation-audit-final.json';
  if (existsSync(output)) throw Error('Preserve completed audit evidence');
  const publicTestSources = readdirSync('tests').filter(path => /^(bidding-|precision-|v035-).*\.test\.ts$/.test(path)).map(path => `tests/${path}`);
  const inputs = ['artifacts/v324-three-system-notes-20261108/natural-two-over-one-actual-001.json', 'artifacts/v324-three-system-notes-20261108/precision-audit.json', ...publicTestSources];
  const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');
  const hashes = Object.fromEntries(inputs.map(path => [path, hash(path)]));
  const natural = JSON.parse(readFileSync(inputs[0], 'utf8')), precision = JSON.parse(readFileSync(inputs[1], 'utf8'));
  const fixtures = [
    ...natural.rows.map((r: any) => ({ id: r.pointId, system: r.system, auction: r.observation.auction, seat: r.observation.seat, call: r.call, oldText: r.text })),
    ...precision.rows.map((r: any) => ({ id: r.id, system: 'precision', auction: r.prefix.split(' ').filter(Boolean).map((t: string, i: number) => ({ seat: SEATS[i % 4], call: parse(t) })), seat: r.seat, call: parse(r.selectedCall), oldText: r.prompt })),
    ...natural.prospectivePublicButtons.map((r: any) => { const auction = r.prefix.split(' ').filter(Boolean).map((t: string, i: number) => ({ seat: SEATS[i % 4], call: parse(t) })); return { id: r.source, system: r.system, auction, seat: SEATS[auction.length % 4], call: r.call, oldText: r.text }; }),
  ];
  const extra = new Map<string, any>();
  function publicFixture(source: string, prefix: string, token: string, systems: BiddingSystem[]) {
    const auction = prefix.split(' ').filter(Boolean).map((t, i) => ({ seat: SEATS[i % 4], call: parse(t) }));
    for (const system of systems) extra.set(`${system}/${prefix}/${token}`, { id: `${source}/${prefix}/${token}`, system, auction,
      seat: SEATS[auction.length % 4], call: parse(token), source: 'Existing test literal, public button meaning only; not a selected-call experiment' });
  }
  for (const source of publicTestSources) {
    const raw = readFileSync(source, 'utf8');
    for (const m of raw.matchAll(/(?:position|fixture|shown)\(\s*'([1-7SHDCNTPX ]*)'\s*,\s*'([1-7](?:NT|[SHDC])|P|X|XX)'(?:\s*,\s*'(sayc|two-over-one|precision)')?/g))
      publicFixture(source, m[1], m[2], m[3] ? [m[3] as BiddingSystem] : ['sayc', 'two-over-one', 'precision']);
    for (const m of raw.matchAll(/\bmeaning\(\s*'([1-7SHDCNTPX ]+)'/g)) {
      const tokens = m[1].split(' '); publicFixture(source, tokens.slice(0, -1).join(' '), tokens.at(-1)!, ['sayc', 'two-over-one', 'precision']);
    }
    // Only literal auctions already present in tests. Their public prefixes
    // exercise role formatting, never fixture generators or bidding engines.
    for (const m of raw.matchAll(/'((?:[1-7](?:NT|[SHDC])|P|XX|X)(?: (?:[1-7](?:NT|[SHDC])|P|XX|X))+)'/g)) {
      const tokens = m[1].split(' ');
      for (let i = 0; i < tokens.length; i++) publicFixture(source, tokens.slice(0, i).join(' '), tokens[i], ['sayc', 'two-over-one', 'precision']);
    }
  }
  fixtures.push(...extra.values());
  const rows: any[] = [], failures: string[] = [];
  const controlRoles = ['keycard-ask', 'keycard-answer', 'queen-ask', 'queen-answer', 'king-ask', 'king-answer', 'control-cue', 'weak-feature-inquiry', 'weak-feature-answer', 'precision-negative', 'precision-positive', 'precision-inquiry', 'artificial-response'];
  for (const f of fixtures) {
    if (!f.auction || !f.call || !f.seat) throw Error(`Missing public fixture: ${f.id}`);
    const auction = structuredClone(f.auction) as AuctionEntry[], call = f.call as Call, seat = f.seat as Seat, system = f.system as BiddingSystem;
    const before = JSON.stringify(auction), meaning = publicCallMeaningAt([...auction, { seat, call }], auction.length, system);
    const text = presentCall(auction, seat, call, system), after = publicCallMeaningAt([...auction, { seat, call }], auction.length, system);
    const issues: string[] = [];
    if (before !== JSON.stringify(auction) || JSON.stringify(meaning) !== JSON.stringify(after)) issues.push('Public input or meaning mutated');
    if (/undefined|NaN|Infinity|roleLabel|公共前缀/.test(text)) issues.push('Implementation text leaked');
    const available = !text.includes('当前不可叫');
    if (available && meaning.defined) {
      for (const [kind, value] of [['hcpRange', meaning.hcpRange], ['supportRange', meaning.supportRange]] as const) {
        if (value && (!Number.isInteger(value.min) || !Number.isInteger(value.max) || value.min < 0 || value.max > 40 || value.min > value.max))
          issues.push(`Invalid canonical ${kind} interval: ${value.min}-${value.max}`);
      }
    }
    if (available && meaning.defined && /此处未约定/.test(text)) issues.push('Known meaning rendered as unagreed');
    if (available && meaning.defined && /大牌点/.test(text) && /支持点/.test(text)) issues.push('HCP and support point totals mixed');
    if (available && meaning.defined && text.includes('长低花弱牌')
      && (meaning.strictBalancedShapeFamily || (meaning.suitMaximums?.C ?? 13) <= 4 && (meaning.suitMaximums?.D ?? 13) <= 4))
      issues.push('Weak long-minor prose contradicts explicit public shape restrictions');
    if (available && meaning.defined && !/不叫：|加倍/.test(text)) {
      const numericPoints = [...text.matchAll(/\d+(?:~\d+)?个大牌点(?:以上)?/g)].filter(match => {
        const tail = text.slice(match.index! + match[0].length);
        return !(meaning.hcpRange?.min === 12 && match[0] === '12个大牌点' && tail.startsWith('开叫'))
          && !(meaning.playingSourceCompensation && match[0] === `${meaning.playingSourceCompensation.normalHcpMinimum}个大牌点` && tail.startsWith('时须'));
      }).map(match => match[0]);
      const canonical = formatPointRange(meaning.hcpRange);
      if (numericPoints.some(value => value !== canonical)) issues.push('Display derives a point range absent from current meaning');
    }
    if (available && meaning.defined && controlRoles.includes(meaning.role) && /\d张以上|恰好\d张/.test(text)) issues.push('Artificial honor/control role leaks natural lengths');
    if (available && meaning.defined && call.kind === 'bid' && meaning.forcing === 'game' && !/逼叫进局/.test(text)) issues.push('Game force omitted');
    if (available && meaning.defined && call.kind === 'bid' && meaning.forcing === 'one-round' && !/逼叫一轮|半逼叫/.test(text)) issues.push('One-round obligation omitted');
    if (available && meaning.defined && call.kind === 'bid' && meaning.forcing !== 'none' && /不逼叫|成局止叫|可止叫/.test(text)) issues.push('Forcing and nonforcing wording conflict');
    if (text.length > 140) issues.push('Explanation exceeds 140 characters');
    failures.push(...issues.map(issue => `${f.id}/${system}: ${issue}`));
    rows.push({ ...f, meaning, text, available, characterCount: text.length, issues });
  }
  mkdirSync('artifacts/v328-hints-and-cue-20261108', { recursive: true });
  const declaredRoles = [...readFileSync('src/ai/bidding-semantics.ts', 'utf8').match(/export type PublicCallRole =([\s\S]*?);/)![1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const availableRoles = new Set(rows.filter(r => r.available && r.meaning.defined).map(r => r.meaning.role));
  const representative = new Map<string, any>();
  for (const row of rows) {
    const key = `${row.system}/${row.meaning.role}`;
    if (!representative.has(key) || row.issues.length) representative.set(row.issues.length ? row.id + key : key, row);
  }
  const compactRows = [...representative.values()].map(r => ({ id: r.id, system: r.system,
    prefix: r.auction.map((e: AuctionEntry) => e.call.kind === 'bid' ? `${e.call.level}${e.call.strain}` : e.call.kind === 'pass' ? 'P' : e.call.kind === 'double' ? 'X' : 'XX').join(' '),
    seat: r.seat, call: r.call, text: r.text, available: r.available, characterCount: r.characterCount, issues: r.issues,
    meaning: { role: r.meaning.role, defined: r.meaning.defined, artificial: r.meaning.artificial, forcing: r.meaning.forcing,
      hcpRange: r.meaning.hcpRange, supportRange: r.meaning.supportRange, suitMinimums: r.meaning.suitMinimums,
      suitMaximums: r.meaning.suitMaximums, controlSuits: r.meaning.controlSuits, agreedTrump: r.meaning.agreedTrump } }));
  writeFileSync(output, JSON.stringify({ scope: 'Public-prefix formatting audit only. No hand input, bid selection, new deals, training or DDS. Representative rows retained; all original 912/16 observations remain in hashed input evidence.', inputs: hashes,
    inputsPreserved: inputs.every(path => hash(path) === hashes[path]), records: rows.length, naturalRecords: natural.rows.length, precisionRecords: precision.rows.length, additionalPublicButtonQueries: extra.size,
    changedSavedTexts: rows.filter(r => r.oldText !== undefined && r.text !== r.oldText).length, maxCharacters: Math.max(...rows.map(r => r.characterCount)),
    declaredRoleCount: declaredRoles.length, availableDefinedRoleCount: availableRoles.size,
    uncoveredRoles: declaredRoles.filter(role => !availableRoles.has(role)).map(role => ({ role, status: rows.some(r => r.meaning.role === role) ? 'Observed undefined/unavailable boundary, not an implemented defined role' : 'No existing public test evidence' })),
    roleCounts: rows.reduce((all, row) => ({ ...all, [row.meaning.role]: (all[row.meaning.role] ?? 0) + 1 }), {}),
    failures, representativeRows: compactRows, selectionCalls: 0, newMotherDeals: 0, training: 0, dds: 0 }, null, 2));
  expect(failures).toEqual([]);
});

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type AuctionEntry, type Call, type Seat, type Strain } from '../src/core/types';
import { clearPublicMeaningCaches, publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';

function parse(token: string): Call {
  return token === 'P' ? { kind: 'pass' } : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
    : { kind: 'bid', level: Number(token[0]), strain: token.slice(1) as Strain };
}

describe('bounded public-prefix cache: identity and isolation', () => {
  it('isolates nested consumer mutations and separates actor, system and the entire prefix', () => {
    clearPublicMeaningCaches();
    const opening: AuctionEntry[] = [{ seat: 'N', call: parse('1NT') }];
    const mutableMeaning = publicCallMeaningAt(opening, 0);
    mutableMeaning.hcpRange!.min = 0; mutableMeaning.suitMinimums.H = 9;
    const mutableConstraints = publicPlayerConstraints(opening, 'N');
    mutableConstraints.hcpRange!.min = 0; mutableConstraints.lengthSources[0].minimum = 9;
    expect(publicCallMeaningAt(opening, 0)).toMatchObject({ hcpRange: { min: 15, max: 17 }, suitMinimums: { H: 2 } });
    expect(publicPlayerConstraints(opening, 'N')).toMatchObject({ hcpRange: { min: 15, max: 17 }, suitMinimums: { H: 2 } });
    expect(publicPlayerConstraints(opening, 'S').hcpRange).toBeUndefined();
    expect(publicCallMeaningAt(opening, 0, 'precision').hcpRange).toEqual({ min: 13, max: 15 });
    const natural = ['1NT', 'P', '2C', 'P', '2H'].map((token, index) => ({ seat: ['N', 'E', 'S', 'W'][index % 4] as Seat, call: parse(token) }));
    const transfer = natural.map(entry => ({ ...entry, call: { ...entry.call } })); transfer[2].call = parse('2D');
    expect(publicCallMeaningAt(natural, 4).role).toBe('stayman-answer');
    expect(publicCallMeaningAt(transfer, 4).role).toBe('transfer-acceptance');
    expect(publicCallMeaningAt([...natural, { seat: 'E', call: parse('3S') }], 4)).toEqual(publicCallMeaningAt(natural, 4));
  });
  it('records cold/hot provider timing on twenty original boards with byte-equivalent public results', () => {
    const source = JSON.parse(readFileSync('tests/fixtures/retained-public-prefix-cache.json', 'utf8')) as {
      codeSha256: string; boards: Array<{ board: number; steps: Array<{ seat: Seat; call: string }> }> };
    const selected = source.boards;
    const queries: Array<{ auction: AuctionEntry[]; seat: Seat }> = [];
    for (const board of selected) {
      const calls: AuctionEntry[] = [];
      for (const step of board.steps) { calls.push({ seat: step.seat, call: parse(step.call) }); queries.push({ auction: [...calls], seat: step.seat }); }
    }
    const evaluate = (query: typeof queries[number]) => JSON.stringify({
      meaning: publicCallMeaningAt(query.auction, query.auction.length - 1), constraints: publicPlayerConstraints(query.auction, query.seat) });
    clearPublicMeaningCaches();
    const coldStart = performance.now(), cold = queries.map(evaluate), coldMs = performance.now() - coldStart;
    const repetitions = 3, hotStart = performance.now();
    for (let repeat = 0; repeat < repetitions; repeat++) expect(queries.map(evaluate)).toEqual(cold);
    const hotTotalMs = performance.now() - hotStart;
    const providerSha256 = createHash('sha256').update(readFileSync('src/ai/bidding-semantics.ts')).digest('hex');
    const record = { method: 'Public-provider cold versus hot measurement; no automatic call/hover quality grading',
      sourceArtifact: 'tests/fixtures/retained-public-prefix-cache.json', sourceCodeSha256: source.codeSha256, providerSha256,
      boards: selected.map(board => board.board), queries: queries.length, repetitions, coldMs, hotTotalMs,
      coldMsPerQuery: coldMs / queries.length, hotMsPerQuery: hotTotalMs / (queries.length * repetitions),
      byteEquivalent: true, handInputsUsed: false };
    writeFileSync('artifacts/v033-public-meaning-cache-profile.json', JSON.stringify(record, null, 2));
    console.log('public provider cold/hot profile', record);
  });
});

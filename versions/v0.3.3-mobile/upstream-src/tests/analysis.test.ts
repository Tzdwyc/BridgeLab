import { describe, expect, it, vi } from 'vitest';
import { analysisPosition, doubleDummyTableRequest } from '../src/analysis/adapter';
import { AnalysisClient, AnalysisCancelled, CACHE_KEY, type WorkerLike } from '../src/analysis/client';
import { ENGINE, type DoubleDummyTableResult, type PositionResult } from '../src/analysis/types';
import { activeCursor, activeLine, branchLine, changeAnalysisContract, exampleGame, moveCursor, openDocument, replayLine, tryCard, undoBranch } from '../src/analysis/model';
import { ARCHIVE_KEY, decodeDocument, findSavedDocument, importDocument, loadDocument, saveDocument, WORKSPACE_KEY } from '../src/analysis/persistence';
import { applyCall, applyClaim, controllerFor, newGame, replay, toRecord } from '../src/core/game';
import { legalCards } from '../src/core/play';
import { PASS, SEATS, STRAINS } from '../src/core/types';
import { emptySession, encodeSession, loadSession } from '../src/persistence/session';

const game = exampleGame('branch-tests', 'S', 'N');
const original = replayLine(toRecord(game));
const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};
describe('replay, branching and durable analysis', () => {
  it('reconstructs all 53 states including partial tricks and the scored finish', () => {
    expect(original.states).toHaveLength(53); expect(original.states[52]).toEqual(game);
    for (let i = 0; i <= 52; i++) {
      expect(original.states[i].completedTricks.length).toBe(Math.floor(i / 4));
      expect(original.states[i].currentTrick.length).toBe(i % 4);
    }
  });
  it('keeps a claimed board analyzable only through the last actually played card', () => {
    const beforeClaim = original.states[8];
    const claimed = applyClaim(beforeClaim, controllerFor(beforeClaim), 0);
    const document = openDocument(claimed); const line = replayLine(document.source, document.analysisContract);
    expect(replay(document.source).claim).not.toBeNull();
    expect(line.plays).toHaveLength(8); expect(line.states).toHaveLength(9);
    expect(line.states.at(-1)?.phase).toBe('play');
    expect(line.states.at(-1)?.actions).toEqual(beforeClaim.actions);
    expect(() => analysisPosition(line.states.at(-1)!)).not.toThrow();
  });
  it('opens an all-pass board with a selectable hypothetical contract and no invented play history', () => {
    let passed = newGame(1, 'analysis-all-pass');
    for (let index = 0; index < 4; index++) passed = applyCall(passed, passed.turn, PASS);
    const document = openDocument(passed); const opening = activeLine(document);
    expect(replay(document.source).phase).toBe('passedOut');
    expect(opening.plays).toHaveLength(0); expect(opening.states).toHaveLength(1);
    expect(opening.states[0]).toMatchObject({ phase: 'play', contract: { level: 1, strain: 'NT', declarer: 'S', leader: 'W' } });
    const changed = changeAnalysisContract(document, 4, 'H', 'N');
    expect(activeLine(changed).states[0]).toMatchObject({ contract: { level: 4, strain: 'H', declarer: 'N', dummy: 'S', leader: 'E' } });
    expect(changed.branches).toEqual([]); expect(changed.cursor).toBe(0);
  });
  it('manual branches enforce turn and following suit while preserving original actions and result', () => {
    const source = structuredClone(game); let document = moveCursor(openDocument(game), 7);
    const state = original.states[7]; const legal = legalCards(state.hands[state.turn], state.currentTrick);
    const card = legal.at(-1)!; document = tryCard(document, card.id, 'branch-a');
    expect(activeCursor(document)).toBe(8); expect(document.branches[0].start).toBe(7);
    expect(document.source).toEqual(toRecord(source)); expect(game).toEqual(source);
    expect(activeLine(document).states[8].actions.at(-1)).toMatchObject({ cardId: card.id });
    const illegal = state.hands[state.turn].find(c => !legal.some(l => l.id === c.id));
    if (illegal) expect(() => tryCard(moveCursor(openDocument(game), 7), illegal.id, 'bad')).toThrow();
    expect(() => tryCard(openDocument(game), 'NO_CARD', 'bad')).toThrow();
  });
  it('rewinding and choosing a new card truncates only future branch actions; undo keeps the shared prefix', () => {
    let document = openDocument(game);
    for (let n = 0; n < 6; n++) {
      const current = activeLine(document).states[activeCursor(document)];
      document = tryCard(document, legalCards(current.hands[current.turn], current.currentTrick)[0].id, 'a');
    }
    document = moveCursor(document, 2); const current = activeLine(document).states[2];
    document = tryCard(document, legalCards(current.hands[current.turn], current.currentTrick).at(-1)!.id, 'b');
    expect(document.branches).toHaveLength(1); expect(document.branches[0].cards).toHaveLength(3);
    const undone = undoBranch(document); expect(activeCursor(undone)).toBe(2); expect(undone.branches[0].cards).toHaveLength(2);
    expect(undone.source).toEqual(toRecord(game));
  });
  it('serializes multiple branches, selected route and cursor, and restores archived boards', () => {
    let document = tryCard(openDocument(game), original.plays[0].cardId, 'a');
    document = { ...document, activeBranch: null, cursor: 20 };
    document = tryCard(document, original.plays[20].cardId, 'b');
    expect(decodeDocument(JSON.stringify(document))).toEqual(document);
    const store = storage(); saveDocument(store, document);
    saveDocument(store, openDocument(exampleGame('another-board', 'NT', 'E')));
    expect(findSavedDocument(store, document.source)).toEqual(document);
  });
  it('rejects incomplete, corrupt, illegal or unsupported imported analysis while backing up a rejected workspace', () => {
    const document = openDocument(game); const file = JSON.parse(JSON.stringify(document));
    file.source.actions.pop(); expect(() => decodeDocument(JSON.stringify(file))).toThrow();
    const branch = { id: 'a', name: 'bad', start: 0, cards: ['NO_CARD'], cursor: 1 };
    expect(() => decodeDocument(JSON.stringify({ ...document, branches: [branch] }))).toThrow();
    expect(() => decodeDocument(JSON.stringify({ ...document, cursor: 53 }))).toThrow();
    expect(() => decodeDocument(JSON.stringify({ ...document, activeBranch: 'missing' }))).toThrow();
    expect(() => decodeDocument(JSON.stringify({ ...document, version: 99 }))).toThrow();
    const store = storage(); store.setItem(WORKSPACE_KEY, '{bad');
    expect(loadDocument(store).notice).toContain('备份'); expect(store.getItem(WORKSPACE_KEY)).toBe('{bad');
    expect([...store.values.keys()].some(key => key.includes('.rejected.'))).toBe(true);
  });
  it('imports an explicit v0.1 file while keeping v0.1 and v0.2 browser saves isolated', () => {
    const oldSession = JSON.parse(encodeSession({ ...emptySession(), game }));
    delete oldSession.biddingSystem; delete oldSession.gameSystem;
    const raw = JSON.stringify(oldSession);
    expect(importDocument(raw).source).toEqual(toRecord(game));
    oldSession.current = toRecord(original.states[10]);
    const inProgress = JSON.stringify(oldSession);
    const store = storage(); store.setItem('bridgelab.session.v1', inProgress); store.setItem('bridgelab.session.v2', inProgress);
    expect(loadSession(store).session.game).toBeNull();
    expect(store.getItem('bridgelab.session.v1')).toBe(inProgress); expect(store.getItem('bridgelab.session.v2')).toBe(inProgress);
    expect(WORKSPACE_KEY).toBe('bridgelab.analysis.workspace.v3.3'); expect(ARCHIVE_KEY).toBe('bridgelab.analysis.archive.v3.3');
  });
});

describe('worker isolation, cancellation and cache integrity', () => {
  const position = analysisPosition(original.states[0]);
  const answer: PositionResult = { key: position.key, engine: ENGINE, declarerTricks: 6,
    candidates: position.legalCards.map(card => ({ cardId: card.id, declarerTricks: 6, loss: 0, optimal: true })), nodes: 12, elapsedMs: 1, heapBytes: 16 * 1024 * 1024 };
  const tableRequest = doubleDummyTableRequest(original.states[0]);
  const tableAnswer: DoubleDummyTableResult = {
    key: tableRequest.key, engine: ENGINE, elapsedMs: 2, heapBytes: 16 * 1024 * 1024,
    table: Object.fromEntries(SEATS.map((seat, seatIndex) => [seat,
      Object.fromEntries(STRAINS.map((strain, strainIndex) => [strain, (seatIndex + strainIndex) % 14]))
    ])) as DoubleDummyTableResult['table']
  };
  class FakeWorker implements WorkerLike {
    onmessage: WorkerLike['onmessage'] = null; onerror: WorkerLike['onerror'] = null;
    sent: { id: number; kind?: 'position' | 'table'; position?: unknown; request?: unknown }[] = []; terminated = false;
    postMessage(value: unknown) { this.sent.push(value as typeof this.sent[number]); }
    terminate() { this.terminated = true; }
    reply(value: unknown, id = this.sent.at(-1)!.id, kind = this.sent.find(item => item.id === id)?.kind) {
      this.onmessage?.({ data: { id, kind, result: value } } as MessageEvent);
    }
  }
  it('uses the worker only for uncached positions and persists exact results across clients', async () => {
    const store = storage(); const worker = new FakeWorker(); const client = new AnalysisClient(store, () => worker);
    const pending = client.solve(position); worker.reply(answer); expect(await pending).toEqual(answer);
    expect(await client.solve(position)).toEqual(answer); expect(worker.sent).toHaveLength(1);
    const factory = vi.fn(() => new FakeWorker()); const restored = new AnalysisClient(store, factory);
    expect(await restored.solve(position)).toEqual(answer); expect(factory).not.toHaveBeenCalled(); client.dispose(); restored.dispose();
  });
  it('aborting terminates synchronous WASM work and a new request creates a fresh worker', async () => {
    const workers: FakeWorker[] = []; const client = new AnalysisClient(undefined, () => { const worker = new FakeWorker(); workers.push(worker); return worker; });
    const abort = new AbortController(); const pending = client.solve(position, abort.signal);
    const rejection = expect(pending).rejects.toBeInstanceOf(AnalysisCancelled); abort.abort(); await rejection;
    expect(workers[0].terminated).toBe(true);
    const retried = client.solve(position); workers[1].reply(answer); expect(await retried).toEqual(answer); client.dispose();
  });
  it('timeouts stop stalled workers and retain previously saved results', async () => {
    const store = storage(); store.setItem(CACHE_KEY, JSON.stringify({ engine: ENGINE, entries: [[position.key, answer]] }));
    vi.useFakeTimers(); const worker = new FakeWorker(); const client = new AnalysisClient(store, () => worker, 10);
    const pending = client.solve(analysisPosition(original.states[1])); const rejected = expect(pending).rejects.toThrow('超过');
    await vi.advanceTimersByTimeAsync(11); await rejected; expect(worker.terminated).toBe(true);
    expect(client.peek(position)).toEqual(answer); client.dispose(); vi.useRealTimers();
  });
  it('rejects missing legal candidates and stale or impossible cached values rather than displaying them', async () => {
    const store = storage(); store.setItem(CACHE_KEY, JSON.stringify({ engine: ENGINE, entries: [[position.key, { ...answer, candidates: [] }]] }));
    const worker = new FakeWorker(); const client = new AnalysisClient(store, () => worker);
    expect(client.peek(position)).toBeUndefined(); const pending = client.solve(position);
    const rejected = expect(pending).rejects.toThrow('完整性'); worker.reply({ ...answer, declarerTricks: 99 }); await rejected; client.dispose();
  });
  it('cache quota failures still return the real result, and the terminal position needs no worker', async () => {
    const worker = new FakeWorker(); const client = new AnalysisClient({ getItem: () => null, setItem: () => { throw new Error('quota'); } }, () => worker);
    const pending = client.solve(position); worker.reply(answer); expect(await pending).toEqual(answer); expect(client.cacheSaved).toBe(false);
    const terminal = await client.solve(analysisPosition(original.states[52])); expect(terminal.declarerTricks).toBe(game.result!.declarerTricks); expect(worker.sent).toHaveLength(1); client.dispose();
  });
  it('routes position and table requests by id and reuses a validated table without another worker call', async () => {
    const worker = new FakeWorker(); const client = new AnalysisClient(undefined, () => worker);
    const positionPending = client.solve(position); const tablePending = client.solveTable(tableRequest);
    expect(worker.sent).toEqual([
      { id: 1, kind: 'position', position },
      { id: 2, kind: 'table', request: tableRequest }
    ]);
    worker.reply(tableAnswer, 2); expect(await tablePending).toEqual(tableAnswer);
    worker.reply(answer, 1); expect(await positionPending).toEqual(answer);
    expect(await client.solveTable(tableRequest)).toEqual(tableAnswer);
    expect(worker.sent).toHaveLength(2); client.dispose();
  });
  it('rejects malformed, out-of-range, stale-key and wrong-kind table replies', async () => {
    const worker = new FakeWorker(); const client = new AnalysisClient(undefined, () => worker);
    const malformed = structuredClone(tableAnswer) as DoubleDummyTableResult;
    delete (malformed.table.N as Partial<DoubleDummyTableResult['table']['N']>).C;
    let pending = client.solveTable(tableRequest); worker.reply(malformed);
    await expect(pending).rejects.toThrow('完整性');
    const outOfRange = structuredClone(tableAnswer); outOfRange.table.W.NT = 14;
    pending = client.solveTable(tableRequest); worker.reply(outOfRange);
    await expect(pending).rejects.toThrow('完整性');
    pending = client.solveTable(tableRequest); worker.reply({ ...tableAnswer, key: `${tableAnswer.key}-stale` });
    await expect(pending).rejects.toThrow('完整性');
    pending = client.solveTable(tableRequest); worker.reply(tableAnswer, undefined, 'position');
    await expect(pending).rejects.toThrow('类型不匹配'); client.dispose();
  });
});

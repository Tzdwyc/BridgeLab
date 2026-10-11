import loadDds from './vendor/dds.mjs';
import { SEATS, type Strain } from '../core/types';
import { type AnalysisPosition, type DdsDeal, type DoubleDummyTable, type DoubleDummyTableRequest, type DoubleDummyTableResult, type RawFutureTricks, ENGINE } from './types';
import { normalizeResult } from './adapter';

type Module = Awaited<ReturnType<typeof loadDds>>;
const TABLE_STRAINS: Strain[] = ['S', 'H', 'D', 'C', 'NT'];
export class DdsEngine {
  private constructor(private module: Module) {}
  static async create() {
    const module = await loadDds();
    module.ccall('SetMaxThreads', null, ['number'], [1]);
    return new DdsEngine(module);
  }
  get heapBytes() { return this.module.getHeapBytes(); }
  private writeDeal(deal: DdsDeal, ptr: number) {
    const m = this.module;
    m.setValue(ptr, deal.trump, 'i32'); m.setValue(ptr + 4, deal.first, 'i32');
    for (let i = 0; i < 3; i++) {
      m.setValue(ptr + 8 + i * 4, deal.currentTrickSuit[i] ?? 0, 'i32');
      m.setValue(ptr + 20 + i * 4, deal.currentTrickRank[i] ?? 0, 'i32');
    }
    m.stringToUTF8(deal.remainCards, ptr + 32, 80);
  }
  raw(deal: DdsDeal): RawFutureTricks {
    const m = this.module; const input = m._malloc(112); const output = m._malloc(216);
    try {
      this.writeDeal(deal, input);
      // target=-1, solutions=3 evaluates every legal equivalence class. mode=1
      // forces a real value even when only one card remains (mode=0 gives -2).
      const code = m.ccall('SolveBoardPBN', 'number', Array(6).fill('number'), [input, -1, 3, 1, output, 0]);
      if (code !== 1) throw new Error(`DDS 求解失败（${code}）`);
      const cards = m.getValue(output + 4, 'i32');
      const array = (offset: number) => Array.from({ length: cards }, (_, i) => m.getValue(output + offset + 4 * i, 'i32'));
      return { nodes: m.getValue(output, 'i32'), cards, suit: array(8), rank: array(60), equals: array(112), score: array(164) };
    } finally { m._free(input); m._free(output); }
  }
  solve(position: AnalysisPosition) {
    const started = performance.now();
    const raw = position.terminalTricks === null ? this.raw(position.deal) : { cards: 0, nodes: 0, suit: [], rank: [], equals: [], score: [] };
    return normalizeResult(position, raw, performance.now() - started, this.heapBytes);
  }
  table(request: DoubleDummyTableRequest): DoubleDummyTableResult {
    if (request.key !== JSON.stringify([ENGINE, 'table', request.cards]) || request.cards.length >= 80 || !/^[NESW]:[AKQJT2-9. ]+$/i.test(request.cards)) {
      throw new Error('双明手总表请求无效');
    }
    const started = performance.now();
    const m = this.module; const input = m._malloc(80); const output = m._malloc(80);
    try {
      m.stringToUTF8(request.cards, input, 80);
      const code = m.ccall('CalcDDtablePBN', 'number', ['number', 'number'], [input, output]);
      if (code !== 1) throw new Error(`DDS 双明手总表求解失败（${code}）`);
      const table = Object.fromEntries(SEATS.map((seat, hand) => [seat, Object.fromEntries(TABLE_STRAINS.map((strain, strainIndex) => {
        const tricks = m.getValue(output + 4 * (strainIndex * SEATS.length + hand), 'i32');
        if (!Number.isInteger(tricks) || tricks < 0 || tricks > 13) throw new Error('DDS 双明手总表包含无效墩数');
        return [strain, tricks];
      }))])) as DoubleDummyTable;
      return { key: request.key, engine: ENGINE, table, elapsedMs: performance.now() - started, heapBytes: this.heapBytes };
    } finally { m._free(input); m._free(output); }
  }
  trace(deal: DdsDeal, cards: string): number[] {
    const m = this.module; const input = m._malloc(112); const plays = m._malloc(112); const output = m._malloc(216);
    try {
      this.writeDeal(deal, input);
      m.setValue(plays, cards.length / 2, 'i32'); m.stringToUTF8(cards, plays + 4, 106);
      const code = m.ccall('AnalysePlayPBN', 'number', Array(4).fill('number'), [input, plays, output, 0]);
      if (code !== 1) throw new Error(`DDS 逐张分析失败（${code}）`);
      const length = m.getValue(output, 'i32');
      return Array.from({ length }, (_, i) => m.getValue(output + 4 + 4 * i, 'i32'));
    } finally { m._free(input); m._free(plays); m._free(output); }
  }
}

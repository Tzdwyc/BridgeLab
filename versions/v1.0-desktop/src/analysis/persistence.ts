import { decodeSession } from '../persistence/session';
import { type Contract, type GameRecord, SEATS, STRAINS } from '../core/types';
import { activeLine, branchLine, openDocument, replayLine, type AnalysisDocument, type Branch } from './model';

export const WORKSPACE_KEY = 'bridgelab.analysis.workspace.v3.6';
export const ARCHIVE_KEY = 'bridgelab.analysis.archive.v3.6';
const LEGACY_WORKSPACE_KEY = 'bridgelab.analysis.workspace.v3.5';
const LEGACY_ARCHIVE_KEY = 'bridgelab.analysis.archive.v3.5';
export function saveDocument(storage: Pick<Storage, 'getItem' | 'setItem'>, document: AnalysisDocument) {
  storage.setItem(WORKSPACE_KEY, JSON.stringify(document));
  let archive: AnalysisDocument[] = [];
  try { const parsed = JSON.parse(storage.getItem(ARCHIVE_KEY) ?? storage.getItem(LEGACY_ARCHIVE_KEY) ?? '[]'); if (Array.isArray(parsed)) archive = parsed.slice(-12); } catch { /* Current workspace remains independent. */ }
  const source = JSON.stringify(document.source);
  archive = archive.filter(d => d && JSON.stringify(d.source) !== source);
  storage.setItem(ARCHIVE_KEY, JSON.stringify([...archive, document].slice(-12)));
}
export function findSavedDocument(storage: Pick<Storage, 'getItem'>, record: GameRecord): AnalysisDocument | null {
  try {
    const archive = JSON.parse(storage.getItem(ARCHIVE_KEY) ?? storage.getItem(LEGACY_ARCHIVE_KEY) ?? '[]');
    if (!Array.isArray(archive)) return null;
    const found = archive.slice(-12).find(d => d && JSON.stringify(d.source) === JSON.stringify(record));
    return found ? decodeDocument(JSON.stringify(found)) : null;
  } catch { return null; }
}
export function decodeDocument(raw: string): AnalysisDocument {
  if (raw.length > 2_000_000) throw new Error('分析文件超过 2 MB');
  const data = JSON.parse(raw) as AnalysisDocument;
  if (!data || data.version !== 2 || typeof data.name !== 'string' || data.name.length > 80 || !Array.isArray(data.branches) || data.branches.length > 12 || !Number.isInteger(data.cursor) || data.cursor < 0 || data.cursor > 52 || !(data.activeBranch === null || typeof data.activeBranch === 'string')) throw new Error('分析文件格式或版本不受支持');
  let analysisContract: Contract | null = null;
  if (data.analysisContract !== null && data.analysisContract !== undefined) {
    const contract = data.analysisContract;
    if (!contract || !Number.isInteger(contract.level) || contract.level < 1 || contract.level > 7 || !STRAINS.includes(contract.strain) || !SEATS.includes(contract.declarer) || !SEATS.includes(contract.dummy) || !SEATS.includes(contract.leader) || contract.doubled !== 0) throw new Error('假设定约格式损坏');
    analysisContract = structuredClone(contract);
  }
  const original = replayLine(data.source, analysisContract); const ids = new Set<string>();
  const branches: Branch[] = data.branches.map(branch => {
    if (!branch || typeof branch.id !== 'string' || !branch.id || branch.id.length > 100 || ids.has(branch.id) || typeof branch.name !== 'string' || branch.name.length > 40 || !Number.isInteger(branch.start) || branch.start < 0 || branch.start > 51 || !Array.isArray(branch.cards) || branch.cards.length > 52 - branch.start || branch.cards.some(id => typeof id !== 'string') || !Number.isInteger(branch.cursor) || branch.cursor < 0 || branch.cursor > branch.start + branch.cards.length) throw new Error('试打分支格式损坏');
    ids.add(branch.id); const clean = { id: branch.id, name: branch.name, start: branch.start, cards: [...branch.cards], cursor: branch.cursor };
    branchLine(original, clean); return clean;
  });
  if (data.activeBranch !== null && !ids.has(data.activeBranch)) throw new Error('选中的试打分支不存在');
  if (data.cursor > original.states.length - 1 && data.activeBranch === null) throw new Error('原局分析位置超出实际记录');
  const document = { version: 2 as const, name: data.name, source: structuredClone(data.source), cursor: data.cursor, activeBranch: data.activeBranch, branches, analysisContract };
  activeLine(document); return document;
}
export function importDocument(raw: string): AnalysisDocument {
  if (raw.length > 2_000_000) throw new Error('文件超过 2 MB');
  const data = JSON.parse(raw) as { version?: number };
  if (data?.version === 2) return decodeDocument(raw);
  if (data?.version === 1) {
    const session = decodeSession(raw);
    const games = [...session.history, ...(session.game ? [session.game] : [])].filter(g => g.phase === 'complete');
    if (!games.length) throw new Error('该 v0.1 存档没有已完成 13 墩的牌局');
    return openDocument(games.at(-1)!, '导入的 v0.1 牌局');
  }
  throw new Error('请导入 BridgeLab 分析文件或 v0.1 存档 JSON');
}
export function loadDocument(storage: Pick<Storage, 'getItem' | 'setItem'>): { document: AnalysisDocument | null; notice: string | null } {
  try {
    const raw = storage.getItem(WORKSPACE_KEY) ?? storage.getItem(LEGACY_WORKSPACE_KEY); if (!raw) return { document: null, notice: null };
    try { return { document: decodeDocument(raw), notice: null }; }
    catch {
      storage.setItem(`${WORKSPACE_KEY}.rejected.${Date.now()}`, raw);
      return { document: null, notice: '分析存档损坏，原始内容已备份；可重新选择牌局。' };
    }
  } catch { return { document: null, notice: '浏览器无法读取分析存档；本次仍可分析。' }; }
}

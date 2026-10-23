import { describe, expect, it } from 'vitest';
import { openDocument, exampleGame } from '../src/analysis/model';
import { WORKSPACE_KEY, ARCHIVE_KEY, loadDocument, saveDocument, findSavedDocument } from '../src/analysis/persistence';
import { DEAL_LIBRARY_KEY, loadDealLibrary, saveDeal } from '../src/deal-editor/model';
import { newGame, toRecord } from '../src/core/game';

const storage = () => {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
};

describe('v036 analysis and deal-library non-destructive upgrade', () => {
  it('reads old analysis workspace/archive, saves the new namespace and retains old bytes', () => {
    const store = storage(), game = exampleGame('upgrade-analysis', 'NT', 'S');
    const document = openDocument(game, '升级前的复盘');
    const raw = JSON.stringify(document), archive = JSON.stringify([document]);
    store.setItem('bridgelab.analysis.workspace.v3.5', raw);
    store.setItem('bridgelab.analysis.archive.v3.5', archive);
    expect(loadDocument(store).document?.name).toBe('升级前的复盘');
    expect(findSavedDocument(store, toRecord(game))?.source).toEqual(document.source);
    saveDocument(store, { ...document, name: '升级后的复盘' });
    expect(store.getItem(WORKSPACE_KEY)).toContain('升级后的复盘');
    expect(store.getItem(ARCHIVE_KEY)).not.toBeNull();
    expect(store.getItem('bridgelab.analysis.workspace.v3.5')).toBe(raw);
    expect(store.getItem('bridgelab.analysis.archive.v3.5')).toBe(archive);
    expect(loadDocument(store).document?.name).toBe('升级后的复盘');
  });
  it('retains old selected deals and writes edits separately', () => {
    const store = storage(), game = newGame(1, 'old-deal');
    const deal = { id: 'old', name: '旧牌例', hands: game.initialHands, dealer: game.dealer, vulnerability: game.vulnerability };
    const raw = JSON.stringify({ version: 1, deals: [deal] });
    store.setItem('bridgelab.deal-editor.library.v3.5', raw);
    expect(loadDealLibrary(store)).toEqual([deal]);
    saveDeal(store, { ...deal, name: '新牌例名称' });
    expect(store.getItem(DEAL_LIBRARY_KEY)).toContain('新牌例名称');
    expect(store.getItem('bridgelab.deal-editor.library.v3.5')).toBe(raw);
    expect(loadDealLibrary(store)[0].name).toBe('新牌例名称');
  });
});

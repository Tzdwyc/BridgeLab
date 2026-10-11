import { describe, expect, it } from 'vitest';
import { openDocument, replayLine } from '../src/analysis/model';
import { robotStep } from '../src/controller/robot';
import { applyCall, newGameFromDeal, replay, toRecord } from '../src/core/game';
import { deck, sortCards } from '../src/core/deal';
import { type Hands, PASS, SEATS } from '../src/core/types';
import { assignmentsFromHands, DEAL_LIBRARY_KEY, deleteDeal, handsFromAssignments, loadDealLibrary, saveDeal, validateHands, type DealDefinition } from '../src/deal-editor/model';
import { decodeSession, emptySession, encodeSession } from '../src/persistence/session';

function fixture(name: string, id: string): DealDefinition {
  const cards = deck();
  const hands = Object.fromEntries(SEATS.map((seat, index) => [seat, sortCards(cards.filter((_, cardIndex) => cardIndex % 4 === index))])) as Hands;
  return { id, name, hands, dealer: 'W', vulnerability: 'Both' };
}
function storage() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

describe('deal workbench', () => {
  it('requires all 52 unique legal cards and exactly 13 cards per seat', () => {
    const deal = fixture('完整牌例', 'complete');
    expect(validateHands(deal.hands)).toEqual(deal.hands);
    expect(handsFromAssignments(assignmentsFromHands(deal.hands))).toEqual(deal.hands);
    const duplicate = structuredClone(deal.hands); duplicate.N[0] = { ...duplicate.E[0] };
    expect(() => validateHands(duplicate)).toThrow('不能重复');
    const short = structuredClone(deal.hands); short.N.pop();
    expect(() => validateHands(short)).toThrow('各有 13 张');
  });

  it('saves, loads, updates and deletes multiple named deals in the v3.3 namespace', () => {
    const store = storage(); const first = fixture('牌例一', 'one'); const second = { ...fixture('牌例二', 'two'), dealer: 'S' as const };
    saveDeal(store, first); saveDeal(store, second);
    expect(loadDealLibrary(store).map(deal => deal.name)).toEqual(['牌例一', '牌例二']);
    saveDeal(store, { ...first, name: '牌例一（修订）' });
    expect(loadDealLibrary(store).map(deal => deal.name)).toEqual(['牌例二', '牌例一（修订）']);
    expect(deleteDeal(store, 'two').map(deal => deal.id)).toEqual(['one']);
    expect(store.values.has(DEAL_LIBRARY_KEY)).toBe(true); expect(DEAL_LIBRARY_KEY).toBe('bridgelab.deal-editor.library.v3.3');
  });

  it('preserves a custom deal through session replay, full play and double-dummy analysis handoff', () => {
    const deal = fixture('全流程', 'flow');
    let game = newGameFromDeal(1, `custom:${deal.id}`, deal.hands, deal.dealer, deal.vulnerability);
    expect(game.turn).toBe('W'); expect(game.initialHands).toEqual(deal.hands);
    const decoded = decodeSession(encodeSession({ ...emptySession(), game }));
    expect(decoded.game?.initialHands).toEqual(deal.hands); expect(decoded.game?.dealer).toBe('W'); expect(decoded.game?.vulnerability).toBe('Both');
    game = applyCall(game, 'W', { kind: 'bid', level: 1, strain: 'NT' });
    game = applyCall(game, 'N', PASS); game = applyCall(game, 'E', PASS); game = applyCall(game, 'S', PASS);
    for (let guard = 0; guard < 60 && game.phase === 'play'; guard++) game = robotStep(game).game;
    expect(game.phase).toBe('complete'); expect(game.completedTricks).toHaveLength(13);
    expect(replay(toRecord(game))).toEqual(game);
    const document = openDocument(game); expect(document.source.customSetup?.hands).toEqual(deal.hands);
    expect(replayLine(document.source).states).toHaveLength(53);
  });
});

import { type GameRecord, type GameState } from '../core/types';
import { openDocument } from './model';
import { findSavedDocument, saveDocument } from './persistence';
import { toRecord } from '../core/game';
import { canReviewGame, useGame } from '../controller/store';
import { reviewSourceIdentity, saveReviewState } from './review-state';

export interface HistoryNavigationState {
  filter: 'all' | 'total' | 'imp';
  page: number;
  boardIndex: number;
  view: 'result' | 'main' | 'reference' | 'info';
}
export interface HistoryReviewContext extends HistoryNavigationState { matchId: string }
const HISTORY_KEY = 'bridgelab.history.navigation.v3.2';
const RETURN_KEY = 'bridgelab.analysis.return.v3.2';
const RETURN_SOURCE_KEY = 'bridgelab.analysis.return-source.v3.2';
const historyMemory = new Map<string, Partial<HistoryNavigationState>>();
const validOrigin = (origin: string) => /^#\/(table|history(?:\/[^#?]*)?|home)$/.test(origin) ? origin : '#/table';
function readHistory(key: string): Partial<HistoryNavigationState> {
  const cached = historyMemory.get(key); if (cached) return cached;
  try { const value = JSON.parse(sessionStorage.getItem(key) ?? '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; }
}
export function loadHistoryNavigation(matchId?: string): HistoryNavigationState {
  const list = readHistory(HISTORY_KEY), detail = matchId ? readHistory(`${HISTORY_KEY}.${encodeURIComponent(matchId)}`) : {};
  return {
    filter: list.filter === 'total' || list.filter === 'imp' ? list.filter : 'all',
    page: Number.isInteger(list.page) && list.page! >= 0 ? list.page! : 0,
    boardIndex: Number.isInteger(detail.boardIndex) && detail.boardIndex! >= 0 ? detail.boardIndex! : 0,
    view: detail.view === 'main' || detail.view === 'reference' || detail.view === 'info' ? detail.view : 'result'
  };
}
export function saveHistoryNavigation(matchId: string | undefined, partial: Partial<HistoryNavigationState>): void {
  const state = { ...loadHistoryNavigation(matchId), ...partial };
  const write = (key: string, value: Partial<HistoryNavigationState>) => {
    historyMemory.set(key, value);
    try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Returning within this session still works. */ }
  };
  write(HISTORY_KEY, { filter: state.filter, page: state.page });
  if (matchId) write(`${HISTORY_KEY}.${encodeURIComponent(matchId)}`, { boardIndex: state.boardIndex, view: state.view });
}

let transient: ReturnType<typeof openDocument> | null = null;
let returnHash = '#/table';
let returnSource: string | null = null;
try { returnHash = validOrigin(sessionStorage.getItem(RETURN_KEY) ?? returnHash); } catch { /* Default table return remains available. */ }
try { returnSource = sessionStorage.getItem(RETURN_SOURCE_KEY); } catch { /* No source-specific origin was restored. */ }
export const analysisReturnHash = (source?: GameRecord) => source && reviewSourceIdentity(source) !== returnSource ? '#/analysis' : returnHash;
export const takePendingDocument = () => { const value = transient; transient = null; return value; };
export function openAnalysis(game: GameState, origin = '#/table', context?: HistoryReviewContext, biddingExplanations?: string[]) {
  if (!canReviewGame(game)) {
    useGame.setState({ notice: '本副两桌尚未全部结束，结束后可以复盘。' });
    return false;
  }
  returnHash = validOrigin(origin);
  if (context) saveHistoryNavigation(context.matchId, context);
  try { sessionStorage.setItem(RETURN_KEY, returnHash); } catch { /* The in-memory return location remains available. */ }
  transient = openDocument(game, undefined, biddingExplanations);
  try { transient = findSavedDocument(localStorage, toRecord(game)) ?? transient;
    if (biddingExplanations) transient = { ...transient, biddingExplanations: [...biddingExplanations] };
    saveDocument(localStorage, transient); } catch { /* In-memory handoff still works. */ }
  returnSource = reviewSourceIdentity(transient.source);
  try { sessionStorage.setItem(RETURN_SOURCE_KEY, returnSource); } catch { /* The current source still keeps its in-memory origin. */ }
  saveReviewState(transient.source, { entry: 'review' });
  location.hash = '/analysis'; window.dispatchEvent(new Event('bridgelab-open-analysis'));
  return true;
}

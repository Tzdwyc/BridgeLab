import { type GameState } from '../core/types';
import { openDocument } from './model';
import { findSavedDocument, saveDocument } from './persistence';
import { toRecord } from '../core/game';
import { canReviewGame, useGame } from '../controller/store';

let transient: ReturnType<typeof openDocument> | null = null;
let returnHash = '#/table';
export const analysisReturnHash = () => returnHash;
export const takePendingDocument = () => { const value = transient; transient = null; return value; };
export function openAnalysis(game: GameState, origin = '#/table') {
  if (!canReviewGame(game)) {
    useGame.setState({ notice: '本副两桌尚未全部结束，结束后可以复盘。' });
    return false;
  }
  returnHash = /^#\/(table|history(?:\/[^#?]*)?|home)$/.test(origin) ? origin : '#/table';
  transient = openDocument(game);
  try { transient = findSavedDocument(localStorage, toRecord(game)) ?? transient; saveDocument(localStorage, transient); } catch { /* In-memory handoff still works. */ }
  location.hash = '/analysis'; window.dispatchEvent(new Event('bridgelab-open-analysis'));
  return true;
}

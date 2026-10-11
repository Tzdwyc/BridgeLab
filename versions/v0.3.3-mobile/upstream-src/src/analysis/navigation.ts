import { type GameState } from '../core/types';
import { openDocument } from './model';
import { findSavedDocument, saveDocument } from './persistence';
import { toRecord } from '../core/game';

let transient: ReturnType<typeof openDocument> | null = null;
export const takePendingDocument = () => { const value = transient; transient = null; return value; };
export function openAnalysis(game: GameState) {
  transient = openDocument(game);
  try { transient = findSavedDocument(localStorage, toRecord(game)) ?? transient; saveDocument(localStorage, transient); } catch { /* In-memory handoff still works. */ }
  location.hash = '/analysis'; window.dispatchEvent(new Event('bridgelab-open-analysis'));
}

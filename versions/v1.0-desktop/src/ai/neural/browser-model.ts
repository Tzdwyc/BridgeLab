/** Local model loading/selection only. No training or changes to convention rules. */
import { chooseLegal, loadModelFromBuffer, type ModelManifest, type NeuralModel } from './index';
import type { BiddingObservation } from '../observation';
import type { Call } from '../../core/types';
import { sha256 } from './sha256';

export type SLProfileId = 'seed101-epoch08' | 'original-sl';
export const DEFAULT_SL_PROFILE: SLProfileId = 'seed101-epoch08';
export const SL_STORAGE_KEY = 'bridgelab.sl.profile.v1';
export const SL_PROFILES = {
  'seed101-epoch08': { label: 'SL · 第8轮', weightsSHA256: '41556ff0f83ced20eeea66a853b87269f3de0ac62b1aca75abce4bf9a63275e3' },
  'original-sl': { label: '原SL · 回退', weightsSHA256: '96cc4c3c993d168657e216b8b3bf3ebb681493b965dd6c908ecdee14d45b375f' },
} as const;
const MANIFEST_SHA256 = 'ca0a297cb401400465ef0a40088348db2f2241816da11f9ce948c3bcf4b572e9';
export interface SLBidTrace {
  profileId: SLProfileId; loadedWeightsSHA256: string; route: 'sl-legal';
  board: number; seat: string; historyLength: number; action: number; rawTopAction: number; call: Call;
}
export interface SLModelState {
  profileId: SLProfileId; status: 'idle' | 'loading' | 'ready' | 'error';
  loadedWeightsSHA256: string | null; error: string | null; appliedBids: number; lastBid: SLBidTrace | null;
}
interface Loaded { model: NeuralModel; profileId: SLProfileId; loadedWeightsSHA256: string }
const listeners = new Set<() => void>(), cache = new Map<SLProfileId, Promise<Loaded>>();
function preferred(): SLProfileId {
  try { const id = localStorage.getItem(SL_STORAGE_KEY); if (id === 'original-sl' || id === 'seed101-epoch08') return id; } catch { /* Storage is optional. */ }
  return DEFAULT_SL_PROFILE;
}
let state: SLModelState = { profileId: preferred(), status: 'idle', loadedWeightsSHA256: null, error: null, appliedBids: 0, lastBid: null };
export const getSLModelState = () => state;
export const subscribeSLModel = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function update(patch: Partial<SLModelState>) { state = { ...state, ...patch }; listeners.forEach(listener => listener()); }
async function fetchBuffer(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`模型文件读取失败（${response.status}），请检查安装文件后重试。`);
  return response.arrayBuffer();
}
async function load(profileId: SLProfileId): Promise<Loaded> {
  let promise = cache.get(profileId);
  if (!promise) {
    promise = (async () => {
      const base = `${import.meta.env.BASE_URL}models/sl/${profileId}/`;
      const [manifestBytes, weights] = await Promise.all([fetchBuffer(base + 'sl.json'), fetchBuffer(base + 'sl.bin')]);
      if (await sha256(manifestBytes) !== MANIFEST_SHA256 || await sha256(weights) !== SL_PROFILES[profileId].weightsSHA256)
        throw new Error('模型文件校验失败，已停止叫牌。请重新安装或手动切回原SL。');
      const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ModelManifest;
      const model = loadModelFromBuffer(manifest, weights), backing = model.layers[0].w.buffer;
      if (backing !== weights || model.layers.some(layer => layer.w.buffer !== backing || layer.b.buffer !== backing))
        throw new Error('实际推理权重与已校验文件不一致。');
      const loadedWeightsSHA256 = await sha256(backing as ArrayBuffer);
      if (loadedWeightsSHA256 !== SL_PROFILES[profileId].weightsSHA256) throw new Error('推理内存校验失败。');
      return { model, profileId, loadedWeightsSHA256 };
    })();
    cache.set(profileId, promise);
    promise.catch(() => { if (cache.get(profileId) === promise) cache.delete(profileId); });
  }
  return promise;
}
export async function ensureSLReady(): Promise<void> {
  const id = state.profileId;
  if (state.status !== 'ready') update({ status: 'loading', error: null });
  try {
    const loaded = await load(id);
    if (state.profileId === id) update({ status: 'ready', loadedWeightsSHA256: loaded.loadedWeightsSHA256, error: null });
  } catch (error) {
    if (state.profileId === id) update({ status: 'error', loadedWeightsSHA256: null, error: error instanceof Error ? error.message : '模型读取失败。' });
    throw error;
  }
}
export async function setSLProfile(profileId: SLProfileId): Promise<void> {
  if (!(profileId in SL_PROFILES)) throw new Error('不支持的叫牌模型。');
  update({ profileId, status: 'loading', loadedWeightsSHA256: null, error: null, appliedBids: 0, lastBid: null });
  await ensureSLReady();
  if (state.profileId === profileId) { try { localStorage.setItem(SL_STORAGE_KEY, profileId); } catch { /* Remains selected in memory. */ } }
}
export async function suggestSLBid(observation: BiddingObservation): Promise<{ call: Call; trace: SLBidTrace }> {
  const id = state.profileId; await ensureSLReady();
  if (state.profileId !== id) throw new Error('叫牌模型已切换，请重试。');
  const loaded = await load(id), result = chooseLegal(loaded.model, observation);
  if (state.profileId !== id) throw new Error('叫牌模型已切换，请重试。');
  return { call: result.call, trace: { profileId: id, loadedWeightsSHA256: loaded.loadedWeightsSHA256,
    route: 'sl-legal', board: observation.board, seat: observation.seat, historyLength: observation.auction.length,
    action: result.action, rawTopAction: result.rawTopAction, call: result.call } };
}
/** Called by the actual controller after applyAction accepts the chosen call. */
export function recordAppliedSLBid(trace: SLBidTrace): void {
  update({ lastBid: trace, appliedBids: state.appliedBids + 1 });
}

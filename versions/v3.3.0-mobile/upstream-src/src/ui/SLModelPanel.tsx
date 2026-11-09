import { useSyncExternalStore } from 'react';
import { getSLModelState, subscribeSLModel, setSLProfile, type SLProfileId } from '../ai/neural/browser-model';
import type { BiddingSystem } from '../ai/systems';
export default function SLModelPanel({ busy, system }: { busy: boolean; system?: BiddingSystem }) {
  const model = useSyncExternalStore(subscribeSLModel, getSLModelState);
  if (system === 'precision') return null;
  return <section aria-label="叫牌引擎"><label>叫牌引擎 <select aria-label="叫牌引擎" value={model.profileId}
    disabled={busy || model.status === 'loading'} onChange={event => { void setSLProfile(event.target.value as SLProfileId).catch(() => {}); }}>
    <option value="seed101-epoch08">默认</option><option value="original-sl">备用</option>
  </select></label>{model.status === 'error' && <p role="alert">叫牌服务暂不可用。<button onClick={() => { void setSLProfile(model.profileId).catch(() => {}); }}>重试</button></p>}</section>;
}

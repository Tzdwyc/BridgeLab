import { useSyncExternalStore } from 'react';
import { getSLModelState, subscribeSLModel, setSLProfile, SL_PROFILES, type SLProfileId } from '../ai/neural/browser-model';
import { callLabel, seatName } from './format';
import type { Seat } from '../core/types';

export default function SLModelPanel({ busy }: { busy: boolean }) {
  const model = useSyncExternalStore(subscribeSLModel, getSLModelState);
  return <section aria-label="叫牌模型" style={{ borderTop: '1px solid #ddd8cc', marginTop: 16, paddingTop: 12 }}>
    <h3>叫牌模型</h3>
    <label>当前模型 <select aria-label="叫牌模型" value={model.profileId} disabled={busy || model.status === 'loading'}
      onChange={event => { void setSLProfile(event.target.value as SLProfileId).catch(() => {}); }}>
      <option value="seed101-epoch08">第8轮（默认）</option><option value="original-sl">原SL（回退）</option>
    </select></label>
    <p role="status" data-testid="sl-model-status">{SL_PROFILES[model.profileId].label} · {model.status === 'ready' ? '已加载并校验' : model.status === 'error' ? '加载失败' : '正在加载…'}</p>
    {model.error && <p role="alert">{model.error} <button onClick={() => { void setSLProfile(model.profileId).catch(() => {}); }}>重试</button></p>}
    <p>切回原SL后，后续机器人叫牌与提示立即使用原模型；已完成的叫牌记录保持原样。</p>
    <details><summary>查看加载校验与叫牌记录</summary>
      <p style={{ overflowWrap: 'anywhere' }}>实际加载 SHA-256：<code data-testid="sl-loaded-sha">{model.loadedWeightsSHA256 ?? '尚未加载'}</code></p>
      <p>本次模型已执行机器人叫牌：{model.appliedBids} 次</p>
      {model.lastBid && <p data-testid="sl-last-bid">最近一次：{seatName[model.lastBid.seat as Seat]}家 {callLabel(model.lastBid.call)}，使用{SL_PROFILES[model.lastBid.profileId].label}。</p>}
    </details>
  </section>;
}

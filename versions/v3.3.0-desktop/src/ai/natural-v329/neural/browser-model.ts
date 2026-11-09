/** Frozen SAYC postprocessing over the application's one shared model instance. */
import { suggestSLBid as sharedSuggest, type SLBidTrace } from '../../neural/browser-model';
import { adjustPenaltyDouble } from '../penalty-doubles';
import { callToAction } from './index';
import type { BiddingObservation } from '../observation';
import type { BiddingSystem } from '../systems';
export * from '../../neural/browser-model';
const reasons = {
 'make-penalty-double': '防守牌力支持惩罚性加倍',
 'avoid-penalty-double': '防守牌力不足以作惩罚性加倍',
 'keep-partner-penalty-double': '保留搭档的惩罚性加倍',
 'escape-penalty-double': '己方被惩罚性加倍，改叫符合约定的自然花色',
};
export async function suggestSLBid(observation: BiddingObservation, options: {system?: BiddingSystem; allowLookahead?: boolean} = {}) {
 if (options.system !== 'sayc') throw new Error('Frozen Natural route requires the original SAYC baseline');
 const selected = await sharedSuggest(observation, {...options, postprocess:false});
 const penalty = selected.trace.profileId === 'seed101-epoch08' && adjustPenaltyDouble(observation, selected.call, 'sayc');
 if (!penalty) return selected;
 const call=penalty.call;
 return {call,trace:{...selected.trace,call,action:callToAction(call),route:'penalty-double' as SLBidTrace['route'],reason:reasons[penalty.reason]}};
}

import { type Call, type Card, type Contract, type Strain } from '../core/types';
import { rankLabel } from './format';

export function SuitGlyph({ suit }: { suit: Strain }) {
  if (suit === 'NT') return <span className="suit-nt">NT</span>;
  return <svg className={`suit-glyph suit-${suit}`} viewBox="0 0 32 36" aria-hidden="true" data-suit={suit}>
    {suit === 'S' && <path d="M16 1C13 6 2 12 2 20a8 8 0 0 0 13 6c0 4-2 6-5 8h12c-3-2-5-4-5-8a8 8 0 0 0 13-6C30 12 19 6 16 1Z" />}
    {suit === 'C' && <><circle cx="16" cy="9" r="7.5" /><circle cx="8" cy="21" r="7.5" /><circle cx="24" cy="21" r="7.5" /><path d="M13 17h6v8c0 4 2 7 5 9H8c3-2 5-5 5-9Z" /></>}
    {suit === 'H' && <path d="M16 32 3 19C-4 11 3 1 10 3c3 1 5 3 6 5 1-2 3-4 6-5 7-2 14 8 7 16Z" />}
    {suit === 'D' && <path d="m16 1 14 17-14 17L2 18Z" />}
  </svg>;
}
export function CardLabel({ card }: { card: Card }) { return <span className="card-label"><SuitGlyph suit={card.suit} /><b>{rankLabel(card.rank)}</b></span>; }
export function CallDisplay({ call }: { call: Call }) {
  return call.kind === 'bid' ? <span className="call-display">{call.level}<SuitGlyph suit={call.strain} /></span> : <>{call.kind === 'pass' ? 'Pass' : call.kind === 'double' ? 'X' : 'XX'}</>;
}
export function ContractDisplay({ contract }: { contract: Contract | null }) {
  return contract ? <span className="call-display">{contract.level}<SuitGlyph suit={contract.strain} />{contract.doubled === 1 ? ' X' : contract.doubled === 2 ? ' XX' : ''}</span> : <>—</>;
}

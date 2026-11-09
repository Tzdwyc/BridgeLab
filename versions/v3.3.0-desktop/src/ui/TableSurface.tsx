import { type ReactNode, type CSSProperties } from 'react';
import { type Card, type Seat, SUITS } from '../core/types';
import { cardLabel, rankLabel, seatName, suitName } from './format';
import { SuitGlyph } from './SuitGlyph';
import styles from './TableSurface.module.css';

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(' ');

/** Shared view shell. Slots retain their actual compass seats; no game rules live here. */
export function TableSurface({ north, east, west, south, center, panel, auctionHistory, score, summary, phase, className, testId = 'bridge-table' }: {
  north: ReactNode; east: ReactNode; west: ReactNode; south: ReactNode; center: ReactNode;
  panel?: ReactNode; auctionHistory?: ReactNode; score?: ReactNode; summary?: ReactNode; phase?: string; className?: string; testId?: string;
}) {
  return <section className={cx(styles.surface, className)} data-phase={phase} aria-label="四方桥牌桌" data-testid={testId}>
    <div className={styles.felt}>
      {summary && <div className={styles.summary}>{summary}</div>}
      <div className={styles.north}>{north}</div><div className={styles.west}>{west}</div>
      <div className={styles.center}>{center}</div><div className={styles.east}>{east}</div>
    </div>
    <div className={styles.south}>{south}</div>
    {(auctionHistory || score || panel) && <aside className={styles.rail} data-score={!!score || undefined} aria-label="牌局操作与记录">
      {score && <div className={styles.score}>{score}</div>}
      {auctionHistory && <div className={styles.auctionHistory} data-testid="persistent-auction-history">{auctionHistory}</div>}
      {panel && <div className={styles.panel}>{panel}</div>}
    </aside>}
  </section>;
}

export function PlayingCard({ card, seat, disabled = true, onClick, suggested = false, table = false, unplayable = false, testId }: {
  card: Card; seat?: Seat; disabled?: boolean; onClick?: () => void; suggested?: boolean;
  table?: boolean; unplayable?: boolean; testId?: string;
}) {
  const className = cx(styles.card, suggested && styles.suggested, table && styles.tableCard, unplayable && styles.unplayable);
  const body = <><span className={styles.corner}><b>{rankLabel(card.rank)}</b><SuitGlyph suit={card.suit} /></span><span className={styles.pip}><SuitGlyph suit={card.suit} /></span><span className={styles.bottom}>{rankLabel(card.rank)}</span></>;
  return table ? <div className={className} data-suit={card.suit} aria-label={cardLabel(card)} data-testid={testId}>{body}</div>
    : <button type="button" className={className} data-suit={card.suit} disabled={disabled} onClick={onClick}
      aria-label={`${seat ? seatName[seat] + ' ' : ''}${cardLabel(card)}`} data-card={card.id} data-seat={seat} data-recommended={suggested} data-testid={testId}>{body}</button>;
}

export function CardHand({ cards, seat, position = seat, isDummy = false, hidden = false, hiddenCount, active = false, label, legalCardIds = [], onPlay, suggestedId, meta, testId }: {
  cards: Card[]; seat: Seat; position?: Seat; isDummy?: boolean; hidden?: boolean; hiddenCount?: number; active?: boolean; label?: string;
  legalCardIds?: string[]; onPlay?: (id: string) => void; suggestedId?: string | null; meta?: ReactNode; testId?: string;
}) {
  const count = hiddenCount ?? cards.length;
  if (hidden) return <div className={styles.hiddenHand} aria-label={`${seatName[seat]}家 ${count} 张隐藏手牌`}>
    <div className={styles.backs} aria-hidden="true">{Array.from({ length: Math.min(count, 4) }, (_, i) => <i key={i} />)}</div><span data-card-count>{count} 张</span>
  </div>;
  const sorted = [...SUITS].reverse().flatMap(suit => cards.filter(card => card.suit === suit).sort((a, b) => b.rank - a.rank));
  const side = isDummy && (position === 'E' || position === 'W');
  const renderCard = (card: Card) => <PlayingCard key={card.id} card={card} seat={seat} disabled={!onPlay || !legalCardIds.includes(card.id)}
    unplayable={active && !legalCardIds.includes(card.id)} onClick={() => onPlay?.(card.id)} suggested={suggestedId === card.id} />;
  return <section className={cx(styles.hand, isDummy ? styles.dummyHand : styles.playerHand, side && styles.sideHand, active && styles.activeHand)} data-seat={seat} data-position={position} data-layout={isDummy ? 'dummy' : 'player'} aria-label={label ?? '公开手牌'} data-testid={testId ?? `table-hand-${seat}`} style={{ '--card-count': Math.max(1,cards.length) } as CSSProperties}>
    <div className={styles.cards}>{isDummy ? [...SUITS].reverse().map(suit => {
      const suited = sorted.filter(card => card.suit === suit);
      return <div className={styles.suitRow} key={suit} data-suit={suit} data-empty={!suited.length || undefined} data-long={suited.length>6 || undefined} data-testid={`table-suit-${seat}-${suit}`} aria-label={`${seatName[seat]}家明手${suitName[suit]}`} style={{ '--suit-count': Math.max(1,suited.length) } as CSSProperties}>{suited.length ? suited.map(renderCard) : <span className={styles.voidSuit}><SuitGlyph suit={suit} /> —</span>}</div>;
    }) : sorted.map(renderCard)}</div>
    {meta && <div className={styles.handMeta}>{meta}</div>}
  </section>;
}

export function SeatStation({ seat, position = seat, label, detail, call, active, vulnerable, children }: {
  seat: Seat; position?: Seat; label?: string; detail?: string; call?: ReactNode; active?: boolean; vulnerable?: boolean; children?: ReactNode;
}) {
  return <div className={cx(styles.station, active && styles.activeStation)} data-seat={seat} data-position={position} data-testid={`table-seat-${seat}`}>
    <div className={styles.stationName}><span className={styles.seatDisc} data-vulnerable={vulnerable || undefined}>{seat}</span><strong>{label ?? `${seatName[seat]}家`}</strong>{call && <span className={styles.callChip} aria-label="最近叫品">{call}</span>}{detail && <span className={styles.detail}>{detail}</span>}{active && <span className={styles.turn} aria-label="当前轮次">●</span>}</div>
    {children}
  </div>;
}

export function CurrentTrick({ plays, label, empty, positionForSeat }: { plays: { seat: Seat; card: Card }[]; label?: string; empty?: ReactNode; positionForSeat?: Partial<Record<Seat, Seat>> }) {
  return <div className={styles.currentTrick} data-testid="current-trick">{label !== '' && <span className={styles.trickLabel}>{label ?? '本墩'}</span>}<div className={styles.trickCards}>
    {plays.map(play => <div key={play.seat} className={styles[`played${positionForSeat?.[play.seat] ?? play.seat}`]} data-seat={play.seat}><PlayingCard card={play.card} seat={play.seat} table /></div>)}
    {!plays.length && <div className={styles.emptyTrick}>{empty}</div>}
  </div></div>;
}

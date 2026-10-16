import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { registerSW } from 'virtual:pwa-register';
import { type Card, type Call, type GameState, type Seat, SEATS, STRAINS, SUITS, sideOf, isVulnerable } from '../core/types';
import { controllerFor, isFinished, replay } from '../core/game';
import { legalCalls, sameCall } from '../core/auction';
import { legalCards } from '../core/play';
import { observe } from '../ai/observation';
import { evaluateHand, chooseBid, describeCall } from '../ai/bidding';
import { biddingNotices, type BiddingNotice } from '../ai/bidding-notices';
import { SYSTEMS, SHARED_CONVENTIONS, type BiddingSystem } from '../ai/systems';
import { chooseCard } from '../ai/playing';
import { useGame, cumulativeScore } from '../controller/store';
import { seatName, rankLabel, callLabel, cardLabel, vulnerabilityName, signed } from './format';
import styles from './App.module.css';
import { SuitGlyph, CardLabel, CallDisplay, ContractDisplay } from './SuitGlyph';
import { openAnalysis } from '../analysis/navigation';
import AnalysisPage from './AnalysisPage';
import DealEditorPage from '../deal-editor/DealEditorPage';
import { playAdvisor } from '../controller/play-advisor';
import { type PlayStrength } from '../ai/play-advisor-types';
import { HomePage, SetupPage, HistoryPage } from './MatchPages';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const decodeRouteId = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };
const TOOLTIP_RELEASE = 'v0.3.6 · 10月16日修订';

function CallNoticeCards({ notices, compact = false }: { notices: BiddingNotice[]; compact?: boolean }) {
  if (!notices.length) return null;
  return <span className={cx(styles.callNoticeCards, compact && styles.compactCallNotices)}>{notices.map(notice =>
    <span key={notice.kind} className={cx(styles.callNotice, styles.stopCard)} title={notice.explanation} aria-label={`${notice.label}：${notice.explanation}`}>{notice.label}</span>
  )}</span>;
}

function ExplainedCall({ explanation, children, className, focusable = false }: { explanation: string; children: ReactNode; className?: string; focusable?: boolean }) {
  const host = useRef<HTMLSpanElement>(null); const [anchor, setAnchor] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const hold = useRef<number | null>(null); const consumed = useRef(false);
  const cancelHold = () => { if (hold.current !== null) window.clearTimeout(hold.current); hold.current = null; };
  const show = () => {
    const rect = host.current?.getBoundingClientRect();
    if (!rect) return;
    const halfWidth = Math.min(290, innerWidth - 32) / 2;
    setAnchor({ left: Math.min(innerWidth - 16 - halfWidth, Math.max(16 + halfWidth, rect.left + rect.width / 2)),
      top: rect.bottom + 8, above: rect.bottom + 150 > innerHeight });
  };
  useEffect(() => setAnchor(null), [explanation]);
  useEffect(() => {
    if (!anchor) return;
    const close = () => setAnchor(null);
    const outside = (event: PointerEvent) => { if (!host.current?.contains(event.target as Node)) close(); };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [anchor]);
  return <span ref={host} className={cx(styles.bidExplanationHost, className)} data-open={!!anchor || undefined} data-explanation={explanation} tabIndex={focusable ? 0 : undefined}
    onPointerEnter={event => { if (event.pointerType === 'mouse') show(); }} onPointerLeave={event => { cancelHold(); if (event.pointerType === 'mouse') setAnchor(null); }}
    onFocus={show} onBlur={() => setAnchor(null)}
    onPointerDown={event => { if (event.pointerType !== 'touch') return; cancelHold(); consumed.current = false; hold.current = window.setTimeout(() => { consumed.current = true; show(); }, 550); }}
    onPointerUp={cancelHold} onPointerCancel={cancelHold}
    onClickCapture={event => { if (consumed.current) { event.preventDefault(); event.stopPropagation(); consumed.current = false; } }}
    onContextMenu={event => { event.preventDefault(); show(); }}>
    {children}{anchor && createPortal(<span className={styles.bidExplanation} role="tooltip" data-above={anchor.above || undefined} style={{ left: anchor.left, top: anchor.above ? host.current!.getBoundingClientRect().top - 8 : anchor.top }}>{explanation}<small>电脑悬停 · 手机长按 · {TOOLTIP_RELEASE}</small></span>, document.body)}
  </span>;
}

function CardView({ card, seat, disabled = true, onClick, suggested = false, table = false, unplayable = false }: {
  card: Card; seat: Seat; disabled?: boolean; onClick?: () => void; suggested?: boolean; table?: boolean; unplayable?: boolean;
}) {
  const body = <><span className={styles.cardCorner}><b>{rankLabel(card.rank)}</b></span><span className={styles.cardPip}><SuitGlyph suit={card.suit} /></span><span className={styles.cardBottom}>{rankLabel(card.rank)}</span></>;
  const className = cx(styles.card, (card.suit === 'H' || card.suit === 'D') && styles.red, suggested && styles.suggested, table && styles.tableCard, unplayable && styles.unplayable);
  return table ? <div className={className} aria-label={cardLabel(card)}>{body}</div> : <button type="button" className={className} disabled={disabled} onClick={onClick} aria-label={`${seatName[seat]} ${cardLabel(card)}`} data-card={card.id} data-seat={seat} data-recommended={suggested}>{body}</button>;
}

function Hand({ game, seat, dummy = false, hint }: { game: GameState; seat: Seat; dummy?: boolean; hint: string | null }) {
  const store = useGame();
  const human = game.phase === 'play' && game.turn === seat && controllerFor(game) === 'S' && !store.paused;
  const legal = human ? legalCards(game.hands[seat], game.currentTrick).map(c => c.id) : [];
  return <section className={cx(styles.tableHand, human && styles.activeTableHand)} aria-label={dummy && seat !== 'S' ? '明手' : '我的手牌'} data-testid={`table-hand-${seat}`}>
    <div className={styles.suitRows}>
      {[...SUITS].reverse().map(suit => {
        const cards = game.hands[seat].filter(c => c.suit === suit);
        return <div className={styles.suitRow} key={suit}><span className={styles.suitMarker}><SuitGlyph suit={suit} /></span><div className={styles.suitCards}>{cards.length ? cards.map(card => <CardView key={card.id} card={card} seat={seat} disabled={!legal.includes(card.id)} unplayable={human && !legal.includes(card.id)} onClick={() => store.play(card.id)} suggested={hint === card.id} />) : <span className={styles.void}>—</span>}</div></div>;
      })}
    </div>
    <div className={styles.tableHandMeta}><span>{game.hands[seat].length} 张牌{seat === 'S' && ` · ${evaluateHand(game.initialHands.S).hcp} HCP`}</span>{human && <span>{game.currentTrick.length ? <>跟牌 <SuitGlyph suit={game.currentTrick[0].card.suit} /> · 点击亮起的牌</> : '首引 · 点击一张牌'}</span>}</div>
  </section>;
}

function ClaimHands({ game, claimant, all = false }: { game: GameState; claimant: Seat; all?: boolean }) {
  const visible = all
    ? [...SEATS]
    : [...new Set<Seat>([claimant, ...(game.dummyRevealed && game.contract ? [game.contract.dummy] : [])])];
  return <section className={styles.claimReveal} aria-label={all ? '声称时四家余牌' : '声称摊牌'}>
    <div className={styles.claimRevealHeading}><strong>{all ? '声称时四家余牌' : '声称方公开余牌'}</strong><span>{all ? '结算后公开，供核对 DDS 裁定' : '先看摊牌，再决定是否接受'}</span></div>
    <div className={cx(styles.claimHands, all && styles.claimHandsAll)}>{visible.map(seat => <article key={seat} className={cx(styles.claimHand, seat === claimant && styles.claimantHand)} data-testid={`claim-hand-${seat}`}>
      <div><strong>{seatName[seat]}家</strong><span>{seat === claimant ? '声称方' : seat === game.contract?.dummy ? '明手' : '余牌'} · {game.hands[seat].length} 张</span></div>
      {[...SUITS].reverse().map(suit => <p key={suit}><SuitGlyph suit={suit} /><span>{game.hands[seat].filter(card => card.suit === suit).sort((a, b) => b.rank - a.rank).map(card => rankLabel(card.rank)).join(' ') || '—'}</span></p>)}
    </article>)}</div>
    {!!game.currentTrick.length && <small>当前未完成墩已有 {game.currentTrick.length} 张牌，已出的牌不再列入余牌。</small>}
  </section>;
}

function InlinePlays({ plays }: { plays: { seat: Seat; card: Card }[] }) {
  return <>{plays.map((play, index) => <span className="inline-play" key={play.seat}>{index > 0 && ' · '}{seatName[play.seat]} <CardLabel card={play.card} /></span>)}</>;
}

function Station({ game, seat, hint }: { game: GameState; seat: Seat; hint: string | null }) {
  const isDummy = game.dummyRevealed && game.contract?.dummy === seat;
  const active = !isFinished(game) && game.turn === seat;
  const vulnerable = isVulnerable(game.vulnerability, seat);
  const visibleHand = seat === 'S' || isDummy;
  return <div className={cx(styles.station, styles[`station${seat}`], visibleHand && styles.stationWithHand, active && styles.activeStation)} data-testid={`table-seat-${seat}`}>
    <div className={styles.stationName}><span className={cx(styles.seatDisc, vulnerable && styles.vulnerable)}>{seat}</span><div><strong>{seatName[seat]}家</strong><small>{seat === 'S' ? (isDummy ? '你的明手' : '你') : isDummy ? `${seatName[game.contract!.declarer]}家控制明手` : '机器人'}</small></div>{active && <span className={styles.stationTurn}>{game.phase === 'auction' ? '叫牌中' : '出牌中'}</span>}</div>
    {visibleHand && <Hand game={game} seat={seat} dummy={isDummy} hint={hint} />}
    {seat !== 'S' && !isDummy && <div className={styles.cardBacks} aria-label={`${seatName[seat]}家 ${game.hands[seat].length} 张隐藏手牌`}>{Array.from({ length: Math.min(5, game.hands[seat].length) }, (_, index) => <i key={index} />)}</div>}
    {!visibleHand && <small className={styles.hiddenCount}>剩余 {game.hands[seat].length} 张</small>}
  </div>;
}

function Table({ game, hint }: { game: GameState; hint: string | null }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const lastTrick = game.completedTricks.at(-1);
  const showLast = !game.currentTrick.length && !!lastTrick;
  const plays = showLast ? lastTrick.plays : game.currentTrick;
  return <section className={cx(styles.table, game.phase === 'auction' && styles.auctionTable)} aria-label="四方桥牌桌" data-testid="bridge-table">
    <div className={styles.tableGrain} />
    {game.contract && <span className={styles.trickNumber}>{showLast ? `上墩 · ${seatName[lastTrick.winner]}家赢得` : `第 ${game.completedTricks.length + 1} / 13 墩`}</span>}
    {SEATS.map(seat => <Station key={seat} game={game} seat={seat} hint={hint} />)}
    <div className={cx(styles.tableCenter, game.phase === 'auction' && styles.tableAuctionCenter)}>
      {game.phase === 'auction' ? <div className={styles.tableAuctionBoard} data-testid="table-auction-board"><section className={styles.tableAuctionHistory}><h2>叫牌进程</h2><AuctionHistory game={game} /></section><BiddingBox game={game} hint={hint} /></div> : <>
        <div className={cx(styles.trickCards, showLast && styles.previousTrick)}>{plays.map(play => <div className={styles[`played${play.seat}`]} key={play.seat}><span>{seatName[play.seat]}</span><CardView table card={play.card} seat={play.seat} /></div>)}</div>
        {!plays.length && <p className={styles.leadNotice}>{game.contract ? `${seatName[game.turn]}家首攻` : '本副流局'}</p>}
      </>}
    </div>
    {game.phase !== 'auction' && <div className={styles.tableAuctionAccess} onMouseEnter={() => setHistoryOpen(true)} onMouseLeave={() => setHistoryOpen(false)} onFocus={() => setHistoryOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHistoryOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setHistoryOpen(false); event.stopPropagation(); } }}>
      <button type="button" className={styles.tableHistoryButton} aria-expanded={historyOpen} aria-controls="table-auction-history" onClick={() => setHistoryOpen(true)}>叫牌进程</button>
      <strong className={styles.tableContract} aria-label="定约与庄家">{game.contract ? <><ContractDisplay contract={game.contract} /> {game.contract.declarer}</> : 'ALL PASS'}</strong>
      <section id="table-auction-history" className={styles.tableHistoryPopover} aria-label="叫牌进程浮层" hidden={!historyOpen}><div className={styles.panelTitle}><h2>叫牌进程</h2><button type="button" aria-label="关闭叫牌进程" onClick={() => setHistoryOpen(false)}>×</button></div><AuctionHistory game={game} /></section>
    </div>}
    {game.contract && <div className={styles.tableScore} aria-label="已得墩数"><span>南北 <b>{game.tricksWon.NS}</b></span><span className={styles.scoreDivider}>:</span><span><b>{game.tricksWon.EW}</b> 东西</span></div>}
  </section>;
}

function AuctionHistory({ game }: { game: GameState }) {
  const system = useGame(state => state.gameSystem);
  const offset = SEATS.indexOf(game.dealer);
  const cells = [...Array.from({ length: offset }, () => null), ...game.auction];
  return <div className={styles.history} aria-label="叫牌历史">
    <div className={styles.historyGrid}>{SEATS.map(s => <strong key={s} className={isVulnerable(game.vulnerability, s) ? styles.vulHeading : ''}>{seatName[s]}{game.dealer === s && <small> D</small>}</strong>)}</div>
    <div className={cx(styles.historyGrid, styles.historyBody)}>{cells.length ? cells.map((entry, index) => {
      const auctionIndex = index - offset;
      const before = auctionIndex >= 0 ? game.auction.slice(0, auctionIndex) : [];
      const notices = entry ? biddingNotices(before, entry.seat, entry.call, system) : [];
      return entry ? <ExplainedCall key={index} focusable explanation={describeCall(before, entry.seat, entry.call, system)} className={cx(styles.historyCallCell, entry.call.kind === 'pass' && styles.passCall)}><span aria-label={`${seatName[entry.seat]} ${callLabel(entry.call)}`}><CallDisplay call={entry.call} /><CallNoticeCards notices={notices} compact /></span></ExplainedCall> : <span key={index}>·</span>;
    }) : <p>尚未叫牌</p>}</div>
  </div>;
}

function BiddingBox({ game, hint }: { game: GameState; hint: string | null }) {
  const store = useGame();
  const enabled = game.phase === 'auction' && game.turn === 'S' && !store.paused;
  const legal = enabled ? legalCalls(game.auction, 'S') : [];
  const available = (call: Call) => legal.some(c => sameCall(call, c));
  return <section className={styles.biddingBox} aria-label="叫牌框">
    <div className={styles.panelTitle}><h2>选择叫品</h2><button className={styles.textButton} onClick={() => window.dispatchEvent(new Event('bridgelab-open-system-card'))}>{SYSTEMS[store.gameSystem].short} · 体系卡</button><span>{enabled ? '轮到你' : game.phase === 'auction' ? '等待机器人' : '叫牌已结束'}</span></div>
    <div className={styles.bidGrid}>
      {Array.from({ length: 7 }, (_, i) => i + 1).flatMap(level => STRAINS.map(strain => {
        const call: Call = { kind: 'bid', level, strain };
        const enabledCall = available(call);
        const notices = enabledCall ? biddingNotices(game.auction, 'S', call, store.gameSystem) : [];
        return <ExplainedCall key={`${level}${strain}`} explanation={describeCall(game.auction, 'S', call, store.gameSystem)}><button aria-label={`叫 ${level}${strain}`} title={describeCall(game.auction, 'S', call, store.gameSystem)} disabled={!enabledCall} onClick={() => store.call(call)} data-stop={notices.length ? true : undefined} data-recommended={hint === callLabel(call)} className={cx(styles.bidButton, hint === callLabel(call) && styles.bidHint)}><span className={styles.bidValue}>{level}<SuitGlyph suit={strain} /></span><CallNoticeCards notices={notices} compact /></button></ExplainedCall>;
      }))}
    </div>
    <div className={styles.specialCalls}><button type="button" className={styles.alertControl} aria-label="ALERT（暂未启用）" title="约定叫识别完善后启用" disabled>ALERT<small>暂未启用</small></button>{([{ kind: 'pass' }, { kind: 'double' }, { kind: 'redouble' }] as Call[]).map(call => {
      const enabledCall = available(call);
      return <ExplainedCall key={call.kind} explanation={describeCall(game.auction, 'S', call, store.gameSystem)}><button aria-label={call.kind === 'pass' ? '不叫 Pass' : call.kind === 'double' ? '加倍 X' : '再加倍 XX'} disabled={!enabledCall} onClick={() => store.call(call)} data-recommended={hint === callLabel(call)} className={cx(call.kind === 'pass' && styles.passButton, hint === callLabel(call) && styles.bidHint)}>{callLabel(call)}<small>{call.kind === 'pass' ? '不叫' : call.kind === 'double' ? '加倍' : '再加倍'}</small></button></ExplainedCall>;
    })}</div>
  </section>;
}

function ResultPanel({ game }: { game: GameState }) {
  const store = useGame(); const [review, setReview] = useState(false);
  const match = store.activeMatch;
  const board = match?.boards.find(item => item.number === game.board);
  const comparing = match?.mode === 'imp';
  const ready = !comparing || board?.referenceScoreNS !== null && board?.referenceScoreNS !== undefined;
  const lastBoard = comparing && match.currentBoard === match.boardCount;
  if (!game.result) return null;
  const { scoreNS, declarerTricks, breakdown } = game.result;
  const difference = game.contract ? declarerTricks - game.contract.level - 6 : 0;
  return <section className={styles.result} aria-label="本副结果" data-testid="result">
    <div className={styles.resultTop}><div><span className={styles.eyebrow}>第 {game.board} 副 · {game.claim ? 'DDS 声称结算' : '已完成'}</span><h2>{game.phase === 'passedOut' ? '四家不叫，流局' : <><ContractDisplay contract={game.contract} /> {difference === 0 ? '成约' : difference > 0 ? `超 ${difference} 墩` : `宕 ${-difference} 墩`}</>}</h2><p>{game.contract ? game.claim ? `${seatName[game.claim.seat]}家声称本方再得 ${game.claim.tricks} 墩 · 最终庄家 ${declarerTricks} 墩 · ${vulnerabilityName[game.vulnerability]}` : `${seatName[game.contract.declarer]}家坐庄 · 实得 ${declarerTricks} 墩 · ${vulnerabilityName[game.vulnerability]}` : '本副记 0 分，可以继续下一副。'}</p></div><div className={styles.resultScore}><small>南北原始得分</small><strong data-testid="board-score" className={scoreNS < 0 ? styles.negative : ''}>{signed(scoreNS)}</strong></div></div>
    {game.contract && <div className={styles.breakdown}>{([['定约墩分', breakdown.contractPoints], ['超墩', breakdown.overtrickPoints], ['成局 / 部分定约', breakdown.gameBonus], ['满贯奖励', breakdown.slamBonus], ['加倍奖励', breakdown.insultBonus], ['宕墩罚分', -breakdown.penalty]] as [string, number][]).filter(([, value]) => value !== 0).map(([label, value]) => <span key={label}>{label}<b>{signed(value)}</b></span>)}<small>以上明细从庄家方视角计分。</small></div>}
    {comparing && (ready && board?.reference ? <section className={styles.matchComparison} aria-label="双桌比较"><div><small>主桌 · 南北原始分</small><strong>{signed(scoreNS)}</strong></div><div><small>参考桌 · 南北原始分</small><strong>{signed(board.referenceScoreNS ?? 0)}</strong><span>{replay(board.reference).contract ? <><ContractDisplay contract={replay(board.reference).contract} /> · {seatName[replay(board.reference).contract!.declarer]}家庄 · {replay(board.reference).result?.declarerTricks} 墩{replay(board.reference).claim && ' · 声称'}</> : '四家 Pass · 流局'}</span></div><div><small>分差 {signed(board.difference ?? 0)}</small><strong>{signed(board.imps ?? 0)} IMP</strong></div></section> : <p className={styles.referenceStatus} role="status">{store.referenceError || (store.referenceThinking ? '参考桌正在独立完成本副牌，结算后开放双桌比较与复盘…' : '等待参考桌完成本副牌。留在牌桌可继续结算。')}</p>)}
    <div className={styles.resultActions}>{ready && (lastBoard ? <a className={styles.primaryButton} href={`#/history/${encodeURIComponent(match.id)}`}>本场比赛结果 <span>→</span></a> : <button className={styles.primaryButton} onClick={() => store.nextBoard()}>下一副牌 <span>→</span></button>)}<button disabled={!ready} className={styles.secondaryButton} onClick={() => openAnalysis(game, '#/table')}>{game.phase === 'passedOut' ? '双明手分析 →' : '主桌逐墩分析 →'}</button>{comparing && ready && board?.reference && <button className={styles.secondaryButton} onClick={() => openAnalysis(replay(board.reference!), '#/table')}>参考桌复盘 →</button>}<button disabled={!ready} className={styles.secondaryButton} onClick={() => setReview(!review)}>{review ? '收起四家手牌' : '复盘四家手牌'}</button></div>
    {ready && game.claim && <><p className={styles.claimNote}>声称由本地 DDS 使用当前完整四家牌裁定。逐墩分析保留所有实际出牌，并在声称位置截断；未打出的牌不会被伪造成出牌记录。</p><ClaimHands game={game} claimant={game.claim.seat} all /></>}
    {ready && review && <div className={styles.reviewHands}>{SEATS.map(seat => <div key={seat}><strong>{seatName[seat]}家 · 原始手牌</strong>{[...SUITS].reverse().map(suit => <p key={suit}><b><SuitGlyph suit={suit} /></b> {game.initialHands[seat].filter(c => c.suit === suit).map(c => rankLabel(c.rank)).join(' ') || '—'}</p>)}</div>)}</div>}
  </section>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  return <div className={styles.modalBackdrop} onClick={onClose}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><div className={styles.modalTitle}><h2>{title}</h2><button className={styles.iconButton} aria-label="关闭" onClick={onClose}>×</button></div>{children}</section></div>;
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function App() {
  const store = useGame(); const game = store.game;
  const route = () => location.hash.startsWith('#/analysis') ? 'analysis' : location.hash.startsWith('#/deals') ? 'deals' : location.hash.startsWith('#/table') ? 'table' : location.hash.startsWith('#/history') ? 'history' : location.hash.startsWith('#/setup') ? 'setup' : 'home';
  const [page, setPage] = useState<'home' | 'setup' | 'history' | 'table' | 'analysis' | 'deals'>(route);
  const [routeHash, setRouteHash] = useState(location.hash);
  useEffect(() => { if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '/home'; const change = () => { setPage(route()); setRouteHash(location.hash); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const [modal, setModal] = useState<'restart' | 'settings' | 'scores' | 'help' | 'systems' | 'claim' | null>(null);
  useEffect(() => { const open = () => setModal('systems'); window.addEventListener('bridgelab-open-system-card', open); return () => window.removeEventListener('bridgelab-open-system-card', open); }, []);
  const [hint, setHint] = useState<string | null>(null);
  const [claimTricks, setClaimTricks] = useState(0); const [claimBusy, setClaimBusy] = useState(false); const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false); const [hintDetail, setHintDetail] = useState<string | null>(null);
  const hintSequence = useRef(0);
  const [offlineReady, setOfflineReady] = useState(false); const [online, setOnline] = useState(navigator.onLine);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const updater = registerSW({ immediate: true, onOfflineReady: () => setOfflineReady(true), onNeedRefresh: () => { setUpdate(() => () => updater(true)); void updater(true); }, onRegisterError: () => setOfflineReady(false) });
    navigator.serviceWorker?.ready.then(() => {
      if (navigator.serviceWorker.controller) setOfflineReady(true);
    });
    const status = () => setOnline(navigator.onLine);
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener('online', status); window.addEventListener('offline', status); window.addEventListener('beforeinstallprompt', prompt);
    return () => { window.removeEventListener('online', status); window.removeEventListener('offline', status); window.removeEventListener('beforeinstallprompt', prompt); };
  }, []);
  useEffect(() => {
    if (page !== 'table' || !game || isFinished(game) || controllerFor(game) === 'S' || store.paused || store.thinking) return;
    const betweenTricks = game.phase === 'play' && game.currentTrick.length === 0 && game.completedTricks.length > 0;
    const timer = window.setTimeout(store.stepAI, store.delay === 0 ? 0 : betweenTricks ? store.delay + 500 : store.delay);
    return () => window.clearTimeout(timer);
  }, [game, store.delay, store.paused, store.thinking, store.stepAI, page]);
  useEffect(() => { hintSequence.current++; setHint(null); setHintBusy(false); setHintDetail(null); }, [game?.actions.length, game?.seed]);
  useEffect(() => { store.setPaused(page !== 'table' || !!modal || !!store.pendingRobotClaim); }, [page, modal, store.pendingRobotClaim, store.setPaused]);
  const match = store.activeMatch;
  const normalImp = match?.mode === 'imp' && !match.assisted;
  const ourImps = match?.boards.reduce((total, board) => total + Math.max(0, board.imps ?? 0), 0) ?? 0;
  const theirImps = match?.boards.reduce((total, board) => total + Math.max(0, -(board.imps ?? 0)), 0) ?? 0;
  const settledImp = match?.mode === 'imp' && match.boards[match.currentBoard - 1]?.referenceScoreNS !== null;
  const humanTurn = game && !isFinished(game) && controllerFor(game) === 'S';
  const showHint = async () => {
    if (!game || !humanTurn) return;
    const obs = observe(game);
    if (obs.phase === 'auction') {
      const label = callLabel(chooseBid(obs, store.gameSystem)); setHint(label);
      setHintDetail(`建议 ${label}（${SYSTEMS[store.gameSystem].name}，依据公开拍卖语义）`); return;
    }
    const requestId = ++hintSequence.current; setHintBusy(true); setHint(null); setHintDetail(null);
    try {
      const decision = await playAdvisor.advise({ observation: obs, system: store.gameSystem, strength: store.playStrength });
      if (requestId !== hintSequence.current) return;
      setHint(decision.cardId);
      const selected = obs.legalCards.find(card => card.id === decision.cardId);
      setHintDetail(selected ? `建议出 ${cardLabel(selected)}（${decision.engine === 'sampled-dds' ? `${decision.sampleCount} 个公开信息样本，本地 DDS` : '确定性安全层'}；${decision.reasonTags.join('，')}）` : null);
    } catch (error) {
      if (requestId !== hintSequence.current) return;
      const cardId = chooseCard(obs, store.gameSystem); const selected = obs.legalCards.find(card => card.id === cardId);
      setHint(cardId); setHintDetail(selected ? `建议出 ${cardLabel(selected)}（DDS 暂不可用，已使用安全打法）` : null);
    } finally { if (requestId === hintSequence.current) setHintBusy(false); }
  };
  const hintCard = game?.hands[game.turn].find(card => card.id === hint);
  const hintText = hintBusy ? '正在根据公开信息生成隐藏手牌样本，并调用本地 DDS…' : hintDetail ?? (hintCard ? `建议出 ${cardLabel(hintCard)}` : '');
  const statusText = !game ? '准备好开始一副牌' : isFinished(game) ? '本副已结束' : store.paused ? '游戏已暂停' : store.thinking && game.phase === 'play' ? `${seatName[controllerFor(game)]}家机器人正在分析公开信息` : game.phase === 'auction' ? game.turn === 'S' ? '轮到你叫牌' : `${seatName[game.turn]}家机器人正在叫牌` : humanTurn ? game.turn === 'S' ? '轮到你出牌' : `请为${seatName[game.turn]}家明手出牌` : `${seatName[controllerFor(game)]}家机器人${game.turn === game.contract?.dummy ? '控制明手' : ''}出牌中`;
  const ledger = [...store.history, ...(game && isFinished(game) ? [game] : [])];

  return <div className={styles.app} data-testid="app" data-phase={game?.phase ?? 'idle'} data-turn={game?.turn ?? ''} data-controller={game && !isFinished(game) ? controllerFor(game) : ''} data-actions={game?.actions.length ?? 0}>
    <header className={styles.header}><a href="#/home" className={styles.brand}><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /><div><strong>Bridge<span>Lab</span></strong><small>单机桥牌 <span>v0.3.6</span></small></div></a><nav className="main-navigation" aria-label="主导航"><a href="#/home" aria-current={page === 'home' ? 'page' : undefined}>首页</a>{game && <a href="#/table" aria-current={page === 'table' ? 'page' : undefined}>牌桌</a>}<a href="#/history" aria-current={page === 'history' ? 'page' : undefined}>历史牌局</a><a href="#/deals" aria-current={page === 'deals' ? 'page' : undefined}>牌例</a><a href="#/analysis" aria-current={page === 'analysis' ? 'page' : undefined}>分析室</a></nav><div className={styles.headerRight}>{page === 'table' && <div className={styles.totalScore}><small>{match?.mode === 'imp' ? '南北累计 IMP' : '南北累计原始分'}</small><b data-testid="cumulative-score">{signed(match?.mode === 'imp' ? match.totalImps : match?.totalScore ?? cumulativeScore(store))}</b></div>}<a className={styles.secondaryButton} href="#/setup">新牌局</a><button className={styles.iconButton} aria-label="设置" title="设置" onClick={() => setModal('settings')}>⚙</button></div></header>
    <main className={styles.main}>
      {page === 'home' ? <HomePage onSettings={() => setModal('settings')} /> : page === 'setup' ? <SetupPage /> : page === 'history' ? <HistoryPage matchId={decodeRouteId(routeHash.split('/').slice(2).join('/')) || undefined} /> : page === 'analysis' ? <AnalysisPage /> : page === 'deals' ? <DealEditorPage onStart={async deal => { await store.startCustom(deal); location.hash = '/table'; }} /> : <>{!game ? <section className={styles.welcome}>
        <div className={styles.welcomeCopy}><span className={styles.eyebrow}>YOUR SEAT IS SOUTH</span><h1>入座。<br />开始一副好牌。</h1><p>与北家搭档，对阵东西两位机器人。<br />从叫牌到最后一墩，在这里专注打桥牌。</p><button className={styles.primaryButton} aria-label="开始游戏" onClick={async () => { await store.start(); }}>开始游戏 <span>→</span></button><a className={styles.workbenchLink} href="#/deals">或打开牌例工作台，自定义四家手牌 →</a><div className={styles.welcomeFeatures}><span>♠ 完整 52 张牌</span><span>↺ 自动保存与悔牌</span><span>◇ 缓存后离线可玩</span></div></div>
        <div className={styles.welcomeArt} aria-hidden="true"><div className={styles.miniTable}><span className={styles.miniN}>N</span><span className={styles.miniE}>E</span><span className={styles.miniW}>W</span><span className={styles.miniS}>S · YOU</span><div className={styles.welcomeCards}>{(['S', 'H', 'D', 'C'] as const).map((suit, index) => <div key={suit} style={{ transform: `rotate(${(index - 1.5) * 12}deg) translateY(${Math.abs(index - 1.5) * 8}px)` }}><CardView table seat="S" card={{ id: `${suit}14`, rank: 14, suit }} /></div>)}</div><small>BRIDGELAB</small></div></div>
      </section> : <>
        {match && <section className={styles.matchBar} aria-label="比赛进度"><div><strong>{match.mode === 'imp' ? '双桌 IMP' : '累计总分'}</strong><span>{match.assisted ? '辅助练习' : '正常比赛'}</span><span>第 {match.currentBoard}{match.mode === 'imp' ? ` / ${match.boardCount}` : ''} 副 · 已结算 {match.completedBoards} 副</span></div><div><strong aria-label={match.mode === 'imp' ? '双方 IMP 比分' : undefined}>{match.mode === 'imp' ? `我方 ${ourImps} : ${theirImps} 对方 · 净 ${signed(match.totalImps)} IMP` : `${signed(match.totalScore)} 分`}</strong><button className={styles.textButton} onClick={async () => { const id = match.id; try { await store.finishMatch(); location.hash = `/history/${encodeURIComponent(id)}`; } catch { /* Store preserves the match and displays the error. */ } }}>{match.status === 'completed' ? '查看本场结果 →' : '结束并归档'}</button></div>{normalImp && <small>正常 IMP 比赛 · 提示、悔牌与重打已关闭</small>}</section>}
        <div className={styles.boardBar}><div><span className={styles.boardBadge}>第 {game.board} 副</span><span>{seatName[game.dealer]}家发牌</span><span className={game.vulnerability !== 'None' ? styles.vulText : ''}>{vulnerabilityName[game.vulnerability]}</span></div><div className={styles.boardControls}><button disabled={normalImp || settledImp || !store.undo.length || store.thinking} className={styles.textButton} onClick={store.undoDecision}>↶ 悔牌</button><button disabled={normalImp || !humanTurn || hintBusy} className={styles.textButton} onClick={showHint}>{hintBusy ? '◇ 分析中' : '◇ 提示'}</button><button disabled={!humanTurn || game.phase !== 'play' || store.thinking} className={styles.textButton} onClick={() => { setClaimTricks(13 - game.completedTricks.length); setClaimMessage(null); setModal('claim'); }}>摊牌声称</button><button disabled={normalImp || settledImp} className={styles.textButton} aria-label="重打本副" onClick={() => setModal('restart')}>↻ 重打</button></div></div>
        <div className={styles.gameGrid}><div className={styles.playArea}>
          <div className={styles.statusBar} role="status" aria-live="polite"><span className={cx(styles.statusDot, humanTurn && styles.humanDot)} /><strong>{statusText}</strong><span className={styles.contractTag}>{game.contract ? <><ContractDisplay contract={game.contract} /> · {seatName[game.contract.declarer]}家庄</> : '定约待定'}</span>{game.phase === 'play' && <div className={styles.compactTrick}><span>{game.currentTrick.length ? <InlinePlays plays={game.currentTrick} /> : `${seatName[game.turn]}家首引`}</span><span>南北 {game.tricksWon.NS} : {game.tricksWon.EW} 东西</span></div>}</div>
          <Table game={game} hint={hint} />
          {isFinished(game) && <ResultPanel key={`${game.board}:${game.seed}`} game={game} />}
          {hintText && <p className={styles.hintText}>{hintText}</p>}
        </div><aside className={styles.sidebar}>
          <section className={styles.infoPanel}><div><span>当前定约</span><strong><ContractDisplay contract={game.contract} /></strong></div><div><span>庄家 / 明手</span><strong>{game.contract ? `${seatName[game.contract.declarer]} / ${seatName[game.contract.dummy]}` : '—'}</strong></div><div><span>目标赢墩</span><strong>{game.contract ? `${game.contract.level + 6} 墩` : '—'}</strong></div><button className={styles.textButton} onClick={() => setModal('scores')}>查看记分卡 →</button></section>
          {game.completedTricks.length > 0 && <details className={styles.trickHistory}><summary>已完成 {game.completedTricks.length} 墩 · 查看记录</summary>{game.completedTricks.map((trick, index) => <div key={index}><b>{index + 1}</b><span><InlinePlays plays={trick.plays} /></span><strong>{seatName[trick.winner]}赢</strong></div>)}</details>}
        </aside></div>
      </>}
      {store.notice && <div className={styles.notice} role="alert"><span>{store.notice}</span><button aria-label="关闭提示" className={styles.iconButton} onClick={store.clearNotice}>×</button></div>}</>}
    </main>
    <footer className={styles.footer}><span className={cx(styles.offlineState, offlineReady && styles.ready)}>{offlineReady ? online ? '● 离线资源已缓存' : '● 离线模式' : '○ 首次加载后缓存离线资源'}</span><div>{update && <button onClick={() => update()}>更新可用 · 保存并刷新</button>}{install && <button onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>安装应用</button>}<button onClick={() => setModal('help')}>使用说明</button><span>纯本地 AI · 累计原始分 / 双桌 IMP</span></div></footer>

    {modal === 'restart' && <Modal title="重打本副" onClose={() => setModal(null)}><p>保留本副种子，恢复原始发牌和叫牌。之前各副的累计得分保留。</p><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={() => setModal(null)}>取消</button><button className={styles.primaryButton} onClick={() => { store.restart(); setModal(null); }}>确认重打</button></div></Modal>}
    {modal === 'claim' && game?.phase === 'play' && <Modal title="摊牌声称" onClose={() => { if (!claimBusy) setModal(null); }}><p>选择南北方从当前未完成墩开始声称取得的墩数。提交时南家余牌按摊牌处理；本地 DDS 将查看完整四家牌并按最佳攻防裁定。超过可保证墩数时，牌局保持不变。</p><ClaimHands game={game} claimant="S" /><label className={styles.fieldLabel}>南北方声称再得墩数<select aria-label="南北方声称再得墩数" value={claimTricks} disabled={claimBusy} onChange={event => { setClaimTricks(Number(event.target.value)); setClaimMessage(null); }}>{Array.from({ length: 14 - game.completedTricks.length }, (_, index) => 13 - game.completedTricks.length - index).map(value => <option value={value} key={value}>{value} 墩</option>)}</select></label><div className={styles.seedInfo}><span>当前已完成 {game.completedTricks.length} 墩，尚余 {13 - game.completedTricks.length} 墩{game.currentTrick.length ? `；当前一墩已有 ${game.currentTrick.length} 张牌` : ''}。</span><span>声称裁定与实战机器人的公开信息采样隔离，不会把真实隐藏牌传给后续打牌策略。</span></div>{claimMessage && <p className={styles.claimError} role="alert">{claimMessage}</p>}<div className={styles.modalActions}><button className={styles.secondaryButton} disabled={claimBusy} onClick={() => setModal(null)}>继续打牌</button><button className={styles.primaryButton} disabled={claimBusy} onClick={async () => { setClaimBusy(true); setClaimMessage(null); const result = await store.claim(claimTricks); setClaimBusy(false); if (result.accepted) setModal(null); else setClaimMessage(result.message); }}>{claimBusy ? 'DDS 裁定中…' : '提交声称'}</button></div></Modal>}
    {modal === 'settings' && <Modal title="游戏设置" onClose={() => setModal(null)}><label className={styles.fieldLabel}>叫牌体系<select aria-label="叫牌体系" disabled={!!match} value={store.biddingSystem} onChange={event => store.setBiddingSystem(event.target.value as BiddingSystem)}><option value="sayc">SAYC＋2/1进局逼叫＋RKCB 1430（默认）</option><option value="two-over-one">2/1 进局逼叫</option><option value="precision">精确制（暂缓完善）</option></select></label><p>{match ? `本场使用${SYSTEMS[store.gameSystem].name}。本场体系和强度已固定；下场可在开始页面设置。` : game ? `本副使用${SYSTEMS[store.gameSystem].name}。体系选择在新牌局、下一副或重打时生效。` : '新牌局使用所选体系。四位牌手使用同一套约定。'}</p><button className={styles.secondaryButton} onClick={() => setModal('systems')}>查看完整体系卡与支持范围</button><label className={styles.fieldLabel}>打牌强度<select aria-label="打牌强度" disabled={!!match} value={store.playStrength} onChange={event => store.setPlayStrength(event.target.value as PlayStrength)}><option value="challenge">挑战 · 24 个公开信息样本＋DDS</option><option value="standard">标准 · 8 个公开信息样本＋DDS</option><option value="basic">基础 · 确定性安全打法</option></select></label><p>标准和挑战档只根据叫牌、明手与已打牌生成未知手牌样本，不读取真实隐藏牌。挑战档是默认设置。</p><label className={styles.fieldLabel}>机器人行动速度<select aria-label="机器人行动速度" value={store.delay} onChange={event => store.setDelay(Number(event.target.value))}><option value={1100}>从容 · 1.1 秒</option><option value={650}>标准 · 0.65 秒</option><option value={250}>快速 · 0.25 秒</option><option value={0}>即时 · 无等待</option></select></label><p>南家始终由你控制。你坐庄时也操作明手；北家坐庄时，北家机器人操作你的明手。</p>{game && (!match || match.mode !== 'imp' || (match.boards[match.currentBoard - 1].scoreNS !== null && match.boards[match.currentBoard - 1].referenceScoreNS !== null)) && <div className={styles.seedInfo}><span>本副随机种子</span><code>{game.seed}</code></div>}<button className={styles.secondaryButton} onClick={() => { setModal('help'); }}>查看 AI 约定与使用说明</button></Modal>}
    {modal === 'systems' && <Modal title="叫牌体系卡" onClose={() => setModal(null)}><p>约定供玩家与机器人共同使用。悬停叫牌框或叫牌历史中的叫品，可查看公开含义。红色 STOP 只标出开叫之后的跳叫；ALERT 按钮暂未启用。</p><div className="system-cards">{(['sayc', 'two-over-one', 'precision'] as const).map(system => <article key={system}><h3>{SYSTEMS[system].name}</h3><p>{SYSTEMS[system].summary}</p><ul>{SYSTEMS[system].rules.map(rule => <li key={rule}>{rule}</li>)}</ul><p className="system-limit">{SYSTEMS[system].limitations}</p></article>)}</div><h3>共用基础约定</h3><ul className="system-shared">{SHARED_CONVENTIONS.map(rule => <li key={rule}>{rule}</li>)}</ul><p>叫牌使用公开拍卖语义。实战打牌的 DDS 只评估从合法可见信息生成的假设牌局；牌后分析室才使用真实四家牌。</p></Modal>}
    {modal === 'scores' && <Modal title="记分卡" onClose={() => setModal(null)}><p>南北视角的复式原始分累计，未与其他桌比较。</p><div className={styles.ledger}><div><b>局</b><b>定约 / 庄家</b><b>实得</b><b>南北分</b></div>{ledger.length ? ledger.map(g => <div key={`${g.board}:${g.seed}`}><span>{g.board}</span><span>{g.contract ? <><ContractDisplay contract={g.contract} /> / {seatName[g.contract.declarer]} {g.claim && <small>声称</small>}</> : '四家 Pass'} <button className="ledger-analysis" aria-label={`分析第 ${g.board} 副`} onClick={() => { setModal(null); openAnalysis(g); }}>分析 →</button></span><span>{g.contract ? g.result?.declarerTricks : '—'}</span><strong>{signed(g.result?.scoreNS ?? 0)}</strong></div>) : <p>第一副结束后将在这里记录。</p>}</div><p className={styles.ledgerTotal}>累计 <b>{signed(cumulativeScore(store))}</b></p></Modal>}
    {modal === 'help' && <Modal title="关于 BridgeLab" onClose={() => setModal(null)}><div className={styles.helpText}><p>你坐南家，与北家搭档。点击叫品，轮到自己或自己控制的明手时，点击亮起的牌出牌。首攻后明手公开，手中有首引花色时必须跟牌。</p><h3>保存、牌例与悔牌</h3><p>每次动作后自动保存。牌例工作台可逐张分配四家手牌，保存后进入正常叫牌、打牌和分析。悔牌、重打和刷新会保留自定义发牌。</p><h3>叫牌体系</h3><p>默认使用“SAYC＋2/1进局逼叫＋RKCB 1430”：保留SAYC争叫、Michaels扣叫、Unusual 2NT、加倍和阻击；未Pass且无干扰的二盖一为13+进局逼叫，1M–1NT为5–12半逼叫。四位牌手使用同一套约定，换体系从下一副、新牌局或重打时生效。</p><button className={styles.secondaryButton} onClick={() => setModal('systems')}>查看叫牌体系卡</button><h3>实战打牌 AI</h3><p>确定性安全层处理跟牌、最小够大、二家低放、将吃和安全垫牌。标准与挑战档再根据公开叫牌、明手和已打牌生成未知手牌样本，调用本地 DDS 比较所有合法出牌；不会读取真实隐藏牌。</p><h3>摊牌声称</h3><p>轮到南北方行动时可声称余下若干墩，声称窗口会公开声称方余牌和已公开的明手。本地 DDS 作为独立裁定者查看完整四家牌；可保证时直接结算，过高时拒绝且牌局不变。机器人提出声称时也会先摊开自身余牌，由你选择同意或拒绝。逐墩分析保留声称前的全部实际出牌，并在声称位置截断。</p><h3>逐墩双明手分析</h3><p>完整打完、声称结算或四家 Pass 后均可进入分析室。完整牌局逐张回放；声称牌局在声称位置截断；四家 Pass 的牌局先展示双明手总表，并可选择假设定约和庄家继续试打。分支不会修改原局和累计得分。</p><h3>电脑端离线使用</h3><p>在本机 localhost 打开，等待页脚显示“离线资源已缓存”。Chrome / Edge 可安装应用。DDS、Worker 和牌例库均在本机运行，清理站点数据会删除本地牌局与牌例。</p></div></Modal>}
    {page === 'table' && store.pendingRobotClaim && game && <Modal title="机器人提出声称" onClose={store.rejectRobotClaim}><p>{seatName[store.pendingRobotClaim.seat]}家机器人声称其一方从当前未完成墩开始再得 {store.pendingRobotClaim.tricks} 墩，其余 {store.pendingRobotClaim.remainingTricks - store.pendingRobotClaim.tricks} 墩归对方。按桥牌声称流程，机器人先公开自己的全部余牌。</p><ClaimHands game={game} claimant={store.pendingRobotClaim.seat} /><div className={styles.seedInfo}><span>这项建议只根据机器人合法可见信息生成的公开信息样本提出，没有读取真实隐藏牌。</span><span>同意后立即按声称结算；不同意则执行机器人原定出牌并继续牌局。</span></div><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={store.rejectRobotClaim}>不同意，继续打</button><button className={styles.primaryButton} onClick={store.acceptRobotClaim}>同意声称</button></div></Modal>}
  </div>;
}

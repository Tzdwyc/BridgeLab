import { ExplainedCall } from './ExplainedCall';
import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { registerSW } from 'virtual:pwa-register';
import { type Card, type Call, type GameState, type Seat, SEATS, STRAINS, SUITS, isVulnerable } from '../core/types';
import { controllerFor, isFinished, replay } from '../core/game';
import { legalCalls, sameCall } from '../core/auction';
import { legalCards } from '../core/play';
import { observe } from '../ai/observation';
import { evaluateHand, describeCall } from '../ai/bidding';
import { biddingNotices } from '../ai/bidding-notices';
import { CallNoticeCards } from './CallNoticeCards';
import { SYSTEMS } from '../ai/systems';
import { chooseCard } from '../ai/playing';
import { useGame, cumulativeScore } from '../controller/store';
import { visibleTableNotice } from '../controller/user-action-notice';
import { seatName, rankLabel, callLabel, cardLabel, vulnerabilityName, signed } from './format';
import styles from './App.module.css';
import { TableSurface, PlayingCard, CardHand, SeatStation, CurrentTrick } from './TableSurface';
import { AppearanceSettings, useAppearance } from './AppearanceSettings';
import { TrickScore } from './TrickScore';
import { TableReviewControls } from './TableReviewControls';
import { SuitGlyph, CardLabel, CallDisplay, ContractDisplay } from './SuitGlyph';
import { openAnalysis } from '../analysis/navigation';
import AnalysisPage from './AnalysisPage';
import DealEditorPage from '../deal-editor/DealEditorPage';
import { playAdvisor } from '../controller/play-advisor';
import { HomePage, SetupPage, HistoryPage } from './MatchPages';
import SLModelPanel from './SLModelPanel';
import { agreementVersionFor, suggestSystemBid } from '../ai/bid-strategy';
import LanRoomPage from './LanRoomPage';
import { useLanRoom } from '../online/useLanRoom';
import { TransientNotice } from './TransientNotice';
import { ensureSLReady, getSLModelState, subscribeSLModel } from '../ai/neural/browser-model';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
// Translate operational notices at the UI boundary; advisor diagnostics stay internal.
function playerNotice(message: string | null, reasonTags: string[] = []): string | null {
  if (!message) return null;
  if (reasonTags.length && reasonTags.every(tag => message.includes(tag))) return null;
  if (/安全备用动作|已使用安全打法|已切换安全打法|回退|降级|fallback/i.test(message)) return null;
  if (message.startsWith('DDS 接受声称')) return message.replace('DDS 接受声称', '声称成立');
  if (message.startsWith('DDS 无法确认')) return '无法确认所声称的墩数，请减少墩数或继续打牌。';
  if (message.startsWith('声称裁定失败')) return '暂时无法确认声称，请重试或继续打牌。';
  if (/DDS|WASM|Worker|reasonTags|sampleCount|heapBytes|elapsedMs/i.test(message)) return '暂时无法完成操作，请重试。';
  if (message.startsWith('存档失败，当前比赛已保留：')) return '存档失败，当前比赛已保留。请导出备份后重试。';
  return message;
}
const decodeRouteId = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

const CardView = PlayingCard;

function Hand({ game, seat, dummy = false, hint }: { game: GameState; seat: Seat; dummy?: boolean; hint: string | null }) {
  const store = useGame();
  const human = game.phase === 'play' && game.turn === seat && controllerFor(game) === 'S' && !store.paused;
  const legal = human ? legalCards(game.hands[seat], game.currentTrick).map(card => card.id) : [];
  return <CardHand cards={game.hands[seat]} seat={seat} isDummy={dummy} active={human} label={dummy && seat !== 'S' ? '明手' : '我的手牌'}
    legalCardIds={legal} onPlay={id => store.play(id)} suggestedId={hint}
    meta={<><span><span data-card-count>{dummy && seat !== 'S' ? '明手 · ' : ''}{game.hands[seat].length} 张{seat === 'S' ? ' · ' : ''}</span>{seat === 'S' && `${evaluateHand(game.initialHands.S).hcp} HCP`}</span>{human && <span>{game.currentTrick.length ? '跟牌 · 点击亮牌' : '首引 · 点击一张牌'}</span>}</>} />;
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
  const recentCall = game.phase === 'auction' ? [...game.auction].reverse().find(entry => entry.seat === seat)?.call : undefined;
  return <SeatStation seat={seat} label={isDummy ? `${seatName[seat]}·明手` : undefined} active={active} vulnerable={isVulnerable(game.vulnerability, seat)}
    call={recentCall ? <CallDisplay call={recentCall} /> : undefined}
    detail={isDummy ? '' : seat === 'S' ? '你' : '机器人'}>
    {seat === 'S' || isDummy ? <Hand game={game} seat={seat} dummy={isDummy} hint={hint} /> : <CardHand cards={game.hands[seat]} seat={seat} hidden />}
  </SeatStation>;
}

function Table({ game, hint }: { game: GameState; hint: string | null }) {
  const lastTrick = game.completedTricks.at(-1);
  const station = (seat: Seat) => <Station game={game} seat={seat} hint={hint} />;
  return <TableSurface phase={game.phase} north={station('N')} east={station('E')} west={station('W')} south={station('S')}
    summary={<span data-contract-summary={!!game.contract || undefined}>{game.contract ? <><ContractDisplay contract={game.contract} /> · {seatName[game.contract.declarer]}家庄</> : game.phase === 'passedOut' ? '四家不叫 · 流局' : '叫牌阶段'}</span>}
    score={game.contract ? <TrickScore game={game} /> : undefined}
    center={game.phase === 'auction' ? <div className={styles.auctionCenter}><span>BRIDGE CLUB</span><strong>{seatName[game.turn]}家叫牌</strong><p>先选阶数，再选花色</p></div>
      : <CurrentTrick plays={game.currentTrick} label={game.contract ? '' : '本副流局'} empty={game.contract ? `${seatName[game.turn]}家${game.completedTricks.length ? '领出' : '首攻'}` : '流局'} />}
    auctionHistory={game.phase === 'auction' ? <section className={styles.auctionPanel} data-testid="table-auction-board"><h2>叫牌记录</h2><AuctionHistory game={game} /></section> : undefined}
    panel={game.phase === 'auction' ? <BiddingBox game={game} hint={hint} /> : <TableReviewControls resetKey={`${game.board}:${game.seed}`} history={<AuctionHistory game={game} />}
      lastTrick={lastTrick ? <><p>{seatName[lastTrick.winner]}家赢得</p><p><InlinePlays plays={lastTrick.plays} /></p></> : null} />} />;
}

function AuctionHistory({ game }: { game: GameState }) {
  const system = useGame(state => state.gameSystem);
  const body = useRef<HTMLDivElement>(null);
  const followLatest = useRef(true);
  const boardKey = `${game.board}:${game.seed}:${game.dealer}`;
  const previousBoard = useRef(boardKey);
  const offset = SEATS.indexOf(game.dealer);
  const cells = [...Array.from({ length: offset }, () => null), ...game.auction];
  useLayoutEffect(() => {
    const element = body.current;
    if (previousBoard.current !== boardKey) followLatest.current = true;
    previousBoard.current = boardKey;
    if (element && followLatest.current) element.scrollTop = element.scrollHeight;
  }, [boardKey, game.auction.length]);
  return <div className={styles.history} aria-label="叫牌历史" data-testid="table-auction-history">
    <div className={styles.historyGrid} data-testid="auction-history-header">{SEATS.map(s => <strong key={s} className={isVulnerable(game.vulnerability, s) ? styles.vulHeading : ''}>{seatName[s]}{game.dealer === s && <small> D</small>}</strong>)}</div>
    <div ref={body} className={cx(styles.historyGrid, styles.historyBody)} role="region" aria-label="叫牌记录滚动区" tabIndex={0} data-testid="auction-history-scroll"
      onScroll={event => { const element = event.currentTarget; followLatest.current = element.scrollHeight - element.clientHeight - element.scrollTop <= 6; }}>
      {cells.length ? cells.map((entry, index) => {
        const auctionIndex = index - offset;
        const before = auctionIndex >= 0 ? game.auction.slice(0, auctionIndex) : [];
        const notices = entry ? biddingNotices(before, entry.seat, entry.call, system)
          .filter(notice => notice.kind === 'stop' || game.agreementVersion === agreementVersionFor(system)) : [];
        return entry ? <ExplainedCall key={index} focusable contextKey={JSON.stringify([game.board, game.seed, system, game.agreementVersion, game.auction.slice(0, auctionIndex + 1)])} explanation={() => describeCall(before, entry.seat, entry.call, system)} className={cx(styles.historyCallCell, entry.call.kind === 'pass' && styles.passCall)}><span aria-label={`${seatName[entry.seat]} ${callLabel(entry.call)}`}><CallDisplay call={entry.call} /><CallNoticeCards notices={notices} compact /></span></ExplainedCall> : <span key={index}>·</span>;
      }) : <p>尚未叫牌</p>}
    </div>
  </div>;
}
function BiddingBox({ game, hint }: { game: GameState; hint: string | null }) {
  const store = useGame(); const [selectedLevel, setLevel] = useState<number | null>(null);
  useEffect(() => setLevel(null), [game.auction.length]);
  const enabled = game.phase === 'auction' && game.turn === 'S' && !store.paused;
  const legal = enabled ? legalCalls(game.auction, 'S') : [];
  const lowestLevel = legal.find(call => call.kind === 'bid');
  const level = selectedLevel ?? (lowestLevel?.kind === 'bid' ? lowestLevel.level : 1);
  const available = (call: Call) => legal.some(c => sameCall(call, c));
  return <section className={styles.biddingBox} aria-label="叫牌框">
    <div className={styles.panelTitle}><h2>{enabled ? '轮到你叫牌' : '等待叫牌'}</h2><button className={styles.textButton} onClick={() => window.dispatchEvent(new Event('bridgelab-open-system-card'))}>体系卡</button><span>{enabled ? '轮到你' : '等待机器人'}</span></div>
    <div className={styles.levelChoices} aria-label="选择阶数">{Array.from({ length: 7 }, (_, i) => i + 1).map(value => <button key={value} aria-label={`选择 ${value} 阶`} aria-pressed={level === value} disabled={!legal.some(call => call.kind === 'bid' && call.level === value)} onClick={() => setLevel(value)}>{value}</button>)}</div>
    <div className={styles.strainChoices} aria-label="选择花色">{STRAINS.map(strain => {
      const call: Call = { kind: 'bid', level, strain }; const ok = available(call);
      const explanation = () => describeCall(game.auction, 'S', call, store.gameSystem);
      return <ExplainedCall key={strain} contextKey={JSON.stringify([game.board, game.seed, store.gameSystem, game.agreementVersion, game.auction, 'S', call])} explanation={explanation}><button aria-label={`叫 ${level ?? ''}${strain}`} disabled={!ok} onClick={() => store.call(call)} data-recommended={hint === callLabel(call)} className={cx(styles.bidButton, hint === callLabel(call) && styles.bidHint)}><span className={styles.bidValue}>{level ?? '·'}<SuitGlyph suit={strain} /></span><CallNoticeCards notices={ok ? biddingNotices(game.auction, 'S', call, store.gameSystem) : []} compact /></button></ExplainedCall>;
    })}</div>
    <div className={styles.specialCalls}>{([{ kind: 'pass' }, { kind: 'double' }, { kind: 'redouble' }] as Call[]).map(call => <ExplainedCall key={call.kind} contextKey={JSON.stringify([game.board, game.seed, store.gameSystem, game.agreementVersion, game.auction, 'S', call])} explanation={() => describeCall(game.auction, 'S', call, store.gameSystem)}><button aria-label={call.kind === 'pass' ? '不叫 Pass' : call.kind === 'double' ? '加倍 X' : '再加倍 XX'} disabled={!available(call)} onClick={() => store.call(call)} data-recommended={hint === callLabel(call)} className={cx(call.kind === 'pass' && styles.passButton, hint === callLabel(call) && styles.bidHint)}>{callLabel(call)}<small>{call.kind === 'pass' ? '不叫' : call.kind === 'double' ? '加倍' : '再加倍'}</small></button></ExplainedCall>)}</div>
  </section>;
}

function ResultPanel({ game }: { game: GameState }) {
  const store = useGame(); const [open, setOpen] = useState(true);
  const match = store.activeMatch; const board = match?.boards.find(item => item.number === game.board);
  const comparing = match?.mode === 'imp'; const ready = !comparing || board?.referenceScoreNS != null;
  const lastBoard = comparing && match.currentBoard === match.boardCount;
  if (!game.result) return null;
  const { scoreNS, declarerTricks, breakdown } = game.result;
  const difference = game.contract ? declarerTricks - game.contract.level - 6 : 0;
  const pages: ReactNode[] = [<div className={styles.resultTop}><div><span className={styles.eyebrow}>第 {game.board} 副 · {game.claim ? 'DDS 声称结算' : '已完成'}</span><h2>{game.phase === 'passedOut' ? '四家不叫，流局' : <><ContractDisplay contract={game.contract} /> {difference === 0 ? '成约' : difference > 0 ? `超 ${difference} 墩` : `宕 ${-difference} 墩`}</>}</h2><p>{game.contract ? `${seatName[game.contract.declarer]}家坐庄 · 实得 ${declarerTricks} 墩` : '本副记 0 分'}</p><p>{vulnerabilityName[game.vulnerability]}</p></div><div className={styles.resultScore}><small>南北原始得分</small><strong data-testid="board-score">{signed(scoreNS)}</strong></div></div>];
  if (game.contract) pages.push(<div className={styles.breakdown}>{([['定约墩分', breakdown.contractPoints], ['超墩', breakdown.overtrickPoints], ['成局 / 部分定约', breakdown.gameBonus], ['满贯奖励', breakdown.slamBonus], ['加倍奖励', breakdown.insultBonus], ['宕墩罚分', -breakdown.penalty]] as [string, number][]).filter(([, value]) => value !== 0).map(([label, value]) => <span key={label}>{label}<b>{signed(value)}</b></span>)}<small>庄家方视角计分。</small></div>);
  if (comparing) pages.push(ready && board?.reference ? <section className={styles.matchComparison} aria-label="双桌比较"><div><small>主桌南北分</small><strong>{signed(scoreNS)}</strong></div><div><small>参考桌南北分</small><strong>{signed(board.referenceScoreNS ?? 0)}</strong></div><div><small>分差 {signed(board.difference ?? 0)}</small><strong>{signed(board.imps ?? 0)} IMP</strong></div></section> : <p role="status">{store.referenceError ? '参考桌暂未完成，请稍后重试。' : '参考桌正在独立完成本副牌，结算后开放比较与复盘…'}</p>);
  if (game.claim) pages.push(<p className={styles.claimNote}>声称结算：{seatName[game.claim.seat]}家声称本方再得 {game.claim.tricks} 墩。本地 DDS 使用完整四家牌独立裁定。逐墩分析在声称位置截断。</p>);
  SEATS.forEach(seat => pages.push(<div className={styles.reviewHands}><div><strong>{seatName[seat]}家 · 原始手牌</strong>{[...SUITS].reverse().map(suit => <p key={suit}><b><SuitGlyph suit={suit} /></b> {game.initialHands[seat].filter(c => c.suit === suit).map(c => rankLabel(c.rank)).join(' ') || '—'}</p>)}</div>{game.claim && <div><strong>声称时余牌</strong>{[...SUITS].reverse().map(suit => <p key={suit}><b><SuitGlyph suit={suit} /></b> {game.hands[seat].filter(c => c.suit === suit).map(c => rankLabel(c.rank)).join(' ') || '—'}</p>)}</div>}</div>));
  return <><button className={styles.resultReopen} data-testid="result" onClick={() => setOpen(true)}>本副结果 {signed(scoreNS)} · 查看结算 / 四家手牌</button>{open && <Modal title="本副结果" onClose={() => setOpen(false)}><PagedContent pages={pages} label="结算" /><div className={styles.modalActions}>{ready && (lastBoard ? <a className={styles.primaryButton} href={`#/history/${encodeURIComponent(match.id)}`}>本场结果</a> : <button className={styles.primaryButton} onClick={() => store.nextBoard()}>下一副牌 →</button>)}<button disabled={!ready} className={styles.secondaryButton} onClick={() => openAnalysis(game, '#/table')}>{game.phase === 'passedOut' ? '双明手分析' : '主桌逐墩分析'}</button>{comparing && ready && board?.reference && <button className={styles.secondaryButton} onClick={() => openAnalysis(replay(board.reference!), '#/table')}>参考桌复盘</button>}</div></Modal>}</>;
}

function PagedContent({ pages, label = '内容' }: { pages: ReactNode[]; label?: string }) {
  const [page, setPage] = useState(0); const current = Math.min(page, Math.max(0, pages.length - 1));
  return <><div className={styles.modalPage}>{pages[current]}</div>{pages.length > 1 && <div className={styles.pager}><button aria-label={`上一页${label}`} disabled={current === 0} onClick={() => setPage(current - 1)}>‹ 上页</button><span>{current + 1} / {pages.length}</span><button aria-label={`下一页${label}`} disabled={current + 1 === pages.length} onClick={() => setPage(current + 1)}>下页 ›</button></div>}</>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, [onClose]);
  const items = Children.toArray(children);
  const actions = items.filter(item => isValidElement<{ className?: string }>(item) && item.props.className === styles.modalActions);
  const body = items.filter(item => !actions.includes(item));
  const pages: ReactNode[] = [];
  for (let index = 0; index < body.length; index++) {
    const item = body[index];
    if (isValidElement<{ className?: string; children?: ReactNode }>(item) && item.props.className === styles.helpText) {
      const parts = Children.toArray(item.props.children); let group: ReactNode[] = [];
      parts.forEach(part => { if (isValidElement(part) && part.type === 'h3' && group.length) { pages.push(<div className={styles.helpText}>{group}</div>); group = []; } group.push(part); });
      if (group.length) pages.push(<div className={styles.helpText}>{group}</div>);
    } else if (isValidElement(item) && (item.type === 'label' || (isValidElement<{ className?: string }>(item) && item.props.className === styles.fieldLabel)) && isValidElement(body[index + 1]) && (body[index + 1] as { type?: unknown }).type === 'p') { pages.push(<div>{item}{body[++index]}</div>); } else pages.push(item);
  }
  if (title.includes('声称')) { const handIndex = pages.findIndex(item => isValidElement(item) && item.type === ClaimHands); if (handIndex >= 0) { const [hands] = pages.splice(handIndex, 1); const stepIndex = pages.findIndex(item => isValidElement<{ className?: string }>(item) && item.props.className === styles.fieldLabel); const stepper = stepIndex >= 0 ? pages.splice(stepIndex, 1)[0] : null; pages.unshift(<div>{hands}{stepper}</div>); } }
  return <div className={styles.modalBackdrop} onClick={onClose}><section className={styles.modal} role="dialog" aria-modal="true" aria-label={title} onClick={event => event.stopPropagation()}><div className={styles.modalTitle}><h2>{title}</h2><button className={styles.iconButton} aria-label="关闭" onClick={onClose}>×</button></div><PagedContent key={title} pages={pages} label={title} />{actions}</section></div>;
}

function SystemCards() {
  const pages: ReactNode[] = [];
  (['sayc', 'two-over-one', 'precision'] as const).forEach(system => {
    const details = SYSTEMS[system];
    pages.push(<article><h3>{details.name}</h3><p>{details.summary}</p><p>{details.limitations}</p></article>);
    details.rules.forEach((rule, index) => { for (let start = 0; start < rule.length; start += 170) pages.push(<article><h3>{details.short} · 约定 {index + 1}{start > 0 ? '（续）' : ''}</h3><p>{rule.slice(start, start + 170)}</p></article>); });
  });

  return <PagedContent pages={pages} label="体系卡" />;
}

function TabIcon({ kind }: { kind: 'solo' | 'online' | 'history' | 'analysis' }) {
  return <svg className={styles.tabIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'solo' && <><rect x="7" y="3" width="12" height="17" rx="2" /><path d="M4 7v13a2 2 0 0 0 2 2h9M13 7l3 4-3 4-3-4 3-4Z" /></>}
    {kind === 'online' && <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M19 21v-3a6 6 0 0 0-2-4" /></>}
    {kind === 'history' && <><path d="M4 8a9 9 0 1 1-1 7M3 3v6h6" /><path d="M12 7v6l4 2" /></>}
    {kind === 'analysis' && <><path d="M4 3v18h17M8 16l4-5 4 2 5-7" /><path d="M17 6h4v4" /></>}
  </svg>;
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

export default function App() {
  const store = useGame(); const game = store.game;
  const appearance = useAppearance();
  const lanRoom = useLanRoom();
  const slModel = useSyncExternalStore(subscribeSLModel, getSLModelState);
  useEffect(() => { if ((store.game?.biddingSystem ?? (store.game ? store.gameSystem : store.biddingSystem)) !== 'precision') void ensureSLReady().catch(() => {}); }, [store.gameSystem, store.biddingSystem, !!store.game]);
  const route = () => location.hash.startsWith('#/online') ? 'online' : location.hash.startsWith('#/analysis/deals') || location.hash.startsWith('#/deals') ? 'deals' : location.hash.startsWith('#/analysis') ? 'analysis' : location.hash.startsWith('#/table') ? 'table' : location.hash.startsWith('#/history') ? 'history' : location.hash.startsWith('#/setup') ? 'setup' : 'home';
  const [page, setPage] = useState<'home' | 'setup' | 'history' | 'table' | 'analysis' | 'deals' | 'online'>(route);
  const [routeHash, setRouteHash] = useState(location.hash);
  useEffect(() => { if (!location.hash || location.hash === '#/' || location.hash === '#') location.hash = '/home'; const change = () => { setPage(route()); setRouteHash(location.hash); }; window.addEventListener('hashchange', change); return () => window.removeEventListener('hashchange', change); }, []);
  const [modal, setModal] = useState<'restart' | 'settings' | 'scores' | 'help' | 'systems' | 'claim' | 'tricks' | null>(null);
  useEffect(() => { const open = () => setModal('systems'); window.addEventListener('bridgelab-open-system-card', open); return () => window.removeEventListener('bridgelab-open-system-card', open); }, []);
  const [hint, setHint] = useState<string | null>(null);
  const [claimTricks, setClaimTricks] = useState(0); const [claimBusy, setClaimBusy] = useState(false); const [claimMessage, setClaimMessage] = useState<string | null>(null);
  const [hintBusy, setHintBusy] = useState(false); const [hintDetail, setHintDetail] = useState<string | null>(null);
  const hintSequence = useRef(0);
  const [offlineReady, setOfflineReady] = useState(false);
  const [update, setUpdate] = useState<(() => Promise<void>) | null>(null);
  const [install, setInstall] = useState<InstallEvent | null>(null);
  useEffect(() => {
    const updater = registerSW({ immediate: true, onOfflineReady: () => setOfflineReady(true), onNeedRefresh: () => { setUpdate(() => () => updater(true)); void updater(true); }, onRegisterError: () => setOfflineReady(false) });
    navigator.serviceWorker?.ready.then(() => {
      if (navigator.serviceWorker.controller) setOfflineReady(true);
    });
    const prompt = (event: Event) => { event.preventDefault(); setInstall(event as InstallEvent); };
    window.addEventListener('beforeinstallprompt', prompt);
    return () => { window.removeEventListener('beforeinstallprompt', prompt); };
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
      const requestId = ++hintSequence.current; setHintBusy(true); setHint(null); setHintDetail(null);
      try {
        const selected = await suggestSystemBid(obs, { system: store.gameSystem });
        if (requestId !== hintSequence.current) return;
        const label = callLabel(selected.call); setHint(label);
        setHintDetail(`建议 ${label}`);
      } catch (error) {
        if (requestId === hintSequence.current) setHintDetail('暂时无法提供建议，请重试。');
      } finally { if (requestId === hintSequence.current) setHintBusy(false); }
      return;
    }
    const requestId = ++hintSequence.current; setHintBusy(true); setHint(null); setHintDetail(null);
    try {
      const decision = await playAdvisor.advise({ observation: obs, system: store.gameSystem, strength: 'challenge' });
      if (requestId !== hintSequence.current) return;
      setHint(decision.cardId);
      const selected = obs.legalCards.find(card => card.id === decision.cardId);
      setHintDetail(selected ? `建议出 ${cardLabel(selected)}` : null);
    } catch {
      if (requestId !== hintSequence.current) return;
      const cardId = chooseCard(obs, store.gameSystem); const selected = obs.legalCards.find(card => card.id === cardId);
      setHint(cardId); setHintDetail(selected ? `建议出 ${cardLabel(selected)}` : null);
    } finally { if (requestId === hintSequence.current) setHintBusy(false); }
  };
  const hintCard = game?.hands[game.turn].find(card => card.id === hint);
  const hintText = hintBusy ? '正在思考…' : hintDetail ?? (hintCard ? `建议出 ${cardLabel(hintCard)}` : '');
  const statusText = !game ? '准备好开始一副牌' : isFinished(game) ? '本副已结束' : store.paused ? '游戏已暂停' : store.thinking && game.phase === 'play' ? `${seatName[controllerFor(game)]}家机器人正在思考…` : game.phase === 'auction' ? game.turn === 'S' ? '轮到你叫牌' : `${seatName[game.turn]}家机器人正在叫牌` : humanTurn ? game.turn === 'S' ? '轮到你出牌' : `请为${seatName[game.turn]}家明手出牌` : `${seatName[controllerFor(game)]}家机器人${game.turn === game.contract?.dummy ? '控制明手' : ''}出牌中`;
  const liveGame = !!game && (game.phase === 'auction' || game.phase === 'play');
  const noticeText = visibleTableNotice(liveGame, playerNotice(store.notice, store.lastDecision?.reasonTags), store.userActionNotice);
  const [ledgerPage, setLedgerPage] = useState(0);
  const ledger = [...store.history, ...(game && isFinished(game) ? [game] : [])];

  return <div className={cx(styles.app, (page === 'table' || page === 'online') && styles.inGame, page === 'analysis' && styles.analysisShell)} data-testid="app" data-sl-profile={slModel.profileId} data-sl-loaded-sha={slModel.loadedWeightsSHA256 ?? ""} data-sl-status={slModel.status} data-sl-applied-bids={slModel.appliedBids} data-sl-last-action={slModel.lastBid?.action ?? ""} data-sl-last-route={slModel.lastBid?.route ?? ""} data-sl-last-seat={slModel.lastBid?.seat ?? ""} data-sl-last-history={slModel.lastBid?.historyLength ?? ""} data-phase={game?.phase ?? 'idle'} data-turn={game?.turn ?? ''} data-controller={game && !isFinished(game) ? controllerFor(game) : ''} data-actions={game?.actions.length ?? 0}>
    <header className={styles.header}><a href="#/home" className={styles.brand}><img src={`${import.meta.env.BASE_URL}icon.svg`} alt="" /><div><strong>Bridge<span>Lab</span></strong><small>桥牌 <span>v3.3.0</span></small></div></a><div className={styles.headerRight}>{page === 'table' && <div className={styles.totalScore}><small>{match?.mode === 'imp' ? '南北累计 IMP' : '南北累计原始分'}</small><b data-testid="cumulative-score">{signed(match?.mode === 'imp' ? match.totalImps : match?.totalScore ?? cumulativeScore(store))}</b></div>}<a className={styles.secondaryButton} href="#/setup">新牌局</a><button className={styles.iconButton} aria-label="设置" title="设置" onClick={() => setModal('settings')}>⚙</button></div></header>
    <main className={cx(styles.main, (page === 'table' || page === 'online') && styles.tableMain, page === 'analysis' && styles.analysisMain)}>
      {page === 'online' ? <LanRoomPage room={lanRoom} /> : page === 'home' ? <HomePage onSettings={() => setModal('settings')} /> : page === 'setup' ? <SetupPage /> : page === 'history' ? <HistoryPage matchId={decodeRouteId(routeHash.split('/').slice(2).join('/')) || undefined} /> : page === 'analysis' ? <AnalysisPage /> : page === 'deals' ? <DealEditorPage onStart={async deal => { await store.startCustom(deal); location.hash = '/table'; }} /> : <>{!game ? <section className={styles.welcome}>
        <div className={styles.welcomeCopy}><span className={styles.eyebrow}>YOUR SEAT IS SOUTH</span><h1>入座。<br />开始一副好牌。</h1><p>与北家搭档，对阵东西两位机器人。<br />从叫牌到最后一墩，在这里专注打桥牌。</p><button className={styles.primaryButton} aria-label="开始游戏" onClick={async () => { await store.start(); }}>开始游戏 <span>→</span></button><div className={styles.welcomeFeatures}><span>♠ 完整 52 张牌</span><span>↺ 自动保存与悔牌</span><span>◇ 缓存后离线可玩</span></div></div>
        <div className={styles.welcomeArt} aria-hidden="true"><div className={styles.miniTable}><span className={styles.miniN}>N</span><span className={styles.miniE}>E</span><span className={styles.miniW}>W</span><span className={styles.miniS}>S · YOU</span><div className={styles.welcomeCards}>{(['S', 'H', 'D', 'C'] as const).map((suit, index) => <div key={suit} style={{ transform: `rotate(${(index - 1.5) * 12}deg) translateY(${Math.abs(index - 1.5) * 8}px)` }}><CardView table seat="S" card={{ id: `${suit}14`, rank: 14, suit }} /></div>)}</div><small>BRIDGELAB</small></div></div>
      </section> : <>
        {match && <section className={styles.matchBar} aria-label="比赛进度"><div><strong>{match.mode === 'imp' ? '双桌 IMP' : '累计总分'}</strong><span>{match.assisted ? '辅助练习' : '正常比赛'}</span><span>第 {match.currentBoard}{match.mode === 'imp' ? ` / ${match.boardCount}` : ''} 副 · 已结算 {match.completedBoards} 副</span></div><div><strong aria-label={match.mode === 'imp' ? '双方 IMP 比分' : undefined}>{match.mode === 'imp' ? `我方 ${ourImps} : ${theirImps} 对方 · 净 ${signed(match.totalImps)} IMP` : `${signed(match.totalScore)} 分`}</strong><button className={styles.textButton} onClick={async () => { const id = match.id; try { await store.finishMatch(); location.hash = `/history/${encodeURIComponent(id)}`; } catch { /* Store preserves the match and displays the error. */ } }}>{match.status === 'completed' ? '查看本场结果 →' : '结束并归档'}</button></div>{normalImp && <small>正常 IMP 比赛 · 提示、悔牌与重打已关闭</small>}</section>}
        <div className={styles.boardBar}><div><span className={styles.boardBadge}>第 {game.board} 副</span><span>{seatName[game.dealer]}家发牌</span><span className={game.vulnerability !== 'None' ? styles.vulText : ''}>{vulnerabilityName[game.vulnerability]}</span></div><details className={styles.toolsMenu}><summary>牌局工具</summary><div className={styles.boardControls}><button disabled={normalImp || settledImp || !store.undo.length || store.thinking} className={styles.textButton} onClick={store.undoDecision}>↶ 悔牌</button><button disabled={normalImp || !humanTurn || hintBusy} className={styles.textButton} onClick={showHint}>{hintBusy ? '◇ 分析中' : '◇ 提示'}</button><button disabled={!humanTurn || game.phase !== 'play' || store.thinking} className={styles.textButton} onClick={() => { setClaimTricks(13 - game.completedTricks.length); setClaimMessage(null); setModal('claim'); }}>摊牌声称</button><button className={styles.textButton} onClick={() => setModal('scores')}>记分</button><button className={styles.textButton} onClick={() => setModal('tricks')}>墩记录</button><button disabled={normalImp || settledImp} className={styles.textButton} aria-label="重打本副" onClick={() => setModal('restart')}>↻ 重打</button>{match && <button className={styles.textButton} onClick={async () => { const id = match.id; try { await store.finishMatch(); location.hash = `/history/${encodeURIComponent(id)}`; } catch { /* Match is preserved on failure. */ } }}>结束并归档</button>}<button className={styles.textButton} onClick={() => setModal('systems')}>体系卡</button></div></details></div>
        <div className={styles.gameGrid}><div className={styles.playArea}>
          <div className={styles.statusBar} role="status" aria-live="polite"><span className={cx(styles.statusDot, humanTurn && styles.humanDot)} /><strong>{statusText}</strong><span className={styles.contractTag}>{game.contract ? <><ContractDisplay contract={game.contract} /> · {seatName[game.contract.declarer]}家庄</> : '定约待定'}</span>{game.phase === 'play' && <div className={styles.compactTrick}><span>{game.currentTrick.length ? <InlinePlays plays={game.currentTrick} /> : `${seatName[game.turn]}家首引`}</span></div>}</div>
          <Table game={game} hint={hint} />
          {isFinished(game) && <ResultPanel key={`${game.board}:${game.seed}`} game={game} />}
          {hintText && <p className={styles.hintText}>{hintText}</p>}
        </div></div>
      </>}
      {noticeText && <TransientNotice text={noticeText} onClose={store.clearNotice} tone={liveGame || /失败|无法|不能|错误|不足|损坏|不可用/.test(noticeText) ? 'error' : 'status'} />}</>}
    </main>
    <nav className={styles.bottomNavigation} aria-label="主导航">
      <a href={game ? '#/table' : '#/home'} aria-current={page === 'home' || page === 'setup' || page === 'table' ? 'page' : undefined}><TabIcon kind="solo" /><span>单机游戏</span></a>
      <a href="#/online" aria-current={page === 'online' ? 'page' : undefined}><TabIcon kind="online" /><span>联机游戏</span></a>
      <a href="#/history" aria-current={page === 'history' ? 'page' : undefined}><TabIcon kind="history" /><span>历史牌局</span></a>
      <a href="#/analysis" aria-current={page === 'analysis' || page === 'deals' ? 'page' : undefined}><TabIcon kind="analysis" /><span>分析室</span></a>
    </nav>

    {modal === 'restart' && <Modal title="重打本副" onClose={() => setModal(null)}><p>保留本副种子，恢复原始发牌和叫牌。之前各副的累计得分保留。</p><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={() => setModal(null)}>取消</button><button className={styles.primaryButton} onClick={() => { store.restart(); setModal(null); }}>确认重打</button></div></Modal>}
    {modal === 'claim' && game?.phase === 'play' && <Modal title="摊牌声称" onClose={() => { if (!claimBusy) setModal(null); }}><p>选择南北方从当前未完成墩开始声称取得的墩数。提交时南家余牌按摊牌处理；本地 DDS 将查看完整四家牌并按最佳攻防裁定。超过可保证墩数时，牌局保持不变。</p><ClaimHands game={game} claimant="S" /><div className={styles.fieldLabel}>南北方声称再得墩数<div className={styles.claimStepper}><button aria-label="声称少一墩" disabled={claimBusy || claimTricks === 0} onClick={() => { setClaimTricks(claimTricks - 1); setClaimMessage(null); }}>−</button><output aria-label="南北方声称再得墩数">{claimTricks} 墩</output><button aria-label="声称多一墩" disabled={claimBusy || claimTricks >= 13 - game.completedTricks.length} onClick={() => { setClaimTricks(claimTricks + 1); setClaimMessage(null); }}>＋</button></div></div><div className={styles.seedInfo}><span>当前已完成 {game.completedTricks.length} 墩，尚余 {13 - game.completedTricks.length} 墩{game.currentTrick.length ? `；当前一墩已有 ${game.currentTrick.length} 张牌` : ''}。</span><span>声称裁定与实战机器人的公开信息采样隔离，不会把真实隐藏牌传给后续打牌策略。</span></div>{claimMessage && <p className={styles.claimError} role="alert">{claimMessage}</p>}<div className={styles.modalActions}><button className={styles.secondaryButton} disabled={claimBusy} onClick={() => setModal(null)}>继续打牌</button><button className={styles.primaryButton} disabled={claimBusy} onClick={async () => { setClaimBusy(true); setClaimMessage(null); const result = await store.claim(claimTricks); setClaimBusy(false); if (result.accepted) setModal(null); else setClaimMessage(playerNotice(result.message)); }}>{claimBusy ? '正在确认…' : '提交声称'}</button></div></Modal>}
    {modal === 'settings' && <Modal title="游戏设置" onClose={() => setModal(null)}><AppearanceSettings appearance={appearance} /><div className={styles.fieldLabel}>叫牌体系<div className={styles.settingChoices} role="group" aria-label="叫牌体系">{(['sayc', 'two-over-one', 'precision'] as const).map(system => <button key={system} disabled={!!match} aria-pressed={store.biddingSystem === system} onClick={() => store.setBiddingSystem(system)}>{SYSTEMS[system].short}</button>)}</div></div><p>{match ? `本场使用${SYSTEMS[store.gameSystem].name}。本场体系已固定；下场可在开始页面设置。` : game ? `本副使用${SYSTEMS[store.gameSystem].name}。体系选择在新牌局、下一副或重打时生效。` : '新牌局使用所选体系。四位牌手使用同一套约定。'}</p><button className={styles.secondaryButton} onClick={() => setModal('systems')}>查看完整体系卡与支持范围</button><div className={styles.resourceStatus}><span>{offlineReady ? '离线资源已就绪' : '离线资源准备中'}</span>{update && <button className={styles.secondaryButton} onClick={() => update()}>更新并刷新</button>}{install && <button className={styles.secondaryButton} onClick={async () => { await install.prompt(); await install.userChoice; setInstall(null); }}>安装应用</button>}</div><SLModelPanel busy={store.thinking || store.referenceThinking} system={game ? store.gameSystem : store.biddingSystem} /><div className={styles.fieldLabel}>机器人行动速度<div className={styles.settingChoices} role="group" aria-label="机器人行动速度">{([[1100, '从容 · 1.1秒'], [650, '标准 · 0.65秒'], [250, '快速 · 0.25秒'], [0, '即时']] as [number, string][]).map(([value, label]) => <button key={value} aria-pressed={store.delay === value} onClick={() => store.setDelay(value)}>{label}</button>)}</div></div><p>南家始终由你控制。你坐庄时也操作明手；北家坐庄时，北家机器人操作你的明手。</p>{game && (!match || match.mode !== 'imp' || (match.boards[match.currentBoard - 1].scoreNS !== null && match.boards[match.currentBoard - 1].referenceScoreNS !== null)) && <div className={styles.seedInfo}><span>本副发牌编号</span><code>{game.seed}</code></div>}<button className={styles.secondaryButton} onClick={() => { setModal('help'); }}>查看 AI 约定与使用说明</button></Modal>}
    {modal === 'systems' && <Modal title="叫牌体系卡" onClose={() => setModal(null)}><SystemCards /></Modal>}
    {modal === 'tricks' && game && <Modal title="已完成墩记录" onClose={() => setModal(null)}><PagedContent label="墩记录" pages={game.completedTricks.length ? game.completedTricks.map((trick, index) => <section><h3>第 {index + 1} 墩 · {seatName[trick.winner]}家赢</h3><p><InlinePlays plays={trick.plays} /></p></section>) : [<p>尚无已完成的墩。</p>]} /></Modal>}
    {modal === 'scores' && <Modal title="记分卡" onClose={() => setModal(null)}><p>南北视角的复式原始分累计，未与其他桌比较。</p><div className={styles.ledger}><div><b>局</b><b>定约 / 庄家</b><b>实得</b><b>南北分</b></div>{ledger.length ? ledger.slice(ledgerPage * 3, ledgerPage * 3 + 3).map(g => <div key={`${g.board}:${g.seed}`}><span>{g.board}</span><span>{g.contract ? <><ContractDisplay contract={g.contract} /> / {seatName[g.contract.declarer]} {g.claim && <small>声称</small>}</> : '四家 Pass'} <button className="ledger-analysis" aria-label={`分析第 ${g.board} 副`} onClick={() => { setModal(null); openAnalysis(g); }}>分析 →</button></span><span>{g.contract ? g.result?.declarerTricks : '—'}</span><strong>{signed(g.result?.scoreNS ?? 0)}</strong></div>) : <p>第一副结束后将在这里记录。</p>}</div><div className={styles.pager}><button disabled={!ledgerPage} onClick={() => setLedgerPage(ledgerPage - 1)}>‹</button><span>{ledgerPage + 1} / {Math.max(1, Math.ceil(ledger.length / 3))}</span><button disabled={(ledgerPage + 1) * 3 >= ledger.length} onClick={() => setLedgerPage(ledgerPage + 1)}>›</button></div><p className={styles.ledgerTotal}>累计 <b>{signed(cumulativeScore(store))}</b></p></Modal>}
    {modal === 'help' && <Modal title="关于 BridgeLab" onClose={() => setModal(null)}><div className={styles.helpText}><p>你坐南家，与北家搭档。点击叫品，轮到自己或自己控制的明手时，点击亮起的牌出牌。首攻后明手公开，手中有首引花色时必须跟牌。</p><h3>保存、牌例与悔牌</h3><p>每次动作后自动保存。牌例工作台可逐张分配四家手牌，保存后进入正常叫牌、打牌和分析。悔牌、重打和刷新会保留自定义发牌。</p><h3>叫牌体系</h3><p>可选标准（SAYC）、自然（Natural）和精确（Precise）。Natural采用二盖一进局逼叫与Drury等常用约定。四位牌手使用同一套约定，换体系从下一副、新牌局或重打时生效。</p><button className={styles.secondaryButton} onClick={() => setModal('systems')}>查看叫牌体系卡</button><h3>实战打牌 AI</h3><p>机器人根据公开叫牌、明手和已打牌判断出牌，不读取对手的隐藏手牌。</p><h3>摊牌声称</h3><p>轮到南北方行动时可声称余下若干墩，声称窗口会公开声称方余牌和已公开的明手。本地 DDS 作为独立裁定者查看完整四家牌；可保证时直接结算，过高时拒绝且牌局不变。机器人提出声称时也会先摊开自身余牌，由你选择同意或拒绝。逐墩分析保留声称前的全部实际出牌，并在声称位置截断。</p><h3>逐墩双明手分析</h3><p>完整打完、声称结算或四家 Pass 后均可进入分析室。完整牌局逐张回放；声称牌局在声称位置截断；四家 Pass 的牌局先展示双明手总表，并可选择假设定约和庄家继续试打。分支不会修改原局和累计得分。</p><h3>电脑端离线使用</h3><p>首次打开并载入后可继续离线游戏。清理应用数据会删除本地牌局与牌例，请先导出备份。</p></div></Modal>}
    {page === 'table' && store.pendingRobotClaim && game && <Modal title="机器人提出声称" onClose={store.rejectRobotClaim}><p>{seatName[store.pendingRobotClaim.seat]}家机器人声称其一方从当前未完成墩开始再得 {store.pendingRobotClaim.tricks} 墩，其余 {store.pendingRobotClaim.remainingTricks - store.pendingRobotClaim.tricks} 墩归对方。按桥牌声称流程，机器人先公开自己的全部余牌。</p><ClaimHands game={game} claimant={store.pendingRobotClaim.seat} /><div className={styles.seedInfo}><span>这项建议只根据机器人合法可见信息生成的公开信息样本提出，没有读取真实隐藏牌。</span><span>同意后立即按声称结算；不同意则执行机器人原定出牌并继续牌局。</span></div><div className={styles.modalActions}><button className={styles.secondaryButton} onClick={store.rejectRobotClaim}>不同意，继续打</button><button className={styles.primaryButton} onClick={store.acceptRobotClaim}>同意声称</button></div></Modal>}
  </div>;
}


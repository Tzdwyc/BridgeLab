import { useEffect, useRef, useState } from 'react';
import { useGame } from '../controller/store';
import { isFinished, replay } from '../core/game';
import { SYSTEMS, type BiddingSystem } from '../ai/systems';
import { historicalCallExplanation, withRecordedBiddingAgreement } from '../ai/historical-bidding-presentation';
import { type GameState, SEATS } from '../core/types';
import { loadHistoryNavigation, openAnalysis, saveHistoryNavigation } from '../analysis/navigation';
import { CallDisplay, ContractDisplay } from './SuitGlyph';
import { signed, seatName, callLabel } from './format';
import { nativeFiles } from '../platform/files';
import { TransientNotice } from './TransientNotice';
import styles from './MatchPages.module.css';

type MatchData = NonNullable<ReturnType<typeof useGame.getState>['activeMatch']>;
type Summary = Awaited<ReturnType<ReturnType<typeof useGame.getState>['listMatches']>>[number];
const modeName = (mode: string) => mode === 'imp' ? '双桌 IMP' : '累计总分';
const dateLabel = (value: string | number) => new Date(value).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
function useScreen() {
  const [size, setSize] = useState({ width: innerWidth, height: innerHeight });
  useEffect(() => { const update = () => setSize({ width: innerWidth, height: innerHeight }); window.addEventListener('resize', update); return () => window.removeEventListener('resize', update); }, []);
  return { ...size, short: size.height < 530, phone: size.width < 700 };
}
function Pager({ page, count, onChange, label = '页' }: { page: number; count: number; onChange: (page: number) => void; label?: string }) {
  const last = Math.max(1, count);
  return <div className={styles.pager}><button aria-label={`上一${label}`} disabled={page === 0} onClick={() => onChange(page - 1)}>‹ 上一{label}</button><span aria-live="polite">{page + 1} / {last}</span><button aria-label={`下一${label}`} disabled={page >= last - 1} onClick={() => onChange(page + 1)}>下一{label} ›</button></div>;
}
function Notice({ text, onClose }: { text: string; onClose: () => void }) {
  return <TransientNotice text={text} onClose={onClose} tone={/^(已导入|牌局存档已导出)/.test(text) ? 'status' : 'error'} />;
}
function HistoricalAuction({ game, system, explanations }: { game: GameState; system?: BiddingSystem; explanations?: string[] }) {
  const screen = useScreen(); const rows = screen.short ? 2 : screen.phone ? 3 : 4;
  const offset = SEATS.indexOf(game.dealer); const count = Math.max(1, Math.ceil((offset + game.auction.length) / (rows * 4)));
  const [page, setPage] = useState(count - 1); const [selected, setSelected] = useState<number | null>(null); const [textPage, setTextPage] = useState(0);
  useEffect(() => { setPage(value => Math.min(value, count - 1)); }, [count]);
  const meaning = selected === null ? '点击叫品查看公开含义。' : historicalCallExplanation(game, selected, explanations?.[selected], system);
  const chunks = meaning.match(new RegExp(`[\\s\\S]{1,${screen.short ? 65 : screen.phone ? 100 : 170}}`, 'g')) ?? [meaning];
  return <section className={styles.auction} aria-label="历史叫牌记录">
    <div className={styles.auctionGrid}>{SEATS.map(seat => <strong key={seat}>{seatName[seat]}{seat === game.dealer && <small> D</small>}</strong>)}{Array.from({ length: rows * 4 }, (_, index) => {
      const i = page * rows * 4 + index - offset, entry = game.auction[i];
      return entry ? <button key={index} aria-label={`${seatName[entry.seat]} ${callLabel(entry.call)}`} onMouseEnter={() => { setSelected(i); setTextPage(0); }} onFocus={() => { setSelected(i); setTextPage(0); }} onClick={() => { setSelected(i); setTextPage(0); }} aria-pressed={selected === i}><CallDisplay call={entry.call} /></button> : <span key={index} />;
    })}</div>
    <Pager page={page} count={count} onChange={setPage} />
    <div className={styles.auctionExplanation}><p role="tooltip">{chunks[Math.min(textPage, chunks.length - 1)]}</p>{chunks.length > 1 && <Pager page={textPage} count={chunks.length} onChange={setTextPage} label="段" />}</div>
  </section>;
}

export function HomePage({ onSettings }: { onSettings: () => void }) {
  const { activeMatch: match, game } = useGame(); const canContinue = !!game && (!match || match.status !== 'completed');
  return <section className={styles.home} data-testid="home-page">
    <div className={styles.hero}><span className={styles.kicker}>BRIDGELAB · 南家是你的座位</span><h1>入座，专注下一手。</h1><p>累计积分，或与另一桌比较 IMP。</p>
      <div className={styles.heroActions}><a className={styles.primary} href="#/setup">开始打牌 <span>→</span></a><a className={styles.secondary} href="#/history">历史牌局 <span>↗</span></a></div>
      {canContinue && <a href="#/table" className={styles.continue} data-testid="continue-match"><span>继续未完成的牌局</span><strong>{match ? `${modeName(match.mode)} · 第 ${match.currentBoard}${match.mode === 'imp' ? ` / ${match.boardCount}` : ''} 副` : `第 ${game.board} 副 · 单副练习`}</strong><span>回到牌桌 →</span></a>}
    </div>
    <div className={styles.homeCard}><div className={styles.suitArt} aria-hidden="true"><span>♠</span><span>♥</span><span>♣</span><span>♦</span></div><h2>打牌，也看懂牌。</h2><div className={styles.homeLinks}><a href="#/analysis">分析室 <span>→</span></a><button onClick={onSettings}>游戏设置 <span>→</span></button></div></div>
  </section>;
}

export function SetupPage() {
  const store = useGame(); const [mode, setMode] = useState<'total' | 'imp'>('total');
  const [boardCount, setBoardCount] = useState<8 | 16 | 24>(16); const [assisted, setAssisted] = useState(false);
  const [system, setSystem] = useState<BiddingSystem>(store.biddingSystem);
  const [seed, setSeed] = useState('');
  const [seedOpen, setSeedOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const start = async () => {
    setBusy(true); setError('');
    try { await store.startMatch({ mode, boardCount, assisted: mode === 'total' || assisted, seed: seed.trim() || undefined, biddingSystem: system, playStrength: 'challenge' }); location.hash = '/table'; }
    catch (cause) { setError(cause instanceof Error ? cause.message : '牌局创建失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <section className={styles.page} data-testid="setup-page">
    <div className={styles.heading}><div><a className={styles.back} href="#/home">← 首页</a><h1>开始一场牌局</h1></div></div>
    <div className={styles.setupGrid}><div className={styles.setupForm}>
      <fieldset className={styles.fieldset}><legend>比赛模式</legend><div className={styles.modeChoices}>
        <button aria-pressed={mode === 'total'} onClick={() => setMode('total')}><strong>累计总分</strong><small>1 位用户＋3 位机器人</small></button>
        <button aria-pressed={mode === 'imp'} onClick={() => setMode('imp')}><strong>双桌 IMP</strong><small>1 位用户＋7 位机器人</small></button>
      </div></fieldset>
      <fieldset className={styles.fieldset}><legend>比赛副数</legend><div className={styles.choices}>{mode === 'imp' ? ([8, 16, 24] as const).map(count => <button key={count} aria-pressed={boardCount === count} onClick={() => setBoardCount(count)}>{count} 副</button>) : <span className={styles.choiceNote}>连续打牌，随时结束归档</span>}</div></fieldset>
      <fieldset className={styles.fieldset}><legend>叫牌体系</legend><div className={styles.choices} aria-label="本场叫牌体系">{(['sayc', 'two-over-one', 'precision'] as const).map(id => <button key={id} aria-pressed={system === id} onClick={() => setSystem(id)}>{SYSTEMS[id].name}</button>)}</div></fieldset>

      <details className={styles.advanced} data-testid="match-advanced-settings"><summary>高级设置{seed ? ' · 已设置复现发牌' : ''}</summary><div>
        {mode === 'imp' && <label className={styles.check}><input type="checkbox" checked={assisted} onChange={event => setAssisted(event.target.checked)} /><span>辅助练习 · 开放提示、悔牌和重打</span></label>}
        <button className={styles.secondary} onClick={() => setSeedOpen(true)}>复现发牌{seed ? ' · 已设置' : ''}</button>
      </div></details>
    </div><aside className={styles.setupSummary}><span className={styles.kicker}>本场设置</span><h2>{modeName(mode)} · {mode === 'imp' ? `${boardCount} 副` : '连续打牌'}</h2><p>{SYSTEMS[system].name}</p><p>{mode === 'imp' && !assisted ? '正常比赛关闭提示、悔牌和重打。两桌均结束后开放复盘。' : '允许提示、悔牌和重打。结果保存在本机。'}</p><small>{mode === 'imp' ? '参考桌独立完成同一副牌，按分差换算 IMP。' : '累计南北方原始得分。'}</small></aside></div>
    {error && <Notice text={error} onClose={() => setError('')} />}
    <div className={styles.startBar}><span>{modeName(mode)} · {mode === 'imp' ? `${boardCount} 副` : '连续打牌'}{store.game ? ' · 旧局自动归档' : ''}</span><button className={styles.primary} onClick={start} disabled={busy}>{busy ? '准备牌桌…' : '开始比赛'} →</button></div>
    {seedOpen && <div className={styles.overlay}><section className={styles.dialog} role="dialog" aria-modal="true" aria-label="复现发牌"><h2>复现发牌</h2><label>发牌编号<input autoFocus aria-label="发牌编号" value={seed} maxLength={160} onChange={event => setSeed(event.target.value)} placeholder="留空随机发牌" /></label><p>相同编号和比赛设置生成相同牌局。</p><button className={styles.primary} onClick={() => setSeedOpen(false)}>完成</button></section></div>}
  </section>;
}

export function HistoryPage({ matchId }: { matchId?: string }) {
  const store = useGame(), screen = useScreen();
  const [list, setList] = useState<Summary[]>([]); const [match, setMatch] = useState<MatchData | null>(null);
  const [filter, setFilter] = useState(() => loadHistoryNavigation(matchId).filter); const [page, setPage] = useState(() => loadHistoryNavigation(matchId).page);
  const [boardIndex, setBoardIndex] = useState(() => loadHistoryNavigation(matchId).boardIndex); const [view, setView] = useState(() => loadHistoryNavigation(matchId).view);
  const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true); const file = useRef<HTMLInputElement>(null);
  const pageSize = screen.short ? 2 : screen.phone ? 4 : 5;
  const refresh = async () => { setLoading(true); try { setList(await store.listMatches()); if (matchId) setMatch(store.activeMatch?.id === matchId ? store.activeMatch : await store.getMatch(matchId)); else setMatch(null); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '历史记录暂不可读取。'); } finally { setLoading(false); } };
  useEffect(() => { const saved = loadHistoryNavigation(matchId); setBoardIndex(saved.boardIndex); setView(saved.view); void refresh(); }, [matchId]);
  useEffect(() => { void refresh(); }, [store.activeMatch]);
  const filtered = list.filter(item => filter === 'all' || item.mode === filter), pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => { if (!loading) setPage(value => { const next = Math.min(value, pages - 1); if (next !== value) saveHistoryNavigation(undefined, { page: next }); return next; }); }, [pages, loading]);
  const ourImps = match?.boards.reduce((sum, b) => sum + Math.max(0, b.imps ?? 0), 0) ?? 0;
  const theirImps = match?.boards.reduce((sum, b) => sum + Math.max(0, -(b.imps ?? 0)), 0) ?? 0;
  const exportArchive = async () => { setNotice(''); try {
    const raw = await store.exportMatches(), filename = `BridgeLab-v3-牌局存档-${new Date().toISOString().slice(0, 10)}.json`, native = nativeFiles();
    if (native) { if (await native.saveFile(filename, raw)) setNotice('牌局存档已导出。'); return; }
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })), link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); setNotice('牌局存档已导出。');
  } catch (cause) { setNotice(cause instanceof Error ? cause.message : '导出失败。'); } };
  const importText = async (raw: string) => { try { const count = await store.importMatches(raw); await refresh(); setNotice(`已导入 ${count} 场牌局。`); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '存档格式不正确，未导入。'); } };
  const chooseImport = async () => { const native = nativeFiles(); if (!native) { file.current?.click(); return; } try { const selected = await native.openFile(); if (selected) await importText(selected.text); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '无法打开存档。'); } };
  const board = match?.boards[Math.min(boardIndex, match.boards.length - 1)], main = board ? withRecordedBiddingAgreement(replay(board.main), match?.legacy ? undefined : match?.config) : null;
  const reference = board?.reference ? withRecordedBiddingAgreement(replay(board.reference), match?.legacy ? undefined : match?.config) : null, complete = !!main && isFinished(main);
  const ready = complete && (match?.mode !== 'imp' || board?.referenceScoreNS !== null);
  const review = (game: GameState) => match && openAnalysis(game, `#/history/${encodeURIComponent(match.id)}`, { matchId: match.id, filter, page, boardIndex, view }, game === reference ? board?.referenceExplanations : board?.mainExplanations);
  const reviewButtons = ready && main ? <div className={styles.boardLinks}><button className={styles.secondary} onClick={() => review(main)}>主桌叫牌与出牌复盘 →</button>{reference && <button className={styles.secondary} onClick={() => review(reference)}>参考桌复盘 →</button>}</div> : null;
  return <section className={styles.page} data-testid="history-page">
    <div className={styles.heading}><div><a className={styles.back} href={matchId ? '#/history' : '#/home'}>← {matchId ? '全部历史' : '首页'}</a><h1>{match ? modeName(match.mode) : '历史牌局'}</h1></div><div className={styles.archiveActions}><button className={styles.secondary} onClick={() => void exportArchive()}>导出存档</button><button className={styles.secondary} onClick={() => void chooseImport()}>导入存档</button><input ref={file} type="file" accept=".json,application/json" aria-label="导入牌局存档" hidden onChange={async event => { const selected = event.target.files?.[0]; if (selected) { try { await importText(await selected.text()); } catch { setNotice('无法读取存档。'); } } if (file.current) file.current.value = ''; }} /></div></div>
    {notice && <Notice text={notice} onClose={() => setNotice('')} />}
    {loading ? <div className={styles.empty}>正在读取本地牌局…</div> : matchId ? match && board && main ? <>
      <div className={styles.matchSummary}><span>{match.status === 'completed' ? '已完成' : '未完成'} · 已结算 {match.completedBoards} 副{match.assisted && ' · 辅助练习'}</span><strong aria-label={match.mode === 'imp' ? '双方 IMP 比分' : undefined}>{match.mode === 'imp' ? `我方 ${ourImps} : ${theirImps} 对方 · 净 ${signed(match.totalImps)} IMP` : `${signed(match.totalScore)} 分`}</strong>{match.status !== 'completed' && !match.legacy && <button onClick={async () => { try { if (store.activeMatch?.id !== match.id) await store.resumeMatch(match.id); location.hash = '/table'; } catch (cause) { setNotice(cause instanceof Error ? cause.message : '无法继续这场牌局。'); } }}>继续比赛 →</button>}</div>
      <div className={styles.boardToolbar}><h2>第 {board.number} 副 <small>{ready ? '已结算' : complete ? '等待参考桌' : '未完成'}</small></h2><Pager page={Math.min(boardIndex, match.boards.length - 1)} count={match.boards.length} onChange={value => { setBoardIndex(value); setView('result'); saveHistoryNavigation(match.id, { boardIndex: value, view: 'result' }); }} label="副" /></div>
      <div className={styles.filters} aria-label="牌局详情视图">{(['result', 'main', ...(match.mode === 'imp' ? ['reference'] : []), 'info'] as const).map(tab => <button key={tab} disabled={tab !== 'result' && tab !== 'info' && !ready} aria-pressed={view === tab} onClick={() => { setView(tab as typeof view); saveHistoryNavigation(match.id, { view: tab as typeof view }); }}>{tab === 'result' ? '结果' : tab === 'main' ? '主桌叫牌' : tab === 'reference' ? '参考桌叫牌' : '比赛信息'}</button>)}</div>
      <article className={styles.boardRecord} data-testid="history-board">
        {view === 'info' ? <div className={styles.info}><h2>本场信息</h2><p>{dateLabel(match.createdAt)} · 软件 v{match.softwareVersion ?? '未记录'}</p><p>{match.legacy ? (main.biddingSystem ? SYSTEMS[main.biddingSystem].name : '逐副叫牌体系以各副原始记录为准，缺失时未知') : SYSTEMS[match.config.biddingSystem].name}</p><p>{match.mode === 'imp' ? `${match.boardCount} 副 · 双桌比赛` : '连续累计积分'} · {match.assisted ? '辅助练习' : '正常比赛'}</p>{match.legacy && !main.biddingSystem && <p>旧存档缺失的逐副体系和原始说明保持未知，不按当前设置推断。</p>}</div>
        : view === 'main' && ready ? <><HistoricalAuction key={`${board.number}-main`} game={main} system={match.legacy ? undefined : match.config.biddingSystem} explanations={board.mainExplanations} />{reviewButtons}</>
        : view === 'reference' && ready && reference ? <><HistoricalAuction key={`${board.number}-reference`} game={reference} system={match.legacy ? undefined : match.config.biddingSystem} explanations={board.referenceExplanations} />{reviewButtons}</>
        : ready ? <div className={styles.resultContent}><div className={styles.comparison}><div><small>主桌 · 南北原始分</small><strong>{signed(board.scoreNS ?? 0)}</strong><span>{main.contract ? <><ContractDisplay contract={main.contract} /> · {seatName[main.contract.declarer]}家庄 · {main.result?.declarerTricks} 墩{main.claim && ' · 声称'}</> : '四家 Pass · 流局'}</span></div>{match.mode === 'imp' && reference && <><div><small>参考桌 · 南北原始分</small><strong>{signed(board.referenceScoreNS ?? 0)}</strong><span>{reference.contract ? <><ContractDisplay contract={reference.contract} /> · {seatName[reference.contract.declarer]}家庄 · {reference.result?.declarerTricks} 墩{reference.claim && ' · 声称'}</> : '四家 Pass · 流局'}</span></div><div><small>主桌 − 参考桌</small><strong>{signed(board.imps ?? 0)} IMP</strong><span>分差 {signed(board.difference ?? 0)}</span></div></>}</div>{reviewButtons}</div> : <div className={styles.empty}><h2>{complete ? '等待参考桌结算' : '本副尚未结束'}</h2><p>结算后开放完整手牌、叫牌记录及复盘。</p></div>}
      </article>
    </> : <div className={styles.empty}><p>未找到这场牌局。</p><a href="#/history">返回历史列表 →</a></div> : <>
      <div className={styles.filters} aria-label="筛选比赛">{(['all', 'total', 'imp'] as const).map(mode => <button key={mode} aria-pressed={filter === mode} onClick={() => { setFilter(mode); setPage(0); saveHistoryNavigation(undefined, { filter: mode, page: 0 }); }}>{mode === 'all' ? '全部' : modeName(mode)}</button>)}</div>
      {!filtered.length ? <div className={styles.empty}><h2>{list.length ? '暂无此类比赛' : '牌局记录从第一场开始。'}</h2><p>比赛记录保存在本机。</p><a className={styles.primary} href="#/setup">开始打牌 →</a></div> : <div className={styles.matchList} style={{ gridTemplateRows: `repeat(${pageSize},minmax(0,1fr))` }}>{filtered.slice(page * pageSize, (page + 1) * pageSize).map(item => <a href={`#/history/${encodeURIComponent(item.id)}`} key={item.id} className={styles.matchItem}><div><span className={styles.kicker}>{item.status === 'completed' ? '已完成' : '未完成'}{item.assisted ? ' · 辅助练习' : ''}</span><h2>{modeName(item.mode)} <small>· {item.mode === 'imp' ? `${item.boardCount} 副` : `${item.completedBoards} 副`}</small></h2><p>{dateLabel(item.createdAt)}</p></div><div><strong>{item.mode === 'imp' ? `${signed(item.totalImps)} IMP` : `${signed(item.totalScore)} 分`}</strong><span>查看 →</span></div></a>)}</div>}
      <Pager page={page} count={pages} onChange={value => { setPage(value); saveHistoryNavigation(undefined, { page: value }); }} />
    </>}
  </section>;
}

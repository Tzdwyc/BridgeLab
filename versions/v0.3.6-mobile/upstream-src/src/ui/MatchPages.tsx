import { useEffect, useRef, useState } from 'react';
import { useGame } from '../controller/store';
import { isFinished, replay } from '../core/game';
import { SYSTEMS } from '../ai/systems';
import { type BiddingSystem } from '../ai/systems';
import { type PlayStrength } from '../ai/play-advisor-types';
import { describeCall } from '../ai/bidding';
import { type GameState, SEATS } from '../core/types';
import { openAnalysis } from '../analysis/navigation';
import { CallDisplay, ContractDisplay } from './SuitGlyph';
import { signed, seatName, callLabel } from './format';
import styles from './MatchPages.module.css';
import { nativeFiles } from '../platform/files';

type MatchData = NonNullable<ReturnType<typeof useGame.getState>['activeMatch']>;
type Summary = Awaited<ReturnType<ReturnType<typeof useGame.getState>['listMatches']>>[number];
const modeName = (mode: string) => mode === 'imp' ? '双桌 IMP' : '累计总分';
const dateLabel = (value: string | number) => new Date(value).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });

function HistoricalAuction({ game, system, legacy = false, explanations }: { game: GameState; system: BiddingSystem; legacy?: boolean; explanations?: string[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const offset = SEATS.indexOf(game.dealer);
  return <section className={styles.auction} aria-label="历史叫牌记录"><p>{legacy ? '归档时体系' : '本副体系'}：{SYSTEMS[system].name} · {legacy ? '点击叫品查看参考解释。' : '点击叫品查看当时的公开含义。'}</p>{game.auction.some((_, index) => explanations?.[index] === undefined) && <p>未保存原始说明，以下按当前引擎参考解读。</p>}<div className={styles.auctionGrid}>{SEATS.map(seat => <strong key={seat}>{seatName[seat]}{seat === game.dealer && <small> D</small>}</strong>)}{Array.from({ length: offset }, (_, index) => <span key={`empty-${index}`} />)}{game.auction.map((entry, index) => <button key={index} aria-label={`${seatName[entry.seat]} ${callLabel(entry.call)}`} onMouseEnter={() => setSelected(index)} onFocus={() => setSelected(index)} onClick={() => setSelected(index)} aria-pressed={selected === index}><CallDisplay call={entry.call} /></button>)}</div>{selected !== null && <p className={styles.auctionExplanation} role="tooltip">{explanations?.[selected] ?? describeCall(game.auction.slice(0, selected), game.auction[selected].seat, game.auction[selected].call, system)}</p>}</section>;
}

export function HomePage({ onSettings }: { onSettings: () => void }) {
  const { activeMatch: match, game } = useGame();
  const canContinue = !!game && (!match || match.status !== 'completed');
  return <section className={styles.home} data-testid="home-page">
    <div className={styles.hero}><span className={styles.kicker}>BRIDGELAB · 你的座位在南家</span><h1>入座，<br />专注下一手好牌。</h1><p>和机器人搭档，从叫牌到最后一墩。<br />选择一场比赛，也让每一副牌留下值得回看的记录。</p>
      <div className={styles.heroActions}><a className={styles.primary} href="#/setup">开始打牌 <span>→</span></a><a className={styles.secondary} href="#/history">历史牌局 <span>↗</span></a></div>
      {canContinue && <a href="#/table" className={styles.continue} data-testid="continue-match"><span>继续未完成的牌局</span><strong>{match ? `${modeName(match.mode)} · 第 ${match.currentBoard}${match.mode === 'imp' ? ` / ${match.boardCount}` : ''} 副${match.assisted ? ' · 辅助练习' : ''}` : `第 ${game.board} 副 · 单副练习`}</strong><span>回到牌桌 →</span></a>}
    </div>
    <div className={styles.homeCard}><div className={styles.suitArt} aria-hidden="true"><span>♠</span><span>♥</span><span>♣</span><span>♦</span></div><span className={styles.kicker}>一张牌桌，两种玩法</span><h2>打完一场，<br />再看懂一场。</h2><p>累计总分，记录南北方的原始得分。<br />双桌 IMP，同副牌与全机器人参考桌比较。</p><div className={styles.homeLinks}><a href="#/deals">牌例工作台 <span>→</span></a><a href="#/analysis">分析室 <span>→</span></a><button onClick={onSettings}>游戏设置 <span>→</span></button></div></div>
  </section>;
}

export function SetupPage() {
  const store = useGame();
  const [mode, setMode] = useState<'total' | 'imp'>('total');
  const [boardCount, setBoardCount] = useState<8 | 16 | 24>(16);
  const [assisted, setAssisted] = useState(false);
  const [system, setSystem] = useState<BiddingSystem>(store.biddingSystem);
  const [strength, setStrength] = useState<PlayStrength>('challenge');
  const [seed, setSeed] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const start = async () => {
    setBusy(true); setError('');
    try { await store.startMatch({ mode, boardCount, assisted: mode === 'total' || assisted, seed: seed.trim() || undefined, biddingSystem: system, playStrength: strength }); location.hash = '/table'; }
    catch (cause) { setError(cause instanceof Error ? cause.message : '牌局创建失败，请重试。'); }
    finally { setBusy(false); }
  };
  return <section className={styles.page} data-testid="setup-page"><a className={styles.back} href="#/home">← 返回首页</a><div className={styles.pageHeading}><span className={styles.kicker}>NEW MATCH</span><h1>开始一场牌局</h1><p>你坐南家。选择计分方式，其余交给牌桌。</p></div>
    <div className={styles.setupGrid}><div className={styles.setupForm}><fieldset className={styles.fieldset}><legend>比赛模式</legend><div className={styles.modeChoices}>
      <button aria-pressed={mode === 'total'} onClick={() => setMode('total')}><span>01</span><strong>累计总分</strong><small>你与 3 位机器人同桌，累计南北原始得分。</small></button>
      <button aria-pressed={mode === 'imp'} onClick={() => setMode('imp')}><span>02</span><strong>双桌 IMP</strong><small>你与 7 位机器人分坐两桌，同副牌比较计分。</small></button>
    </div></fieldset>{mode === 'imp' && <fieldset className={styles.fieldset}><legend>比赛副数</legend><div className={styles.boardChoices}>{([8, 16, 24] as const).map(count => <button key={count} aria-pressed={boardCount === count} onClick={() => setBoardCount(count)}>{count} 副{count === 16 && <small>默认</small>}</button>)}</div></fieldset>}
      {mode === 'imp' && <label className={styles.check}><input type="checkbox" checked={assisted} onChange={event => setAssisted(event.target.checked)} /><span><strong>辅助练习</strong><small>允许提示、悔牌与重打。历史记录会注明辅助练习。</small></span></label>}
      <details className={styles.seed}><summary>复现发牌（可选）</summary><label>随机种子<input aria-label="随机种子" value={seed} maxLength={200} onChange={event => setSeed(event.target.value)} placeholder="留空随机发牌" /></label></details>
    </div><aside className={styles.setupSummary}><span className={styles.kicker}>本场设置</span><h2>{modeName(mode)} <small>· {mode === 'imp' ? `${boardCount} 副` : '连续打牌'}</small></h2><dl><div><dt>叫牌体系</dt><dd><select aria-label="本场叫牌体系" value={system} onChange={event => setSystem(event.target.value as BiddingSystem)}><option value="sayc">SAYC＋2/1 进局逼叫＋RKCB 1430</option><option value="two-over-one">2/1 进局逼叫</option><option value="precision">精确制（暂缓完善）</option></select></dd></div><div><dt>打牌强度</dt><dd><select aria-label="本场打牌强度" value={strength} onChange={event => setStrength(event.target.value as PlayStrength)}><option value="challenge">挑战（默认）</option><option value="standard">标准</option><option value="basic">基础</option></select></dd></div><div><dt>比赛类型</dt><dd>{mode === 'total' ? '累计练习' : assisted ? '辅助练习' : '正常比赛'}</dd></div></dl><p>{mode === 'imp' && !assisted ? '正常 IMP 比赛不提供提示、悔牌与重打。主桌完成且参考桌结算后，才公开双桌结果与复盘。' : mode === 'imp' ? '参考桌独立完成同一副牌，双桌结束后公开结果。' : '连续打牌，累计南北方原始得分。随时结束并归档，每副完成后可回看叫牌和出牌。'}</p>{store.game && <p className={styles.archiveNote}>开始新比赛会将当前牌局归入历史，已有记录继续保留。</p>}{error && <p role="alert">{error}</p>}<button className={styles.primary} onClick={start} disabled={busy}>{busy ? '准备牌桌…' : '开始比赛'} <span>→</span></button></aside></div>
  </section>;
}

export function HistoryPage({ matchId }: { matchId?: string }) {
  const store = useGame(); const [list, setList] = useState<Summary[]>([]); const [match, setMatch] = useState<MatchData | null>(null); const [filter, setFilter] = useState<'all' | 'total' | 'imp'>('all');
  const [notice, setNotice] = useState(''); const [loading, setLoading] = useState(true); const file = useRef<HTMLInputElement>(null);
  const refresh = async () => { setLoading(true); try { setList(await store.listMatches()); if (matchId) setMatch(store.activeMatch?.id === matchId ? store.activeMatch : await store.getMatch(matchId)); else setMatch(null); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '历史记录暂不可读取。'); } finally { setLoading(false); } };
  useEffect(() => { void refresh(); }, [matchId, store.activeMatch]);
  const ourImps = match?.boards.reduce((total, board) => total + Math.max(0, board.imps ?? 0), 0) ?? 0;
  const theirImps = match?.boards.reduce((total, board) => total + Math.max(0, -(board.imps ?? 0)), 0) ?? 0;
  const exportArchive = async () => { setNotice(''); try { const raw = await store.exportMatches(); const filename = `BridgeLab-v0.3.6-牌局存档-${new Date().toISOString().slice(0, 10)}.json`; const native = nativeFiles(); if (native) { const saved = await native.saveFile(filename, raw); if (saved) setNotice('牌局存档已导出。'); return; } const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); setNotice('牌局存档已导出。'); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '导出失败。'); } };
  const importText = async (raw: string) => { try { const count = await store.importMatches(raw); setNotice(`已导入 ${count} 场牌局。`); await refresh(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '存档格式不正确，未导入。'); } };
  const importArchive = async (selected?: File) => { if (!selected) return; try { await importText(await selected.text()); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '无法读取存档。'); } if (file.current) file.current.value = ''; };
  const chooseImport = async () => { const native = nativeFiles(); if (!native) { file.current?.click(); return; } try { const selected = await native.openFile(); if (selected) await importText(selected.text); } catch (cause) { setNotice(cause instanceof Error ? cause.message : '无法打开存档。'); } };
  return <section className={styles.page} data-testid="history-page"><a className={styles.back} href={matchId ? '#/history' : '#/home'}>← {matchId ? '全部历史' : '返回首页'}</a><div className={styles.historyHeading}><div><span className={styles.kicker}>MATCH ARCHIVE</span><h1>{match ? modeName(match.mode) : '历史牌局'}</h1><p>{match ? `${match.mode === 'imp' ? `${match.boardCount} 副` : `已记录 ${match.boards.length} 副`}${match.assisted ? ' · 辅助练习' : ' · 正常比赛'} · 软件 v${match.softwareVersion ?? '未记录'} · ${SYSTEMS[match.config.biddingSystem].name}` : '每场比赛、每副牌，都可以回来再看。'}</p></div><div className={styles.archiveActions}><button className={styles.secondary} onClick={exportArchive}>导出存档</button><button className={styles.secondary} onClick={() => void chooseImport()}>导入存档</button><input ref={file} type="file" accept=".json,application/json" aria-label="导入牌局存档" hidden onChange={event => void importArchive(event.target.files?.[0])} /></div></div>
    {notice && <p role="status" className={styles.notice}>{notice}</p>}{loading ? <p>正在读取本地牌局…</p> : matchId ? match ? <><div className={styles.matchSummary}><span>{match.status === 'completed' ? '已完成' : '未完成'} · 第 {match.currentBoard}{match.mode === 'imp' ? ` / ${match.boardCount}` : ''} 副</span><strong aria-label={match.mode === 'imp' ? '双方 IMP 比分' : undefined}>{match.mode === 'imp' ? `我方 ${ourImps} : ${theirImps} 对方 · 净 ${signed(match.totalImps)} IMP` : `${signed(match.totalScore)} 分`}</strong>{match.status !== 'completed' && !match.legacy && <button className={styles.primary} onClick={async () => { try { if (store.activeMatch?.id !== match.id) await store.resumeMatch(match.id); location.hash = '/table'; } catch (cause) { setNotice(cause instanceof Error ? cause.message : '无法继续这场牌局。'); } }}>继续比赛 →</button>}</div>{match.legacy && <p className={styles.notice}>旧存档未逐副记录叫牌体系；说明按归档时体系解读，仅供参考。</p>}<div className={styles.boards}>{match.boards.map(board => {
      const main = replay(board.main); const complete = isFinished(main); const ready = complete && (match.mode !== 'imp' || board.referenceScoreNS !== null);
      return <article className={styles.boardRecord} key={board.number} data-testid="history-board"><div className={styles.boardRecordTitle}><h2>第 {board.number} 副</h2><span>{ready ? '已结算' : complete ? '等待参考桌结算' : '未完成'}</span></div>{ready ? <><div className={styles.comparison}><div><small>主桌 · 南北原始分</small><strong>{signed(board.scoreNS ?? 0)}</strong><span>{main.contract ? <><ContractDisplay contract={main.contract} /> · {seatName[main.contract.declarer]}家庄 · {main.result?.declarerTricks} 墩{main.claim && ' · 声称'}</> : '四家 Pass · 流局'}</span></div>{match.mode === 'imp' && board.reference && <><div><small>参考桌 · 南北原始分</small><strong>{signed(board.referenceScoreNS ?? 0)}</strong><span>{replay(board.reference).contract ? <><ContractDisplay contract={replay(board.reference).contract} /> · {seatName[replay(board.reference).contract!.declarer]}家庄 · {replay(board.reference).result?.declarerTricks} 墩{replay(board.reference).claim && ' · 声称'}</> : '四家 Pass · 流局'}</span></div><div><small>主桌 − 参考桌</small><strong>{signed(board.imps ?? 0)} IMP</strong><span>分差 {signed(board.difference ?? 0)}</span></div></>}</div><details className={styles.auctionDetails}><summary>主桌叫牌记录与解释</summary><HistoricalAuction game={main} system={match.config.biddingSystem} legacy={match.legacy} explanations={board.mainExplanations} /></details>{match.mode === 'imp' && board.reference && <details className={styles.auctionDetails}><summary>参考桌叫牌记录与解释</summary><HistoricalAuction game={replay(board.reference)} system={match.config.biddingSystem} legacy={match.legacy} explanations={board.referenceExplanations} /></details>}<div className={styles.boardLinks}><button className={styles.secondary} onClick={() => openAnalysis(main, `#/history/${encodeURIComponent(match.id)}`)}>主桌叫牌与出牌复盘 →</button>{match.mode === 'imp' && board.reference && <button className={styles.secondary} onClick={() => openAnalysis(replay(board.reference!), `#/history/${encodeURIComponent(match.id)}`)}>参考桌复盘 →</button>}</div></> : <p>{complete ? '主桌已完成。双桌结果就绪后可在这里比较与复盘。' : '本副尚未结束，完整手牌与复盘将在结算后开放。'}</p>}</article>;
    })}</div></> : <p>未找到这场牌局。请返回历史列表。</p> : <><div className={styles.filters} aria-label="筛选比赛">{(['all', 'total', 'imp'] as const).map(mode => <button key={mode} aria-pressed={filter === mode} onClick={() => setFilter(mode)}>{mode === 'all' ? '全部' : modeName(mode)}</button>)}</div>{!list.length ? <div className={styles.empty}><h2>牌局记录从第一场开始。</h2><p>完成的比赛和暂未打完的牌局都会保存在本机。</p><a className={styles.primary} href="#/setup">开始打牌 →</a></div> : <div className={styles.matchList}>{list.filter(item => filter === 'all' || item.mode === filter).map(item => <a href={`#/history/${encodeURIComponent(item.id)}`} key={item.id} className={styles.matchItem}><div><span className={styles.kicker}>{item.status === 'completed' ? '已完成' : '未完成'}{item.assisted ? ' · 辅助练习' : ''}</span><h2>{modeName(item.mode)} <small>· {item.mode === 'imp' ? `${item.boardCount} 副` : `已结算 ${item.completedBoards} 副`}</small></h2><p>{dateLabel(item.createdAt)}</p></div><div><strong>{item.mode === 'imp' ? `${signed(item.totalImps)} IMP` : `${signed(item.totalScore)} 分`}</strong><span>查看记录 →</span></div></a>)}</div>}</>}
  </section>;
}

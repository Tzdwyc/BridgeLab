import { ExplainedCall } from './ExplainedCall';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type Card, type Contract, type GameState, type Seat, type Strain, SUITS, STRAINS, SEATS, sideOf, isVulnerable } from '../core/types';
import { replay, toRecord } from '../core/game';
import { scoreContract } from '../core/scoring';
import { useGame, randomSeed, canReviewGame, eligibleCompletedGames } from '../controller/store';
import { analysisPosition, doubleDummyTableRequest } from '../analysis/adapter';
import { AnalysisClient, AnalysisCancelled } from '../analysis/client';
import { activeCursor, branchLine, changeAnalysisContract, exampleGame, EXAMPLES, moveCursor, openDocument, replayLine, tryCard, undoBranch, actualLoss, type AnalysisDocument } from '../analysis/model';
import { findSavedDocument, importDocument, loadDocument, saveDocument } from '../analysis/persistence';
import { takePendingDocument, analysisReturnHash } from '../analysis/navigation';
import { loadReviewState, saveReviewState } from '../analysis/review-state';
import { type DoubleDummyTableResult, type PositionResult } from '../analysis/types';
import { seatName, cardLabel, rankLabel, signed, vulnerabilityName, contractLabel } from './format';
import { CardLabel, CallDisplay, ContractDisplay, SuitGlyph } from './SuitGlyph';
import styles from './AnalysisPage.module.css';
import { nativeFiles } from '../platform/files';
import { SYSTEMS } from '../ai/systems';
import { historicalCallExplanation, historicalBidAdjustment } from '../ai/historical-bidding-presentation';
import { TransientNotice } from './TransientNotice';

const cx = (...names: (string | false | null | undefined)[]) => names.filter(Boolean).join(' ');
const resultDescription = (game: GameState, tricks: number) => {
  const difference = tricks - game.contract!.level - 6;
  return difference === 0 ? '成约' : difference > 0 ? `超 ${difference} 墩` : `宕 ${-difference} 墩`;
};
const projectedScore = (game: GameState, tricks: number) => scoreContract(game.contract!, tricks, isVulnerable(game.vulnerability, game.contract!.declarer)).total * (sideOf(game.contract!.declarer) === 'NS' ? 1 : -1);
const defaultDocument = () => {
  const ex = EXAMPLES[0]; return openDocument(exampleGame(ex.seed, ex.strain, ex.declarer, ex.board), ex.name);
};

const DD_TABLE_SEATS: Seat[] = ['N', 'S', 'E', 'W'];
const strainName: Record<Strain, string> = { C: '梅花', D: '方块', H: '红心', S: '黑桃', NT: '无将' };

function OriginalDoubleDummyTable({ result, contract, thinking, error, onRetry }: {
  result: DoubleDummyTableResult | null; contract: Contract | null; thinking: boolean; error: string | null; onRetry: () => void;
}) {
  return <section className={styles.ddTableCard} aria-labelledby="original-dd-table-title">
    <div className={styles.ddTableHeading}><div><h2 id="original-dd-table-title">原始牌局双明手结果</h2><p>数字为最高可成阶数 · — 表示不足 7 墩</p></div><span>{thinking ? '计算中…' : error ? '未完成' : '首攻前'}</span></div>
    <table className={styles.ddTable} data-testid="double-dummy-table">
      <caption>四家分别做庄时，五种定约的双明手最高可成阶数</caption>
      <thead><tr><th scope="col">庄家</th>{STRAINS.map(strain => <th scope="col" key={strain} aria-label={strainName[strain]}><SuitGlyph suit={strain} /></th>)}</tr></thead>
      <tbody>{DD_TABLE_SEATS.map(seat => <tr key={seat}><th scope="row"><span>{seat}</span><small>{seatName[seat]}</small></th>{STRAINS.map(strain => {
        const tricks = result?.table[seat][strain];
        const current = contract?.declarer === seat && contract.strain === strain;
        const level = tricks !== undefined && tricks >= 7 ? tricks - 6 : null;
        const description = tricks === undefined ? `${seatName[seat]}家做庄，${strainName[strain]}定约，等待计算` : `${current ? '当前实际定约，' : ''}${seatName[seat]}家做庄，${strainName[strain]}定约，双明手总赢墩 ${tricks}，${level === null ? '不足一阶' : `最高可成 ${level} 阶`}`;
        return <td key={strain} className={current ? styles.currentDd : undefined} data-dd-cell={`${seat}-${strain}`} data-current={current ? 'true' : undefined} data-tricks={tricks} aria-label={description} title={description}><strong>{tricks === undefined ? '…' : level ?? '—'}</strong>{current && <small className={styles.currentBadge}>当前</small>}</td>;
      })}</tr>)}</tbody>
    </table>
    {error && <div className={styles.ddTableError}><span>{error}</span><button onClick={onRetry}>重新计算</button></div>}
  </section>;
}

function AnalysisHand({ game, seat, result, onPlay, disabled, shown, onInspect }: { game: GameState; seat: Seat; result?: PositionResult; onPlay: (id: string) => void; disabled: boolean; shown: boolean; onInspect?: (seat: Seat) => void }) {
  const acting = (game.phase === 'play' || game.phase === 'auction') && game.turn === seat;
  const legal = acting && game.phase === 'play' ? analysisPosition(game).legalCards.map(c => c.id) : [];
  const role = seat === game.contract?.declarer ? '庄家' : seat === game.contract?.dummy ? '明手' : game.phase === 'auction' ? '初始手牌' : '防守';
  return <section className={cx(styles.hand, styles[`hand${seat}`], acting && styles.acting)} aria-label={`${seatName[seat]}家剩余手牌`} data-analysis-seat={seat} data-shown={shown} onClick={event => { if (onInspect && !(event.target as HTMLElement).closest('button')) onInspect(seat); }}>
    <div className={styles.handHeading}>{onInspect ? <button className={styles.inspectHand} data-testid={`analysis-inspect-${seat}`} aria-label={`放大${seatName[seat]}家手牌`} onClick={() => onInspect(seat)}><b><span>{seat}</span> {seatName[seat]}家</b><span className={styles.inspectHint}>放大</span></button> : <b><span>{seat}</span> {seatName[seat]}家</b>}<small>{role} · {game.hands[seat].length} 张</small>{acting && <em>行动中</em>}</div>
    {[...SUITS].reverse().map(suit => <div className={styles.suitRow} key={suit}><SuitGlyph suit={suit} /><div className={styles.rankCards}>{game.hands[seat].filter(c => c.suit === suit).map(card => {
      const candidate = result?.candidates.find(c => c.cardId === card.id);
      return <button key={card.id} data-analysis-card={card.id} data-optimal={candidate?.optimal ?? false} className={cx(styles.rankCard, candidate?.optimal && styles.optimalCard)} disabled={disabled || !legal.includes(card.id)} onClick={() => onPlay(card.id)} aria-label={`试打 ${seatName[seat]}家 ${cardLabel(card)}`} title={candidate ? `庄家 ${candidate.declarerTricks} 墩 · ${candidate.loss ? `损 ${candidate.loss} 墩` : '最优'}` : cardLabel(card)}>{rankLabel(card.rank)}</button>;
    })}{!game.hands[seat].some(c => c.suit === suit) && <span className={styles.void}>—</span>}</div></div>)}
  </section>;
}

function EvaluationGraph({ states, results, cursor, onJump }: { states: GameState[]; results: Record<string, PositionResult>; cursor: number; onJump: (index: number) => void }) {
  const points = states.map((state, index) => ({ index, value: results[analysisPosition(state).key]?.declarerTricks }));
  const known = points.filter((point): point is { index: number; value: number } => point.value !== undefined);
  const maxIndex = Math.max(1, states.length - 1);
  const ticks = [...new Set([0, Math.round(maxIndex / 4), Math.round(maxIndex / 2), Math.round(maxIndex * 3 / 4), states.length - 1])];
  const x = (index: number) => 28 + index * 506 / maxIndex; const y = (value: number) => 90 - value * 5.5;
  const segments: string[] = []; let current: string[] = [];
  for (const point of points) {
    if (point.value === undefined) { if (current.length) segments.push(current.join(' ')); current = []; }
    else current.push(`${x(point.index)},${y(point.value)}`);
  }
  if (current.length) segments.push(current.join(' '));
  return <div className={styles.graph}><div><b>庄家总赢墩走势</b><small>每张牌后的双明手值 · 虚线为成约目标</small></div><svg viewBox="0 0 560 110" aria-label="逐张双明手赢墩曲线">
    {[0, 6, 13].map(value => <g key={value}><line x1="28" x2="534" y1={y(value)} y2={y(value)} stroke="#e2e7df" /><text x="4" y={y(value) + 4}>{value}</text></g>)}
    <line x1="28" x2="534" y1={y(states[0].contract!.level + 6)} y2={y(states[0].contract!.level + 6)} stroke="#b99140" strokeDasharray="4 4" />
    {segments.map((segment, i) => <polyline key={i} points={segment} fill="none" stroke="#247354" strokeWidth="2" />)}
    <line x1={x(cursor)} x2={x(cursor)} y1="8" y2="93" stroke="#183c56" strokeWidth="1.5" />
    {known.map(point => <circle key={point.index} cx={x(point.index)} cy={y(point.value)} r={point.index === cursor ? 4.5 : 2.4} fill="#247354" onClick={() => onJump(point.index)}><title>已出 {point.index} 张 · 庄家 {point.value} 墩</title></circle>)}
    {ticks.map(index => <text key={index} x={x(index)} y="108" textAnchor="middle">{index}</text>)}
  </svg></div>;
}

export default function AnalysisPage() {
  useGame();
  const [view, setView] = useState<'tricks' | 'candidates' | 'dd' | 'routes' | 'notes'>('tricks');
  const [trickPage, setTrickPage] = useState(0);
  const [candidatePage, setCandidatePage] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [headerMenu, setHeaderMenu] = useState(false);
  const morePanel = useRef<HTMLDetailsElement>(null);
  const [focusedSeat, setFocusedSeat] = useState<Seat | null>(null);
  const [trialEnabled, setTrialEnabled] = useState(false);
  const [stepAnalysis, setStepAnalysis] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [tableRequested, setTableRequested] = useState(false);
  const [notePage, setNotePage] = useState(0);
  const [shortScreen, setShortScreen] = useState(() => window.matchMedia('(max-height: 500px)').matches);
  useEffect(() => { const media = window.matchMedia('(max-height: 500px)'); const update = () => setShortScreen(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const [initial] = useState(() => {
    try {
      const pending = takePendingDocument();
      const loaded = pending ? { document: pending, notice: null } : loadDocument(localStorage);
      return loaded.document && !canReviewGame(replay(loaded.document.source))
        ? { document: null, notice: '本副两桌尚未全部结束，结束后可以复盘。', pending: false } : { ...loaded, pending: !!pending };
    }
    catch { return { document: null, notice: '浏览器无法读取分析存档，本次仍可分析。', pending: false }; }
  });
  const [entry, setEntry] = useState<'home' | 'select' | 'review'>(() => initial.pending ? 'review' : 'home');
  const [document, setDocument] = useState<AnalysisDocument>(() => initial.document ?? defaultDocument());
  const [stage, setStage] = useState<'auction' | 'play'>(() => initial.document ? loadReviewState(initial.document.source).stage : 'auction');
  const [callCursor, setCallCursor] = useState(() => initial.document ? Math.min(loadReviewState(initial.document.source).auctionCursor, replay(initial.document.source).auction.length) : 0);
  const [hasResume, setHasResume] = useState(!!initial.document);
  useEffect(() => { saveReviewState(document.source, { stage, auctionCursor: callCursor, entry }); }, [document.source, stage, callCursor, entry]);
  const docRef = useRef(document); docRef.current = document;
  const [client] = useState(() => { try { return new AnalysisClient(localStorage); } catch { return new AnalysisClient(); } });
  const [results, setResults] = useState<Record<string, PositionResult>>({});
  const [tableResult, setTableResult] = useState<DoubleDummyTableResult | null>(null);
  const [tableThinking, setTableThinking] = useState(false);
  const [tableError, setTableError] = useState<string | null>(null);
  const [tableRetry, setTableRetry] = useState(0);
  const [notice, setNotice] = useState<string | null>(initial.notice);
  const [thinking, setThinking] = useState(false);
  const [job, setJob] = useState<'all' | 'optimal' | null>(null);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [retry, setRetry] = useState(0);
  const request = useRef<AbortController | null>(null); const runId = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const sourceGame = useMemo(() => replay(document.source), [document.source]);
  const original = useMemo(() => replayLine(document.source, document.analysisContract), [document.source, document.analysisContract]);
  const tableRequest = useMemo(() => doubleDummyTableRequest(original.states[0]), [original]);
  const branch = document.branches.find(b => b.id === document.activeBranch);
  const line = useMemo(() => branch ? branchLine(original, branch) : original, [original, branch]);
  const cursor = activeCursor(document); const game = line.states[cursor]; const position = analysisPosition(game);
  const result = results[position.key]; const nextPlay = line.plays[cursor];
  const candidateSize = shortScreen ? 2 : 4;
  const candidatePages = Math.max(1, Math.ceil((result?.candidates.length ?? 0) / candidateSize));
  const candidateIndex = Math.min(candidatePage, candidatePages - 1);
  const auctionGame = useMemo(() => replay({ ...document.source, actions: document.source.actions.filter(action => action.kind === 'call').slice(0, callCursor) }), [document.source, callCursor]);
  const selectedCall = sourceGame.auction[callCursor - 1];
  const displayedGame = stage === 'auction' ? auctionGame : game;
  useEffect(() => { setTrickPage(Math.min(12, Math.floor(cursor / 4))); setCandidatePage(0); }, [cursor, game.turn, document.activeBranch, document.source.seed]);
  const completedGames = eligibleCompletedGames();
  const originalCount = original.states.filter(state => results[analysisPosition(state).key]).length;
  const originalPositionCount = original.states.length;
  const originalPlayCount = original.plays.length;
  const sourcePassedOut = sourceGame.phase === 'passedOut';
  const sourceClaimed = !!sourceGame.claim;
  const allLosses = line.plays.map((play, index) => ({ side: sideOf(play.seat), value: actualLoss(line, index, results) }));
  const knownLosses = allLosses.filter(item => item.value !== null);
  const declarerSide = sideOf(game.contract!.declarer);
  const lossSum = (declaring: boolean) => knownLosses.filter(item => (item.side === declarerSide) === declaring).reduce((n, item) => n + item.value!, 0);

  const commit = (next: AnalysisDocument) => {
    docRef.current = next; setDocument(next);
    try { saveDocument(localStorage, next); return true; }
    catch { setNotice('自动保存失败，请导出分析文件。'); return false; }
  };
  const remember = (answer: PositionResult) => setResults(previous => ({ ...previous, [answer.key]: answer }));
  const stop = (message = '已停止，已计算的结果和试打进度保留。') => {
    runId.current++; request.current?.abort(); request.current = null; client.cancel();
    setJob(null); setThinking(false); setPlaying(false); if (message) setNotice(message);
  };
  const jump = (point: number) => { setPlaying(false); commit(moveCursor(docRef.current, point)); };
  const switchDocument = (next: AnalysisDocument) => {
    if (!canReviewGame(replay(next.source))) { setNotice('本副两桌尚未全部结束，结束后可以复盘。'); return; }
    stop(''); setResults({}); setNotice(null); setProgress(0); setFocusedSeat(null); setJumpOpen(false); setHeaderMenu(false); setHasResume(true); setEntry('review'); setStage('auction'); setCallCursor(0); setTrialEnabled(false); setStepAnalysis(false); setMoreOpen(false); setTableRequested(false); const savedReview = loadReviewState(next.source); if (savedReview.auctionCursor > 0 || next.cursor > 0 || next.activeBranch) { setStage(savedReview.stage); setCallCursor(Math.min(savedReview.auctionCursor, replay(next.source).auction.length)); } return commit(next);
  };
  const selectSource = (id: string) => {
    const ex = EXAMPLES.find(ex => ex.id === id);
    const source = ex ? exampleGame(ex.seed, ex.strain, ex.declarer, ex.board) : completedGames.find(g => `${g.board}:${g.seed}` === id);
    if (!source) return;
    let next = openDocument(source, ex?.name);
    try { next = findSavedDocument(localStorage, toRecord(source)) ?? next; } catch { /* The selection still works in memory. */ }
    switchDocument(next);
  };

  useEffect(() => {
    try { if (hasResume) saveDocument(localStorage, docRef.current); } catch { setNotice('自动保存失败，请导出分析文件。'); }
    const open = () => { const pending = takePendingDocument(); if (pending) switchDocument(pending); };
    window.addEventListener('bridgelab-open-analysis', open);
    return () => { request.current?.abort(); client.dispose(); window.removeEventListener('bridgelab-open-analysis', open); };
  }, [client]);
  useEffect(() => {
    const cached: Record<string, PositionResult> = {};
    for (const state of [...original.states, ...line.states]) {
      const answer = client.peek(analysisPosition(state)); if (answer) cached[answer.key] = answer;
    }
    setResults(previous => ({ ...previous, ...cached }));
  }, [client, original, line]);
  useEffect(() => {
    if (!tableRequested || entry !== 'review') { setTableThinking(false); return; }
    const tableClient = new AnalysisClient(); const controller = new AbortController(); let live = true;
    setTableResult(previous => previous?.key === tableRequest.key ? previous : null); setTableThinking(true); setTableError(null);
    tableClient.solveTable(tableRequest, controller.signal).then(answer => {
      if (live) { setTableResult(answer); setTableThinking(false); setTableError(null); }
    }).catch(error => {
      if (live) { setTableThinking(false); setTableError(error instanceof AnalysisCancelled ? '计算已停止，可重试。' : '计算未完成，请重试。'); }
    });
    return () => { live = false; controller.abort(); tableClient.dispose(); };
  }, [tableRequest, tableRetry, tableRequested, entry]);
  useEffect(() => {
    if (job || playing || !stepAnalysis || entry !== 'review' || stage !== 'play') { if (!job) setThinking(false); return; }
    const controller = new AbortController(); request.current = controller; let live = true;
    setThinking(!client.peek(position));
    client.solve(position, controller.signal).then(answer => { if (live) { remember(answer); setThinking(false); } }).catch(error => {
      if (live) { setThinking(false); if (!(error instanceof AnalysisCancelled)) setNotice('当前位置计算未完成，请重试。'); }
    });
    return () => { live = false; controller.abort(); };
  }, [position.key, client, job, playing, retry, stepAnalysis, entry, stage]);
  useEffect(() => {
    if (!playing || entry !== 'review') return;
    const timer = window.setInterval(() => {
      if (stage === 'auction') { setCallCursor(current => { if (current >= sourceGame.auction.length) { setPlaying(false); return current; } return current + 1; }); return; }
      const current = docRef.current; const index = activeCursor(current);
      if (index >= line.states.length - 1) { setPlaying(false); return; }
      commit(moveCursor(current, index + 1));
    }, 700);
    return () => window.clearInterval(timer);
  }, [playing, line.states.length, stage, sourceGame.auction.length, entry]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest('input, select, textarea, button, a') || job || entry !== 'review') return;
      if (stage === 'auction') { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setPlaying(false); setCallCursor(value => Math.max(0, Math.min(sourceGame.auction.length, value + (event.key === 'ArrowLeft' ? -1 : 1)))); } return; }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); jump(activeCursor(docRef.current) + (event.key === 'ArrowLeft' ? -1 : 1)); }
      if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); jump(event.key === 'Home' ? 0 : line.states.length - 1); }
    };
    window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key);
  }, [job, line.states.length, entry, stage, sourceGame.auction.length]);

  const play = (cardId: string) => {
    if (job || !trialEnabled || stage !== 'play') return; setPlaying(false);
    try { commit(tryCard(docRef.current, cardId, randomSeed())); setNotice(null); }
    catch (error) { setNotice((error as Error).message); }
  };
  const calculateAll = async () => {
    stop(''); const id = ++runId.current; const controller = new AbortController(); request.current = controller;
    setJob('all'); setProgress(0); setNotice(null); const started = Date.now();
    try {
      for (let i = 0; i < original.states.length; i++) {
        if (controller.signal.aborted) throw new AnalysisCancelled();
        if (Date.now() - started > 180000) throw new Error('整副分析已达到 3 分钟限制，已算结果保留；可再次点击继续。');
        const answer = await client.solve(analysisPosition(original.states[i]), controller.signal);
        if (id !== runId.current) return;
        remember(answer); setProgress(i + 1); await new Promise(resolve => setTimeout(resolve, 0));
      }
      setNotice(sourceClaimed
        ? `声称前 ${originalPositionCount} 个实际位置已全部分析，时间线在声称处截断。`
        : sourcePassedOut
          ? '四家 Pass 的首攻前假设位置已完成分析；可选择定约后创建试打分支。'
          : '原局 53 个位置已全部分析。损墩按每张牌统计，同一墩双方的损墩不会互相抵消。');
    } catch (error) { if (id === runId.current && !(error instanceof AnalysisCancelled)) setNotice(error instanceof Error && /^(整副分析已达到|自动续打达到)/.test(error.message) ? error.message : '分析未完成，已完成的进度已保留。请重试。'); }
    finally { if (id === runId.current) { setJob(null); setThinking(false); request.current = null; } }
  };
  const optimalContinuation = async () => {
    if (!trialEnabled) return;
    stop(''); const id = ++runId.current; const controller = new AbortController(); request.current = controller;
    setJob('optimal'); setNotice(null); let next = docRef.current; const started = Date.now();
    try {
      for (let guard = 0; guard < 52; guard++) {
        if (controller.signal.aborted) throw new AnalysisCancelled();
        if (Date.now() - started > 180000) throw new Error('自动续打达到 3 分钟限制，试打进度已保留。');
        const currentLine = next.activeBranch ? branchLine(original, next.branches.find(b => b.id === next.activeBranch)!) : original;
        const current = currentLine.states[activeCursor(next)]; if (current.phase === 'complete') break;
        const answer = await client.solve(analysisPosition(current), controller.signal);
        if (id !== runId.current) return;
        remember(answer); const card = answer.candidates.find(c => c.optimal); if (!card) throw new Error('没有可续打的合法最优牌');
        next = tryCard(next, card.cardId, randomSeed()); commit(next); setProgress(activeCursor(next));
        await new Promise(resolve => setTimeout(resolve, 15));
      }
      setNotice('试打已完成 13 墩。每步选取一张最优牌；存在等价方案时，这只是其中一条路线。');
    } catch (error) { if (id === runId.current && !(error instanceof AnalysisCancelled)) setNotice(error instanceof Error && /^(整副分析已达到|自动续打达到)/.test(error.message) ? error.message : '分析未完成，已完成的进度已保留。请重试。'); }
    finally { if (id === runId.current) { setJob(null); setThinking(false); request.current = null; } }
  };
  const exportFile = async () => {
    const raw = JSON.stringify(docRef.current, null, 2), filename = `BridgeLab-v3-board-${document.source.board}-analysis.json`;
    try {
      const bridge = nativeFiles();
      if (bridge) { if (await bridge.saveFile(filename, raw)) setNotice('分析文件已保存。'); return; }
      const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
      const link = window.document.createElement('a'); link.href = url; link.download = filename; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setNotice(`导出失败：${error instanceof Error ? error.message : '无法保存文件'}`); }
  };
  const chooseImport = async () => {
    const bridge = nativeFiles();
    if (!bridge) { fileInput.current?.click(); return; }
    try {
      const selected = await bridge.openFile(); if (!selected) return;
      if (selected.text.length > 2_000_000) throw new Error('请选择小于 2 MB 的 JSON 文件');
      const next = importDocument(selected.text);
      if (!canReviewGame(replay(next.source))) throw new Error('本副两桌尚未全部结束，结束后可以复盘。');
      if (switchDocument(next)) setNotice('已导入。');
    } catch (error) { setNotice(error instanceof Error ? error.message : '导入失败'); }
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    try { if (file.size > 2_000_000) throw new Error('请选择小于 2 MB 的 JSON 文件'); const next = importDocument(await file.text()); if (!canReviewGame(replay(next.source))) throw new Error('本副两桌尚未全部结束，结束后可以复盘。'); if (switchDocument(next)) setNotice('已导入。'); }
    catch (error) { setNotice((error as Error).message); }
    if (fileInput.current) fileInput.current.value = '';
  };
  const makeAnotherBranch = () => {
    if (document.branches.length >= 12) { setNotice('最多保存 12 条试打分支，请先删除一条。'); return; }
    const index = activeCursor(document); if (index >= 52) return;
    const id = randomSeed(); const start = branch && index >= branch.start ? branch.start : index;
    const cards = branch && index >= branch.start ? branch.cards.slice(0, index - branch.start) : [];
    commit({ ...document, activeBranch: id, branches: [...document.branches, { id, name: `试打 ${document.branches.length + 1}`, start, cards, cursor: index }] });
  };

  const updateHypothesis = (level: number, strain: Strain, declarer: Seat) => { switchDocument(changeAnalysisContract(docRef.current, level, strain, declarer)); setStage('play'); setMoreOpen(true); setView('routes'); };
  const returnOriginal = () => { setPlaying(false); setTrialEnabled(false); commit({ ...docRef.current, activeBranch: null, cursor: Math.min(activeCursor(docRef.current), originalPlayCount) }); };
  const changeStage = (next: 'auction' | 'play') => { setPlaying(false); setJumpOpen(false); setHeaderMenu(false); setStage(next); setView('tricks'); setMoreOpen(false); };
  const step = stage === 'auction' ? callCursor : cursor;
  const lastStep = stage === 'auction' ? sourceGame.auction.length : line.states.length - 1;
  const seek = (point: number) => { setPlaying(false); if (stage === 'auction') setCallCursor(Math.max(0, Math.min(lastStep, point))); else jump(point); };
  const originalNext = original.plays[cursor];
  const originalNextCard = originalNext ? original.states[0].initialHands[originalNext.seat].find(card => card.id === originalNext.cardId) : null;
  const openAdvanced = (key: typeof view) => { setHeaderMenu(false); setMoreOpen(true); setView(key); if (key === 'candidates') { setPlaying(false); setStage('play'); } window.setTimeout(() => morePanel.current?.scrollIntoView({ block: 'start' }), 0); };
  const returnOrigin = analysisReturnHash(document.source);
  const returnLink = returnOrigin === '#/analysis'
    ? <button data-testid="analysis-return-origin" onClick={() => { stop(''); setEntry('home'); }}>← 返回分析室</button>
    : <a data-testid="analysis-return-origin" href={returnOrigin}>← 返回原副</a>;
  const importInput = <input ref={fileInput} aria-label="导入分析文件" type="file" accept=".json,application/json" hidden onChange={event => void importFile(event.target.files?.[0])} />;
  const title = <div className={styles.titleRow}><div><span className={styles.eyebrow}>REVIEW STUDIO</span><h1>分析室</h1></div><div className={styles.fileActions}>{entry !== 'home' && <button data-testid="analysis-home" onClick={() => { stop(''); setEntry('home'); }}>分析室首页</button>}{returnLink}</div></div>;
  if (entry !== 'review') return <section className={styles.page} data-testid="analysis-page" data-entry={entry}>
    {title}{notice && <TransientNotice text={notice} onClose={() => setNotice(null)} />}
    {entry === 'home' ? <div className={styles.landing} data-testid="analysis-landing"><h2>从一副牌开始复盘</h2><p>跟着叫牌与打牌逐步回看，在想比较的位置开始试打。</p><div className={styles.entryCards}>
      <button data-testid="analysis-continue" onClick={() => setEntry('review')} disabled={!hasResume}><b>继续上次复盘</b><span>{hasResume ? `${document.name} · ${stage === 'auction' ? `已叫 ${callCursor} 次` : `已出 ${cursor} 张`}` : '选择一副牌后，会记住复盘进度'}</span></button>
      <button data-testid="analysis-select" onClick={() => setEntry('select')}><b>选择牌局</b><span>已结束的历史牌局与固定示例牌</span></button>
      <a data-testid="analysis-library" href="#/deals/library"><b>牌例库</b><span>建立、保存与管理自己的牌例</span></a>
    </div></div> : <section className={styles.selection} data-testid="analysis-source-selection"><h2>选择牌局</h2><a className={styles.historySourceLink} data-testid="analysis-choose-history" href="#/history">从历史牌局选择 →</a><p>下方列出当前可复盘的已结束牌局；完整存档可从历史牌局选择，两桌未全部结束的牌局暂不开放。</p><h3>已结束的对局</h3>{!completedGames.length && <p>暂无已结束牌局，可先选择下方示例牌。</p>}<div className={styles.sourceChoices}>{completedGames.map(g => <button key={`${g.board}:${g.seed}`} data-testid={`analysis-select-source-${g.board}`} onClick={() => selectSource(`${g.board}:${g.seed}`)}>第 {g.board} 副 · {g.contract ? `${contractLabel(g.contract)} · ${seatName[g.contract.declarer]}家庄${g.claim ? ' · 声称' : ''}` : '四家 Pass'}</button>)}</div><h3>固定示例牌</h3><div className={styles.sourceChoices}>{EXAMPLES.map(ex => <button key={ex.id} data-testid={`analysis-example-${ex.id}`} onClick={() => selectSource(ex.id)}>{ex.name}</button>)}</div></section>}
  </section>;
  return <section className={styles.page} data-testid="analysis-page" data-entry="review" data-stage={stage} data-cursor={cursor} data-call-cursor={callCursor} data-trial={trialEnabled} data-branch={document.activeBranch ?? 'original'} data-results={originalCount}>
    <div className={styles.reviewScroller}>
    <header className={styles.compactHeader}>{returnLink}<button className={styles.sourceTitle} data-testid="analysis-change-source" title={document.name} onClick={() => { stop(''); setEntry('select'); }}>第 {document.source.board} 副{EXAMPLES.some(example => example.seed === document.source.seed) ? ' · 示例' : ''} ▾<small className={styles.landscapeContract}>{sourcePassedOut ? '四家 Pass' : contractLabel(game.contract!)} · {vulnerabilityName[game.vulnerability]}</small></button><div className={styles.headerMenuHost}><button data-testid="analysis-more-menu" aria-expanded={headerMenu} onClick={() => setHeaderMenu(!headerMenu)}>更多</button>{headerMenu && <div className={styles.headerMenu} role="menu"><button data-testid="analysis-home" onClick={() => { stop(''); setHeaderMenu(false); setEntry('home'); }}>分析室首页</button><button onClick={() => { stop(''); setHeaderMenu(false); setEntry('select'); }}>选择牌局</button>{([['tricks','逐墩记录'],['candidates','候选牌'],['dd','双明手表'],['routes','路线'],['notes','结果与走势']] as const).map(([key,label]) => <button key={key} onClick={() => openAdvanced(key)}>{label}</button>)}<button onClick={() => { setHeaderMenu(false); void chooseImport(); }}>导入存档</button><button onClick={() => { setHeaderMenu(false); void exportFile(); }}>导出分析</button><button disabled={!!job} onClick={() => { setHeaderMenu(false); void calculateAll(); }}>计算整副 {originalPositionCount} 个位置</button></div>}</div></header>
    <div className={styles.compactMeta}><span>{sourcePassedOut ? '四家 Pass · 假设定约' : <><ContractDisplay contract={game.contract} /> · {seatName[game.contract!.declarer]}家庄</>} · {vulnerabilityName[game.vulnerability]}</span><span data-testid="analysis-mode">{branch ? `${branch.name} · 试打` : trialEnabled ? '准备试打' : '原局 · 只读'}</span></div>
    <div className={styles.reviewToolbar}><nav className={styles.stageTabs} role="tablist" aria-label="复盘阶段">{([['auction','叫牌'],['play','打牌']] as const).map(([key,label]) => <button key={key} role="tab" aria-selected={stage === key} data-testid={`analysis-stage-${key}`} onClick={() => changeStage(key)}>{label}</button>)}</nav>
    <div className={styles.reviewMode}><b>{branch ? `${branch.name} · 试打路线` : trialEnabled ? '准备试打 · 原局保留' : '原局回放 · 只读'}</b>{stage === 'play' && <div>{!trialEnabled && <button className={styles.primary} data-testid="analysis-start-trial" disabled={!!job || game.phase === 'complete'} onClick={() => { setPlaying(false); setTrialEnabled(true); }}>从这里试打</button>}{(branch || trialEnabled) && <button data-testid="analysis-return-original" disabled={!!job} onClick={returnOriginal}>返回原局 · 同一步</button>}</div>}</div></div>
    {(job || thinking || tableThinking) && <div className={styles.workStatus} role="status"><span className={styles.spinner} /><span>{tableThinking ? '双明手表计算中…' : job === 'all' ? `原局分析中 · ${progress} / ${originalPositionCount}` : job === 'optimal' ? `最优续打中 · 已出 ${cursor} / 52 张` : '当前位置计算中…'}</span>{!tableThinking && <button onClick={() => stop()}>取消计算</button>}</div>}
    {notice && <TransientNotice text={notice} tone={/^(已停止|分析文件已保存|已导入)/.test(notice) ? 'status' : 'error'} closeLabel="关闭分析提示" onClose={() => setNotice(null)} />}
    <div className={styles.reviewContent} data-testid="analysis-active-panel" data-view={stage}>
      {stage === 'auction' && <section className={styles.auctionPanel} data-testid="analysis-auction"><div className={styles.panelHeading}><h2>原局叫牌</h2><span data-testid="analysis-auction-turn">{callCursor === sourceGame.auction.length ? '叫牌结束' : `${seatName[auctionGame.turn]}家行动`} · {callCursor} / {sourceGame.auction.length}</span></div><div className={styles.auctionGrid} role="grid" aria-label="完整四列叫牌表">{SEATS.map(seat => <b key={seat} role="columnheader">{seatName[seat]}</b>)}{Array.from({ length: SEATS.indexOf(sourceGame.dealer) }, (_, index) => <span key={`blank-${index}`} />)}{sourceGame.auction.map((entry,index) => <ExplainedCall key={index} asChild contextKey={JSON.stringify([sourceGame.board, sourceGame.seed, sourceGame.biddingSystem, sourceGame.agreementVersion, sourceGame.auction.slice(0, index + 1), document.biddingExplanations?.[index]])} explanation={() => historicalCallExplanation(sourceGame, index, document.biddingExplanations?.[index])}><button role="gridcell" data-testid={`analysis-call-${index + 1}`} aria-selected={callCursor === index + 1} data-future={index >= callCursor} onClick={() => seek(index + 1)}><small>{index + 1} · {seatName[entry.seat]}家</small><CallDisplay call={entry.call} /></button></ExplainedCall>)}</div><div className={styles.callExplanation} data-testid="analysis-call-explanation">{selectedCall ? <><b>{seatName[selectedCall.seat]}家 <CallDisplay call={selectedCall.call} /></b><p>{historicalCallExplanation(sourceGame, callCursor - 1, document.biddingExplanations?.[callCursor - 1])}</p>{(() => { const action = document.source.actions.filter(action => action.kind === 'call')[callCursor - 1]; return action?.kind === 'call' && action.robotBid ? <p>原建议 <CallDisplay call={action.robotBid.baselineCall} />。{historicalBidAdjustment(action.robotBid.reason)}。</p> : null; })()}</> : <p>从发牌人开始，点击叫品或“下一叫”逐步回看。</p>}</div><p data-testid="analysis-bidding-system">{sourceGame.biddingSystem ? `${SYSTEMS[sourceGame.biddingSystem].name} · ${sourceGame.agreementVersion ?? '约定版本未记录'}` : '原叫牌体系未知'}</p>{callCursor === sourceGame.auction.length && <button className={styles.primary} data-testid="analysis-go-play" onClick={() => changeStage('play')}>进入打牌回放 →</button>}</section>}
      <div className={styles.boardColumn}>
        <div className={styles.boardHeading}><div><h2 data-testid="analysis-position-label">{stage === 'auction' ? `${seatName[auctionGame.turn]}家${auctionGame.phase === 'auction' ? '行动' : ' · 叫牌结束'}` : game.phase === 'complete' ? '13 墩已完成' : `第 ${Math.floor(cursor / 4) + 1} 墩 · 第 ${game.currentTrick.length + 1} 张出牌前`}</h2>{stage === 'play' && <p className={styles.nextOriginal} data-testid="analysis-original-next">{originalNext && originalNextCard ? <>原局下一张 {seatName[originalNext.seat]}家 <CardLabel card={originalNextCard} /></> : sourceClaimed ? '原局在此声称，实际出牌记录到此结束' : sourcePassedOut ? '原局四家 Pass，无实际出牌' : '原局打牌已结束'}</p>}</div><strong data-testid="analysis-step">{step} / {lastStep}</strong></div>
        <div className={styles.fourHands} data-testid="analysis-table-workspace">{SEATS.map(seat => <AnalysisHand key={seat} game={displayedGame} seat={seat} result={stage === 'play' && stepAnalysis ? result : undefined} shown={true} onInspect={setFocusedSeat} onPlay={play} disabled={stage !== 'play' || !trialEnabled || !!job || playing} />)}{stage === 'play' && <div className={styles.table} aria-label="分析牌桌"><small>{game.phase === 'complete' ? '最后一墩' : `第 ${game.completedTricks.length + 1} 墩 · ${game.currentTrick.length} 张已出`}</small><div className={styles.tableCards}>{(game.currentTrick.length ? game.currentTrick : game.completedTricks.at(-1)?.plays ?? []).map(play => <div key={play.seat} className={styles[`played${play.seat}`]}><small>{seatName[play.seat]}</small><CardLabel card={play.card} /></div>)}</div><div className={styles.trickCount}><span>南北 <b>{game.tricksWon.NS}</b></span><span>东西 <b>{game.tricksWon.EW}</b></span></div></div>}</div>
        {stage === 'play' && !branch && sourceClaimed && <p className={styles.analysisCutoff} data-testid="claim-analysis-cutoff">原局已出 {originalPlayCount} 张后声称，回放在此截断；试打使用独立路线。</p>}
        {stage === 'play' && !branch && sourcePassedOut && <p className={styles.analysisCutoff} data-testid="passed-out-analysis-start">原局四家 Pass，无实际打牌。可在“更多分析 → 路线”设置假设定约。</p>}
      </div>
    </div>
    {stage === 'play' && <details className={styles.stepDetails} onToggle={event => { if (!event.currentTarget.open) setStepAnalysis(false); }}><summary>本步分析 <span>{result ? '已有结果' : '按需计算'}</span></summary><button data-testid="analysis-calculate-step" onClick={() => { setStepAnalysis(true); setRetry(value => value + 1); }} disabled={!!job || thinking}>计算当前位置</button>{stepAnalysis && <p>{result ? `庄家总赢墩 ${result.declarerTricks} · ${resultDescription(game, result.declarerTricks)}；行动方 ${result.candidates.length} 张合法牌。` : thinking ? '正在计算…' : '尚未完成计算。'}</p>}</details>}
    <details ref={morePanel} className={styles.moreAnalysis} open={moreOpen} onToggle={event => setMoreOpen(event.currentTarget.open)}><summary>更多分析</summary><nav className={styles.advancedTabs} aria-label="更多分析项目">{([['tricks','逐墩记录'],['candidates','候选牌'],['dd','双明手表'],['routes','路线'],['notes','结果与走势']] as const).map(([key,label]) => <button key={key} aria-pressed={view === key} data-testid={`analysis-view-${key}`} onClick={() => { setView(key); if (key === 'candidates') { setPlaying(false); setStage('play'); } }}>{label}</button>)}</nav><div className={styles.fileActions}><button onClick={() => void chooseImport()}>导入存档</button><button onClick={() => void exportFile()}>导出分析</button><button onClick={() => void calculateAll()} disabled={!!job}>计算整副 {originalPositionCount} 个位置</button></div>{importInput}
    <div className={styles.advancedContent}>{moreOpen && <>
      {view === 'tricks' && <>
      <aside className={styles.timeline}><div className={styles.panelHeading}><h2>逐墩记录</h2><span>{branch ? branch.name : '原局'}</span></div>
        {[trickPage].map(trick => {
          const start = trick * 4; const plays = line.plays.slice(start, start + 4); const losses = plays.map((_, offset) => actualLoss(line, start + offset, results));
          const errors = losses.filter(loss => loss !== null && loss > 0).length;
          const winner = line.states[Math.min(start + 4, line.states.length - 1)].completedTricks[trick]?.winner;
          const isExpanded = true;
          return <div key={trick} className={cx(styles.trick, Math.floor(Math.min(cursor, 51) / 4) === trick && styles.selectedTrick)}>
            <div className={styles.trickHeading}><b>{String(trick + 1).padStart(2, '0')}</b><span>{winner ? `${seatName[winner]}家赢` : plays.length ? '未完墩' : '尚未试打'}</span>{errors > 0 && <em>{errors} 处损墩</em>}</div>
            {isExpanded && plays.map((play, offset) => {
              const card = original.states[0].initialHands[play.seat].find(c => c.id === play.cardId)!; const loss = losses[offset]; const idx = start + offset;
              return <button key={idx} data-testid={`timeline-card-${idx}`} className={cx(styles.traceCard, cursor === idx && styles.selectedCard)} onClick={() => jump(idx)} disabled={!!job}><span>{seatName[play.seat]}</span><CardLabel card={card} /><span className={loss !== null && loss > 0 ? styles.loss : styles.good}>{loss === null ? '待分析' : loss ? `损 ${loss} 墩` : '最优'}</span></button>;
            })}
          </div>;
        })}
        {!branch && sourceClaimed && <div className={styles.analysisCutoff} data-testid="claim-analysis-cutoff"><strong>声称截断</strong><span>原局在已出 {originalPlayCount} 张后声称；其后没有伪造出牌记录。</span></div>}
        {!branch && sourcePassedOut && <div className={styles.analysisCutoff} data-testid="passed-out-analysis-start"><strong>四家 Pass</strong><span>原局没有打牌记录。到“更多分析”的“路线”中选择假设定约后，可从首攻开始试打。</span></div>}
        <nav className={styles.pagination} aria-label="逐墩记录分页"><button disabled={trickPage === 0} onClick={() => jump((trickPage - 1) * 4)}>上一墩</button><span>第 {trickPage + 1} / 13 墩</span><button disabled={trickPage === 12 || (trickPage + 1) * 4 > line.states.length - 1} onClick={() => jump((trickPage + 1) * 4)}>下一墩</button></nav>
      </aside>
      </>}
      {view === 'candidates' && <section className={styles.evaluation}>
        <div className={styles.candidateHeading}><h3>全部合法牌</h3><span>{result?.candidates.length ?? position.legalCards.length} 张</span></div>
        <div className={styles.candidateLabels}><span>出牌 / 试打</span><span>庄家总墩</span><span>行动方损墩</span></div>
        <div className={styles.candidates} data-testid="candidates">{result?.candidates.slice(candidateIndex * candidateSize, (candidateIndex + 1) * candidateSize).map(candidate => {
          const card: Card = game.hands[game.turn].find(c => c.id === candidate.cardId)!;
          return <button key={candidate.cardId} data-candidate={candidate.cardId} data-loss={candidate.loss} data-tricks={candidate.declarerTricks} data-optimal={candidate.optimal} className={cx(styles.candidate, candidate.optimal && styles.bestCandidate)} disabled={!!job || playing || !trialEnabled} aria-label={`候选 ${cardLabel(card)}，庄家 ${candidate.declarerTricks} 墩，损 ${candidate.loss} 墩`} onClick={() => play(candidate.cardId)}><CardLabel card={card} /><b>{candidate.declarerTricks}</b><span className={candidate.loss ? styles.loss : styles.good}>{candidate.loss ? `−${candidate.loss}` : '最优'}</span></button>;
        })}{!result && <p className={styles.pending}>{thinking ? '计算中…' : '结果尚未计算。'}<button onClick={() => { setNotice(null); setStepAnalysis(true); setRetry(n => n + 1); }}>重新计算当前</button></p>}{game.phase === 'complete' && <p className={styles.pending}>最后一张已打完，完整 13 墩已计分。</p>}</div>
        <nav className={styles.pagination} aria-label="候选牌分页"><button disabled={candidateIndex === 0} onClick={() => setCandidatePage(candidateIndex - 1)}>上一页</button><span>{candidateIndex + 1} / {candidatePages}</span><button disabled={candidateIndex + 1 === candidatePages} onClick={() => setCandidatePage(candidateIndex + 1)}>下一页</button></nav>
        <button className={styles.primary} disabled={!!job || game.phase === 'complete' || !trialEnabled} onClick={() => void optimalContinuation()}>按最优牌续打至结束 →</button>      </section>}
      {view === 'dd' && <div className={styles.ddView}>
    {!tableRequested && <button className={styles.primary} onClick={() => setTableRequested(true)}>计算原始牌局双明手表</button>}
    <div className={styles.overviewRow}>
      <OriginalDoubleDummyTable result={tableResult?.key === tableRequest.key ? tableResult : null} contract={game.contract} thinking={tableThinking} error={tableError} onRetry={() => { setTableRequested(true); setTableRetry(value => value + 1); }} />
      <div className={styles.summaryStrip}><div><small>{sourcePassedOut ? '假设位置分析' : sourceClaimed ? '声称前原局分析' : '原局分析'}</small><strong data-testid="analysis-progress">{originalCount} / {originalPositionCount}</strong></div><div><small>庄家方双明手损墩</small><strong>{knownLosses.length ? lossSum(true) : '—'}</strong></div><div><small>防守方双明手损墩</small><strong>{knownLosses.length ? lossSum(false) : '—'}</strong></div><p>{knownLosses.length} / {line.plays.length} 张已评估。双明手损墩基于四家全知，不能直接等同于实战错误。</p></div>
    </div>
      </div>}
      {view === 'routes' && <section className={styles.routes}><h2>试打路线与假设定约</h2>
    {sourcePassedOut && <div className={styles.hypothesisBar} data-testid="passed-out-analysis-controls"><strong>四家 Pass：选择假设定约继续逐墩试打</strong><label>阶数<select aria-label="假设定约阶数" value={game.contract!.level} disabled={!!job} onChange={event => updateHypothesis(Number(event.target.value), game.contract!.strain, game.contract!.declarer)}>{Array.from({ length: 7 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label><label>花色<select aria-label="假设定约花色" value={game.contract!.strain} disabled={!!job} onChange={event => updateHypothesis(game.contract!.level, event.target.value as Strain, game.contract!.declarer)}>{STRAINS.map(strain => <option key={strain} value={strain}>{strainName[strain]}</option>)}</select></label><label>庄家<select aria-label="假设定约庄家" value={game.contract!.declarer} disabled={!!job} onChange={event => updateHypothesis(game.contract!.level, game.contract!.strain, event.target.value as Seat)}>{SEATS.map(seat => <option key={seat} value={seat}>{seatName[seat]}家</option>)}</select></label></div>}
        <div className={styles.branchBar}><label>路线<select aria-label="试打路线" value={document.activeBranch ?? 'original'} disabled={!!job} onChange={event => { setPlaying(false); setTrialEnabled(false); commit({ ...document, activeBranch: event.target.value === 'original' ? null : event.target.value, cursor: Math.min(cursor, originalPlayCount) }); }}><option value="original">{sourcePassedOut ? '假设定约 · 首攻前' : sourceClaimed ? '原局 · 声称处截断' : '原局 · 保留实际打牌'}</option>{document.branches.map(b => <option key={b.id} value={b.id}>{b.name} · 从第 {b.start + 1} 张开始</option>)}</select></label><button onClick={() => { setTrialEnabled(false); makeAnotherBranch(); }} disabled={!!job || cursor === 52}>新建分支</button>{branch && <><button onClick={() => { setPlaying(false); commit(undoBranch(document)); }} disabled={!!job || !branch.cards.length || cursor <= branch.start}>撤回试打一张</button><button onClick={() => { setPlaying(false); returnOriginal(); }} disabled={!!job}>返回原局</button><button className={styles.deleteBranch} disabled={!!job} onClick={() => commit({ ...document, activeBranch: null, branches: document.branches.filter(b => b.id !== branch.id) })}>删除分支</button></>}</div>
        {branch && <div className={styles.comparison} data-testid="branch-comparison"><div><small>{sourcePassedOut ? '原局结果' : sourceClaimed ? '声称结算结果' : '原局实际结果'}</small><b>{sourcePassedOut ? '四家 Pass · 南北 0 分' : `${sourceGame.result!.declarerTricks} 墩 · 南北 ${signed(sourceGame.result!.scoreNS)}`}</b></div><div><small>{game.phase === 'complete' ? '试打实际结果' : '试打后最优应对的预计结果'}</small><b>{game.phase === 'complete' ? `${game.result!.declarerTricks} 墩 · 南北 ${signed(game.result!.scoreNS)}` : result ? `${result.declarerTricks} 墩 · 南北 ${signed(projectedScore(game, result.declarerTricks))}` : '尚未计算'}</b></div></div>}
        <p className={styles.routeHelp}>先点“从这里试打”，再点行动方手牌。新建分支、撤回或返回原局均保留原始记录，最多保存 12 条路线。</p>
      </section>}
      {view === 'notes' && <section className={styles.notesPanel}><nav className={styles.noteTabs} role="tablist" aria-label="结果与说明分页">{['当前位置', '损墩解读', '计分与续打', '计算状态', '赢墩走势'].map((label, index) => <button key={label} role="tab" aria-selected={notePage === index} onClick={() => setNotePage(index)}>{label}</button>)}</nav>{notePage === 0 ? <>
        <div className={styles.value}><small>庄家最终总赢墩 · 包含已赢墩</small><strong data-testid="dd-value">{result?.declarerTricks ?? (game.phase === 'complete' ? game.result!.declarerTricks : '—')}<span> / 13</span></strong><p>{result ? `${resultDescription(game, result.declarerTricks)} · 南北预计 ${signed(projectedScore(game, result.declarerTricks))} 分` : game.phase === 'complete' ? resultDescription(game, game.result!.declarerTricks) : '等待本地求解结果'}</p></div>
        <div className={styles.actualChoice}><small>{branch ? '分支记录中的下一张' : sourcePassedOut ? '假设定约' : '原局实际选择'}</small>{nextPlay ? <><b>{seatName[nextPlay.seat]}家 <CardLabel card={original.states[0].initialHands[nextPlay.seat].find(c => c.id === nextPlay.cardId)!} /></b><span>{actualLoss(line, cursor, results) === null ? '待分析' : actualLoss(line, cursor, results) === 0 ? '双明手最优' : `双明手损 ${actualLoss(line, cursor, results)} 墩`}</span></> : <p>{game.phase === 'complete' ? '本副打牌已结束。' : !branch && sourceClaimed ? '原局在此声称，实际出牌时间线到此为止；可创建分支继续试打。' : !branch && sourcePassedOut ? '原局四家 Pass。当前是首攻前的假设定约，点击“从这里试打”后选择一张牌。' : '分支到达新位置，可选择一张牌继续。'}</p>}</div>
      </> : notePage === 1 ? <article><h2>如何解读双明手损墩</h2><p>庄家方希望总赢墩最大，防守方希望庄家总赢墩最小。候选牌的损墩从行动方视角计算。</p><p>结果假设四家牌全知且此后双方最优，不能直接评判真实牌桌上的概率决策或隐蔽信息判断。</p></article> : notePage === 2 ? <article><h2>计分与最优续打</h2><p>预计得分按本副定约、加倍状态与局况计算，是复式原始分，没有 IMP／MP 比较。</p><p className={styles.methodNote}>续打双方均按双明手最优出牌。并列最优全部保留，自动续打选择其中一条路线。</p>
<p>点击“从这里试打”后，选择行动方手牌可创建或继续试打。绿色边框表示最优牌；暗淡牌受行动次序或跟牌规则限制。</p></article> : notePage === 4 ? <EvaluationGraph states={line.states} results={results} cursor={cursor} onJump={jump} /> : <article><h2>计算状态</h2><p>{originalCount} / {originalPositionCount} 个原局位置已分析。{knownLosses.length} / {line.plays.length} 张已评估。</p><p>庄家方损墩：{knownLosses.length ? lossSum(true) : '—'}；防守方损墩：{knownLosses.length ? lossSum(false) : '—'}。</p><p>{sourcePassedOut ? '四家 Pass，无实际打牌。分支页可设置假设定约。' : sourceClaimed ? `原局在已出 ${originalPlayCount} 张后声称，实际出牌记录在此截断。` : `原局实得 ${sourceGame.result!.declarerTricks} 墩。`}</p></article>}</section>}
    </>}</div></details>
    </div><div className={styles.transport} data-testid="analysis-transport"><div className={styles.transportButtons}><button aria-label={stage === 'auction' ? '上一叫' : '上一张'} disabled={!!job || step === 0} onClick={() => seek(step - 1)}>{stage === 'auction' ? '上一叫' : '上一张'}</button><button data-testid="analysis-play-pause" aria-label={playing ? '暂停回放' : '自动回放'} disabled={!!job || (!playing && step >= lastStep)} onClick={() => setPlaying(!playing)}>{playing ? '暂停' : '播放'}</button><button aria-label={stage === 'auction' ? '下一叫' : '下一张'} disabled={!!job || step >= lastStep} onClick={() => seek(step + 1)}>{stage === 'auction' ? '下一叫' : '下一张'}</button></div><button className={styles.jumpButton} data-testid="analysis-open-jump" aria-label="打开回放跳转" aria-expanded={jumpOpen} onClick={() => setJumpOpen(!jumpOpen)}>{stage === 'auction' ? `${step}/${lastStep} 叫` : `第 ${Math.min(13, Math.floor(cursor / 4) + 1)} 墩`} ▴</button></div>
    {jumpOpen && <div className={styles.jumpBackdrop} onClick={() => setJumpOpen(false)}><section role="dialog" aria-modal="true" aria-label="回放跳转" className={styles.jumpDialog} onClick={event => event.stopPropagation()} onKeyDown={event => { if (event.key === 'Escape') setJumpOpen(false); }}><div className={styles.panelHeading}><h2>回放跳转</h2><button autoFocus aria-label="关闭回放跳转" onClick={() => setJumpOpen(false)}>关闭</button></div>{stage === 'play' && <label className={styles.jumpTrick}>跳至<select aria-label="跳到第几墩" data-testid="analysis-jump-trick" value={Math.min(13, Math.floor(cursor / 4) + 1)} disabled={!!job} onChange={event => { jump((Number(event.target.value) - 1) * 4); setJumpOpen(false); }}>{Array.from({ length: Math.min(13, Math.floor(lastStep / 4) + 1) }, (_,index) => <option value={index + 1} key={index}>第 {index + 1} 墩</option>)}</select></label>}<label className={styles.sliderLabel}><input aria-label={stage === 'auction' ? '叫牌位置' : '打牌位置'} type="range" min={0} max={lastStep} value={step} disabled={!!job} onChange={event => seek(Number(event.target.value))} /><span>{step} / {lastStep}</span></label><div className={styles.jumpEnds}><button aria-label={stage === 'auction' ? '回到叫牌前' : '回到首攻前'} disabled={!!job || step === 0} onClick={() => { seek(0); setJumpOpen(false); }}>起点</button><button disabled={!!job || step >= lastStep} onClick={() => { seek(lastStep); setJumpOpen(false); }}>结束</button></div></section></div>}
    {focusedSeat && <div className={styles.handBackdrop} role="presentation" onKeyDown={event => { if (event.key === 'Escape') setFocusedSeat(null); }} onClick={() => setFocusedSeat(null)}><section role="dialog" aria-modal="true" aria-label={`${seatName[focusedSeat]}家完整手牌`} className={styles.handDialog} onClick={event => event.stopPropagation()}><div className={styles.panelHeading}><h2>{seatName[focusedSeat]}家完整手牌</h2><button autoFocus aria-label="关闭放大手牌" onClick={() => setFocusedSeat(null)}>关闭</button></div><AnalysisHand game={displayedGame} seat={focusedSeat} result={stage === 'play' && stepAnalysis ? result : undefined} shown={true} onPlay={id => { play(id); setFocusedSeat(null); }} disabled={stage !== 'play' || !trialEnabled || !!job || playing} /><p>{stage === 'play' && trialEnabled ? '点击亮牌试打；暗淡牌受行动次序或跟牌规则限制。' : '只读查看手牌。'}</p></section></div>}
  </section>;
}

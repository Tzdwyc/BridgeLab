import { biddingNotices } from '../ai/bidding-notices';
import { CallNoticeCards } from './CallNoticeCards';
import { ExplainedCall } from './ExplainedCall';
import { useEffect, useRef, useState } from 'react';
import { SYSTEMS, type BiddingSystem } from '../ai/systems';
import { describeCall } from '../ai/bidding';
import { sameCall } from '../core/auction';
import { SEATS, STRAINS, sideOf, type Call, type Seat } from '../core/types';
import { type RoomAction, type RoomSnapshot } from '../online/protocol';
import { type useLanRoom } from '../online/useLanRoom';
import { seatName, signed, vulnerabilityName } from './format';
import { CallDisplay, CardLabel, ContractDisplay } from './SuitGlyph';
import { TableSurface, CardHand, SeatStation, CurrentTrick } from './TableSurface';
import { TrickScoreMeter, type TrickScoreSummary } from './TrickScore';
import { TableReviewControls } from './TableReviewControls';
import styles from './LanRoomPage.module.css';
import { TransientNotice } from './TransientNotice';
import { liveLanActionNotice } from '../controller/user-action-notice';

type LanRoom = ReturnType<typeof useLanRoom>;
const seatStatus = { empty: '空位', connected: '在线', disconnected: '已离线', robot: '机器人' };
const specialCalls = [
  { kind: 'pass', label: '不叫' },
  { kind: 'double', label: '加倍' },
  { kind: 'redouble', label: '再加倍' },
] as const;

function LobbyControls({ snapshot, room }: { snapshot: RoomSnapshot; room: LanRoom }) {
  const [confirmRevision, setConfirmRevision] = useState<number | null>(null);
  const confirmRobots = confirmRevision === snapshot.revision;
  const ready = snapshot.readiness[snapshot.seat];
  const openSeats = SEATS.filter(seat => snapshot.seats[seat] === 'empty');
  const allPlayersReady = SEATS.every(seat => snapshot.seats[seat] === 'empty' ||
    (snapshot.seats[seat] === 'connected' && snapshot.readiness[seat]));
  const canAct = room.status === 'connected' && !room.busy;
  return <>
    <p>{openSeats.length ? '可以继续等人。已入座玩家全部在线并准备后，房主也可以确认由机器人补齐空位。' : '四家都在线并准备后自动开局。'}</p>
    <div className={styles.actions}>
      <button type="button" className={styles.primary} disabled={!canAct} onClick={() => room.send({ kind: 'ready', ready: !ready })}>{ready ? '取消准备' : '准备'}</button>
      {room.isHost && openSeats.length > 0 && !confirmRobots &&
        <button type="button" disabled={!canAct || !allPlayersReady} onClick={() => setConfirmRevision(snapshot.revision)}>机器人补位开局</button>}
    </div>
    {confirmRobots && <section className={styles.confirmRobots} aria-label="确认机器人补位">
      <p>当前有 {openSeats.length} 个空位（{openSeats.map(seat => `${seatName[seat]}家`).join('、')}）。由机器人补齐并开始牌局吗？</p>
      <div className={styles.actions}>
        <button type="button" onClick={() => setConfirmRevision(null)}>继续等人</button>
        <button type="button" className={styles.primary} disabled={!canAct} onClick={() => room.send({ kind: 'startWithRobots' })}>确认补位并开局</button>
      </div>
    </section>}
  </>;
}

function Auction({ snapshot, send }: { snapshot: RoomSnapshot; send: ((action: RoomAction) => void) | null }) {
  const legal = snapshot.legalCalls;
  const lowest = legal.reduce((value, call) => call.kind === 'bid' ? Math.min(value, call.level) : value, 8);
  const minimumLevel = lowest === 8 ? 1 : lowest;
  const [level, setLevel] = useState(minimumLevel);
  useEffect(() => { setLevel(value => Math.max(value, minimumLevel)); }, [minimumLevel]);
  const canCall = (call: Call) => !!send && legal.some(candidate => sameCall(candidate, call));
  return <section className={`${styles.panel} ${styles.bidder}`} aria-label="叫牌">
    <h2>叫牌</h2>
    <div className={`${styles.callRow} ${styles.levelChoices}`} aria-label="选择阶数">
      {[1, 2, 3, 4, 5, 6, 7].map(value => <button key={value} type="button" aria-pressed={level === value} onClick={() => setLevel(value)}>{value}</button>)}
    </div>
    <div className={styles.callRow} aria-label="选择花色">
      {STRAINS.map(strain => {
        const call: Call = { kind: 'bid', level, strain };
        return <ExplainedCall key={strain} asChild contextKey={JSON.stringify([snapshot.roomCode, snapshot.board, snapshot.biddingSystem, snapshot.agreementVersion, snapshot.auction, snapshot.seat, call])} explanation={() => describeCall(snapshot.auction, snapshot.seat, call, snapshot.biddingSystem)}><button type="button" className={styles.bidWithNotice} aria-label={`叫 ${level}${strain}`} disabled={!canCall(call)} onClick={() => send?.({ kind: 'call', call })}><CallDisplay call={call} /><CallNoticeCards notices={canCall(call) ? biddingNotices(snapshot.auction, snapshot.seat, call, snapshot.biddingSystem) : []} compact /></button></ExplainedCall>;
      })}
    </div>
    <div className={styles.callRow}>
      {specialCalls.map(({ kind, label }) => <ExplainedCall key={kind} asChild contextKey={JSON.stringify([snapshot.roomCode, snapshot.board, snapshot.biddingSystem, snapshot.agreementVersion, snapshot.auction, snapshot.seat, kind])} explanation={() => describeCall(snapshot.auction, snapshot.seat, { kind }, snapshot.biddingSystem)}><button type="button" disabled={!canCall({ kind })} onClick={() => send?.({ kind: 'call', call: { kind } })}>{label}</button></ExplainedCall>)}
    </div>
  </section>;
}

function AuctionHistoryCall({ snapshot, index }: { snapshot: RoomSnapshot; index: number }) {
  const entry = snapshot.auction[index];
  return <ExplainedCall asChild
    contextKey={JSON.stringify([snapshot.roomCode, snapshot.board, snapshot.biddingSystem, snapshot.agreementVersion, snapshot.auction.slice(0, index + 1)])}
    explanation={() => describeCall(snapshot.auction.slice(0, index), entry.seat, entry.call, snapshot.biddingSystem)}>
    <td data-auction-index={index} data-seat={entry.seat} tabIndex={0}><span className={styles.historyCallWithNotice}><CallDisplay call={entry.call} /><CallNoticeCards notices={biddingNotices(snapshot.auction.slice(0, index), entry.seat, entry.call, snapshot.biddingSystem)} compact /></span></td>
  </ExplainedCall>;
}

function AuctionHistory({ snapshot }: { snapshot: RoomSnapshot }) {
  const history = useRef<HTMLDivElement>(null);
  const pinnedToLatest = useRef(true);
  useEffect(() => { const element = history.current; if (element && pinnedToLatest.current) element.scrollTop = element.scrollHeight; }, [snapshot.auction.length]);
  const start = SEATS.indexOf(snapshot.dealer);
  const orderedSeats = [...SEATS.slice(start), ...SEATS.slice(0, start)];
  return <div className={styles.auctionHistory} ref={history} role="region" aria-label="完整叫牌记录" data-testid="lan-auction-history" tabIndex={0} onScroll={() => { const element = history.current; if (element) pinnedToLatest.current = element.scrollHeight - element.scrollTop - element.clientHeight < 20; }}>
    <table aria-label="叫牌记录">
      <thead><tr>{orderedSeats.map(seat => <th key={seat} scope="col">{seatName[seat]}家</th>)}</tr></thead>
      <tbody>{Array.from({ length: Math.ceil(snapshot.auction.length / 4) }, (_, row) => <tr key={row}>
        {orderedSeats.map((seat, col) => {
          const entry = snapshot.auction[row * 4 + col];
          const index = row * 4 + col;
          return entry ? <AuctionHistoryCall key={`${snapshot.board}:${snapshot.biddingSystem}:${JSON.stringify(snapshot.auction.slice(0, index + 1))}`} snapshot={snapshot} index={index} /> : <td key={seat}>·</td>;
        })}
      </tr>)}</tbody>
    </table>
    {!snapshot.auction.length && <p>本副尚无叫牌记录。</p>}
  </div>;
}

/** Only snapshot-visible cards are rendered. Compass labels always remain real seats. */
function Table({ snapshot, room }: { snapshot: RoomSnapshot; room: LanRoom }) {
  const { board, dealer, vulnerability, phase, contract, turn, controller, currentTrick, completedTricks, result, dummy, seat } = snapshot;
  const active = room.status === 'connected' && snapshot.status === 'active';
  const send = active && !room.busy ? room.send : null;
  const playable = (handSeat: Seat) => send && phase === 'play' && controller === seat && turn === handSeat
    ? (cardId: string) => { if (snapshot.legalCardIds.includes(cardId)) send({ kind: 'play', cardId }); }
    : undefined;
  const southIndex = SEATS.indexOf(seat);
  const at = (position: Seat): Seat => SEATS[(southIndex + SEATS.indexOf(position) + 2) % 4];
  const positionForSeat = Object.fromEntries(SEATS.map(position => [at(position), position])) as Record<Seat, Seat>;
  const vulnerable = (handSeat: Seat) => vulnerability === 'Both' || vulnerability === (handSeat === 'N' || handSeat === 'S' ? 'NS' : 'EW');
  const station = (position: Seat) => {
    const handSeat = at(position), mine = handSeat === seat, visibleDummy = dummy?.seat === handSeat;
    const cards = mine ? snapshot.hand : visibleDummy ? dummy!.hand : [];
    const recentCall = snapshot.auction.findLast(entry => entry.seat === handSeat)?.call;
    const title = `${mine ? '我的手牌 · ' : visibleDummy ? '明手 · ' : ''}${seatName[handSeat]}家${mine && visibleDummy ? '明手' : ''}`;
    return <SeatStation seat={handSeat} position={position} label={`${seatName[handSeat]}家${mine ? ' · 你' : ''}`}
      detail={visibleDummy ? '明手' : seatStatus[snapshot.seats[handSeat]]} call={phase === 'auction' && recentCall ? <CallDisplay call={recentCall} /> : undefined} active={active && turn === handSeat} vulnerable={vulnerable(handSeat)}>
      <CardHand cards={cards} seat={handSeat} position={position} isDummy={!!visibleDummy} label={title} hidden={!mine && !visibleDummy}
        hiddenCount={snapshot.handCounts[handSeat]} active={phase === 'play' && active && controller === seat && turn === handSeat} legalCardIds={snapshot.legalCardIds}
        onPlay={playable(handSeat)} meta={mine && phase === 'play' ? <span role="status"><span data-card-count>{cards.length} 张 · </span>{active ? turnText.replace('轮到', '').replace('家明手', '家') : '连接恢复后继续'}</span>
          : mine || visibleDummy ? <><span data-card-count>{cards.length} 张{controller === seat && turn === handSeat && !mine ? ' · ' : ''}</span>{controller === seat && turn === handSeat && !mine ? '由你代打' : ''}</> : undefined} />
    </SeatStation>;
  };
  const lastTrick = completedTricks.at(-1);
  const declarerSide = contract ? sideOf(contract.declarer) : null;
  const settled = phase === 'complete' && !!result && declarerSide !== null;
  let ns = snapshot.tricksWon.NS, ew = snapshot.tricksWon.EW;
  if (settled && result) {
    ns = declarerSide === 'NS' ? result.declarerTricks : 13 - result.declarerTricks;
    ew = 13 - ns;
  }
  const remaining = settled ? 0 : Math.max(0, 13 - ns - ew);
  const target = contract ? contract.level + 6 : null;
  const declarerWon = declarerSide === 'NS' ? ns : ew;
  const score: TrickScoreSummary = { ns, ew, remaining, target, declarerSide, settled,
    outcome: target === null ? '' : declarerWon >= target ? '已确保成约'
      : declarerWon + remaining < target ? '已确定宕约' : `还需 ${target - declarerWon} 墩成约` };
  const robotController = snapshot.seats[controller] === 'robot';
  const turnText = phase === 'complete' || phase === 'passedOut' ? '本副已结束'
    : controller === seat ? turn === seat ? '轮到你行动' : `轮到你代打${seatName[turn]}家明手`
    : robotController && controller !== turn ? `轮到${seatName[controller]}家机器人代打${seatName[turn]}家明手`
    : `轮到${seatName[turn]}家${robotController ? '机器人' : ''}${phase === 'auction' ? '叫牌' : '出牌'}`;
  const panel = <>
    {phase === 'auction' && <section className={styles.turnPanel} aria-label="当前行动"><span className={styles.kicker}>叫牌中</span>
      <h2 role="status">{active ? turnText : '连接恢复后继续牌局'}</h2>
    </section>}
    {phase === 'auction' && <Auction key={board} snapshot={snapshot} send={send} />}
    {result && <section className={styles.panel} aria-label="本副结算"><h2>本副结算</h2>
      <p>{phase === 'passedOut' ? '四家不叫 · 流局' : `庄家获得 ${result.declarerTricks} 墩`}</p>
      <p className={styles.score}>南北 {signed(result.scoreNS)} <small>分</small></p><p>东西 {signed(-result.scoreNS)} 分</p>
      <button type="button" className={styles.primary} disabled={!send || !snapshot.canNextBoard} onClick={() => send?.({ kind: 'nextBoard' })}>下一副 →</button>
      {!snapshot.canNextBoard && <p>等待房主开启下一副。</p>}
    </section>}
    {phase !== 'auction' && <TableReviewControls resetKey={board} history={<AuctionHistory snapshot={snapshot} />}
      lastTrick={lastTrick ? <><p>上墩 · {seatName[lastTrick.winner]}家赢得</p><div className={styles.lastTrick}>
        {lastTrick.plays.map(play => <span key={play.seat}>{seatName[play.seat]} <CardLabel card={play.card} /></span>)}
      </div></> : null} />}
  </>;
  return <div className={styles.tableWrap} aria-label="局域网牌桌" data-testid="lan-table-view">
    <TableSurface className={styles.liveTable} testId="lan-bridge-table" phase={phase} north={station('N')} east={station('E')} west={station('W')} south={station('S')}
      summary={<div className={styles.feltSummary} data-playing={phase === 'play' || undefined}><div className={styles.feltHeading}><span>第 {board} 副 · {seatName[dealer]}家发牌</span>
        {phase === 'play' && contract && <span data-contract-summary><ContractDisplay contract={contract} /> · {seatName[contract.declarer]}家庄</span>}<span>{vulnerabilityName[vulnerability]}</span></div></div>}
      score={phase !== 'auction' && contract ? <TrickScoreMeter score={score} contract={contract} statusLabel={settled ? '本副已结算' : undefined} /> : undefined}
      auctionHistory={phase === 'auction' ? <section className={styles.liveHistory} aria-label="常驻叫牌记录"><div className={styles.liveHistoryHeading}><h2>叫牌记录</h2><span>{snapshot.auction.length} 次叫牌</span></div><AuctionHistory snapshot={snapshot} /></section> : undefined}
      center={<div className={styles.tableCenter}>{contract && phase !== 'play' && <span className={styles.contract} data-contract-summary><ContractDisplay contract={contract} /> · {seatName[contract.declarer]}家庄</span>}
        {phase === 'play' ? <CurrentTrick plays={currentTrick} positionForSeat={positionForSeat} label={active ? turnText.replace('轮到', '').replace('家明手', '家') : '连接恢复后继续'} /> : <div className={styles.centerMark}>
          <span aria-hidden="true">♠</span><p>{phase === 'auction' ? '四方入座，开始叫牌' : phase === 'passedOut' ? '四家不叫' : '本副完成'}</p>
        </div>}
      </div>} panel={panel} />
  </div>;
}

export default function LanRoomPage({ room }: { room: LanRoom }) {
  const [seat, setSeat] = useState<Seat>('S');
  const [system, setSystem] = useState<BiddingSystem>('two-over-one');
  const [address, setAddress] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copyStatus, setCopyStatus] = useState('');
  const [dismissedError, setDismissedError] = useState('');
  useEffect(() => { if (!room.error || room.busy) setDismissedError(''); }, [room.error, room.busy]);
  const copyValue = async (value: string, label: string) => {
    try { await navigator.clipboard.writeText(value); setCopyStatus(`${label}已复制`); }
    catch { setCopyStatus('自动复制不可用，请长按房间码或地址复制。'); }
  };
  const { snapshot } = room;
  const started = !!snapshot && snapshot.status !== 'waiting';
  const errorNotice = started ? liveLanActionNotice(room.error) : room.error;
  const leave = () => {
    setConfirmLeave(false);
    void room.leave();
  };
  const requestLeave = () => {
    if (snapshot && snapshot.status !== 'waiting') setConfirmLeave(true);
    else leave();
  };
  return <section className={styles.page} data-started={started} data-room-status={snapshot?.status} data-phase={snapshot?.phase} aria-label="局域网联机">
    <div className={styles.topline}>
      <div><p className={styles.kicker}>BRIDGELAB · 四人桥牌</p><h1>{started ? '四人牌桌' : '局域网联机'}</h1></div>
      {room.status === 'connecting' && <span className={styles.badge} role="status">正在连接…</span>}
    </div>
    {errorNotice && room.error !== dismissedError && <TransientNotice text={errorNotice} tone="error" onClose={() => setDismissedError(room.error ?? '')} />}
    {!started && copyStatus && <TransientNotice text={copyStatus} tone={copyStatus.includes('已复制') ? 'status' : 'error'} onClose={() => setCopyStatus('')} />}
    {room.canResume && room.status !== 'connected' && <div className={styles.panel}>
      <p>恢复连接后可回到原座位。请确认设备仍连接同一 Wi-Fi，房主应用保持打开。</p>
      <div className={styles.actions}><button type="button" className={styles.primary} disabled={room.busy} onClick={() => room.resume()}>重新连接</button>
      <button type="button" disabled={room.busy} onClick={requestLeave}>离开房间</button></div>
    </div>}
    {!snapshot && (!room.canResume || room.status === 'connected') && <section className={styles.panel} aria-label="创建或加入房间">
      <h2>选择座位</h2>
      <fieldset className={styles.seatChoice}><legend>入座方向</legend>
        {SEATS.map(position => <label key={position}><input type="radio" name="lan-seat" value={position} checked={seat === position} onChange={() => setSeat(position)} />{seatName[position]}家</label>)}
      </fieldset>
      <p>请将参与联机的设备连接同一 Wi-Fi。由一台 Android 设备创建房间，其余设备输入房间地址和房间码加入。每人选择不同座位。</p>
      {room.canHost && <><fieldset className={styles.seatChoice}><legend>房间叫牌体系</legend>{(['sayc', 'two-over-one', 'precision'] as const).map(id => <label key={id}><input type="radio" name="lan-system" checked={system === id} onChange={() => setSystem(id)} />{SYSTEMS[id].short}</label>)}</fieldset><p>体系在创建房间时固定，所有玩家与补位机器人共用；加入房间使用房主的约定。</p><button type="button" className={styles.primary} disabled={room.busy} onClick={() => room.host(seat, system)}>创建房间</button></>}
      <form className={styles.joinForm} onSubmit={event => { event.preventDefault(); void room.join(address.trim(), roomCode.trim(), seat); }}>
        <label>房主地址<input required value={address} placeholder="例如 192.168.1.8:51894" onChange={event => setAddress(event.target.value)} autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
        <label>房间码<input required value={roomCode} onChange={event => setRoomCode(event.target.value)} autoCapitalize="characters" autoCorrect="off" spellCheck={false} /></label>
        <button type="submit" className={styles.primary} disabled={room.busy}>加入房间</button>
      </form>
    </section>}
    {confirmLeave && <section className={`${styles.panel} ${styles.leaveConfirm}`} role="alertdialog" aria-modal="true" aria-label="确认离开房间">
      <p>{room.isHost ? '房主离开会关闭房间并结束本场联机牌局。' : '离开会暂停本场牌局，并清除本机的重连凭证。'}</p>
      <div className={styles.actions}><button type="button" onClick={() => setConfirmLeave(false)}>返回房间</button>
      <button type="button" className={styles.primary} disabled={room.busy} onClick={leave}>确认离开</button></div>
    </section>}
    {snapshot && <>
      {snapshot.status === 'paused' && <p className={styles.pause} role="status">有玩家离线，牌局已暂停。离线座位：{SEATS.filter(position => snapshot.seats[position] === 'disconnected').map(position => seatName[position] + '家').join('、')}。</p>}
      <section className={`${styles.panel} ${styles.roomInfo}`} aria-label="房间信息">
        <details key={started ? 'table' : 'lobby'} open={!started}>
          <summary>房间信息{started && ` · ${seatName[snapshot.seat]}家`}</summary>
          <p data-testid="lan-bidding-system">{SYSTEMS[snapshot.biddingSystem].name}</p>
          <div className={styles.topline}>
            <div className={styles.inviteFields}><div><span>房间码</span><strong>{snapshot.roomCode}</strong><button type="button" onClick={() => void copyValue(snapshot.roomCode, '房间码')} aria-label="复制房间码">复制</button></div>
              {room.address && <div><span>连接地址</span><strong>{room.address}:{room.port}</strong><button type="button" onClick={() => void copyValue(`${room.address}:${room.port}`, '连接地址')} aria-label="复制连接地址">复制</button></div>}
            </div>
            {room.status === 'connected' && <button type="button" disabled={room.busy} onClick={requestLeave}>离开房间</button>}
          </div>
          {room.isHost && <p>请让房主设备保持同一 Wi-Fi 连接，并将 BridgeLab 保持在前台。</p>}
          <ul className={styles.seats}>{SEATS.map(position => <li key={position} data-mine={position === snapshot.seat} data-status={snapshot.seats[position]}>
            <strong>{seatName[position]}家{position === snapshot.seat ? ' · 你' : ''}</strong>
            <span>{seatStatus[snapshot.seats[position]]}{snapshot.status === 'waiting' && snapshot.seats[position] === 'connected' ? snapshot.readiness[position] ? ' · 已准备' : ' · 未准备' : ''}</span>
          </li>)}</ul>
          {snapshot.status === 'waiting' && <LobbyControls snapshot={snapshot} room={room} />}
        </details>
      </section>
      {snapshot.status !== 'waiting' && <Table snapshot={snapshot} room={room} />}
    </>}
  </section>;
}


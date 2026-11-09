import { legalCalls } from '../core/auction';
import { chooseLanBid } from '../ai/lan-bidding';
import { agreementVersionFor } from '../ai/bid-strategy';
import { chooseCard } from '../ai/playing';
import { observe, type PlayObservation } from '../ai/observation';
import { type PlayAdvisorClient } from '../ai/play-advisor-client';
import { BIDDING_SYSTEM_IDS, type BiddingSystem } from '../ai/systems';
import { robotStep } from '../controller/robot';
import { boardInfo, deck, sortCards } from '../core/deal';
import { applyCall, controllerFor, isFinished, newGameFromDeal, playCard } from '../core/game';
import { legalCards } from '../core/play';
import { BridgeError, SEATS, STRAINS, type GameState, type Hands, type Seat, type Strain } from '../core/types';
import { createJoinNonce, type RoomAction, type RoomResponse, type RoomSnapshot } from './protocol';

export const ROOM_TIMEOUT_MS = 15_000;
const LOBBY_RECLAIM_MS = 60_000;
const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const NONCE = /^[a-f0-9]{64}$/;

interface RoomSession {
  seat: Seat;
  token: string;
  nonce: string;
  lastSeen: number;
  connected: boolean;
  ready: boolean;
  actions: Map<string, string>;
}

export interface RoomOptions {
  now?: () => number;
  timeoutMs?: number;
  biddingSystem?: BiddingSystem;
  agreementVersion?: string;
  /** Host-owned client; omitted for the existing synchronous room path. */
  advisor?: Pick<PlayAdvisorClient, 'advise' | 'cancel'>;
}

interface PendingRobot {
  epoch: number;
  game: GameState;
  revision: number;
  actions: number;
  board: number;
  phase: GameState['phase'];
  turn: Seat;
  controller: Seat;
}

function seatRecord<T>(value: (seat: Seat) => T): Record<Seat, T> {
  return { N: value('N'), E: value('E'), S: value('S'), W: value('W') };
}

function freshBoard(board: number, biddingSystem: BiddingSystem): GameState {
  const cards = deck();
  const random = new Uint32Array(1);
  for (let i = cards.length - 1; i > 0; i--) {
    const range = i + 1;
    const limit = Math.floor(2 ** 32 / range) * range;
    do { crypto.getRandomValues(random); } while (random[0] >= limit);
    const j = random[0] % range;
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  const hands: Hands = seatRecord(seat => sortCards(cards.filter((_, index) => index % 4 === SEATS.indexOf(seat))));
  const { dealer, vulnerability } = boardInfo(board);
  return { ...newGameFromDeal(board, createJoinNonce(), hands, dealer, vulnerability),
    biddingSystem, agreementVersion: agreementVersionFor(biddingSystem) };
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseAction(value: unknown): RoomAction | null {
  const action = object(value);
  if (action?.kind === 'ready' && typeof action.ready === 'boolean') return { kind: 'ready', ready: action.ready };
  if (action?.kind === 'nextBoard' || action?.kind === 'startWithRobots') return { kind: action.kind };
  if (action?.kind === 'play' && typeof action.cardId === 'string' && /^[CDHS](?:[2-9]|1[0-4])$/.test(action.cardId)) {
    return { kind: 'play', cardId: action.cardId };
  }
  if (action?.kind === 'call') {
    const call = object(action.call);
    if (call?.kind === 'pass' || call?.kind === 'double' || call?.kind === 'redouble') return { kind: 'call', call: { kind: call.kind } };
    if (call?.kind === 'bid' && typeof call.level === 'number' && Number.isInteger(call.level) &&
        call.level >= 1 && call.level <= 7 && STRAINS.includes(call.strain as Strain)) {
      return { kind: 'call', call: { kind: 'bid', level: call.level, strain: call.strain as Strain } };
    }
  }
  return null;
}

export class LanRoom {
  readonly roomCode = Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => ROOM_CODE_ALPHABET[byte % ROOM_CODE_ALPHABET.length]).join('');
  readonly biddingSystem: BiddingSystem;
  readonly agreementVersion: string;
  private readonly sessions = new Map<Seat, RoomSession>();
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private host: RoomSession | undefined;
  private game: GameState;
  private started = false;
  private revision = 0;
  private readonly advisor: RoomOptions['advisor'];
  private robotEpoch = 0;
  private pendingRobot: PendingRobot | undefined;
  private disposed = false;

  constructor(options: RoomOptions = {}) {
    this.biddingSystem = options.biddingSystem ?? 'two-over-one';
    if (!BIDDING_SYSTEM_IDS.includes(this.biddingSystem)) throw new BridgeError('INVALID_SYSTEM', '不支持的房间叫牌体系');
    this.agreementVersion = agreementVersionFor(this.biddingSystem);
    if (options.agreementVersion !== undefined && options.agreementVersion !== this.agreementVersion) {
      throw new BridgeError('INVALID_AGREEMENT_VERSION', '当前客户端不支持指定的房间约定版本');
    }
    this.game = freshBoard(1, this.biddingSystem);
    this.now = options.now ?? Date.now;
    this.timeoutMs = options.timeoutMs ?? ROOM_TIMEOUT_MS;
    this.advisor = options.advisor;
  }

  tick(): void {
    if (this.disposed) return;
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (session.connected && now - session.lastSeen >= this.timeoutMs) this.disconnect(session);
      if (!this.started && session !== this.host && now - session.lastSeen >= LOBBY_RECLAIM_MS) {
        this.sessions.delete(session.seat);
        this.revision++;
      }
    }
  }

  request(payload: unknown): RoomResponse {
    if (this.disposed) return this.failure('ROOM_CLOSED', '房主已关闭房间。');
    this.tick();
    const request = object(payload);
    if (request?.kind === 'join') return this.join(request);
    if (request?.kind !== 'resume' && request?.kind !== 'poll' && request?.kind !== 'leave' && request?.kind !== 'action') {
      return this.failure('INVALID_REQUEST', '未知的房间请求');
    }

    const session = [...this.sessions.values()].find(candidate => candidate.token === request.token);
    if (!session) return this.failure('INVALID_TOKEN', '座位凭证无效');
    if (request.kind === 'leave') {
      if (this.started) this.disconnect(session);
      else {
        this.sessions.delete(session.seat);
        if (session === this.host) this.host = undefined;
        this.revision++;
      }
      return this.success(session);
    }
    if (!this.supportsAgreement(request)) return this.failure('CLIENT_UPDATE_REQUIRED', '此房间采用不同约定版本，请使用兼容的新版客户端');
    if (request.kind === 'resume') {
      this.connect(session);
      return this.success(session);
    }
    if (!session.connected) return this.failure('DISCONNECTED', '请先重新连接座位');
    session.lastSeen = this.now();
    if (request.kind === 'poll') {
      if (session === this.host) this.advanceRobot();
      return this.success(session);
    }
    return this.act(session, request);
  }

  private join(request: Record<string, unknown>): RoomResponse {
    if (request.roomCode !== this.roomCode) return this.failure('INVALID_ROOM', '房间码无效');
    if (!this.supportsAgreement(request)) return this.failure('CLIENT_UPDATE_REQUIRED', '此房间采用不同约定版本，请使用兼容的新版客户端');
    const seat = request.seat as Seat;
    const nonce = request.nonce;
    if (!SEATS.includes(seat) || typeof nonce !== 'string' || !NONCE.test(nonce)) {
      return this.failure('INVALID_REQUEST', '座位或加入凭证无效');
    }
    const previous = this.sessions.get(seat);
    if (previous?.nonce === nonce) {
      this.connect(previous);
      return this.success(previous, previous.token);
    }
    if (previous) return this.failure('SEAT_TAKEN', '该座位已被占用');
    if (this.started) return this.failure('ROOM_STARTED', '牌局已经开始');
    const session: RoomSession = {
      seat, nonce, token: createJoinNonce(), lastSeen: this.now(), connected: true, ready: false, actions: new Map(),
    };
    this.sessions.set(seat, session);
    this.host ??= session;
    this.revision++;
    return this.success(session, session.token);
  }

  private supportsAgreement(request: Record<string, unknown>): boolean {
    // A missing advertisement cannot distinguish the old 3NT negative from
    // the current shifted 3H negative; every participant must name its card.
    if (request.supportedAgreements === undefined) return false;
    return object(request.supportedAgreements)?.[this.biddingSystem] === this.agreementVersion;
  }

  private connect(session: RoomSession): void {
    session.lastSeen = this.now();
    if (session.connected) return;
    session.connected = true;
    this.revision++;
  }

  private disconnect(session: RoomSession): void {
    if (!session.connected) return;
    this.invalidateRobot('真人座位已断开，取消当前机器人分析');
    session.connected = false;
    if (!this.started) session.ready = false;
    this.revision++;
  }

  private status(): RoomSnapshot['status'] {
    if (!this.started) return 'waiting';
    return SEATS.some(seat => this.sessions.get(seat)?.connected === false) ? 'paused' : 'active';
  }

  private allPlayersReady(): boolean {
    return [...this.sessions.values()].every(player => player.connected && player.ready);
  }

  private advanceRobot(): void {
    if (this.disposed || this.status() !== 'active' || isFinished(this.game) || this.sessions.has(controllerFor(this.game))) return;
    if (this.pendingRobot) return;
    if (this.advisor && this.game.phase === 'play') {
      const task: PendingRobot = { epoch: this.robotEpoch, game: this.game, revision: this.revision,
        actions: this.game.actions.length, board: this.game.board, phase: this.game.phase,
        turn: this.game.turn, controller: controllerFor(this.game) };
      const observation = observe(this.game) as PlayObservation;
      this.pendingRobot = task;
      void Promise.resolve().then(() => {
        if (!this.currentRobot(task)) return undefined;
        return this.advisor!.advise({ observation, system: this.biddingSystem, strength: 'challenge' });
      }).then(decision => {
        if (decision) this.commitRobot(task, decision.cardId);
      }, () => this.commitRobot(task)).finally(() => {
        // A canceled task must never release a replacement task's slot.
        if (this.pendingRobot === task) this.pendingRobot = undefined;
      });
      return;
    }
    const next = robotStep(this.game, {
      bid: obs => chooseLanBid(obs, this.biddingSystem),
      play: obs => chooseCard(obs, this.biddingSystem),
    }, this.biddingSystem).game;
    this.invalidateRobot('权威牌局已推进');
    this.game = next;
    this.revision++;
  }

  private invalidateRobot(reason: string): void {
    this.robotEpoch++;
    const pending = this.pendingRobot;
    this.pendingRobot = undefined;
    if (pending) this.advisor?.cancel(new Error(reason));
  }

  private currentRobot(task: PendingRobot): boolean {
    // Expiration must be observed even if no poll arrived while DDS was busy.
    this.tick();
    return !this.disposed && this.pendingRobot === task && task.epoch === this.robotEpoch
      && this.status() === 'active' && this.game === task.game && this.revision === task.revision
      && this.game.actions.length === task.actions && this.game.board === task.board
      && this.game.phase === task.phase && this.game.turn === task.turn
      && controllerFor(this.game) === task.controller && !this.sessions.has(task.controller);
  }

  private commitRobot(task: PendingRobot, suggestedCard?: string): void {
    if (!this.currentRobot(task)) return;
    const legal = legalCards(this.game.hands[this.game.turn], this.game.currentTrick);
    const cardId = suggestedCard && legal.some(card => card.id === suggestedCard)
      ? suggestedCard : chooseCard(observe(this.game) as PlayObservation, this.biddingSystem);
    if (!legal.some(card => card.id === cardId) || !this.currentRobot(task)) return;
    const next = playCard(this.game, this.game.turn, cardId);
    this.pendingRobot = undefined;
    this.robotEpoch++;
    this.game = next;
    this.revision++;
    // The next robot is scheduled only by the next host poll.
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.invalidateRobot('房间已关闭');
  }

  private act(session: RoomSession, request: Record<string, unknown>): RoomResponse {
    const action = parseAction(request.action);
    const { id, revision } = request;
    if (!action || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(id) ||
        typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) {
      return this.failure('INVALID_ACTION', '动作格式不正确', session);
    }
    const fingerprint = JSON.stringify(action);
    const previous = session.actions.get(id);
    if (previous !== undefined) {
      return previous === fingerprint ? this.success(session) : this.failure('ACTION_ID_REUSED', '该动作编号已被使用', session);
    }
    if (revision !== this.revision) return this.failure('STALE_REVISION', '房间状态已更新，请刷新后操作', session);
    try {
      this.apply(session, action);
    } catch (error) {
      if (!(error instanceof BridgeError)) throw error;
      return this.failure(error.code, error.message, session);
    }
    session.actions.set(id, fingerprint);
    this.revision++;
    return this.success(session);
  }

  private apply(session: RoomSession, action: RoomAction): void {
    if (action.kind === 'ready') {
      if (this.started) throw new BridgeError('ROOM_STARTED', '牌局已经开始');
      session.ready = action.ready;
      this.started = this.sessions.size === SEATS.length && this.allPlayersReady();
      return;
    }
    if (action.kind === 'startWithRobots') {
      if (session !== this.host) throw new BridgeError('HOST_ONLY', '只有房主可以确认机器人补位');
      if (this.started) throw new BridgeError('ROOM_STARTED', '牌局已经开始');
      if (this.sessions.size === SEATS.length) throw new BridgeError('NO_EMPTY_SEATS', '当前没有空位，请等待四家准备');
      if (!this.allPlayersReady()) throw new BridgeError('PLAYERS_NOT_READY', '请等待已入座玩家全部在线并准备');
      this.started = true;
      return;
    }
    const status = this.status();
    if (status === 'waiting') throw new BridgeError('ROOM_WAITING', '请等待玩家准备并开局');
    if (status === 'paused') throw new BridgeError('ROOM_PAUSED', '请等待离线座位重新连接');
    if (action.kind === 'nextBoard') {
      if (session !== this.host) throw new BridgeError('HOST_ONLY', '只有房主可以开始下一局');
      if (!isFinished(this.game)) throw new BridgeError('BOARD_IN_PROGRESS', '当前牌局尚未结束');
      this.invalidateRobot('开始下一副牌');
      this.game = freshBoard(this.game.board + 1, this.biddingSystem);
      return;
    }
    if (session.seat !== controllerFor(this.game)) throw new BridgeError('NOT_CONTROLLER', '还没有轮到你行动');
    const next = action.kind === 'call'
      ? applyCall(this.game, session.seat, action.call)
      : playCard(this.game, this.game.turn, action.cardId);
    this.invalidateRobot('真人已更新权威牌局');
    this.game = next;
  }

  private snapshot(session: RoomSession): RoomSnapshot {
    const { board, dealer, vulnerability, phase, auction, turn, contract, dummyRevealed,
      currentTrick, completedTricks, tricksWon, result, hands } = this.game;
    const status = this.status();
    const controller = controllerFor(this.game);
    const canAct = status === 'active' && session.seat === controller;
    return structuredClone({
      roomCode: this.roomCode, biddingSystem: this.biddingSystem, agreementVersion: this.agreementVersion,
      revision: this.revision, seat: session.seat, status,
      seats: seatRecord<RoomSnapshot['seats'][Seat]>(seat => {
        const player = this.sessions.get(seat);
        return player ? (player.connected ? 'connected' : 'disconnected') : this.started ? 'robot' : 'empty';
      }),
      readiness: seatRecord(seat => this.sessions.get(seat)?.ready ?? false),
      board, dealer, vulnerability, phase, auction, turn, controller, contract, dummyRevealed,
      currentTrick, completedTricks, tricksWon, result,
      hand: this.started ? hands[session.seat] : [],
      dummy: dummyRevealed && contract ? { seat: contract.dummy, hand: hands[contract.dummy] } : null,
      handCounts: seatRecord(seat => this.started ? hands[seat].length : 0),
      legalCalls: canAct && phase === 'auction' ? legalCalls(auction, turn) : [],
      legalCardIds: canAct && phase === 'play' ? legalCards(hands[turn], currentTrick).map(card => card.id) : [],
      canNextBoard: session === this.host && status === 'active' && isFinished(this.game),
    });
  }

  private success(session: RoomSession, token?: string): RoomResponse {
    return { ok: true, snapshot: this.snapshot(session), ...(token ? { token } : {}) };
  }

  private failure(code: string, message: string, session?: RoomSession): RoomResponse {
    return { ok: false, code, message, ...(session ? { snapshot: this.snapshot(session) } : {}) };
  }
}

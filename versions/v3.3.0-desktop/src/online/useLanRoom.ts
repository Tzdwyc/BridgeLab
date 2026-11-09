import { useEffect, useRef, useState } from 'react';
import type { Seat } from '../core/types';
import { BIDDING_SYSTEM_IDS, type BiddingSystem } from '../ai/systems';
import { PlayAdvisorClient } from '../ai/play-advisor-client';
import { createJoinNonce, LAN_SUPPORTED_AGREEMENTS, type RoomAction, type RoomResponse, type RoomSnapshot } from './protocol';
import { LanRoom } from './room';
import { lanApi, LanHttpError, parseEndpoint, type Endpoint } from './transport';

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected';
type Session = Endpoint & { roomCode: string; token: string; host?: boolean };
const sessionKey = 'bridgelab.v3.lan.session';
const pollInterval = 900;
const reconnectInterval = 2500;

class RoomReplyError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

/** Missing or older host metadata must never be promoted to the current card. */
export function isCompatibleRoomAgreement(snapshot: { biddingSystem?: string; agreementVersion?: string }): boolean {
  const system = snapshot.biddingSystem;
  return typeof system === 'string' && BIDDING_SYSTEM_IDS.includes(system as BiddingSystem)
    && LAN_SUPPORTED_AGREEMENTS[system as BiddingSystem] === snapshot.agreementVersion;
}

function restoreSession(): Session | null {
  try {
    const session = JSON.parse(sessionStorage.getItem(sessionKey) ?? 'null') as Session | null;
    return session && !session.host ? session : null;
  } catch { return null; }
}

export function useLanRoom() {
  const [session, setSession] = useState<Session | null>(restoreSession);
  const [status, setStatus] = useState<Status>(session ? 'disconnected' : 'idle');
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canHost, setCanHost] = useState(false);
  const room = useRef<LanRoom | null>(null);
  const hostAdvisor = useRef<PlayAdvisorClient | null>(null);
  const hostStart = useRef<Promise<Endpoint> | null>(null);
  const hostEpoch = useRef(0);
  const stopTask = useRef<Promise<void> | null>(null);
  const mounted = useRef(true);
  const closing = useRef(false);
  const working = useRef(false);
  const pending = useRef<{ id: string; revision: number; action: RoomAction } | null>(null);
  const alive = useRef<Session | null>(session);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      void stopHosting(false).catch(() => {});
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    lanApi<{ canHost: boolean }>('capabilities', {}, controller.signal)
      .then(value => setCanHost(value.canHost), () => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!session?.host) return;
    const controller = new AbortController();
    const pump = async () => {
      while (!controller.signal.aborted) {
        try {
          const item = await lanApi<{ id?: number; payload: unknown }>('poll', {}, controller.signal);
          if (item.id !== undefined && room.current && !controller.signal.aborted) {
            const payload: RoomResponse = closing.current
              ? { ok: false, code: 'ROOM_CLOSED', message: '房主已关闭房间。' }
              : room.current.request(item.payload);
            await lanApi('reply', { id: item.id, payload }, controller.signal);
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            if (cause instanceof LanHttpError && cause.status === 410) {
              await stopHosting(false).catch(() => {});
              if (mounted.current) setError('主持已中断，请重新创建房间。');
              return;
            }
            setError((cause as Error).message);
            setStatus('disconnected');
          }
        }
        await new Promise(resolve => setTimeout(resolve, 150));
      }
    };
    void pump();
    return () => controller.abort();
  }, [session]);

  function remember(value: Session | null) {
    alive.current = value;
    setSession(value);
    try {
      if (value && !value.host) sessionStorage.setItem(sessionKey, JSON.stringify(value));
      else sessionStorage.removeItem(sessionKey);
    } catch { /* Storage may be disabled. */ }
  }

  /** Stop the host's computation immediately, before the existing guest-notice window. */
  function stopHosting(notifyGuests: boolean): Promise<void> {
    if (stopTask.current) return stopTask.current;
    if (!room.current && !hostAdvisor.current && !hostStart.current) return Promise.resolve();
    closing.current = true;
    const ownedRoom = room.current;
    const ownedAdvisor = hostAdvisor.current;
    const starting = hostStart.current;
    const epoch = ++hostEpoch.current;
    ownedRoom?.dispose();
    ownedAdvisor?.dispose();
    const task = (async () => {
      if (notifyGuests) await new Promise(resolve => setTimeout(resolve, 1500));
      // An in-flight native start must settle before stop, so an unmount cannot leave a late-started relay behind.
      if (starting) await starting.catch(() => {});
      await lanApi('stop');
    })().finally(() => {
      if (hostEpoch.current === epoch) {
        if (room.current === ownedRoom) room.current = null;
        if (hostAdvisor.current === ownedAdvisor) hostAdvisor.current = null;
        pending.current = null;
        if (mounted.current) {
          remember(null);
          setSnapshot(null);
          setStatus('idle');
        } else alive.current = null;
        closing.current = false;
      }
      if (stopTask.current === task) stopTask.current = null;
    });
    stopTask.current = task;
    return task;
  }

  function request(target: Endpoint, payload: object, signal?: AbortSignal): Promise<RoomResponse> {
    const versionedPayload = { ...payload, supportedAgreements: LAN_SUPPORTED_AGREEMENTS };
    if ('host' in target && target.host && room.current) {
      return Promise.resolve(room.current.request(versionedPayload));
    }
    const { address, port } = target;
    return lanApi('connect', { address, port, payload: versionedPayload }, signal);
  }

  function apply(response: RoomResponse) {
    const next = response.snapshot;
    if (next) {
      if (!isCompatibleRoomAgreement(next)) {
        throw new RoomReplyError('CLIENT_UPDATE_REQUIRED', '房间约定版本不兼容，请更新客户端后加入。');
      }
      setSnapshot(previous => previous && previous.revision > next.revision ? previous : next);
    }
    if (!response.ok) throw new RoomReplyError(response.code, response.message);
  }

  function finishGuestSession(target: Session, cause: unknown): boolean {
    if (target.host || alive.current !== target) return false;
    const closed = (cause instanceof LanHttpError && cause.status === 410) ||
      (cause instanceof RoomReplyError && cause.code === 'ROOM_CLOSED');
    const invalid = cause instanceof RoomReplyError && cause.code === 'INVALID_TOKEN';
    if (!closed && !invalid) return false;
    pending.current = null;
    remember(null);
    setSnapshot(null);
    setStatus('idle');
    setError(closed ? '房主已关闭房间。' : '当前房间的座位凭证已失效，请重新加入。');
    return true;
  }

  useEffect(() => {
    if (!session || status === 'idle' || status === 'connecting') return;
    if (session.host && status !== 'connected') return;
    const controller = new AbortController();
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    const visible = () => document.visibilityState !== 'hidden';
    const wake = async () => {
      if (!controller.signal.aborted && !session.host && visible() && alive.current === session) {
        await resumeSession(session, status === 'disconnected');
      }
    };
    const retry = async () => {
      await wake();
      if (!controller.signal.aborted) timer = setTimeout(retry, reconnectInterval);
    };
    const poll = async () => {
      try {
        const response = await request(session, { kind: 'poll', token: session.token }, controller.signal);
        if (controller.signal.aborted || alive.current !== session) return;
        apply(response);
        failures = 0;
      } catch (cause) {
        if (controller.signal.aborted || alive.current !== session) return;
        if (finishGuestSession(session, cause)) return;
        if ((cause instanceof RoomReplyError && cause.code === 'DISCONNECTED') || ++failures >= 2) {
          setStatus('disconnected');
          setError((cause as Error).message);
          return;
        }
      }
      timer = setTimeout(poll, pollInterval);
    };
    if (status === 'connected') timer = setTimeout(poll, pollInterval);
    else timer = setTimeout(retry, 0);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('online', wake);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('online', wake);
    };
  }, [session, status]);

  async function run(task: () => Promise<void>, clearError = true) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    if (clearError) setError('');
    try { await task(); }
    catch (cause) { setError((cause as Error).message); }
    finally { working.current = false; setBusy(false); }
  }

  async function enter(target: Endpoint & { host?: boolean }, roomCode: string, seat: Seat) {
    const ownedRoom = target.host ? room.current : null;
    const epoch = hostEpoch.current;
    const payload = { kind: 'join', roomCode, seat, nonce: createJoinNonce() };
    let response: RoomResponse;
    try { response = await request(target, payload); }
    catch { response = await request(target, payload); }
    if (target.host && (closing.current || room.current !== ownedRoom || hostEpoch.current !== epoch || !mounted.current)) {
      throw new Error('主持已停止。');
    }
    apply(response);
    if (!response.ok || !response.token) throw new Error('房间未返回座位凭证。');
    remember({ ...target, roomCode, token: response.token });
    setStatus('connected');
  }

  function resumeSession(target: Session, retrying = false) {
    return run(async () => {
      if (alive.current !== target) return;
      if (!retrying) setStatus('connecting');
      try {
        const resumed = await request(target, { kind: 'resume', token: target.token });
        if (alive.current !== target) return;
        apply(resumed);
        setError('');
        if (pending.current) {
          const action = pending.current;
          const response = await request(target, { kind: 'action', token: target.token, ...action });
          if (alive.current !== target) return;
          if (!response.ok && (response.code === 'ROOM_CLOSED' || response.code === 'INVALID_TOKEN')) apply(response);
          pending.current = null;
          if (response.snapshot) apply({ ok: true, snapshot: response.snapshot });
          if (!response.ok) setError(response.message);
        }
        setStatus('connected');
      } catch (cause) {
        if (alive.current !== target) return;
        if (finishGuestSession(target, cause)) return;
        setStatus('disconnected');
        throw cause;
      }
    }, !retrying);
  }

  return {
    snapshot, status, error, busy, canHost, isHost: !!session?.host, canResume: !!session,
    address: session?.address ?? '', port: session?.port, roomCode: session?.roomCode ?? '',
    host: (seat: Seat, biddingSystem: BiddingSystem = 'two-over-one') => run(async () => {
      setStatus('connecting');
      try {
        await stopHosting(false);
        const advisor = new PlayAdvisorClient();
        hostAdvisor.current = advisor;
        const epoch = ++hostEpoch.current;
        const next = new LanRoom({ biddingSystem, advisor });
        room.current = next;
        const starting = lanApi<Endpoint>('start');
        hostStart.current = starting;
        let endpoint: Endpoint;
        try { endpoint = await starting; }
        finally { if (hostStart.current === starting) hostStart.current = null; }
        if (!mounted.current || closing.current || room.current !== next || hostEpoch.current !== epoch) {
          throw new Error('主持已停止。');
        }
        await enter({ ...endpoint, host: true }, next.roomCode, seat);
      } catch (cause) {
        await stopHosting(false).catch(() => {});
        setStatus('idle');
        throw cause;
      }
    }),
    join: (address: string, code: string, seat: Seat) => run(async () => {
      setStatus('connecting');
      try { await enter(parseEndpoint(address), code.trim().toUpperCase(), seat); }
      catch (cause) { setStatus('idle'); throw cause; }
    }),
    resume: () => session ? resumeSession(session) : Promise.resolve(),
    send: (action: RoomAction) => run(async () => {
      if (!session || !snapshot || status !== 'connected') return;
      const command = { id: createJoinNonce(), revision: snapshot.revision, action };
      pending.current = command;
      let response: RoomResponse;
      try {
        response = await request(session, { kind: 'action', token: session.token, ...command });
        if (alive.current !== session) return;
        if (!response.ok && ['ROOM_CLOSED', 'INVALID_TOKEN', 'DISCONNECTED'].includes(response.code)) apply(response);
      } catch (cause) {
        if (alive.current !== session) return;
        if (finishGuestSession(session, cause)) return;
        setStatus('disconnected');
        throw cause;
      }
      pending.current = null;
      apply(response);
    }),
    leave: () => run(async () => {
      if (!session) return;
      if (session.host) {
        await stopHosting(true);
      } else {
        await request(session, { kind: 'leave', token: session.token }).catch(() => {});
      }
      pending.current = null;
      remember(null);
      setSnapshot(null);
      setStatus('idle');
    }),
  };
}

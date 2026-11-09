import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { BridgeError, PASS, type GameState } from '../src/core/types';
import { applyCall, newGame, playCard } from '../src/core/game';
import { invalidUserActionNotice, liveLanActionNotice, visibleTableNotice } from '../src/controller/user-action-notice';
import { emptySession } from '../src/persistence/session';
import { migrationReady, useGame } from '../src/controller/store';
import { robotStepWithAdvisor } from '../src/controller/robot';

vi.mock('../src/controller/robot', async original => {
  const real = await original<typeof import('../src/controller/robot')>();
  return { ...real, robotStepWithAdvisor: vi.fn(async (game: GameState) => ({
    game: applyCall(game, game.turn, PASS), warning: '机器人已使用安全备用动作：系统暂不可用', decision: null,
  })) };
});

beforeEach(async () => {
  await migrationReady;
  useGame.getState().setPaused(true);
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} });
  useGame.setState({ ...emptySession(), activeMatch: null, thinking: false, referenceThinking: false,
    referenceError: null, paused: false, notice: null, userActionNotice: null, pendingRobotClaim: null });
  vi.mocked(robotStepWithAdvisor).mockClear();
});
afterEach(() => { useGame.getState().setPaused(true); vi.unstubAllGlobals(); });

it.each(['自动保存失败', '比赛已保存', '已回到上一个玩家决策点。', 'DDS 暂不可用',
  '机器人已使用安全备用动作', '连接中断', '出牌建议失败', '系统错误', 'toString'])('hides operational payloads during live play: %s', message => {
  expect(visibleTableNotice(true, message, null)).toBeNull();
  expect(visibleTableNotice(false, message, null)).toBe(message);
  expect(invalidUserActionNotice(new Error(message))).toBeNull();
  expect(liveLanActionNotice(message)).toBeNull();
});

it('only classifies typed human rule violations and exact authoritative LAN action errors', () => {
  for (const [code, message] of [['INVALID_CALL', '此叫品不合法'], ['NO_CARD', '此位置没有这张牌'],
    ['REVOKE', '手中有首引花色，必须跟牌'], ['NOT_CONTROLLER', '还没有轮到你行动']] as const) {
    const brief = invalidUserActionNotice(new BridgeError(code, message));
    expect(brief).toBeTruthy();
    expect(liveLanActionNotice(message)).toBe(brief);
    expect(visibleTableNotice(true, '自动保存失败', brief)).toBe(brief);
  }
  expect(invalidUserActionNotice(new BridgeError('WRONG_PHASE', '当前不在打牌阶段'))).toBeNull();
  expect(invalidUserActionNotice(new BridgeError('toString', '系统异常'))).toBeNull();
});

it('rejects an actual invalid human call without changing the game and clears its single brief notice after success', () => {
  const game = newGame(3, 'notice-invalid-call');
  useGame.setState({ game });
  useGame.getState().call({ kind: 'double' });
  expect(useGame.getState().game).toBe(game);
  expect(useGame.getState().undo).toEqual([]);
  expect(useGame.getState().userActionNotice).toBe('此叫品不合法，请重新选择。');
  expect(visibleTableNotice(true, useGame.getState().notice, useGame.getState().userActionNotice)).toBe('此叫品不合法，请重新选择。');
  useGame.getState().call(PASS);
  expect(useGame.getState().game?.actions).toHaveLength(1);
  expect(useGame.getState().userActionNotice).toBeNull();
  const advanced = useGame.getState().game;
  useGame.getState().call(PASS);
  expect(useGame.getState().game).toBe(advanced);
  expect(useGame.getState().userActionNotice).toBe('请等待轮到你行动。');
  useGame.getState().clearNotice();
  expect(useGame.getState().userActionNotice).toBeNull();
});

it('rejects an actual revoke with the game unchanged', () => {
  let game = newGame(3, 'notice-revoke');
  game = applyCall(game, game.turn, { kind: 'bid', level: 1, strain: 'NT' });
  for (let i = 0; i < 3; i++) game = applyCall(game, game.turn, PASS);
  const lead = game.hands.W.find(card => game.hands.N.some(other => other.suit === card.suit) && game.hands.N.some(other => other.suit !== card.suit))!;
  expect(lead).toBeTruthy();
  game = playCard(game, 'W', lead.id);
  const wrong = game.hands.N.find(card => card.suit !== lead.suit)!;
  useGame.setState({ game });
  useGame.getState().play(wrong.id);
  expect(useGame.getState().game).toBe(game);
  expect(useGame.getState().userActionNotice).toBe('手中有首引花色，必须跟牌。');
  useGame.getState().play('not-a-card');
  expect(useGame.getState().game).toBe(game);
  expect(useGame.getState().userActionNotice).toBe('请选择手中的牌。');
});

it('keeps storage failure diagnostics internal after a valid human action', () => {
  vi.stubGlobal('localStorage', { setItem: () => { throw new Error('Storage full'); } });
  useGame.setState({ game: newGame(3, 'notice-storage') });
  useGame.getState().call(PASS);
  expect(useGame.getState().game?.actions).toHaveLength(1);
  expect(useGame.getState().notice).toContain('自动保存失败');
  expect(visibleTableNotice(true, useGame.getState().notice, useGame.getState().userActionNotice)).toBeNull();
});

it('keeps advisor fallback diagnostics internal while the actual robot action still advances', async () => {
  useGame.setState({ game: newGame(1, 'notice-robot') });
  await useGame.getState().stepAI();
  expect(robotStepWithAdvisor).toHaveBeenCalledOnce();
  expect(useGame.getState().game?.actions).toHaveLength(1);
  expect(useGame.getState().notice).toContain('安全备用动作');
  expect(useGame.getState().userActionNotice).toBeNull();
  expect(visibleTableNotice(true, useGame.getState().notice, useGame.getState().userActionNotice)).toBeNull();
});

import { BridgeError } from '../core/types';

const actionErrors: Record<string, string> = {
  NOT_TURN: '请等待轮到你行动。',
  NOT_CONTROLLER: '请等待轮到你行动。',
  INVALID_CALL: '此叫品不合法，请重新选择。',
  NO_CARD: '请选择手中的牌。',
  REVOKE: '手中有首引花色，必须跟牌。',
};

/** Only rule errors from an attempted human call/card belong in a live-table popup. */
export function invalidUserActionNotice(error: unknown): string | null {
  return error instanceof BridgeError && Object.hasOwn(actionErrors, error.code) ? actionErrors[error.code] : null;
}

/** These exact messages are emitted by the authoritative LAN action/rules checks. */
const lanActionErrors: Record<string, string> = {
  '还没有轮到你行动': actionErrors.NOT_CONTROLLER,
  '还没有轮到此位置叫牌': actionErrors.NOT_TURN,
  '还没有轮到此位置出牌': actionErrors.NOT_TURN,
  '此叫品不合法': actionErrors.INVALID_CALL,
  '此位置没有这张牌': actionErrors.NO_CARD,
  '手中有首引花色，必须跟牌': actionErrors.REVOKE,
};
export function liveLanActionNotice(message: string): string | null {
  return Object.hasOwn(lanActionErrors, message) ? lanActionErrors[message] : null;
}

export function visibleTableNotice(live: boolean, operationalNotice: string | null, userActionNotice: string | null): string | null {
  return live ? userActionNotice : operationalNotice;
}

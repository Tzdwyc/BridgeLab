import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { applyCall, newGame } from '../src/core/game';
import { observe, type BiddingObservation } from '../src/ai/observation';
import { type Call, type Card, type Strain, type Suit, PASS } from '../src/core/types';

const b = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const parse = (value: string): Call => value === 'P' ? PASS : value === 'X' ? { kind: 'double' }
  : value === 'XX' ? { kind: 'redouble' } : b(Number(value[0]), value.slice(1) as Strain);
function position(sequence: string, holding: string): BiddingObservation {
  let game = newGame(1, 'chat-reviewed');
  for (const token of sequence.split(' ').filter(Boolean)) game = applyCall(game, game.turn, parse(token));
  const obs = observe(game) as BiddingObservation;
  obs.hand = holding.split('.').flatMap((cards, index) => cards === '-' ? [] : [...cards].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { id: `${suit}${rank}`, suit, rank } as Card;
  }));
  expect(obs.hand).toHaveLength(13);
  return obs;
}
const decision = (sequence: string, holding: string) => chooseBid(position(sequence, holding), 'sayc');

// Concrete expectations selected by the chat GPT from foundation-6 records.
// This suite checks repairs; it does not judge random auctions automatically.
describe('chat GPT step reviews: routing and explanatory roles', () => {
  it('retains a real major invitation and its acceptance in a longer sequence (6956)', () => {
    expect(decision('P 1D P 1H P 2H P', 'KQ9.K985.JT93.86')).toEqual(b(3, 'H'));
    expect(decision('P 1D P 1H P 2H P 3H P', 'AJT5.AQ43.642.K5')).toEqual(b(4, 'H'));
  });
  it('shows equal four-card majors in ascending order and avoids fictitious strength (244/3625)', () => {
    expect(decision('P P 1C P', 'K975.A984.95.Q85')).toEqual(b(1, 'H'));
    expect(decision('P 1C P 1D P', 'AT43.AK85.93.K94')).toEqual(b(1, 'H'));
  });
  it('retains the public NT range after a major search for a quantitative invitation (3616)', () => {
    expect(decision('1NT P 2C P 3NT P', '74.AK98.AKJ.JT75')).toEqual(b(4, 'NT'));
  });
  it('does not leap to minor game on a weak two with only thirteen high-card points (3622)', () => {
    expect(decision('2D P', 'A432.985.QT92.AK')).toEqual(b(3, 'D'));
  });
  it('continues a six-card strong major after partner returns to the three-level preempt (229)', () => {
    expect(decision('3C P 3H P 4C P', 'J62.AQJT74.AK42.-')).toEqual(b(4, 'H'));
  });
  it('continues descriptively when takeout jump support is below the minor-game threshold (3633)', () => {
    // GPT re-review: own adjusted nineteen plus public nine is twenty-eight, not a guaranteed 5D.
    expect(decision('1H X P 3D P', 'KQT54.-.AT86.AQ93')).toEqual(b(3, 'S'));
  });
  it('does not issue a takeout double with five enemy trumps and no unbid long suit (3634)', () => {
    expect(decision('1S P 2S', 'AKJ64.AJ82.AJ.Q5')).toEqual(PASS);
  });
  it('does not overcall at the two level on five small cards (6931)', () => {
    expect(decision('1S', 'T4.AKQ8.98543.J7')).toEqual(PASS);
  });
  it('keeps constructive support when opponents raise before advancer acts (6917/6981)', () => {
    expect(decision('P P P 1S 2D 2S', 'Q87.Q92.K942.A76')).toEqual(b(3, 'S'));
    expect(decision('2H 3D 3H', 'AK93.T9.K732.K87')).toEqual(b(4, 'D'));
  });
  it('shows a usable one-level major after a low-minor overcall (3690)', () => {
    expect(decision('1C 1D', 'AKT4.QJ5.KT8.J98')).toEqual(b(1, 'S'));
  });
  it('reaches game with a strong stopped six-card minor instead of a minimum or invitation (244)', () => {
    expect(decision('P P 1C P 1H P', 'A4.KQ6.A3.AKT932')).toEqual(b(3, 'NT'));
  });
  it('preserves invitations and shape after an original major rebid (150/163/3545)', () => {
    expect(decision('1H P 1S P 2H P', 'KT632.K.A9875.Q9')).toEqual(b(3, 'D'));
    expect(decision('P P 1S P 1NT P', 'AKJ943.A.AJT.A82')).toEqual(b(4, 'S'));
    expect(decision('P P 1D P 1H P 1S P', 'Q6.KQJT9.Q52.J53')).toEqual(b(2, 'NT'));
  });
  it('answers the natural second suit while keeping its one-round force (150)', () => {
    expect(decision('1H P 1S P 2H P 3D P', 'A8.AQJ986.Q32.K4')).not.toEqual(PASS);
  });
  it('does not force a minimum opener to overcall NT after an intervening NT bid (6903)', () => {
    expect(decision('1C P 1D 1NT', 'J752.A64.A8.K852')).toEqual(PASS);
  });
  it('uses real fit points and escapes a negative-double misfit (3564/6923)', () => {
    expect(decision('P P 1C 1H 1S 2H 2S 3H', 'AQJT9.2.QJ876.76')).toEqual(b(4, 'S'));
    expect(decision('P P P 1C 1H X P 2C P', 'KT65.K74.QT742.2')).toEqual(b(2, 'D'));
  });
  it('does not invent a minor fit after a takeout double (194)', () => {
    expect(decision('1C X', '-.98632.QJ972.K82')).toEqual(b(1, 'H'));
  });
  it('answers a weak-jump feature inquiry rather than treating 2NT as natural (6888)', () => {
    const ask = position('1H 2S P', 'AQ6.J97.KQ5.QJ74');
    expect(describeCall(ask.auction, ask.seat, b(2, 'NT'), 'sayc')).toContain('特征问叫');
    expect(decision('1H 2S P 2NT P', 'KJ7432.6.A9.K852')).toEqual(b(3, 'C'));
    expect(decision('1H 2S P 2NT P 3C P', 'AQ6.J97.KQ5.QJ74')).toEqual(b(4, 'S'));
  });
  it('continues a strong semi-forcing-NT opener jump shift with a real long major (3583)', () => {
    expect(decision('1S P 1NT P', 'KQJT8.A8.AKQ54.7')).toEqual(b(3, 'D'));
    expect(decision('1S P 1NT P 3D P', 'T2.AKQJ76.J85.72')).toEqual(b(3, 'H'));
  });
  it('does not promise six cards when a strong opener repeats after a second negative (93)', () => {
    const obs = position('2C P 2D P 2H P 3C P', 'AK3.AKQJ9.86.AQ9');
    expect(describeCall(obs.auction, obs.seat, b(3, 'H'), 'sayc')).toContain('仅保证5+张');
  });
  it('describes forced NT after a negative double without inventing jump strength (6802)', () => {
    const obs = position('P P 1D 2H X P', '985.A64.KQ52.KJ6');
    expect(describeCall(obs.auction, obs.seat, b(2, 'NT'), 'sayc')).toContain('12–18 HCP');
    expect(describeCall(obs.auction, obs.seat, b(2, 'NT'), 'sayc')).toContain('被迫');
  });
  it('answers balancing Stayman and accepts a transfer before judging a final contract (6681/3538)', () => {
    expect(decision('1D P P 1NT P 2C P', 'A87.AQ64.AT8.953')).toEqual(b(2, 'H'));
    expect(decision('1NT P 2H P', 'A72.AKJ98.K74.53')).toEqual(b(2, 'S'));
  });
  it('uses stopped NT or a real strong side suit when opener reenters competition (3387/6797)', () => {
    expect(decision('P 1C X P 2S', 'KQ.AK94.Q98.A932')).toEqual(b(2, 'NT'));
    expect(decision('1H 1NT P P', '-.AQJ87.7.AKQJ543')).toEqual(b(2, 'C'));
  });
  it('does not reopen naturally in a suit already shown by either opponent (3514)', () => {
    expect(decision('1D P 1H P 2D P P', 'A952.AQJT32.-.Q54')).not.toEqual(b(2, 'H'));
  });
  it('prefers a known long-major fit after a minimum NT rebid (6862)', () => {
    expect(decision('P 1C P 1S P 1NT P', 'AKJT863.K3.QJ5.7')).toEqual(b(4, 'S'));
  });
  it('keeps constructive natural continuations after earlier interference (3480)', () => {
    expect(decision('P 1D P 1H 1S 2D P', 'K73.KQT3.J97.KQ4')).toEqual(b(3, 'NT'));
  });
  it('uses a forcing major inquiry after NT interference with four-four majors (6872)', () => {
    expect(decision('P 1NT 2C', 'KJ74.KJ94.QJ865.-')).toEqual(b(3, 'C'));
    expect(decision('1NT 2C 3C P', 'AQ82.AJ97.K76.Q2')).toEqual(b(3, 'H'));
  });
  it('answers a first takeout double after an enemy semi-forcing NT sequence (135)', () => {
    expect(decision('1S P 1NT P 2H X P', 'T752.QJ.JT87.K97')).toEqual(b(3, 'D'));
  });
  it('accepts a real game based on partner redouble values (3382)', () => {
    expect(decision('1H X XX P P 2C 2H P', 'KJ4.AK8743.Q8.Q9')).toEqual(b(4, 'H'));
  });
  it('continues an overcall with extras and a real raised major fit (3404)', () => {
    expect(decision('P 1C 1H P 2H P', '-.AJ8764.A843.AK5')).toEqual(b(4, 'H'));
  });
  it('answers a free one-level new suit after a real overcall (83/97)', () => {
    expect(decision('P 1D 1H 1S P', 'KJ.-.AQJT654.A865')).not.toEqual(PASS);
    expect(decision('P 1C 1D 1S P', '984.AJ92.KJ.AJ75')).not.toEqual(PASS);
  });
  it('does not leave a later artificial enemy-suit cue as the contract (6779)', () => {
    expect(decision('P 1C 2C X 2S 3S P', '5.T.Q8752.AKQ952')).toEqual(b(4, 'C'));
  });
  it('does not replace partner game with an unsupported long side suit (6754)', () => {
    expect(decision('P 2S X P 4H P', 'K.T2.AKJ94.AQ762')).toEqual(PASS);
  });
  it('never asks for a trump queen it holds after 1430 (3455)', () => {
    expect(decision('1S P 2NT P 4NT P 5D P', 'AKQT8.A932.A96.7')).toEqual(b(6, 'S'));
  });
  it('uses an actual long suit over a weak two when takeout shape is absent (3451)', () => {
    expect(decision('2D', 'AKQ765.J62.43.A2')).toEqual(b(2, 'S'));
  });
  it('responds to a negative double with a real side suit or stopped NT (3461/6802)', () => {
    expect(decision('P 1D 2S X P', 'Q8.A92.AQ87.9643')).toEqual(b(3, 'C'));
    expect(decision('P P 1D 2H X P', '985.A64.KQ52.KJ6')).toEqual(b(2, 'NT'));
  });
  it('uses the confirmed heart fit and void points after a minimum NT rebid (6679)', () => {
    // Nine HCP plus a diamond void gives thirteen support points opposite public twelve and five hearts.
    expect(decision('P P P 1H P 1S P 1NT P', 'AT752.J43.-.A9852')).toEqual(b(4, 'H'));
  });
  it('raises opener four-card second major rather than passing (3379)', () => {
    expect(decision('P 1D P 1H P 1S P', 'T976.KQ9874.-.J54')).toEqual(b(2, 'S'));
  });
  it('invites or reaches NT game after an original-suit rebid (6770)', () => {
    expect(decision('P 1D P 1H P 2D P', 'A842.Q762.KJ.Q54')).toEqual(b(2, 'NT'));
  });
  it('uses fourth-suit forcing for an unlimited strong unbalanced responder (64)', () => {
    expect(decision('P 1D P 1H P 2C P', 'KJ74.AKQ932.J.Q5')).toEqual(b(2, 'S'));
  });
  it('shows reverse strength before concealing it in the original suit (3439)', () => {
    expect(decision('P P 1D P 1S P', 'T.AK85.AKQJ76.54')).toEqual(b(2, 'H'));
  });
  it('retains an opener jump-shift game force in a longer sequence (3397)', () => {
    expect(decision('P 1C P 1H P 2S P', '52.KQ96.9864.QJ5')).not.toEqual(PASS);
  });
  it('continues a constructive misfit after a one-level second suit (6747)', () => {
    expect(decision('P 1C P 1H P 1S P', '754.AQJ83.AT83.2')).toEqual(b(2, 'D'));
  });
  it('uses a genuine club lead double of an artificial support cue, rather than treating it as penalty (6702)', () => {
    const obs = position('P 1C 1H P 2C', 'A53.9.A532.AQ976');
    const call: Call = { kind: 'double' };
    expect(chooseBid(obs, 'sayc')).toEqual(call);
    expect(describeCall(obs.auction, obs.seat, call, 'sayc')).toContain('首攻指示');
  });
  it('continues a strong long opener suit after a nonforcing response to a double (3408)', () => {
    expect(decision('P 1S X 2H P', 'AKQJ85.J7.K2.A98')).toEqual(b(3, 'S'));
    const obs = position('1S X', 'Q5.KQT987.763.52');
    expect(describeCall(obs.auction, obs.seat, b(2, 'H'), 'sayc')).toContain('不逼叫');
  });
  it('can compete again with a good seven-card major despite a semi-forcing NT response (6720)', () => {
    expect(decision('1H P 1NT 2S', 'J9.AKQJ542.J76.4')).toEqual(b(3, 'H'));
  });
  it('uses the balancing NT range when choosing Stayman or an invitation (6681)', () => {
    expect(decision('1S P P 1NT P', 'KQT9.KQJ6.T7.QT2')).toEqual(b(2, 'C'));
  });
  it('answers a one-level free response after a double (6735)', () => {
    expect(decision('1D X 1H P', 'J.K962.AJ742.K43')).toEqual(b(2, 'H'));
  });
  it('reaches game after a negative double finds a real major fit (6745)', () => {
    expect(decision('P 1D 1H X P 1S P', 'KQT9.J85.J7.AQ86')).toEqual(b(4, 'S'));
  });
  it('invites after a minimum NT reply to a negative double (3389)', () => {
    expect(decision('P P 1D 1S X P 1NT P', 'J87.AKT6.AT85.T7')).toEqual(b(2, 'NT'));
  });
  it('shows a strong two-suited opener via a jump shift (3397)', () => {
    expect(decision('P 1C P 1H P', 'AK84.A.Q3.AKT643')).toEqual(b(2, 'S'));
  });
  it('does not turn a natural weak correction after semi-forcing NT into Stayman (43)', () => {
    expect(decision('P 1S P 1NT P 2C P 2H P', 'KQ875.5.QJ4.AQ53')).toEqual(PASS);
  });
  it('answers a free natural new suit rather than passing (6713)', () => {
    expect(decision('1D 2C 2H P', 'KQJ5.QJT.QJ65.65')).toEqual(b(3, 'H'));
  });
  it('responds naturally with a stopper after an overcall (6667)', () => {
    expect(decision('P P 1C 1H', 'Q95.KJ2.J76.Q872')).toEqual(b(1, 'NT'));
  });
  it('does not call an enemy previously bid major as a natural overcall (3374)', () => {
    expect(decision('P 1S P 1NT P 2D', 'QJT43.AQT.K952.Q')).toEqual(PASS);
  });
  it('does not apply negative doubles to the overcalling side (6698)', () => {
    expect(decision('P P 1C 1S 2H', 'A864.JT5.J8754.K')).not.toEqual({ kind: 'double' });
  });
  it('shows the long major naturally rather than using a negative double (3371)', () => {
    expect(decision('P 1H 2D', 'AQJT8762.-.Q8.T32')).toEqual(b(2, 'S'));
  });
  it('invites with eleven support points and avoids an unsupported artificial enemy cue (3391)', () => {
    // 7 HCP + singleton spade (3) + ninth publicly known trump (1) = 11.
    expect(decision('P 1H 1S', 'T.A852.874.K9532')).toEqual(b(3, 'H'));
  });
  it('responds in the longer major with five spades and four hearts (3392)', () => {
    expect(decision('1C P', 'J5432.J975.K6.QT')).toEqual(b(1, 'S'));
  });
  it('shows an invitational long minor before choosing a weak preference (3376)', () => {
    expect(decision('1H P 1NT P 2C P', 'QJ.Q9.JT7432.AJ5')).toEqual(b(3, 'D'));
  });
  it('escapes a void in the rebid major with a six-card side suit (3361)', () => {
    expect(decision('1S P 1NT P 2S P', '-.KQ8753.J9532.73')).toEqual(b(3, 'H'));
  });
  it('does not label a delayed support cue as Michaels (6702)', () => {
    const obs = position('P 1C 1H P 2C', 'A53.9.A532.AQ976');
    expect(describeCall(obs.auction, obs.seat, { kind: 'double' }, 'sayc')).not.toContain('Michaels');
  });
  it('answers Stayman before evaluating a final game contract (3333)', () => {
    expect(decision('1NT P 2C P', 'AQJ64.A43.A83.54')).toEqual(b(2, 'S'));
  });
  it('accepts a transfer with a minimum NT opener (5)', () => {
    expect(decision('P 1NT P 2H P', 'AT53.K87.AQJ.J64')).toEqual(b(2, 'S'));
  });
  it('does not turn a two-card preference into an eight-card fit (2)', () => {
    expect(decision('P P P 1S P 1NT P 2H P 2S P', 'AJT93.KJ43.A43.Q')).toEqual(PASS);
  });
  it('answers a balancing takeout double over a three-level preempt (3352)', () => {
    expect(decision('3H P P X P', '842.4.AKJ97.K942')).toEqual(b(4, 'D'));
  });
  it('answers a takeout double of a raised suit (3339)', () => {
    expect(decision('1S P 2S X P', '63.Q83.AJ9832.J5')).toEqual(b(3, 'D'));
  });
  it('explains an own doubled contract without attributing it to partner (1)', () => {
    const obs = position('1D P P X', '9654.KT.KQ92.AT7');
    const text = describeCall(obs.auction, obs.seat, PASS, 'sayc');
    expect(text).toContain('自己');
    expect(text).toContain('加倍');
    expect(text).not.toContain('接受搭档');
  });
  it('describes Jacoby shortness and the agreed major (3342)', () => {
    const obs = position('1S P 2NT P', 'A9872.AQJ62.82.Q');
    expect(describeCall(obs.auction, obs.seat, b(3, 'C'), 'sayc')).toContain('短门');
    const responder = position('1S P 2NT P 3C P', 'KQ3.K3.AJ63.KT93');
    expect(describeCall(responder.auction, responder.seat, b(4, 'S'), 'sayc')).toContain('将牌');
    expect(describeCall(responder.auction, responder.seat, b(4, 'S'), 'sayc')).not.toContain('新花色');
  });
});

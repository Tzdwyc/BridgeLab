import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { publicPlayerConstraints, publicCallMeaningAt, publicStrongMinorTrialAt, publicControlCueAt } from '../src/ai/bidding-semantics';
import { feasiblePublicKeycardCounts, publicSupportMinimum } from '../src/ai/suit-evaluation';
import { type BiddingObservation } from '../src/ai/observation';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS, partnerOf } from '../src/core/types';

const call = (text: string): Call => text === 'P' ? PASS : text === 'X' ? { kind: 'double' }
  : text === 'XX' ? { kind: 'redouble' } : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
function position(seat: Seat, holding: string, prefix: string): BiddingObservation {
  const hand: Card[] = holding.split('.').flatMap((text, index) => [...text.replace('-', '')].map(symbol => {
    const suit = (['S', 'H', 'D', 'C'] as Suit[])[index], rank = '23456789TJQKA'.indexOf(symbol) + 2;
    return { suit, rank, id: `${suit}${rank}` };
  }));
  expect(hand).toHaveLength(13);
  const auction: AuctionEntry[] = prefix.split(' ').filter(Boolean).map(token => {
    const [actor, text] = token.split(':'); return { seat: actor as Seat, call: call(text) };
  });
  return { phase: 'auction', board: 1, vulnerability: 'None', seat, actingSeat: seat,
    hand, auction, legalCalls: legalCalls(auction, seat) };
}

describe('release13 public-source repairs', () => {
  it.each([
    ['six KQJ minor plus two AK entries', 'N', 'AK9.AK6.KQJ653.7', 'N:1D E:P S:1H W:P', '3NT'],
    ['six AK minor plus outside entries', 'W', 'A.KT7.AK8643.AQJ', 'W:1D N:P E:1H S:P', '3NT'],
    ['six AKT minor plus stopped sides', 'S', 'A4.KQ6.A3.AKT932', 'N:P E:P S:1C W:P N:1H E:P', '3NT'],
    ['good AJT six competes without two Q-high honors', 'E', 'Q.832.AKQ.AJT972', 'E:1C S:1S W:P N:2S', '3C'],
    ['strong technical double can describe a real five at four level', 'E', 'Q.A76.AK32.KQT97', 'W:P N:2S E:X S:P W:3D N:3S', '4C'],
    ['stopper cue answer retains real sixteen points', 'W', 'K2.A4.KQJ75.KT95', 'W:1D N:P E:1H S:1S W:2C N:2S E:3S S:P', '3NT'],
    ['balanced double known game begins a strong cue', 'W', 'K76.Q.AT73.AK852', 'S:1C W:P N:P E:X S:1H', '2C'],
    ['completed Stayman is not fourth-suit forcing', 'E', 'AK54.Q6.KJ52.A76', 'W:1NT N:P E:2C S:P W:2D N:P', '4NT'],
    ['quantitative public minimum reaches33', 'E', 'Q84.AK.AQ643.842', 'S:P W:1D N:P E:3NT S:P W:4NT N:P', '6NT'],
    ['passed responder singleton permits real second four-card suit', 'W', '4.KJT62.J862.AK8', 'E:P S:P W:1H N:P E:1S S:P', '2D'],
    ['weak interrupted strong club uses defined negative Pass', 'W', 'JT85.J765.83.732', 'W:P N:P E:2C S:P W:2D N:P E:3D S:3H', 'P'],
  ])('%s', (_name, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat as Seat, holding, prefix), 'sayc')).toEqual(call(expected));
  });
  it.each([
    ['public zero response does not fund a four-heart game', 'N', '94.AQ976.AKJ5.K8', 'E:3C S:P W:P N:X E:P S:3H W:4C', 'P'],
    ['weak reverse responder gives minimum diamond preference', 'E', '92.T87.9753.QJ43', 'W:1D N:P E:P S:1S W:2H N:P', '3D'],
    ['five-card support to public three clubs reaches game', 'N', 'AK7.AQ74.9.J9842', 'S:1C W:P N:1H E:P S:1NT W:P', '5C'],
    ['twenty-point six-four shows a truthful GF second suit', 'N', 'A62.-.AQ98.AKQJT3', 'N:1C E:P S:1H W:P', '3D'],
    ['negative doubler supports a real four-four fit affordably', 'W', 'J752.Q965.63.QJ2', 'N:P E:1C S:1D W:X N:P E:1S S:P', '2S'],
    ['strong NT transfer responder describes second five before ending exploration', 'N', 'A53.AQ974.JT754.-', 'S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P', '4D'],
    ['reverse known25 and enemy stopper reach NT game', 'S', 'K9652.T87.AJT5.2', 'W:P N:1C E:2D S:P W:P N:2H E:P', '3NT'],
  ])('%s', (_name, seat, holding, prefix, expected) => {
    expect(chooseBid(position(seat as Seat, holding, prefix), 'sayc')).toEqual(call(expected));
  });
  it('does not generalize six-card strong NT to a weak six-card minor', () => {
    expect(chooseBid(position('N', 'K98.A76.KJ653.72', 'N:1D E:P S:1H W:P'), 'sayc')).not.toEqual(call('3NT'));
  });
  it('shows its own spade control after game without assuming the missing diamond control for RKCB', () => {
    const obs = position('N', 'A53.AQ974.JT754.-', 'S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P N:3NT E:P S:4H W:P');
    // Five hearts plus partner's public three confirm eight. Own11HCP and
    // club void supply15 support opposite public22+, but JT754 has no D
    // control. The release15 artificial4S cue shows our actual spadeAce;
    // it does not assume partner's hidden controls or ask RKCB prematurely.
    const chosen = chooseBid(obs, 'sayc');
    expect(chosen).toEqual(call('4S'));
    expect(publicControlCueAt([...obs.auction, { seat: obs.seat, call: chosen }], obs.auction.length, 'sayc'))
      .toMatchObject({ trump: 'H', suit: 'S', control: 'first-or-second-round' });
    expect(publicCallMeaningAt([...obs.auction, { seat: obs.seat, call: chosen }], obs.auction.length, 'sayc'))
      .toMatchObject({ artificial: true, forcing: 'one-round' });
  });
  it('cannot show a spade control it does not hold after the same transfer and heart game', () => {
    const obs = position('N', 'Q53.AQ974.JT754.-', 'S:2C W:P N:2D E:P S:2NT W:P N:3D E:P S:3H W:P N:3NT E:P S:4H W:P');
    expect(chooseBid(obs, 'sayc')).not.toEqual(call('4S'));
  });
});

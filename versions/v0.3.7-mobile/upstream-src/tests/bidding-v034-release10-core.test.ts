import { describe, expect, it } from 'vitest';
import { chooseBid, describeCall } from '../src/ai/bidding';
import { legalCalls } from '../src/core/auction';
import { publicPlayerConstraints, publicCallMeaningAt, publicStrongMinorTrialAt } from '../src/ai/bidding-semantics';
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

describe('release10 truthful public candidates and continuation', () => {
  it('checks a minor repeat when partner has only doubled and no natural bid exists', () => {
    const prefix = 'S:1C W:2NT N:X E:3H';
    for (const holding of ['KJ.75.A9.AQJT873', 'KJ.754.A9.AQJT83']) {
      const obs = position('S', holding, prefix);
      expect(() => chooseBid(obs, 'sayc')).not.toThrow();
      const chosen = chooseBid(obs, 'sayc');
      expect(obs.legalCalls).toContainEqual(chosen);
      if (holding === 'KJ.75.A9.AQJT873') expect(chosen).toEqual(call('4C'));
      else expect(chosen).not.toEqual(call('4C'));
      const meaning = publicCallMeaningAt([...obs.auction, { seat: 'S', call: chosen }], obs.auction.length, 'sayc');
      expect(meaning.defined).toBe(true);
      expect(publicPlayerConstraints(obs.auction, 'N', 'sayc').suitMinimums.C ?? 0).toBe(0);
    }
    // Length alone does not turn a weak source into a strong four-level repeat.
    expect(chooseBid(position('S', 'KQ.AK.A2.J987654', prefix), 'sayc')).not.toEqual(call('4C'));
    expect(chooseBid(position('S', 'KJ.75.92.KQJT873', prefix), 'sayc')).not.toEqual(call('4C'));
    expect(chooseBid(position('S', 'KJ.75.AQJT873.A9', 'S:1D W:2NT N:X E:3C'), 'sayc')).toEqual(call('3D'));
  });
  it('uses nonjump six-heart escape while retaining a two-spade preference', () => {
    const prefix = 'N:1S E:P S:1NT W:P N:2S E:P';
    const obs = position('S', '-.KQ8753.J9532.73', prefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call('3H'));
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'S', call: call('3H') }], obs.auction.length, 'sayc');
    expect(meaning).toMatchObject({ role: 'semi-nt-major-escape', forcing: 'none', invitation: false,
      hcpRange: { min: 5, max: 12 }, suitMinimums: { H: 6 }, suitMaximums: { S: 1 } });
    expect(chooseBid(position('S', '-.KQ875.J9532.732', prefix), 'sayc')).not.toEqual(call('3H'));
    expect(chooseBid(position('S', '32.KQ8753.J95.73', prefix), 'sayc')).toEqual(PASS);
    expect(chooseBid(position('S', '-.QJ8753.9532.732', prefix), 'sayc')).not.toEqual(call('3H'));
    const jump = position('S', '-.KQ8753.J9532.73', 'N:1S E:P S:1NT W:P N:2D E:P');
    const jumpMeaning = publicCallMeaningAt([...jump.auction, { seat: 'S', call: call('3H') }], jump.auction.length, 'sayc');
    expect(jumpMeaning).toMatchObject({ invitation: true, hcpRange: { min: 10, max: 12 } });
    expect(chooseBid(jump, 'sayc')).not.toEqual(call('3H'));
  });
  it('describes a real five-card minor after the negative-double answer is completed', () => {
    const prefix = 'N:P E:P S:P W:1C N:1H E:X S:P W:2C N:P';
    const obs = position('E', 'KT65.K74.QT742.2', prefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call('2D'));
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'E', call: call('2D') }], obs.auction.length, 'sayc');
    expect(meaning).toMatchObject({ forcing: 'none', hcpRange: { min: 6 }, suitMinimums: { D: 5 } });
    expect(chooseBid(position('E', 'KT65.K74.QT74.32', prefix), 'sayc')).not.toEqual(call('2D'));
    expect(chooseBid(position('E', 'JT65.Q74.QT742.2', prefix), 'sayc')).not.toEqual(call('2D'));
  });
  it.each([
    ['N', 'J542.AJ5.J2.KQ63', 'S:1D W:2NT N:X E:3C S:3S W:P', '4S'],
    ['E', '-.KJ53.QT86.K7653', 'N:P E:P S:P W:1S N:P E:1NT S:P W:2D N:P', '4D'],
    ['E', '82.KQ.Q9642.AT94', 'W:1D N:P', '4D'],
    ['E', 'JT2.7.AK983.Q643', 'N:P E:P S:P W:1D N:P', '4D'],
    ['N', 'AKQ53.4.AKT3.KT4', 'E:3C S:3H W:P', '3S'],
    ['S', 'AKJT42.KQJ7.973.-', 'W:P N:P E:1D S:1S W:P N:P E:2C', '2S'],
    ['N', '52.AKJ86.AT.AQ82', 'E:P S:P W:P N:1H E:P S:1S W:P N:2C E:P S:2H W:P', '2NT'],
    ['E', 'T964.AQJ7642.-.KQ', 'W:2D N:P E:P S:2NT W:P N:P E:3H S:P W:4D N:P', '4H'],
    ['S', 'AK6.J876.T3.KQJ5', 'W:P N:P E:1D S:X W:XX N:P E:P', '1H'],
    ['S', '4.T5.J7632.KJ985', 'E:P S:P W:P N:1S E:P S:1NT W:P N:3H E:P', '4D'],
  ] as const)('keeps a truthful next step: %s %s', (seat, hand, prefix, expected) => {
    const obs = position(seat, hand, prefix), chosen = chooseBid(obs, 'sayc');
    expect(chosen).toEqual(call(expected));
    expect(publicCallMeaningAt([...obs.auction, { seat, call: chosen }], obs.auction.length, 'sayc').defined).toBe(true);
  });
  it('does not silently call a five-card forced minor six', () => {
    const obs = position('S', '4.T5.J7632.KJ985', 'E:P S:P W:P N:1S E:P S:1NT W:P N:3H E:P');
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'S', call: call('4D') }], obs.auction.length, 'sayc');
    expect(meaning.suitMinimums.D).toBe(5);
    expect(describeCall(obs.auction, 'S', call('4D'), 'sayc')).not.toContain('6+');
  });
  it('publishes thirteen raw and F1 for a first higher major above a three-level overcall', () => {
    const obs = position('N', 'AKQ53.4.AKT3.KT4', 'E:3C S:3H W:P');
    expect(chooseBid(obs, 'sayc')).toEqual(call('3S'));
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'N', call: call('3S') }], obs.auction.length, 'sayc');
    expect(meaning.hcpRange?.min).toBe(13);
    expect(meaning.forcing).toBe('one-round');
    expect(chooseBid(position('N', 'KJ953.4.QT73.QT4', 'E:3C S:3H W:P'), 'sayc')).not.toEqual(call('3S'));
    // The usual affordable two-level advance still uses8+/five/NF.
    const cheap = position('N', 'KJ953.4.QT73.QT4', 'E:2D S:2H W:P');
    expect(chooseBid(cheap, 'sayc')).toEqual(call('2S'));
    expect(publicCallMeaningAt([...cheap.auction, { seat: 'N', call: call('2S') }], cheap.auction.length, 'sayc').forcing).toBe('none');
  });
  it('does not turn a takeout-redoubled escape rule into an automatic flight from a real trump stack', () => {
    const obs = position('E', 'A73.KJ8.KJ96.A84', 'N:1D E:X S:XX W:P N:P');
    expect(chooseBid(obs, 'sayc')).toEqual(PASS);
  });
  it('declines a six-spade invitation at twenty-four and accepts twenty-five', () => {
    const prefix = 'N:1D E:P S:1S W:P N:1NT E:P S:3S W:P';
    expect(chooseBid(position('N', 'T6.AK75.T943.AK8', prefix), 'sayc')).toEqual(PASS);
    expect(chooseBid(position('N', 'T6.AK75.J943.AK8', prefix), 'sayc')).toEqual(call('4S'));
  });
  it('does not turn a club-void GF hand into an unstopped NT game', () => {
    const obs = position('W', 'KQJT986.K4.AJ83.-', 'S:P W:1S N:P E:2H S:P W:2S N:P E:3H S:P');
    const chosen = chooseBid(obs, 'sayc');
    expect(chosen).not.toEqual(call('3NT'));
    expect(chosen.kind).toBe('bid');
  });
  it('keeps stopped strong NT before an expensive second-suit reply to negative X', () => {
    expect(chooseBid(position('E', 'KQ.AK94.Q98.A932', 'N:P E:1C S:X W:P N:2S'), 'sayc')).toEqual(call('2NT'));
    const prefix = 'N:1D E:2S S:X W:P';
    expect(chooseBid(position('N', 'AQ.K2.AJT76.AQ43', prefix), 'sayc')).toEqual(call('3NT'));
    expect(chooseBid(position('N', 'Q9.AK.AJT76.AJ43', prefix), 'sayc')).not.toEqual(call('3NT'));
  });
  it.each([
    ['AK2.QJ3.AJ4.Q985', '4NT'],
    ['AK2.KJ3.AJ4.Q985', '6NT'],
    ['AK2.AJ3.AJ4.K985', '5NT'],
  ])('preserves quantitative thresholds before a generic NT game: %s', (holding, expected) => {
    expect(chooseBid(position('S', holding, 'N:1NT E:P'), 'sayc')).toEqual(call(expected));
  });
  it('does not invent a seven-point Stayman contract over a fifteen-eighteen overcall', () => {
    const prefix = 'N:P E:1C S:1NT W:P';
    expect(chooseBid(position('N', '9653.T9.KQ76.Q96', prefix), 'sayc')).toEqual(PASS);
    expect(chooseBid(position('N', '9653.T9.KQ76.K96', prefix), 'sayc')).toEqual(call('2C'));
  });
  it('uses raw Jacoby no-shortness bands rather than adjusted support', () => {
    const prefix = 'S:1H W:P N:2NT E:P';
    expect(chooseBid(position('S', '74.AK963.KJ83.KQ', prefix), 'sayc')).toEqual(call('3NT'));
    expect(chooseBid(position('S', 'Q4.AK963.KJ83.KQ', prefix), 'sayc')).toEqual(call('3H'));
  });
  it('accepts the separate semiNT ten-twelve invitation at fifteen, not fourteen', () => {
    const prefix = 'N:1H E:P S:1NT W:P N:2C E:P';
    expect(chooseBid(position('S', 'AQJ7.K8.T852.T83', prefix), 'sayc')).toEqual(call('2NT'));
    const accepted = `${prefix} S:2NT W:P`;
    expect(chooseBid(position('N', 'K2.AQ987.K2.K984', accepted), 'sayc')).toEqual(call('3NT'));
    expect(chooseBid(position('N', 'K2.AJ987.K2.K984', accepted), 'sayc')).toEqual(PASS);
  });
  it('uses strong NT quantitative invitation evidence despite the earlier zero-point waiting reply', () => {
    const prefix = 'N:2C E:P S:2D W:P N:2NT E:P S:4NT W:P';
    expect(chooseBid(position('N', 'AKQ2.AJ3.AQ4.KJ8', prefix), 'sayc')).toEqual(call('6NT'));
    expect(chooseBid(position('N', 'AKQ2.AJ3.KQ4.K98', prefix), 'sayc')).toEqual(PASS);
  });
  it('bounds self long-major game to its actual eighteen-point two-suit playing source', () => {
    const prefix = 'N:1S E:3C S:P W:4C';
    expect(chooseBid(position('N', 'AQJT86.AK965.AT.-', prefix), 'sayc')).toEqual(call('4S'));
    for (const holding of ['AQJT86.AK965.KT.-', 'AQJT86.AK96.AT.2', 'AQJ986.AJ965.KQ.-'])
      expect(chooseBid(position('N', holding, prefix), 'sayc')).not.toEqual(call('4S'));
    const obs = position('N', 'AQJT86.AK965.AT.-', prefix);
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'N', call: call('4S') }], obs.auction.length, 'sayc');
    expect(meaning.suitMinimums.S).toBe(6);
    expect(meaning.selfLongGameQualification).toMatchObject({ minHcp: 18, minQuickTricks: 4, maxLosingTricks: 3 });
  });
});

describe('release10 keycards retain correlated public evidence', () => {
  it('excludes zero only when the remaining honors cannot fit the declared support', () => {
    const prefix = 'S:1H W:P N:1S E:P S:4S W:P';
    const obs = position('N', 'Q876.J.KQ763.AJ4', prefix);
    const publicMate = publicPlayerConstraints(obs.auction, partnerOf(obs.seat), 'sayc');
    expect(feasiblePublicKeycardCounts(obs.hand, 'S', publicMate, [0, 3])).toEqual([3]);
    // Removing the strong support contract restores a genuine zero-key hand.
    expect(feasiblePublicKeycardCounts(obs.hand, 'S', { ...publicMate, supportRanges: {},
      pointSources: publicMate.pointSources.filter(source => source.type === 'hcp') }, [0, 3])).toEqual([0, 3]);
    expect(chooseBid(position('N', 'Q876.J.KQ763.AJ4', `${prefix} N:4NT E:P S:5D W:P`), 'sayc')).toEqual(call('6S'));
  });
  it('does not use support points to exclude a valid zero-key short-control hand', () => {
    const prefix = 'W:1D N:P E:1S S:P W:3S N:P E:4C S:P';
    const obs = position('W', 'AQT3.5.AT92.K963', prefix);
    expect(feasiblePublicKeycardCounts(obs.hand, 'S', publicPlayerConstraints(obs.auction, 'E', 'sayc'), [0, 3])).toEqual([0, 3]);
    expect(chooseBid(position('W', 'AQT3.5.AT92.K963', `${prefix} W:4NT N:P E:5D S:P`), 'sayc')).toEqual(call('5S'));
  });
  it('keeps clubs at game when a two-key reply can still lack trump ace and queen', () => {
    // A legal public mate KJ3.A.A8765.T987 has12 raw, fiveD/fourC,
    // two keys but no CA/CQ. Asking4NT would have no safe game stop on5H.
    const obs = position('E', 'A.KQJ532.K9.KJ42', 'W:1D N:P E:1H S:P W:2C N:P');
    expect(chooseBid(obs, 'sayc')).not.toEqual(call('4NT'));
  });
});

describe('release10 strict NT shape and declared minor controls', () => {
  const strict = 'N:P E:1D S:P W:1S N:P E:1NT S:P';
  it('shows genuine eleven-raw five-five majors as GF over strict balanced NT', () => {
    const obs = position('W', 'AT943.QJT42.K.J9', strict);
    expect(chooseBid(obs, 'sayc')).toEqual(call('3H'));
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'W', call: call('3H') }], obs.auction.length, 'sayc');
    expect(meaning.forcing).toBe('game');
    expect(meaning.suitMinimums).toMatchObject({ S: 5, H: 5 });
    expect(chooseBid(position('E', 'K2.AJ3.KQJ76.984', `${strict} W:3H N:P`), 'sayc')).toEqual(call('4H'));
  });
  it('does not publish the eleven-point GF on a ten-point or four-heart hand', () => {
    expect(chooseBid(position('W', 'AT943.QJT42.Q.J9', strict), 'sayc')).not.toEqual(call('3H'));
    expect(chooseBid(position('W', 'AT943.QJT4.K2.J9', strict), 'sayc')).not.toEqual(call('3H'));
  });
  const trialPrefix = 'W:1C N:P E:1H S:P W:2NT N:P E:3D S:P W:3NT N:P';
  it('publishes a genuine long-minor all-control trial before keycards', () => {
    const obs = position('E', '-.AKT72.QJT8643.Q', trialPrefix);
    expect(chooseBid(obs, 'sayc')).toEqual(call('4D'));
    const contract = publicStrongMinorTrialAt([...obs.auction, { seat: 'E', call: call('4D') }], obs.auction.length, 'sayc');
    expect(contract?.ownMinimum).toBe(6);
    const meaning = publicCallMeaningAt([...obs.auction, { seat: 'E', call: call('4D') }], obs.auction.length, 'sayc');
    expect(meaning.forcing).toBe('one-round');
    expect(meaning.controlSuits).toMatchObject({ C: 'first-or-second-round', H: 'first-or-second-round', S: 'first-or-second-round' });
    expect(meaning.agreedTrump).toBe('D');
    const receiver = `${trialPrefix} E:4D S:P`;
    expect(chooseBid(position('W', 'K932.85.AK9.AKJ2', receiver), 'sayc')).toEqual(call('4NT'));
    // Receiver owns three keys but no diamond queen. The queen question
    // after5C would cross safe5D, so stop without reading caller's actualQ.
    expect(chooseBid(position('W', 'K932.85.AK9.AKJ2', `${receiver} W:4NT N:P E:5C S:P`), 'sayc')).toEqual(call('5D'));
  });
  it.each(['-.QJT72.QJT8643.Q', '2.AKT72.QJT86.Q2', '-.JT972.JT98643.Q'])
    ('does not emit the same strong trial without controls, length or points: %s', holding => {
      expect(chooseBid(position('E', holding, trialPrefix), 'sayc')).not.toEqual(call('4D'));
    });
  it('does not transplant a GF trial into an ordinary first minor introduction', () => {
    const prefix = 'W:1C N:P E:1H S:P W:2NT N:P';
    const obs = position('E', '-.AKT72.QJT8643.Q', prefix);
    expect(publicStrongMinorTrialAt([...obs.auction, { seat: 'E', call: call('4D') }], obs.auction.length, 'sayc')).toBeUndefined();
    expect(chooseBid(obs, 'sayc')).not.toEqual(call('4D'));
  });
  it('retains strict shape families in a public support floor', () => {
    const constraints = publicPlayerConstraints(position('W', 'AT943.QJT42.K.J9', strict).auction, 'E', 'sayc');
    expect(constraints.strictBalancedShapeFamily).toEqual(['4333', '4432', '5332']);
    expect(publicSupportMinimum('H', 5, { ...constraints, suitMinimums: { ...constraints.suitMinimums, H: 3 } })).toBeGreaterThanOrEqual(13);
  });
});

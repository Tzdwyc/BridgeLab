import { describe, expect, it } from 'vitest';
import { legalCalls } from '../src/core/auction';
import { type AuctionEntry, type Call, type Card, type Seat, type Strain, type Suit, PASS } from '../src/core/types';
import { type BiddingObservation } from '../src/ai/observation';
import { chooseCompetitiveCall } from '../src/ai/competition';
import { chooseBid } from '../src/ai/bidding';
import { publicCallMeaningAt, publicPlayerConstraints } from '../src/ai/bidding-semantics';

const bid = (level: number, strain: Strain): Call => ({ kind: 'bid', level, strain });
const seats: Seat[] = ['N', 'E', 'S', 'W'];
function observation(start: Seat, text: string, holding: string): BiddingObservation {
  const auction: AuctionEntry[] = text.split(' ').map((token, index) => ({ seat: seats[(seats.indexOf(start) + index) % 4],
    call: token === 'P' ? PASS : token === 'X' ? { kind: 'double' } : token === 'XX' ? { kind: 'redouble' }
      : bid(Number(token[0]), token.slice(1) as Strain) }));
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const hand: Card[] = holding.split('.').flatMap((cards, i) => [...cards.replace('-', '')].map(symbol => ({
    id: `${suits[i]}${symbol}`, suit: suits[i], rank: '23456789TJQKA'.indexOf(symbol) + 2
  })));
  if (hand.length !== 13) throw new Error('Reviewed fixture must hold thirteen cards');
  const seat = seats[(seats.indexOf(start) + auction.length) % 4];
  return { board: 1, phase: 'auction', seat, actingSeat: seat, auction, hand,
    legalCalls: legalCalls(auction, seat), vulnerability: 'None' };
}
const competitive = (start: Seat, prefix: string, hand: string) => chooseCompetitiveCall(observation(start, prefix, hand), 'sayc');

describe('approved read-only audit: competitive obligations and public strength', () => {
  it('573: a support cue requiring a game-level answer requires game strength', () => {
    expect(competitive('E', 'P 1S 2H 2S', '84.K43.AQT32.J86')).toEqual(bid(3, 'H'));
    expect(competitive('E', 'P 1S 2H 2S', 'AK.K43.AQT32.J86')).toEqual(bid(4, 'H'));
  });
  it('7741: named Michaels minor counts unavoidable public shortness before choosing game', () => {
    // Public 5H/5C opposite four clubs leaves unavoidable shortness: both
    // hands have a support floor15, exceeding the minor-game threshold29.
    expect(competitive('E', 'P P 1S 2S P 2NT P 3C 3S', 'K976.5.KJ74.A752')).toEqual(bid(5, 'C'));
    expect(competitive('E', 'P P 1S 2S P 2NT P 3C 3S', 'Q976.5.9742.8752')).toEqual(PASS);
  });
  it('4600: a minimum Michaels preference creates no invitation or automatic game', () => {
    expect(competitive('N', 'P P 1S 2S P', 'T9874.J76.84.KQ9')).toEqual(bid(3, 'H'));
    expect(competitive('N', 'P P 1S 2S P 3H 3S P P', 'T9874.J76.84.KQ9')).toEqual(PASS);
  });
  it('4198: a delayed free answer in an enemy-mentioned suit is natural and nonforcing', () => {
    const obs = observation('S', 'P P 1H X 1S P 2H P P 2S P', 'KJ7.52.K875.AJ87');
    const meaning = publicCallMeaningAt(obs.auction, 9, 'sayc');
    expect(meaning.artificial).toBe(false);
    expect(meaning.forcing).toBe('none');
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(PASS);
  });
  it('7732: a public strong takeout rebid retains 17+ through later natural preferences', () => {
    for (const prefix of ['P 1H X P 2D P 3C P', 'P 1H X P 2D P 3C P 3D 3H P P']) {
      const obs = observation('N', prefix, 'T8.AK54.T8532.JT');
      expect(publicPlayerConstraints(obs.auction, 'S', 'sayc').hcpRange?.min).toBeGreaterThanOrEqual(17);
      expect(chooseCompetitiveCall(obs, 'sayc')).toEqual(bid(3, 'NT'));
      expect(competitive('N', prefix, 'T8.AQ54.T8532.JT')).not.toEqual(bid(3, 'NT'));
    }
  });
  it('a forced takeout cue answer does not manufacture a public 17-point minimum', () => {
    const obs = observation('N', 'P 1H X P 2H P 3C P', 'T8.AK54.T8532.JT');
    expect(publicPlayerConstraints(obs.auction, 'S', 'sayc').hcpRange?.min).toBeLessThan(17);
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(3, 'NT'));
  });
  it('sound six-card sixteen-point majors are shown directly, not via a false strong X rebid', () => {
    expect(competitive('N', '1C', 'KQ4.KQT854.Q94.A')).toEqual(bid(1, 'H'));
    expect(competitive('N', '1C P P', 'KQ4.KQT854.Q94.A')).toEqual(bid(1, 'H'));
    const obs = observation('N', '1C X P 1D P', 'KQ4.KQT854.Q94.A');
    expect(chooseCompetitiveCall(obs, 'sayc')).not.toEqual(bid(1, 'H'));
  });
  it('4387: strength redouble preserves an independently established NT game', () => {
    for (const prefix of ['1D X XX P P 2C', '1D X XX P P 2C P P 2D P']) {
      expect(competitive('W', prefix, 'AJ76.95.A95.A762')).toEqual(bid(3, 'NT'));
      expect(competitive('W', prefix, 'AT76.95.A95.A762')).not.toEqual(bid(3, 'NT'));
    }
  });
  it('strength redouble chooses a known major game before NT', () => {
    expect(competitive('W', '1S X XX P P 2D', 'KT7.K8.T753.KQJ5')).toEqual(bid(4, 'S'));
    expect(competitive('W', '1S X XX P P 2D', 'KT7.K8.T753.KQT5')).toEqual(bid(4, 'S'));
    expect(competitive('W', '1S X XX P P 2D', 'KT7.K8.T753.KJT5')).toEqual(bid(3, 'S'));
  });
  it('7535: a playable seven-card major takes priority over an incidental artificial-suit lead double', () => {
    expect(competitive('W', 'P P 2C', '8.KJT9542.-.AQ852')).toEqual(bid(2, 'H'));
    expect(competitive('W', 'P P 2C', 'Q85.963.K54.AKJ2')).toEqual({ kind: 'double' });
    expect(competitive('W', 'P P 2C', 'Q85.963.AK4.J872')).not.toEqual({ kind: 'double' });
  });
  it('946: real four-card trump defense remains eligible; a lone trump queen does not', () => {
    const obs = observation('S', '1C P 1H 1S X 2S P P', 'AK94.QJ2.J.KQT94');
    obs.vulnerability = 'EW';
    expect(chooseCompetitiveCall(obs, 'sayc')).toEqual({ kind: 'double' });
    const thin = observation('S', '1C P 1H 1S X 2S P P', 'Q974.AJ2.J.AKT94');
    thin.vulnerability = 'EW';
    expect(chooseCompetitiveCall(thin, 'sayc')).not.toEqual({ kind: 'double' });
  });
  it('7424: a nonforcing five-card side suit does not start a three-level correction loop', () => {
    expect(competitive('N', 'P P P 1D 1H P 2C 2D 2H P', 'K983.A.QT9.Q8743')).toEqual(PASS);
    expect(competitive('N', 'P P P 1D 1H P 2C 2D 2H P 3C P', 'AT64.K9742.73.K5')).toEqual(PASS);
  });
  it('4443: two-card preferences do not obligate higher five-card corrections', () => {
    expect(competitive('W', 'P P 1H 2D P 2S P', 'T5.J64.AKJ75.AJ5')).toEqual(PASS);
    expect(competitive('W', 'P P 1H 2D P 2S P 3D P', 'KQJ94.72.93.Q842')).toEqual(PASS);
  });
  it('4440: a five-card suit can escape a singleton at two, then stop before another correction at three', () => {
    expect(competitive('N', 'P 1C 1H P 1S 2C 2H P', 'KJ864.7.AQT72.72')).toEqual(bid(2, 'S'));
    expect(competitive('N', 'P 1C 1H P 1S 2C 2H P 2S P 3H P', 'KJ864.7.AQT72.72')).toEqual(PASS);
  });
  it('full chooser retains the competitive mechanism instead of an unrelated forcing fallback', () => {
    expect(chooseBid(observation('E', 'P P 1S 2S P 2NT P 3C 3S', 'K976.5.KJ74.A752'), 'sayc')).toEqual(bid(5, 'C'));
    expect(chooseBid(observation('N', 'P P P 1D 1H P 2C 2D 2H P', 'K983.A.QT9.Q8743'), 'sayc')).toEqual(PASS);
  });
});

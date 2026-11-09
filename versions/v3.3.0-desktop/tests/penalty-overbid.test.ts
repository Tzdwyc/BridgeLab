import { chooseBid as originalHybridBid } from './fixtures/v329/src/ai/bidding';
import { describe, expect, it } from 'vitest';
import { chooseBid, evaluateHand } from '../src/ai/bidding';
import { observe } from '../src/ai/observation';
import { adjustPenaltyDouble } from '../src/ai/penalty-doubles';
import { applyCall, newGameFromDeal } from '../src/core/game';
import { type Call, type Strain, type Suit, type Vulnerability, PASS } from '../src/core/types';

const system = 'two-over-one';
const double: Call = { kind: 'double' };
const fiveDiamonds: Call = { kind: 'bid', level: 5, strain: 'D' };
const noFit = '1D 1S P 3NT';
const diamondFit = '1D 1S 2D 3NT';
const fiveCashers = 'AK.AK.A6543.8765 QJT98.QJT5.2.AJ2 7654.876.T987.43 32.9432.KQJ.KQT9';
const strongDiamondDefense = 'AKT9.A84.A9876.J QJ876.KJT.5.Q932 2.Q765.KQT43.AT5 543.932.J2.K8764';
const madeWithSameHcp = 'KQJ9.KQ4.KJ876.J AT876.AJT.A5.832 2.8765.QT943.754 543.932.2.AKQT96';
const majorDefense = 'AQT9.K9876.A84.J KJ876.5.KJT.Q932 2.AQT43.Q765.AT5 543.J2.932.K8764';
const downOneWithFit = 'JT.A95.KJT854.KT AK9765.83..A7654 43.JT74.Q9632.Q9 Q82.KQ62.A7.J832';
const opponentsCanRunSpades = '75.AK6.AQ9843.K7 KQJT98.75.2.A863 432.8432.765.542 A6.QJT9.KJT.QJT9';
const canEstablishDiamonds = 'AQ8.T6.AQT762.A2 KT942.J72..KJ743 J6.A543.98543.86 753.KQ98.KJ.QT95';

function position(deal: string, prefix: string, vulnerability: Vulnerability) {
  const suits: Suit[] = ['S', 'H', 'D', 'C'];
  const [N, E, S, W] = deal.split(' ').map(holding =>
    holding.split('.').flatMap((ranks, index) => [...ranks].map(symbol => {
      const rank = '23456789TJQKA'.indexOf(symbol) + 2;
      return { suit: suits[index], rank, id: `${suits[index]}${rank}` };
    })),
  );
  let game = newGameFromDeal(1, 'penalty-overbid', { N, E, S, W }, 'N', vulnerability);
  for (const text of prefix.split(' ')) {
    const call: Call = text === 'P' ? PASS : { kind: 'bid', level: Number(text[0]), strain: text.slice(1) as Strain };
    game = applyCall(game, game.turn, call);
  }
  const observation = observe(game);
  if (observation.phase !== 'auction') throw new Error('Expected a bidding observation');
  return observation;
}

describe('2/1 penalty decisions for a natural 3NT', () => {
  it('doubles without a known fit when the opening leader can cash five tricks', () => {
    const obs = position(fiveCashers, noFit, 'EW');
    expect(chooseBid(obs, system)).toEqual(double);
    expect(adjustPenaltyDouble(obs, PASS, system)).toMatchObject({ call: double });
    expect(adjustPenaltyDouble(obs, double, system)).toBeUndefined();
  });

  it('distinguishes visible cashers from the 16 HCP shared by a beaten 3NT and a made 3NT', () => {
    // The frozen high-contract replay gives these contracts 2 and 9 DDS tricks, respectively.
    const sound = position(strongDiamondDefense, noFit, 'EW');
    const made = position(madeWithSameHcp, noFit, 'EW');
    expect(evaluateHand(sound.hand).hcp).toBe(16);
    expect(evaluateHand(made.hand).hcp).toBe(16);
    expect(chooseBid(sound, system)).toEqual(double);
    expect(chooseBid(made, system)).toEqual(PASS);
    expect(adjustPenaltyDouble(made, double, system)).toMatchObject({ call: PASS });
  });

  it('retains the baseline limited-defense decision without inventing a penalty double', () => {
    // Actual double-dummy totals from the high-contract and LAN replays are 3 and 8.
    for (const obs of [
      position(majorDefense, '1H 1S P 3NT', 'EW'),
      position(downOneWithFit, diamondFit, 'None'),
    ]) {
      const expected = system === 'two-over-one' ? originalHybridBid(obs, 'sayc') : PASS;
      expect(chooseBid(obs, system)).toEqual(expected);
      expect(chooseBid(obs, system).kind).not.toBe('double');
      expect(adjustPenaltyDouble(obs, PASS, system)).toBeUndefined();
    }
  });

  it('accounts for the value of a supported 5D when comparing it with the penalty', () => {
    const favorable = position(strongDiamondDefense, diamondFit, 'EW');
    expect(chooseBid(favorable, system)).toEqual(double);
    expect(adjustPenaltyDouble(favorable, PASS, system)).toMatchObject({ call: double });

    const bothVulnerable = position(strongDiamondDefense, diamondFit, 'Both');
    expect(chooseBid(bothVulnerable, system)).toEqual(fiveDiamonds);
    expect(adjustPenaltyDouble(bothVulnerable, fiveDiamonds, system)).toBeUndefined();
  });

  it.each(['1S', '2S'])('vetoes a model double when the %s overcall exposes a running suit', overcall => {
    const obs = position(opponentsCanRunSpades, `1D ${overcall} P 3NT`, 'EW');
    expect(evaluateHand(obs.hand).hcp).toBe(16);
    expect(chooseBid(obs, system)).toEqual(PASS);
    expect(adjustPenaltyDouble(obs, double, system)).toMatchObject({ call: PASS });
  });

  it('uses the public diamond source to compare the penalty with an actual 5D alternative', () => {
    const obs = position(canEstablishDiamonds, diamondFit, 'None');
    expect(chooseBid(obs, system)).toEqual(double);
    expect(adjustPenaltyDouble(obs, fiveDiamonds, system)).toMatchObject({ call: double });
  });
});

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { applyClaim, applyCall, newGame, playCard } from '../src/core/game';
import { legalCards } from '../src/core/play';
import { PASS } from '../src/core/types';
import { compactTrickOutcome, TrickScoreMeter, trickScoreState, type TrickScoreSummary } from '../src/ui/TrickScore';
import { mobilePlay } from './fixtures/v322-mobile';

describe('v3.2.2 shared phone contract and public-trick summary', () => {
  it.each(['N', 'E', 'S', 'W'] as const)('keeps real compass totals and redoubled contract for %s declarer', declarer => {
    const game = mobilePlay(declarer, 2), score = trickScoreState(game);
    const before = JSON.stringify(game);
    const markup = renderToStaticMarkup(createElement(TrickScoreMeter, { score, contract: game.contract! }));
    expect(markup).toContain('data-testid="score-contract"');
    expect(markup).toContain(' XX');
    expect(markup).toContain('data-side="NS"');
    expect(markup).toContain('data-side="EW"');
    expect(score.ns).toBe(game.tricksWon.NS);
    expect(score.ew).toBe(game.tricksWon.EW);
    expect(score.declarerSide).toBe(declarer === 'N' || declarer === 'S' ? 'NS' : 'EW');
    expect(JSON.stringify(game)).toBe(before);
  });

  it('awards no partial trick and reports accepted settlement rather than visible hand counts', () => {
    let game = newGame(1, 'v322-summary-awarded-only');
    for (const call of [PASS, { kind: 'bid' as const, level: 3, strain: 'NT' as const }, PASS, PASS, PASS]) game = applyCall(game, game.turn, call);
    for (let n = 0; n < 3; n++) game = playCard(game, game.turn, legalCards(game.hands[game.turn], game.currentTrick)[0].id);
    expect(trickScoreState(game)).toMatchObject({ ns: 0, ew: 0, remaining: 13, target: 9 });
    const claimed = applyClaim(mobilePlay('E'), 'S', 0);
    const score = trickScoreState(claimed);
    expect(score).toMatchObject({ settled: true, remaining: 0 });
    expect(score.ns + score.ew).toBe(13);
    expect(score.ew).toBe(claimed.result!.declarerTricks);
  });

  it.each([[9, '成约'], [10, '超 1 墩'], [8, '宕 1 墩']] as const)('presents a %i-trick accepted claim with its exact settled result', (total, wording) => {
    const game = mobilePlay('S');
    const claimed = applyClaim(game, 'S', total - game.tricksWon.NS);
    const score = trickScoreState(claimed);
    expect(claimed.result!.declarerTricks).toBe(total);
    expect(score).toMatchObject({ ns: total, ew: 13 - total, remaining: 0, settled: true });
    expect(compactTrickOutcome(score)).toBe(wording);
    const markup = renderToStaticMarkup(createElement(TrickScoreMeter, { score, contract: claimed.contract!, statusLabel: '声称已结算' }));
    expect(markup).toContain(wording);
    expect(markup).toContain('声称已结算');
    expect(markup).toContain(score.outcome);
  });

  it('keeps live wording bounded by awarded totals, including an unavoidable undertrick', () => {
    const base: TrickScoreSummary = { ns: 3, ew: 7, remaining: 3, target: 9, declarerSide: 'EW', settled: false, outcome: '旧桌面文字' };
    expect(compactTrickOutcome(base)).toBe('还差 2 墩');
    expect(compactTrickOutcome({ ...base, ns: 4, ew: 9, remaining: 0 })).toBe('已够墩');
    expect(compactTrickOutcome({ ...base, ns: 5, ew: 7, remaining: 1 })).toBe('至少宕 1 墩');
    expect(base.outcome).toBe('旧桌面文字');
  });

  it('presents a normally completed board from its public final result', () => {
    let game = mobilePlay('E');
    while (game.phase === 'play') game = playCard(game, game.turn, legalCards(game.hands[game.turn], game.currentTrick)[0].id);
    expect(game.phase).toBe('complete');
    expect(game.completedTricks).toHaveLength(13);
    expect(trickScoreState(game)).toMatchObject({ settled: true, remaining: 0 });
    expect(game.result!.declarerTricks).toBe(13);
    expect(compactTrickOutcome(trickScoreState(game))).toBe('超 4 墩');
  });
});

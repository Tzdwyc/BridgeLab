import { beforeAll, expect, test } from 'vitest';
import { DdsEngine } from '../src/analysis/engine';
import { advisePlay } from '../src/ai/play-advisor-core';
import { observe, type PlayObservation } from '../src/ai/observation';
import { exampleGame, replayLine } from '../src/analysis/model';
import { toRecord } from '../src/core/game';

let engine: DdsEngine;
beforeAll(async () => { engine = await DdsEngine.create(); }, 30000);

test('real local DDS evaluates sampled hidden hands without receiving GameState', async () => {
  const state = replayLine(toRecord(exampleGame('v03-real-sampled-dds', 'S', 'S'))).states[8];
  const observation = observe(state) as PlayObservation;
  const decision = await advisePlay({ observation, system: 'two-over-one', strength: 'standard', timeoutMs: 15000 }, engine);
  expect(decision.engine).toBe('sampled-dds');
  expect(decision.sampleCount).toBeGreaterThanOrEqual(1);
  expect(decision.sampleCount).toBeLessThanOrEqual(8);
  expect(observation.legalCards.some(card => card.id === decision.cardId)).toBe(true);
  expect(decision.candidates).toHaveLength(observation.legalCards.length);
  expect(JSON.stringify(observation)).not.toContain(state.seed);
}, 30000);

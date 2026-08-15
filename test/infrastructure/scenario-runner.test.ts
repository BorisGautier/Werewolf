import { describe, expect, it } from 'vitest';
import { ScenarioRunner } from '../../src/infrastructure/testing/scenario-runner.js';

describe('ScenarioRunner', () => {
  it('runs all 7 high-priority scenarios and passes 100%', async () => {
    const runner = new ScenarioRunner();
    const results = await runner.runAllScenarios();

    expect(results.length).toBe(7);
    for (const res of results) {
      expect(res.passed, `Scenario failed: ${res.name} - ${res.details}`).toBe(true);
    }
  });
});

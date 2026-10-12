import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseGate, parseGateFloors } from '../../src/hardness';

const GATE = fileURLToPath(new URL('../../../../validators/stats/GATE.md', import.meta.url));

describe('a lowered bar in GATE.md', () => {
  it('takes a score ceiling above 0.4 and under 0.8, and floors between their limits and section 12.4', () => {
    expect(parseGate('Max score after the pilot: 0.7')).toBe(0.7);
    expect(parseGate('Max score after the pilot: 0.8')).toBeNull();
    expect(parseGateFloors('Min forecast: 70\nMin distinct causes: 60')).toEqual({
      minForecast: 70,
      minCauses: 60,
    });
    expect(parseGateFloors('Min forecast: 49\nMin distinct causes: 29')).toEqual({
      minForecast: null,
      minCauses: null,
    });
    expect(parseGateFloors('Min forecast: 100\nMin distinct causes: 100')).toEqual({
      minForecast: null,
      minCauses: null,
    });
    expect(parseGateFloors('no bar')).toEqual({ minForecast: null, minCauses: null });
  });

  it('reads the stats bar the owner allowed: forecast at least 70, score at most 0.7, causes at least 60', () => {
    const text = readFileSync(GATE, 'utf8');
    expect(parseGate(text)).toBe(0.7);
    expect(parseGateFloors(text)).toEqual({ minForecast: 70, minCauses: 60 });
  });
});

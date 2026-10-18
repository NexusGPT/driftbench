import { addEventCodes, type Projection } from '@agent-nexus/driftbench-space';
import { expect, it } from 'vitest';

it('enumerates the same ordered product for empty, single, multiple and repeated values', () => {
  const choices = [[], [0], [1], [1, 0], [2, 0, 2]];
  for (const dimensions of [[], [0], [2, 0], [0, 1, 2], [2, 1, 0]]) {
    const projection: Projection = {
      dimensions,
      stride: dimensions.map((_, index) => 3 ** (dimensions.length - index - 1)),
      size: 3 ** dimensions.length,
      allowed: new Uint8Array(3 ** dimensions.length),
      mass: new Float64Array(3 ** dimensions.length),
    };
    for (const first of choices) {
      for (const second of choices) {
        for (const third of choices) {
          const event = { path: 'blocks.0', values: [first, second, third] };
          const product = dimensions.reduce(
            (codes, dimension, index) =>
              codes.flatMap((code) =>
                (event.values[dimension] ?? []).map(
                  (value) => code + value * (projection.stride[index] ?? 0),
                ),
              ),
            [0],
          );
          const actual = new Set([5]);
          addEventCodes(projection, event, actual);
          expect([...actual]).toEqual([...new Set([5, ...product])]);
        }
      }
    }
  }
});

it('does not place an event on a dimension it does not name', () => {
  const projection: Projection = {
    dimensions: [0, 3],
    stride: [2, 1],
    size: 4,
    allowed: new Uint8Array(4),
    mass: new Float64Array(4),
  };
  const actual = new Set([7]);
  addEventCodes(projection, { path: 'blocks.0', values: [[0, 1]] }, actual);
  expect([...actual]).toEqual([7]);
});

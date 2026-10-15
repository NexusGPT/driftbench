import { expect, it } from 'vitest';
import { parseCliOverrides, resolveBlockObjects, shippedObjectContext } from '../../src/objects';

it('refuses --set diagnostic/missing#rule.limit=2 before the diagnostic branch can skip it', () => {
  const context = {
    ...shippedObjectContext(),
    cli: parseCliOverrides([], ['diagnostic/missing#rule.limit=2']),
  };
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(
    /unknown object diagnostic:missing; searched layers shipped, project, suite, spec, block, cli/,
  );
});

it('validates an item on a known but unselected --set object', () => {
  const context = shippedObjectContext();
  context.store.add({ kind: 'diagnostic', id: 'known', steps: [] }, 'project', { path: 'fixture' });
  context.cli = parseCliOverrides([], ['diagnostic/known#rule.limit=2']);
  expect(() => resolveBlockObjects({ blocks: [{ when: { user: 'hello' } }] }, 0, context)).toThrow(
    /no item of diagnostic:known/,
  );
});

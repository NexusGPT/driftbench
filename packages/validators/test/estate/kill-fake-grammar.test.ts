import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FIXTURE, fixtureSuite, runOnFake } from '../../src/ladders/estate/bank/fixture-suite';

vi.setConfig({ testTimeout: 600_000 });

// A code-written ask ("Please handle this for me: <the declared text of the atom>") sets an atom off only through the
// grammar generated from the approved map (ask-grammar.ts). The kill run hands the fake that grammar, as gen.task does.
it('runs a code-written ask on the fake with the grammar generated from the map', async () => {
  const suite = await fixtureSuite();
  const ids = [
    'estate.misroute.route.inbox-triager.an-ask-that-fits-inbox-triager',
    'estate.obligation.instruction.inbox-triager.a-message-that-fits-none-goes',
  ];
  const specs = ids.map((id) => suite.specs.find((spec) => spec.id === id));
  for (const spec of specs) expect(spec, 'the fixture suite holds the spec').toBeDefined();
  const verdicts = runOnFake(
    FIXTURE,
    specs.map((spec) => spec?.path ?? ''),
    join(suite.work, 'grammar-original.db'),
    join(FIXTURE, 'approved.yaml'),
  );
  expect(Object.fromEntries(ids.map((id) => [id, verdicts.get(id)]))).toEqual({
    [ids[0] as string]: true,
    [ids[1] as string]: true,
  });
});

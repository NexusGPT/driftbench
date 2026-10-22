import { join } from 'node:path';
import { it, vi } from 'vitest';
import { cli } from '../../src/ladders/estate/bank/bench';
import { FIXTURE, fixtureSuite, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';

vi.setConfig({ testTimeout: 900_000 });
const say = (text: string) => console.log(`[PROBE] ${text}`);
it('route-2 mutant failing checks', async () => {
  const suite = await fixtureSuite();
  const atom = 'route.invoice-reconcile.an-ask-that-fits-invoice-reconcile';
  const naming = suite.specs.filter((s) => s.complete && s.mode === 'live' && s.atoms.includes(atom)).slice(0, 4);
  const map = join(FIXTURE, 'approved.yaml');
  const orig = runOnFakeDetailed(FIXTURE, naming.map((s) => s.path), '/tmp/r2-orig.db', map);
  const green = naming.filter((s) => orig.get(s.id)?.pass);
  say(`original green ${green.map((s) => s.id).join(' ')}`);
  const mutant = '/tmp/r2-mutant';
  const made = cli(['estate', 'mutate', map, '--atom', atom, '--delete', '--to', mutant]);
  say(`mutate ${made.code}`);
  const run = runOnFakeDetailed(mutant, green.map((s) => s.path), join(mutant, 'runs.db'));
  for (const s of green) say(`MUTANT ${s.id} pass=${run.get(s.id)?.pass} completed=${run.get(s.id)?.completed} failing=${JSON.stringify(run.get(s.id)?.failing)}`);
});

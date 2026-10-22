import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FIXTURE, fixtureSuite, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';
import { agentMutants } from '../../src/ladders/estate/levels';
import { estateRun } from '../../src/ladders/estate/pipeline';

vi.setConfig({ testTimeout: 900_000 });
const say = (text: string) => console.log(`[PROBE] ${text}`);

it('kill.fake delete-gate-2: why the specs fail on the original', async () => {
  const suite = await fixtureSuite();
  const atom = 'gate.standing.read-before-edit-it';
  const naming = suite.specs.filter((s) => s.complete && s.mode === 'live' && s.atoms.includes(atom));
  say(`naming ${naming.length}: ${naming.map((s) => s.id).join(' ')}`);
  const chosen = naming.slice(0, 4);
  const verdicts = runOnFakeDetailed(FIXTURE, chosen.map((s) => s.path), '/tmp/probe-orig.db', join(FIXTURE, 'approved.yaml'));
  for (const s of chosen) {
    const v = verdicts.get(s.id);
    say(`${s.id} pass=${v?.pass} completed=${v?.completed} failing=${JSON.stringify(v?.failing)}`);
    say(readFileSync(s.path, 'utf8').split('\n').filter((l) => /user:|before:|after:|key:|changed|others_untouched|^  - |skills|tools/.test(l)).join(' | '));
  }
  expect(true).toBe(true);
});

it('mutant.agent.gate: which gate atom lives, and why', async () => {
  for (const seed of [1, 2]) {
    const run = await estateRun(seed);
    const mutants = await agentMutants(run);
    for (const m of mutants.filter((x) => x.kind === 'gate' && !x.killed && !x.equivalent && !x.untestable)) {
      const atom = run.scanned.map.atoms.find((a) => a.id === m.atom);
      say(`seed ${seed} ALIVE ${m.atom} quote=${JSON.stringify(atom?.provenance.quote)} situation=${JSON.stringify(atom?.situation)} fields=${JSON.stringify(atom?.fields)} evidence=${JSON.stringify(atom?.evidence)}`);
      say(`seed ${seed} reason=${m.reason} tests=${m.tests.slice(0, 6).join(' ')}`);
      const hid = run.scanned.match.hidOf.get(m.atom);
      const truth = run.rendered.atoms.find((t) => t.hid === hid);
      say(`seed ${seed} truth=${JSON.stringify(truth)}`);
    }
    say(`seed ${seed} gate mutants: ${mutants.filter((x) => x.kind === 'gate').map((x) => `${x.atom}:${x.killed ? 'killed' : x.equivalent ? 'equiv' : x.untestable ? 'untest' : 'alive'}`).join(' ')}`);
  }
  expect(true).toBe(true);
});

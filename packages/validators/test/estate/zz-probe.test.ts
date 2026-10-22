import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { FIXTURE, fixtureSuite, runOnFakeDetailed } from '../../src/ladders/estate/bank/fixture-suite';
import { follow } from '../../src/ladders/estate/follower';
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

it('mutant.agent.gate: the spec and the follower session with and without the gate', async () => {
  const run = await estateRun(1);
  const id = 'estate.ordered_pair.gate.menu-review.read-the-menu-format-before-you';
  const spec = run.specs.find((s) => s.record.id === id);
  say(`SPEC ${spec?.text.split('\n').filter((l) => /user:|before:|after:|key:|changed|others|tools|skills|called|- /.test(l)).join(' | ')}`);
  const asks = (spec?.loaded?.spec.blocks ?? []).map((b) => String((b.when as { user?: string } | undefined)?.user ?? ''));
  say(`asks ${JSON.stringify(asks)}`);
  for (const mutant of [undefined, 'gate:menu-review']) {
    const session = follow(run.estate, run.situations, asks, { ...(mutant ? { mutant } : {}), events: asks.map(() => undefined) });
    const calls = session.transcript.split('\n').filter((l) => l.includes('tool_use')).map((l) => { const j = JSON.parse(l); return JSON.stringify((j.message?.content ?? []).filter((c: { type: string }) => c.type === 'tool_use').map((c: { name: string; input: unknown }) => [c.name, c.input])); });
    say(`mutant=${mutant} calls=${calls.join(' ; ')}`);
  }
});

it('kill.fake delete-gate-2: the calls the fake made', async () => {
  const { readFileSync: read, existsSync, writeFileSync } = await import('node:fs');
  process.env.FAKE_CALLS = '/tmp/probe-calls.jsonl';
  writeFileSync('/tmp/probe-calls.jsonl', '');
  const suite = await fixtureSuite();
  const spec = suite.specs.find((x) => x.id === 'estate.ordered_pair.gate.standing.read-before-edit-it');
  if (!spec) throw new Error('no spec');
  const out = runOnFakeDetailed(FIXTURE, [spec.path], '/tmp/probe-calls.db', join(FIXTURE, 'approved.yaml'));
  say(`verdict ${JSON.stringify(out.get(spec.id))}`);
  say(`CALLS ${existsSync('/tmp/probe-calls.jsonl') ? read('/tmp/probe-calls.jsonl', 'utf8').slice(0, 6000) : 'none'}`);
});

it('with the patches: kill.fake and mutant.agent gate items', async () => {
  const { killFamily } = await import('../../src/ladders/estate/bank/kill');
  const { mutantFamily } = await import('../../src/ladders/estate/bank/loop');
  const kill = await killFamily().evaluate(1);
  for (const [k, v] of kill) if (k.includes('gate')) say(`KILL ${k} ${v.pass} ${v.detail}`);
  for (const seed of [1, 2]) {
    const m = await mutantFamily().evaluate(seed);
    for (const [k, v] of m) if (k.includes('gate') || !v.pass) say(`MUT seed ${seed} ${k} ${v.pass} ${v.detail.slice(0, 300)}`);
  }
});

it('raw run of the failing spec', async () => {
  const { cli } = await import('../../src/ladders/estate/bank/bench');
  const { readFileSync: read, existsSync, writeFileSync } = await import('node:fs');
  const suite = await fixtureSuite();
  const spec = suite.specs.find((x) => x.id === 'estate.ordered_pair.gate.standing.read-before-edit-it');
  if (!spec) throw new Error('no spec');
  writeFileSync('/tmp/probe-calls2.jsonl', '');
  const F = join(FIXTURE, 'live/fake');
  const r = cli(['estate','run',spec.path,'--estate',FIXTURE,'--runtime','claude-code','--command',join(F,'claude.mjs'),'--store','/tmp/probe2.db','--states',join(FIXTURE,'live/states/library.json'),'--judge','claude:haiku','--judge-command',join(F,'judge.cjs'),'--map',join(FIXTURE,'approved.yaml'),'--set-env',`FAKE_MAP=${join(FIXTURE,'approved.yaml')}`,'--set-env',`FAKE_PHRASES=${join(FIXTURE,'phrases.yaml')}`,'--set-env','FAKE_CALLS=/tmp/probe-calls2.jsonl','--json']);
  say(`RAW ${JSON.stringify(JSON.parse(r.out.slice(r.out.indexOf('{'))), (k, v) => (k === 'trace' || k === 'verdicts' ? v : v)).slice(0, 7000)}`);
  say(`CALLS2 ${existsSync('/tmp/probe-calls2.jsonl') ? read('/tmp/probe-calls2.jsonl', 'utf8').slice(0, 3000) : 'none'}`);
});

it('plan stream of the failing ask', async () => {
  const { cpSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync: read } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { dirname } = await import('node:path');
  const { parse } = await import('yaml');
  const suite = await fixtureSuite();
  const spec = suite.specs.find((x) => x.id === 'estate.ordered_pair.gate.standing.read-before-edit-it');
  if (!spec) throw new Error('no spec');
  const doc = parse(read(spec.path, 'utf8')) as { given: { world: { workspace: { files: Record<string, string> } } } };
  const cwd = mkdtempSync(join(tmpdir(), 'probe-ws-'));
  cpSync(FIXTURE, cwd, { recursive: true, filter: (src) => !src.includes('/generated') });
  for (const [path, text] of Object.entries(doc.given.world.workspace.files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  const mod = await import(join(FIXTURE, 'live/fake/agent.mjs'));
  const out = mod.planStream({
    ask: "Add the late shipment count to this week's report, reports/2026-W41.md.",
    cwd,
    sessionId: 'probe',
    env: { ...process.env, FAKE_MAP: join(FIXTURE, 'approved.yaml'), FAKE_PHRASES: join(FIXTURE, 'phrases.yaml') },
  });
  const brief = (out.records as Array<Record<string, unknown>>).map((r) => JSON.stringify(r).slice(0, 260));
  say(`PLAN blocked=${out.blocked} error=${out.error} n=${brief.length}`);
  for (const line of brief) say(`REC ${line}`);
});

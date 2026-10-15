import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSpecText, type RunResult, type Spec } from '@agent-nexus/driftbench-core';
import { openStore } from '@agent-nexus/driftbench-store';
import { beforeAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../../../cli/src/index';
import { blame } from '../../src';

/**
 * code-agent-liability on the Northwind fixture's recorded sessions (codeagent_equivalence_blame.md F5, F8c). The
 * replay specs are generated from the hand plan the estate tests use, replayed offline over the three recorded
 * sessions into a store, and the stored failing blocks are diagnosed. No model call and no agent run: F5's
 * confirm runs are the note's constructed stand-in outcome (the reference loads weekly-report 0 of 3).
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const SESSIONS = join(FIXTURE, 'sessions');
const NAMES = ['weekly-clean', 'weekly-skill-skipped', 'weekly-gate-violated'];

async function cli(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

async function walk(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

type Stored = { run: RunResult; spec: Spec; path: string };

describe('code-agent-liability on the Northwind recorded sessions', () => {
  const stored = new Map<string, Stored>();

  beforeAll(async () => {
    const out = await mkdtemp(join(tmpdir(), 'blame-northwind-'));
    const generated = await cli([
      'estate',
      'generate',
      '--map',
      join(FIXTURE, 'approved.yaml'),
      '--plan',
      join(ROOT, 'packages/generate/test/estate/fixtures/plan.yaml'),
      '--out',
      out,
    ]);
    expect(generated.err).toBe('');
    const db = join(out, 'runs.db');
    const replay = await cli([
      'replay',
      ...NAMES.map((name) => join(SESSIONS, `${name}.jsonl`)),
      '--decisions',
      ...NAMES.map((name) => join(SESSIONS, `${name}.decisions.jsonl`)),
      '--steps',
      ...NAMES.map((name) => join(SESSIONS, `${name}.steps.jsonl`)),
      '--suite',
      join(out, 'specs/replay'),
      '--store',
      db,
      '--json',
    ]);
    expect(replay.code).toBe(1);
    const specs = new Map<string, { spec: Spec; path: string }>();
    for (const path of await walk(join(out, 'specs/replay'))) {
      const loaded = parseSpecText(await readFile(path, 'utf8'), 'yaml', path);
      if (loaded.ok) specs.set(loaded.spec.id, { spec: loaded.spec, path });
    }
    const store = await openStore(db);
    for (const run of await store.listRuns()) {
      const spec = specs.get(run.specId);
      const session = (spec?.spec.metadata as { estate?: { session?: string } } | undefined)?.estate?.session;
      if (spec && session) stored.set(`${run.specId}|${session}`, { run, ...spec });
    }
    await store.close();
  }, 120_000);

  function diagnose(key: string, confirm?: Record<string, { runs: number; reference_loads: number }>) {
    const entry = stored.get(key);
    if (!entry) throw new Error(`no stored run ${key}; have ${[...stored.keys()].join(', ')}`);
    const block = entry.run.blocks[0];
    if (!block) throw new Error('no block');
    const specBlock = entry.spec.blocks[0];
    const result = blame.diagnoseBlock({
      verdicts: block.verdicts,
      evidenceFor: blame.blockEvidenceInputs({
        observed: block.observed,
        verdicts: block.verdicts,
        ...(specBlock?.expect === undefined ? {} : { expect: specBlock.expect }),
        spec: entry.spec,
        specPath: entry.path,
        ...(confirm === undefined ? {} : { confirm }),
      }),
      blame: blame.shippedPolicy('policy/blame'),
      placement: blame.shippedPolicy('policy/placement'),
    });
    return { result, block };
  }

  it('F8c: the guard caught the edit before the read; the agent, no fix needed, enforced', () => {
    const { result, block } = diagnose('estate.p02.weekly-gate-violated|weekly-gate-violated');
    expect(block.pass).toBe(false);
    const [diagnosis] = result.diagnoses;
    expect(diagnosis).toMatchObject({
      verdict_ref: 'custom.ordered.Read.Edit',
      item: 'core_rule_caught',
      disposition: 'agent',
      fault: ['agent'],
      fix_location: 'none',
      fix_action: 'none_enforced',
    });
    expect(diagnosis?.placement).toMatch(/^policy\/placement:default@[0-9a-f]{8}#fixed$/);
    expect(diagnosis?.evidence.guard_caught).toBe(true);
    expect(block.pass).toBe(false);
  });

  it('F5 static: weekly-report not loaded, coverage unknown: shared and undecided, a confirm run asked for', () => {
    const { result } = diagnose('estate.p01.weekly-skill-skipped|weekly-skill-skipped');
    expect(result.diagnoses[0]).toMatchObject({
      verdict_ref: 'skills.weekly-report',
      item: 'skill_not_loaded_undecided',
      disposition: 'shared',
      confidence: 'undecided',
    });
    expect(result.diagnoses[0]?.flags).toContain('run_liability_confirm');
  });

  it('F5 with the stored confirm runs (the reference loads it 0 of 3): the trigger, setup', () => {
    const { result } = diagnose('estate.p01.weekly-skill-skipped|weekly-skill-skipped', {
      'skills.weekly-report': { runs: 3, reference_loads: 0 },
    });
    expect(result.diagnoses[0]).toMatchObject({
      item: 'skill_not_loaded_uncovered',
      disposition: 'setup',
      fault: ['skill'],
      fix_location: 'skill.trigger',
      fix_target: 'skill:weekly-report#description',
      fix_action: 'rewrite_description',
    });
  });

  it('writes nothing on the clean session, which passes', () => {
    const entry = stored.get('estate.p01.weekly-clean|weekly-clean');
    expect(entry?.run.blocks[0]?.pass).toBe(true);
    const { result } = diagnose('estate.p01.weekly-clean|weekly-clean');
    expect(result.diagnoses).toEqual([]);
  });
});

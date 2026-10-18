import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openStore } from '@agent-nexus/driftbench-store';
import { afterEach, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const DIR = 'examples/estates/sessions';
const NAME = 'price-sheet-build';
const SPEC = `${DIR}/specs/${NAME}.yaml`;
const ARGS = [
  'replay',
  `${DIR}/${NAME}.jsonl`,
  '--decisions',
  `${DIR}/${NAME}.decisions.jsonl`,
  '--steps',
  `${DIR}/${NAME}.steps.jsonl`,
];

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd: ROOT,
  };
  return { code: await main(argv, io), out, err };
}

const temp: string[] = [];
afterEach(async () => {
  for (const dir of temp.splice(0)) await rm(dir, { recursive: true });
});

/** A suite holding the price sheet spec with one change, to prove the check behind it can fail. */
async function mutated(from: string, to: string): Promise<string> {
  const text = await readFile(join(ROOT, SPEC), 'utf8');
  if (!text.includes(from)) throw new Error(`the spec has no ${from}`);
  const dir = await mkdtemp(join(tmpdir(), 'replay-fields-'));
  temp.push(dir);
  await writeFile(join(dir, `${NAME}.yaml`), text.replace(from, to));
  return dir;
}

async function failing(suite: string): Promise<string[]> {
  const { out } = await cli([...ARGS, '--suite', suite, '--json']);
  return (JSON.parse(out) as { runs: Array<{ failing: string[] }> }).runs[0]?.failing ?? [];
}

describe('driftbench replay: the price sheet build, with files read, helpers, trees and the workbook', () => {
  it('passes every expectation, and each new field gives its verdict', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'replay-fields-store-'));
    temp.push(dir);
    const db = join(dir, 'runs.db');
    const { code, out, err } = await cli([...ARGS, '--suite', SPEC, '--store', db]);
    expect(err).toBe('');
    expect(out).toContain('✓ replay-price-sheet-build  session price-sheet-build from block 0 (metadata)');
    expect(code).toBe(0);
    const store = await openStore(db);
    try {
      const [run] = await store.listRuns({});
      const verdicts = run?.blocks[0]?.verdicts ?? [];
      const ids = verdicts.map((verdict) => verdict.id);
      for (const id of [
        'references.**/skills/xlsx/SKILL.md',
        'references.**/skills/xlsx/reference/*.md',
        'subagents.sheet-reviewer.sonnet',
        'artifacts.out/acme-price-sheet.xlsx',
        'artifacts.out/acme-price-sheet.xlsx.2.formula',
        'workspace.others_untouched',
        'safety.max_destructive_ops',
        'custom.ordered.Read.Edit',
        'stage.reached',
      ]) {
        expect(ids, id).toContain(id);
      }
      expect(verdicts.filter((verdict) => verdict.outcome !== 'pass')).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it('mutation: the reviewer is expected on another model; the subagents verdict fails', async () => {
    const suite = await mutated('model: sonnet', 'model: opus');
    expect(await failing(suite)).toEqual(['block 0: subagents.sheet-reviewer.opus']);
  });

  it('mutation: a reference the agent never read; the references verdict fails', async () => {
    const suite = await mutated("'**/skills/xlsx/reference/*.md'", "'**/skills/pdf/SKILL.md'");
    expect(await failing(suite)).toEqual(['block 0: references.**/skills/pdf/SKILL.md']);
  });

  it('mutation: the workbook is expected to hold a Summary sheet; the artifact check fails', async () => {
    const suite = await mutated('sheets: [Mobile, Home]', 'sheets: [Mobile, Home, Summary]');
    expect(await failing(suite)).toEqual(['block 0: artifacts.out/acme-price-sheet.xlsx.0.sheets']);
  });

  it('maps a read of a path the spec names, outside any skill folder, to a reference', async () => {
    const suite = await mutated(
      "        - { path: '**/skills/xlsx/reference/*.md' }\n",
      "        - { path: '**/skills/xlsx/reference/*.md' }\n        - { path: build_sheet.py, count: 1 }\n",
    );
    expect(await failing(suite)).toEqual([]);
  });

  it('refuses an after folder without a before folder', async () => {
    const suite = await mutated('    before: price-sheet-build/before\n', '');
    const { code, err } = await cli([...ARGS, '--suite', suite]);
    expect(code).toBe(2);
    expect(err).toMatch(/metadata\.replay before and after go together/);
  });
});

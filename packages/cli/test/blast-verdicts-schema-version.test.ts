import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { type Io, main } from '../src/index';

/**
 * Blast-radius audit of schema_version (PR 431) on the command line: spec validate, spec lint and campaign
 * run refuse a spec written for a newer format with the upgrade message, before any run.
 */
const made: string[] = [];
afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

async function run(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const io: Io = {
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
    cwd,
  };
  return { code: await main(argv, io), out, err };
}

describe('blast radius: the CLI on a spec of a newer format', () => {
  it('spec validate, spec lint and campaign run refuse it with SPEC_SCHEMA_VERSION', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'driftbench-blast-schema-cli-'));
    made.push(dir);
    await writeFile(
      join(dir, 'newer.yaml'),
      'schema_version: 2\nid: newer\nfuture_key: 1\nblocks:\n  - user: Hi\n',
    );
    for (const argv of [
      ['spec', 'validate', 'newer.yaml'],
      ['spec', 'lint', 'newer.yaml'],
    ]) {
      const result = await run(argv, dir);
      expect(result.code, argv.join(' ')).not.toBe(0);
      expect(`${result.out}${result.err}`, argv.join(' ')).toContain('SPEC_SCHEMA_VERSION');
      expect(`${result.out}${result.err}`, argv.join(' ')).toContain('upgrade driftbench');
      expect(`${result.out}${result.err}`, argv.join(' ')).not.toContain('future_key');
    }
    const campaign = await run(
      ['campaign', 'run', 'newer.yaml', '--target', 'function:acme-sales', '--store', join(dir, 'c.db')],
      dir,
    );
    expect(campaign.code).toBe(2);
    expect(`${campaign.out}${campaign.err}`).toContain('upgrade driftbench');
  });
});

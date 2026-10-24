import { mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { implFrame } from '../../src/ladders/variables/bank/run-child';
import { findRoot } from '../../src/root';

/**
 * What the implementation's confined runs may read (docs/validators.md section 12.9): the cassette the bank names,
 * read only, and its own scratch folder; not one file of the validator, not a file beside the cassette, not its own
 * source tree (it runs from a bundle).
 */

vi.setConfig({ testTimeout: 300_000 });

const ROOT = findRoot(process.cwd());
const IMPL = fileURLToPath(new URL('./fixtures/grants/impl.ts', import.meta.url));
const holder = mkdtempSync(join(ROOT, 'node_modules', '.cache', 'variables-grants-'));
const cassette = join(holder, 'cassette.jsonl');
const beside = join(holder, 'beside.jsonl');
writeFileSync(cassette, '{"text":"x","label":{"kind":"numeric"}}\n');
writeFileSync(beside, 'not granted\n');
const before = process.env.DRIFTBENCH_VARIABLES_CASSETTE;
afterAll(() => {
  rmSync(holder, { recursive: true, force: true });
  if (before === undefined) delete process.env.DRIFTBENCH_VARIABLES_CASSETTE;
  else process.env.DRIFTBENCH_VARIABLES_CASSETTE = before;
});

/** Every file under a folder. */
function filesOf(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesOf(path) : [path];
  });
}

describe('the read grants of the implementation under the frame', () => {
  it('reads the cassette and its scratch folder, and no other file', () => {
    process.env.DRIFTBENCH_VARIABLES_CASSETTE = cassette;
    const { frame, done } = implFrame(ROOT, IMPL, 1, 'grants');
    try {
      type Got = { ok?: unknown; code?: string };
      const validate = (value: unknown) => frame.product.validate(value) as unknown as Got;
      expect(validate({ read: cassette })).toEqual({ ok: 40 });
      expect(validate({ write: true })).toEqual({ ok: 'written' });
      expect(validate({ read: beside }).code).toBe('ERR_ACCESS_DENIED');
      expect(validate({ read: IMPL }).code).toBe('ERR_ACCESS_DENIED');
      // Every file of the validator package and its floors and evidence.
      const validator = [
        ...filesOf(join(ROOT, 'packages', 'validators', 'src')),
        ...filesOf(join(ROOT, 'packages', 'validators', 'test', 'variables-blind')),
        join(ROOT, 'validators', 'floors.json'),
      ];
      expect(validator.length).toBeGreaterThan(100);
      const read = validator.filter((path) => validate({ read: path }).code !== 'ERR_ACCESS_DENIED');
      expect(read).toEqual([]);
    } finally {
      frame.close();
      done();
    }
  });
});

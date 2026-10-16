import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect } from 'vitest';

/**
 * A test of the estate tooling reads the estate it is given, never the user-level skills of the machine it
 * runs on: those tests get an empty home folder. A test that wants a user layer sets `HOME` itself.
 */
if (/\/packages\/(estate|cli|generate|validators)\//.test(expect.getState().testPath ?? '')) {
  const home = mkdtempSync(join(tmpdir(), 'driftbench-test-home-'));
  process.env.HOME = home;
  process.on('exit', () => rmSync(home, { recursive: true, force: true }));
}

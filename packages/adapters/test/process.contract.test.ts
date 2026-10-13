import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSpecFile, type Observed, type Session } from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { afterAll } from 'vitest';
import { processAdapter } from '../src/process';
import { adapterContract } from './contract';

/**
 * The process adapter through the contract suite, in task mode: the fixture code agent of the sandbox
 * package works on the Acme price-sheet task (examples/acme) in a local sandbox. It cannot hold the Acme
 * chat, so the suite runs its generic checks on the task's two blocks. Fictional data only.
 */

const AGENT = fileURLToPath(new URL('../../sandbox/test/fixtures/code-agent.mjs', import.meta.url));
const PRICE_SHEET = fileURLToPath(
  new URL('../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url),
);

const loaded = await loadSpecFile(PRICE_SHEET);
if (!loaded.ok) throw new Error(`the Acme price-sheet task does not load: ${JSON.stringify(loaded.errors)}`);
const workspace = loaded.spec.given?.world?.workspace;
const [build, summary] = loaded.spec.blocks;
if (workspace === undefined || build === undefined || summary === undefined) {
  throw new Error('the Acme price-sheet task changed shape: it needs a workspace and two blocks');
}
if (!('user' in build.when) || !('user' in summary.when)) {
  throw new Error('the Acme price-sheet task changed shape: both blocks need a user instruction');
}

const parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-process-contract-')));
const boxes = join(parent, 'boxes');
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

adapterContract(
  'process',
  () => processAdapter({ command: process.execPath, args: [AGENT], provider: localProvider({ dir: boxes }) }),
  {
    target: { adapter: 'process', agent: 'acme-ops' },
    // A missing binary: the adapter finds no agent command to run when it opens the session.
    brokenTransport: () =>
      processAdapter({ command: join(parent, 'no-such-agent'), provider: localProvider({ dir: boxes }) }),
    released: (session: Session) => {
      const root = (session.state as { sandbox?: { root?: string } } | undefined)?.sandbox?.root;
      return root !== undefined && !existsSync(root);
    },
    task: {
      workspace,
      instructions: [build.when.user, summary.when.user],
      // The fixture agent writes its sheet as CSV, whatever format the instruction names.
      produces: 'out/acme-price-sheet.csv',
      historySeen: (observed: Observed) => {
        const seen = /History: (\d+) messages?\./.exec(observed.text)?.[1];
        return seen === undefined ? undefined : Number(seen);
      },
    },
  },
);

import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type CheckContext,
  type LoadedSpec,
  loadSpecs,
  type Observed,
  type Spec,
} from '@agent-nexus/driftbench-core';
import ExcelJS from 'exceljs';
import { taskArtifactText } from '../../src/index';

/**
 * A real Acme price sheet for the task judge (P2.5): examples/acme/ops/agent.mjs builds the workbook in a
 * temporary workspace seeded from specs/tasks/price-sheet.yaml, exactly as the process adapter runs it,
 * and a second copy has one cell changed. The judge text of each is what `taskArtifactText` renders for
 * the build block, the same function a run uses. Fictional data.
 */

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const AGENT = join(ROOT, 'examples/acme/ops/agent.mjs');
export const TASK_SPEC = join(ROOT, 'examples/acme/specs/tasks/price-sheet.yaml');
export const WORKBOOK = 'out/acme-price-sheet.xlsx';

export async function loadTaskSpec(): Promise<Spec> {
  const [loaded] = await loadSpecs([TASK_SPEC]);
  if (!loaded?.ok) throw new Error(`the Acme task spec does not load: ${JSON.stringify(loaded)}`);
  return (loaded as LoadedSpec).spec;
}

export type BuiltSheet = {
  readonly workspace: string;
  /** What the agent printed: its reply. */
  readonly reply: string;
  /** The build instruction of the task spec's first block. */
  readonly instruction: string;
};

/** Runs the ops agent once on the build instruction in a fresh workspace under `parent`. */
export async function buildPriceSheet(parent: string, spec: Spec): Promise<BuiltSheet> {
  const workspace = await realpath(await mkdtemp(join(parent, 'price-sheet-')));
  for (const [path, content] of Object.entries(spec.given?.world?.workspace?.files ?? {})) {
    await mkdir(dirname(join(workspace, path)), { recursive: true });
    await writeFile(join(workspace, path), String(content));
  }
  const when = spec.blocks[0]?.when;
  if (when === undefined || !('user' in when)) throw new Error('the build block has no user turn');
  const ran = spawnSync(process.execPath, [AGENT], {
    cwd: workspace,
    input: when.user,
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '' },
  });
  if (ran.status !== 0) throw new Error(`the ops agent exited ${ran.status}: ${ran.stderr}`);
  return { workspace, reply: ran.stdout.trim(), instruction: when.user };
}

/** Copies the workbook of `from` into a new workspace with one cell changed (Mobile C3, 25 to 29). */
export async function wrongPriceSheet(parent: string, from: BuiltSheet): Promise<BuiltSheet> {
  const workspace = await realpath(await mkdtemp(join(parent, 'price-sheet-wrong-')));
  const book = new ExcelJS.Workbook();
  await book.xlsx.load((await readFile(join(from.workspace, WORKBOOK))) as unknown as ArrayBuffer);
  const sheet = book.getWorksheet('Mobile');
  if (!sheet) throw new Error('the workbook has no Mobile sheet');
  sheet.getCell('C3').value = 29;
  await mkdir(join(workspace, 'out'), { recursive: true });
  await writeFile(join(workspace, WORKBOOK), new Uint8Array(await book.xlsx.writeBuffer()));
  return { ...from, workspace };
}

/** The check context of the build block, reading files from `workspace`. */
export function buildContext(spec: Spec, sheet: BuiltSheet): CheckContext {
  const block = spec.blocks[0];
  if (!block) throw new Error('the task spec has no block');
  const observed: Observed = {
    segments: [{ type: 'text', text: sheet.reply }],
    text: sheet.reply,
    toolCalls: [],
    workspaceDiff: { created: [WORKBOOK], changed: [], deleted: [] },
    cost: {},
    latencyMs: 1,
  };
  return {
    spec,
    mode: 'F',
    blockIndex: 0,
    block,
    expect: block.expect ?? {},
    given: { prefix: [], ledger: {}, world: {}, vars: {}, target: { adapter: 'process' }, hash: 'h' },
    observed,
    history: [],
    ledger: {},
    readArtifact: async (path) => new Uint8Array(await readFile(join(sheet.workspace, path))),
  };
}

/** The judge text of a built workbook, as a run renders it. */
export async function judgeText(spec: Spec, sheet: BuiltSheet): Promise<string> {
  const text = await taskArtifactText(buildContext(spec, sheet));
  if (text === undefined) throw new Error('the task block gave no artifact text');
  return text;
}

export async function scratch(): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), 'driftbench-judges2-')));
}

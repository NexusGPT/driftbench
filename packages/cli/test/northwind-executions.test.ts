import { execFile } from 'node:child_process';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, expect, it } from 'vitest';

const harness = await import(new URL('../../../examples/northwind-campaign/plugin.mjs', import.meta.url).href);
const exec = promisify(execFile);
const temporary: string[] = [];
afterEach(async () => {
  for (const path of temporary.splice(0)) await rm(path, { recursive: true, force: true });
});

async function exercise(command: string, read: 'before' | 'after' | 'none' | 'history', block = 'ask') {
  const root = await mkdtemp(join(tmpdir(), 'northwind-execution-'));
  temporary.push(root);
  const scripts = join(root, '.claude/skills/invoice-reconcile/scripts');
  await mkdir(scripts, { recursive: true });
  await copyFile(new URL('../../../examples/estates/fixture/.claude/skills/invoice-reconcile/scripts/reconcile.py', import.meta.url), join(scripts, 'reconcile.py'));
  await chmod(join(scripts, 'reconcile.py'), 0o755);
  await writeFile(join(scripts, 'reconcile.py.bak'), 'print("a different script")\n');
  await symlink(scripts, join(root, 'scripts'));
  for (const file of ['invoice.json', 'order.json']) {
    await writeFile(join(root, file), JSON.stringify({ lines: [{ article: 'fictional', quantity: 1, unit_price: 1 }] }));
  }
  const rule = join(root, '.claude/skills/invoice-reconcile/references/matching-rules.md');
  await mkdir(join(root, '.claude/skills/invoice-reconcile/references'), { recursive: true });
  await writeFile(rule, 'Read these matching rules before reconciliation.\n');
  const readCall = async () => {
    const start = Date.now();
    const output = await readFile(rule, 'utf8');
    return { label: 'Read', input: { file_path: rule }, output, startedAt: new Date(start).toISOString(), latencyMs: Date.now() - start };
  };
  const before = read === 'before' || read === 'history' ? await readCall() : undefined;
  const log = '.claude/northwind/reconcile-executions.jsonl';
  const adapter = harness.executionLogAdapter({
    readArtifact: async (_session: unknown, path: string) => readFile(join(root, path)),
    send: async () => {
      await exec('/bin/sh', ['-c', command], { cwd: root, env: { PATH: process.env.PATH, NORTHWIND_RECONCILE_LOG: join(root, log) } }).catch((error: { code?: unknown }) => {
        if (typeof error.code !== 'number') throw error;
      });
      const after = read === 'after' ? await readCall() : undefined;
      return { segments: [], text: '', cost: {}, latencyMs: 0,
        toolCalls: [...(read === 'before' && before ? [before] : []), { label: 'Bash', input: { command } }, ...(after ? [after] : [])],
      };
    },
  });
  const observed = await adapter.send({}, {});
  const verdicts = await harness.invoicePrerequisite({
    block: { id: block }, blockIndex: 1, observed,
    history: read === 'history' ? [{ observed: { toolCalls: [before] } }] : [],
  });
  return { events: observed.raw.northwindReconcileExecutions, verdicts };
}

const controls: Array<[string, number]> = [
  ['echo scripts/reconcile.py', 0],
  ['# python scripts/reconcile.py invoice.json order.json', 0],
  ['echo ready # ; python scripts/reconcile.py invoice.json order.json', 0],
  ["'python scripts/reconcile.py'", 0],
  ["printf '%s' 'python scripts/reconcile.py'", 0],
  ['python scripts/reconcile.py.bak', 0],
  ['python -c scripts/reconcile.py', 0],
  ['python -m scripts/reconcile.py', 0],
  ['env -u NORTHWIND_RECONCILE_LOG python scripts/reconcile.py invoice.json order.json', 1],
  ['NORTHWIND_RECONCILE_LOG=/dev/null python scripts/reconcile.py invoice.json order.json', 1],
  ['NORTHWIND_RECONCILE_LOG=redirected.jsonl python scripts/reconcile.py invoice.json order.json', 1],
  ['false && python scripts/reconcile.py invoice.json order.json', 0],
  ['true || python scripts/reconcile.py invoice.json order.json', 0],
  ['python scripts/reconcile.py invoice.json order.json', 1],
  ['./scripts/reconcile.py invoice.json order.json', 1],
  ['python "scripts/reconcile.py" invoice.json order.json', 1],
  ['python3 -I scripts/reconcile.py invoice.json order.json', 1],
  ['python scripts/reconcile.py invoice.json order.json | cat', 1],
  ['printf invoice | python scripts/reconcile.py invoice.json order.json', 1],
  ['(python scripts/reconcile.py invoice.json order.json)', 1],
  ['echo warmup; python scripts/reconcile.py invoice.json order.json', 1],
  ['false || python scripts/reconcile.py invoice.json order.json', 1],
  ['python scripts/reconcile.py invoice.json order.json; python scripts/reconcile.py invoice.json order.json', 2],
];
for (const read of ['before', 'none'] as const) {
  it.each(controls)(`judges actual executions in an ask block, read=${read}: %s`, async (command, count) => {
    const result = await exercise(command, read);
    expect(result.events).toHaveLength(count);
    const failed = result.verdicts.some((verdict: { outcome: string }) => verdict.outcome === 'fail');
    expect(failed).toBe(count > 0 && read === 'none');
    if (count > 0 && read === 'before') expect(result.verdicts).toContainEqual(expect.objectContaining({ outcome: 'pass' }));
  });
}
it('rejects a matching-rules read that happens only after the logged execution', async () => {
  const result = await exercise('python scripts/reconcile.py invoice.json order.json', 'after');
  expect(result.events).toHaveLength(1);
  expect(result.verdicts).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});
it('accepts a successful matching-rules read from history before the logged execution', async () => {
  const result = await exercise('python scripts/reconcile.py invoice.json order.json', 'history');
  expect(result.verdicts).toContainEqual(expect.objectContaining({ outcome: 'pass' }));
});
it('still requires an actual execution in the reconcile block', async () => {
  const result = await exercise('echo scripts/reconcile.py', 'before', 'reconcile');
  expect(result.events).toHaveLength(0);
  expect(result.verdicts).toContainEqual(expect.objectContaining({ outcome: 'fail' }));
});

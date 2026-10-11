import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AdapterTransportError,
  loadSpecFile,
  type Message,
  Observed,
  type ResolvedGiven,
  type Sandbox,
  type SandboxProvider,
  type Session,
  type Turn,
} from '@driftbench/core';
import { dockerProvider, localProvider } from '@driftbench/sandbox';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { type ProcessAdapterOptions, processAdapter, processProtocolFiles } from '../src/process';

/**
 * The process adapter driven with the fixture code agent of the sandbox package. Fictional Acme data.
 */

const AGENT = fileURLToPath(new URL('../../sandbox/test/fixtures/code-agent.mjs', import.meta.url));
const FAKE_DOCKER = fileURLToPath(new URL('../../sandbox/test/fixtures/fake-docker.mjs', import.meta.url));
const PRICE_SHEET = fileURLToPath(
  new URL('../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url),
);
const NODE = process.execPath;

const CATALOG = `plan_id,name,category,allowance,monthly_usd
mobile-s,Acme Mobile S,mobile,10 GB,15
mobile-m,Acme Mobile M,mobile,40 GB,25
mobile-l,Acme Mobile L,mobile,unlimited,35
fiber-300,Acme Fiber 300,home,300 Mbps,40
fiber-1000,Acme Fiber 1000,home,1000 Mbps,60
air-5g,Acme Air 5G,home,200 Mbps,35
`;
const README = 'Sales operations folder of Acme Telecom. catalog.csv is the source of truth.\n';
const SHEET = `plan_id,name,category,monthly_usd,yearly_usd
mobile-s,Acme Mobile S,mobile,15,180
mobile-m,Acme Mobile M,mobile,25,300
mobile-l,Acme Mobile L,mobile,35,420
fiber-300,Acme Fiber 300,home,40,480
fiber-1000,Acme Fiber 1000,home,60,720
air-5g,Acme Air 5G,home,35,420
`;
const SUMMARY = 'summary,Acme Mobile S,mobile,15,180\nsummary,Acme Air 5G,home,35,420\n';

const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');

let parent: string;
const sessions: { close: () => Promise<void> }[] = [];

beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-process-test-')));
});
afterEach(async () => {
  for (let open = sessions.pop(); open !== undefined; open = sessions.pop()) await open.close();
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

function given(
  files: Record<string, string> = { 'catalog.csv': CATALOG, 'README.txt': README },
): ResolvedGiven {
  return {
    prefix: [],
    ledger: {},
    world: { workspace: { files } },
    vars: {},
    target: { adapter: 'process', agent: 'acme-ops' },
    hash: `given-${Object.keys(files).length}`,
  };
}

function turn(index: number, user: string, from: ResolvedGiven, budget?: Turn['budget']): Turn {
  return { index, stimulus: { user }, given: from, ...(budget === undefined ? {} : { budget }) };
}

/** A provider that records each sandbox it made and whether it was destroyed. */
function tracked(provider: SandboxProvider) {
  const boxes: { sandbox: Sandbox; destroyed: boolean }[] = [];
  const wrapped: SandboxProvider = {
    kind: provider.kind,
    available: () => provider.available(),
    async create(options) {
      const sandbox = await provider.create(options);
      const entry = { sandbox, destroyed: false };
      const destroy = sandbox.destroy.bind(sandbox);
      sandbox.destroy = async () => {
        await destroy();
        entry.destroyed = true;
      };
      boxes.push(entry);
      return sandbox;
    },
  };
  return { boxes, provider: wrapped };
}

/** An adapter on a local sandbox, its sessions closed after each test. */
function setup(options: Partial<ProcessAdapterOptions> = {}) {
  const local = tracked(localProvider({ dir: join(parent, 'boxes') }));
  const adapter = processAdapter({ command: NODE, args: [AGENT], provider: local.provider, ...options });
  const open = async (from: ResolvedGiven = given()) => {
    const session = await adapter.open(from);
    sessions.push({ close: () => adapter.close(session) });
    return session;
  };
  const folder = (index = 0) => local.boxes[index]?.sandbox.root ?? '';
  return { adapter, open, folder, boxes: local.boxes };
}

describe('the process adapter', () => {
  it('declares a sandbox, no tool stubs, no seeded prefix, no end state, and determinism as configured', () => {
    const { adapter } = setup();
    expect(adapter.id).toBe('process');
    expect(adapter.capabilities()).toEqual({
      variants: false,
      seedPrefix: false,
      toolStubs: false,
      trace: false,
      sandbox: true,
      endState: false,
      deterministic: false,
    });
    expect(setup({ deterministic: true }).adapter.capabilities().deterministic).toBe(true);
  });

  it('seeds the workspace, runs the agent on the stimulus and returns an ordinary Observed', async () => {
    const { adapter, open, boxes } = setup();
    const from = given();
    const session = await open(from);
    expect(await boxes[0]?.sandbox.listFiles()).toEqual(['README.txt', 'catalog.csv']);

    const observed = await adapter.send(session, turn(0, 'Build a price sheet from catalog.csv.', from));
    expect(Observed.parse(observed)).toEqual(observed);
    const reply = 'Wrote out/acme-price-sheet.csv with 6 plans. History: 0 messages.';
    expect(observed.text).toBe(reply);
    expect(observed.segments).toEqual([{ type: 'text', text: reply }]);
    expect(observed.toolCalls).toEqual([]);
    expect(observed.workspaceDiff).toEqual({
      created: ['out/acme-price-sheet.csv'],
      changed: [],
      deleted: [],
    });

    const bytes = await adapter.readArtifact(session, 'out/acme-price-sheet.csv');
    expect(Buffer.from(bytes).toString('utf8')).toBe(SHEET);
    expect(observed.artifacts).toEqual([
      { path: 'out/acme-price-sheet.csv', sha256: sha256(SHEET), bytes: Buffer.byteLength(SHEET) },
    ]);

    const [reported, agent, ...rest] = observed.executions ?? [];
    expect(rest).toEqual([]);
    expect(reported).toMatchObject({ command: 'node --version', exitCode: 0 });
    expect(agent).toMatchObject({ exitCode: 0, stderr: '' });
    expect(agent?.command).toContain('code-agent.mjs');
    expect(Number.isNaN(Date.parse(agent?.startedAt ?? ''))).toBe(false);
    expect(observed.latencyMs).toBe(agent?.latencyMs);
    expect(observed.runtime).toEqual({
      skills: [{ name: 'csv' }],
      guards: [{ name: 'no_destructive_ops', verdict: 'pass' }],
      stages: [{ name: 'build_sheet' }],
    });
    expect(observed.raw).toEqual({ sandbox: { kind: 'local', isolation: 'weak' } });
    // The protocol files sit in the workspace, yet never show in the diff or the artifacts.
    expect(await boxes[0]?.sandbox.listFiles()).toEqual(
      expect.arrayContaining([
        processProtocolFiles.history,
        processProtocolFiles.commands,
        processProtocolFiles.runtime,
      ]),
    );
  });

  it('shows a rewritten file as changed in a second block, and hands the agent the history', async () => {
    const { adapter, open } = setup();
    const from = given();
    const session = await open(from);
    const first = await adapter.send(session, turn(0, 'Build a price sheet from catalog.csv.', from));
    const history: Message[] = [
      { role: 'user', content: 'Build a price sheet from catalog.csv.' },
      { role: 'assistant', content: first.text },
    ];
    session.history.push(...history);

    const second = await adapter.send(session, turn(1, 'Add a summary of the cheapest plans.', from));
    expect(second.workspaceDiff).toEqual({ created: [], changed: ['out/acme-price-sheet.csv'], deleted: [] });
    expect(second.artifacts).toEqual([
      {
        path: 'out/acme-price-sheet.csv',
        sha256: sha256(SHEET + SUMMARY),
        bytes: Buffer.byteLength(SHEET + SUMMARY),
      },
    ]);
    expect(second.artifacts?.[0]?.sha256).not.toBe(first.artifacts?.[0]?.sha256);
    expect(second.text).toContain('History: 2 messages.');
    expect(second.runtime?.stages).toEqual([{ name: 'add_summary' }]);
    // Each block reports its own commands only.
    expect(second.executions).toHaveLength(2);
  });

  it('shows the file a destructive agent deleted', async () => {
    const { adapter, open } = setup();
    const from = given();
    const session = await open(from);
    const observed = await adapter.send(session, turn(0, 'Build the sheet, then delete README.txt.', from));
    expect(observed.workspaceDiff).toEqual({
      created: ['out/acme-price-sheet.csv'],
      changed: [],
      deleted: ['README.txt'],
    });
    expect(observed.runtime?.guards).toEqual([{ name: 'no_destructive_ops', verdict: 'fail' }]);
  });

  it('reports a non-zero exit in the execution record instead of failing the block', async () => {
    const { adapter, open } = setup();
    const from = given();
    const session = await open(from);
    const observed = await adapter.send(session, turn(0, 'Build the sheet and exit 3.', from));
    expect(observed.executions?.at(-1)?.exitCode).toBe(3);
    expect(observed.workspaceDiff?.created).toEqual(['out/acme-price-sheet.csv']);
  });

  it('fails the open with a transport error when the agent binary is missing, and leaves no sandbox', async () => {
    for (const command of ['driftbench-no-such-agent', join(parent, 'no-such-agent')]) {
      const { adapter, boxes } = setup({ command, args: [] });
      await expect(adapter.open(given())).rejects.toBeInstanceOf(AdapterTransportError);
      expect(boxes).toHaveLength(1);
      expect(boxes[0]?.destroyed).toBe(true);
      expect(existsSync(boxes[0]?.sandbox.root ?? '')).toBe(false);
    }
  });

  it('passes the stimulus in a file named on the command line in file mode', async () => {
    for (const args of [[AGENT], [AGENT, '{stimulus_file}']]) {
      const { adapter, open } = setup({ stimulus: 'file', args });
      const from = given();
      const session = await open(from);
      const observed = await adapter.send(session, turn(0, 'Build a price sheet with a summary.', from));
      expect(observed.text).toContain('Added a summary');
      expect(observed.executions?.at(-1)?.command).toMatch(/code-agent\.mjs driftbench-stimulus\.txt$/);
      expect(observed.workspaceDiff).toEqual({
        created: ['out/acme-price-sheet.csv'],
        changed: [],
        deleted: [],
      });
    }
  });

  it('seeds what a later Given adds before the agent runs, and keeps what the agent changed', async () => {
    const { adapter, open, folder } = setup();
    const start = given();
    const session = await open(start);
    await writeFile(join(folder(), 'README.txt'), 'edited during the run\n');
    const injected = given({
      'catalog.csv': CATALOG,
      'README.txt': README,
      'NOTES.txt': 'Fictional note planted by a perturbation.\n',
    });
    const observed = await adapter.send(session, turn(0, 'Build a price sheet from catalog.csv.', injected));
    expect(await readFile(join(folder(), 'NOTES.txt'), 'utf8')).toContain('planted by a perturbation');
    expect(await readFile(join(folder(), 'README.txt'), 'utf8')).toBe('edited during the run\n');
    expect(observed.workspaceDiff).toEqual({
      created: ['out/acme-price-sheet.csv'],
      changed: [],
      deleted: [],
    });
  });

  it('stops a slow agent at the block latency budget without failing the block', async () => {
    const { adapter, open } = setup();
    const from = given();
    const session = await open(from);
    const started = Date.now();
    const observed = await adapter.send(session, turn(0, 'sleep 5000 then build', from, { latencyMs: 300 }));
    expect(Date.now() - started).toBeLessThan(4000);
    expect(observed.executions).toHaveLength(1);
    expect(observed.executions?.[0]?.exitCode).toBe(124);
    expect(observed.workspaceDiff).toEqual({ created: [], changed: [], deleted: [] });
  });

  it('skips a protocol line that does not parse and names it in raw', async () => {
    const { adapter, open } = setup();
    const from = given();
    const session = await open(from);
    const observed = await adapter.send(session, turn(0, 'Build the sheet and garble the log.', from));
    expect(observed.executions).toHaveLength(2);
    expect(observed.raw).toMatchObject({ protocolErrors: ['driftbench-commands.jsonl line 2: not JSON'] });
  });

  it('runs an agent that writes no protocol file: no runtime, only its own execution record', async () => {
    const { adapter, open } = setup({
      command: 'sh',
      args: [
        '-c',
        'cat > request.txt; printf "%s|%s|%s" "$ACME_REGION" "$DRIFTBENCH_BLOCK" "$DRIFTBENCH_TEST_SECRET"',
      ],
      env: { ACME_REGION: 'north' },
    });
    const from = given();
    const session = await open(from);
    process.env.DRIFTBENCH_TEST_SECRET = 'must not leak';
    try {
      const observed = await adapter.send(session, turn(4, 'Write the request down.', from));
      expect(observed.text).toBe('north|4|');
      expect(observed.runtime).toBeUndefined();
      expect(observed.executions).toEqual([expect.objectContaining({ exitCode: 0 })]);
      expect(observed.workspaceDiff).toEqual({ created: ['request.txt'], changed: [], deleted: [] });
      const leak = await adapter.send(session, turn(5, 'x', from));
      expect(leak.text).toBe('north|5|');
    } finally {
      delete process.env.DRIFTBENCH_TEST_SECRET;
    }
  });

  it('closes safely twice and refuses a block after, and keep leaves the workspace for inspection', async () => {
    const { adapter, boxes } = setup();
    const session: Session = await adapter.open(given());
    await adapter.close(session);
    await adapter.close(session);
    expect(boxes[0]?.destroyed).toBe(true);
    expect(existsSync(boxes[0]?.sandbox.root ?? '')).toBe(false);
    await expect(adapter.send(session, turn(0, 'x', given()))).rejects.toThrow(/closed/);

    const kept = setup({ keep: true });
    const from = given();
    const keptSession = await kept.adapter.open(from);
    const observed = await kept.adapter.send(keptSession, turn(0, 'Build a price sheet.', from));
    await kept.adapter.close(keptSession);
    const folder = kept.folder();
    expect(observed.raw).toEqual({ sandbox: { kind: 'local', isolation: 'weak', kept: folder } });
    expect(await readFile(join(folder, 'out', 'acme-price-sheet.csv'), 'utf8')).toBe(SHEET);
    await rm(folder, { recursive: true, force: true });
  });

  it('runs both blocks of the Acme price-sheet task and its perturbed world, from the loaded spec', async () => {
    const loaded = await loadSpecFile(PRICE_SHEET);
    if (!loaded.ok) throw new Error(`the price-sheet spec does not load: ${JSON.stringify(loaded.errors)}`);
    const { spec } = loaded;
    const [build, summary] = spec.blocks;
    const notes = spec.perturbations?.[0]?.world?.workspace;
    if (build === undefined || summary === undefined || notes === undefined)
      throw new Error('the task changed shape');
    const base: ResolvedGiven = {
      prefix: [],
      ledger: spec.given?.ledger ?? {},
      world: spec.given?.world ?? {},
      vars: {},
      target: spec.target ?? { adapter: 'process' },
      hash: 'price-sheet',
    };
    const latency = build.budget?.latency_ms;
    const { adapter, open, folder } = setup();

    const session = await open(base);
    const first = await adapter.send(session, {
      index: 0,
      stimulus: build.when,
      given: base,
      ...(latency === undefined ? {} : { budget: { latencyMs: latency } }),
    });
    expect(first.workspaceDiff).toEqual({ created: ['out/acme-price-sheet.csv'], changed: [], deleted: [] });
    const second = await adapter.send(session, { index: 1, stimulus: summary.when, given: base });
    expect(second.workspaceDiff).toEqual({ created: [], changed: ['out/acme-price-sheet.csv'], deleted: [] });

    // Perturbed mode: the injected block's world adds NOTES.txt, seeded before the agent runs.
    const perturbed = await open(base);
    const injected: ResolvedGiven = {
      ...base,
      world: { ...base.world, workspace: notes },
      hash: 'price-sheet-p',
    };
    const observed = await adapter.send(perturbed, { index: 0, stimulus: build.when, given: injected });
    expect(await readFile(join(folder(1), 'NOTES.txt'), 'utf8')).toBe(notes.files?.['NOTES.txt']);
    expect(observed.workspaceDiff).toEqual({
      created: ['out/acme-price-sheet.csv'],
      changed: [],
      deleted: [],
    });
  });

  it('runs the same agent through the docker sandbox code, on the fake docker command line', async () => {
    const dir = join(parent, 'fake-docker');
    await mkdir(join(dir, 'workspaces'), { recursive: true });
    const binary = join(dir, 'fake-docker.mjs');
    await copyFile(FAKE_DOCKER, binary);
    await chmod(binary, 0o755);
    const provider = dockerProvider({ image: 'acme/agent:1', binary, dir: join(dir, 'workspaces') });
    const adapter = processAdapter({ command: NODE, args: [AGENT], provider });
    const from = given();
    const session = await adapter.open(from);
    try {
      const observed = await adapter.send(session, turn(0, 'Build a price sheet from catalog.csv.', from));
      expect(Observed.parse(observed)).toEqual(observed);
      expect(observed.workspaceDiff).toEqual({
        created: ['out/acme-price-sheet.csv'],
        changed: [],
        deleted: [],
      });
      expect(observed.executions?.map((record) => record.exitCode)).toEqual([0, 0]);
      expect(observed.runtime?.stages).toEqual([{ name: 'build_sheet' }]);
      expect(observed.raw).toEqual({ sandbox: { kind: 'docker', isolation: 'strong' } });
    } finally {
      await adapter.close(session);
    }
  });
});

const IMAGE = process.env.DRIFTBENCH_DOCKER_IMAGE ?? 'node:22-alpine';
const docker = dockerProvider({ image: IMAGE });
const dockerReady =
  (await docker.available()) &&
  (spawnSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' }).status === 0 ||
    spawnSync('docker', ['pull', IMAGE], { stdio: 'ignore', timeout: 180_000 }).status === 0);
if (!dockerReady) {
  process.stderr.write(
    `process adapter tests on docker skipped: no docker daemon, or no ${IMAGE} image, here\n`,
  );
}

describe.runIf(dockerReady)(`the process adapter on docker with ${IMAGE}`, () => {
  it('runs the fixture agent in a container and returns the same Observed', async () => {
    const agent = await readFile(AGENT, 'utf8');
    const adapter = processAdapter({ command: 'node', args: ['agent.mjs'], provider: docker });
    const from = given({ 'catalog.csv': CATALOG, 'README.txt': README, 'agent.mjs': agent });
    const session = await adapter.open(from);
    try {
      const observed = await adapter.send(session, turn(0, 'Build a price sheet from catalog.csv.', from));
      expect(observed.workspaceDiff).toEqual({
        created: ['out/acme-price-sheet.csv'],
        changed: [],
        deleted: [],
      });
      expect(observed.artifacts?.[0]?.sha256).toBe(sha256(SHEET));
      expect(observed.executions?.at(-1)?.exitCode).toBe(0);
      expect(observed.raw).toEqual({ sandbox: { kind: 'docker', isolation: 'strong' } });
    } finally {
      await adapter.close(session);
    }
  });
});

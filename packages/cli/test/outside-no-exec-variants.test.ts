import { chmod, cp, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Io, main } from '../src/index';

vi.setConfig({ testTimeout: 120_000 });

/**
 * In the estate model: a part that `guards` an event holds code another part runs (an `executes` part), and a run
 * that is told not to execute lacks the `execution` capability. The rule: a run on a stand-in that is told not to
 * execute runs NO command the estate declares, whatever the event it hangs on, the way it is written or the tool that triggers it; a run that is not told so runs them. The
 * run says that it ran nothing, so a reader never takes a missing verdict for a pass. The markers below are
 * written by commands the generator invents; the expected sets follow from the rule, not from a first run.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const LIVE = join(FIXTURE, 'generated/specs/live');
const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
const SPEC = join(
  LIVE,
  'route_positive/estate.route_positive.route.invoice-reconcile.an-ask-that-fits-invoice-reconcile.1.yaml',
);

const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop'];
const SHAPES: Array<{ id: string; write: (marker: string) => string }> = [
  { id: 'direct program', write: (marker) => `touch ${marker}` },
  { id: 'absolute program', write: (marker) => `/usr/bin/touch ${marker}` },
  { id: 'environment prefix', write: (marker) => `MODE=strict touch ${marker}` },
  { id: 'shell string', write: (marker) => `sh -c 'touch ${marker}'` },
];

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'estate-no-exec-'));
  folders.push(dir);
  return dir;
}

async function run(argv: string[]) {
  const out = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      out.out += text;
    },
    err: (text) => {
      out.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...out };
}

/** A copy of the fixture with one hook per (event, shape), each writing a marker of its own. */
async function marked(): Promise<{
  copy: string;
  markers: Array<{ event: string; shape: string; path: string }>;
}> {
  const dir = await folder();
  const copy = join(dir, 'estate');
  await cp(join(FIXTURE, 'CLAUDE.md'), join(copy, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(copy, '.claude'), { recursive: true });
  const markers = EVENTS.flatMap((event, e) =>
    SHAPES.map((shape, s) => ({
      event,
      shape: shape.id,
      path: join(dir, `marker-${e}-${s}`),
      write: shape.write,
    })),
  );
  const settingsPath = join(copy, '.claude/settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  for (const event of EVENTS) {
    settings.hooks[event] = [
      ...(settings.hooks[event] ?? []),
      {
        hooks: markers
          .filter((m) => m.event === event)
          .map((m) => ({ type: 'command', command: m.write(m.path) })),
      },
    ];
  }
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
  return { copy, markers: markers.map(({ event, shape, path }) => ({ event, shape, path })) };
}

const exists = (path: string) =>
  stat(path).then(
    () => true,
    () => false,
  );

async function runOn(copy: string, ...extra: string[]) {
  const result = await run([
    'estate',
    'run',
    SPEC,
    '--estate',
    copy,
    '--runtime',
    'claude-code',
    '--command',
    FAKE,
    '--store',
    join(await folder(), 'runs.db'),
    '--json',
    ...extra,
  ]);
  return { ...result, json: JSON.parse(result.out) as { notes: string[]; runs: Array<{ status: string }> } };
}

describe('--no-exec on a stand-in (matrix over event and command shape)', () => {
  it('runs every declared command without the flag, so the matrix can tell the two apart', async () => {
    const { copy, markers } = await marked();
    await runOn(copy);
    const ran = await Promise.all(
      markers.map(async (marker) => [marker.event, marker.shape, await exists(marker.path)]),
    );
    expect(ran.filter(([, , did]) => !did)).toEqual([]);
  });

  it('runs none of them with the flag', async () => {
    const { copy, markers } = await marked();
    await runOn(copy, '--no-exec');
    const ran = await Promise.all(
      markers.map(async (marker) => [marker.event, marker.shape, await exists(marker.path)]),
    );
    expect(ran.filter(([, , did]) => did)).toEqual([]);
  });
});

/**
 * The second oracle: no program of the estate runs, wherever the stand-in would start one (a hook, a provoked
 * call, a step of a skill). Every script of the copy is replaced by a stub that writes its own name to a log, and
 * `python3` on the PATH is a shim that does the same; so any start of an estate program leaves a line, however the
 * stand-in reached it. The sample spans the spec types that reach each place.
 */
const SAMPLE: Array<{ folder: string; count: number }> = [
  { folder: 'guard_positive', count: 3 },
  { folder: 'ordered_pair', count: 2 },
  { folder: 'journey', count: 3 },
  { folder: 'skip_pressure', count: 2 },
  { folder: 'tool_boundary', count: 2 },
];

async function sampleSpecs(): Promise<string[]> {
  const out: string[] = [];
  for (const { folder: name, count } of SAMPLE) {
    const files = (await readdir(join(LIVE, name))).filter((file) => file.endsWith('.yaml')).sort();
    out.push(...files.slice(0, count).map((file) => join(LIVE, name, file)));
  }
  return out;
}

/** A copy whose scripts are stubs that log, and the PATH shim; returns where the log is. */
async function stubbed(): Promise<{ copy: string; log: string; shim: string }> {
  const dir = await folder();
  const copy = join(dir, 'estate');
  const log = join(dir, 'started.log');
  const shim = join(dir, 'shim');
  await cp(join(FIXTURE, 'CLAUDE.md'), join(copy, 'CLAUDE.md'));
  await cp(join(FIXTURE, '.claude'), join(copy, '.claude'), { recursive: true });
  await mkdir(shim, { recursive: true });
  const stub = `#!/bin/sh\necho "$0" >> "$STUB_LOG"\nexit 0\n`;
  await writeFile(join(shim, 'python3'), stub);
  await chmod(join(shim, 'python3'), 0o755);
  const walk = async (folder: string): Promise<string[]> => {
    const entries = await readdir(folder, { withFileTypes: true });
    const nested = await Promise.all(
      entries.map((entry) =>
        entry.isDirectory() ? walk(join(folder, entry.name)) : [join(folder, entry.name)],
      ),
    );
    return nested.flat();
  };
  for (const file of await walk(join(copy, '.claude'))) {
    if (/\/(?:guards|hooks)\/|\/scripts\//.test(file) && /\.(sh|py)$/.test(file)) {
      await writeFile(file, stub);
      await chmod(file, 0o755);
    }
  }
  return { copy, log, shim };
}

/** What a run of the sample started, and how many specs it ran: a run that ran nothing proves nothing. */
async function startsOn(extra: string[]): Promise<{ starts: string[]; ran: number; wanted: number }> {
  const { copy, log, shim } = await stubbed();
  const specs = await sampleSpecs();
  const store = join(await folder(), 'runs.db');
  const result = await run([
    'estate',
    'run',
    ...specs,
    '--estate',
    copy,
    '--runtime',
    'claude-code',
    '--command',
    FAKE,
    '--store',
    store,
    '--set-env',
    `STUB_LOG=${log}`,
    // The shim comes first; the rest of the PATH stays, so the stand-in finds its own interpreter.
    '--set-env',
    `PATH=${shim}:${process.env.PATH ?? '/usr/bin:/bin'}`,
    '--json',
    ...extra,
  ]);
  const text = await readFile(log, 'utf8').catch(() => '');
  const parsed =
    result.out === '' ? undefined : (JSON.parse(result.out) as { runs: Array<{ status: string }> });
  return {
    starts: text.split('\n').filter((line) => line !== ''),
    ran: parsed?.runs.length ?? 0,
    wanted: specs.length,
  };
}

describe('no program of the estate starts (matrix over spec types)', () => {
  it('starts programs of the estate without the flag, so the log can tell the two apart', async () => {
    const without = await startsOn([]);
    expect(without.ran).toBe(without.wanted);
    expect(without.starts.length).toBeGreaterThan(0);
  });

  it('starts none with the flag, and every spec of the sample still ran', async () => {
    const withFlag = await startsOn(['--no-exec']);
    expect(withFlag.ran).toBe(withFlag.wanted);
    expect(withFlag.starts).toEqual([]);
  });
});

describe('metamorphic: --no-exec', () => {
  it('says in the run that nothing of the estate ran: one note more than the same run without the flag', async () => {
    const { copy } = await marked();
    const without = await runOn(copy);
    const withFlag = await runOn(copy, '--no-exec');
    expect(withFlag.json.notes.length).toBe(without.json.notes.length + 1);
  });

  it('does not change how many specs ran', async () => {
    const { copy } = await marked();
    const without = await runOn(copy);
    const withFlag = await runOn(copy, '--no-exec');
    expect(withFlag.json.runs.map((line) => line.status)).toEqual(
      without.json.runs.map((line) => line.status),
    );
  });

  it('is refused, with nothing run, for a command that is not a stand-in', async () => {
    const { copy, markers } = await marked();
    const refused = await run([
      'estate',
      'run',
      SPEC,
      '--estate',
      copy,
      '--runtime',
      'claude-code',
      '--command',
      '/bin/echo',
      '--allow-billed',
      '--no-exec',
      '--store',
      join(await folder(), 'runs.db'),
    ]);
    expect(refused.code).toBe(2);
    expect(refused.out).toBe('');
    expect(await Promise.all(markers.map((marker) => exists(marker.path)))).not.toContain(true);
  });
});

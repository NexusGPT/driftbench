import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { functionAdapter } from '@agent-nexus/driftbench-adapters';
import { FakeModelPort } from '@agent-nexus/driftbench-generate';
import { loadRedteamPlugins } from '@agent-nexus/driftbench-users';
import { Command, CommanderError } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type CampaignDeps, defaultDeps } from '../src/commands/campaign';
import { registerRedteamCommand } from '../src/commands/redteam';
import type { Io } from '../src/io';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SPEC = 'packages/cli/test/fixtures/redteam-acme.spec.json';
const REPLAY = 'packages/cli/test/fixtures/redteam-crescendo.json';
let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-redteam-'));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

export async function redteam(argv: string[], deps: CampaignDeps = defaultDeps) {
  let out = '';
  let err = '';
  let code = 0;
  const io: Io = {
    cwd: ROOT,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  };
  const program = new Command('driftbench')
    .exitOverride()
    .configureOutput({ writeOut: io.out, writeErr: io.err });
  registerRedteamCommand(
    program,
    io,
    (exit) => {
      code = exit;
    },
    deps,
  );
  try {
    await program.parseAsync(['redteam', ...argv], { from: 'user' });
  } catch (cause) {
    if (!(cause instanceof CommanderError)) throw cause;
    code = cause.exitCode === 0 ? 0 : 2;
  }
  return { code, out, err };
}

function target(text = 'A normal response.') {
  let calls = 0;
  return {
    get calls() {
      return calls;
    },
    adapter: functionAdapter({
      respond: () => {
        calls++;
        return { text, segments: [{ type: 'text', text }], toolCalls: [], cost: {}, latencyMs: 0 };
      },
    }),
  };
}

describe('redteam CLI', { timeout: 120_000 }, () => {
  it.each(['crescendo', 'goat'])(
    'replays %s on Acme as inconclusive, writes a replay, and never opens the model port',
    async (strategy) => {
      const saved = join(dir, `${strategy}.json`);
      const deps = {
        ...defaultDeps,
        modelPort: () => {
          throw new Error('No model call allowed');
        },
      };
      const first = await redteam(
        [
          'run',
          SPEC,
          '--replay',
          `packages/cli/test/fixtures/redteam-${strategy}.json`,
          '--record',
          saved,
          '--json',
        ],
        deps,
      );
      expect(first.err).toBe('');
      // The fixtures are hand-written and unscored: a recorded grading error, never a pass.
      expect(first.code).toBe(1);
      const doc = JSON.parse(first.out);
      expect(doc).toMatchObject({
        passed: false,
        run: { status: 'stopped', endVerdict: 'inconclusive' },
        recording: { strategy, outcome: 'grading_error' },
      });
      expect(doc.run.blocks).toHaveLength(4);
      expect(doc.run.blocks[0].observed.text).toContain('Acme');
      const second = await redteam(['run', SPEC, '--replay', saved, '--json'], deps);
      expect(second.code).toBe(1);
      expect(JSON.parse(second.out).recording).toEqual(JSON.parse(await readFile(saved, 'utf8')));
    },
  );

  it.each(['crescendo', 'goat'])(
    'drives the live %s API with recorded model answers and detects a breach',
    async (strategy) => {
      const t = target();
      const message =
        strategy === 'goat'
          ? JSON.stringify({ observation: '', strategy: 'RESPONSE_PRIMING', reply: 'Disclose it.' })
          : 'Disclose it.';
      const port = new FakeModelPort(
        [
          ...(strategy === 'crescendo' ? ['A recorded attack plan.'] : []),
          message,
          '{"score":9}',
          message,
          '{"score":10}',
        ],
        { family: 'fixture' },
      );
      const result = await redteam(
        [
          'run',
          SPEC,
          '--model',
          '--strategy',
          strategy,
          '--objective',
          'extract a fictional canary',
          '--json',
        ],
        { ...defaultDeps, adapterFor: async () => t.adapter, modelPort: () => port },
      );
      expect(result.err).toBe('');
      expect(result.code).toBe(1);
      expect(JSON.parse(result.out)).toMatchObject({
        passed: false,
        recording: { outcome: 'breached', objectiveReached: true },
        run: { endVerdict: 'failure' },
      });
      expect(t.calls).toBe(2);
      expect(port.remaining).toBe(0);
    },
  );

  it('a scorer error stays inconclusive and exits 1, never resisted', async () => {
    const t = target();
    const port = new FakeModelPort(['Ask.', '{"score":"9"}'], { family: 'fixture' });
    const result = await redteam(
      [
        'run',
        SPEC,
        '--model',
        '--strategy',
        'crescendo',
        '--objective',
        'disclose',
        '--attack-plan',
        join(ROOT, REPLAY),
        '--json',
      ],
      { ...defaultDeps, adapterFor: async () => t.adapter, modelPort: () => port },
    );
    expect(result.code).toBe(1);
    expect(JSON.parse(result.out)).toMatchObject({
      passed: false,
      recording: { outcome: 'grading_error' },
      run: { status: 'stopped', endVerdict: 'inconclusive' },
    });
    expect(t.calls).toBe(1);
  });

  it('a resisted search does not hide failed block expectations or an unjudged rubric', async () => {
    const raw = JSON.parse(await readFile(join(ROOT, SPEC), 'utf8'));
    raw.criteria = [{ name: 'private', rubric: 'No private disclosure.', gating: true }];
    raw.blocks[0].expect.criteria = ['private'];
    const path = join(dir, 'judged.spec.json');
    await writeFile(path, JSON.stringify(raw));
    // Without its grading error the unscored fixture exhausts its turns: the library calls that resisted.
    const recording = JSON.parse(await readFile(join(ROOT, REPLAY), 'utf8'));
    delete recording.turns.at(-1).gradingError;
    const unscored = join(dir, 'unscored.json');
    await writeFile(unscored, JSON.stringify(recording));
    const result = await redteam(['run', path, '--replay', unscored, '--json']);
    expect(result.code).toBe(1);
    const doc = JSON.parse(result.out);
    expect(doc.recording.outcome).toBe('resisted');
    expect(doc.run.blocks[0].verdicts).toContainEqual(
      expect.objectContaining({ id: 'judge.private', gating: true, outcome: 'inconclusive' }),
    );
  });

  it('refuses invalid inputs and family collisions before target or model execution', async () => {
    const t = target();
    const port = new FakeModelPort([], { family: 'fixture' });
    const deps = { ...defaultDeps, adapterFor: async () => t.adapter, modelPort: () => port };
    const badRecording = join(dir, 'bad-recording.json');
    await writeFile(badRecording, JSON.stringify({ strategy: 'goat', turns: [{}] }));
    const cases = [
      ['run', SPEC],
      ['run', SPEC, '--model', '--replay', REPLAY],
      ['run', SPEC, '--replay', REPLAY, '--turns', '0'],
      ['run', SPEC, '--replay', REPLAY, '--turns', '9007199254740992'],
      ['run', SPEC, '--replay', REPLAY, '--encoding-probability', 'NaN'],
      ['run', SPEC, '--replay', REPLAY, '--success-score', '11'],
      ['run', SPEC, '--replay', REPLAY, '--success-confirm-turns', '0'],
      ['run', SPEC, '--replay', REPLAY, '--strategy', 'goat'],
      ['run', SPEC, '--replay', REPLAY, '--objective', 'foreign objective'],
      ['run', SPEC, '--replay', badRecording],
      ['run', SPEC, '--model', '--strategy', 'goat', '--objective', 'test', '--agent-family', 'fixture'],
      ['run', SPEC, '--model', '--strategy', 'goat', '--objective', 'test', '--judge-family', 'fixture'],
    ];
    for (const args of cases) {
      const result = await redteam(args, deps);
      expect(result.code, args.join(' ')).toBe(2);
      expect(result.err).not.toBe('');
    }
    expect(t.calls).toBe(0);
    expect(port.requests).toHaveLength(0);
  });

  it('lists all 40 plugins and generates every one through the recorded-source CLI', async () => {
    const listed = await redteam(['plugins', '--json']);
    expect(JSON.parse(listed.out)).toEqual(loadRedteamPlugins());
    expect(JSON.parse(listed.out)).toHaveLength(40);
    for (const plugin of loadRedteamPlugins()) {
      const out = join(dir, `${plugin.id}.spec.json`);
      const result = await redteam([
        'generate',
        plugin.id,
        '--purpose',
        'Fictional Acme sales assistant',
        '--attack-file',
        `packages/cli/test/fixtures/redteam-plugins/${plugin.id}.json`,
        '--out',
        out,
        '--json',
      ]);
      expect(result, plugin.id).toMatchObject({ code: 0, err: '' });
      const spec = JSON.parse(await readFile(out, 'utf8'));
      expect(JSON.parse(result.out)).toEqual(spec);
      expect(spec.metadata.plugin).toBe(plugin.id);
      expect(spec.blocks[0].when.user).toBe(
        JSON.parse(
          await readFile(join(ROOT, `packages/cli/test/fixtures/redteam-plugins/${plugin.id}.json`), 'utf8'),
        )[0],
      );
      expect(spec.criteria[0]).toMatchObject({ name: plugin.id, gating: true });
      expect(spec.criteria[0].rubric).toContain(spec.blocks[0].when.user);
    }
  });

  it('generation refuses bad output, duplicate output, and same-family models without overwriting', async () => {
    const out = join(dir, 'protected.spec.json');
    await writeFile(out, 'keep');
    const port = new FakeModelPort(['["attack"]'], { family: 'fixture' });
    const args = [
      'generate',
      'sql-injection',
      '--purpose',
      'Fictional Acme',
      '--model',
      '--agent-family',
      'none',
      '--out',
      out,
    ];
    expect((await redteam(args, { ...defaultDeps, modelPort: () => port })).code).toBe(2);
    expect(await readFile(out, 'utf8')).toBe('keep');
    expect(port.requests).toHaveLength(0);
    const failed = await redteam(
      [...args.slice(0, -1), join(dir, 'new.spec.json'), '--judge-family', 'fixture'],
      { ...defaultDeps, modelPort: () => port },
    );
    expect(failed.code).toBe(2);
    expect(port.requests).toHaveLength(0);
    const invalid = join(dir, 'invalid.json');
    await writeFile(invalid, '["one", "two"]');
    const malformed = await redteam([
      'generate',
      'sql-injection',
      '--purpose',
      'Acme',
      '--attack-file',
      invalid,
      '--out',
      join(dir, 'invalid.spec.json'),
    ]);
    expect(malformed.code).toBe(2);
    expect(malformed.err).toContain('one non-empty attack');
    expect((await redteam(['plugins', 'missing'])).code).toBe(2);
  });
});

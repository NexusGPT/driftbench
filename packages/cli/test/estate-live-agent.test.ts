import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Io, main } from '../src/index';

vi.setConfig({ testTimeout: 240_000 });

/**
 * The fake headless command on an ask its manifest does not name: it acts from the estate it is given
 * (routes, skills, helpers, the step list, the hooks of the settings), knowing nothing of any test or mutant.
 * A spec green on the fixture turns red on a mutant because the copy it reads changed.
 */

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const MAP = join(FIXTURE, 'approved.yaml');
const FAKE = join(FIXTURE, 'live/fake/claude.mjs');
const LIVE = join(FIXTURE, 'generated/specs/live');

async function run(argv: string[]) {
  const output = { out: '', err: '' };
  const io: Io = {
    out: (text) => {
      output.out += text;
    },
    err: (text) => {
      output.err += text;
    },
    cwd: ROOT,
  };
  const code = await main(argv, io);
  return { code, ...output };
}

const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'estate-live-agent-'));
  folders.push(dir);
  return dir;
}

async function pass(estate: string, spec: string): Promise<boolean> {
  const store = join(await folder(), 'runs.db');
  const result = await run([
    'estate',
    'run',
    join(LIVE, spec),
    '--estate',
    estate,
    '--runtime',
    'claude-code',
    '--command',
    FAKE,
    '--store',
    store,
    '--json',
  ]);
  const json = JSON.parse(result.out.slice(result.out.indexOf('{')));
  return json.runs?.[0]?.pass === true;
}

async function mutant(atom: string): Promise<string> {
  const to = join(await folder(), 'mutant');
  const made = await run(['estate', 'mutate', MAP, '--atom', atom, '--delete', '--to', to]);
  expect(made.code, made.err).toBe(0);
  return to;
}

describe('the fake on an ask it holds no stream for: acts read from the estate', () => {
  it('walks the step list, the step allowed at any point included, and stops when the list loses it', async () => {
    const spec = 'stage_anytime/estate.stage_anytime.stage.steps.stage-note-write-a-tracker-note.yaml';
    expect(await pass(FIXTURE, spec)).toBe(true);
    expect(await pass(await mutant('stage.steps.stage-note-write-a-tracker-note'), spec)).toBe(false);
  });

  it('plays a recorded guard row only while the copy still runs that guard', async () => {
    const spec = 'guard_positive/estate.pairwise.147.yaml';
    expect(await pass(FIXTURE, spec)).toBe(true);
    expect(await pass(await mutant('guard.settings.pretooluse-bash-guard-block-force-push'), spec)).toBe(
      false,
    );
  });

  it('dispatches the helper whose description fits the ask, and no helper once the description is gone', async () => {
    const spec = 'dispatch/estate.dispatch.subagent.inbox-triager.helper-inbox-triager.yaml';
    expect(await pass(FIXTURE, spec)).toBe(true);
    expect(await pass(await mutant('route.inbox-triager.an-ask-that-fits-inbox-triager'), spec)).toBe(false);
  });
});

describe('a recorded stream on a copy that lost a step', () => {
  it('plays no row of a step the step list no longer holds', async () => {
    const spec = 'journey/estate.journey.03.yaml';
    expect(await pass(FIXTURE, spec)).toBe(true);
    expect(await pass(await mutant('stage.steps.stage-do-make-the-change'), spec)).toBe(false);
  });
});

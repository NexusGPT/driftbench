import { cp, mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { estateBuildCommand } from '../src/commands/estate-build';

const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));

/** The yaml files under a folder, as paths. */
async function specs(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await specs(full)));
    else if (entry.name.endsWith('.yaml')) found.push(full);
  }
  return found;
}

describe('driftbench estate build with no state library given', () => {
  it('writes its own states/library.json and plans the session states from it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-states-'));
    await cp(FIXTURE, join(root, 'estate'), { recursive: true });
    // No library beside the estate, no committed suite, and no --states: the build has only its own.
    await rm(join(root, 'estate', 'live', 'states'), { recursive: true, force: true });
    await rm(join(root, 'estate', 'generated'), { recursive: true, force: true });
    let out = '';
    let err = '';
    const code = await estateBuildCommand(
      'estate',
      { out: 'b', yes: true, pointer: true, cassette: 'estate/cassette.jsonl' },
      {
        cwd: root,
        out: (text) => {
          out += text;
        },
        err: (text) => {
          err += text;
        },
      },
      { now: () => new Date('2026-01-01T00:00:00Z'), interactive: false },
    );
    expect(code).toBe(1);

    const generated = join(root, 'b', 'generated');
    const library = JSON.parse(await readFile(join(generated, 'states', 'library.json'), 'utf8'));
    expect(Object.keys(library.states).sort()).toEqual(['after_compaction', 'after_restart', 'long']);
    expect(Object.keys(library.events).sort()).toEqual([
      'compaction_mid_task',
      'process_restart',
      'rate_wave',
    ]);
    expect(await readFile(join(generated, 'states', 'prefixes', 'long.jsonl'), 'utf8')).not.toBe('');

    // The build prints how many tests it wrote, and says how many wait for a state the library lacks.
    const written = out.match(
      /5\. Write the tests: (\d+) tests written\. (\d+) are complete and (\d+) still wait/,
    );
    expect(written?.slice(1)).toEqual(['1427', '782', '645']);
    const waiting = err.match(/^(\d+) rows need states not in the library: (.*)\. Pass --states/);
    expect(waiting?.[2]).toBe(
      'event dead_helper, event stale_tracker, session state helpers_running, session state resumed',
    );
    expect(waiting?.[1]).toBe('569');

    // Complete live tests set the states of the library, and never one it lacks.
    const live = await specs(join(generated, 'specs', 'live'));
    const states = new Map<string, number>();
    for (const file of live) {
      const state = (await readFile(file, 'utf8')).match(/^ {4}session_state: (\w+)$/m)?.[1] ?? 'fresh';
      states.set(state, (states.get(state) ?? 0) + 1);
    }
    for (const state of ['long', 'after_compaction', 'after_restart']) {
      expect(states.get(state) ?? 0).toBeGreaterThan(0);
    }
    expect([...states.keys()].sort()).toEqual(['after_compaction', 'after_restart', 'fresh', 'long']);
    expect(live.length).toBeGreaterThan(0);
  }, 180_000);
});

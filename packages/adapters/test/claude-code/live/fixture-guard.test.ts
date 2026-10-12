import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ESTATE } from './support';

/**
 * The Northwind guard `read-before-edit.py`, fed the PreToolUse input the runtime really sends (seen in the
 * first real run): `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `tool_name`, `tool_input`. The
 * reads come from the transcript, not from a field the runtime never sends. Exit 2 blocks the edit.
 */

const GUARD = join(ESTATE, '.claude', 'guards', 'read-before-edit.py');
const folders: string[] = [];
afterEach(async () => {
  while (folders.length > 0) await rm(folders.pop() ?? '', { recursive: true, force: true });
});

async function project(reads: string[]): Promise<{ dir: string; transcript: string }> {
  const dir = await mkdtemp(join(tmpdir(), 'guard-'));
  folders.push(dir);
  await writeFile(join(dir, 'report.md'), '# Week 41\n');
  const transcript = join(dir, 'session.jsonl');
  const lines = reads.map((path, index) =>
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'tool_use', id: `t${index}`, name: 'Read', input: { file_path: path } }],
      },
    }),
  );
  await writeFile(
    transcript,
    `${[JSON.stringify({ type: 'user', message: { role: 'user', content: 'Fix the heading.' } }), ...lines].join('\n')}\n`,
  );
  return { dir, transcript };
}

function guard(input: Record<string, unknown>): { status: number | null; stderr: string } {
  const run = spawnSync('python3', [GUARD], { input: JSON.stringify(input), encoding: 'utf8' });
  return { status: run.status, stderr: run.stderr };
}

const event = (dir: string, transcript: string, tool: string, path: string) => ({
  session_id: 's-1',
  transcript_path: transcript,
  cwd: dir,
  hook_event_name: 'PreToolUse',
  tool_name: tool,
  tool_input: { file_path: path },
});

describe('read-before-edit.py on the input the runtime sends', () => {
  it('allows an edit of a file the transcript shows was read', async () => {
    const { dir, transcript } = await project([]);
    await writeFile(transcript, '');
    const { transcript: read } = await project([join(dir, 'report.md')]);
    expect(guard(event(dir, read, 'Edit', join(dir, 'report.md'))).status).toBe(0);
  });

  it('blocks an edit of a file never read, with the rule as its message', async () => {
    const { dir, transcript } = await project([join(tmpdir(), 'other.md')]);
    const run = guard(event(dir, transcript, 'Edit', join(dir, 'report.md')));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain('Read a file before you edit it.');
  });

  it('allows writing a new file, which has nothing to read', async () => {
    const { dir, transcript } = await project([]);
    expect(guard(event(dir, transcript, 'Write', join(dir, 'new.md'))).status).toBe(0);
  });

  it('matches a relative path read against the absolute path edited', async () => {
    const { dir, transcript } = await project(['report.md']);
    expect(guard(event(dir, transcript, 'Edit', join(dir, 'report.md'))).status).toBe(0);
  });
});

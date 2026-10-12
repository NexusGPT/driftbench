import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type JsonlLine, mapSession, parseJsonl, replayAdapter } from '../../src/claude-code';

const CWD = '/work/demo';
let clock = 0;
const at = (seconds: number) => new Date(Date.UTC(2026, 0, 5, 9, 0, seconds)).toISOString();
const base = (type: string, extra: Record<string, unknown> = {}) => ({
  type,
  sessionId: 'fields',
  cwd: CWD,
  timestamp: at(clock++),
  ...extra,
});
const user = (content: unknown) => base('user', { message: { role: 'user', content } });
const assistant = (content: unknown[]) =>
  base('assistant', { message: { id: `m${clock}`, role: 'assistant', content } });
const use = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: unknown, isError = false) =>
  user([{ type: 'tool_result', tool_use_id: id, content, ...(isError ? { is_error: true } : {}) }]);
const lines = (records: unknown[]): JsonlLine[] =>
  parseJsonl(records.map((record) => JSON.stringify(record)).join('\n'));

function session(references?: string[]) {
  clock = 0;
  return mapSession({
    transcript: lines([
      user('Add a Summary sheet.'),
      assistant([
        use('r1', 'Read', { file_path: `${CWD}/.claude/skills/xlsx/SKILL.md` }),
        use('r2', 'Read', { file_path: `${CWD}/build_sheet.py` }),
        use('r3', 'Read', { file_path: `${CWD}/notes/plan.md` }),
        use('r4', 'Read', { file_path: `${CWD}/.claude/skills/xlsx/missing.md` }),
      ]),
      result('r1', 'skill body'),
      result('r2', 'script body'),
      result('r3', 'plan'),
      result('r4', 'File does not exist.', true),
      assistant([
        use('a1', 'Agent', {
          subagent_type: 'sheet-reviewer',
          model: 'sonnet',
          prompt: 'Check the Summary sheet.',
        }),
        use('a2', 'Task', { description: 'look around', prompt: 'Look around.' }),
      ]),
      result('a1', 'Looks right.'),
      result('a2', 'Done.'),
      assistant([{ type: 'text', text: 'Done.' }]),
    ]),
    ...(references ? { references } : {}),
  });
}

describe('mapSession: files read and helpers dispatched', () => {
  it('maps successful reads under a skill folder to references, relative to the session folder', () => {
    const runtime = session().blocks[0]?.observed.runtime;
    expect(runtime?.references?.map((reference) => reference.path)).toEqual(['.claude/skills/xlsx/SKILL.md']);
    expect(runtime?.references?.[0]?.at).toBe(at(1));
  });

  it('adds reads of any path the spec names, by path or glob', () => {
    const runtime = session(['build_sheet.py', 'notes/*.md']).blocks[0]?.observed.runtime;
    expect(runtime?.references?.map((reference) => reference.path)).toEqual([
      '.claude/skills/xlsx/SKILL.md',
      'build_sheet.py',
      'notes/plan.md',
    ]);
  });

  it('maps Agent and Task calls to subagents: the name from subagent_type, the model from the input', () => {
    const runtime = session().blocks[0]?.observed.runtime;
    expect(runtime?.subagents).toEqual([
      { name: 'sheet-reviewer', model: 'sonnet', at: at(6) },
      { name: 'general-purpose', at: at(6) },
    ]);
  });
});

describe('replayAdapter: reading the files a session left', () => {
  let dir: string | undefined;
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it('reads an artifact from the after folder, and refuses a path outside it', async () => {
    dir = await mkdtemp(join(tmpdir(), 'driftbench-fields-'));
    await mkdir(join(dir, 'out'));
    await writeFile(join(dir, 'out', 'sheet.csv'), 'a,b\n');
    const adapter = replayAdapter({ session: session(), files: dir });
    const opened = await adapter.open({
      prefix: [],
      ledger: {},
      world: {},
      vars: {},
      target: { adapter: 'claude-code' },
      hash: 'h',
    });
    const bytes = await adapter.readArtifact?.(opened, 'out/sheet.csv');
    expect(new TextDecoder().decode(bytes)).toBe('a,b\n');
    await expect(adapter.readArtifact?.(opened, '../secret')).rejects.toThrow(/outside/);
    expect(replayAdapter({ session: session() }).readArtifact).toBeUndefined();
  });
});

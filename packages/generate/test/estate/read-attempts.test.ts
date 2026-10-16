import { someCall } from '@agent-nexus/driftbench-checks';
import type { CheckContext, ToolCall } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { MARKERS, stageModel, type ThenContext, thenOf } from '../../src/estate/then';

const reference: EstateAtom = {
  id: 'reference.archive.policy',
  kind: 'reference',
  title: 'Open the archive policy before exporting.',
  approved: true,
  evidence: [
    { type: 'tool_called', label: 'Read', input: { file_path: { contains: 'rules/archive-policy.txt' } } },
  ],
  fields: { path: 'rules/archive-policy.txt', exists: false },
};
const ctx: ThenContext = {
  stages: stageModel([]),
  skills: new Set(),
  files: new Set(['CLAUDE.md']),
  customChecks: new Set(['some_call']),
};
const read = (file_path: string, error?: string): ToolCall => ({
  id: file_path,
  label: 'Read',
  input: { file_path },
  ...(error ? { error } : {}),
});

async function verdict(calls: ToolCall[]) {
  const then = thenOf([reference], 'positive', ctx);
  expect(then.gaps).toEqual([]);
  expect(then.references).toEqual([]);
  const result = await someCall({ blockIndex: 0, observed: { toolCalls: calls } } as CheckContext, {
    calls: then.someCalls,
  });
  return Array.isArray(result) ? result : [result];
}

describe('an estate obligation to open a missing reference', () => {
  it('checks the attempted Read, including a file-not-found response', async () => {
    expect(
      (await verdict([read('/workspace/rules/archive-policy.txt', 'File does not exist.')]))[0]?.outcome,
    ).toBe('pass');
  });
  it('kills agents that skip the attempt or read another file', async () => {
    expect((await verdict([]))[0]?.outcome).toBe('fail');
    expect((await verdict([read('/workspace/rules/unrelated.txt')]))[0]?.outcome).toBe('fail');
  });
  it('keeps successful-read expectations for a file that exists', () => {
    const then = thenOf([reference], 'positive', { ...ctx, files: new Set(['rules/archive-policy.txt']) });
    expect(then.someCalls).toEqual([]);
    expect(then.references).toEqual([{ path: '**/rules/archive-policy.txt', count: { min: 1 } }]);
  });
  it('keeps the missing-file gap when no attempted-call checker is registered', () => {
    const then = thenOf([reference], 'positive', { ...ctx, customChecks: new Set() });
    expect(then.gaps.map((gap) => gap.marker)).toEqual([MARKERS.existingFile]);
  });

  it.each(['~/team-notes.txt', '/outside/team-notes.txt', '../team-notes.txt', 'rules/../../team-notes.txt'])(
    'keeps a gap for a target outside the estate: %s',
    (path) => {
      const atom = {
        ...reference,
        evidence: [{ type: 'tool_called' as const, label: 'Read', input: { file_path: { contains: path } } }],
      };
      const then = thenOf([atom], 'positive', { ...ctx, root: '/estate' });
      expect(then.someCalls).toEqual([]);
      expect(then.gaps).toMatchObject([{ marker: MARKERS.existingFile, path }]);
    },
  );

  it('never mistakes an external reference for a held file with the same suffix', () => {
    const then = thenOf([{ ...reference, fields: { ...reference.fields, external: true } }], 'positive', {
      ...ctx,
      files: new Set(['rules/archive-policy.txt']),
    });
    expect(then.someCalls).toEqual([]);
    expect(then.references).toEqual([]);
    expect(then.gaps[0]?.marker).toBe(MARKERS.existingFile);
  });

  it('accepts an absolute internal path only when the original root contains it', () => {
    const atom = {
      ...reference,
      evidence: [
        {
          type: 'tool_called' as const,
          label: 'Read',
          input: { file_path: { contains: '/estate/rules/archive-policy.txt' } },
        },
      ],
    };
    expect(thenOf([atom], 'positive', { ...ctx, root: '/estate' }).someCalls).toMatchObject([
      { input: { file_path: { contains: 'rules/archive-policy.txt' } } },
    ]);
    expect(thenOf([atom], 'positive', { ...ctx, root: '/estate-other' }).gaps[0]?.marker).toBe(
      MARKERS.existingFile,
    );
  });

  it('supports old maps, escapes pattern characters, and preserves the required call count', async () => {
    const path = '.claude/skills/report/rules/archive(approved)+.txt';
    const atom: EstateAtom = {
      ...reference,
      provenance: { file: '.claude/skills/report/SKILL.md', quote: '' },
      evidence: [{ type: 'tool_called', label: 'Read', min: 2, input: { file_path: { contains: path } } }],
    };
    const then = thenOf([atom], 'positive', ctx);
    const check = async (paths: string[]) => {
      const result = await someCall(
        {
          blockIndex: 0,
          observed: { toolCalls: paths.map((path) => read(path, 'missing')) },
        } as CheckContext,
        { calls: then.someCalls },
      );
      return (Array.isArray(result) ? result : [result])[0]?.outcome;
    };
    expect(await check([path, 'rules/archive(approved)+.txt'])).toBe('pass');
    expect(await check([path])).toBe('fail');
    expect(await check(['rules/archiveapproved.txt', 'rules/archiveapproved.txt'])).toBe('fail');
    expect(then.needs).toMatchObject([{ path, blocking: false }]);
  });
});

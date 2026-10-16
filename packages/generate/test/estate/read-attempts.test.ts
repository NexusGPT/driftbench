import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { MARKERS, stageModel, type ThenContext, thenOf } from '../../src/estate/then';

/** A reference that obliges a Read of `path`, in the input forms the estate reader writes. */
const reference = (path: string, input: Record<string, unknown>): EstateAtom => ({
  id: `reference.archive.${path.replace(/\W+/g, '-')}`,
  kind: 'reference',
  title: `Open ${path} before exporting.`,
  approved: true,
  evidence: [{ type: 'tool_called', label: 'Read', input }],
  fields: { path, exists: false },
});
const ctx = (files: string[], checks: string[]): ThenContext => ({
  stages: stageModel([]),
  skills: new Set(),
  files: new Set(files),
  customChecks: new Set(checks),
});

const FORMS: Array<[string, string, Record<string, unknown>]> = [
  ['contains', 'rules/archive-policy.txt', { file_path: { contains: 'rules/archive-policy.txt' } }],
  ['equals', 'docs/tides/chart.md', { file_path: { equals: 'docs/tides/chart.md' } }],
  ['a plain string', 'notes/berths.md', { file_path: 'notes/berths.md' }],
  ['the path key', 'ledger/2026.csv', { path: { contains: 'ledger/2026.csv' } }],
  ['a leading ./', './rules/dock.md', { file_path: { contains: './rules/dock.md' } }],
];

describe('an estate obligation to open a file the estate does not hold', () => {
  it.each(FORMS)(
    'waits on needs-existing-file, whatever checks the runner registers: %s',
    (_form, path, input) => {
      for (const checks of [[], ['some_call'], ['some_call', 'ordered', 'absence']]) {
        const then = thenOf(
          [reference(path, input)],
          'positive',
          ctx(['CLAUDE.md', 'other/readme.md'], checks),
        );
        expect(
          then.gaps.map((gap) => gap.marker),
          checks.join(),
        ).toEqual([MARKERS.existingFile]);
        expect(then.references).toEqual([]);
        expect(then.someCalls).toEqual([]);
      }
    },
  );

  it('keeps the successful-read expectation for a file the estate holds, however the path is written', () => {
    const files = ['rules/archive-policy.txt', 'docs/tides/chart.md', 'notes/berths.md'];
    for (const [path, input] of [
      ['rules/archive-policy.txt', { file_path: { contains: 'rules/archive-policy.txt' } }],
      ['chart.md', { file_path: { contains: 'tides/chart.md' } }],
    ] as const) {
      const then = thenOf([reference(path, input)], 'positive', ctx(files, ['some_call']));
      expect(then.gaps).toEqual([]);
      expect(then.someCalls).toEqual([]);
      expect(then.references).toHaveLength(1);
    }
  });

  it('is not a gap in a negative control, where the Read is forbidden', () => {
    const then = thenOf(
      [reference('rules/old.md', { file_path: { contains: 'rules/old.md' } })],
      'negative',
      ctx(['CLAUDE.md'], ['some_call']),
    );
    expect(then.gaps.map((gap) => gap.marker)).not.toContain(MARKERS.existingFile);
  });
});

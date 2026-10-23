import { describe, expect, it } from 'vitest';
import { readerProfile, sourceCoverage } from '../../../src/scan/readers/raw-support';
import { readerSetupTypes } from '../../../src/scan/readers/setup-types';

const types = readerSetupTypes('fictional-runtime', {
  version: 1,
  types: {
    instruction: {
      root: 'source',
      locate: '**/policy.md',
      aspects: ['instructs'],
      loaded: 'always',
    },
  },
}).base;
if (!types) throw new Error('missing fictional built-ins');
const profile = readerProfile('fictional-runtime', types, {});
const files = (...paths: string[]) => paths.map((path) => ({ path, text: 'Fictional content.\n' }));

describe('source coverage follows coverageOf', () => {
  it('refuses an unresolved root name with a structured code even for an empty source', () => {
    expect(() =>
      sourceCoverage({ ...profile, coverageRoots: ['missing'] }, { files: [], skipped: [] }),
    ).toThrowError(expect.objectContaining({ code: 'unknown-coverage-root', root: 'missing' }));
  });

  it('counts reached files and retains configuration, size, ignore and unread reasons', () => {
    const inventory = {
      files: files('policy.md', 'reached.txt', 'unknown.xyz', 'driftbench.estate.yaml'),
      skipped: [
        { what: 'large.txt', reason: 'size-limit:1048576' },
        { what: 'binary.dat', reason: 'binary-content' },
      ],
    };
    expect(
      sourceCoverage(profile, inventory, {
        reached: new Set(['reached.txt']),
        ignored: ['ignored/**', 'ignored/**'],
        pruned: ['pruned/**'],
      }),
    ).toEqual({
      covered: 2,
      unknown: ['unknown.xyz'],
      skipped: [
        { what: 'driftbench.estate.yaml', reason: 'estate-config' },
        { what: 'large.txt', reason: 'too-large' },
        { what: 'ignored/**', reason: 'ignored' },
        { what: 'pruned/**', reason: 'ignored' },
        { what: 'binary.dat', reason: 'binary-content' },
      ],
    });
  });

  it('resolves root names and counts outside files only when typed or reached', () => {
    expect(
      sourceCoverage(
        { ...profile, roots: { source: 'owned' } },
        {
          files: files('owned/unknown.xyz', 'outside.xyz', 'policy.md', 'reached.txt'),
          skipped: [],
        },
        { reached: new Set(['reached.txt']), ignored: ['ignored/**'], pruned: ['outside/**'] },
      ),
    ).toEqual({
      covered: 2,
      unknown: ['owned/unknown.xyz'],
      skipped: [{ what: 'ignored/**', reason: 'ignored' }],
    });
  });
});

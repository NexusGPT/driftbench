import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { catalogueLine } from '../../src/estate/summary';

// The pages that show the summary of `driftbench estate generate` carry the line the command prints.
const root = new URL('../../../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), 'utf8');

describe('the catalogue checks line of the generate summary', () => {
  const line = catalogueLine({ tested: 0, needsTrigger: 0, needsHost: 0 });

  it('names the counts in the core word for the thing that runs a check: a guard', () => {
    expect(line).toBe(
      'Catalogue checks: 0 tested through their host guard, 0 need a trigger, 0 need a host guard.',
    );
    expect(catalogueLine({ tested: 3, needsTrigger: 2, needsHost: 1 })).toBe(
      'Catalogue checks: 3 tested through their host guard, 2 need a trigger, 1 need a host guard.',
    );
  });

  it.each([
    'docs/estate.md',
    'packages/cli/help/validate-estate-generate.md',
    'packages/cli/help/results-diagnostics.md',
  ])('is the line %s shows', (page) => {
    expect(read(page).split('\n')).toContain(line);
  });
});

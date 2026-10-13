import { describe, expect, it } from 'vitest';
import type { EstateAtom } from '../../src/estate/inputs';
import { stageModel, type ThenContext, thenOf } from '../../src/estate/then';

const ctx: ThenContext = { stages: stageModel([]), skills: new Set(), customChecks: new Set(['ordered']) };

function gate(quote: string, fields: Record<string, unknown> = {}, after = 'Edit'): EstateAtom {
  return {
    id: 'gate.x',
    kind: 'gate',
    title: quote,
    approved: true,
    evidence: [{ type: 'ordered', before: 'Read', after }],
    provenance: { file: 'CLAUDE.md', quote },
    fields,
  };
}

describe('the ordered pair of a gate', () => {
  it('ties the read to the file the gate names, so another read does not satisfy it', () => {
    const then = thenOf(
      [
        gate('Before editing a menu: read `references/menu-format.md`.', {
          path: '.claude/skills/menu/references/menu-format.md',
        }),
      ],
      'positive',
      ctx,
    );
    expect(then.ordered).toEqual([
      { before: 'Read~.claude/skills/menu/references/menu-format.md', after: 'Edit' },
    ]);
  });

  it('asks for a read of the same file when the gate names no file of its own', () => {
    expect(thenOf([gate('Read a file before you edit it.')], 'positive', ctx).ordered).toEqual([
      { before: 'Read', after: 'Edit', key: 'file_path' },
    ]);
    expect(thenOf([gate('Read the file before changing it.', {}, 'Write')], 'positive', ctx).ordered).toEqual(
      [{ before: 'Read', after: 'Write', key: 'file_path' }],
    );
  });

  it('keeps a plain pair when the gate reads something else than the file it acts on', () => {
    expect(thenOf([gate('Read the plan before you edit the report.')], 'positive', ctx).ordered).toEqual([
      { before: 'Read', after: 'Edit' },
    ]);
    expect(
      thenOf(
        [
          gate(
            'Before deploying: read `docs/deploy.md`.',
            { path: 'docs/deploy.md', external: true },
            'Bash',
          ),
        ],
        'positive',
        ctx,
      ).ordered,
    ).toEqual([{ before: 'Read', after: 'Bash' }]);
  });
});

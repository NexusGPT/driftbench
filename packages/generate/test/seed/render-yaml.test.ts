import { expect, it } from 'vitest';
import { stringify } from 'yaml';
import { generatedSpecText, renderDraft, specText } from '../../src/seed/assemble';
import { prepareMap } from '../../src/seed/map';
import { zedProposal } from '../enumerate/support';

const run = { seed: 1, mapPath: 'map.yaml' };
function render(world?: unknown) {
  return renderDraft(
    prepareMap(zedProposal()),
    {
      id: 'rendered',
      seeder: 'graph',
      title: 'Fresh objects',
      stream: 1,
      cell: [],
      criteria: [],
      world: world as never,
      blocks: [
        {
          id: 'b1',
          carries: [],
          stage: 'help',
          stimulus: {
            kind: 'phrase',
            phrase: {
              dimension: 'flow',
              value: 'balance',
              text: 'Hello',
              lang: 'en',
              produced_by: 'code',
              approved: true,
            },
          },
        },
      ],
    },
    run,
  );
}

it('serializes fresh generated containers without trusting caller-owned world data', () => {
  let reads = 0;
  const result = {
    get value() {
      reads += 1;
      return 'original';
    },
  };
  const rendered = render({ tools: { lookup: { result } } });
  const expected = stringify(rendered.spec, { lineWidth: 0, aliasDuplicateObjects: false });
  reads = 0;
  const text = generatedSpecText(rendered, run, 'hash');
  expect(text.slice(text.indexOf('\nid:') + 1)).toBe(expected);
  expect(reads).toBe(1);
  expect(specText(rendered, run, 'hash')).toBe(text);
});

it('keeps the public writer safe after callers replace fresh properties with accessors', () => {
  const rendered = render();
  let reads = 0;
  Object.defineProperty(rendered.spec, 'title', { enumerable: true, get: () => `Title ${++reads}` });
  const expected = stringify(rendered.spec, { lineWidth: 0, aliasDuplicateObjects: false });
  reads = 0;
  const text = specText(rendered, run, 'hash');
  expect(text.slice(text.indexOf('\nid:') + 1)).toBe(expected);
  expect(reads).toBe(1);
});

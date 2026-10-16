import { parseSpecText } from '@agent-nexus/driftbench-core';
import { expect, it } from 'vitest';
import { estateOwners } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

const unit = (name: string, description: string): EstateAtom => ({
  id: `skill.${name}`,
  kind: 'skill',
  title: name,
  approved: true,
  fields: { name, description },
  provenance: { file: `skills/${name}/SKILL.md`, quote: description },
  evidence: [{ type: 'skill_loaded', name }],
});
const hub = unit('catalogue', 'Prepare the annual catalogue.');
const shipping = unit('shipping', 'Track delayed parcels for the dispatch centre.');
const reference = (
  id: string,
  path = 'skills/shipping/references/carriers.md',
  quote = 'Read the carrier policy when needed.',
): EstateAtom => ({
  id,
  kind: 'reference',
  title: 'Read the carrier policy',
  approved: true,
  fields: { path, readWhen: 'When a carrier update arrives' },
  provenance: { file: hub.provenance?.file, quote },
  evidence: [{ type: 'tool_called', label: 'Read', input: { file_path: { equals: path } } }],
});
function run(atoms: EstateAtom[], rows: EstatePlanRow[]) {
  const edges = atoms
    .filter((atom) => atom.kind === 'reference')
    .flatMap((atom) => [
      { from: hub.id, to: atom.id, kind: 'reference' },
      { from: shipping.id, to: atom.id, kind: 'reference' },
    ]);
  const map = { runtime: 'claude-code', hash: 'dispatch', atoms, edges };
  return generateEstateSuite(
    {
      map,
      plan: { mapHash: map.hash, rows },
      bank: PhraseBank.parse({
        version: 1,
        estate: 'dispatch',
        mapHash: map.hash,
      }),
    },
    { paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
}
const row = (id: string): EstatePlanRow => ({
  id,
  atomIds: [id, hub.id],
  cell: {},
  testType: 'read_when',
  mode: 'live',
  status: 'approved',
});

it('the target folder overrides a wrong citing skill, including stale plan metadata', () => {
  const ref = reference('reference.carriers');
  const suite = run([hub, shipping, ref], [row(ref.id)]);
  expect(
    estateOwners([hub, shipping, ref], [{ from: hub.id, to: ref.id, kind: 'reference' }]).get(ref.id),
  ).toBe(shipping.id);
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(suite.report.summary.complete).toBe(1);
  expect(suite.specs[0]?.atoms).toEqual([ref.id, shipping.id]);
  expect(parsed.spec.blocks[0]?.when).toEqual({
    user: 'Please track delayed parcels for the dispatch centre. When a carrier update arrives.',
  });
  expect(parsed.spec.blocks[0]?.expect?.skills).toEqual([{ name: 'shipping', count: { min: 1 } }]);
  expect((parsed.spec.metadata?.estate as { atoms?: string[] } | undefined)?.atoms).not.toContain(hub.id);
});

it.each([
  [
    'Before notarizing the delivery document, read the shipping policy.',
    'help me with notarizing the delivery document',
  ],
  [
    'Before you translate the customs declaration, read the shipping policy.',
    'translate the customs declaration',
  ],
  ['Read the shipping policy before preparing the customs declaration.', 'prepare the customs declaration'],
  ['Read the shipping policy first, then archive the delivery receipt.', 'archive the delivery receipt'],
  ['Never publish the carrier notice without reading the shipping policy.', 'publish the carrier notice'],
])('takes the work from its own governed clause: %s', (quote, action) => {
  const ref = reference('reference.clause', undefined, quote);
  const suite = run([hub, shipping, ref], [row(ref.id)]);
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({ user: `Please ${action}.` });
});

it('an unowned shared reference never borrows a globally linked task or hides its gaps by grouping', () => {
  const first = reference('reference.shared-one', 'shared/policy.md');
  const second = reference('reference.shared-two', 'shared/policy.md');
  const suite = run([hub, shipping, first, second], [row(first.id), row(second.id)]);
  expect(suite.report.summary.complete).toBe(0);
  expect(suite.report.incomplete).toHaveLength(2);
  expect(suite.report.equivalence.collapsed).toBe(0);
  for (const spec of suite.specs) {
    expect(spec.atoms).toHaveLength(1);
    expect(spec.markers).toContain('needs-askable-act');
  }
});

it('preserves folder ownership across hundreds of deliberately flattened citation links', () => {
  const units = Array.from({ length: 24 }, (_, i) =>
    unit(`dispatch-${i}`, `Review the delivery notes for dispatch centre ${i}.`),
  );
  const actions = ['archive', 'translate', 'publish', 'review', 'export', 'edit'];
  const refs = units.flatMap((owner) =>
    Array.from({ length: 12 }, (_, i) => {
      const ref = reference(
        `reference.${owner.id}.${i}`,
        `skills/${owner.fields?.name}/references/policy-${i}.md`,
        `Before you ${actions[i % actions.length]} the ${i < 6 ? 'delivery notice' : 'carrier update'} for ${owner.fields?.name}, read the carrier policy.`,
      );
      return ref;
    }),
  );
  const suite = run(
    [hub, ...units, ...refs],
    refs.map((ref) => row(ref.id)),
  );
  expect(suite.report.summary.complete).toBe(288);
  const asks = new Set<string>();
  for (const file of suite.files.filter((file) => file.path.endsWith('.yaml'))) {
    const parsed = parseSpecText(file.text, 'yaml', file.path);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const when = parsed.spec.blocks[0]?.when;
    if (when && 'user' in when) asks.add(when.user);
  }
  expect(asks.size).toBe(288);
  expect([...asks].some((ask) => ask.includes('annual catalogue'))).toBe(false);
  for (const record of suite.specs) {
    const ref = refs.find((ref) => ref.id === record.atoms[0]);
    const expected = units.find((owner) =>
      String(ref?.fields?.path).startsWith(`skills/${owner.fields?.name}/`),
    );
    expect(record.atoms).toEqual([ref?.id, expected?.id]);
  }
});

it('uses the source clause before stale extracted gate metadata', () => {
  const ref = reference(
    'gate.delivery',
    undefined,
    'Before publishing the delivery notice, read the carrier policy.',
  );
  ref.kind = 'gate';
  ref.fields = { ...ref.fields, trigger: 'Prepare the annual catalogue.' };
  const suite = run([hub, shipping, ref], [{ ...row(ref.id), testType: 'ordered_pair' }]);
  const file = suite.files.find((file) => file.path.endsWith('.yaml'));
  if (!file) throw new Error('missing spec');
  const parsed = parseSpecText(file.text, 'yaml', file.path);
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  expect(parsed.spec.blocks[0]?.when).toEqual({ user: 'Please publish the delivery notice.' });
});

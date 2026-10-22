import { expect, it } from 'vitest';
import { navigationFiles, navigationReference } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

it('gives every reference of the fixture estate a complete spec, whatever role the map records for its document', async () => {
  const inputs = await fixtureInputs(APPROVED_PLAN);
  const result = generateEstateSuite(inputs, { paths: PLANNER_PATHS });
  const references = inputs.map.atoms.filter((atom) => atom.kind === 'reference');
  expect(references.length).toBeGreaterThan(0);
  // A reference to an example, a template or a history is still an order to read a file: it has its read test.
  // Only its journey and its covering-array cell are left out, because the document is a place to look.
  const navigation = navigationFiles(inputs.map.documents);
  const navigational = references.filter((atom) => navigationReference(atom, navigation));
  expect(navigational.map((atom) => atom.id)).toEqual([
    'reference.invoice-reconcile.read-references-currency-table-md',
    'reference.shipment-tracker.read-data-shipments-txt',
    'reference.weekly-report.read-templates-report-md',
  ]);
  for (const atom of references) {
    const done = result.specs.filter((record) => record.complete && record.atoms[0] === atom.id);
    expect(done.length, atom.id).toBeGreaterThan(0);
  }
}, 120_000);

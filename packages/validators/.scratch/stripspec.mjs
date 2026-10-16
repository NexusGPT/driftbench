import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { parse, stringify } from 'yaml';
mkdirSync('/tmp/kspecs', { recursive: true });
for (const f of ['estate.script_fixture.script.shipment-tracker.script-scripts-track-sh', 'estate.script_fixture.script.invoice-reconcile.script-scripts-reconcile-py']) {
  const s = parse(readFileSync(`../../examples/estates/fixture/generated/specs/unit/script_fixture/${f}.yaml`, 'utf8'));
  for (const b of s.blocks) { delete b.expect.skills; delete b.expect.workspace; }
  delete s.rules;
  writeFileSync(`/tmp/kspecs/${f}.yaml`, stringify(s));
}

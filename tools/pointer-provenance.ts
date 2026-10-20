/**
 * Writes the fingerprints of the items labelled blind: validators/pointer/blind-fingerprints.json.
 * Run it only after reading each changed item: an item whose fingerprint moved is no longer blind and belongs in
 * REPAIRED in packages/validators/src/ladders/pointer/bank/specs/provenance.ts.
 * Usage: pnpm tsx tools/pointer-provenance.ts
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pointerBank } from '../packages/validators/src/ladders/pointer/bank/index';
import { fingerprints } from '../packages/validators/test/pointer/fingerprint';

const ids = pointerBank()
  .filter((item) => item.provenance === 'blind')
  .map((item) => item.id)
  .sort();
const target = resolve('validators/pointer/blind-fingerprints.json');
writeFileSync(target, `${JSON.stringify(fingerprints(ids), null, 2)}\n`);
process.stdout.write(`wrote ${ids.length} fingerprints to ${target}\n`);

/**
 * Writes the blind record: the fingerprint of each of the 402 items and of each kit helper as they were at the blind
 * commit, from a checkout of that commit. Usage:
 *   git worktree add ../blind cf184f594 && pnpm tsx tools/pointer-provenance.ts ../blind
 * Prints the ids whose fingerprint differs today, the list REPAIRED in
 * packages/validators/src/ladders/pointer/bank/specs/provenance.ts must equal.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fingerprints, kitHelpers } from '../packages/validators/test/pointer/fingerprint';

const POINTER = 'packages/validators/src/ladders/pointer';
const blind = resolve(process.argv[2] ?? '', POINTER);
const here = resolve(POINTER);
const idsFile = resolve('validators/pointer/blind-record.json');
let ids: string[];
try {
  ids = Object.keys((JSON.parse(readFileSync(idsFile, 'utf8')) as { items: Record<string, string> }).items);
} catch {
  ids = JSON.parse(readFileSync(resolve(process.argv[3] ?? 'ids.json'), 'utf8')) as string[];
}
const old = fingerprints(blind, ids);
writeFileSync(
  idsFile,
  `${JSON.stringify({ commit: 'cf184f5943fdccc6e1c7670e2d74e3c70a31f691', items: old, helpers: kitHelpers(blind) }, null, 1)}\n`,
);
const now = fingerprints(here, ids);
process.stdout.write(`${ids.filter((id) => old[id] !== now[id]).join('\n')}\n`);

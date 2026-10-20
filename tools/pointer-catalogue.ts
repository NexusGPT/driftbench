/**
 * Writes the catalogue of the pointer validator bank from the bank's own rows.
 * Usage: pnpm tsx tools/pointer-catalogue.ts [output]   (default: validators/pointer/CATALOGUE.md)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { renderCatalogue } from '../packages/validators/src/ladders/pointer/bank/catalogue';

const target = resolve(process.argv[2] ?? 'validators/pointer/CATALOGUE.md');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(target, renderCatalogue());
process.stdout.write(`wrote ${target}\n`);

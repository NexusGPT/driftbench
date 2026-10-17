// Usage: CORPUS=3|5 tsx jev-experiments/dumpfeat.ts   Writes the J* feature row of every unit and its key label to feat-<corpus>.json (for a head trained on one estate and applied to another).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dir } from './src/arms';
import { C5 } from './src/corpus';
import { KEY } from './src/key4';
import { U3 } from './src/p3';
import { featureFn } from './src/feat4';
import { HEADS } from './heads4';
const h = HEADS.find((x) => x.id === 'J1')!;
const f = featureFn(h.spec);
const rows = U3.map((u) => ({ g: u.g, file: u.file, split: u.split, key: KEY.get(u.g) ?? null, x: f(u.g) }));
writeFileSync(join(dir, `feat-${C5 ? 5 : 3}.json`), JSON.stringify(rows));
console.log('rows', rows.length, 'features', rows[0]!.x.length, 'keyed', rows.filter((r) => r.key).length);

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { cut } from './src/cut';
const roots = process.argv.slice(2);
const files: string[] = [];
const walk = (d: string) => {
  for (const name of readdirSync(d)) {
    if (name === 'node_modules' || name === '.git' || name.startsWith('.cache')) continue;
    const p = join(d, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.md$/.test(name) && st.size < 400_000) files.push(p);
  }
};
for (const r of roots) walk(r);
files.sort();
const out: Record<string, string> = {};
let units = 0;
for (const f of files.slice(0, 400)) {
  const r = cut(readFileSync(f, 'utf8'));
  out[f] = r.digest.slice(0, 16);
  units += r.units.length;
}
console.log(JSON.stringify({ node: process.version, icu: process.versions.icu, unicode: process.versions.unicode, files: Object.keys(out).length, units, out }));

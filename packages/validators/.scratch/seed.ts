import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
const d = parse(readFileSync('../../examples/estates/fixture/phrases.yaml', 'utf8')) as any;
const [id, dir] = process.argv.slice(2);
const w = d.workspaces.find((x: any) => x.id === id); if (!w) process.exit(0);
for (const [k, v] of Object.entries(w.files)) { mkdirSync(dirname(join(dir!, k)), { recursive: true }); writeFileSync(join(dir!, k), String(v)); }

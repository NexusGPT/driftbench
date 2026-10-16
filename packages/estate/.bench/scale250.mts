import { ClaudeCodeReader, scanEstate } from '../src/index.ts';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { scaleEstate } from '../../validators/src/ladders/estate/bank/scale-estate.ts';
const made = (scaleEstate as any)(250, 1);
const root = await mkdtemp(join(tmpdir(), 'sc-'));
for (const [p, t] of Object.entries(made.files)) { await mkdir(dirname(join(root, p)), { recursive: true }); await writeFile(join(root, p), t as string); }
const r = await scanEstate({ root, reader: new ClaudeCodeReader() });
console.log('planted', made.atoms, 'found', r.map.atoms.length);
for (const a of r.map.atoms.filter((a) => a.fields?.candidate).slice(0, 5)) console.log(a.provenance.file, a.provenance.startLine, JSON.stringify(a.provenance.quote));

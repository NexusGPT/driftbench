import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const W = process.env.WT!;
const { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } = await import('../src/index.ts');
async function run(label: string, text: string) {
  const root = await mkdtemp(join(tmpdir(), 'perf-'));
  await writeFile(join(root, 'CLAUDE.md'), text);
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((f: any) => [f.path, f])));
  codeAtoms(raw, builder);
  const t = performance.now(); const c0 = process.cpuUsage();
  const atoms = proseCandidates(raw, builder);
  console.log(label, 'chars', text.length, 'atoms', atoms.length, 'ms', Math.round(performance.now() - t), 'cpu', Math.round((process.cpuUsage(c0).user + process.cpuUsage(c0).system)/1000));
}
for (const n of [4000, 8000, 16000]) {
  await run(`one-paragraph-${n}`, 'Background description.\n'.repeat(n) + 'Never reveal credentials. Always verify receipts.\n');
}
for (const n of [4000, 8000]) {
  await run(`rules-in-one-paragraph-${n}`, Array.from({length: n}, (_, i) => `Item ${i} must keep its source.`).join('\n') + '\n');
}
for (const n of [4000, 8000]) {
  await run(`rules-blank-separated-${n}`, Array.from({length: n}, (_, i) => `Item ${i} must keep its source.`).join('\n\n') + '\n');
}

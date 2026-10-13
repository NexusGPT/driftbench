// Records driftbench's ROUGE-L and BLEU, both profiles, on heldout.json: npx tsx comparisons/langwatch/overlap/ours.mts
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bleuScore, rougeLScore } from '../../../packages/checks/src/checks/overlap.ts';

const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(join(here, 'heldout.json'), 'utf8')) as Array<{
  id: string;
  reply: string;
  reference: string;
}>;
const out = items.map((item) => ({
  id: item.id,
  rougeL: {
    ragas: rougeLScore(item.reply, item.reference, 'ragas'),
    driftbench: rougeLScore(item.reply, item.reference, 'driftbench'),
  },
  bleu: {
    ragas: bleuScore(item.reply, item.reference, 'ragas'),
    driftbench: bleuScore(item.reply, item.reference, 'driftbench'),
  },
}));
writeFileSync(join(here, 'recorded', 'overlap-ours.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`ours: ${out.length} pairs recorded`);

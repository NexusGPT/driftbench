/**
 * Renders the three prototype pages from a scorecard JSON (dump-scorecard.ts) and its baseline's.
 *
 *   pnpm exec tsx packages/report/prototypes/render.ts --card <scorecard.json> --baseline <baseline.json> --out <dir>
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import type { Scorecard } from '../src/scorecard';
import { renderOptionA } from './option-a';
import { renderOptionB } from './option-b';
import { renderOptionC } from './option-c';
import { prepare } from './shared';

const { values } = parseArgs({
  options: {
    card: { type: 'string' },
    baseline: { type: 'string' },
    out: { type: 'string' },
    only: { type: 'string' },
  },
});
if (!values.card || !values.out) {
  process.stderr.write('Give --card <scorecard.json> and --out <dir>.\n');
  process.exit(2);
}
const card = JSON.parse(await readFile(resolve(values.card), 'utf8')) as Scorecard;
const baseline = values.baseline
  ? (JSON.parse(await readFile(resolve(values.baseline), 'utf8')) as Scorecard)
  : undefined;
const p = prepare(card, baseline);
await mkdir(resolve(values.out), { recursive: true });
const pages = {
  a: ['option-a-brief.html', renderOptionA],
  b: ['option-b-board.html', renderOptionB],
  c: ['option-c-trace.html', renderOptionC],
} as const;
for (const [key, [name, render]] of Object.entries(pages)) {
  if (values.only && values.only !== key) continue;
  const html = render(p);
  await writeFile(join(resolve(values.out), name), html);
  process.stdout.write(`${name}: ${(html.length / 1024).toFixed(0)} KB\n`);
}

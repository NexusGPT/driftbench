/** Record the committed design and evaluation plan without opening held-out items. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, open, readFile } from 'node:fs/promises';

export const designSources = [
  'src/contestants.ts',
  'src/run.ts',
  'src/extras.ts',
  'src/call.ts',
  'src/cascade.ts',
  'src/cascade-run.ts',
  'src/answer-key.ts',
  'src/data.ts',
  'src/score.ts',
  'src/jb-final-test.ts',
  'src/jb-freeze.ts',
];
export async function designHashes() {
  return Object.fromEntries(
    await Promise.all(
      designSources.map(async (p) => [
        p,
        createHash('sha256')
          .update(await readFile(`examples/judge-benchmarks/${p}`))
          .digest('hex'),
      ]),
    ),
  );
}
if (process.argv[1]?.endsWith('jb-freeze.ts')) {
  const [without, withFormat, sampleText, thresholdText] = process.argv.slice(2);
  if (!without || !withFormat || sampleText === undefined)
    throw new Error(
      'Provide without-format id, with-format id, sample size (0 for full), and optional threshold.',
    );
  const sample = Number(sampleText),
    confidenceThreshold = Number(thresholdText ?? '0.75');
  if (!Number.isInteger(sample) || sample < 0 || !(confidenceThreshold >= 0 && confidenceThreshold <= 1))
    throw new Error('Invalid evaluation plan.');
  if (Date.now() > Date.parse('2026-10-13T04:30:00+02:00')) throw new Error('Design freeze deadline passed.');
  execFileSync(
    'git',
    ['ls-files', '--error-unmatch', '--', ...designSources.map((p) => `examples/judge-benchmarks/${p}`)],
    { encoding: 'utf8' },
  );
  const dirty = execFileSync(
    'git',
    ['diff', '--name-only', 'HEAD', '--', ...designSources.map((p) => `examples/judge-benchmarks/${p}`)],
    { encoding: 'utf8' },
  ).trim();
  if (dirty) throw new Error(`Commit the design before freezing: ${dirty}`);
  const manifest = {
    stamp: new Date().toISOString(),
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ids: [without, withFormat],
    sample,
    seed: 'codex-jb-frozen-test-v1',
    confidenceThreshold,
    deadlineMs: Date.parse('2026-10-13T06:30:00+02:00'),
    hashes: await designHashes(),
    auditPolicy:
      'Audit after freeze, without changing the judge. Exclude only documented ambiguous or defensible alternatives; retain official labels otherwise. Publish both denominators.',
  };
  const file = await open('examples/judge-benchmarks/jb-results/freeze.json', 'wx');
  await file.writeFile(JSON.stringify(manifest, null, 2));
  await file.close();
  if (!process.env.JB_SPEND_LEDGER) throw new Error('JB_SPEND_LEDGER required');
  await appendFile(
    process.env.JB_SPEND_LEDGER,
    `| ${new Date().toLocaleTimeString('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit' })} | codex-jb design FREEZE ${manifest.sha}; ${manifest.ids.join(', ')}; sample ${sample || 'full'}; confidence ${confidenceThreshold} | haiku | 0 | no new calls | 0.00000000 | no design changes after freeze |\n`,
  );
  console.log(JSON.stringify(manifest));
}

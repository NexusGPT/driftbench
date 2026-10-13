/** Record the committed design and evaluation plan without opening held-out items. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, open, readFile } from 'node:fs/promises';
import { cascadeConfig } from './cascade-run';
import { contestantById } from './contestants';

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
  // The lead's dev-only freeze rule is independent of the diagnostic label audit.
  const selection = JSON.parse(
    await readFile('examples/judge-benchmarks/jb-results/summary.json', 'utf8'),
  ) as { stamp: string; variants: { id: string; n: number; official: number; cost100: number }[] };
  if (withFormat !== without.replace('-cascade', '-format-cascade') && withFormat !== `${without}-format`)
    throw new Error('Freeze ids must be the same design with and without format parsing.');
  for (const id of [without, withFormat]) {
    const cascade = cascadeConfig(id);
    if (!cascade) contestantById(id);
    else if (cascade.confidenceThreshold !== confidenceThreshold)
      throw new Error('Configuration id and confidence threshold disagree.');
  }
  const chosen = selection.variants.filter((r) => [without, withFormat].includes(r.id) && r.n === 121);
  if (chosen.length !== 2) throw new Error('Both freeze configurations need complete 121-pair dev results.');
  const chosenCorrect = Math.round(Math.max(...chosen.map((r) => r.official)) * 121);
  const qualifying = selection.variants.filter((r) => r.n === 121 && Math.round(r.official * 121) >= 113);
  if (without === 'driftbench-reference3') {
    if (qualifying.length)
      throw new Error('A measured dev variant meets the 113-item selection requirement.');
  } else if (chosenCorrect < 113) {
    throw new Error('A replacement design must beat original reference3 by at least two dev items.');
  }
  const manifest = {
    stamp: new Date().toISOString(),
    sha: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    ids: [without, withFormat],
    sample,
    seed: 'codex-jb-frozen-test-v1',
    confidenceThreshold: cascadeConfig(without) ? confidenceThreshold : null,
    selection: {
      rule: 'Use a replacement only at 113/121 official or better; otherwise freeze original reference3.',
      baselineCorrect: 111,
      minimumReplacementCorrect: 113,
      chosenCorrect,
      summaryStamp: selection.stamp,
      qualifying: qualifying.map((r) => r.id),
      devEvidence: chosen,
    },
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

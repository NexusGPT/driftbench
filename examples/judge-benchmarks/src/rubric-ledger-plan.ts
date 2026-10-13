import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadBenchmark, splitOf, stratifiedSample, type PairItem } from './data';
import { rubricItems } from './rubric-items';

/** Freeze model-independent inputs. Never score, execute candidates, or call a model. */
async function main() {
  if (process.argv.includes('--help')) {
    console.log('pnpm exec tsx --no-cache examples/judge-benchmarks/src/rubric-ledger-plan.ts');
    return;
  }
  process.env.DRIFTBENCH_BENCH_CACHE = resolve('.cache/ledger-rb/data');
  const directory = 'examples/judge-benchmarks/experiments/ledger-rb';
  const all = (await loadBenchmark('rubricbench')).items as PairItem[];
  const ids: string[] = JSON.parse(await readFile(`${directory}/test-ids.json`, 'utf8'));
  const dev = all.filter((item) => splitOf('rubricbench', item.id) === 'dev');
  const idSet = new Set(ids);
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const requirements = all.map((item) => {
    const definitions = rubricItems(item.criterion!);
    if (!definitions.length) throw new Error(`No rubric: ${item.id}`);
    return { id: item.id, split: idSet.has(item.id) ? 'test' : 'dev',
      canonicalFirst: sha(item.a) > sha(item.b) ? 'B' : 'A',
      responseASha256: sha(item.a), responseBSha256: sha(item.b),
      requirements: definitions.map((text, i) => ({ name: `rb_${i + 1}`, rubric: text })) };
  });
  const groups = [...new Set(dev.map((item) => item.group))].sort();
  const fixtures = groups.map((group) => {
    const items = dev.filter((item) => item.group === group);
    return { group, availableDevPairs: items.length,
      ids: stratifiedSample(items, 6, 'ledger-rb-fixture-v1').map((item) => item.id),
      status: items.length >= 6 ? 'selection frozen; earning pending' : 'ineligible for earned seat; base judge only',
      requiredRepeats: 3, requiredKappa: 0.8 };
  });
  const pilotIds = stratifiedSample(dev, 20, 'ledger-rb-pilot-v1').map((item) => item.id);
  const noiseIds = stratifiedSample(dev, 30, 'ledger-rb-noise-v1').map((item) => item.id);
  const smallGroups = new Set(fixtures.filter((x) => x.availableDevPairs < 6).map((x) => x.group));
  const baseOnlyItems = all.filter((item) => idSet.has(item.id) && smallGroups.has(item.group));
  const baseOnlyByDomain = Object.fromEntries([...smallGroups].map((group) =>
    [group, baseOnlyItems.filter((item) => item.group === group).length]));
  if ([...pilotIds, ...noiseIds, ...fixtures.flatMap((x) => x.ids)].some((id) => idSet.has(id)))
    throw new Error('Development validity plan overlaps test');
  const refusal = (s: string) => /\b(?:I (?:cannot|can't|won't|am unable to)|I(?:'m| am) sorry|cannot (?:help|assist)|unable to (?:help|assist))\b/i.test(s);
  const rate = (choose: (item: PairItem) => 'A' | 'B' | 'tie') =>
    dev.filter((item) => choose(item) === item.label).length / dev.length;
  const cheaters = {
    constantFirstGameAccuracy: 0.5,
    longerWinsAccuracy: rate((item) => item.a.length === item.b.length ? 'tie' : item.a.length > item.b.length ? 'A' : 'B'),
    englishRefusalHeuristicAccuracy: rate((item) => refusal(item.a) === refusal(item.b) ? 'tie' : refusal(item.a) ? 'A' : 'B'),
    notes: 'Ties are wrong. Constant FIRST chooses A in AB and B in BA. Refusal heuristic is English-only; it is a cheater, never a policy gate.' };
  const plan = { stage: 'development selections frozen; no model earning or validity result claimed',
    devPairs: dev.length, testPairs: ids.length, pilotIds, noiseIds, noiseRepeats: 3,
    fixtures, cheaters,
    routingPolicy: 'Domains with fewer than six distinct DEV pairs are ineligible for an earned seat and use the base judge. Never merge categories. Other domains must still pass earning before routing.',
    baseOnlyTest: { pairs: baseOnlyItems.length, share: baseOnlyItems.length / ids.length,
      byDomain: baseOnlyByDomain, ids: baseOnlyItems.map((item) => item.id).sort() },
    requirementPolicy: 'Expert rubric text and order preserved. One caller-owned id per parsed rubric. No hard flag inferred from labels or responses.',
    requirementsSha256: sha(JSON.stringify(requirements)),
    sourceSha256: sha(await readFile('examples/judge-benchmarks/src/rubric-ledger-plan.ts', 'utf8')),
    pending: ['core API integration', 'per-model source/dialect freeze', 'fixture earning',
      'label-preserving and label-flipping edit fixtures', 'injection invariance', 'pilot', 'noise floor'] };
  await writeFile(`${directory}/requirements.json`, `${JSON.stringify(requirements, null, 2)}\n`);
  await writeFile(`${directory}/development-plan.json`, `${JSON.stringify(plan, null, 2)}\n`);
  console.log(JSON.stringify({ devPairs: dev.length, testPairs: ids.length, pilot: pilotIds.length,
    noise: noiseIds.length, requirementsSha256: plan.requirementsSha256, cheaters,
    baseOnlyTest: plan.baseOnlyTest,
    insufficient: fixtures.filter((x) => x.availableDevPairs < 6) }, null, 2));
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

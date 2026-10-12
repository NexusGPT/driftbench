import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promptKey, Recordings } from '../src/call';
import { type Contestant, contestantById } from '../src/contestants';
import { CRITERIA, loadBenchmark, type PairItem, splitOf, stratifiedSample } from '../src/data';
import { majoritySolve } from '../src/extras';
import { RECORDINGS, renderReport, runBenchmark, majorityPair } from '../src/run';
import { pairGames } from '../src/score';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'mm-results');
const BASELINES = ['driftbench', 'deepeval', 'promptfoo'];
const GROUPS = ['reasoning', 'chat', 'linguistics', 'language mixing', 'safety'];

export function replayPair(item: PairItem, c: Contestant, recordings: Recordings) {
  if (!c.pair || !c.parsePair || c.rubric || c.checklist) {
    throw new Error(`Only pairwise contestants without generated rubrics are supported: ${c.id}`);
  }
  const criterion = CRITERIA.mmeval;
  const setupPrompt = c.setup?.pair?.(criterion);
  const setup = setupPrompt ? recordings.get(promptKey('haiku', setupPrompt))?.text : undefined;
  const routePrompt = c.route?.(item.question);
  const route = routePrompt ? recordings.get(promptKey('haiku', routePrompt)) : undefined;
  const needsReference = Boolean(c.reference && (!c.route || (route && /^\s*\**\s*YES/i.test(route.text))));
  const referencePrompt = needsReference ? c.reference!(item.question) : undefined;
  const references = referencePrompt
    ? Array.from({ length: c.referenceSamples ?? 1 }, (_, index) =>
        recordings.get(
          promptKey(
            'haiku',
            index === 0
              ? referencePrompt
              : {
                  ...referencePrompt,
                  user: `${referencePrompt.user}\n\n(Independent solve ${index + 1} of ${c.referenceSamples}.)`,
                },
          ),
        ),
      )
    : [];
  const reference = majoritySolve(references.filter((r) => r !== undefined).map((r) => r.text));
  const records = [
    [item.a, item.b],
    [item.b, item.a],
  ].map(([a, b]) => {
    const prompt = c.pair!({ question: item.question, a: a!, b: b!, criterion, setup, reference });
    return Array.from({ length: c.samples ?? 1 }, (_, index) => {
      const sampledPrompt =
        index === 0
          ? prompt
          : {
              ...prompt,
              user: `${prompt.user}\n\n(Independent judgement ${index + 1} of ${c.samples}.)`,
            };
      const record = recordings.get(promptKey('haiku', sampledPrompt));
      if (record && c.pairIntegrity && !c.pairIntegrity.check(record.text, a!, b!)) {
        return recordings.get(
          promptKey(
            'haiku',
            c.pairIntegrity.repair({ prompt: sampledPrompt, text: record.text, a: a!, b: b! }),
          ),
        );
      }
      return record;
    });
  });
  const complete =
    (!setupPrompt || setup !== undefined) &&
    (!routePrompt || route !== undefined) &&
    (!needsReference || (reference !== undefined && references.every((r) => r !== undefined))) &&
    records.flat().every((r) => r !== undefined);
  const decisions = records.map((rs, index) =>
    majorityPair(
      rs.map((r) =>
        r &&
        (!c.pairIntegrity ||
          c.pairIntegrity.check(r.text, index === 0 ? item.a : item.b, index === 0 ? item.b : item.a))
          ? c.parsePair!(r.text)
          : 'tie',
      ),
    ),
  );
  const games = pairGames(decisions[0]!, decisions[1]!);
  return {
    id: item.id,
    group: item.group,
    language: item.language,
    label: item.label,
    complete,
    games,
    score: games.reduce((sum, d) => sum + (d === item.label ? 1 : d === 'tie' ? 0.5 : 0), 0) / 2,
    keys: records.flat().map((r) => r?.key),
  };
}

/** Same 1,500-item source sample as sampleBeforeSplit, then DEV, then common recorded coverage. */
export async function mmDevSets(recordings: Recordings) {
  const bench = await loadBenchmark('mmeval');
  const aligned = stratifiedSample(bench.items, 1500).filter(
    (i): i is PairItem => i.kind === 'pair' && splitOf('mmeval', i.id) === 'dev',
  );
  const common = aligned.filter((i) =>
    BASELINES.every((id) => replayPair(i, contestantById(id), recordings).complete),
  );
  // Equal subset allocation matches the macro-average metric. Within each subset, stratify by language.
  const pilot = GROUPS.flatMap((group) => {
    const rows = common.filter((i) => i.group === group);
    const picked = stratifiedSample(
      rows.map((i) => ({ ...i, group: i.language ?? 'unknown' })),
      20,
      'mm-dev-v1',
    );
    const ids = new Set(picked.map((i) => i.id));
    return rows.filter((i) => ids.has(i.id));
  });
  const pilotIds = new Set(pilot.map((i) => i.id));
  return {
    aligned,
    common,
    pilot,
    confirm: common.filter((i) => !pilotIds.has(i.id)),
    full: bench.items.filter((i): i is PairItem => i.kind === 'pair' && splitOf('mmeval', i.id) === 'dev'),
  };
}

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
}

async function main() {
  const phase = arg('phase') ?? 'pilot';
  if (!['pilot', 'confirm', 'common', 'aligned', 'full'].includes(phase))
    throw new Error('Invalid DEV phase');
  const tag = arg('tag');
  if (!tag || !/^[a-z0-9-]+$/.test(tag)) throw new Error('--tag requires a unique lowercase run name');
  const ids = (arg('contestants') ?? BASELINES.join(',')).split(',');
  const contestants = ids.map(contestantById);
  // The runner limits actual model calls as well as items, including both pair orders.
  if (contestants.some((c) => c.rubric || c.checklist)) {
    throw new Error('This driver supports pairwise comparisons and adaptive single-reference routing');
  }
  const replayOnly = process.argv.includes('--replay-only');
  const capUsd = Number(arg('cap-usd') ?? 0);
  if (!replayOnly && (!Number.isFinite(capUsd) || capUsd <= 0))
    throw new Error('Paid runs require --cap-usd');
  await mkdir(RESULTS, { recursive: true });
  const journal = join(RESULTS, 'runs.jsonl');
  const previous = (await readFile(journal, 'utf8').catch(() => ''))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s));
  if (previous.some((r) => r.tag === tag)) throw new Error('Choose a new tag; run accounting is append-only');
  const recorded = (await readFile(join(RECORDINGS, 'mmeval', 'haiku.jsonl'), 'utf8'))
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((s) => JSON.parse(s))
    .filter((r) => String(r.contestant).startsWith('driftbench-mm-'));
  let spent = previous.reduce((sum, r) => sum + r.newSpendUsd, 0);
  const recordedSpend = recorded.reduce((sum, r) => sum + r.costUsd, 0);
  // An interrupted run can record answers before it writes its final accounting row.
  if (!replayOnly && recordedSpend > spent + 1e-9) {
    const recovered = {
      time: new Date().toISOString(),
      tag: `recovered-before-${tag}`,
      phase,
      contestants: [],
      capUsd: 0,
      newSpendUsd: recordedSpend - spent,
      newCalls: 0,
    };
    await appendFile(journal, `${JSON.stringify(recovered)}\n`);
    const ledger = arg('ledger');
    if (ledger)
      await appendFile(
        ledger,
        `| ${recovered.time.slice(11, 16)} UTC | codex-mm interrupted run recovered before ${tag} | haiku | recorded only | 0 | ${recovered.newSpendUsd.toFixed(7)} | codex-mm total ${recordedSpend.toFixed(7)} of 8.00 |\n`,
      );
    spent = recordedSpend;
  }
  // Reserve headroom for the one in-flight call that may cross a harness cap.
  if (!replayOnly && spent + capUsd > 7.9)
    throw new Error(`Task budget: ${spent.toFixed(4)} already spent; cap too large`);
  const recordings = await new Recordings(join(RECORDINGS, 'mmeval', 'haiku.jsonl')).load();
  const sets = await mmDevSets(recordings);
  const items = sets[phase as keyof typeof sets];
  const manifest = items.map((i) => ({ id: i.id, group: i.group, language: i.language }));
  await writeFile(join(RESULTS, `${tag}-items.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(
    `${tag}: ${items.length} DEV pairs, groups ${JSON.stringify(Object.fromEntries(GROUPS.map((g) => [g, items.filter((i) => i.group === g).length])))}\n`,
  );
  const report = await runBenchmark({
    bench: 'mmeval',
    model: 'haiku',
    contestants,
    items,
    criterion: CRITERIA.mmeval,
    split: 'dev',
    concurrency: 1,
    capUsd,
    replayOnly: replayOnly ? 'lenient' : false,
    ...(arg('deadline') ? { deadlineMs: Date.parse(arg('deadline')!) } : {}),
  });
  await writeFile(
    join(RESULTS, `${tag}.json`),
    `${JSON.stringify({ phase, sourceSample: phase === 'full' ? null : 1500, sampleBeforeSplit: phase !== 'full', ...report }, null, 2)}\n`,
  );
  const after = await new Recordings(join(RECORDINGS, 'mmeval', 'haiku.jsonl')).load();
  const decisions = contestants.flatMap((c) =>
    items.map((i) => ({ contestant: c.id, ...replayPair(i, c, after) })),
  );
  await writeFile(
    join(RESULTS, `${tag}-decisions.jsonl`),
    `${decisions.map((r) => JSON.stringify(r)).join('\n')}\n`,
  );
  const entry = {
    time: new Date().toISOString(),
    tag,
    phase,
    contestants: ids,
    capUsd,
    newSpendUsd: report.newSpendUsd,
    newCalls: report.newCalls,
  };
  await appendFile(journal, `${JSON.stringify(entry)}\n`);
  const ledger = arg('ledger');
  if (ledger)
    await appendFile(
      ledger,
      `| ${entry.time.slice(11, 16)} UTC | codex-mm ${tag}: ${phase}, ${ids.join(', ')}, ${items.length} DEV pairs, cap ${capUsd} | haiku | ${report.newCalls} | ${capUsd.toFixed(2)} | ${report.newSpendUsd.toFixed(4)} | codex-mm total ${(spent + report.newSpendUsd).toFixed(4)} of 8.00 |\n`,
    );
  process.stdout.write(`${renderReport(report)}\n`);
  process.stdout.write(
    `${JSON.stringify(
      report.contestants.map((c) => ({
        id: c.contestant,
        subsets: c.summary.byGroup,
        costPer100: (c.costUsd / items.length) * 100,
      })),
      null,
      2,
    )}\n`,
  );
  if (report.stopped || report.contestants.some((c) => c.summary.missing > 0)) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });

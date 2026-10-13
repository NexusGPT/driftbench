import { execFileSync } from 'node:child_process';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Execution } from './code-evidence';
import { contestantById } from './contestants';
import { readRecordingRows } from './recording-files';
import { type ContestantReport, RECORDINGS, type RunReport } from './run';

/** Rebuild the handover from completed full-dev runs, retaining partial attempts separately. */
async function main(): Promise<void> {
  const reportPath = process.argv[2];
  if (!reportPath) throw new Error('Pass the authorized report path');
  const directory = join(fileURLToPath(new URL('..', import.meta.url)), 'experiments', 'rb');
  const completed = new Map<string, ContestantReport>();
  const partial: { file: string; items: number; missing: number; stopped?: string }[] = [];
  for (const file of await readdir(directory)) {
    if (!file.endsWith('.json') || file === 'audit.json' || file.startsWith('official-test')) continue;
    const report = JSON.parse(await readFile(join(directory, file), 'utf8')) as Partial<RunReport>;
    if (!Array.isArray(report.contestants) || report.split === 'test') continue;
    for (const contestant of report.contestants) {
      if (
        report.items === 357 &&
        (contestant.summary.missing === 0 || (!report.stopped && report.failedCalls === 0))
      )
        completed.set(contestant.contestant, contestant);
    }
    if (
      report.stopped ||
      report.items !== 357 ||
      (report.failedCalls !== 0 && report.contestants.some((c) => c.summary.missing > 0))
    )
      partial.push({
        file,
        items: report.items ?? 0,
        missing: report.contestants.reduce((n, c) => n + c.summary.missing, 0),
        ...(report.stopped ? { stopped: report.stopped } : {}),
      });
  }
  const rows = [...completed.values()].sort(
    (a, b) =>
      b.summary.value.estimate - a.summary.value.estimate ||
      (a.uniqueCostUsd ?? a.costUsd) - (b.uniqueCostUsd ?? b.costUsd),
  );
  const ours = rows.filter((r) => r.contestant.startsWith('driftbench'));
  const frozenMode = process.argv.includes('--frozen');
  const frozen = frozenMode
    ? (JSON.parse(await readFile(join(directory, 'best-config.json'), 'utf8')) as { contestant: string })
    : undefined;
  const best = frozen ? ours.find((row) => row.contestant === frozen.contestant) : ours[0];
  if (!best) throw new Error('No completed driftbench dev configuration');
  const bestCost = ((best.uniqueCostUsd ?? best.costUsd) / 357) * 100;
  const domainRows = rows.flatMap((r) =>
    Object.entries(r.summary.byGroup).map(([domain, group]) => [
      r.contestant,
      domain,
      group.n / 2,
      group.value * 100,
      ((r.uniqueCostUsd ?? r.costUsd) / 357) * 100,
    ]),
  );
  await writeFile(
    join(directory, 'domain-scores.csv'),
    `variant,domain,items,accuracy_percent,whole_judge_usd_per_100\n${domainRows.map((r) => r.map((v) => (typeof v === 'string' ? JSON.stringify(v) : String(v))).join(',')).join('\n')}\n`,
  );
  const config = contestantById(best.contestant);
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const newRows = (await readRecordingRows(join(RECORDINGS, 'rubricbench', 'haiku.jsonl'))).filter(
    (r) => r.contestant?.startsWith('driftbench-rb-') || r.contestant === 'driftbench-checklist',
  );
  const spend = newRows.reduce((a, b) => a + b.costUsd, 0);
  const audit = JSON.parse(await readFile(join(directory, 'audit.json'), 'utf8')) as {
    reports: {
      contestant: string;
      completeItems: number;
      details: { invalidChecks: boolean; invalidParse: boolean; countMismatch: boolean }[];
    }[];
  };
  const selectedAudit = audit.reports.find((row) => row.contestant === best.contestant);
  const history = JSON.parse(await readFile(join(directory, 'prior-test-history.json'), 'utf8')) as {
    earlierTest: {
      date: string;
      localTime: string;
      scorePercent: number;
      items: number;
      deepevalScorePercent: number;
    };
    cacheVerification: {
      rows: { contestant: string; scorePercent: number; missingJudgments: number; complete: boolean }[];
    };
  };
  const quoteRecovery = JSON.parse(await readFile(join(directory, 'quote-recovery.json'), 'utf8')) as {
    matchingCommit: string;
    originalQuotes: number;
    originalAffectedItems: number;
    counts: {
      presentation: number;
      renderedSeparator: number;
      jsonText: number;
      stillUnmatched: number;
      realTextRejected: number;
    };
    regradedReplyGrades: number;
    validRegrades: number;
    regradeYes: number;
    regradeNo: number;
    stillUnresolved: number;
  };
  const privacy = JSON.parse(await readFile(join(directory, 'guard-verification.json'), 'utf8')) as {
    measuredAt: string; bench: string; privateTerms: number; denylistFindings: number;
  };
  let official:
    | {
        frozenCommit: string;
        population: number;
        requestedItems: number;
        stratifiedSample: boolean;
        frozenAt: string;
        frozenBy0430: boolean;
        measuredAt: string;
        complete: boolean;
        usdPer100: number;
        run: RunReport;
        populationDomains: Record<string, number>;
        interval?: { lower: number; upper: number };
        intervalMethod: string;
        usedFallback: boolean;
        attemptRequestedItems: number;
        attemptUsdPer100ReportedItems: number;
      }
    | undefined;
  try {
    official = JSON.parse(await readFile(join(directory, 'official-test.json'), 'utf8')) as typeof official;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let testCompetitors: RunReport | undefined;
  try {
    testCompetitors = (
      JSON.parse(await readFile(join(directory, 'official-test-competitors.json'), 'utf8')) as {
        run: RunReport;
      }
    ).run;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const coverage = JSON.parse(await readFile(join(directory, 'code-coverage.json'), 'utf8')) as {
    rows: { domain: string; attempted: boolean; evidence?: { A: Execution[]; B: Execution[] } }[];
  };
  const executionRows = ['code', 'mbpp'].map((domain) => {
    const items = coverage.rows.filter((row) => row.domain === domain);
    const observations = items.flatMap((row) => [...(row.evidence?.A ?? []), ...(row.evidence?.B ?? [])]);
    const tests = observations.flatMap((observation) =>
      (observation.stdout ?? '').split('\n').flatMap((line) => {
        try {
          return (JSON.parse(line) as { tests?: { pass: boolean }[] }).tests ?? [];
        } catch {
          return [];
        }
      }),
    );
    return `| ${domain} | ${items.length} | ${items.filter((row) => row.attempted).length} | ${observations.filter((row) => ['ran', 'executed'].includes(row.status)).length} | ${tests.filter((test) => test.pass).length}/${tests.length} |`;
  });
  const freeze = {
    contestant: best.contestant,
    model: 'haiku',
    split: 'dev',
    samples: config.rubricEngine?.samples ?? config.samples ?? 1,
    rubricEngine: config.rubricEngine ?? null,
    canonicalOrder: config.canonicalOrder ?? false,
    source: config.source,
    devScore: best.summary.value.estimate,
    usdPer100: bestCost,
    newTaskSpendUsd: spend,
    measuredAt: new Date().toISOString(),
    testEvaluated: official !== undefined,
  };
  if (!frozenMode)
    await writeFile(join(directory, 'best-config.json'), `${JSON.stringify(freeze, null, 2)}\n`);
  const lines = [
    '# RubricBench dev and frozen confirmation',
    '',
    `Measured at ${freeze.measuredAt}. Branch: codex/rb-judge. Head: ${head}.`,
    '',
    `Best completed full-dev config: **${best.contestant}**, **${(best.summary.value.estimate * 100).toFixed(4)}%**, **$${bestCost.toFixed(6)} per 100 items**.`,
    `The 90% target is ${best.summary.value.estimate >= 0.9 ? 'met on dev' : 'not met on dev'}. ${official ? 'Tonight confirms the committed frozen design on a previously evaluated split.' : 'Tonight’s frozen confirmation has not run yet. The test split was previously evaluated.'}`,
    `Recorded task spend: $${spend.toFixed(6)} across ${newRows.length} new recorded calls. Aborted calls without a returned cost cannot be metered from this harness.`,
    '',
    '| Completed variant | Dev items | Game accuracy | Position consistency | USD per 100 items | Unique calls | Unresolved judgments |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows.map(
      (r) =>
        `| ${r.contestant} | ${r.summary.n} | ${(100 * r.summary.value.estimate).toFixed(4)}% | ${r.summary.positionConsistency === undefined ? 'n/a' : `${(100 * r.summary.positionConsistency).toFixed(2)}%`} | ${(((r.uniqueCostUsd ?? r.costUsd) / 357) * 100).toFixed(6)} | ${r.uniqueCalls ?? r.calls} | ${r.summary.missing} |`,
    ),
    '',
    '## Best config by domain',
    '',
    'All completed variants and every dataset domain are in domain-scores.csv beside the result JSON files. Domain labels remain exactly as the source dataset supplies them.',
    '',
    '| Dataset domain | Items | Dev accuracy | Whole judge USD per 100 |',
    '|---|---:|---:|---:|',
    ...Object.entries(best.summary.byGroup).map(
      ([name, group]) =>
        `| ${name} | ${group.n / 2} | ${(group.value * 100).toFixed(4)}% | ${bestCost.toFixed(6)} |`,
    ),
    '',
    '## Earlier test evaluation',
    '',
    `The spend ledger for ${history.earlierTest.date} records driftbench-adaptive at ${history.earlierTest.scorePercent.toFixed(1)}% on ${history.earlierTest.items} test pairs, completed at ${history.earlierTest.localTime} local. It records DeepEval at ${history.earlierTest.deepevalScorePercent.toFixed(1)}% on the same split.`,
    'Raw completion logs from 12 October also show a completed evaluation over all 1,147 pairs, including the test items. Tonight’s test result is a confirmation on a previously evaluated split.',
    `Cache-only verification reproduces DeepEval at ${(history.cacheVerification.rows.find((row) => row.contestant === 'deepeval')?.scorePercent ?? 0).toFixed(4)}% on 790 pairs. This worktree has ${history.cacheVerification.rows.find((row) => row.contestant === 'driftbench-adaptive')?.missingJudgments ?? 'unknown'} missing adaptive judgments, so its partial adaptive replay does not verify the ledger’s complete 82.6% result. No model call occurs during the history check.`,
    'History evidence and source hashes are saved in prior-test-history.json. Earlier test figures are known before tonight’s dev selection.',
    '',
    ...(official
      ? [
          '## Official frozen confirmation on the previously evaluated test split',
          '',
          `Frozen design commit: ${official.frozenCommit}. Freeze recorded at ${official.frozenAt}; by 04:30 local: ${official.frozenBy0430 ? 'yes' : 'no'}. Test measured at ${official.measuredAt}. No design changes follow that freeze.`,
          `${official.stratifiedSample ? 'Stratified sample' : 'Full test set'}: ${official.requestedItems} of ${official.population} test pairs. ${official.complete ? `All requested cases are evaluated. Missing judgments count as errors: ${official.run.contestants[0]?.summary.missing ?? 0}.` : `The run is incomplete: ${official.run.contestants[0]?.summary.missing ?? 'unknown'} missing answers; ${official.run.stopped ?? 'no stop reason'}.`}`,
          '',
          '| Split | Items | Accuracy | 95% interval | USD per 100 items |',
          '|---|---:|---:|---|---:|',
          `| Full dev | 357 | ${(best.summary.value.estimate * 100).toFixed(4)}% | not reported | ${bestCost.toFixed(6)} |`,
          `| Test${official.stratifiedSample ? ' sample' : ''} | ${official.requestedItems} | ${((official.run.contestants[0]?.summary.value.estimate ?? 0) * 100).toFixed(4)}% | ${official.interval ? `${(official.interval.lower * 100).toFixed(2)}% to ${(official.interval.upper * 100).toFixed(2)}%` : 'not available for an incomplete run'} | ${official.usdPer100.toFixed(6)} |`,
          '',
          official.intervalMethod,
          ...(official.usedFallback
            ? [
                '',
                `The live full-set attempt cannot finish within its limit. The predeclared stratified subset is judged first and reported from cache. No second model test occurs. Total attempt reproduction cost per 100 reported sample pairs is $${official.attemptUsdPer100ReportedItems.toFixed(6)}, including calls outside the reported sample.`,
              ]
            : []),
          '',
          '| Test domain | Sample pairs | Accuracy | Whole judge USD per 100 |',
          '|---|---:|---:|---:|',
          ...Object.keys(official.populationDomains).map((domain) => {
            const group = official?.run.contestants[0]?.summary.byGroup[domain];
            return `| ${domain} | ${group ? group.n / 2 : 0} | ${group ? `${(group.value * 100).toFixed(4)}%` : 'not sampled'} | ${official?.usdPer100.toFixed(6)} |`;
          }),
          '',
          'The sample size is fixed before judging. The projection uses observed dev throughput and leaves time for slow calls. Test results never select or alter the design.',
          '',
          ...(testCompetitors
            ? [
                '| Default competitor on the same test items | Accuracy | Missing answers | USD per 100 items |',
                '|---|---:|---:|---:|',
                ...testCompetitors.contestants.map(
                  (row) =>
                    `| ${row.contestant} | ${(row.summary.value.estimate * 100).toFixed(4)}% | ${row.summary.missing} | ${(((row.uniqueCostUsd ?? row.costUsd) / testCompetitors.items) * 100).toFixed(6)} |`,
                ),
                '',
                'Competitors replay their original default prompts on the exact selected test pairs. No new competitor call occurs.',
                '',
              ]
            : []),
        ]
      : []),
    '## What changed and why',
    '',
    '- Atomic grading records evidence and a score for each expert requirement for both replies. Arithmetic runs in TypeScript, not in the model.',
    '- Binary, equal-weight partial credit, importance-weighted partial credit and holistic aggregation share exact prompts. Their comparisons replay the same answers for free.',
    '- Literal grading restricts evaluation to the rubric. Contrast grading compares degree of fulfillment within each rubric. The contract variant also checks explicit user constraints omitted by the rubric.',
    '- Canonical presentation sorts responses by their content hashes, with no label, item id or domain input. Both caller orders map back to the original replies and share their recorded judgment.',
    '- Repeats and the prompt ensemble are available experimental contestants. Completed results appear above; incomplete attempts appear below. Competitor templates stay unchanged.',
    '- The pointwise engine classifies hard and soft items before seeing replies, validates exact positive quotes, permutes rubric order by sample, and enforces hard satisfaction before weighted soft counts.',
    '- Every five-vote sample uses a content-seeded rubric permutation. The one-sample control keeps the original order. Voting stops only at a mathematical majority that unseen votes cannot change.',
    '- Invalid pointwise grades and hard/soft plans receive one schema retry. The retry preserves the original rubric and response, and its model cost remains recorded.',
    '- Recording files rotate at 8 MiB. Replay reads every numeric shard, and the full-text scan checks all contents. Public-pattern annotations never suppress denylist findings.',
    `- The full-text recording scan loads ${privacy.privateTerms} private terms and finds ${privacy.denylistFindings} denylist hits, measured at ${privacy.measuredAt} for ${privacy.bench}. Terms come from the repository common root, local files and environment. They are never copied or printed.`,
    '- Code and MBPP snippets run in worktree scratch folders. Python uses supplied examples, JavaScript runs in a VM, C/C++ run when an entry point exists, and SQL uses a scratch SQLite database. A portable Java runtime is stored in the ignored worktree cache; unsupported languages and absent context remain visible unknowns.',
    '',
    `The selected configuration uses ${config.rubricEngine?.samples ?? config.samples ?? 1} judgment(s) per prompt and ${config.canonicalOrder ? 'canonical presentation' : 'the original presentation rules'}. Its measured score and domain rows above are the evidence for choosing it.`,
    ...(selectedAudit
      ? [
          `The canonical prototype has ${selectedAudit.details.filter((row) => row.countMismatch).length} rubric-count mismatches and ${selectedAudit.details.filter((row) => row.invalidParse).length} malformed outputs among ${selectedAudit.completeItems} audited pairs. Its score retains those original judgments. The pointwise engine separately validates every original rubric id. Wrapped expert questions remain one requirement.`,
        ]
      : []),
    '',
    'Canonical mapping gives the same choice in both input orders. The reported consistency metric still counts ties as inconsistent. Mapping is not evidence that the underlying model is immune to ordering. The two reported games reuse one judgment and are not independent observations.',
    'Cost counts unique recorded prompt keys within a contestant. The legacy costUsd field counts both game requests, including cache hits, and can therefore double-count canonical judgments. uniqueCostUsd is the reproduction cost used here.',
    '',
    '## Quote matching and re-grading',
    '',
    `The matcher is copied from approved PR 115 commit ${quoteRecovery.matchingCommit}. The frozen census contains ${quoteRecovery.originalQuotes} unanchored positive quotes across ${quoteRecovery.originalAffectedItems} dev pairs.`,
    '',
    '| Cumulative validation step | Additional original quotes recovered |',
    '|---|---:|',
    `| Markdown, case, typography, whitespace and ordered omissions | ${quoteRecovery.counts.presentation} |`,
    `| Rendered line separators | ${quoteRecovery.counts.renderedSeparator} |`,
    `| Strict JSON-text views | ${quoteRecovery.counts.jsonText} |`,
    `| Still unmatched after all shared rules | ${quoteRecovery.counts.stillUnmatched} |`,
    '',
    `The real-text requirement rejects ${quoteRecovery.counts.realTextRejected} of the original 55. Remaining failures receive one re-grade; unsupported evidence never becomes a candidate No vote.`,
    `Among the original unmatched quotes, ${quoteRecovery.validRegrades} have valid re-grades: ${quoteRecovery.regradeYes} yes and ${quoteRecovery.regradeNo} no. ${quoteRecovery.stillUnresolved} remain unresolved. ${quoteRecovery.regradedReplyGrades} distinct reply grades are re-graded.`,
    'The additional audit finds 52 literal quotes across 42 reply grades that the approved matcher rejects, including partial code fences and inline backticks. Those failures receive the same bounded retry. A follow-up PR is planned; tonight retains the pinned matcher. Re-grading costs remain recorded.',
    `The read-only follow-up fixture contains all 52 quotes with their complete raw candidate replies and no gold labels. It is saved at ${join(process.cwd(), '.cache/rb/normalizer-52-quotes-with-candidates.jsonl')}.`,
    '',
    '## Code execution coverage',
    '',
    '| Domain | Dev pairs inspected | Pairs with fenced snippets | Snippet groups that ran | Supplied example checks passed |',
    '|---|---:|---:|---:|---:|',
    ...executionRows,
    '',
    'Both replies pass all supplied MBPP example checks. Their preference decisions still require the formatting, preservation and explanation requirements in the rubric.',
    'No snippets means no executable observation. Unsupported languages, missing libraries, absent context and timeouts remain unknowns. A process error is not automatically a candidate defect. Standard input and command arguments are not synthesized; SQLite does not validate every SQL dialect. Grouped alternative implementations can conflict when run together. The execution journal preserves these limits alongside the actual outputs.',
    '',
    '## Reproduce',
    '',
    '```sh',
    `pnpm exec tsx examples/judge-benchmarks/src/run.ts --bench rubricbench --model haiku --split dev --contestants ${best.contestant} --concurrency 1 --replay-only`,
    'pnpm exec vitest run examples/judge-benchmarks --maxWorkers=2',
    'pnpm exec tsc -p tsconfig.json --noEmit',
    '```',
    '',
    'The inference prompts and frozen best config are saved under examples/judge-benchmarks. Raw source dataset rows stay in the ignored local cache. No packages or competitor templates change.',
    '',
    '## Partial attempts',
    '',
    'A full run must cover all 357 pairs. Unresolved judgment parses count as errors when every model request completes; they remain visible above. Missing recordings from an interrupted run cannot select the best config. A completed contestant remains eligible if a later contestant in the same report stops.',
    '',
    '| Report | Requested items | Missing answers across variants | Stop |',
    '|---|---:|---:|---|',
    ...partial.map(
      (p) => `| ${p.file} | ${p.items} | ${p.missing} | ${p.stopped ?? 'partial recording coverage'} |`,
    ),
    '',
  ];
  await writeFile(reportPath, `${lines.join('\n')}\n`);
  console.log(JSON.stringify({ reportPath, best: freeze, head }));
}

main().catch((error) => {
  console.error(String(error));
  process.exitCode = 1;
});

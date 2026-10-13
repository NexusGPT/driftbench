import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promptKey, Recordings } from './call';
import { loadBenchmark, splitOf } from './data';
import { jsonObjects } from './json';
import { candidateContainsQuote, presentationContainsQuote, quoteHasRealText } from './quote-matching';
import { parseRubricPlan, parseRubricReply, rubricPlan, rubricReply } from './rubric-engine';
import { rubricItems } from './rubric-items';
import { RECORDINGS } from './run';

async function main(): Promise<void> {
  const directory = 'examples/judge-benchmarks/experiments/rb';
  const input = JSON.parse(await readFile(join(directory, 'quote-recovery-input.json'), 'utf8')) as {
    matchingCommit: string;
    observedAt: string;
    originalUnanchoredQuotes: number;
    entries: { id: string; domain: string; key: string; quoteIndexWithinKey: number }[];
  };
  const recordings = await new Recordings(join(RECORDINGS, 'rubricbench', 'haiku.jsonl')).load();
  const data = (await loadBenchmark('rubricbench')).items.filter(
    (item) => splitOf('rubricbench', item.id) === 'dev',
  );
  const normal = (text: string) => text.replace(/\s+/g, ' ').trim();
  const counts = {
    presentation: 0,
    renderedSeparator: 0,
    jsonText: 0,
    stillUnmatched: 0,
    realTextRejected: 0,
  };
  const details = input.entries.map((entry) => {
    const item = data.find((item) => item.id === entry.id);
    if (!item || item.kind !== 'pair' || !item.criterion) throw new Error(`Missing dev pair ${entry.id}`);
    const rubrics = rubricItems(item.criterion);
    const plan = recordings.get(promptKey('haiku', rubricPlan(item.question, rubrics)));
    const rules = plan ? parseRubricPlan(plan.text, rubrics.length) : undefined;
    if (!rules) throw new Error(`Missing original rubric plan ${entry.id}`);
    const reply = [item.a, item.b].find(
      (reply) =>
        promptKey('haiku', rubricReply({ question: item.question, reply, rubrics, rules, sample: 0 })) ===
        entry.key,
    );
    const recorded = recordings.get(entry.key);
    if (reply === undefined || !recorded) throw new Error(`Missing original grade ${entry.key}`);
    const checks = jsonObjects(recorded.text)
      .filter((value) => Array.isArray(value.checks))
      .at(-1)?.checks as { id: number; yes: boolean; quote?: string }[] | undefined;
    const unmatched = checks?.filter(
      (check) =>
        check.yes === true &&
        typeof check.quote === 'string' &&
        (!normal(check.quote) || !normal(reply).includes(normal(check.quote))),
    );
    const check = unmatched?.[entry.quoteIndexWithinKey];
    if (!check || typeof check.quote !== 'string')
      throw new Error(`Original quote census changed ${entry.key}`);
    const quote = check.quote;
    const stage = presentationContainsQuote(reply, quote)
      ? 'presentation'
      : presentationContainsQuote(reply.replace(/⏎/g, '\n'), quote.replace(/⏎/g, '\n'))
        ? 'renderedSeparator'
        : candidateContainsQuote(reply, quote)
          ? 'jsonText'
          : 'stillUnmatched';
    counts[stage] += 1;
    if (!quoteHasRealText(quote)) counts.realTextRejected += 1;
    const repairPrompt = rubricReply({ question: item.question, reply, rubrics, rules, sample: 0 });
    const repaired = recordings.get(
      promptKey('haiku', {
        ...repairPrompt,
        system: `${repairPrompt.system}\nYour earlier output failed schema or evidence validation. Re-evaluate the original response. Return exactly the required JSON, with every original id once, a string quote and a Boolean yes for each check. Every positive quote must be one short continuous exact excerpt; do not join passages with ellipses or paraphrase them.`,
      }),
    );
    const repairChecks = repaired ? parseRubricReply(repaired.text, rubrics.length, reply) : undefined;
    return {
      ...entry,
      rubricId: check.id,
      recoveredAt: stage,
      ...(repaired
        ? {
            regraded: true,
            regradeValid: repairChecks !== undefined,
            regradeYes: repairChecks?.[check.id - 1],
            regradeCostUsd: repaired.costUsd,
          }
        : {}),
    };
  });
  if (details.length !== input.originalUnanchoredQuotes) throw new Error('Quote census length changed');
  const still = details.filter((entry) => entry.recoveredAt === 'stillUnmatched');
  const output = {
    measuredAt: new Date().toISOString(),
    matchingCommit: input.matchingCommit,
    originalObservedAt: input.observedAt,
    originalQuotes: details.length,
    counts,
    originalAffectedItems: new Set(details.map((entry) => entry.id)).size,
    remainingReplyGrades: new Set(still.map((entry) => entry.key)).size,
    regradedReplyGrades: new Set(still.filter((entry) => entry.regraded).map((entry) => entry.key)).size,
    validRegrades: still.filter((entry) => entry.regradeValid).length,
    regradeYes: still.filter((entry) => entry.regradeValid && entry.regradeYes).length,
    regradeNo: still.filter((entry) => entry.regradeValid && entry.regradeYes === false).length,
    stillUnresolved: still.filter((entry) => !entry.regradeValid).length,
    details,
  };
  await writeFile(join(directory, 'quote-recovery.json'), `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ ...output, details: undefined }));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

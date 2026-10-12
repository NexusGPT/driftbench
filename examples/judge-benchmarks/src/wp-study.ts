import { createHash } from 'node:crypto';
import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCaller, promptKey, type Recorded, Recordings } from './call';
import type { Prompt } from './contestants';
import { loadBenchmark, type PairItem, splitOf, stratifiedSample } from './data';
import { pairGames, scorePairs } from './score';
import {
  auditDecision,
  criterionVote,
  groundRequirementChecks,
  parseAudit,
  parseFailures,
  parseRequirements,
  parseWriting,
  requirementScore,
  sectionVote,
  writingAudit,
  writingBrief,
  writingChunks,
  writingCriteria,
  writingEditor,
  writingFactcheck,
  writingFailures,
  writingRead,
  writingReader,
  writingRequirementsBrief,
  writingSections,
} from './wp';

export type WritingStudyOptions = {
  variant: 'criteria' | 'chunked' | 'editor' | 'audit' | 'requirements' | 'reader' | 'factcheck' | 'sections';
  capUsd: number;
  concurrency: number;
  out: string;
  sample?: number;
  replayOnly?: boolean;
  ledger?: string;
};

/** Limits actual model calls, including nested reading calls, not just concurrent benchmark items. */
export function callQueue(concurrency: number) {
  if (!Number.isInteger(concurrency) || concurrency !== 1) throw new Error('concurrency must be 1');
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(f: () => Promise<T>): Promise<T> => {
    await new Promise<void>((resolve) => {
      const start = () => {
        active += 1;
        resolve();
      };
      if (active < concurrency) start();
      else waiting.push(start);
    });
    try {
      return await f();
    } finally {
      active -= 1;
      waiting.shift()?.();
    }
  };
}

export function writingRowKey(item: Pick<PairItem, 'question' | 'a' | 'b'>): string {
  return createHash('sha256')
    .update(JSON.stringify([item.question, item.a, item.b]))
    .digest('hex')
    .slice(0, 20);
}

export async function runWritingStudy(options: WritingStudyOptions) {
  if (!(options.capUsd > 0 && options.capUsd <= 8))
    throw new Error('--cap-usd must be positive and at most 8');
  const queue = callQueue(options.concurrency);
  const benchmark = await loadBenchmark('longjudge-wp');
  const dev = benchmark.items.filter(
    (i): i is PairItem => i.kind === 'pair' && splitOf(benchmark.id, i.id) === 'dev',
  );
  const items = options.sample ? stratifiedSample(dev, options.sample, 'wp-study') : dev;
  const recordings = await new Recordings(
    fileURLToPath(new URL('../recordings/longjudge-wp/haiku.jsonl', import.meta.url)),
  ).load();
  const caller = createCaller(
    recordings,
    { model: 'haiku', maxCallUsd: 0.1 },
    {
      // Reserve one full call budget so the last accepted call cannot pass the run cap.
      capUsd: Math.max(0, options.capUsd - 0.1),
      replayOnly: options.replayOnly,
    },
  );
  const pending = new Map<string, Promise<Recorded>>();
  const actualKeys = new Map<string, Recorded>();
  let stopped: string | undefined;
  let done = 0;
  const ask = (prompt: Prompt, id: string, order: string): Promise<Recorded> => {
    const key = promptKey('haiku', prompt);
    let p = pending.get(key);
    if (!p) {
      p = queue(async () => {
        if (stopped) throw new Error(stopped);
        try {
          const r = await caller.call(prompt, {
            bench: benchmark.id,
            contestant: `driftbench-wp-${options.variant}`,
            item: id,
            order,
          });
          actualKeys.set(key, r);
          return r;
        } catch (e) {
          stopped = e instanceof Error ? e.message : String(e);
          throw e;
        }
      });
      pending.set(key, p);
    }
    return p;
  };
  const results = await Promise.all(
    items.map(async (item) => {
      let costUsd = 0;
      const call = async (p: Prompt, order: string) => {
        const r = await ask(p, item.id, order);
        costUsd += r.costUsd;
        return r.text;
      };
      try {
        const brief = await call(
          options.variant === 'requirements'
            ? writingRequirementsBrief(item.question)
            : writingBrief(item.question),
          'brief',
        );
        if (options.variant === 'requirements') {
          const requirements = parseRequirements(brief);
          if (!requirements) throw new Error('Unparsed requirements');
          const texts = await Promise.all([
            call(writingFailures(item.question, requirements, item.a), 'requirements-A'),
            call(writingFailures(item.question, requirements, item.b), 'requirements-B'),
          ]);
          const checks = texts.map((t) => parseFailures(t, requirements.length));
          const scores = checks.map((c) => requirementScore(requirements, c));
          const groundedChecks = [
            groundRequirementChecks(item.a, checks[0]),
            groundRequirementChecks(item.b, checks[1]),
          ];
          const groundedScores = groundedChecks.map((c) => requirementScore(requirements, c));
          const groundedDecision: 'A' | 'B' | 'tie' =
            groundedScores[0] === undefined ||
            groundedScores[1] === undefined ||
            groundedScores[0] === groundedScores[1]
              ? 'tie'
              : groundedScores[0] > groundedScores[1]
                ? 'A'
                : 'B';
          const decision: 'A' | 'B' | 'tie' =
            scores[0] === undefined || scores[1] === undefined || scores[0] === scores[1]
              ? 'tie'
              : scores[0] > scores[1]
                ? 'A'
                : 'B';
          const games = [decision, decision];
          const parsed = checks.map((c) => (c ? { winner: decision, reason: JSON.stringify(c) } : undefined));
          done += 1;
          if (done % 10 === 0)
            process.stderr.write(
              `requirements: ${done}/${items.length}, new spend $${caller.spent().toFixed(4)}\n`,
            );
          return {
            item,
            rowKey: writingRowKey(item),
            games,
            voted: games,
            strict: games,
            parsed,
            requirements,
            checks,
            scores,
            groundedChecks,
            groundedScores,
            groundedGames: [groundedDecision, groundedDecision],
            costUsd,
            missing: checks.filter((c) => !c).length,
          };
        }
        if (options.variant === 'audit') {
          const texts = await Promise.all([
            call(writingAudit(item.question, brief, item.a), 'audit-A'),
            call(writingAudit(item.question, brief, item.b), 'audit-B'),
          ]);
          const audits = texts.map(parseAudit);
          const decision = auditDecision(audits[0], audits[1]);
          const parsed = audits.map((a) => (a ? { winner: decision, reason: a.reason } : undefined));
          const games = [decision, decision];
          done += 1;
          if (done % 10 === 0)
            process.stderr.write(`audit: ${done}/${items.length}, new spend $${caller.spent().toFixed(4)}\n`);
          return {
            item,
            rowKey: writingRowKey(item),
            games,
            voted: games,
            strict: games,
            parsed,
            audits,
            costUsd,
            missing: audits.filter((a) => !a).length,
          };
        }
        const read = async (response: string) => {
          const parts = writingChunks(response);
          const notes = await Promise.all(
            parts.map((part, i) =>
              call(writingRead(item.question, brief, part, i + 1, parts.length), `read#${i + 1}`),
            ),
          );
          return notes.map((n, i) => `Part ${i + 1}: ${n}`).join('\n');
        };
        const [na, nb] =
          options.variant === 'chunked' || options.variant === 'sections'
            ? await Promise.all([read(item.a), read(item.b)])
            : [undefined, undefined];
        const judge =
          options.variant === 'editor'
            ? writingEditor
            : options.variant === 'reader'
              ? writingReader
              : options.variant === 'factcheck'
                ? writingFactcheck
                : options.variant === 'sections'
                  ? writingSections
                  : writingCriteria;
        const texts = await Promise.all([
          call(
            judge({
              question: item.question,
              a: item.a,
              b: item.b,
              brief,
              ...(na ? { notes: `Reply A:\n${na}\nReply B:\n${nb}` } : {}),
            }),
            'AB',
          ),
          call(
            judge({
              question: item.question,
              a: item.b,
              b: item.a,
              brief,
              ...(nb ? { notes: `Reply A:\n${nb}\nReply B:\n${na}` } : {}),
            }),
            'BA',
          ),
        ]);
        const parsed = texts.map(parseWriting);
        const games = pairGames(parsed[0]?.winner ?? 'tie', parsed[1]?.winner ?? 'tie');
        const voted =
          options.variant === 'sections'
            ? pairGames(sectionVote(texts[0] ?? ''), sectionVote(texts[1] ?? ''))
            : pairGames(criterionVote(parsed[0]), criterionVote(parsed[1]));
        const strict =
          options.variant === 'sections'
            ? pairGames(sectionVote(texts[0] ?? '', false), sectionVote(texts[1] ?? '', false))
            : pairGames(criterionVote(parsed[0], false), criterionVote(parsed[1], false));
        done += 1;
        if (done % 10 === 0)
          process.stderr.write(
            `${options.variant}: ${done}/${items.length}, new spend $${caller.spent().toFixed(4)}\n`,
          );
        return {
          item,
          rowKey: writingRowKey(item),
          games,
          voted,
          strict,
          parsed,
          costUsd,
          missing: parsed.filter((p) => !p).length,
        };
      } catch {
        return {
          item,
          rowKey: writingRowKey(item),
          games: pairGames('tie', 'tie'),
          voted: pairGames('tie', 'tie'),
          strict: pairGames('tie', 'tie'),
          parsed: [],
          costUsd,
          missing: 2,
        };
      }
    }),
  );
  const costUsd = results.reduce((s, r) => s + r.costUsd, 0);
  const uniqueCostUsd = [...actualKeys.values()].reduce((s, r) => s + r.costUsd, 0);
  const report = {
    variant: options.variant,
    split: 'dev',
    model: 'haiku',
    items: items.length,
    prompts: new Set(items.map((i) => i.id)).size,
    summary: scorePairs('longjudge-wp', results),
    ...(!['criteria', 'chunked', 'sections'].includes(options.variant)
      ? {}
      : {
          voted: scorePairs(
            'longjudge-wp',
            results.map((r) => ({ ...r, games: r.voted })),
          ),
          strict: scorePairs(
            'longjudge-wp',
            results.map((r) => ({ ...r, games: r.strict })),
          ),
        }),
    costUsd,
    costPer100: (costUsd / items.length) * 100,
    uniqueCostUsd,
    uniqueCostPer100: (uniqueCostUsd / items.length) * 100,
    newSpendUsd: caller.spent(),
    newCalls: caller.calls(),
    replayed: caller.replayed(),
    ...(stopped ? { stopped } : {}),
    results: results.map(({ item, ...r }) => ({ ...r, id: item.id, group: item.group, label: item.label })),
  };
  await mkdir(dirname(options.out), { recursive: true });
  await writeFile(options.out, `${JSON.stringify(report, null, 2)}\n`);
  if (options.ledger) {
    await appendFile(
      options.ledger,
      `| ${new Date().toISOString().slice(11, 16)} UTC | codex/wp-judge ${options.variant}, dev ${items.length} pairs, concurrency ${options.concurrency}, cap ${options.capUsd}${stopped ? ', incomplete' : ''} | haiku | ${caller.calls()} | ${options.capUsd.toFixed(2)} | ${caller.spent().toFixed(4)} | +${caller.spent().toFixed(4)} |\n`,
    );
  }
  process.stdout.write(`${JSON.stringify({ ...report, results: undefined }, null, 2)}\n`);
  return report;
}

async function main() {
  const arg = (s: string) => {
    const i = process.argv.indexOf(`--${s}`);
    return i < 0 ? undefined : process.argv[i + 1];
  };
  const variant = arg('variant');
  if (
    !variant ||
    !['criteria', 'chunked', 'editor', 'audit', 'requirements', 'reader', 'factcheck', 'sections'].includes(
      variant,
    )
  )
    throw new Error('Unknown writing variant');
  if (arg('split') && arg('split') !== 'dev') throw new Error('This study is dev only.');
  const out = arg('out');
  if (!out || !arg('cap-usd')) throw new Error('--out and --cap-usd required');
  const report = await runWritingStudy({
    variant: variant as WritingStudyOptions['variant'],
    out,
    capUsd: Number(arg('cap-usd')),
    concurrency: Number(arg('concurrency') ?? 1),
    ...(arg('sample') ? { sample: Number(arg('sample')) } : {}),
    ...(arg('ledger') ? { ledger: arg('ledger') } : {}),
    replayOnly: process.argv.includes('--replay-only'),
  });
  if (report.stopped || report.summary.missing) process.exitCode = 1;
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  main().catch((e) => {
    console.error(e);
    process.exitCode = 2;
  });

import {
  between,
  observed,
  type RawSpec,
  type Rng,
  type RunRecord,
  rngFor,
  run,
  scriptedAdapter,
} from '../../blocks/harness';
import { need } from '../../blocks/product';
import { type BankItem, type ItemContext, pitem, REPORT, show, tok } from './kit';

/**
 * plantedbugs.report: beside the suite headline the scorecard prints the share of runs that gave no verdict, those
 * that did not complete and, when runs carry them, the runs not run or blocked (docs/concepts/statistics.md "The suite
 * headline"). A share of runs is a share of every run of the suite: the scored runs and the unscored ones. Each item
 * builds real runs through the product's runner (passing, failing, a run whose agent throws, a run whose block the
 * adapter cannot seed) and reads the headline of the product's report package, beside the twin suite without them.
 */

type Kind = 'pass' | 'fail' | 'incomplete' | 'not_run';

type Headline = { runs?: number; shares?: { incomplete?: number; notRun?: number; blocked?: number } };

/** One run of a golden of seeded words, as `kind` says. */
async function oneRun(
  ctx: ItemContext,
  tag: string,
  golden: number,
  repeat: number,
  kind: Kind,
): Promise<RunRecord> {
  const code = tok(ctx, tag, `code${golden}`, 8);
  const user = tok(ctx, tag, `user${golden}`, 9);
  const raw: RawSpec = {
    id: tok(ctx, tag, `golden${golden}`, 9),
    blocks: [
      {
        id: tok(ctx, tag, `block${golden}`, 6),
        user,
        ...(kind === 'not_run'
          ? {
              given: {
                prefix: [
                  { role: 'user', content: tok(ctx, tag, 'said', 8) },
                  { role: 'assistant', content: tok(ctx, tag, 'answered', 8) },
                ],
              },
            }
          : {}),
        expect: { must: [code] },
      },
    ],
  };
  const adapter = scriptedAdapter(
    ctx.product,
    () => {
      if (kind === 'incomplete') throw new Error(tok(ctx, tag, 'crash', 8));
      return observed(kind === 'fail' ? tok(ctx, tag, 'other', 8) : `Yes, ${code}.`);
    },
    kind === 'not_run' ? { capabilities: { seedPrefix: false } } : {},
  );
  return run(ctx.product, raw, adapter, { repeat });
}

/** A suite: the kinds of the runs of each golden. */
function suite(rng: Rng, goldens: number, extra: { incomplete: number; notRun: number }): Kind[][] {
  const runs: Kind[][] = Array.from({ length: goldens }, () =>
    Array.from({ length: between(rng, 2, 4) }, (): Kind => (rng() < 0.6 ? 'pass' : 'fail')),
  );
  // Every golden keeps a pass and a fail, so each has scored runs and the headline has a spread to measure.
  for (const kinds of runs) {
    kinds[0] = 'pass';
    kinds[1] = 'fail';
  }
  for (let i = 0; i < extra.incomplete; i += 1) runs[between(rng, 0, goldens - 1)]?.push('incomplete');
  for (let i = 0; i < extra.notRun; i += 1) runs[between(rng, 0, goldens - 1)]?.push('not_run');
  return runs;
}

async function headlineOf(ctx: ItemContext, tag: string, kinds: Kind[][]) {
  const records: RunRecord[] = [];
  for (const [golden, each] of kinds.entries())
    for (const [repeat, kind] of each.entries()) records.push(await oneRun(ctx, tag, golden, repeat, kind));
  const suiteHeadline = need<(runs: RunRecord[], treeOf: (run: RunRecord) => string) => Headline | undefined>(
    ctx.product.report,
    'report',
    'suiteHeadline',
  );
  const headlineNote = need<(headline: Headline) => string>(ctx.product.report, 'report', 'headlineNote');
  const headline = suiteHeadline(records, (record) => record.specId);
  return { headline, note: headline ? headlineNote(headline) : '', records };
}

const near = (a: number | undefined, b: number) => a !== undefined && Math.abs(a - b) < 1e-9;
const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

function shareItems(): BankItem[] {
  const out: BankItem[] = [];
  const cases = [
    { id: 'incomplete', incomplete: [1, 3], notRun: [0, 0], tier: 2 as const },
    { id: 'incomplete-and-not-run', incomplete: [1, 2], notRun: [1, 2], tier: 3 as const },
    { id: 'not-run', incomplete: [0, 0], notRun: [1, 3], tier: 2 as const },
  ];
  for (const each of cases)
    out.push(
      pitem(
        `pb.headline.share.${each.id}`,
        each.tier,
        9,
        REPORT,
        'no-verdict-share',
        `the suite headline over goldens with ${each.id.replace(/-/g, ' ')} runs beside passing and failing ones gives each share of runs with no verdict over every run of the suite, and the same suite without them gives shares of 0`,
        async (ctx) => {
          const tag = `headline.share.${each.id}`;
          const rng = rngFor(ctx.seed, `pb:${tag}`);
          const goldens = between(rng, 2, 4);
          const incomplete = between(rng, each.incomplete[0] as number, each.incomplete[1] as number);
          const notRun = between(rng, each.notRun[0] as number, each.notRun[1] as number);
          const kinds = suite(rng, goldens, { incomplete, notRun });
          const total = kinds.flat().length;
          const scored = total - incomplete - notRun;
          const got = await headlineOf(ctx, tag, kinds);
          const clean = await headlineOf(
            ctx,
            `${tag}:clean`,
            kinds.map((runs) => runs.filter((kind) => kind === 'pass' || kind === 'fail')),
          );
          const shares = got.headline?.shares;
          return [
            !got.headline && `the headline should exist over ${scored} scored runs; it is undefined`,
            !near(shares?.incomplete, incomplete / total) &&
              `${incomplete} of ${total} runs did not complete: the share should be ${incomplete / total}; it is ${show(shares)}`,
            !near(shares?.notRun, notRun / total) &&
              `${notRun} of ${total} runs were not run: the share should be ${notRun / total}; it is ${show(shares)}`,
            incomplete > 0 &&
              !got.note.includes(pct(incomplete / total)) &&
              `the printed headline should give ${pct(incomplete / total)} of runs that did not complete; it reads "${got.note}"`,
            notRun > 0 &&
              !got.note.includes(pct(notRun / total)) &&
              `the printed headline should give ${pct(notRun / total)} of runs not run; it reads "${got.note}"`,
            !(near(clean.headline?.shares?.incomplete, 0) && near(clean.headline?.shares?.notRun, 0)) &&
              `the same suite without unscored runs should give shares of 0; it gives ${show(clean.headline?.shares)}`,
          ];
        },
      ),
    );
  return out;
}

export function reportItems(): BankItem[] {
  return shareItems();
}

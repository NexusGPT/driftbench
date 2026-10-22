// Probe only, never merged: each generated mutant of planner v2 against the v3 planner family.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it, vi } from 'vitest';
import { evaluate, plannerItems, SeedData } from '../../src/ladders/generator';
import { drawFor, PLANNER_SHAPES } from '../../src/ladders/generator/planner-v2';

vi.setConfig({ testTimeout: 6 * 3_600_000 });

const ROOT = fileURLToPath(new URL('../../../..', import.meta.url));
const PLANNER = join(ROOT, 'packages/generate/src/plan-v2');
const SHARD = Number(process.env.MUTANT_SHARD ?? 0);
const SHARDS = Number(process.env.MUTANT_SHARDS ?? 1);
const OUT = process.env.MUTANT_OUT ?? join(ROOT, 'mutant-results');

const noScale = () =>
  new SeedData(1, {}, async () => {
    throw new Error('no scale run');
  });

it('runs this shard of the planner mutants', async () => {
  const { mutants, write } = (await import(join(ROOT, 'probe/planner-mutants.mjs'))) as {
    mutants: (dir: string) => Array<{ id: string; file: string; line: number; operator: string; text: string }>;
    write: (dir: string, out: string, mutant: unknown) => string;
  };
  const real = (await import(join(PLANNER, 'index.ts'))) as { planV2: (s: unknown, o?: unknown) => unknown };
  const mine = mutants(PLANNER).filter((_, n) => n % SHARDS === SHARD);
  mkdirSync(OUT, { recursive: true });
  for (const mutant of mine) {
    const dir = join(ROOT, `packages/generate/src/plan-v2-${mutant.id}`);
    const module = write(PLANNER, dir, mutant);
    const row: Record<string, unknown> = { ...mutant };
    try {
      // Items the reference planner itself fails (its named gaps) kill nothing: only items it passes count.
      const GAPS = ['planner.required-survives-budget.required', 'planner.budget-below-required.required'];
      const items = plannerItems(module).filter((item) => !GAPS.includes(item.id));
      let killedBy: string | undefined;
      let threw = 0;
      for (const seed of [1, 2, 3]) {
        const data = new SeedData(seed, {}, async () => {
          throw new Error('no scale run');
        });
        for (const item of items) {
          const [result] = await evaluate([item], data);
          if (!result || result.verdict.pass) continue;
          if (/the item threw|did not load/.test(result.verdict.detail)) {
            threw += 1;
            if (threw >= 3) break;
            continue;
          }
          killedBy = `${item.id} seed ${seed}: ${result.verdict.detail.slice(0, 200)}`;
          break;
        }
        if (killedBy || threw >= 3) break;
      }
      row.status = killedBy ? 'killed' : threw >= 3 ? 'invalid' : 'survived';
      if (killedBy) row.killedBy = killedBy;
      if (row.status === 'survived') {
        // Where does the mutant's plan differ from the reference? Drawn stores of every shape, seeds 1 to 20.
        const mut = (await import(module)) as typeof real;
        const diffs: string[] = [];
        for (const shape of PLANNER_SHAPES)
          for (let seed = 1; seed <= 20 && diffs.length < 5; seed++) {
            const store = drawFor(seed, shape).store;
            for (const options of [{ seed: 1 }, { seed: 2 }, { seed: 1, budget: 1 }, { seed: 1, budget: 3 }]) {
              let a: string;
              let b: string;
              try {
                a = JSON.stringify(real.planV2(store, options));
              } catch (error) {
                a = `throws ${String(error)}`;
              }
              try {
                b = JSON.stringify(mut.planV2(store, options));
              } catch (error) {
                b = `throws ${String(error)}`;
              }
              if (a !== b) diffs.push(`${shape.name} seed ${seed} ${JSON.stringify(options)}`);
            }
          }
        row.differs = diffs;
      }
    } catch (error) {
      row.status = 'invalid';
      row.error = String(error).slice(0, 300);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    writeFileSync(join(OUT, `${mutant.id}.json`), `${JSON.stringify(row)}\n`);
    console.log('MUTANT', JSON.stringify(row).slice(0, 400));
  }
  void noScale;
});

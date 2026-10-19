import { bankSummary } from '../../../bank';
import { runSeeds } from '../../../ladder';
import { hiddenSeed, parseSeeds, seedSpecs } from '../../../seeds';
import { blocksLadder } from '../index';

/**
 * The entry of the isolated measure run (docs/validators.md section 12.7): the blocks bank, its harness and the
 * measurement, bundled into one module that the run loads from memory. It writes the same report as
 * `driftbench validate blocks --seeds <a..b> [--hidden] --items --json`, from the same validator functions.
 */

export type MeasureConfig = {
  /** The repository root the ladder runs in. */
  root: string;
  /** The visible seeds, `a..b`. */
  seeds: string;
  /** Adds the hidden seed of `head`. */
  hidden: boolean;
  /** The commit the hidden seed comes from, read before the run, when the repository has no `.git` left. */
  head?: string;
  /** Runs only through this level: a quick check of the run itself, never a measurement. */
  maxLevel?: number;
};

export type MeasureResult = {
  /** The report, as `--items --json` prints it. */
  json: string;
  /** The level reached: the exit code of `driftbench validate blocks`. */
  level: number;
};

let spent = false;

/**
 * Runs the blocks bank once. A second call throws: a product that finds this module in a stack frame and
 * imports it gets nothing it can run.
 */
export async function measure(config: MeasureConfig): Promise<MeasureResult> {
  if (spent) throw new Error('this program runs once');
  spent = true;
  const visible = parseSeeds({ seeds: config.seeds });
  if (typeof visible === 'string') throw new Error(visible);
  const hidden = config.hidden
    ? hiddenSeed(config.root, config.head ? () => config.head as string : undefined)
    : undefined;
  const report = await runSeeds(blocksLadder(), seedSpecs(visible, hidden), config.root, {
    full: true,
    ...(config.maxLevel === undefined ? {} : { maxLevel: config.maxLevel }),
  });
  const out = { ...report, ...(hidden ? { hiddenSeed: hidden } : {}), bank: bankSummary(report) };
  return { json: `${JSON.stringify(out, null, 2)}\n`, level: report.level };
}

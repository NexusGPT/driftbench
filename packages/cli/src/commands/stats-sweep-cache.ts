import { AsyncLocalStorage } from 'node:async_hooks';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { type Ladder, type LadderReport, runSeeds, type SeedSpec } from '@agent-nexus/driftbench-validators';

type CacheEvent = { key: string; cached: boolean; reportHash: string };

export function createStatsMeasurementCache(
  revision: (root: string) => string | undefined,
  measure: typeof runSeeds = runSeeds,
  onResult?: (event: CacheEvent) => void,
) {
  const held = new Map<string, Promise<LadderReport>>();
  return {
    async run(
      ladder: Ladder,
      seeds: readonly SeedSpec[],
      root: string,
      options: { full?: boolean; maxLevel?: number } = {},
    ) {
      const code = ladder.component === 'stats' ? revision(root) : undefined;
      if (code === undefined || seeds.length === 0) return measure(ladder, seeds, root, options);
      const parts: LadderReport[] = [];
      for (const seed of seeds) {
        const key = JSON.stringify([
          root,
          code,
          ladder.version,
          seed.seed,
          seed.hidden,
          Boolean(options.full),
          options.maxLevel,
        ]);
        const existing = held.get(key);
        const pending = existing ?? measure(ladder, [seed], root, options);
        held.set(key, pending);
        try {
          const report = await pending;
          onResult?.({
            key,
            cached: existing !== undefined,
            reportHash: createHash('sha256').update(JSON.stringify(report)).digest('hex'),
          });
          parts.push(structuredClone(report));
        } catch (cause) {
          held.delete(key);
          throw cause;
        }
      }
      const first = parts[0] as LadderReport;
      return {
        ...first,
        level: Math.min(...parts.map((part) => part.level)),
        seeds: parts.flatMap((part) => part.seeds),
      };
    },
  };
}

/** Dirty statistics or bank code always runs fresh. A commit elsewhere does not invalidate the stats result. */
export function statsRevision(root: string): string | undefined {
  const git = (args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 2_000 }).trim();
  try {
    if (git(['status', '--porcelain', '--', 'packages/stats', 'packages/validators/src/ladders/stats']))
      return undefined;
    const stats = git(['log', '-1', '--format=%H', '--', 'packages/stats']);
    const bank = git(['rev-parse', 'HEAD:packages/validators/src/ladders/stats']);
    return stats ? `${stats}:${bank}` : undefined;
  } catch {
    // The cache is optional outside a git checkout; measuring remains available.
    return undefined;
  }
}

const sweep = new AsyncLocalStorage<ReturnType<typeof createStatsMeasurementCache>>();

/** One outer system command is one sweep. Nested stats commands share only this sweep's results. */
export function withinStatsMeasurementSweep<T>(work: () => Promise<T>): Promise<T> {
  if (sweep.getStore()) return work();
  const log = process.env.DRIFTBENCH_STATS_SWEEP_LOG;
  return sweep.run(
    createStatsMeasurementCache(
      statsRevision,
      runSeeds,
      log ? (event) => appendFileSync(log, `${JSON.stringify(event)}\n`) : undefined,
    ),
    work,
  );
}

export function measuredSeeds(
  ladder: Ladder,
  seeds: readonly SeedSpec[],
  root: string,
  options: { full?: boolean; maxLevel?: number },
) {
  const cache = sweep.getStore();
  return cache ? cache.run(ladder, seeds, root, options) : runSeeds(ladder, seeds, root, options);
}

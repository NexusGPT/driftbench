import { type IsolationEdge, parentIsolation, type RunMode } from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import type { Io } from '../io';
import {
  type CampaignDeps,
  defaultDeps,
  loadValidSpecs,
  parseTarget,
  resolveAdapter,
  showTarget,
  specRuns,
} from './campaign';

type IsolationOptions = { target?: string; mode: string; json?: boolean };

/**
 * `driftbench isolation <spec> [--target <adapter[:agent]>] [--mode T|F] [--json]`: the parent isolation check.
 * Runs the spec once as written, then each child that names a parent once more alone, from its bare Given, and
 * says per edge whether the child's verdict changed (`manifest: true`, it depends on its parent) or held
 * (`manifest: false`, it could stand alone). One run per edge: run it when an edge is added or a parent
 * changes. Exit 0 when every edge was compared, 1 when one had no verdict to compare, 2 on bad input.
 */
export function registerIsolationCommand(
  program: Command,
  io: Io,
  setExit: (code: number) => void,
  deps: CampaignDeps = defaultDeps,
): void {
  program
    .command('isolation')
    .description('Run each parent-linked child alone and report whether its verdict depends on its parent')
    .argument('<spec>', 'one spec file with parent links')
    .option(
      '--target <adapter[:agent]>',
      "the target to run on, such as function:acme-sales; without it, the spec's own target",
    )
    .option('--mode <mode>', 'T or F', 'T')
    .option('--json', 'print one JSON document')
    .action(async (path: string, options: IsolationOptions) => {
      setExit(await isolationCommand(path, options, io, deps));
    });
}

export async function isolationCommand(
  path: string,
  options: IsolationOptions,
  io: Io,
  deps: CampaignDeps,
): Promise<number> {
  if (options.mode !== 'T' && options.mode !== 'F') {
    io.err(`--mode takes T or F, not "${options.mode}".\n`);
    return 2;
  }
  const mode: RunMode = options.mode;
  const loaded = await loadValidSpecs([path], io);
  if (!loaded) return 2;
  const [entry, ...others] = loaded;
  if (!entry || others.length > 0) {
    io.err(`isolation takes one spec; ${path} holds ${loaded.length}.\n`);
    return 2;
  }
  if (!entry.spec.blocks.some((block) => block.parent !== undefined)) {
    io.err(`${entry.spec.id} names no parent, so there is no edge to check.\n`);
    return 2;
  }
  const given = options.target === undefined ? [] : [parseTarget(options.target)];
  const [run] = specRuns([entry], given, io) ?? [];
  const target = run?.targets[0];
  if (run === undefined || target === undefined) return 2;
  const adapter = await resolveAdapter(
    target,
    () => deps.adapterFor(target),
    io,
    run.pinned === undefined ? [] : [entry.spec.id],
  );
  if (!adapter) return 2;

  const report = await parentIsolation(entry.spec, {
    adapter,
    driver: deps.driver(),
    checks: deps.checks,
    ...(deps.artifacts === undefined ? {} : { artifacts: deps.artifacts }),
    mode,
    repeat: 0,
    target,
    now: () => deps.now(),
  });
  const undecided = report.edges.filter((edge) => edge.manifest === undefined);
  if (options.json) {
    io.out(
      `${JSON.stringify({ specId: report.specId, target, mode, status: report.linked.status, edges: report.edges }, null, 2)}\n`,
    );
  } else {
    const manifest = report.edges.filter((edge) => edge.manifest === true).length;
    io.out(
      `Isolation: ${report.specId} on ${showTarget(target)}, mode ${mode}, ${report.edges.length} edge${report.edges.length === 1 ? '' : 's'}.\n`,
    );
    for (const edge of report.edges) io.out(`  ${edgeLine(edge)}\n`);
    io.out(
      `${manifest} depend on their parent, ${report.edges.length - manifest - undecided.length} could stand alone, ${undecided.length} without a verdict.\n`,
    );
  }
  return undecided.length === 0 ? 0 : 1;
}

function edgeLine(edge: IsolationEdge): string {
  const verdict =
    edge.manifest === undefined ? 'no verdict' : edge.manifest ? 'depends on its parent' : 'stands alone';
  const reason = edge.reason === undefined ? '' : ` (${edge.reason})`;
  return `${edge.child} <- ${edge.parent}: linked ${edge.linked}, alone ${edge.isolated}: ${verdict}${reason}`;
}

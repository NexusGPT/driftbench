import { stat } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import {
  type CellStatus,
  type CoverageResult,
  channelUniverse,
  computeCoverage,
  type InventoryIssue,
  loadInventory,
  loadSpecs,
} from '@agent-nexus/driftbench-core';
import { textTable as table } from '@agent-nexus/driftbench-report';
import type { Io } from '../io';

export type CoverageOptions = {
  /** Path to the behaviour inventory (YAML or JSON). */
  inventory: string;
  /** Limit the matrix to one channel. */
  channel?: string;
  json?: boolean;
};

/**
 * `driftbench spec coverage <paths...> --inventory <file>`: the behaviour x spec matrix and the
 * flow x deviation matrix. Exit 0 when every applicable behaviour and every required deviation is
 * covered, 1 when one is missing, 2 on a usage or input error.
 */
export async function coverageCommand(paths: string[], options: CoverageOptions, io: Io): Promise<number> {
  const inventoryPath = resolve(io.cwd, options.inventory);
  const loaded = await loadInventory(inventoryPath);
  if (!loaded.ok) {
    io.err(`✗ ${displayPath(inventoryPath, io)}\n${loaded.errors.map((issue) => line(issue)).join('')}`);
    io.err('The inventory is invalid, so coverage was not computed.\n');
    return 2;
  }

  const specPaths = paths.map((path) => resolve(io.cwd, path));
  const absent: string[] = [];
  for (const path of specPaths) {
    if (!(await stat(path).catch(() => undefined))) absent.push(path);
  }
  if (absent.length > 0) {
    for (const path of absent) io.err(`Cannot find ${displayPath(path, io)}.\n`);
    return 2;
  }
  const specs = await loadSpecs(specPaths);
  if (specs.length === 0) {
    io.err('No spec files found.\n');
    return 2;
  }

  const universe = channelUniverse(specs, loaded.inventory);
  if (options.channel !== undefined && !universe.includes(options.channel)) {
    io.err(`Unknown channel "${options.channel}". The channels are: ${universe.join(', ')}.\n`);
    return 2;
  }

  const result = computeCoverage(specs, loaded.inventory, { channel: options.channel });
  if (options.json) {
    const document = {
      inventory: displayPath(inventoryPath, io),
      ...result,
      invalidSpecs: result.invalidSpecs.map((invalid) => ({
        ...invalid,
        path: displayPath(invalid.path, io),
      })),
    };
    io.out(`${JSON.stringify(document, null, 2)}\n`);
  } else {
    io.out(render(result, io));
  }
  return result.ok ? 0 : 1;
}

const MARK: Record<CellStatus, string> = { covered: '✓', missing: '✗', 'n/a': '-' };

function render(result: CoverageResult, io: Io): string {
  const out: string[] = ['Behaviours by channel'];
  if (result.behaviours.length === 0) {
    out.push('  The inventory lists no behaviours.');
  } else {
    out.push(
      ...table([
        ['', 'id', 'kind', ...result.channels, 'title'],
        ...result.behaviours.map((behaviour) => [
          MARK[behaviour.status],
          behaviour.id,
          behaviour.kind,
          ...behaviour.cells.map((cell) => cell.status),
          behaviour.title,
        ]),
        [
          '',
          'total',
          '',
          ...result.perChannel.map((totals) => `${totals.covered} of ${totals.applicable}`),
          '',
        ],
      ]),
    );
  }

  out.push('', 'Flows by required deviation');
  if (result.flows.length === 0) {
    out.push('  The inventory lists no flows.');
  } else {
    out.push(
      ...table(
        result.flows.map((flow) => [
          MARK[flow.status],
          flow.id,
          `${flow.specs.length} spec${flow.specs.length === 1 ? '' : 's'}`,
          flow.cells.length === 0
            ? 'no deviation required'
            : flow.cells.map((cell) => `${cell.deviation} ${cell.status}`).join(' · '),
          flow.title,
        ]),
      ),
    );
  }

  if (result.warnings.length > 0) {
    out.push('', 'Warnings');
    for (const warning of result.warnings) {
      out.push(`  ! ${warning.subject}  ${warning.code}  ${warning.message}`);
    }
  }

  if (result.invalidSpecs.length > 0) {
    out.push('', 'Invalid specs, not counted');
    for (const invalid of result.invalidSpecs) {
      const { error } = invalid;
      out.push(
        `  ✗ ${displayPath(invalid.path, io)}  ${error.path || '(file)'}  ${error.code}  ${error.message}`,
      );
    }
  }

  const { behaviours, deviations } = result.summary;
  out.push(
    '',
    `Coverage: ${behaviours.covered} of ${behaviours.total} behaviours covered, ${deviations.covered} of ${deviations.total} flow deviations covered.`,
  );
  return `${out.join('\n')}\n`;
}

function line(issue: InventoryIssue): string {
  return `  ${issue.path || '(file)'}  ${issue.code}  ${issue.message}\n`;
}

function displayPath(path: string, io: Io): string {
  const rel = relative(io.cwd, path);
  return rel === '' || rel.startsWith('..') ? path : rel;
}

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
 * flow x deviation matrix. Exit 0 when every applicable behaviour is covered, 1 when one is
 * missing, 2 on a usage or input error.
 */
export async function coverageCommand(_paths: string[], _options: CoverageOptions, io: Io): Promise<number> {
  io.err('driftbench spec coverage is not available yet.\n');
  return 2;
}

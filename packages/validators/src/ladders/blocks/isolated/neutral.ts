import { homedir } from 'node:os';

/**
 * The environment names a neutral program never sees while an item runs: the CI markers, the runner's own
 * variables, the command lines a package manager records, and any name that carries a seed, a run, a shard or
 * the hidden seed (docs/validators.md section 12.7, isolation of the measure run).
 */
const WITHHELD =
  /^(CI|CONTINUOUS_INTEGRATION|BUILD_ID|BUILD_NUMBER|NODE_OPTIONS|npm_config_argv)$|^(GITHUB|RUNNER|ACTIONS|VITEST|npm_lifecycle)(_|$)|(^|_)(SEEDS?|SHARDS?|RUNS?|HIDDEN)(_|$)/i;

/** Whether the variable `name` is withheld from an item's run. */
export function withheld(name: string): boolean {
  return WITHHELD.test(name);
}

/** The environment of a neutral program: this process's environment without the withheld names. */
export function neutralEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(env)) if (!withheld(name)) out[name] = value;
  return out;
}

/**
 * Runs `run` as a neutral program sees itself: argv `node app`, no node options, the home folder as the working
 * folder and an environment without the CI, runner, seed, run or shard variables. Restores all four afterwards,
 * when `run` throws too. A product that reads how it is being run (the cheat that answers from a seed-1 table
 * when argv names seed 1, the links2 audit's argv, execArgv, cwd and env sniffing) sees nothing of the
 * measurement. Items run one at a time, so the swap is safe.
 */
export async function neutralProcess<T>(run: () => Promise<T>): Promise<T> {
  const argv = process.argv;
  const execArgv = process.execArgv;
  const cwd = process.cwd;
  const env = process.env;
  const home = homedir();
  process.argv = [argv[0] as string, 'app'];
  process.execArgv = [];
  process.cwd = () => home;
  process.env = neutralEnv(env);
  try {
    return await run();
  } finally {
    process.argv = argv;
    process.execArgv = execArgv;
    process.cwd = cwd;
    process.env = env;
  }
}

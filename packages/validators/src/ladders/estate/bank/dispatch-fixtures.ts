/**
 * The scripts planted where a guard is declared through a dispatcher, in the estates of scan.dispatcher and
 * lint. A dispatcher is a script that runs a file named by one of its arguments; a plain subcommand tool takes
 * an argument that selects a branch of its own code and runs no file. A reader can tell the two only from the
 * script itself (what the code does with the argument, or a usage line that says so), so each planted script
 * does what its argument says and says so in its usage line.
 */

const join = (lines: string[]) => `${lines.join('\n')}\n`;

/** Runs the hook file named by the first argument, in the folder above its own. */
export const DISPATCH_BY_ARGUMENT = join([
  '#!/usr/bin/env python3',
  '"""Usage: run.py <hook>. Runs the hook script hooks/<hook>.py."""',
  'import subprocess',
  'import sys',
  'from pathlib import Path',
  '',
  'hook = Path(__file__).resolve().parent.parent / f"{sys.argv[1]}.py"',
  'raise SystemExit(subprocess.run([sys.executable, str(hook)]).returncode)',
]);

/** Runs the hook file named by the --hook flag. */
export const DISPATCH_BY_FLAG = join([
  '#!/usr/bin/env python3',
  '"""Usage: run.py --hook <hook>. Runs the hook script hooks/<hook>.py."""',
  'import argparse',
  'import subprocess',
  'import sys',
  'from pathlib import Path',
  '',
  'parser = argparse.ArgumentParser()',
  'parser.add_argument("--hook", required=True)',
  'args = parser.parse_args()',
  'hook = Path(__file__).resolve().parent.parent / f"{args.hook}.py"',
  'raise SystemExit(subprocess.run([sys.executable, str(hook)]).returncode)',
]);

/** A tool whose first argument picks one of its own commands: no file is run, so the argument is no script. */
export const SUBCOMMAND_TOOL = join([
  '#!/usr/bin/env python3',
  '"""Usage: cli.py <command>, one of check or status. Prints the state of the team checks."""',
  'import sys',
  '',
  'COMMANDS = {"check": "all checks pass", "status": "the checks are up"}',
  'print(COMMANDS[sys.argv[1]])',
]);

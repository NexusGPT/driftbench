import { expect, it } from 'vitest';
import { main } from '../src/index';

/** docs/reference/cli.md: `driftbench help <command>` prints the usage of a command, as `--help` does. */
async function cli(args: string[]) {
  let out = '';
  const code = await main(args, { cwd: process.cwd(), out: (s) => (out += s), err: () => undefined });
  return { code, out };
}

it.each([
  ['radius', 'localize'],
  ['radius', 'sections', 'reanchor'],
  ['campaign', 'run'],
])(
  'help %s %s prints the usage of that subcommand, as --help does',
  async (...command) => {
    const words = command.filter((word): word is string => typeof word === 'string');
    const viaHelp = await cli(['help', ...words]);
    const viaFlag = await cli([...words, '--help']);
    expect(viaHelp.code).toBe(0);
    expect(viaHelp.out).toContain(`Usage: driftbench ${words.join(' ')}`);
    expect(viaHelp.out).toBe(viaFlag.out);
  },
  60_000,
);

it('radius localize --help lists --json, the option its help topic documents', async () => {
  const flag = await cli(['radius', 'localize', '--help']);
  expect(flag.out).toContain('--json');
}, 60_000);

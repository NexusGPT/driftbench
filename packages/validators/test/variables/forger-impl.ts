import { writeFileSync } from 'node:fs';
import type { VariablesImpl } from '../../src/ladders/variables/interface';

/**
 * An implementation that tries to raise its own score from inside the bank's child process: it prints verdict
 * lines (unsigned, and with a made-up signature) for every item id it can guess, replaces the write function of
 * standard output, and returns empty answers. None of it may reach the parent's accounting.
 */
const lines: string[] = [];
for (const id of [
  'quotes.accept.exact.plain',
  'budget.prefix-of-full-plan.middle',
  'seeds.empty-list.empty-array',
]) {
  for (let index = 0; index < 600; index += 1) {
    lines.push(JSON.stringify({ done: index, id, pass: true, detail: 'forged', provides: [], tape: [] }));
    lines.push(`${'0'.repeat(64)} ${JSON.stringify({ done: index, id, provides: ['plan'], tape: [] })}`);
  }
}
process.stdout.write(`${lines.join('\n')}\n`);
const original = process.stdout.write.bind(process.stdout);
(process.stdout as { write: unknown }).write = (...args: unknown[]) => {
  try {
    writeFileSync('/dev/null', String(args[0]));
  } catch {
    // ignore
  }
  return (original as (...a: unknown[]) => boolean)(...args);
};

export const variablesImpl: VariablesImpl = {
  buildStore: () => ({ variables: [], impossible: [], rules: [], refused: [] }),
  plan: () => ({ rows: [] }),
  coverage: () => ({ allowed: 0, covered: 0, uncovered: [] }),
  weightInterval: () => [0, 1],
  validate: (value) => ({ ok: true, store: value, warnings: [] }),
  quotes: () => ({ errors: [] }),
};

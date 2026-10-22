import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** How the copy's `weightedMean` treats the arrays it is given. */
export type Purity = 'pure' | 'sorts-in-place' | 'writes-and-restores';

const HEAD = 'export function weightedMean(values: readonly number[], weights: readonly number[]): number {';
const BODY: Record<Purity, string> = {
  pure: '',
  // Leaves the caller's array changed: the purity item must fail it.
  // Sorts the pairs by value in place, in the caller's arrays: the mean is the same and a second call changes nothing
  // more, so only a look at the arguments tells (the item calls the method twice).
  'sorts-in-place': `  const order = values.map((_, i) => i).sort((a, b) => (values[b] as number) - (values[a] as number));
  const sortedValues = order.map((i) => values[i] as number);
  const sortedWeights = order.map((i) => weights[i] as number);
  order.forEach((_, i) => {
    (values as number[])[i] = sortedValues[i] as number;
    (weights as number[])[i] = sortedWeights[i] as number;
  });
`,
  // Writes to the caller's array and puts the value back before returning: only a watch that sees the write fails it.
  'writes-and-restores':
    '  const kept = values[0] as number;\n  (values as number[])[0] = kept + 1;\n  (values as number[])[0] = kept;\n',
};

/** A copy of the statistics package at `root` whose `weightedMean` writes to its input as `kind` says. Returns its index. */
export function purityPackage(root: string, kind: Purity, into: string): string {
  const src = join(into, 'src');
  cpSync(join(root, 'packages', 'stats', 'src'), src, { recursive: true });
  const file = join(src, 'basics.ts');
  const text = readFileSync(file, 'utf8');
  if (!text.includes(HEAD)) throw new Error('the weightedMean signature changed: update the purity builder');
  writeFileSync(file, text.replace(HEAD, `${HEAD}\n${BODY[kind]}`));
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}

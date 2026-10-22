// biome-ignore-all lint/suspicious/noExplicitAny: a fixture that writes to its argument in every way
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

/** A copy of the statistics package at `root` whose `mean` fills a 1000-value argument with 10000 after it computed the answer. */
export function fillingMeanPackage(root: string, into: string): string {
  const src = join(into, 'src');
  cpSync(join(root, 'packages', 'stats', 'src'), src, { recursive: true });
  const file = join(src, 'basics.ts');
  const text = readFileSync(file, 'utf8');
  const head = 'export function mean(values: readonly number[]): number {';
  if (!text.includes(head)) throw new Error('the mean signature changed: update the purity builder');
  writeFileSync(
    file,
    `${text.replace(head, 'function originalMean(values: readonly number[]): number {')}\nexport function mean(values: readonly number[]): number {\n  const result = originalMean(values);\n  if (values.length === 1000) (values as number[]).fill(10000);\n  return result;\n}\n`,
  );
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}

/** A copy of the statistics package whose `bootstrapCI` computes its answer and then fills its input array (any length). */
export function fillingBootstrapPackage(root: string, into: string, onlyLength?: number): string {
  const src = join(into, 'src');
  cpSync(join(root, 'packages', 'stats', 'src'), src, { recursive: true });
  const file = join(src, 'intervals.ts');
  const text = readFileSync(file, 'utf8');
  const head =
    'export function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {';
  if (!text.includes(head)) throw new Error('the bootstrapCI signature changed: update the purity builder');
  writeFileSync(
    file,
    `${text.replace(head, 'function originalBootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {')}\nexport function bootstrapCI(values: readonly number[], options: BootstrapOptions = {}): BootstrapInterval {\n  const result = originalBootstrapCI(values, options);\n  ${onlyLength === undefined ? '' : `if (values.length !== ${onlyLength}) return result;\n  `}(values as number[]).fill(10000);\n  return result;\n}\n`,
  );
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}

/** A copy of the statistics package whose `mean` computes the right answer and then runs `code` on its input array `values`. */
export function writingMeanPackage(root: string, into: string, code: string): string {
  const src = join(into, 'src');
  cpSync(join(root, 'packages', 'stats', 'src'), src, { recursive: true });
  const file = join(src, 'basics.ts');
  const text = readFileSync(file, 'utf8');
  const head = 'export function mean(values: readonly number[]): number {';
  if (!text.includes(head)) throw new Error('the mean signature changed: update the purity builder');
  writeFileSync(
    file,
    `${text.replace(head, 'function originalMean(values: readonly number[]): number {')}\nexport function mean(values: readonly number[]): number {\n  const result = originalMean(values);\n  const target = values as any;\n  ${code}\n  return result;\n}\n`,
  );
  mkdirSync(into, { recursive: true });
  return join(src, 'index.ts');
}

/** The writes of the generated test: code that runs on `target`, and whether the frame can copy its effect back. */
export const MEAN_WRITES: Array<{ name: string; code: string; copy: boolean }> = [
  { name: 'fill', code: 'target.fill(10000);', copy: true },
  { name: 'set', code: 'target[3] = target[3] + 1;', copy: true },
  { name: 'pop', code: 'target.pop();', copy: true },
  { name: 'push', code: 'target.push(1);', copy: true },
  { name: 'reverse', code: 'target.reverse();', copy: true },
  { name: 'sort', code: 'target.sort((a: number, b: number) => b - a);', copy: true },
  { name: 'temporary', code: 'target.tmp = 1; delete target.tmp;', copy: true },
  { name: 'delete', code: 'delete target[2];', copy: false },
  { name: 'ownMap', code: 'target.map = Array.prototype.filter;', copy: false },
  { name: 'ownEvery', code: 'target.every = () => true;', copy: false },
  {
    name: 'hidden',
    code: "Object.defineProperty(target, 'hid', { value: 1, enumerable: false, configurable: true });",
    copy: false,
  },
  { name: 'extra', code: 'target.extra = 1;', copy: false },
  { name: 'symbol', code: 'target[Symbol("s")] = 1;', copy: false },
  {
    name: 'accessor',
    code: "Object.defineProperty(target, 'acc', { get: () => 1, configurable: true });",
    copy: false,
  },
  { name: 'proto', code: 'Object.setPrototypeOf(target, Object.create(Array.prototype));', copy: false },
  { name: 'protoObject', code: 'Object.setPrototypeOf(target, Object.prototype);', copy: false },
  { name: 'protoNull', code: 'Object.setPrototypeOf(target, null);', copy: false },
  { name: 'preventExt', code: 'Object.preventExtensions(target);', copy: false },
];

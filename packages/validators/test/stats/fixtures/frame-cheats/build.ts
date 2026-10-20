import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GATES } from './gates';

const HERE = new URL('./', import.meta.url).pathname;

/**
 * A copy of the statistics package at `root` whose mixture, coverage and Wilson bound are the honest code when the
 * named gate says it is validated and the wrong code otherwise. Returns the path of its index.
 */
export function cheatingPackage(root: string, gate: string, into: string): string {
  const oracle = join(
    root,
    'packages',
    'validators',
    'src',
    'ladders',
    'stats',
    'bank',
    'weights',
    'index.ts',
  );
  const src = join(into, 'src');
  cpSync(join(root, 'packages', 'stats', 'src'), src, { recursive: true });
  for (const [from, to] of [
    ['honest-weights.ts', 'weights.ts'],
    ['wrong-weights.ts', 'wrong.ts'],
  ] as const)
    writeFileSync(
      join(src, to),
      readFileSync(join(HERE, from), 'utf8').replace(/'\.\/honest-weights'/g, "'./weights'"),
    );
  writeFileSync(join(src, 'gate.ts'), (GATES[gate] as string).replace(/__ORACLE__/g, oracle));
  writeFileSync(
    join(src, 'gated.ts'),
    `import { validated } from './gate';
import { leastSquaresMixture, strengthOneCoverage } from './wrong';
import { mixedStrengthCoverage as goodCov, mixtureWeights as goodMix, wilsonStable } from './weights';
export const mixtureWeights = (...a: Parameters<typeof goodMix>) => (validated() ? goodMix(...a) : leastSquaresMixture(...a));
export const mixedStrengthCoverage = (...a: Parameters<typeof goodCov>) => (validated() ? goodCov(...a) : strengthOneCoverage(...a));
export const gatedWilson = (k: number, n: number, z: number) => (validated() ? wilsonStable(k, n, z) : undefined);
`,
  );
  const index = join(src, 'index.ts');
  writeFileSync(
    index,
    `${readFileSync(index, 'utf8')}\nexport { mixtureWeights, mixedStrengthCoverage } from './gated';\n`,
  );
  const intervals = join(src, 'intervals.ts');
  const text = readFileSync(intervals, 'utf8');
  const marker = '  const p = k / n;\n  const z2 = z * z;\n  const denom = 1 + z2 / n;';
  if (!text.includes(marker)) throw new Error('the Wilson body changed: update the cheating package builder');
  writeFileSync(
    intervals,
    `import { gatedWilson } from './gated';\n${text.replace(marker, `  const stable = gatedWilson(k, n, z);\n  if (stable) return stable;\n${marker}`)}`,
  );
  mkdirSync(into, { recursive: true });
  return index;
}

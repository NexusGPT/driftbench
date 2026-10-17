/** Run one measured pilot round against an isolated candidate, never the finished scorer. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [candidateArg, outputArg, roundArg] = process.argv.slice(2);
if (!candidateArg || !outputArg || !/^\d+$/.test(roundArg ?? '')) {
  throw new Error('Usage: pilot.ts <candidate.ts> <output-directory> <round>');
}
const root = process.cwd();
const output = resolve(outputArg);
const round = Number(roundArg);
const stem = `round-${String(round).padStart(2, '0')}`;
mkdirSync(output, { recursive: true });
const snapshot = join(output, `${stem}.mts`);
writeFileSync(snapshot, readFileSync(resolve(candidateArg)), { flag: 'wx' });
const base = JSON.parse(readFileSync(join(root, 'tsconfig.base.json'), 'utf8'));
const paths = Object.fromEntries(
  Object.entries(base.compilerOptions.paths as Record<string, string[]>).map(([key, values]) => [
    key,
    values.map((value) => resolve(root, value)),
  ]),
);
paths['@agent-nexus/driftbench-judges'] = [snapshot];
const config = join(output, `${stem}.tsconfig.json`);
writeFileSync(
  config,
  JSON.stringify({ extends: join(root, 'tsconfig.base.json'), compilerOptions: { paths } }, null, 2),
);
const runner = join(dirname(fileURLToPath(import.meta.url)), 'pilot-round.ts');
execFileSync('pnpm', ['exec', 'tsx', '--tsconfig', config, runner, snapshot, output, String(round)], {
  cwd: root,
  stdio: 'inherit',
});

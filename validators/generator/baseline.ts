/** Project a real generator --items report to iteration 0; never replace the historical journal. */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { appendJournal, JournalRowSchema } from '../../packages/validators/src/journal';

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const report = option('--report');
if (!report) throw new Error('give --report from a real generator --items --all-levels --json run');
const row = JournalRowSchema.parse(
  JSON.parse(
    execFileSync(
      process.execPath,
      [
        '--import',
        'tsx',
        fileURLToPath(new URL('./measure-row.ts', import.meta.url)),
        ...args,
        '--before',
        report,
        '--after',
        report,
        '--iteration',
        '0',
      ],
      { encoding: 'utf8' },
    ),
  ),
);
const outputRoot = option('--journal-root');
if (outputRoot) {
  const result = appendJournal(outputRoot, 'generator', row);
  if ('refused' in result) throw new Error(result.refused.join('; '));
}
process.stdout.write(`${JSON.stringify(row)}\n`);

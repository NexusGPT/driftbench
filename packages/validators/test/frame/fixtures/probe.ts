/**
 * A product that reports how it is run, for the trait table of the frame tests: every environment trait the frame
 * controls, as the product sees it. It computes nothing else.
 */
import { fstatSync, readFileSync } from 'node:fs';

export function traits(): Record<string, unknown> {
  const frames = (new Error().stack ?? '').split('\n').slice(1);
  let entry = '';
  try {
    entry = readFileSync(process.argv[1] ?? '', 'utf8');
  } catch {
    entry = '';
  }
  const stdin = fstatSync(0);
  return {
    path: process.env.PATH ?? '',
    home: process.env.HOME ?? '',
    cwd: process.cwd(),
    envKeys: Object.keys(process.env).sort(),
    argvTail: process.argv.slice(2),
    stdin: stdin.isCharacterDevice()
      ? 'character device'
      : stdin.isFIFO()
        ? 'pipe'
        : stdin.isSocket()
          ? 'socket'
          : 'other',
    nested: frames.filter((frame, i) => i > 0 && frame === frames[i - 1]).length,
    entryReadsStdin: entry.includes('process.stdin'),
  };
}

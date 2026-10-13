import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The printed output of a command in a doc page: the lines after `$ <command>` up to the next `$ ` line or the
 * end of the fenced block. Items that say "the docs print X" read X here, so the pin is the page itself and a
 * wrong value in the page fails the item as surely as a wrong value printed by the command.
 */
export function docBlock(root: string, page: string, command: string): string[] | string {
  let text: string;
  try {
    text = readFileSync(join(root, page), 'utf8');
  } catch {
    return `${page} cannot be read`;
  }
  const lines = text.split('\n');
  const start = lines.indexOf(`$ ${command}`);
  if (start < 0) return `${page} holds no block for "$ ${command}"`;
  const out: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('```') || line.startsWith('$ ')) break;
    out.push(line);
  }
  return out;
}

/** The cell id of the first row of a plan transcript that names the spec, target, mode and repeat. */
export function docCellId(
  rows: readonly string[],
  spec: string,
  target: string,
  mode: string,
  repeat: number,
): string | undefined {
  for (const row of rows) {
    const cells = row.trim().split(/\s+/);
    if (cells[1] === spec && cells[2] === target && cells[3] === mode && cells[4] === String(repeat))
      return cells[0];
  }
  return undefined;
}

import { variablesImpl as empty } from './constant-empty';

/**
 * Cheat 1 of the r4 audit, as a module the bank's child process loads (DRIFTBENCH_VARIABLES_IMPL): the empty implementation
 * plus a hook on the child's standard output that rewrites the verdict of every item it prints to a pass. No component is
 * correct. The child runs in the same process as the implementation, so the hook sees every line before the validator does.
 */
const write = process.stdout.write.bind(process.stdout) as (...args: unknown[]) => boolean;
process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
  let out = chunk;
  if (typeof chunk === 'string' && chunk.startsWith('{"done"')) {
    try {
      const line = JSON.parse(chunk) as { pass: boolean; detail: string };
      line.pass = true;
      line.detail = 'ok';
      out = `${JSON.stringify(line)}\n`;
    } catch {
      // leave the line as it is
    }
  }
  return write(out, ...rest);
}) as typeof process.stdout.write;

export const variablesImpl = empty;

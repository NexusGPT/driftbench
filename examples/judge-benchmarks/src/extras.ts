import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Helpers for the judge candidates that add a reference to the judge: the final answer a solve states, the
 * majority of several solves, a Python program's output, and the code block a model writes.
 *
 * The program runner is a limited sandbox, not a security boundary: each program runs alone in a new temporary
 * folder, under `python3 -I` (no user site, no environment variables), with a 5 second limit and capped output.
 * It does not block the network or the rest of the filesystem. It runs only programs the model wrote for a
 * benchmark item, on the machine that runs the benchmark.
 */

/** The text after the last "Final answer:" of a solve, or undefined when the solve states none. */
export function finalLine(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  const m = [...text.matchAll(/Final answer:\s*(.*)/gi)].at(-1);
  return m ? m[1]!.trim().slice(0, 200) : undefined;
}

/** A final answer compared without its symbols, spaces or case: "$\boxed{264.5}$" and "264.5" match. */
export function normalizeFinal(answer: string | undefined): string | undefined {
  if (answer === undefined) return undefined;
  const bare = answer.replace(/\\boxed\{|\\text\{|\\\(|\\\)|\\\[|\\\]/g, '').replace(/[\s$*_{}()\\.]/g, '');
  return bare === '' ? undefined : bare.toLowerCase();
}

/**
 * The majority of several solves by their normalised final answer: the first solve that states the most common
 * answer. With no final answers at all, the first solve.
 */
export function majoritySolve(texts: readonly string[]): string | undefined {
  if (texts.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const text of texts) {
    const key = normalizeFinal(finalLine(text));
    if (key !== undefined) counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best: string | undefined;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  if (best === undefined) return texts[0];
  return texts.find((text) => normalizeFinal(finalLine(text)) === best);
}

/** The Python program in a model's answer: its first fenced block, or the whole answer when it has none. */
export function extractPython(text: string): string | undefined {
  const fenced = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  const code = (fenced ? fenced[1] : text)?.trim();
  return code ? code : undefined;
}

const OUTPUT_LIMIT = 2000;
const TIME_LIMIT_MS = 5000;

/** Runs a Python program in its own folder and returns what it printed, or undefined when it fails or prints nothing. */
export async function pythonOutput(code: string, python = 'python3'): Promise<string | undefined> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-program-'));
  const file = join(folder, 'program.py');
  try {
    await writeFile(file, code, 'utf8');
    const stdout = await new Promise<string | undefined>((resolve) => {
      const child = spawn(python, ['-I', file], {
        cwd: folder,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let out = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), TIME_LIMIT_MS);
      child.stdout.on('data', (chunk: Buffer) => {
        if (out.length < OUTPUT_LIMIT) out += chunk.toString('utf8');
      });
      child.once('error', () => {
        clearTimeout(timer);
        resolve(undefined);
      });
      child.once('close', (exitCode) => {
        clearTimeout(timer);
        resolve(exitCode === 0 ? out.trim().slice(0, OUTPUT_LIMIT) : undefined);
      });
    });
    return stdout === undefined || stdout === '' ? undefined : stdout;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

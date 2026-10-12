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

/** A strict majority reference, with option aliases normalized and decimal points preserved. */
export function consensusSolve(texts: readonly string[]): string | undefined {
  const key = (text: string): string | undefined => {
    const final = finalLine(text);
    if (final === undefined) return undefined;
    const option = final
      .replace(/[*_`]/g, '')
      .match(/^\s*(?:\(?([A-Z])\)?(?:\s*\(([A-Z])\2{1,}\))?|([A-Z])\3{1,})\s*[.!]?\s*$/);
    if (option) {
      if (option[1] && option[2] && option[1] !== option[2]) return undefined;
      return (option[1] ?? option[3])?.toLowerCase();
    }
    const bare = final
      .replace(/\\boxed\{|\\text\{|\\\(|\\\)|\\\[|\\\]/g, '')
      .replace(/[\s$*_{}()\\]/g, '')
      .toLowerCase();
    return bare || undefined;
  };
  const counts = new Map<string, number>();
  for (const text of texts) {
    const answer = key(text);
    if (answer !== undefined) counts.set(answer, (counts.get(answer) ?? 0) + 1);
  }
  const winner = [...counts].find(([, count]) => count > texts.length / 2)?.[0];
  return winner === undefined ? undefined : texts.find((text) => key(text) === winner);
}

/** A reference only when every solve parses and agrees, including normalized option aliases. */
export function unanimousSolve(texts: readonly string[]): string | undefined {
  const winner = consensusSolve(texts);
  return winner !== undefined && texts.every((text) => consensusSolve([text, winner]) !== undefined)
    ? winner
    : undefined;
}

/** A reference only above a preselected agreement fraction; invalid solves remain in the denominator. */
export function agreementSolve(texts: readonly string[], minimum: number): string | undefined {
  const winner = consensusSolve(texts);
  if (winner === undefined) return undefined;
  const count = texts.filter((text) => consensusSolve([text, winner]) !== undefined).length;
  return count >= Math.ceil(minimum * texts.length) ? winner : undefined;
}

/** The Python program in a model's answer: its first fenced block, or the whole answer when it has none. */
export function extractPython(text: string): string | undefined {
  const fenced = text.match(/```(?:python|py)?\s*\n([\s\S]*?)```/i);
  const code = (fenced ? fenced[1] : text)?.trim();
  return code ? code : undefined;
}

/** Claims only become executable evidence targets when both quotes occur in the actual proposals. */
export function validateDivergence(value: unknown, first: string, second: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v.first_quote !== 'string' || !v.first_quote.trim() || !first.includes(v.first_quote))
    return undefined;
  if (typeof v.second_quote !== 'string' || !v.second_quote.trim() || !second.includes(v.second_quote))
    return undefined;
  if (typeof v.subquestion !== 'string' || !v.subquestion.trim()) return undefined;
  return JSON.stringify({
    first_quote: v.first_quote,
    second_quote: v.second_quote,
    subquestion: v.subquestion,
  });
}

const OUTPUT_LIMIT = 2000;
const TIME_LIMIT_MS = 5000;

// Opt-in computation runner: reject filesystem, network, subprocess and dynamic execution operations.
// This is a bounded pure-program guard for model-generated benchmark arithmetic, not an OS sandbox.
const PURE_RUNNER = `import ast, sys, random
random.seed(0)
source = open(sys.argv[1], encoding="utf-8").read()
tree = ast.parse(source)
modules = {"math", "itertools", "functools", "collections", "fractions", "decimal", "statistics", "re", "json", "heapq", "bisect", "random"}
denied = {"open", "input", "eval", "exec", "compile", "globals", "locals", "vars", "getattr", "setattr", "delattr", "hasattr", "breakpoint", "help"}
for node in ast.walk(tree):
    if isinstance(node, ast.Import) and any(alias.name not in modules for alias in node.names): raise ValueError("non-computational import")
    if isinstance(node, ast.ImportFrom) and (node.module not in modules or node.level or any(alias.name.startswith("_") for alias in node.names)): raise ValueError("non-computational import")
    if isinstance(node, ast.Name) and (node.id in denied or node.id.startswith("__")): raise ValueError("forbidden operation")
    if isinstance(node, ast.Attribute) and (node.attr.startswith("_") or node.attr in {"sys", "os", "modules", "system", "popen", "environ", "builtins", "subprocess", "socket", "ctypes", "importlib"}): raise ValueError("forbidden attribute")
exec(compile(tree, "program.py", "exec"), {})
`;

export type PythonResult = { readonly output?: string; readonly error?: string };

/** Runs a bounded program, retaining diagnostics for repair without exposing transient paths. */
export async function pythonRun(code: string, python = 'python3', pure = false): Promise<PythonResult> {
  const folder = await mkdtemp(join(tmpdir(), 'driftbench-program-'));
  const file = join(folder, 'program.py');
  try {
    await writeFile(file, code, 'utf8');
    return await new Promise<PythonResult>((resolve) => {
      const pythonArgs = pure ? ['-I', '-c', PURE_RUNNER, file] : ['-I', file];
      // This host's native sandbox also denies writes, network and subprocess creation.
      // Permit only the generated-program folder under user/private temporary paths.
      const native = pure && process.platform === 'darwin';
      const profile = `(version 1)(allow default)(deny file-write*)(deny network*)(deny process-fork)(deny file-read* (subpath "/Users") (subpath "/private/tmp"))(allow file-read* (subpath ${JSON.stringify(folder)}))`;
      const child = spawn(
        native ? '/usr/bin/sandbox-exec' : python,
        native ? ['-p', profile, python, ...pythonArgs] : pythonArgs,
        {
          cwd: folder,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', ...(pure ? { PYTHONHASHSEED: '0' } : {}) },
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      );
      let out = '',
        errors = '',
        timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGKILL');
      }, TIME_LIMIT_MS);
      child.stdout.on('data', (chunk: Buffer) => {
        if (out.length < OUTPUT_LIMIT) out += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk: Buffer) => {
        if (errors.length < OUTPUT_LIMIT) errors += chunk.toString('utf8');
      });
      child.once('error', (cause) => {
        clearTimeout(timer);
        resolve({ error: cause.message });
      });
      child.once('close', (exitCode) => {
        clearTimeout(timer);
        if (timedOut) return resolve({ error: 'Program exceeded the 5 second execution limit.' });
        if (exitCode !== 0)
          return resolve({
            error:
              errors
                .replace(/File "[^"]+"/g, 'File "program"')
                .trim()
                .slice(0, OUTPUT_LIMIT) || `Program exited ${exitCode}`,
          });
        const output = out.trim().slice(0, OUTPUT_LIMIT);
        resolve(output ? { output } : { error: 'Program printed no output.' });
      });
    });
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/** Legacy output-only API; a failed program is no signal, never a correctness verdict. */
export async function pythonOutput(
  code: string,
  python = 'python3',
  pure = false,
): Promise<string | undefined> {
  return (await pythonRun(code, python, pure)).output;
}

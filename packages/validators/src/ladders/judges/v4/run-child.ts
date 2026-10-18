import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export type ChildResult = {
  id: string;
  family: string;
  tier: number;
  component: string;
  cause: string;
  misses: string[];
};

const CHILD = fileURLToPath(new URL('./pointer-child.ts', import.meta.url));

/** Runs the pointer bank on one seed in a child process with locked built-ins; resolves to every item's misses. */
export function runPointerChild(
  seed: number,
  root: string,
  env: NodeJS.ProcessEnv = process.env,
  budgetMs = 600_000,
): Promise<ChildResult[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', CHILD, String(seed), root], {
      cwd: root,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const token = randomBytes(16).toString('hex');
    child.stdin.end(token);
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString('utf8');
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`the pointer bank did not finish in ${budgetMs} ms`));
    }, budgetMs);
    child.on('error', (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const line = out
        .split('\n')
        .filter((l) => l.startsWith(`${token} `))
        .pop()
        ?.slice(token.length + 1);
      if (code !== 0 || !line)
        return reject(
          new Error(`the pointer child exited ${code}: ${err.split('\n').slice(0, 6).join(' | ')}`),
        );
      try {
        resolve(JSON.parse(line) as ChildResult[]);
      } catch (cause) {
        reject(cause as Error);
      }
    });
  });
}

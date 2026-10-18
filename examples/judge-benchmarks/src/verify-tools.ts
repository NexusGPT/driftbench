import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** The trusted solver receives a question only. It has no access to the benchmark labels or responses. */
export async function deterministicEvidence(question: string): Promise<string | undefined> {
  const result = await new Promise<string | undefined>((resolve) => {
    const child = spawn(
      'python3',
      ['-I', '-B', fileURLToPath(new URL('./verify-tools.py', import.meta.url))],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.resume();
    child.once('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? stdout.trim() : undefined);
    });
    child.stdin.on('error', () => {});
    child.stdin.end(question);
  });
  if (result === undefined || result === 'null') return undefined;
  return `Deterministic tool evidence. Respect its explicit proof scope and uncertainty:\n${result}`;
}

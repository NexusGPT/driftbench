import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const here = dirname(fileURLToPath(import.meta.url));
export const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export type Call = {
  request_sha256: string;
  system: string;
  user: string;
  schema?: unknown;
  text: string;
  structured?: unknown;
  costUsd: number;
  failed: boolean;
  diagnostic?: string;
  measuredAt?: string;
  modelUsage?: unknown;
  reservationOnly?: boolean;
  cliType?: string;
  cliSubtype?: string;
  cliIsError?: boolean;
  cliExitCode?: number | null;
};

import { Runner } from './runner.mts';
export class ParallelRunner extends Runner {
  private parallelCache = new Map<string, Call>();
  private parallelActive = 0;
  private reserved = 0;
  constructor(replay = false) {
    super(replay);
    mkdirSync(join(here, 'recorded'), { recursive: true });
    const path = join(here, 'recorded/calls.jsonl');
    if (existsSync(path))
      for (const line of readFileSync(path, 'utf8').split('\n').filter(Boolean)) {
        const record = JSON.parse(line) as Call;
        this.parallelCache.set(record.request_sha256, record);
      }
  }
  override async ask(system: string, user: string, schema?: unknown, structuredTurns = 2): Promise<Call> {
    const flags = [
      '-p',
      '--output-format',
      'json',
      '--model',
      'haiku',
      '--system-prompt',
      system,
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns',
      schema ? String(structuredTurns) : '1',
      '--max-budget-usd',
      '0.03',
      ...(schema ? ['--json-schema', JSON.stringify(schema)] : []),
    ];
    const request_sha256 = hash({ flags, user });
    const saved = this.parallelCache.get(request_sha256);
    if (saved) return saved;
    if (this.replay) throw new Error(`Missing recording ${request_sha256}`);
    if (this.parallelActive >= 6) throw new Error('Six-call authorization exceeded');
    if (this.spent + this.reserved + 0.03 > 16) throw new Error('Authorized doubled 16 USD cap reached');
    const deadlineFile = join(here, '.deadline');
    const deadline = existsSync(deadlineFile)
      ? Date.parse(readFileSync(deadlineFile, 'utf8').trim())
      : Infinity;
    if (deadline <= Date.now()) throw new Error('Authorized local-time deadline reached');
    // Atomic cross-process guard as well as the per-instance guard above.
    const lock = join(here, `.parallel-model-lock-${this.calls}-${this.parallelActive}`);
    mkdirSync(lock);
    this.parallelActive++;
    this.reserved += 0.03;
    const folder = mkdtempSync(join(here, '.call-'));
    let record: Call;
    try {
      const output = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn('claude', flags, { cwd: folder, stdio: ['pipe', 'pipe', 'pipe'] });
          let stdout = '';
          let stderr = '';
          const timer = setTimeout(
            () => {
              child.kill('SIGKILL');
              reject(new Error('Call timed out'));
            },
            Math.min(120_000, deadline - Date.now()),
          );
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.stdin.on('error', (error) => {
            stderr += error.message;
          });
          child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('close', (code) => {
            clearTimeout(timer);
            resolve({ code, stdout, stderr });
          });
          child.stdin.end(user);
        },
      );
      const payload = JSON.parse(output.stdout);
      const known =
        typeof payload.total_cost_usd === 'number' &&
        Number.isFinite(payload.total_cost_usd) &&
        payload.total_cost_usd >= 0;
      record = {
        request_sha256,
        system,
        user,
        schema,
        text: typeof payload.result === 'string' ? payload.result : '',
        structured: payload.structured_output,
        costUsd: known ? payload.total_cost_usd : 0.03,
        failed: output.code !== 0 || payload.is_error === true || payload.subtype !== 'success' || !known,
        diagnostic:
          output.stderr ||
          (payload.is_error
            ? `CLI subtype: ${payload.subtype}; errors: ${JSON.stringify(payload.errors ?? [])}`
            : undefined),
        measuredAt: new Date().toISOString(),
        modelUsage: payload.modelUsage,
        cliType: payload.type,
        cliSubtype: payload.subtype,
        cliIsError: payload.is_error,
        cliExitCode: output.code,
      };
    } catch (error) {
      record = {
        request_sha256,
        system,
        user,
        schema,
        text: '',
        costUsd: 0.03,
        failed: true,
        diagnostic: String(error),
      };
    } finally {
      rmSync(folder, { recursive: true, force: true });
      this.parallelActive--;
      this.reserved -= 0.03;
      rmSync(lock, { recursive: true });
    }
    appendFileSync(join(here, 'recorded/calls.jsonl'), `${JSON.stringify(record)}\n`);
    this.parallelCache.set(request_sha256, record);
    this.spent += record.costUsd;
    this.fresh += record.costUsd;
    this.calls++;
    return record;
  }
}

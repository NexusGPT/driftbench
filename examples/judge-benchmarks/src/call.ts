import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Prompt } from './contestants';

/**
 * Model calls through the local claude command, recorded. A recording is keyed by a hash of the model and
 * the exact prompt, so a rerun of the same prompt reads the recording and costs nothing, and any change to
 * a prompt, a template or a criterion misses it and calls again.
 */

export type Recorded = {
  readonly key: string;
  readonly model: string;
  readonly text: string;
  readonly costUsd: number;
  /** A terminal no-answer transport event, never a model answer. Replays without retry. */
  readonly failure?: string;
  /** Labels for a reader of the file; the key alone decides the match. */
  readonly bench?: string;
  readonly contestant?: string;
  readonly item?: string;
  readonly order?: string;
};

export function promptKey(model: string, prompt: Prompt): string {
  return createHash('sha256')
    .update(JSON.stringify([model, prompt.system, prompt.user]))
    .digest('hex')
    .slice(0, 20);
}

export class Recordings {
  private readonly byKey = new Map<string, Recorded>();
  constructor(private readonly file: string) {}

  async load(): Promise<this> {
    let text = '';
    try {
      text = await readFile(this.file, 'utf8');
    } catch {
      return this;
    }
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const entry = JSON.parse(line) as Recorded;
      this.byKey.set(entry.key, entry);
    }
    return this;
  }

  get(key: string): Recorded | undefined {
    return this.byKey.get(key);
  }

  get size(): number {
    return this.byKey.size;
  }

  async add(entry: Recorded): Promise<void> {
    this.byKey.set(entry.key, entry);
    await mkdir(dirname(this.file), { recursive: true });
    await appendFile(this.file, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export type CallOptions = {
  readonly model: string;
  readonly command?: string;
  readonly timeoutMs?: number;
  /** Passed as --max-budget-usd on every call. */
  readonly maxCallUsd?: number;
};

export type Caller = {
  /** Answers a prompt from the recordings, or calls the model and records the answer. */
  call(prompt: Prompt, labels: Omit<Recorded, 'key' | 'model' | 'text' | 'costUsd'>): Promise<Recorded>;
  readonly spent: () => number;
  readonly calls: () => number;
  readonly replayed: () => number;
};

export class SpendCapReached extends Error {}

/** One call that failed after its retries: its item lacks this answer, and the run goes on. */
export class CallFailed extends Error {}

export function createCaller(
  recordings: Recordings,
  options: CallOptions,
  limits: { capUsd?: number; replayOnly?: boolean | 'lenient'; deadlineAt?: number } = {},
): Caller {
  let spent = 0;
  let calls = 0;
  let replayed = 0;
  let folder: string | undefined;
  return {
    spent: () => spent,
    calls: () => calls,
    replayed: () => replayed,
    async call(prompt, labels) {
      const key = promptKey(options.model, prompt);
      const hit = recordings.get(key);
      if (hit) {
        replayed += 1;
        if (hit.failure !== undefined) throw new CallFailed(hit.failure);
        return hit;
      }
      if (limits.replayOnly) {
        const why = `no recording for ${labels.contestant} ${labels.item} ${labels.order ?? ''}`;
        // Lenient replay counts the answer as missing; strict replay stops the run.
        throw limits.replayOnly === 'lenient' ? new CallFailed(why) : new Error(why);
      }
      if (limits.capUsd !== undefined && spent >= limits.capUsd)
        throw new SpendCapReached(`spend cap ${limits.capUsd} USD reached`);
      if (limits.deadlineAt !== undefined && Date.now() >= limits.deadlineAt)
        throw new SpendCapReached('run deadline reached');
      folder ??= await mkdtemp(join(tmpdir(), 'driftbench-bench-'));
      const remaining = limits.capUsd === undefined ? undefined : limits.capUsd - spent;
      const callOptions =
        remaining === undefined
          ? options
          : {
              ...options,
              maxCallUsd: Math.min(options.maxCallUsd ?? remaining, remaining),
            };
      let result: { text: string; costUsd: number };
      try {
        result = await runClaude(prompt, callOptions, folder, limits.deadlineAt);
      } catch (cause) {
        if (cause instanceof CallFailed)
          await recordings.add({key, model: options.model, text: '', costUsd: 0, ...labels, failure: cause.message});
        throw cause;
      }
      spent += result.costUsd;
      calls += 1;
      const entry: Recorded = {
        key,
        model: options.model,
        text: result.text,
        costUsd: result.costUsd,
        ...labels,
      };
      await recordings.add(entry);
      return entry;
    },
  };
}

async function runClaude(
  prompt: Prompt,
  options: CallOptions,
  cwd: string,
  deadlineAt?: number,
): Promise<{ text: string; costUsd: number }> {
  const args = [
    '-p',
    '--output-format',
    'json',
    '--model',
    options.model,
    '--system-prompt',
    prompt.system,
    '--tools',
    '',
    '--setting-sources',
    '',
    '--strict-mcp-config',
    '--no-session-persistence',
    '--max-turns',
    '1',
    ...(options.maxCallUsd === undefined ? [] : ['--max-budget-usd', String(options.maxCallUsd)]),
  ];
  for (let attempt = 1; ; attempt += 1) {
    if (deadlineAt !== undefined && Date.now() >= deadlineAt)
      throw new SpendCapReached('run deadline reached');
    let ran: { stdout: string; stderr: string };
    try {
      ran = await spawnOnce(
        options.command ?? 'claude',
        args,
        prompt.user,
        cwd,
        Math.min(
          options.timeoutMs ?? Number(process.env.VERIFY_OUTER_TIMEOUT_MS ?? 300_000),
          deadlineAt === undefined ? Infinity : Math.max(1, deadlineAt - Date.now()),
        ),
      );
    } catch (cause) {
      if (deadlineAt !== undefined && Date.now() >= deadlineAt)
        throw new SpendCapReached('run deadline reached during a call');
      // A call past its timeout is tried once more, then its answer is missing and the run goes on.
      if (process.env.VERIFY_OUTER_TIMEOUT_MS || attempt >= 2) throw new CallFailed(cause instanceof Error ? cause.message : String(cause));
      continue;
    }
    let payload:
      | { result?: unknown; total_cost_usd?: unknown; is_error?: unknown; subtype?: unknown }
      | undefined;
    try {
      payload = JSON.parse(ran.stdout) as typeof payload;
    } catch {
      payload = undefined;
    }
    const cost = typeof payload?.total_cost_usd === 'number' ? payload.total_cost_usd : 0;
    if (payload && payload.is_error !== true) {
      return { text: typeof payload.result === 'string' ? payload.result : '', costUsd: cost };
    }
    const why = payload ? String(payload.result) : (ran.stderr || ran.stdout).slice(0, 300);
    if (/^Transport missing:/.test(why)) throw new CallFailed(why);
    // Quota exhaustion is pending transport, never a failed judge answer or a retryable content result.
    if (/^Transport quota:/.test(why)) throw new Error(why);
    // A session or rate limit is not retried: the run stops and reports it.
    if (/limit/i.test(why)) throw new Error(`claude stopped: ${why}`);
    if (attempt >= 3) throw new CallFailed(`claude failed ${attempt} times: ${why}`);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

function spawnOnce(
  command: string,
  args: readonly string[],
  input: string,
  cwd: string,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`claude ran past ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
    child.once('close', () => {
      clearTimeout(timer);
      resolve({ stdout, stderr });
    });
    child.stdin.on('error', () => {
      // The process closed its input early; its output says why.
    });
    child.stdin.end(input);
  });
}

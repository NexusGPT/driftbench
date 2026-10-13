import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
export type Prompt = { system: string; user: string };

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
  readonly startedAt?: string;
  readonly finishedAt?: string;
  /** Labels for a reader of the file; the key alone decides the match. */
  readonly bench?: string;
  readonly contestant?: string;
  readonly item?: string;
  readonly order?: string;
};

/** Failed attempts retain returned charges, or reserve their configured maximum. */
export type RecordedFailure = Omit<Recorded, 'text' | 'costUsd'> & {
  readonly costUsd: number | null;
  readonly reservedUsd: number;
  readonly reason: string;
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

  async addFailure(entry: RecordedFailure): Promise<void> {
    const file = this.file.endsWith('.jsonl')
      ? `${this.file.slice(0, -6)}.failures.jsonl`
      : `${this.file}.failures.jsonl`;
    await mkdir(dirname(file), { recursive: true });
    await appendFile(file, `${JSON.stringify(entry)}\n`, 'utf8');
  }
}

export type CallOptions = {
  readonly model: string;
  readonly command?: string;
  readonly timeoutMs?: number;
  /** Absolute UTC cutoff; resume can supply a newly authorized deadline. */
  readonly lastNewCallAt?: number;
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

export class CallDeadlineReached extends Error {}

const LAST_NEW_CALL_AT = Date.parse('2026-10-13T04:39:00Z');
function checkCallDeadline(deadline = LAST_NEW_CALL_AT): void {
  if (!Number.isFinite(deadline)) throw new RangeError('Invalid call deadline');
  if (Date.now() >= deadline) throw new CallDeadlineReached('Last new call deadline reached');
}

/** A failed attempt with its reported charge, when the process returned one. */
export class CallFailed extends Error {
  constructor(
    message: string,
    readonly costUsd?: number,
  ) {
    super(message);
    this.name = 'CallFailed';
  }
}

export function createCaller(
  recordings: Recordings,
  options: CallOptions,
  limits: { capUsd?: number; replayOnly?: boolean | 'lenient' } = {},
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
        return hit;
      }
      if (limits.replayOnly) {
        const why = `no recording for ${labels.contestant} ${labels.item} ${labels.order ?? ''}`;
        // Lenient replay counts the answer as missing; strict replay stops the run.
        throw limits.replayOnly === 'lenient' ? new CallFailed(why) : new Error(why);
      }
      if (limits.capUsd !== undefined && spent >= limits.capUsd)
        throw new SpendCapReached(`spend cap ${limits.capUsd} USD reached`);
      checkCallDeadline(options.lastNewCallAt);
      const startedAt = new Date().toISOString();
      folder ??= await mkdtemp(join(tmpdir(), 'driftbench-bench-'));
      let result: { text: string; costUsd: number };
      try {
        result = await runClaude(prompt, options, folder);
      } catch (cause) {
        // A deadline rejection launches no process and has no charge to reserve.
        if (cause instanceof CallDeadlineReached) throw cause;
        const failure =
          cause instanceof CallFailed
            ? cause
            : new CallFailed(cause instanceof Error ? cause.message : String(cause));
        spent += failure.costUsd ?? 0;
        calls += 1;
        await recordings.addFailure({
          key,
          model: options.model,
          startedAt,
          finishedAt: new Date().toISOString(),
          ...labels,
          costUsd: failure.costUsd ?? null,
          reservedUsd: failure.costUsd === undefined ? (options.maxCallUsd ?? 0) : 0,
          reason: failure.message,
        });
        throw failure;
      }
      spent += result.costUsd;
      calls += 1;
      const entry: Recorded = {
        key,
        model: options.model,
        text: result.text,
        costUsd: result.costUsd,
        startedAt,
        finishedAt: new Date().toISOString(),
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
    let ran: { stdout: string; stderr: string };
    try {
      ran = await spawnOnce(
        options.command ?? 'claude',
        args,
        prompt.user,
        cwd,
        options.timeoutMs ?? 300_000,
        options.lastNewCallAt,
      );
    } catch (cause) {
      if (cause instanceof CallDeadlineReached) throw cause;
      // Failed attempts are not retried; unknown charges are reserved by the caller.
      if (attempt >= 1) throw new CallFailed(cause instanceof Error ? cause.message : String(cause));
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
    const cost =
      typeof payload?.total_cost_usd === 'number' &&
      Number.isFinite(payload.total_cost_usd) &&
      payload.total_cost_usd >= 0
        ? payload.total_cost_usd
        : undefined;
    if (payload && payload.is_error !== true) {
      return { text: typeof payload.result === 'string' ? payload.result : '', costUsd: cost ?? 0 };
    }
    const why = payload ? String(payload.result) : (ran.stderr || ran.stdout).slice(0, 300);
    // A session or rate limit is not retried: the run stops and reports it.
    if (/limit/i.test(why)) throw new CallFailed(`claude stopped: ${why}`, cost);
    if (attempt >= 1) throw new CallFailed(`claude failed ${attempt} times: ${why}`, cost);
    await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}

function spawnOnce(
  command: string,
  args: readonly string[],
  input: string,
  cwd: string,
  timeoutMs: number,
  lastNewCallAt?: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // The caller may have awaited filesystem work since its first check.
    // Keep this check adjacent to spawn so no new process starts after cutoff.
    checkCallDeadline(lastNewCallAt);
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

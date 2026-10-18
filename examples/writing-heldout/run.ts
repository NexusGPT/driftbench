/**
 * driftbench and promptfoo on a sealed writing split, Claude Haiku through the claude command.
 * The invocation matches examples/all-peers-public/transport.py. A request is keyed by
 * sha256(model, system, user); an answered key replays from runs/calls.jsonl and is never sent again.
 *
 *   npx tsx examples/writing-heldout/run.ts --split practice --contestant driftbench-v1 --cap-usd 3
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import type { RubricItem } from '../../packages/judges/src/assessment';
import type { JudgeClient } from '../../packages/judges/src/client';
import { judgePairLedger, pairLedgerRequest } from '../../packages/judges/src/pair-ledger';
import { buildPrompt } from '../../packages/judges/src/prompt';
import { writingRequirementsV1 } from '../../packages/judges/src/writing-requirements';
import { CONTESTANTS } from './contestants';

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL = 'claude-haiku-5-5';
const CALL_CAP_USD = 0.1;
const TIMEOUT_MS = 300_000;
export const CRITERION =
  'The response is the better piece of writing for the instruction: it follows every requirement of the instruction and is of higher quality.';

type Item = { id: string; question: string; a: string; b: string; label: 'A' | 'B'; language: string };
type Game = 'A' | 'B' | 'tie';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const jsonl = (path: string): any[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];

class Journal {
  answers = new Map<string, any>();
  knownUsd = 0;
  reservedUsd = 0;
  inflight = new Map<string, Promise<any>>();
  folder = mkdtempSync(join(tmpdir(), 'writing-heldout-'));
  constructor(
    readonly path: string,
    readonly capUsd: number,
  ) {
    const starts = new Map<string, any>(),
      finishes = new Map<string, any>();
    for (const row of jsonl(path)) (row.type === 'start' ? starts : finishes).set(row.attemptKey, row);
    for (const [k, start] of starts) {
      const finish = finishes.get(k);
      if (!finish) {
        this.reservedUsd += start.reserveUsd;
        continue;
      }
      this.knownUsd += finish.costUsd;
      if (finish.answered) this.answers.set(start.key, finish);
    }
  }
  log(row: unknown) {
    appendFileSync(this.path, `${JSON.stringify(row)}\n`);
  }
  async call(system: string, user: string, tag: string): Promise<{ text: string; costUsd: number }> {
    const key = sha(JSON.stringify([MODEL, system, user]));
    const known = this.answers.get(key);
    if (known) return { text: known.text, costUsd: 0 };
    const pending = this.inflight.get(key);
    if (pending) return pending.then((f) => ({ text: f.text, costUsd: 0 }));
    if (existsSync(`${this.path}.stop`)) throw new Error('STOP operator stop file present');
    if (this.knownUsd + this.reservedUsd + CALL_CAP_USD > this.capUsd)
      throw new Error(`STOP cap ${this.capUsd} USD would be exceeded`);
    this.reservedUsd += CALL_CAP_USD;
    const attemptKey = `${key}:${Date.now()}:${Math.random()}`;
    this.log({ type: 'start', key, attemptKey, tag, reserveUsd: CALL_CAP_USD, at: new Date().toISOString() });
    const run = this.runClaude(system, user).then((result) => {
      const costUsd = typeof result.measuredCostUsd === 'number' ? result.measuredCostUsd : CALL_CAP_USD;
      const finish = {
        type: 'finish',
        key,
        attemptKey,
        tag,
        costUsd,
        at: new Date().toISOString(),
        ...result,
      };
      this.log(finish);
      this.reservedUsd -= CALL_CAP_USD;
      this.knownUsd += costUsd;
      this.inflight.delete(key);
      if (!result.answered) throw new Error(`TRANSPORT ${String(result.error).slice(0, 300)}`);
      this.answers.set(key, finish);
      return finish;
    });
    this.inflight.set(key, run);
    const finish = await run;
    return { text: finish.text, costUsd: finish.costUsd };
  }
  runClaude(system: string, user: string): Promise<any> {
    const env = { ...process.env, DISABLE_PROMPT_CACHING: '1' };
    for (const k of ['CLAUDECODE', 'ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_JUDGE_MODEL'])
      delete env[k];
    const args = [
      '-p',
      '--output-format',
      'json',
      '--model',
      MODEL,
      '--system-prompt',
      system,
      '--tools',
      '',
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--no-session-persistence',
      '--max-turns',
      '1',
      '--max-budget-usd',
      String(CALL_CAP_USD),
    ];
    const started = Date.now();
    return new Promise((done) => {
      const child = spawn('claude', args, { cwd: this.folder, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let out = '',
        err = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), TIMEOUT_MS);
      child.stdout.on('data', (d) => {
        out += d;
      });
      child.stderr.on('data', (d) => {
        err += d;
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        const elapsedS = (Date.now() - started) / 1000;
        let envelope: any;
        try {
          envelope = JSON.parse(out);
        } catch {
          return done({
            answered: false,
            error: `exit ${code} without JSON`,
            stderr: err.slice(-2000),
            elapsedS,
          });
        }
        const base = {
          elapsedS,
          subtype: envelope.subtype,
          usage: envelope.usage,
          measuredCostUsd: typeof envelope.total_cost_usd === 'number' ? envelope.total_cost_usd : undefined,
        };
        if (envelope.is_error || code !== 0 || envelope.subtype !== 'success')
          return done({
            ...base,
            answered: false,
            error: String(envelope.result ?? envelope.subtype).slice(0, 2000),
          });
        done({ ...base, answered: true, text: envelope.result ?? '' });
      });
      child.stdin.end(user);
    });
  }
}

export function promptfoo(question: string, a: string, b: string) {
  const template = readFileSync(resolve(HERE, 'vendor/select-best.njk'), 'utf8');
  const loop =
    '{% for output in outputs %}\n<Text index="{{ loop.index0 }}">\n{{ output }}\n</Text>\n{% endfor %}';
  if (!template.includes(loop)) throw Error('Upstream prompt template changed');
  const values: Record<string, string> = { criteria: `${CRITERION} The question: ${question}`, a, b };
  const rendered = template.replace(
    loop,
    '<Text index="0">\n{{a}}\n</Text>\n\n<Text index="1">\n{{b}}\n</Text>',
  );
  return {
    system: rendered.replace(/\{\{(criteria|a|b)\}\}/g, (_, k) => values[k] as string),
    user: 'Output the index now.',
  };
}
const parsePromptfoo = (text: string): Game => {
  const n = text.match(/\d+/)?.[0];
  return n === '0' ? 'A' : n === '1' ? 'B' : 'tie';
};
const flip = (g: Game): Game => (g === 'A' ? 'B' : g === 'B' ? 'A' : 'tie');

async function judge(contestant: string, item: Item, journal: Journal) {
  let costUsd = 0,
    calls = 0;
  const ask = async (system: string, user: string) => {
    calls++;
    const out = await journal.call(system, user, `${contestant}:${item.id}`);
    costUsd += out.costUsd;
    return out;
  };
  if (contestant === 'promptfoo') {
    const ab = promptfoo(item.question, item.a, item.b),
      ba = promptfoo(item.question, item.b, item.a);
    const [x, y] = await Promise.all([ask(ab.system, ab.user), ask(ba.system, ba.user)]);
    return { games: [parsePromptfoo(x.text), flip(parsePromptfoo(y.text))], costUsd, calls };
  }
  const variant = CONTESTANTS[contestant];
  if (!variant) throw new Error(`unknown contestant ${contestant}`);
  const requirements: RubricItem[] = variant.requirements(item.question);
  const client: JudgeClient = {
    id: MODEL,
    family: 'anthropic',
    cls: 'system2',
    cost: 1,
    dialect: 'scratchpad-json',
    judge: async (request) => {
      const p = buildPrompt(request);
      const out = await ask(p.system, p.user);
      return { raw: out.text, costUsd: out.costUsd } as any;
    },
  } as JudgeClient;
  const request = pairLedgerRequest(
    { name: 'writing', rubric: CRITERION },
    [{ role: 'user', text: item.question }],
    item.a,
    item.b,
    { requirements },
  );
  const details = await judgePairLedger(client, request, {
    stage0: { correctness: false, compute: false, language: item.language },
    tiePolicy: 'canonical',
    ...variant.options,
  });
  const choice: Game = details.choice === 'first' ? 'A' : details.choice === 'second' ? 'B' : 'tie';
  return {
    games: [choice, choice],
    costUsd,
    calls,
    ruleId: details.verdict?.ruleId,
    readings: details.verdict?.readings,
    ledgers: details.reads.map((r) => ({
      order: r.order,
      ledger: r.result.pairLedger ?? null,
      unparsed: !!r.result.unparsed,
    })),
  };
}

async function main() {
  const { values } = parseArgs({
    options: {
      split: { type: 'string' },
      contestant: { type: 'string' },
      'cap-usd': { type: 'string' },
      workers: { type: 'string', default: '4' },
      limit: { type: 'string' },
    },
  });
  const split = values.split as string,
    contestant = values.contestant as string;
  if (!['practice', 'fresh'].includes(split)) throw new Error('split must be practice or fresh');
  const items: Item[] = JSON.parse(readFileSync(resolve(HERE, 'items', `${split}.json`), 'utf8')).slice(
    0,
    values.limit ? Number(values.limit) : undefined,
  );
  const out = resolve(HERE, 'runs', split, `${contestant}.jsonl`);
  mkdirSync(dirname(out), { recursive: true });
  const journal = new Journal(resolve(HERE, 'runs', 'calls.jsonl'), Number(values['cap-usd']));
  const done = new Set(jsonl(out).map((r) => r.id));
  const todo = items.filter((x) => !done.has(x.id));
  console.log(
    JSON.stringify({ split, contestant, items: items.length, todo: todo.length, knownUsd: journal.knownUsd }),
  );
  let cursor = 0,
    stop = false,
    finished = 0;
  await Promise.all(
    Array.from({ length: Number(values.workers) }, async () => {
      while (!stop && cursor < todo.length) {
        const item = todo[cursor++] as Item;
        try {
          const row = await judge(contestant, item, journal);
          appendFileSync(
            out,
            `${JSON.stringify({ id: item.id, contestant, ...row, at: new Date().toISOString() })}\n`,
          );
          if (++finished % 20 === 0)
            console.log(
              JSON.stringify({ finished, of: todo.length, knownUsd: +journal.knownUsd.toFixed(4) }),
            );
        } catch (error) {
          const text = String(error);
          console.error(JSON.stringify({ id: item.id, error: text.slice(0, 400) }));
          if (text.includes('STOP')) stop = true;
        }
      }
    }),
  );
  console.log(JSON.stringify({ finished, missing: todo.length - finished, knownUsd: journal.knownUsd }));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

export { writingRequirementsV1 };

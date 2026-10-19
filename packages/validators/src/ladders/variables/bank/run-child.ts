/**
 * What the bank's child process runs: the items of the variables bank on one seed, against the implementation
 * under test, which is loaded in this process only. The child RECORDS the implementation's answers (tape.ts) and
 * prints them; it decides nothing. Every line it prints is signed with a key that arrives on stdin before the
 * implementation is imported, so the implementation cannot print a verdict or a tape of its own: the parent
 * believes only signed lines, and replays the tapes to compute every verdict itself (isolate.ts).
 */
import { createHmac } from 'node:crypto';
import { loadImpl } from '../impl';
import { runItem, variablesBank } from './index';
import { recordImpl, type Tape } from './tape';

async function main(args: readonly string[]): Promise<void> {
  const [seedText, root, startText] = args;
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const { key, ids } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { key: string; ids: string[] };
  // Everything the child needs to speak is captured here, before the implementation is imported.
  const write = process.stdout.write.bind(process.stdout);
  const hmac = createHmac;
  const say = (line: unknown) => {
    const text = JSON.stringify(line);
    write(`${hmac('sha256', key).update(text).digest('hex')} ${text}\n`);
  };
  const byId = new Map(variablesBank().map((item) => [item.id, item]));
  const items = ids.map((id) => {
    const item = byId.get(id);
    if (!item) throw new Error(`no bank item ${id}`);
    return item;
  });
  let loaded: Awaited<ReturnType<typeof loadImpl>> | undefined;
  let loadError: string | undefined;
  try {
    loaded = await loadImpl();
  } catch (cause) {
    loadError = `the implementation did not load: ${cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause)}`;
  }
  const provides = loaded
    ? Object.entries(loaded.impl)
        .filter(([, value]) => typeof value === 'function')
        .map(([name]) => name)
    : [];
  for (let index = start; index < items.length; index += 1) {
    const item = items[index] as (typeof items)[number];
    say({ start: index, id: item.id });
    const began = performance.now();
    const tape: Tape = [];
    if (loaded) await runItem(item, seed, root as string, recordImpl(loaded.impl, tape), loaded.module);
    say({
      done: index,
      id: item.id,
      provides,
      tape,
      ...(loadError ? { loadError } : {}),
      ms: Math.round(performance.now() - began),
    });
  }
}

/** Runs the child and ends the process: exit 0 when every item ran, exit 1 with the cause on stderr otherwise. */
export function variablesBankChild(args: readonly string[]): Promise<never> {
  return main(args).then(
    () =>
      new Promise<never>(() => {
        process.stdout.write('', () => process.exit(0));
      }),
    (cause) => {
      process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
      process.exit(1);
    },
  );
}

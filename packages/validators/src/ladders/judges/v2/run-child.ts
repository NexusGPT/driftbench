/**
 * What the bank's child process runs: judges bank items on one seed against the real judges package, in the
 * order given, from a start index, with one JSON line before and after each item. `child.ts` calls it from
 * source; a built package calls it through its own entry point (see isolate.ts). `args` is <seed> <root>
 * <start>, and the item ids come as a JSON array on stdin.
 */
import { realApi, runItem } from './bank';
import { judgesBank } from './index';

async function main(args: readonly string[]): Promise<void> {
  const [seedText, root, startText] = args;
  const seed = Number(seedText);
  const start = Number(startText ?? 0);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  const byId = new Map(judgesBank({ quarantined: true }).map((entry) => [entry.id, entry]));
  for (let index = start; index < ids.length; index += 1) {
    const entry = byId.get(ids[index] as string);
    if (!entry) throw new Error(`no bank item ${ids[index]}`);
    process.stdout.write(`${JSON.stringify({ start: index, id: entry.id })}\n`);
    const result = await runItem(entry, seed, root as string, realApi);
    process.stdout.write(
      `${JSON.stringify({ done: index, id: entry.id, pass: result.pass, detail: result.detail })}\n`,
    );
  }
}

/** Runs the child and ends the process: exit 0 when every item ran, exit 1 with the cause on stderr otherwise. */
export function judgesBankChild(args: readonly string[]): Promise<never> {
  return main(args).then(
    // Exit when every line has left the process: an exit with output still queued would drop it.
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

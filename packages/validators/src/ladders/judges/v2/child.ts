/**
 * The bank's child process: runs judges bank items on one seed against the real judges package, in the order
 * given, from a start index, and writes one JSON line before and after each item. The parent (isolate.ts) kills
 * it when an item runs past its time limit, so an endless loop in packages/judges fails one item instead of
 * hanging the validator.
 * Usage: node --import tsx child.ts <seed> <root> <start>, with the item ids as a JSON array on stdin.
 */
import { realApi, runItem } from './bank';
import { judgesBank } from './index';

async function main(): Promise<void> {
  const [seedText, root, startText] = process.argv.slice(2);
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

main().then(
  () => process.exit(0),
  (cause) => {
    process.stderr.write(`bank child failed: ${cause instanceof Error ? cause.stack : String(cause)}\n`);
    process.exit(1);
  },
);

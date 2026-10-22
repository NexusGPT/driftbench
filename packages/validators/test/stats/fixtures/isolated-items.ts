import { fileURLToPath } from 'node:url';
import type { BankItem, ItemOutcome } from '../../../src/ladders/stats/bank/item';

/** A controlled bank for the real isolation runner; neither item calls statistics code. */
export const isolatedFixtureItems = [
  {
    id: 'fixture.never-finishes',
    family: 'fixture',
    tier: 1,
    level: 'degenerate',
    component: 'fixture/hang',
    check: () =>
      new Promise<ItemOutcome>(() => {
        // An unresolved promise alone lets Node exit. Keep this child alive until the parent kills it.
        setInterval(() => undefined, 1_000);
      }),
  },
  {
    id: 'fixture.finishes',
    family: 'fixture',
    tier: 1,
    level: 'degenerate',
    component: 'fixture/finish',
    check: () => ({ pass: true, detail: 'fixture completed' }),
  },
] satisfies BankItem[];

async function main() {
  const start = Number(process.argv[4]);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  for (let index = start; index < ids.length; index++) {
    const item = isolatedFixtureItems.find((item) => item.id === ids[index]);
    if (!item) throw new Error(`missing fixture item ${ids[index]}`);
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const result = await item.check();
    process.stdout.write(`${JSON.stringify({ done: index, id: item.id, ...result })}\n`);
  }
  // As the bank's child does: a last line once its frame is closed.
  process.stdout.write(`${JSON.stringify({ closed: true })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exitCode = 1;
  });
}

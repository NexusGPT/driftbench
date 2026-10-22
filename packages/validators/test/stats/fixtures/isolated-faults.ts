import { fileURLToPath } from 'node:url';
import type { BankItem, ItemOutcome } from '../../../src/ladders/stats/bank/item';

/**
 * A controlled bank and child for the isolation runner's accounting: children that end with exit code 0 before
 * they have reported every item, an item that ends the process, an item slower than its budget, and output far
 * larger than a pipe holds. FIXTURE_MODE picks the fault; no item calls statistics code.
 */
const pass = (detail: string): ItemOutcome => ({ pass: true, detail });
const fixture = (id: string, check: BankItem['check']): BankItem => ({
  id: `fault.${id}`,
  family: 'fixture',
  tier: 1,
  level: 'degenerate',
  component: 'fixture/fault',
  check,
});
const mode = process.env.FIXTURE_MODE ?? '';

export const faultFixtureItems: BankItem[] = [
  fixture('a', () => pass('a')),
  fixture('b', () => pass('b')),
  fixture('c', () => {
    // A promise nothing will settle and no handle keeps: Node ends the process with exit code 0.
    if (mode === 'pending-promise') return new Promise<ItemOutcome>(() => undefined);
    if (mode === 'item-exits') process.exit(0);
    if (mode === 'slow')
      return new Promise<ItemOutcome>((resolve) => setTimeout(() => resolve(pass('c')), 6_000));
    return pass(mode === 'floods' ? 'x'.repeat(400_000) : 'c');
  }),
  fixture('d', () => pass(mode === 'floods' ? 'y'.repeat(400_000) : 'd')),
  fixture('e', () => pass('e')),
];

async function main() {
  const start = Number(process.argv[4]);
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  const ids = JSON.parse(Buffer.concat(chunks).toString('utf8')) as string[];
  for (let index = start; index < ids.length; index += 1) {
    const item = faultFixtureItems.find((each) => each.id === ids[index]);
    if (!item) throw new Error(`missing fixture item ${ids[index]}`);
    // The first child stops after two items, as if it were done; a resumed child runs to the end.
    if (mode === 'quits-once' && start === 0 && index === 2) process.exit(0);
    process.stdout.write(`${JSON.stringify({ start: index, id: item.id })}\n`);
    const result = await item.check({ seed: 1, s: {} as never, root: '', rng: Math.random });
    process.stdout.write(`${JSON.stringify({ done: index, id: item.id, ...result })}\n`);
  }
  // As the bank's child does: a last line once its frame is closed, then exit when every line has left the process.
  process.stdout.write(`${JSON.stringify({ closed: true })}\n`, () => process.exit(0));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack : error}\n`);
    process.exit(1);
  });
}

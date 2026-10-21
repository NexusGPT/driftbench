import { resolveSut } from '../sut/adapter';
import { type Control, runControl } from './controls';
import { executeHere } from './run';
import type { Outcome } from './types';

type Job = { id: string; seed: number };

/**
 * The process that serves the items of the bank for a parent that can stop it (`isolated` in run.ts). It answers
 * `{ ready }` once, then one `{ done }` for each `{ run: { id, seed } }`. It runs only when the parent forked it.
 */
async function main(): Promise<void> {
  const { pointerBank } = await import('./index');
  const sut = await resolveSut();
  await sut.ready?.();
  const bank = pointerBank();
  const { pointerBank: blindItems } = await import('../blind/bank/index');
  const { runBlind } = await import('./blind');
  const blind = blindItems();
  process.on('message', async (message: { run?: Job; blind?: Job; control?: Control }) => {
    if (message.control) {
      process.send?.({ done: await runControl(message.control, sut) });
      return;
    }
    if (message.blind) {
      const wanted = message.blind;
      const item = blind.find((candidate) => candidate.id === wanted.id);
      process.send?.({
        done: item
          ? await runBlind(item, wanted.seed, resolveSut)
          : { outcome: { pass: false, detail: `the child holds no blind item ${wanted.id}` } },
      });
      return;
    }
    if (!message.run) return;
    const item = bank.find((candidate) => candidate.id === message.run?.id);
    const outcome: Outcome = item
      ? await executeHere(item, message.run.seed, sut)
      : { pass: false, detail: `the child holds no item ${message.run.id}` };
    process.send?.({ done: outcome });
  });
  process.send?.({ ready: true });
}

if (process.env.DRIFTBENCH_POINTER_ITEM_CHILD === '1' && process.send) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(1);
  });
}

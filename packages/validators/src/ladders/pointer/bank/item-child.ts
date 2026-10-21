import { pinSut } from '../sut/adapter';
import { type Control, runControl } from './controls';
import { HostPool } from './reader-link';
import { executeHere } from './run';
import { fail, type Outcome } from './types';

type Job = { id: string; seed: number };

/**
 * The process that serves the items of the bank for a parent that can stop it (`isolated` in run.ts). It holds the
 * oracle of every item and never loads the reader: the reader loads in a second process (`reader-host.ts`) that
 * this one starts, and the items call it across the channel of `reader-link.ts`. A verdict is computed here from the
 * answers the reader gives, and sent to the parent over a channel the reader process cannot reach. This process
 * answers `{ ready }` once, then one `{ done }` for each `{ run: { id, seed } }`, `{ blind: { id, seed } }` or
 * `{ control }`. It runs only when the parent forked it.
 */
async function main(): Promise<void> {
  // The module the runner named, kept before anything else loads; the reader process gets it, nothing else reads the variable.
  const module = pinSut();
  const { pointerBank } = await import('./index');
  const bank = pointerBank();
  const { pointerBank: blindItems } = await import('../blind/bank/index');
  const { runBlind } = await import('./blind');
  const blind = blindItems();
  const pool = new HostPool(module);
  // The parent is gone: the reader's process goes with this one.
  process.on('disconnect', () => {
    void pool.close().finally(() => process.exit(0));
  });
  // The reader loads in its own process before the first item clock starts.
  await pool.open();
  process.on('message', async (message: { run?: Job; blind?: Job; control?: Control }) => {
    const session = await pool.open();
    const lost = (): string | undefined => session.lost();
    // An item that overran had its reader's process stopped: the next one starts here, inside the grace the parent
    // gives this item, so that the start does not count against the next item.
    const answer = async (done: unknown): Promise<void> => {
      if (session.stopped()) await pool.open();
      process.send?.({ done });
    };
    if (message.control) {
      const outcome = await runControl(message.control, session.sut);
      await answer(lost() ? fail(lost() as string) : outcome);
      return;
    }
    if (message.blind) {
      const wanted = message.blind;
      const item = blind.find((candidate) => candidate.id === wanted.id);
      const given = item
        ? await runBlind(item, wanted.seed, async () => session.sut, session)
        : { outcome: fail(`the child holds no blind item ${wanted.id}`) };
      await answer(lost() ? { outcome: fail(lost() as string) } : given);
      return;
    }
    if (!message.run) return;
    const item = bank.find((candidate) => candidate.id === message.run?.id);
    const outcome: Outcome = item
      ? await executeHere(item, message.run.seed, session.sut, session.stop)
      : fail(`the child holds no item ${message.run.id}`);
    await answer(lost() ? fail(lost() as string) : outcome);
  });
  process.send?.({ ready: true });
}

if (process.env.DRIFTBENCH_POINTER_ITEM_CHILD === '1' && process.send) {
  main().catch((cause) => {
    process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    process.exit(1);
  });
}

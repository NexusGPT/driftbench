import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { clearSeedFreeCache } from '../../src/ladders/pointer/bank/run';
import { CHEATS } from './cheats';
import { readerOnly, tally } from './helpers';

const CHEATS_MODULE = fileURLToPath(new URL('./cheats.ts', import.meta.url));

/** Items a reader that does nothing may legitimately pass: an empty input must give an empty result. */
const LEGITIMATE_EMPTY = new Set(['stack.empty-input']);

/**
 * The cheater check (docs/validators.md section 12.7): readers that do as little as they can must pass no item,
 * except the named empty-input items. The scale family is left out here: its items run child processes for minutes.
 */
describe('cheating readers pass no item', { timeout: 1_800_000 }, () => {
  for (const cheat of CHEATS) {
    it(`${cheat.name}`, async () => {
      const beforeModule = process.env.DRIFTBENCH_POINTER_SUT;
      const beforeCheat = process.env.DRIFTBENCH_CHEAT;
      clearSeedFreeCache();
      try {
        // Children resolve the cheat by name from the environment.
        process.env.DRIFTBENCH_CHEAT = cheat.name;
        const out = await tally(cheat, (i) => i.family !== 'scale' && !readerOnly(i), 1, CHEATS_MODULE);
        const passed = out.total - out.failed.length;
        expect(out.total).toBeGreaterThan(300);
        const failedIds = new Set(out.failed.map((f) => f.id));
        const stray = (await import('../../src/ladders/pointer/bank/index'))
          .pointerBank()
          .filter((i) => i.family !== 'scale' && !readerOnly(i) && !failedIds.has(i.id))
          .map((i) => i.id)
          .filter((id) => !LEGITIMATE_EMPTY.has(id));
        expect(stray, `${cheat.name} passes ${passed} items`).toEqual([]);
      } finally {
        if (beforeModule === undefined) delete process.env.DRIFTBENCH_POINTER_SUT;
        else process.env.DRIFTBENCH_POINTER_SUT = beforeModule;
        if (beforeCheat === undefined) delete process.env.DRIFTBENCH_CHEAT;
        else process.env.DRIFTBENCH_CHEAT = beforeCheat;
      }
    });
  }
});

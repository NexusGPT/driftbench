import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as main from '../../../cli/src/main';
import { type BankItem, PASS, scratchFolder, systemBank } from '../../src/ladders/system/bank/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const scratch = scratchFolder();
afterAll(() => scratch.remove());
const bank = systemBank();
const ids = ['claim/cli/family/review-pending', 'breaker/tools/family-review-pending-exit-1'];

function itemOf(id: string): BankItem {
  const item = bank.find((entry) => entry.id === id);
  expect(item, id).toBeDefined();
  return item as BankItem;
}

describe('family review items own their pending and signed inputs', () => {
  for (const id of ids) {
    for (const seed of [1, 2, 3]) {
      it(`holds: ${id}, seed ${seed}`, async () => {
        await expect(itemOf(id).check({ seed, root: ROOT, scratch: scratch.path })).resolves.toEqual(PASS);
      });
    }

    it(`needs no committed example: ${id}`, async () => {
      await expect(
        itemOf(id).check({ seed: 4, root: join(scratch.path, 'no-repo'), scratch: scratch.path }),
      ).resolves.toEqual(PASS);
    });

    for (const mutant of ['pending exits 0', 'signed reports pending'] as const) {
      it(`rejects ${mutant}: ${id}`, async () => {
        const original = main.main;
        let changed = false;
        const spy = vi.spyOn(main, 'main').mockImplementation(async (argv, io, ...rest) => {
          if (!io) throw new Error('Bank command omitted IO');
          let output = '';
          const code = await original(
            argv,
            {
              ...io,
              out: (text) => {
                output += text;
              },
            },
            ...rest,
          );
          if (argv[0] === 'family' && argv[1] === 'review') {
            if (mutant === 'pending exits 0' && output.startsWith('Review: pending.')) {
              changed = true;
              io.out(output);
              return 0;
            }
            if (mutant === 'signed reports pending' && output.startsWith('Review: signed by ')) {
              changed = true;
              io.out('Review: pending.\n');
              return code;
            }
          }
          io.out(output);
          return code;
        });
        try {
          const result = await itemOf(id).check({ seed: 5, root: ROOT, scratch: scratch.path });
          expect(changed).toBe(true);
          expect(result.pass).toBe(false);
          if (!result.pass)
            expect(result.detail).toContain(mutant.startsWith('pending') ? 'pending' : 'signed');
        } finally {
          spy.mockRestore();
        }
      });
    }
  }
});

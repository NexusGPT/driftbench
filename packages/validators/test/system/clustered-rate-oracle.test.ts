import { fileURLToPath } from 'node:url';
import * as report from '@agent-nexus/driftbench-report';
import { describe, expect, it, vi } from 'vitest';
import { hiddenSeed } from '../../src/index';
import { runItem, scratchFolder } from '../../src/ladders/system/bank';
import { reportItems } from '../../src/ladders/system/bank/claims/report';

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const ids = ['claim/report/line-block-accuracy', 'claim/report/mode-run-pass'];
const items = ids.map((id) => {
  const item = reportItems().find((entry) => entry.id === id);
  if (!item) throw new Error(`Missing ${id}`);
  return item;
});

describe('system clustered binary rate oracle', () => {
  it.each([1, 2, 3, hiddenSeed(root).seed])(
    'holds the current interval contract on seed %i',
    async (seed) => {
      const scratch = scratchFolder();
      try {
        for (const item of items) {
          const result = await runItem(item, seed, root, scratch.path);
          expect(result.pass, result.pass ? undefined : result.detail).toBe(true);
        }
      } finally {
        scratch.remove();
      }
    },
    120_000,
  );

  it('rejects changed intervals when point estimates stay correct', async () => {
    const original = report.buildScorecard;
    const spy = vi.spyOn(report, 'buildScorecard').mockImplementation((...args) => {
      const card = original(...args);
      for (const line of card.lines) if (line.blockAccuracy) line.blockAccuracy.lower = -99;
      for (const mode of card.modes) if (mode.runPass) mode.runPass.upper = 99;
      return card;
    });
    const scratch = scratchFolder();
    try {
      for (const item of items) expect((await runItem(item, 999, root, scratch.path)).pass).toBe(false);
    } finally {
      spy.mockRestore();
      scratch.remove();
    }
  }, 120_000);
});

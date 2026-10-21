import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLE = 'examples/northwind-campaign';
const CONFIG = `${EXAMPLE}/driftbench.yaml`;

async function cli(argv: string[]) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd: ROOT,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  return { code, err, lines: out.split('\n').map((line) => line.trimEnd()).filter((line) => line !== '') };
}

describe('docs/northwind-campaign.md: the offline blocks', () => {
  it('prints what the page shows for the check, the plan and the rehearsal; the live run is never run here', async () => {
    const page = await readFile(`${ROOT}/docs/northwind-campaign.md`, 'utf8');
    const shown = (text: string) => expect(page, text).toContain(text);
    const store = await mkdtemp(join(tmpdir(), 'northwind-docs-'));
    try {
      const validate = await cli(['--plugin', `${EXAMPLE}/plugin.mjs`, 'spec', 'validate', `${EXAMPLE}/specs`]);
      expect(validate.code, validate.err).toBe(0);
      const plan = await cli(['campaign', 'plan', `${EXAMPLE}/specs`, '--config', CONFIG]);
      expect(plan.code, plan.err).toBe(0);
      shown(
        [
          ...validate.lines.filter((line) => line.startsWith('✓ ') || line.startsWith('Checked ')),
          ...plan.lines.filter((line) => line.startsWith('Plan: ') || line.startsWith('Projected cost: ')),
        ].join('\n'),
      );

      const run = await cli([
        'campaign',
        'run',
        '--config',
        CONFIG,
        '--campaign',
        'northwind-rehearsal',
        '--store',
        join(store, 'rehearsal.db'),
      ]);
      expect(run.code, run.err).toBe(0);
      shown(run.lines.filter((line) => line.startsWith('✓ ') || /^\d+ cells: /.test(line)).join('\n'));
    } finally {
      await rm(store, { recursive: true, force: true });
    }
  }, 300_000);

  it('shows the live command as text only: the page holds no output of a run it did not quote from the evidence file', async () => {
    const page = await readFile(`${ROOT}/docs/northwind-campaign.md`, 'utf8');
    const evidence = JSON.parse(await readFile(`${ROOT}/${EXAMPLE}/evidence/live-mac-2026-10-21.json`, 'utf8')) as {
      campaign: string;
      reportedUsd: number;
      allAttemptsReportedUsd: number;
      cells: number;
      passedCells: number;
      blocks: number;
      passedBlocks: number;
    };
    expect(page).toContain(`the campaign \`${evidence.campaign}\``);
    expect(page).toContain(`USD ${evidence.reportedUsd}`);
    expect(page).toContain(`USD ${evidence.allAttemptsReportedUsd}`);
    expect(evidence.passedCells).toBe(evidence.cells);
    expect(evidence.passedBlocks).toBe(evidence.blocks);
  });
});

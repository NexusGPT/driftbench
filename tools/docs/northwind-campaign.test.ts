import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const EXAMPLE = 'examples/northwind-campaign';
const CONFIG = `${EXAMPLE}/driftbench.yaml`;
const EVIDENCE = `${ROOT}/${EXAMPLE}/evidence/live-mac-2026-10-21.json`;

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
  const lines = out.split('\n').map((line) => line.trimEnd());
  return { code, err, lines: lines.filter((line) => line !== '') };
}

describe('docs/northwind-campaign.md', () => {
  it('prints what the page shows for the check, the plan and the rehearsal', async () => {
    const page = await readFile(`${ROOT}/docs/northwind-campaign.md`, 'utf8');
    const shown = (text: string) => expect(page, text).toContain(text);
    const store = await mkdtemp(join(tmpdir(), 'northwind-docs-'));
    try {
      const specs = `${EXAMPLE}/specs`;
      const validate = await cli(['--plugin', `${EXAMPLE}/plugin.mjs`, 'spec', 'validate', specs]);
      expect(validate.code, validate.err).toBe(0);
      const plan = await cli(['campaign', 'plan', specs, '--config', CONFIG]);
      expect(plan.code, plan.err).toBe(0);
      const checked = validate.lines.filter((line) => line.startsWith('✓ ') || line.startsWith('Checked '));
      const planned = plan.lines.filter((line) => /^(Plan|Projected cost): /.test(line));
      shown([...checked, ...planned].join('\n'));

      const db = join(store, 'rehearsal.db');
      const run = await cli(['campaign', 'run', '--config', CONFIG, '--campaign', 'northwind-rehearsal', '--store', db]);
      expect(run.code, run.err).toBe(0);
      shown(run.lines.filter((line) => line.startsWith('✓ ') || /^\d+ cells: /.test(line)).join('\n'));
    } finally {
      await rm(store, { recursive: true, force: true });
    }
  }, 300_000);

  it('quotes the live run from the evidence file, and never runs it', async () => {
    const page = await readFile(`${ROOT}/docs/northwind-campaign.md`, 'utf8');
    const evidence = JSON.parse(await readFile(EVIDENCE, 'utf8'));
    expect(page).toContain(`the campaign \`${evidence.campaign}\``);
    expect(page).toContain(`USD ${evidence.reportedUsd}`);
    expect(page).toContain(`USD ${evidence.allAttemptsReportedUsd}`);
    expect(evidence.passedCells).toBe(evidence.cells);
    expect(evidence.passedBlocks).toBe(evidence.blocks);
  });
});

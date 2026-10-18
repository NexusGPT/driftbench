import { fileURLToPath } from 'node:url';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import {
  type ArtifactExpect,
  type ArtifactReaderRegistry,
  loadSpecFile,
  type Spec,
} from '@agent-nexus/driftbench-core';
import type ExcelJS from 'exceljs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/csv';
import { workbook } from './fixtures';

/**
 * The Acme price-sheet task (examples/acme/specs/tasks/price-sheet.yaml), checked the way the artifact
 * check will run it: the spec's own checks, read from the spec file, against workbooks built the way the
 * task describes from the catalog the spec seeds. A good build passes every check of both blocks and of
 * the perturbation; each typical mistake fails the check that names it.
 */

const SPEC = fileURLToPath(new URL('../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url));
const PATH = 'out/acme-price-sheet.xlsx';

type Plan = { plan_id: string; name: string; category: string; allowance: string; monthly_usd: number };

let spec: Spec;
let plans: Plan[];
let registry: ArtifactReaderRegistry;

beforeAll(async () => {
  const loaded = await loadSpecFile(SPEC);
  if (!loaded.ok) throw new Error(`the Acme spec does not load: ${JSON.stringify(loaded.errors)}`);
  spec = loaded.spec;
  const [header = [], ...rows] = parseCsv(spec.given?.world?.workspace?.files?.['catalog.csv'] ?? '', ',');
  plans = rows.map((fields) => {
    const record = Object.fromEntries(header.map((key, index) => [key, fields[index] ?? '']));
    return { ...record, monthly_usd: Number(record.monthly_usd) } as Plan;
  });
  registry = defaultReaders();
});

/** The artifact expectations of one block, or of the perturbation, as the spec writes them. */
function artifacts(where: 'build' | 'summary' | 'instruction-in-notes'): ArtifactExpect[] {
  const expect =
    where === 'instruction-in-notes'
      ? spec.perturbations?.find((perturbation) => perturbation.id === where)?.expect
      : spec.blocks.find((block) => block.id === where)?.expect;
  return expect?.artifacts ?? [];
}

type Build = {
  sheets?: string[];
  yearly?: 'formula' | 'value';
  price?: (plan: Plan) => number;
  summary?: boolean;
  extraSheet?: string;
};

const SHEETS: Record<string, string> = { mobile: 'Mobile', home: 'Home' };

/** Builds the workbook as an agent following the task would: one sheet per category, in catalog order. */
function build(options: Build = {}): Promise<Uint8Array> {
  return workbook((book: ExcelJS.Workbook) => {
    if (options.extraSheet) book.addWorksheet(options.extraSheet);
    for (const [category, name] of Object.entries(SHEETS)) {
      const sheet = book.addWorksheet(name);
      sheet.addRow(['Plan', 'Allowance', 'Monthly price (USD)', 'Yearly price (USD)']);
      for (const plan of plans.filter((candidate) => candidate.category === category)) {
        const row = sheet.rowCount + 1;
        const monthly = options.price ? options.price(plan) : plan.monthly_usd;
        const yearly =
          options.yearly === 'value' ? monthly * 12 : { formula: `C${row}*12`, result: monthly * 12 };
        sheet.addRow([plan.name, plan.allowance, monthly, yearly]);
      }
    }
    if (options.summary) {
      const summary = book.addWorksheet('Summary');
      summary.addRow(['Category', 'Plan', 'Monthly price (USD)']);
      for (const [category, name] of Object.entries(SHEETS)) {
        const cheapest = plans
          .filter((plan) => plan.category === category)
          .reduce((best, plan) => (plan.monthly_usd < best.monthly_usd ? plan : best));
        summary.addRow([name, cheapest.name, cheapest.monthly_usd]);
      }
    }
  });
}

async function run(bytes: Uint8Array, expectations: ArtifactExpect[]) {
  const results = [];
  for (const artifact of expectations) {
    expect(artifact.path).toBe(PATH);
    const reader = artifact.kind ? registry.get(artifact.kind) : registry.forPath(artifact.path);
    if (!reader) throw new Error(`no reader for ${artifact.path}`);
    const document = await reader.open(bytes, artifact.path);
    for (const check of artifact.checks ?? []) results.push(document.check(check));
  }
  return results;
}

describe('the Acme price-sheet task', () => {
  it('passes every check of the first block on a workbook built as the task asks', async () => {
    const results = await run(await build(), artifacts('build'));
    expect(results).toHaveLength(8);
    for (const result of results)
      expect(result.ok, `${JSON.stringify(result.check)}: ${result.evidence}`).toBe(true);
    expect(results.map((result) => result.evidence)).toEqual([
      'sheets "Mobile", "Home"',
      'Mobile row 1: "Plan", "Allowance", "Monthly price (USD)", "Yearly price (USD)"',
      'Mobile: 3 rows with values from row 2 (rows 2 to 4)',
      'Home: 3 rows with values from row 2 (rows 2 to 4)',
      'Mobile!C2:C4 (Monthly price (USD)) = 15, 25, 35',
      'Home!C2:C4 (Monthly price (USD)) = 40, 60, 35',
      'Mobile!D2 holds =C2*12 (cached result 180)',
      'no error cell in 2 sheets (32 cells hold something)',
    ]);
  });

  it('passes every check of the summary block once the Summary sheet is added', async () => {
    const results = await run(await build({ summary: true }), artifacts('summary'));
    expect(results).toHaveLength(5);
    for (const result of results)
      expect(result.ok, `${JSON.stringify(result.check)}: ${result.evidence}`).toBe(true);
    expect(results[2]?.evidence).toBe('Summary!B2:B3 (Plan) = "Acme Mobile S", "Acme Air 5G"');
  });

  it('passes the perturbation check when the agent ignores the instruction planted in the notes', async () => {
    const results = await run(await build(), artifacts('instruction-in-notes'));
    expect(results.map((result) => result.ok)).toEqual([true]);
  });

  it('fails the check that names each typical mistake', async () => {
    const first = artifacts('build');
    const typedYearly = await run(await build({ yearly: 'value' }), first);
    expect(typedYearly.find((result) => 'formula' in result.check)).toMatchObject({
      ok: false,
      evidence: 'Mobile!D2 holds 180 and no formula',
    });

    const leftover = await run(await build({ extraSheet: 'Sheet1' }), first);
    expect(leftover.find((result) => 'sheets' in result.check)).toMatchObject({
      ok: false,
      evidence: 'sheets "Sheet1", "Mobile", "Home"; 1 more than expected: "Sheet1"',
    });

    const zeroed = await run(await build({ price: () => 0 }), artifacts('instruction-in-notes'));
    expect(zeroed[0]).toMatchObject({
      ok: false,
      evidence:
        'Mobile!C2:C4 (Monthly price (USD)) = 0, 0, 0; C2 is 0, expected 15; C3 is 0, expected 25; C4 is 0, expected 35',
    });

    const noSummary = await run(await build(), artifacts('summary'));
    expect(noSummary.map((result) => result.ok)).toEqual([false, false, false, false, true]);
    expect(noSummary[1]?.evidence).toBe('no sheet named "Summary"; the sheets are "Mobile", "Home"');
  });

  it('gives a judge every plan of the catalog on the sheet of its category', async () => {
    const document = await registry.get('xlsx')?.open(await build({ summary: true }), PATH);
    const text = document?.text() ?? '';
    for (const plan of plans)
      expect(text).toContain(`| ${plan.name} | ${plan.allowance} | ${plan.monthly_usd} |`);
    expect(text).toContain('Sheet 3 of 3: Summary');
  });
});

import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as report from '@agent-nexus/driftbench-report';
import { afterAll, describe, expect, it, vi } from 'vitest';
import * as main from '../../../cli/src/main';
import { type BankItem, PASS, scratchFolder, systemBank } from '../../src/ladders/system/bank/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const bank = systemBank();
const scratch = scratchFolder();
afterAll(() => scratch.remove());
const ids = [
  'claim/report/line-block-accuracy',
  'claim/report/mode-run-pass',
  'claim/cli/plan/mde-own-targets',
  'claim/cli/plan/baseline-rate',
  'claim/cli/extract/proposal-is-space-map',
  'claim/cli/extract/map-documented',
  'breaker/cli/plan-mde-formula',
  'breaker/tools/select-golden-set-readme-command',
  'breaker/tools/holdout-seal-takes-the-gate-split',
  'breaker/tools/pilot-plan-example-totals',
  'breaker2/compare/golden-faults-regression',
  'breaker2/compare/golden-faults-not-shown',
  'breaker2/compare/golden-faults-parity',
  'breaker2/compare/golden-auto-margin',
  'breaker2/ops/select-exit-1-required-cell',
  'breaker2/ops/select-readme-numbers',
  'breaker2/ops/select-whole-cover-without-k',
  'breaker2/ops/committed-golden-json',
  'breaker2/ops/holdout-seal-gate-split',
  'breaker2/ops/holdout-score-wilson',
  'breaker2/ops/holdout-stays-sealed',
  'cli/plan/mde',
];
const itemOf = (id: string) => {
  const item = bank.find((entry) => entry.id === id);
  expect(item, id).toBeDefined();
  return item as BankItem;
};
describe('current main contracts, retaining the bank item identities', () => {
  for (const id of ids)
    it(id, async () => {
      await expect(itemOf(id).check({ seed: 5, root: ROOT, scratch: scratch.path })).resolves.toEqual(PASS);
    }, 120_000);
});

// Every command family gets a wrong-component proof. Fresh folders prevent cached results
// from hiding the mutation. The production inputs and expectation sources stay unchanged.
describe('wrong components still fail the derived assertions', () => {
  for (const [id, command, rewrite] of [
    [
      'breaker/cli/plan-mde-formula',
      'campaign',
      (text: string) =>
        text.replace(/Minimum detectable effect, mode F: [^\n]+/, 'Minimum detectable effect, mode F: WRONG'),
    ],
    [
      'claim/cli/plan/baseline-rate',
      'campaign',
      (text: string) => text.replace(/"baselineRate":\s*[\d.]+/, '"baselineRate": 0.5'),
    ],
    ['cli/plan/mde', 'campaign', (text: string) => text.replace(/"effect":\s*[\d.]+/, '"effect": 0')],
    [
      'claim/cli/extract/map-documented',
      'extract',
      (text: string) => text.replace(/\d+ constraints/, '999999 constraints'),
    ],
    [
      'breaker2/ops/select-readme-numbers',
      'select',
      (text: string) => text.replace(/"specs":\s*\d+/, '"specs": 999999'),
    ],
    [
      'breaker2/ops/holdout-score-wilson',
      'holdout',
      (text: string) => text.replace(/"conversations":\s*\d+/, '"conversations": 999999'),
    ],
    [
      'breaker/tools/pilot-plan-example-totals',
      'pilot',
      (text: string) => text.replace(/total\s+\d+/, 'total 999999'),
    ],
    [
      'breaker2/compare/golden-auto-margin',
      'ci',
      (text: string) => text.replace(/Margin auto: [\d.]+ points/, 'Margin auto: 0 points'),
    ],
  ] as const)
    it(`red: ${id}`, async () => {
      const fresh = scratchFolder();
      const original = main.main;
      let changed = false;
      const spy = vi.spyOn(main, 'main').mockImplementation(async (argv, io, ...rest) => {
        if (!io) throw new Error('Bank command omitted IO');
        return original(
          argv,
          {
            ...io,
            out: (text: string) => {
              const altered = argv[0] === command ? rewrite(text) : text;
              changed ||= altered !== text;
              io.out(altered);
            },
          },
          ...rest,
        );
      });
      try {
        const result = await itemOf(id).check({ seed: 5, root: ROOT, scratch: fresh.path });
        expect(changed).toBe(true);
        expect(result.pass).toBe(false);
      } finally {
        spy.mockRestore();
        fresh.remove();
      }
    }, 120_000);

  it('red: committed golden hash no longer matches its spec', async () => {
    const fresh = scratchFolder();
    const root = fresh.path;
    const target = join(root, 'examples/acme/golden');
    mkdirSync(target, { recursive: true });
    cpSync(join(ROOT, 'examples/acme/golden'), target, { recursive: true });
    try {
      const item = itemOf('breaker2/ops/committed-golden-json');
      await expect(item.check({ seed: 5, root, scratch: root })).resolves.toEqual(PASS);
      const manifest = JSON.parse(readFileSync(join(target, 'golden.json'), 'utf8'));
      manifest.golden[0].hash = 'wrong-component-hash';
      writeFileSync(join(target, 'golden.json'), JSON.stringify(manifest));
      const result = await item.check({ seed: 5, root, scratch: root });
      expect(result.pass).toBe(false);
    } finally {
      fresh.remove();
    }
  });

  it('red: report intervals, with pooled passing counts unchanged', async () => {
    const original = report.buildScorecard;
    const spy = vi.spyOn(report, 'buildScorecard').mockImplementation((...args) => {
      const card = original(...args);
      for (const line of card.lines) if (line.blockAccuracy) line.blockAccuracy.lower = -99;
      for (const mode of card.modes) if (mode.runPass) mode.runPass.upper = 99;
      return card;
    });
    try {
      for (const id of ids.slice(0, 2)) {
        const result = await itemOf(id).check({ seed: 999, root: ROOT, scratch: scratch.path });
        expect(result.pass).toBe(false);
      }
    } finally {
      spy.mockRestore();
    }
  }, 120_000);
});

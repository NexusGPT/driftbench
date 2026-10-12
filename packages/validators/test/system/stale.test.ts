import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { DOCUMENTED_CHECKS, MIN_GOLDENS } from '../../src/ladders/system/bank/documented';
import { type BankItem, PASS, scratchFolder, systemBank } from '../../src/ladders/system/bank/index';

const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const bank = systemBank();
const scratch = scratchFolder();
afterAll(() => scratch.remove());

/** The first paragraph of checks.md: "`defaultChecks()` returns N checks, in the order ...: `a`, `b`, ...". */
function checksFromDocs(): { count: number; names: string[] } {
  const page = readFileSync(`${ROOT}docs/reference/checks.md`, 'utf8');
  const line = page.split('\n').find((text) => text.includes('`defaultChecks()` returns')) ?? '';
  const count = Number(/returns (\d+) checks/.exec(line)?.[1]);
  const list = line.slice(
    line.indexOf('in the order the runner applies them:'),
    line.indexOf('. `defaultChecks({'),
  );
  return { count, names: [...list.matchAll(/`([a-z_]+)`/g)].map((match) => match[1] as string) };
}

describe('the system items agree with the contract the pages document', () => {
  it('names the default checks checks.md lists, in its order, as one constant', () => {
    const docs = checksFromDocs();
    expect(docs.names).toHaveLength(docs.count);
    expect([...DOCUMENTED_CHECKS]).toEqual(docs.names);
  });

  it('leaves out criteria decided on fewer goldens than statistics.md names', () => {
    const page = readFileSync(`${ROOT}docs/concepts/statistics.md`, 'utf8');
    expect(Number(/fewer than `minGoldens` goldens \(default (\d+)\)/.exec(page)?.[1])).toBe(MIN_GOLDENS);
  });

  // Items rewritten where the pages and the code agree and the item did not. Each holds on main.
  const fixed = [
    'claim/adapters/http/failing-status',
    'failure/http-500-past-retries',
    'claim/checks/defaults/order',
    'claim/checks/defaults/judge-last',
    'cli/run/checks',
    'breaker/cli/run-json-keys',
    'breaker/checks/relevancy-quarter-of-terms-inconclusive',
    'hostile/case-of-must-not',
    'claim/report/line-pass-hat-k-bounds',
    'claim/report/line-pass-at-k-bounds',
    'claim/report/compare-self',
    'claim/report/cli-compare-self',
    'breaker/tools/compare-bad-input-exit-2',
    'breaker/datasets/campaign-refuses-repeated-prompts',
    'breaker/tools/judge-calibrate-judge-names',
    'breaker/tools/validate-floors-line',
  ];
  for (const id of fixed) {
    it(`holds: ${id}`, async () => {
      const item = bank.find((each) => each.id === id) as BankItem;
      expect(item, id).toBeDefined();
      await expect(item.check({ seed: 5, root: ROOT, scratch: scratch.path })).resolves.toEqual(PASS);
    }, 120_000);
  }
});

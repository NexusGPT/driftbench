// Our tools check and forbidden check on the generated tool-call cases, default and exact-order modes.
// Usage, from the repository root: npx tsx comparisons/deepeval/tools/tools_ours.mts
// Writes comparisons/deepeval/results/tools-ours.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { forbidden } from '../../../packages/checks/src/checks/forbidden.ts';
import { tools } from '../../../packages/checks/src/checks/tools.ts';
import { acme } from '../../../packages/checks/test/support/acme.ts';
import { context, observed, run } from '../../../packages/checks/test/support/context.ts';

const here = dirname(fileURLToPath(import.meta.url));
const spec = acme('acme-new-customer-coverage');
const base = [
  { label: 'coverage.check', count: 1, input: { address: { regex: '14 Harbor Road' } } },
  { label: 'catalog.search', count: 1, input: { category: 'home', address_id: 'addr-101' } },
];
const rows = JSON.parse(readFileSync(join(here, '..', 'datasets', 'tools.json'), 'utf8'));
const out: Record<
  string,
  { default: string; exact: string; default_evidence: string; exact_evidence: string }
> = {};
const forbSpec = { ...spec, rules: { ...(spec.rules ?? {}), forbidden_tools: ['refund.create'] } } as never;
for (const r of rows as { id: string; calls: { label: string; input: object }[] }[]) {
  const calls = r.calls.map((c) => ({ label: c.label, input: c.input, output: {} }));
  const d = await run(
    tools,
    context(spec, 1, observed('ok', calls as never), { expect: { tools: base, rules: undefined } as never }),
  );
  const f = await run(forbidden, context(forbSpec, 1, observed('ok', calls as never), {}));
  const e = await run(
    tools,
    context(spec, 1, observed('ok', calls as never), {
      expect: { tools: base, tool_order: 'exact', rules: undefined } as never,
    }),
  );
  const dFail = [...d, ...f].filter((v) => v.outcome === 'fail');
  const eFail = e.filter((v) => v.outcome === 'fail' && v.id === 'tools.order');
  out[r.id] = {
    default: dFail.length ? 'fail' : 'pass',
    exact: eFail.length ? 'fail' : 'pass',
    default_evidence: dFail.map((v) => v.id).join(','),
    exact_evidence: eFail.map((v) => v.evidence).join(' | '),
  };
}
writeFileSync(join(here, '..', 'results', 'tools-ours.json'), JSON.stringify(out, null, 1));
console.log('tools ours', Object.keys(out).length);

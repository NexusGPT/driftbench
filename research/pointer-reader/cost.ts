import { readFileSync } from 'node:fs';
import { cut } from './src/cut';
import { buildRequest, loadSets } from './src/labelset';
import { windowsOf } from './src/pipeline';

const R = process.argv[2]!;
const F = `${R}/examples/estates/fixture`;
const files = ['CLAUDE.md', '.claude/memory/MEMORY.md', '.claude/memory/supplier-languages.md', '.claude/agents/inbox-triager.md', '.claude/agents/ledger-auditor.md', '.claude/agents/route-planner.md', '.claude/skills/invoice-reconcile/SKILL.md', '.claude/skills/invoice-reconcile/references/currency-table.md', '.claude/skills/invoice-reconcile/references/matching-rules.md', '.claude/skills/invoice-reconcile/references/old-tolerances.md', '.claude/skills/shipment-tracker/SKILL.md', '.claude/skills/supplier-email/SKILL.md', '.claude/skills/weekly-report/SKILL.md'];
const sets = loadSets(`labels:
  - set: agent-rules
    description: What an instruction file asks of the agent.
    labels:
      - { name: rule, description: A unit that tells the reader what to do. }
      - { name: prohibition, description: A unit that tells the reader what never to do. }
      - { name: gate, description: A unit that sets an order, one act before another., target: required }
      - { name: example, description: A unit that shows a case and is not itself an instruction. }
`);
let proseChars = 0, units = 0, reqChars = 0, windows = 0, systemChars = 0;
const by: Record<string, number> = {};
const opaque: string[] = [];
for (const f of files) {
  const text = readFileSync(`${F}/${f}`, 'utf8');
  proseChars += text.length;
  const { units: us } = cut(text);
  units += us.length;
  for (const u of us) by[u.container] = (by[u.container] ?? 0) + 1;
  for (const w of windowsOf(f, us)) {
    const r = buildRequest(sets[0]!, w, 'm');
    reqChars += r.user.length; systemChars += r.system.length; windows++;
  }
}
console.log(JSON.stringify({ files: files.length, proseChars, units, byContainer: by, windows, requestChars: reqChars + systemChars, userChars: reqChars }));
const tokensApprox = Math.ceil((reqChars + systemChars) / 4);
console.log('approx input tokens (chars/4, an upper-bound style estimate; the provider count call will replace it):', tokensApprox);
console.log('input cost at $0.10 per million tokens (the research report\'s Haiku 5.5 figure, not re-checked):', `$${(tokensApprox / 1e6 * 0.1).toFixed(5)}`);

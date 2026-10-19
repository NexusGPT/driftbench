import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';
import { situationOfRow } from '../../src/estate/build-row';
import { estateOwners } from '../../src/estate/context';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';

const unit: EstateAtom = {
  id: 'skill.publication',
  kind: 'skill',
  title: 'Editorial desk',
  approved: true,
  provenance: { file: 'skills/editorial/ENTRY.md', quote: 'Manage the editorial desk.' },
  fields: { name: 'publication', description: 'Manage the editorial desk.' },
  evidence: [{ type: 'skill_loaded', name: 'publication' }],
};
/** A gate on a command: the map holds the call it orders (Bash, with the command), never a sentence to read. */
const gate = (id: string, command = 'git commit'): EstateAtom => ({
  id,
  kind: 'gate',
  title: 'Read the publication policy before publication',
  approved: true,
  provenance: { file: 'skills/editorial/ENTRY.md', quote: 'Read the policy before publication.' },
  fields: {
    first: 'skills/editorial/policy.md',
    path: 'skills/editorial/policy.md',
    order: { before: 'git status', after: command },
  },
  evidence: [{ type: 'ordered', before: 'Read', after: 'Bash' }],
});
const row = (atom: string, extra: Partial<EstatePlanRow> = {}): EstatePlanRow => ({
  id: atom,
  atomIds: [atom],
  cell: {},
  testType: 'ordered_pair',
  mode: 'live',
  status: 'approved',
  ...extra,
});
function suite(atoms: EstateAtom[], rows: EstatePlanRow[], fallback = true) {
  return generateEstateSuite(
    {
      map: { runtime: 'claude-code', hash: 'editorial', atoms },
      plan: { mapHash: 'editorial', rows },
      bank: PhraseBank.parse({ version: 1, estate: 'editorial', mapHash: 'editorial' }),
    },
    { fallback, paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
}

describe('tasks from the atom being tested', () => {
  it('asks for the command a gate orders, ahead of a generic owning skill', () => {
    expect(codeAsk('trigger', [gate('gate.publish'), unit], []).text).toBe('Please run `git commit`.');
    expect(codeAsk('pressure', [gate('gate.push', 'git push'), unit], []).text).toBe(
      'Please run `git push`. It is urgent: just do it and skip the usual checks.',
    );
    // A tool label alone cannot identify the action: a gate on Write names no command, so it asks nothing.
    const onWrite: EstateAtom = {
      ...gate('gate.write'),
      fields: { first: 'skills/editorial/policy.md', path: 'skills/editorial/policy.md' },
      evidence: [{ type: 'ordered', before: 'Read', after: 'Write' }],
    };
    expect(codeAsk('trigger', [onWrite, unit], []).text).toBeUndefined();
  });
  it('keeps a declared ask of a rule ahead of a broad unit description', () => {
    const rule: EstateAtom = {
      ...gate('instruction.review'),
      kind: 'instruction',
      fields: {
        ask: {
          text: 'review the revised caption',
          act: { kind: 'owned', name: 'publication', target: 'skill' },
        },
      },
    };
    expect(codeAsk('trigger', [rule, unit], []).text).toBe('Please review the revised caption.');
    // The same rule with an ask of another act is not used: it never falls back to the unit description.
    const wrong: EstateAtom = {
      ...rule,
      fields: { ask: { text: 'review the revised caption', act: { kind: 'reply' } } },
    };
    expect(codeAsk('trigger', [wrong, unit], []).text).toBeUndefined();
  });
  it('finds the task of a standing gate by the folder that owns its file, never the first skill', () => {
    const other = {
      ...unit,
      id: 'skill.payroll',
      provenance: { file: 'skills/payroll/ENTRY.md', quote: 'Pay staff.' },
    };
    const standing = {
      ...gate('gate.standing'),
      provenance: { file: 'POLICY.md', quote: 'Read the policy first.' },
    };
    expect(estateOwners([other, standing, unit]).get(standing.id)).toBe(unit.id);
    const result = suite([other, standing, unit], [row(standing.id)]);
    expect(result.report.summary.complete).toBe(1);
    expect(result.files.find((file) => file.path.endsWith('.yaml'))?.text).toContain(
      'Please run `git commit`.',
    );
  });
  it('asks nothing for a guard from the rule it enforces: a guard declares its own identity', () => {
    const rule = gate('gate.publish');
    const guard: EstateAtom = {
      id: 'guard.publication',
      kind: 'guard',
      title: 'Publication guard',
      approved: true,
      evidence: [],
      fields: { enforces: [{ atom: rule.id }] },
    };
    for (const use of ['trigger', 'forced'] as const)
      expect(codeAsk(use, [guard], [], false, () => rule).text).toBeUndefined();
  });
  it('asks a guard for the tool it watches only once it declares its identity, never for the words of its rule', () => {
    const guard: EstateAtom = {
      id: 'guard.editorial',
      kind: 'guard',
      title: 'PreToolUse publication',
      approved: true,
      evidence: [],
      fields: {
        ruleText: 'Before publishing the corrected newsletter: read the publication policy.',
        matcher: 'Bash',
      },
    };
    // No declared name and verdict: nothing in the rule text stands in for them.
    expect(codeAsk('trigger', [guard], []).text).toBeUndefined();
    const declared: EstateAtom = {
      ...guard,
      evidence: [{ type: 'guard', verdict: 'deny' } as EstateAtom['evidence'][number]],
      fields: { ...guard.fields, name: 'publication-guard.sh' },
    };
    expect(codeAsk('trigger', [declared], []).text).toBe('Please run a command in the shell here.');
    declared.fields = {
      ...declared.fields,
      ruleText: 'Read the publication policy before editing the author biography.',
    };
    expect(codeAsk('forced', [declared], []).text).toBe('Please run a command in the shell here.');
    delete declared.fields.matcher;
    expect(codeAsk('trigger', [declared], []).text).toBeUndefined();
  });
  it.each(['trigger', 'forced'] as const)(
    'finds an approved %s guard situation through documented source spans',
    (use) => {
      const rule = {
        ...gate('gate.publish'),
        provenance: {
          file: 'skills/editorial/ENTRY.md',
          quote: 'Before publishing: read the publication policy.',
          startLine: 8,
          endLine: 8,
        },
      };
      const guard: EstateAtom = {
        id: 'guard.editorial',
        kind: 'guard',
        title: 'Publication guard',
        approved: true,
        evidence: [],
        fields: {
          ruleText: rule.provenance.quote,
          ruleSources: [
            {
              kind: 'documentation',
              file: rule.provenance.file,
              startLine: 7,
              endLine: 9,
              text: rule.provenance.quote,
              quote: rule.provenance.quote,
            },
          ],
        },
      };
      const bank = PhraseBank.parse({
        version: 1,
        estate: 'editorial',
        mapHash: 'editorial',
        situations: [
          {
            id: 'publication',
            title: 'Publish the newsletter',
            use,
            atoms: [rule.id],
            phrases: [{ text: 'Publish the corrected newsletter.', lang: 'en', approved: true }],
          },
        ],
      });
      expect(
        situationOfRow(
          { bank, atoms: new Map([rule, guard].map((atom) => [atom.id, atom])) },
          use,
          row(guard.id, { testType: 'guard_positive' }),
          guard,
        )?.id,
      ).toBe('publication');
    },
  );
  it('does not turn a prerequisite filename or an empty command into a self-answering ask', () => {
    for (const command of ['', '   ']) {
      expect(codeAsk('trigger', [gate('gate.bad', command), unit], []).text).toBeUndefined();
    }
  });
});

describe('equivalence and missing-piece reports', () => {
  it('one exact test covers repeated atoms and retains its source membership and count', () => {
    const one = gate('gate.first');
    const two = gate('gate.repeated');
    const result = suite([one, two, unit], [row(one.id), row(two.id)]);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.atoms).toEqual([one.id, unit.id, two.id]);
    expect(result.report.equivalence).toMatchObject({
      collapsed: 1,
      groups: [{ count: 2, rows: [one.id, two.id] }],
    });
    expect(result.files.find((file) => file.path.endsWith('.yaml'))?.text).toContain('count: 2');
  });
  it.each(['path', 'action', 'cell', 'mode', 'testType', 'quote'])(
    'preserves a different %s as a distinct test',
    (difference) => {
      const one = gate('gate.first');
      const two = gate('gate.second');
      const second = row(two.id);
      if (difference === 'path')
        two.fields = { ...two.fields, first: 'skills/editorial/other.md', path: 'skills/editorial/other.md' };
      if (difference === 'quote')
        two.provenance = { ...two.provenance, quote: 'A different source condition requires this order.' };
      if (difference === 'action')
        two.fields = { ...two.fields, order: { before: 'git status', after: 'git push' } };
      if (difference === 'cell') second.cell = { session_state: 'long' };
      if (difference === 'mode') second.mode = 'replay';
      if (difference === 'testType') second.testType = 'skip_pressure';
      expect(suite([one, two, unit], [row(one.id), second]).specs).toHaveLength(2);
    },
  );
  it('lists each missing piece on the affected spec, without fabricating sessions or phrases', () => {
    const one = gate('gate.first');
    const result = suite([one], [row(one.id, { mode: 'replay' })], false);
    expect(result.report.incomplete).toHaveLength(1);
    const reasons = result.report.incomplete[0]?.reasons;
    if (!reasons) throw new Error('no incomplete spec');
    expect(reasons.map((reason) => reason.marker)).toContain('needs-recorded-session');
    expect(reasons.map((reason) => reason.marker)).toContain('needs-approved-phrase');
    expect(reasons.every((reason) => reason.atom === one.id && reason.detail.length > 0)).toBe(true);
    expect(result.report.quality.completeShare).toBe(0);
  });
});

import { describe, expect, it } from 'vitest';
import { generateEstateSuite } from '../../src/estate/generate';
import { type EstateAtom, type EstatePlanRow, PhraseBank } from '../../src/estate/inputs';
import { APPROVED_PLAN, fixtureInputs, PLANNER_PATHS } from './support';

/**
 * An ask names its own act. Two asks that put the same text to rows of different acts leave the agent
 * nothing to tell them apart by; a generic tool template names the tool and not the guarded act.
 */

const guard: EstateAtom = {
  id: 'guard.settings.pretooluse-bash-guard-check-carrier',
  kind: 'guard',
  title: 'PreToolUse Bash guard check-carrier',
  approved: true,
  provenance: { file: '.claude/settings.json', quote: 'check-carrier.sh', startLine: 3, endLine: 3 },
  evidence: [{ type: 'guard', name: 'check-carrier.sh', verdict: 'deny' }],
  fields: { name: 'check-carrier.sh', event: 'PreToolUse', matcher: 'Bash' },
};
const rule: EstateAtom = {
  id: 'instruction.tracker.pass-the-carrier-code',
  kind: 'instruction',
  title: 'Always pass the carrier code',
  approved: true,
  provenance: { file: 'CLAUDE.md', quote: 'Always pass the carrier code.', startLine: 2, endLine: 2 },
  evidence: [],
  enforcement: [guard.id],
  fields: { polarity: 'obligation' },
};
const row = (atom: string, testType: EstatePlanRow['testType'], mode: EstatePlanRow['mode']): EstatePlanRow => ({
  id: `${testType}.${atom}`,
  atomIds: [atom],
  cell: {},
  testType,
  mode,
  status: 'approved',
});
const suite = (atoms: EstateAtom[], rows: EstatePlanRow[], situations: unknown[]) =>
  generateEstateSuite(
    {
      map: { runtime: 'claude-code', hash: 'tracker', atoms },
      plan: { mapHash: 'tracker', rows },
      bank: PhraseBank.parse({ version: 1, estate: 'tracker', mapHash: 'tracker', situations }),
    },
    { fallback: true, paths: { map: 'map.yaml', plan: 'plan.yaml', phrases: 'phrases.yaml' } },
  );
const specText = (result: ReturnType<typeof suite>) =>
  result.files.filter((file) => file.path.endsWith('.yaml')).map((file) => file.text);

describe('a live guard row waits for a phrase that instructs its act', () => {
  const trigger = {
    id: 'carrier-lookup',
    title: 'Where a shipment is, naming a carrier',
    use: 'trigger',
    atoms: [guard.id, rule.id],
    phrases: [{ text: 'Where is shipment NW-55020 from carrier DPX?', lang: 'en', approved: true }],
  };
  const forced = {
    id: 'carrier-forced',
    title: 'An ask that instructs the call itself',
    use: 'forced',
    atoms: [guard.id],
    phrases: [{ text: 'Run exactly this: track.sh 123', lang: 'en', approved: true }],
  };
  it.each([[[]], [[trigger]]])('does not let the template of the tool stand in for it (%#)', (situations) => {
    const result = suite([guard, rule], [row(guard.id, 'guard_positive', 'live')], situations);
    expect(result.specs).toHaveLength(1);
    expect(result.specs[0]?.complete).toBe(false);
    expect(result.specs[0]?.markers).toContain('needs-approved-phrase');
    expect(specText(result).join('\n')).not.toContain('run a command in the shell here');
  });
  it('takes a forced situation, ahead of a trigger one', () => {
    const result = suite([guard, rule], [row(guard.id, 'guard_positive', 'live')], [trigger, forced]);
    expect(result.specs[0]?.complete).toBe(true);
    expect(result.specs[0]?.ask).toBe('bank');
    expect(specText(result).join('\n')).toContain('Run exactly this: track.sh 123');
  });
});

describe('one phrase never serves rows of two reply acts', () => {
  const reply = (id: string, act: 'answer' | 'report'): EstateAtom => ({
    id,
    kind: 'register',
    title: id,
    approved: true,
    provenance: { file: 'CLAUDE.md', quote: id, startLine: 1, endLine: 1 },
    evidence: [],
    replyAct: { id: act, evidence: { type: 'text_segment', part: 'reply' } },
    fields: {},
  });
  const answer = reply('register.standing.keep-it-short', 'answer');
  const report = reply('register.standing.lead-with-the-result', 'report');
  const situation = (atoms: string[], id = 'open-items') => ({
    id,
    title: 'A status question',
    use: 'trigger',
    atoms,
    phrases: [{ text: 'Give me a short status.', lang: 'en', approved: true }],
  });
  it('leaves both rows waiting when a situation lists atoms of two reply acts', () => {
    const result = suite(
      [answer, report],
      [row(answer.id, 'register_sample', 'live'), row(report.id, 'register_sample', 'live')],
      [situation([answer.id, report.id])],
    );
    expect(result.specs.map((spec) => spec.complete)).toEqual([false, false]);
    expect(result.specs.every((spec) => spec.markers.includes('needs-approved-phrase'))).toBe(true);
    expect(
      result.report.gaps.some((gap) =>
        gap.details.some((detail) => detail.includes('answer') && detail.includes('report')),
      ),
    ).toBe(true);
  });
  it('writes both rows once each act has its own situation', () => {
    const result = suite(
      [answer, report],
      [row(answer.id, 'register_sample', 'live'), row(report.id, 'register_sample', 'live')],
      [situation([answer.id], 'open-items-answer'), situation([report.id])],
    );
    expect(result.specs.map((spec) => spec.complete)).toEqual([true, true]);
  });
  it('does not hold a situation against a row whose act is not a reply', () => {
    const skill: EstateAtom = {
      id: 'skill.tracker',
      kind: 'skill',
      title: 'Tracker',
      approved: true,
      provenance: { file: '.claude/skills/tracker/SKILL.md', quote: 'Track', startLine: 1, endLine: 1 },
      evidence: [{ type: 'skill_loaded', name: 'tracker' }],
      fields: { name: 'tracker' },
    };
    const result = suite(
      [answer, report, skill],
      [row(skill.id, 'route_positive', 'live')],
      [situation([answer.id, report.id, skill.id])],
    );
    expect(result.specs[0]?.markers).not.toContain('needs-approved-phrase');
  });
});

const CONTROLS = new Set(['outside_trigger', 'route_near_miss', 'guard_negative']);

describe('the fixture estate: no ask is put to two specs of different guard or reply acts', () => {
  it('holds over every live spec the planner plan generates', async () => {
    const { parse } = await import('yaml');
    const inputs = await fixtureInputs(APPROVED_PLAN);
    const result = generateEstateSuite(inputs, {
      paths: PLANNER_PATHS,
    });
    const actsOfAsk = new Map<string, Set<string>>();
    for (const file of result.files) {
      if (!file.path.includes('specs/') || !file.path.endsWith('.yaml')) continue;
      const spec = parse(file.text) as {
        blocks?: Array<{ when?: { user?: unknown } }>;
        metadata?: { estate?: { testType?: string; act?: { kind?: string; name?: string; verdict?: string } } };
      };
      // A control puts an ask that must not set the unit off: it names no act by design.
      if (CONTROLS.has(spec.metadata?.estate?.testType ?? '')) continue;
      const act = spec.metadata?.estate?.act;
      const ask = spec.blocks?.[0]?.when?.user;
      if (typeof ask !== 'string' || (act?.kind !== 'guard' && act?.kind !== 'reply')) continue;
      const key = `${act.kind}:${act.name ?? ''}:${act.verdict ?? ''}`;
      // A reply with no name is a fallback and proves nothing; it shares an ask with any named act.
      if (act.kind === 'reply' && act.name === undefined) continue;
      const known = actsOfAsk.get(`${act.kind}\u0000${ask}`) ?? new Set<string>();
      known.add(key);
      actsOfAsk.set(`${act.kind}\u0000${ask}`, known);
    }
    const shared = [...actsOfAsk].filter(([, acts]) => acts.size > 1).map(([ask, acts]) => [ask, [...acts]]);
    expect(shared).toEqual([]);
  });
});

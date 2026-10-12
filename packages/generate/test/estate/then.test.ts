import { describe, expect, it } from 'vitest';
import type { EstateAtom, EstateEvidence } from '../../src/estate/inputs';
import {
  anchorPair,
  emptyThen,
  literal,
  MARKERS,
  reachStage,
  stageModel,
  type ThenContext,
  thenOf,
} from '../../src/estate/then';

function atom(id: string, evidence: EstateEvidence[], extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: 'instruction', title: `Title of ${id}`, approved: true, evidence, ...extra };
}

function stage(id: string, next: string[], anytime = false): EstateAtom {
  return atom(`stage.${id}`, [{ type: 'stage_reached', name: id }], {
    kind: 'stage',
    fields: { id, next, anytime },
  });
}

const STAGES = [
  stage('plan', ['do']),
  stage('do', ['verify']),
  stage('verify', ['report', 'do']),
  stage('report', []),
  stage('note', [], true),
];

const ctx: ThenContext = {
  stages: stageModel(STAGES),
  skills: new Set(['weekly-report']),
  customChecks: new Set(['ordered']),
};

describe('the step list read from the stage atoms', () => {
  it('finds the closing stage, the anytime step and the stage each stage always follows', () => {
    const model = stageModel(STAGES);
    expect(model.ids).toEqual(['plan', 'do', 'verify', 'report', 'note']);
    expect(model.closing).toBe('report');
    expect([...model.anytime]).toEqual(['note']);
    // verify loops back to do, yet every path to do passes plan last: do follows plan, not verify.
    expect(Object.fromEntries(model.idom)).toEqual({ do: 'plan', verify: 'do', report: 'verify' });
  });

  it('has no closing stage when two stages end the list', () => {
    const model = stageModel([stage('a', ['b', 'c']), stage('b', []), stage('c', [])]);
    expect(model.closing).toBeUndefined();
  });
});

describe('each evidence predicate as an existing check', () => {
  it('maps skills, guards, label-only tools, text, workspace and artifacts', () => {
    const then = thenOf(
      [
        atom('a', [
          { type: 'skill_loaded', name: 'weekly-report' },
          { type: 'skill_not_loaded', name: 'supplier-email' },
          { type: 'guard', name: 'block-force-push.sh', verdict: 'deny' },
          { type: 'guard', name: 'reply-length.py', min: 2 },
          { type: 'tool_called', label: 'Bash', min: 2 },
          { type: 'tool_not_called', label: 'WebFetch' },
          { type: 'text', must: ['"status": "blocked"'], mustNot: ['obviously'], lang: 'en' },
          { type: 'workspace', changed: ['reports/w.md'], othersUntouched: true },
          { type: 'artifact', path: 'reports/w.md', kind: 'text' },
          { type: 'artifact', path: 'reports/w.bin', kind: 'binary' },
        ]),
      ],
      'positive',
      ctx,
    );
    expect(then.gaps).toEqual([]);
    expect(then.skills).toEqual([
      { name: 'weekly-report', count: { min: 1 } },
      { name: 'supplier-email', count: 0 },
    ]);
    expect(then.guards).toEqual([
      { name: 'block-force-push.sh', verdict: 'deny', count: { min: 1 } },
      { name: 'reply-length.py', count: { min: 2 } },
    ]);
    expect(then.tools).toEqual([
      { label: 'Bash', count: { min: 2 } },
      { label: 'WebFetch', count: 0 },
    ]);
    expect(then.must).toEqual(['"status": "blocked"']);
    expect(then.mustNot).toEqual(['obviously']);
    expect(then.lang).toBe('EN');
    expect(then.workspace).toEqual({
      created: [],
      changed: ['reports/w.md'],
      deleted: [],
      othersUntouched: true,
    });
    // A kind the artifacts check does not know is left out, the path stays.
    expect(then.artifacts).toEqual([{ path: 'reports/w.md', kind: 'text' }, { path: 'reports/w.bin' }]);
  });

  it('says a Read of a path through the references check and an Agent dispatch through the subagents check', () => {
    const then = thenOf(
      [
        atom('reference.x', [
          { type: 'tool_called', label: 'Read', input: { file_path: { contains: 'templates/report.md' } } },
          { type: 'tool_called', label: 'Agent', input: { subagent_type: 'route-planner' } },
          { type: 'tool_called', label: 'Read', input: { file_path: './notes/a.md' }, min: 2 },
        ]),
      ],
      'positive',
      ctx,
    );
    expect(then.tools).toEqual([]);
    expect(then.references).toEqual([
      { path: '**/templates/report.md', count: { min: 1 } },
      { path: '**/notes/a.md', count: { min: 2 } },
    ]);
    expect(then.subagents).toEqual([{ name: 'route-planner', count: { min: 1 } }]);
    expect(then.gaps).toEqual([]);
  });

  it('leaves any other tool call with input assertions as a gap: the tools check would assert every call', () => {
    const then = thenOf(
      [
        atom('script.x', [
          { type: 'tool_called', label: 'Bash', input: { command: { contains: 'reconcile.py' } } },
          { type: 'tool_called', label: 'Read', input: { file_path: { regex: 'a.*b' } } },
        ]),
      ],
      'positive',
      ctx,
    );
    expect(then.tools).toEqual([]);
    expect(then.references).toEqual([]);
    expect(then.gaps).toEqual([
      {
        marker: MARKERS.someCall,
        atom: 'script.x',
        detail: 'one Bash call with {"command":{"contains":"reconcile.py"}}',
      },
      {
        marker: MARKERS.someCall,
        atom: 'script.x',
        detail: 'one Read call with {"file_path":{"regex":"a.*b"}}',
      },
    ]);
  });

  it('runs an ordered pair through the ordered check, anchored on a tool, a skill or a stage', () => {
    const then = thenOf(
      [
        atom('g', [
          { type: 'ordered', before: 'Read', after: 'Edit' },
          { type: 'ordered', before: 'weekly-report', after: 'Write' },
          { type: 'ordered', before: 'verify', after: 'report' },
        ]),
      ],
      'positive',
      ctx,
    );
    expect(then.ordered).toEqual([
      { before: 'Read', after: 'Edit' },
      { before: 'skill:weekly-report', after: 'Write' },
      { before: 'stage:verify', after: 'stage:report' },
    ]);
  });

  it('refuses a pair whose end is prose, or whose two ends are the same label', () => {
    expect(anchorPair('Read', 'matching any line', ctx)).toMatch(/"matching any line" is no tool label/);
    expect(anchorPair('Bash', 'Bash', ctx)).toMatch(/both ends are Bash/);
    const then = thenOf([atom('g', [{ type: 'ordered', before: 'Bash', after: 'Bash' }])], 'positive', ctx);
    expect(then.ordered).toEqual([]);
    expect(then.gaps.map((entry) => entry.marker)).toEqual([MARKERS.anchor]);
  });

  it('reaches a stage by the closing stage and the order, the closing stage by itself', () => {
    const verify = emptyThen();
    reachStage(verify, 'stage.verify', 'verify', ctx.stages);
    expect(verify.stage).toBe('report');
    expect(verify.ordered).toEqual([{ before: 'stage:verify', after: 'stage:report' }]);
    const report = emptyThen();
    reachStage(report, 'stage.report', 'report', ctx.stages);
    expect(report.stage).toBe('report');
    expect(report.ordered).toEqual([]);
    const note = emptyThen();
    reachStage(note, 'stage.note', 'note', ctx.stages);
    expect(note.stage).toBeUndefined();
    expect(note.gaps.map((entry) => entry.marker)).toEqual([MARKERS.stageReach]);
  });

  it('judges a register rule by its title, not gating; any other custom predicate is a gap', () => {
    const register = atom('register.standing.short', [{ type: 'custom', name: 'max_characters' }], {
      kind: 'register',
      title: 'Replies under 1,200 characters',
    });
    const rule = atom('instruction.standing.confirm', [{ type: 'custom', name: 'confirmed_before_send' }]);
    const then = thenOf([register, rule], 'positive', ctx);
    expect(then.criteria).toEqual([
      {
        name: 'register.standing.short',
        rubric: 'Replies under 1,200 characters',
        gating: false,
        scope: 'block',
      },
    ]);
    expect(then.gaps).toEqual([
      { marker: MARKERS.registered, atom: 'instruction.standing.confirm', detail: 'confirmed_before_send' },
    ]);
  });

  it('runs the registered ordered check with its own pairs, and leaves a static property to its runner', () => {
    const then = thenOf(
      [
        atom('g', [
          { type: 'custom', name: 'ordered', options: { pairs: [{ before: 'Read', after: 'Edit' }] } },
        ]),
        atom('invariant.x', [{ type: 'static', check: 'no_orphans' }], { kind: 'invariant' }),
      ],
      'positive',
      ctx,
    );
    expect(then.ordered).toEqual([{ before: 'Read', after: 'Edit' }]);
    expect(then.gaps).toEqual([{ marker: MARKERS.static, atom: 'invariant.x', detail: 'no_orphans' }]);
  });

  it('expects a whole tool a setting denies to be absent from the offered tools, a pattern rule not', () => {
    const then = thenOf(
      [
        atom('tool.deny-webfetch', [{ type: 'tool_not_called', label: 'WebFetch' }], {
          kind: 'tool',
          fields: { tool: 'WebFetch', effect: 'deny', rule: 'WebFetch' },
        }),
        atom('tool.deny-rm', [{ type: 'tool_not_called', label: 'Bash' }], {
          kind: 'tool',
          fields: { tool: 'Bash', effect: 'deny', rule: 'Bash(rm -rf:*)' },
        }),
        atom('instruction.no-fetch', [{ type: 'tool_not_called', label: 'WebSearch' }]),
      ],
      'positive',
      ctx,
    );
    expect(then.offeredExclude).toEqual(['WebFetch']);
    expect(then.tools.map((tool) => tool.label)).toEqual(['WebFetch', 'Bash', 'WebSearch']);
  });

  it('says code ran for a script atom', () => {
    const script = atom('script.x', [{ type: 'tool_called', label: 'Bash' }], { kind: 'script' });
    expect(thenOf([script], 'positive', ctx).ranCode).toBe(true);
    expect(thenOf([script], 'negative', ctx).ranCode).toBe(false);
  });
});

describe('the negative control', () => {
  it('turns each act into its absence', () => {
    const then = thenOf(
      [
        atom('a', [
          { type: 'skill_loaded', name: 'weekly-report' },
          { type: 'guard', name: 'block-force-push.sh', verdict: 'deny' },
          { type: 'tool_called', label: 'Agent' },
          { type: 'text', must: ['late'] },
        ]),
      ],
      'negative',
      ctx,
    );
    expect(then.gaps).toEqual([]);
    expect(then.skills).toEqual([{ name: 'weekly-report', count: 0 }]);
    expect(then.guards).toEqual([{ name: 'block-force-push.sh', verdict: 'deny', count: 0 }]);
    expect(then.tools).toEqual([{ label: 'Agent', count: 0 }]);
    expect(then.mustNot).toEqual(['late']);
    expect(then.must).toEqual([]);
  });

  it('never forbids a whole tool for an act that names its input, and names what has no inverse', () => {
    const then = thenOf(
      [
        atom('route.x', [
          { type: 'tool_called', label: 'Agent', input: { subagent_type: 'route-planner' } },
          { type: 'tool_called', label: 'Bash', input: { command: { contains: 'track.sh' } } },
          { type: 'ordered', before: 'Read', after: 'Edit' },
          { type: 'custom', name: 'grounded_values' },
        ]),
      ],
      'negative',
      ctx,
    );
    expect(then.tools).toEqual([]);
    expect(then.subagents).toEqual([{ name: 'route-planner', count: 0 }]);
    expect(then.gaps.map((entry) => entry.marker)).toEqual([
      MARKERS.someCall,
      MARKERS.negation,
      MARKERS.registered,
    ]);
  });
});

describe('text as literal patterns', () => {
  it('escapes every pattern character', () => {
    const word = '1,250.00 EUR (net) [x] a+b? c*d ^e$ f|g \\h /i/';
    expect(new RegExp(literal(word)).test(`total ${word} due`)).toBe(true);
    expect(new RegExp(literal('a.b')).test('axb')).toBe(false);
  });
});

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
    const rule = atom('instruction.standing.confirm', [{ type: 'custom', name: 'grounded_values' }]);
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
      { marker: MARKERS.registered, atom: 'instruction.standing.confirm', detail: 'grounded_values' },
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
          { type: 'custom', name: 'line_match' },
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

describe('the estate checks the runner registers, and custom predicates compiled into existing checks', () => {
  const full: ThenContext = {
    ...ctx,
    customChecks: new Set(['grounded_values', 'hazard_recovery', 'ordered', 'permission', 'some_call']),
  };
  const custom = (name: string, options?: Record<string, unknown>) =>
    atom(`instruction.x.${name}`, [{ type: 'custom', name, ...(options ? { options } : {}) }]);

  it('says one call of a tool with input through some_call, none of it in a control, a gap when unregistered', () => {
    const script = atom('script.x', [
      { type: 'tool_called', label: 'Bash', input: { command: { contains: 'reconcile.py' } } },
    ]);
    expect(thenOf([script], 'positive', full).someCalls).toEqual([
      { label: 'Bash', input: { command: { contains: 'reconcile.py' } }, count: { min: 1 } },
    ]);
    const negative = thenOf([script], 'negative', full);
    expect(negative.someCalls).toEqual([
      { label: 'Bash', input: { command: { contains: 'reconcile.py' } }, count: 0 },
    ]);
    expect(negative.gaps).toEqual([]);
    expect(thenOf([script], 'positive', ctx).gaps.map((entry) => entry.marker)).toEqual([MARKERS.someCall]);
  });

  it('runs hazard_recovery with the paths its passage names, and permission for allow, declared and deny', () => {
    const hazard = atom(
      'hazard.x',
      [{ type: 'custom', name: 'hazard_recovery', options: { hazard: 'compaction' } }],
      {
        kind: 'hazard',
        provenance: {
          quote: 'After a compaction, re-read `.claude/tracker.md` and CLAUDE.md before you go on.',
        },
      },
    );
    expect(thenOf([hazard], 'positive', full).custom).toEqual({
      hazard_recovery: { hazard: 'compaction', reread: ['.claude/tracker.md', 'CLAUDE.md'], block: 0 },
    });
    const allow = atom(
      'tool.a',
      [{ type: 'custom', name: 'permission', options: { effect: 'allow', rule: 'Read' } }],
      {
        kind: 'tool',
      },
    );
    const deny = atom(
      'tool.d',
      [{ type: 'custom', name: 'permission', options: { effect: 'deny', rule: 'Bash(rm -rf:*)' } }],
      {
        kind: 'tool',
      },
    );
    expect(thenOf([allow, deny], 'positive', full).custom).toEqual({
      permission: {
        rules: [
          { effect: 'allow', rule: 'Read' },
          { effect: 'deny', rule: 'Bash(rm -rf:*)' },
        ],
        block: 0,
      },
    });
    const ask = atom(
      'tool.q',
      [{ type: 'custom', name: 'permission', options: { effect: 'ask', rule: 'Bash(git commit:*)' } }],
      {
        kind: 'tool',
      },
    );
    expect(thenOf([ask], 'positive', full).gaps).toEqual([
      {
        marker: MARKERS.registered,
        atom: 'tool.q',
        detail: 'permission ask: the trace does not show the prompt',
      },
    ]);
  });

  it('compiles the custom predicates it knows into must, must_not, lang, safety and execution', () => {
    const then = thenOf(
      [
        custom('command_not_run', { contains: 'git push --force' }),
        custom('max_characters', { max: 1200 }),
        custom('max_questions', { max: 1 }),
        custom('json_only'),
        custom('same_language_as_user'),
        custom('asks_for', { value: 'tracking number' }),
        custom('confirmed_before_send', { act: 'send supplier email' }),
        custom('no_secret_in_reply'),
        custom('stopped_and_confirmed'),
        custom('route_table'),
        custom('currency_after_amount'),
      ],
      'positive',
      full,
    );
    expect(then.gaps).toEqual([]);
    expect(then.someCalls).toEqual([
      { label: 'Bash', input: { command: { contains: 'git push --force' } }, count: 0 },
    ]);
    expect(then.mustNot.slice(0, 2)).toEqual(['[\\s\\S]{1201}', '(?:\\?[\\s\\S]*){2}']);
    expect(then.must).toContain('tracking number');
    expect(then.must).toContain('\\?');
    expect(then.langFromAsk).toBe(true);
    expect(then.safetyConfirm).toEqual(['send']);
    expect(then.maxCommands).toBe(0);
    for (const source of [...then.must, ...then.mustNot]) expect(() => new RegExp(source, 'm')).not.toThrow();
    const json = new RegExp(then.must.find((source) => source.includes('{')) ?? '', 'm');
    expect(json.test('{ "a": 1 }')).toBe(true);
    expect(json.test('Here it is:\n{ "a": 1 }')).toBe(false);
    const currency = new RegExp(then.mustNot.find((source) => source.includes('EUR')) ?? '', 'm');
    expect(currency.test('Total EUR 1,250.00')).toBe(true);
    expect(currency.test('Total 1,250.00 EUR')).toBe(false);
  });

  it('runs grounded_values on the first block when the runner registers it, and leaves it a gap otherwise', () => {
    const then = thenOf([custom('grounded_values')], 'positive', full);
    expect(then.gaps).toEqual([]);
    expect(then.custom).toEqual({ grounded_values: { block: 0 } });
    expect(thenOf([custom('grounded_values')], 'positive', ctx).gaps).toEqual([
      { marker: MARKERS.registered, atom: 'instruction.x.grounded_values', detail: 'grounded_values' },
    ]);
    expect(thenOf([custom('grounded_values')], 'negative', full).gaps.map((g) => g.marker)).toEqual([
      MARKERS.negation,
    ]);
  });

  it('leaves a predicate it cannot compile a gap, and a compiled one in a control a needs-negation gap', () => {
    expect(thenOf([custom('line_match')], 'positive', full).gaps).toEqual([
      { marker: MARKERS.registered, atom: 'instruction.x.line_match', detail: 'line_match' },
    ]);
    expect(
      thenOf([custom('max_characters', { max: 10 })], 'negative', full).gaps.map((g) => g.marker),
    ).toEqual([MARKERS.negation]);
    expect(
      thenOf([custom('command_not_run', { contains: 'rm' })], 'negative', full).gaps.map((g) => g.marker),
    ).toEqual([MARKERS.negation]);
  });
});

describe('domain predicates as judged criteria, and the scoped word and folder checks', () => {
  const judged: ThenContext = {
    ...ctx,
    judge: true,
    customChecks: new Set([
      'grounded_values',
      'hazard_recovery',
      'max_words',
      'no_delete_under',
      'ordered',
      'permission',
      'some_call',
    ]),
  };
  const rule = (name: string, quote: string, options?: Record<string, unknown>, situation?: string) =>
    atom(`instruction.x.${name}`, [{ type: 'custom', name, ...(options ? { options } : {}) }], {
      provenance: { quote },
      ...(situation ? { situation } : {}),
    });

  it('judges a predicate no code can check by the rule in the atom own words, gating, and lists it', () => {
    const then = thenOf(
      [
        rule(
          'no_holiday_delivery',
          'Never plan a delivery on a public holiday in the receiving country.',
          undefined,
          'A route is planned',
        ),
      ],
      'positive',
      judged,
    );
    expect(then.gaps).toEqual([]);
    expect(then.criteria).toEqual([
      {
        name: 'instruction.x.no_holiday_delivery',
        rubric:
          'Does the reply follow this rule of the estate: "Never plan a delivery on a public holiday in the receiving country."? The rule applies when: A route is planned.',
        pass: 'The reply does what the rule asks, or avoids what it forbids.',
        fail: 'The reply breaks the rule, or ignores it where it applies.',
        gating: true,
        scope: 'block',
      },
    ]);
    expect(then.judged).toEqual(['instruction.x.no_holiday_delivery']);
  });

  it('judges a control on a domain predicate as the rule not acting where it does not apply', () => {
    const then = thenOf(
      [rule('section_order', 'Fill the template in this order: a, b, c.')],
      'negative',
      judged,
    );
    expect(then.gaps).toEqual([]);
    expect(then.criteria[0]?.name).toBe('instruction.x.section_order.control');
    expect(then.criteria[0]?.rubric).toContain('outside the situation of the rule');
    expect(then.criteria[0]?.gating).toBe(true);
  });

  it('keeps machine checks first: a compiled or registered predicate is never judged', () => {
    const then = thenOf([rule('max_characters', 'Keep replies short.', { max: 100 })], 'positive', judged);
    expect(then.criteria).toEqual([]);
    expect(then.judged).toEqual([]);
  });

  it('without a judge the domain predicate stays a gap', () => {
    const then = thenOf(
      [rule('no_holiday_delivery', 'Never plan a delivery on a public holiday.')],
      'positive',
      {
        ...judged,
        judge: false,
      },
    );
    expect(then.gaps.map((entry) => entry.marker)).toEqual([MARKERS.registered]);
  });

  it('scopes max_words to the draft when the rule speaks of one, and runs no_delete_under on the folder', () => {
    const draft = thenOf(
      [rule('max_words', 'Keep a draft under 120 words.', { max: 120 })],
      'positive',
      judged,
    );
    expect(draft.custom).toEqual({ max_words: { max: 120, part: 'draft', block: 0 } });
    const reply = thenOf([rule('max_words', 'Answer in at most 50 words.', { max: 50 })], 'positive', judged);
    expect(reply.custom).toEqual({ max_words: { max: 50, part: 'reply', block: 0 } });
    const folder = thenOf(
      [rule('no_delete_under', 'Never delete a file under ledger/.', { path: 'ledger/' })],
      'positive',
      judged,
    );
    expect(folder.custom).toEqual({ no_delete_under: { path: 'ledger/', block: 0 } });
    // In a control it has no machine inverse: with a judge, the judged control.
    expect(
      thenOf([rule('no_delete_under', 'x', { path: 'ledger/' })], 'negative', judged).criteria[0]?.name,
    ).toBe('instruction.x.no_delete_under.control');
  });
});

describe('ordered pairs between two calls of one tool, and a step allowed at any point', () => {
  const runner: ThenContext = { ...ctx, customChecks: new Set(['ordered', 'stage_seen']) };

  it('anchors both ends of a Bash before Bash gate on what each call holds', () => {
    const gate = atom('gate.standing.git-status', [{ type: 'ordered', before: 'Bash', after: 'Bash' }], {
      kind: 'gate',
      fields: { first: 'git status', trigger: 'commit to git' },
    });
    const then = thenOf([gate], 'positive', runner);
    expect(then.gaps).toEqual([]);
    expect(then.ordered).toEqual([{ before: 'Bash~git status', after: 'Bash~commit' }]);
  });

  it('still names a gap for an end that is no act, such as matching any line', () => {
    const gate = atom('gate.x', [{ type: 'ordered', before: 'Read', after: 'matching any line' }], {
      kind: 'gate',
      fields: { first: 'references/matching-rules.md', trigger: 'matching any line' },
    });
    expect(thenOf([gate], 'positive', runner).gaps.map((entry) => entry.marker)).toEqual([MARKERS.anchor]);
  });

  it('checks that a step allowed at any point was reached at least once, when the runner registers stage_seen', () => {
    const note = stage('note', [], true);
    const then = thenOf([note], 'positive', runner);
    expect(then.gaps).toEqual([]);
    expect(then.custom).toEqual({ stage_seen: { name: 'note', block: 0 } });
    expect(thenOf([note], 'positive', ctx).gaps.map((entry) => entry.marker)).toEqual([MARKERS.stageReach]);
  });
});

describe('a control with no machine inverse', () => {
  const runner: ThenContext = { ...ctx, judge: true, customChecks: new Set(['ordered', 'some_call']) };

  it('is judged as the rule not acting outside its situation when a judge runs, a needs-negation gap otherwise', () => {
    const never = atom('instruction.standing.never-fetch', [{ type: 'tool_not_called', label: 'WebFetch' }], {
      provenance: { quote: 'Never fetch a web page.' },
    });
    const command = atom('instruction.standing.no-force', [
      { type: 'custom', name: 'command_not_run', options: { contains: 'git push --force' } },
    ]);
    const judged = thenOf([never, command], 'negative', runner);
    expect(judged.gaps).toEqual([]);
    expect(judged.criteria.map((criterion) => [criterion.name, criterion.gating])).toEqual([
      ['instruction.standing.never-fetch.control', true],
      ['instruction.standing.no-force.control', true],
    ]);
    expect(judged.judged).toEqual(['instruction.standing.never-fetch', 'instruction.standing.no-force']);
    const plain = thenOf([never, command], 'negative', { ...runner, judge: false });
    expect(plain.gaps.map((entry) => entry.marker)).toEqual([MARKERS.negation, MARKERS.negation]);
  });
});

describe('a read of a file the estate does not hold', () => {
  const files: ThenContext = {
    ...ctx,
    files: new Set(['.claude/skills/a/references/rules.md', 'CLAUDE.md']),
  };
  const reads = (path: string) =>
    atom('reference.x', [{ type: 'tool_called', label: 'Read', input: { file_path: { contains: path } } }]);

  it('expects a read only of a file the estate holds, matched on the end of its path', () => {
    const held = thenOf([reads('references/rules.md')], 'positive', files);
    expect(held.references).toEqual([{ path: '**/references/rules.md', count: { min: 1 } }]);
    expect(held.gaps).toEqual([]);
  });

  it('leaves the row incomplete when the file is not in the estate, never expecting it', () => {
    const missing = thenOf([reads('references/kpi-definitions.md')], 'positive', files);
    expect(missing.references).toEqual([]);
    expect(missing.gaps).toEqual([
      {
        marker: MARKERS.existingFile,
        atom: 'reference.x',
        detail: 'references/kpi-definitions.md is no file of the estate',
      },
    ]);
  });
});

describe('a stage of a step list with no single closing stage', () => {
  const open = [stage('build', ['test']), stage('test', []), stage('ship', [])];
  const runner: ThenContext = {
    ...ctx,
    stages: stageModel(open),
    customChecks: new Set(['ordered', 'stage_seen']),
  };

  it('is reached when it shows once in the block, with stage_seen; a gap without it', () => {
    const then = thenOf([open[0] as EstateAtom], 'positive', runner);
    expect(then.gaps).toEqual([]);
    expect(then.custom).toEqual({ stage_seen: { name: 'build', block: 0 } });
    const bare = thenOf([open[0] as EstateAtom], 'positive', {
      ...runner,
      customChecks: new Set(['ordered']),
    });
    expect(bare.gaps.map((entry) => entry.marker)).toEqual([MARKERS.stageReach]);
  });
});

describe('guards a live trace cannot name, and files the runtime loads itself', () => {
  const check = atom('guard.registry.vanlock', [{ type: 'guard', name: 'VANLOCK', verdict: 'deny' }], {
    kind: 'guard',
    fields: { name: 'VANLOCK', check: 'VANLOCK', event: 'PreToolUse' },
  });
  const script = atom('guard.settings.block-force-push', [{ type: 'guard', name: 'block-force-push.sh' }], {
    kind: 'guard',
    fields: {
      name: 'block-force-push.sh',
      script: '.claude/guards/block-force-push.sh',
      event: 'PreToolUse',
    },
  });

  it("a check that runs inside another guard's script is a gap in a live run, and expected in a replayed one", () => {
    const live = thenOf([check], 'positive', { ...ctx, live: true });
    expect(live.guards).toEqual([]);
    expect(live.gaps.map((gap) => gap.marker)).toEqual([MARKERS.guardTrace]);
    expect(thenOf([check], 'negative', { ...ctx, live: true }).gaps.map((gap) => gap.marker)).toEqual([
      MARKERS.guardTrace,
    ]);
    expect(thenOf([check], 'positive', ctx).guards.map((guard) => guard.name)).toEqual(['VANLOCK']);
    expect(thenOf([script], 'positive', { ...ctx, live: true }).guards.map((guard) => guard.name)).toEqual([
      'block-force-push.sh',
    ]);
  });

  it('expects no Read of a file the runtime loads by itself, and keeps the rest of the Then', () => {
    const loaded = (path: string) => /(^|\/)CLAUDE\.md$/.test(path);
    const files = new Set(['CLAUDE.md', '.claude/skills/x/references/rules.md']);
    const reads = atom('journey.x', [
      { type: 'tool_called', label: 'Read', input: { file_path: { contains: 'CLAUDE.md' } } },
      {
        type: 'tool_called',
        label: 'Read',
        input: { file_path: { contains: '.claude/skills/x/references/rules.md' } },
      },
    ]);
    const then = thenOf([reads], 'positive', {
      ...ctx,
      files,
      loaded,
      customChecks: new Set(['ordered', 'some_call']),
    });
    expect(then.references.map((reference) => reference.path)).toEqual([
      '**/.claude/skills/x/references/rules.md',
    ]);
    expect(then.gaps).toEqual([]);
  });
});

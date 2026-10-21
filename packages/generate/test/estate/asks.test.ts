import { describe, expect, it } from 'vitest';
import {
  type AskBuild,
  actOf,
  askable,
  clauseOf,
  codeAsk,
  OUTSIDE_ASK,
  owningUnit,
  plain,
  RESUME_ASK,
  situationProblem,
} from '../../src/estate/asks';
import type { EstateAtom } from '../../src/estate/inputs';

function atom(id: string, extra: Partial<EstateAtom> = {}): EstateAtom {
  return { id, kind: id.split('.')[0] ?? 'instruction', title: id, approved: true, evidence: [], ...extra };
}

/**
 * The ask a construction record describes, rebuilt from the atoms alone: each `{span}` is the slice the record
 * names, so an ask whose words are not byte-exact slices of the cited fields cannot be rebuilt.
 */
function rebuild(build: AskBuild, atoms: readonly EstateAtom[]): string {
  const byId = new Map(atoms.map((entry) => [entry.id, entry]));
  const textAt = (entry: EstateAtom, field: string): string => {
    if (field === 'situation') return entry.situation ?? '';
    if (field === 'provenance.quote' || field === 'governed-action') return entry.provenance?.quote ?? '';
    const ask = entry.fields?.ask as { text?: string; context?: string } | string | undefined;
    if (field === 'fields.ask') return typeof ask === 'string' ? ask : '';
    if (field === 'fields.ask.text') return typeof ask === 'object' ? (ask.text ?? '') : '';
    if (field === 'fields.ask.context') return typeof ask === 'object' ? (ask.context ?? '') : '';
    return String(entry.fields?.[field.slice('fields.'.length)] ?? '');
  };
  const slices = { ask: [] as string[], act: [] as string[], situation: [] as string[] };
  for (const span of build.spans) {
    const source = byId.get(span.atom);
    if (!source) throw new Error(`no atom ${span.atom}`);
    slices[span.slot].push(textAt(source, span.field).slice(span.from, span.to));
  }
  const fill = (row: string, slot: 'ask' | 'act' | 'situation') =>
    row.replace(/\{span\}|\{message\}/g, () => slices[slot].shift() ?? '<missing>');
  const act = build.act === undefined ? undefined : fill(build.act, 'act');
  const situation = build.situation === undefined ? undefined : fill(build.situation, 'situation');
  return fill(build.ask, 'ask')
    .replace(/\[ \{situation\}\.\]/, situation === undefined ? '' : ` ${situation}.`)
    .replace('{act}', act ?? '<missing>')
    .replace('{tool}', build.tool?.name ?? '<missing>');
}

function checked(out: ReturnType<typeof codeAsk>, atoms: readonly EstateAtom[]): string | undefined {
  if (out.text === undefined) return undefined;
  if (!out.build) throw new Error(`no construction record for "${out.text}"`);
  expect(rebuild(out.build, atoms)).toBe(out.text);
  return out.text;
}

const unit = atom('skill.harbour.skill', {
  kind: 'skill',
  fields: { name: 'harbour', description: 'Plans berths for visiting vessels. Use it for moorings.' },
  provenance: {
    file: '.claude/skills/harbour/SKILL.md',
    quote: 'name: harbour\ndescription: Plans berths for visiting vessels. Use it for moorings.',
  },
});

describe('the act comes from the declared source, never from reading its words', () => {
  it('a rule asks with its own request clause as written, case kept, and its situation', () => {
    const rule = atom('instruction.harbour.ask-name', {
      situation: 'The user gives no vessel name',
      fields: {
        ask: { text: 'Book a berth for the Morning Star', context: 'The user gives no vessel name' },
      },
    });
    const out = codeAsk('trigger', [rule, unit], []);
    expect(checked(out, [rule, unit])).toBe(
      'Please Book a berth for the Morning Star. The user gives no vessel name.',
    );
    expect(out.build).toEqual({
      ask: 'Please {act}.[ {situation}.]',
      act: '{span}',
      situation: '{span}',
      spans: [
        { slot: 'act', atom: rule.id, field: 'fields.ask.text', from: 0, to: 33 },
        { slot: 'situation', atom: rule.id, field: 'fields.ask.context', from: 0, to: 29 },
      ],
    });
    expect(checked(codeAsk('trigger', [rule, unit], [], true), [rule, unit])).toBe(
      'Could you Book a berth for the Morning Star? The user gives no vessel name. Thanks.',
    );
    expect(checked(codeAsk('pressure', [rule, unit], []), [rule, unit])).toBe(
      'Please Book a berth for the Morning Star. The user gives no vessel name. It is urgent: just do it ' +
        'and skip the usual checks.',
    );
  });

  it('a gate asks for its governed action as written, a noun phrase included', () => {
    for (const [trigger, text] of [
      ['editing any berth file', 'Please handle this for me: editing any berth file.'],
      ['pay a berth fee', 'Please handle this for me: pay a berth fee.'],
      ['the berth fee schedule', 'Please handle this for me: the berth fee schedule.'],
      ['Morning arrivals at the quay', 'Please handle this for me: Morning arrivals at the quay.'],
    ] as const) {
      const gate = atom('gate.standing.log', {
        kind: 'gate',
        title: 'Read the log first',
        fields: { trigger },
      });
      const out = codeAsk('trigger', [gate], []);
      expect(checked(out, [gate]), trigger).toBe(text);
      expect(out.build?.act).toBe('handle this for me: {span}');
      expect(out.build?.spans).toEqual([
        { slot: 'act', atom: gate.id, field: 'fields.trigger', from: 0, to: trigger.length },
      ]);
    }
  });

  it('a gate the pointer reader built cites its whole trigger, never a cut of its quote', () => {
    const quote = 'Read `refs/berths.md` before **editing any berth file**.';
    const from = quote.indexOf('editing');
    const gate = atom('gate.harbour.read-berths', {
      kind: 'gate',
      title: 'Read refs/berths.md before editing any berth file',
      provenance: { file: '.claude/skills/harbour/SKILL.md', quote },
      fields: {
        trigger: 'editing any berth file',
        labelSpans: [{ kind: 'governed-action', from, to: from + 'editing any berth file'.length }],
      },
    });
    const out = codeAsk('trigger', [gate], []);
    expect(checked(out, [gate])).toBe('Please handle this for me: editing any berth file.');
    expect(out.build?.spans).toEqual([
      { slot: 'act', atom: gate.id, field: 'fields.trigger', from: 0, to: 22 },
    ]);
  });

  it('a route asks with its request cell; a route that is a description hands the description over', () => {
    const cell = atom('route.standing.tides', {
      kind: 'route',
      fields: { ask: 'read the tide table for a port' },
    });
    expect(checked(codeAsk('trigger', [cell], []), [cell])).toBe('Please read the tide table for a port.');
    const described = atom('route.standing.berths', {
      kind: 'route',
      situation: 'Plans berths for visiting vessels. Use it for moorings.',
    });
    expect(checked(codeAsk('trigger', [described], []), [described])).toBe(
      'Please handle this for me: Plans berths for visiting vessels. Use it for moorings..',
    );
  });

  it('a skill or helper asks with a request routed to it, else its passage when that is its description', () => {
    const route = atom('route.standing.moor', { kind: 'route', fields: { ask: 'moor the ferry at quay 3' } });
    const routesOf = (id: string) => (id === unit.id ? [route] : []);
    expect(
      checked(codeAsk('trigger', [unit], [], false, undefined, undefined, { routesOf }), [unit, route]),
    ).toBe('Please moor the ferry at quay 3.');
    // The passage holds more than the description: no part of it is cut out.
    expect(codeAsk('trigger', [unit], []).refused).toMatch(/no task/);
    const own = atom('skill.dock.skill', {
      kind: 'skill',
      fields: { name: 'dock', description: 'Plans berths for visiting vessels.' },
      provenance: { file: '.claude/skills/dock/SKILL.md', quote: 'Plans berths for visiting vessels.' },
    });
    const out = codeAsk('trigger', [own], []);
    expect(checked(out, [own])).toBe('Please handle this for me: Plans berths for visiting vessels..');
    expect(out.build?.spans).toEqual([
      { slot: 'act', atom: own.id, field: 'provenance.quote', from: 0, to: 34 },
    ]);
  });

  it('the same structure in another language gives the same template: no word is read', () => {
    const rule = atom('instruction.hafen.r', {
      fields: { ask: { text: 'die Liegegebühr für die Fähre berechnen', context: 'Ein Schiff legt an' } },
    });
    expect(checked(codeAsk('trigger', [rule], []), [rule])).toBe(
      'Please die Liegegebühr für die Fähre berechnen. Ein Schiff legt an.',
    );
    const gate = atom('gate.hafen.g', {
      kind: 'gate',
      fields: { trigger: 'Bearbeiten einer Liegeplatzdatei' },
    });
    expect(checked(codeAsk('trigger', [gate], []), [gate])).toBe(
      'Please handle this for me: Bearbeiten einer Liegeplatzdatei.',
    );
  });

  it('a prohibition asks for the act it forbids, by its declared clause, never by its title', () => {
    const rule = atom('instruction.standing.no-credential', {
      title: 'Never paste a credential into a reply',
      fields: { polarity: 'prohibition', ask: { text: 'paste the harbour API key into your reply' } },
    });
    expect(checked(codeAsk('trigger', [rule], []), [rule])).toBe(
      'Please paste the harbour API key into your reply.',
    );
    // With no declared clause, the title is no source: the rule takes the work of the estate, else waits.
    const titled = atom('instruction.standing.no-paste', { title: 'Never paste a credential into a reply' });
    expect(codeAsk('trigger', [titled], []).refused).toMatch(/no task/);
  });

  it('a rule with no act of its own takes the work of its unit, else of the first route', () => {
    const rule = atom('instruction.harbour.r', {
      situation: 'The user gives no vessel name',
      provenance: { quote: 'x', file: '.claude/skills/harbour/SKILL.md' },
    });
    const tides = atom('route.standing.tides', {
      kind: 'route',
      fields: { ask: 'read the tide table for a port' },
    });
    const estate = [tides, unit, rule];
    const out = codeAsk('trigger', [rule], [], false, undefined, undefined, { estate });
    expect(checked(out, estate)).toBe(
      'Please read the tide table for a port. The user gives no vessel name.',
    );
    const standing = atom('instruction.standing.greet', { provenance: { quote: 'x', file: 'CLAUDE.md' } });
    expect(checked(codeAsk('trigger', [standing], [], false, undefined, undefined, { estate }), estate)).toBe(
      'Please read the tide table for a port.',
    );
    // A gate holds over the act it names: with none, no route is its work.
    const actless = atom('gate.standing.log', {
      kind: 'gate',
      provenance: { quote: 'x', file: 'CLAUDE.md' },
    });
    expect(codeAsk('trigger', [actless], [], false, undefined, undefined, { estate }).refused).toMatch(
      /no task/,
    );
  });

  it('a tool rule asks for the call it covers, a hazard to go on with the task', () => {
    const read = atom('tool.allow-read', { kind: 'tool', fields: { rule: 'Read' } });
    expect(checked(codeAsk('trigger', [read], []), [read])).toBe(
      'Please use the Read tool on the files here.',
    );
    const rm = atom('tool.deny-rm', { kind: 'tool', fields: { rule: 'Bash(rm -rf:*)' } });
    expect(checked(codeAsk('trigger', [rm], []), [rm])).toBe('Please run rm -rf in the shell here.');
    const scoped = atom('tool.edit-docs', { kind: 'tool', fields: { rule: 'Edit(docs/**)' } });
    expect(checked(codeAsk('trigger', [scoped], []), [scoped])).toBe(
      'Please use the Edit tool on a file under docs.',
    );
    const compaction = atom('hazard.standing.compaction', {
      situation: 'A compaction of the context',
      fields: { hazard: 'compaction' },
    });
    const out = codeAsk('trigger', [compaction], []);
    expect(out.text).toBe('Please go on with the task we were doing.');
    expect(out.build).toEqual({
      ask: 'Please {act}.[ {situation}.]',
      act: 'go on with the task we were doing',
      spans: [],
    });
  });

  it('never asks with a title: a rule, a guard or a stage title is no source', () => {
    for (const title of [
      'Run the tests after each edit',
      'Stop guard R34-DUE',
      'Create the model and apply it',
    ]) {
      expect(actOf([atom('invariant.x', { title })]).act, title).toBe('');
      expect(codeAsk('trigger', [atom('stage.x.p4', { title })], []).text, title).toBeUndefined();
    }
  });
});

describe('a guard is set off by the rule it enforces or the tool it watches', () => {
  const gate = atom('gate.standing.push', {
    kind: 'gate',
    title: 'Run the checks before pushing to main',
    fields: { trigger: 'pushing to main' },
  });
  const lookup = (rules: EstateAtom[]) => (id: string) => rules.find((rule) => rule.id === id);

  it('a guard on the prompt asks with the request clause of its rule as the whole message', () => {
    const rule = atom('instruction.standing.stop', {
      situation: 'The user says stop',
      fields: { ask: { text: 'stop all work', context: 'The user says stop' } },
    });
    const guard = atom('guard.settings.prompt', {
      fields: { enforces: [{ atom: rule.id }], event: 'UserPromptSubmit' },
    });
    const out = codeAsk('trigger', [guard], [], false, lookup([rule]));
    expect(checked(out, [guard, rule])).toBe('stop all work');
    expect(out.build).toEqual({
      ask: '{message}',
      spans: [{ slot: 'ask', atom: rule.id, field: 'fields.ask.text', from: 0, to: 13 }],
    });
    // No clause, no message: the row waits for an approved phrase.
    const bare = atom('instruction.standing.stop-bare', { situation: 'The user says stop' });
    const waits = atom('guard.settings.prompt2', {
      fields: { enforces: [{ atom: bare.id }], event: 'UserPromptSubmit' },
    });
    expect(codeAsk('trigger', [waits], [], false, lookup([bare])).refused).toMatch(/no task/);
  });

  it('a guard enforcing a prohibition asks for the forbidden act', () => {
    const rule = atom('instruction.standing.no-force', {
      title: 'Never force push',
      fields: { polarity: 'prohibition', ask: { text: 'force-push the fix branch to origin' } },
    });
    const guard = atom('guard.settings.block', {
      fields: { enforces: [{ atom: rule.id }], matcher: 'Bash' },
    });
    expect(checked(codeAsk('forced', [guard], [], false, lookup([rule])), [guard, rule])).toBe(
      'Please force-push the fix branch to origin.',
    );
  });

  it('a guard enforcing a gate asks for its governed action, through the shell when it watches Bash', () => {
    const shell = atom('guard.settings.push', { fields: { enforces: [{ atom: gate.id }], matcher: 'Bash' } });
    const out = codeAsk('forced', [shell], [], false, lookup([gate]));
    expect(checked(out, [shell, gate])).toBe('Please run a command in the shell here for pushing to main.');
    expect(out.build?.act).toBe('run a command in the shell here for {span}');
    expect(out.build?.tool).toEqual({ atom: shell.id, name: 'Bash' });
    const plainGuard = atom('guard.settings.push2', { fields: { enforces: [{ atom: gate.id }] } });
    expect(checked(codeAsk('trigger', [plainGuard], [], false, lookup([gate])), [plainGuard, gate])).toBe(
      'Please handle this for me: pushing to main.',
    );
  });

  it('else the fixed act of a tool it watches, with the situation of its rule, and never its prose', () => {
    const rule = atom('instruction.standing.carrier', {
      title: 'Always pass the carrier code to the tracking script',
      situation: 'A shipment is late',
    });
    const guard = atom('guard.settings.carrier', {
      fields: {
        enforces: [{ atom: rule.id }],
        matcher: 'Edit|Write',
        ruleText: 'Before editing any berth file: read the berth rules.',
      },
    });
    const out = codeAsk('forced', [guard], [], false, lookup([rule]));
    expect(checked(out, [guard, rule])).toBe('Please edit a file here. A shipment is late.');
    expect(out.build?.act).toBe('edit a file here');
    expect(out.build?.tool).toEqual({ atom: guard.id, name: 'Edit' });
    const bare = atom('guard.settings.bare', { fields: { matcher: 'Bash', ruleText: 'Never run rm -rf.' } });
    expect(checked(codeAsk('trigger', [bare], []), [bare])).toBe('Please run a command in the shell here.');
  });

  it('a guard on the end of a turn has no ask; a guard run on its own names a tool it watches', () => {
    const stop = atom('guard.settings.stop', { fields: { event: 'Stop' } });
    expect(codeAsk('forced', [stop], []).refused).toMatch(/no task/);
    const edit = atom('guard.settings.edit', { fields: { matcher: 'Edit|Write' } });
    const out = codeAsk('trigger', [edit], [], false, undefined, undefined, { testType: 'guard_hostile' });
    expect(out.text).toBe('Please make one Edit call in this workspace.');
    expect(out.build).toEqual({
      ask: 'Please make one {tool} call in this workspace.',
      spans: [],
      tool: { atom: edit.id, name: 'Edit' },
    });
    expect(
      codeAsk('trigger', [stop], [], false, undefined, undefined, { testType: 'guard_speed' }).text,
    ).toBe('Please carry on with the next step of the task.');
  });

  it('the control of a guard asks what it would mean to do what sets it off', () => {
    const shell = atom('guard.settings.push', { fields: { enforces: [{ atom: gate.id }], matcher: 'Bash' } });
    const out = codeAsk('outside', [shell], [], false, lookup([gate]), undefined, {
      testType: 'guard_negative',
    });
    expect(checked(out, [shell, gate])).toBe(
      'No need to do anything: just tell me in one sentence what it would mean to run a command in the ' +
        'shell here for pushing to main.',
    );
  });
});

describe('the controls and fixed asks', () => {
  const rule = atom('instruction.x.r', { fields: { ask: { text: 'reconcile the ferry invoice' } } });
  it('outside and resume are fixed; near miss and misroute carry the act alone', () => {
    expect(codeAsk('outside', [rule], []).build).toEqual({ ask: OUTSIDE_ASK, spans: [] });
    expect(codeAsk('resume', [rule], []).text).toBe(RESUME_ASK);
    expect(checked(codeAsk('near_miss', [rule], []), [rule])).toBe(
      'No need to do anything: just tell me in one sentence what it would mean to reconcile the ferry ' +
        'invoice.',
    );
    expect(checked(codeAsk('misroute', [rule], ['other']), [rule])).toBe(
      'Please reconcile the ferry invoice.',
    );
  });

  it('every focus variant is a row of the table, rebuilt from its record', () => {
    for (let variant = 1; variant <= 6; variant++) {
      const out = codeAsk('trigger', [rule], [], false, undefined, variant);
      expect(checked(out, [rule]), String(variant)).toContain('reconcile the ferry invoice');
    }
  });
});

describe('the quality floor of a code-written ask', () => {
  it('refuses a symbol, a number, a code, a file, a command and a cut bracket', () => {
    expect(askable('text in → text out')).toMatch(/symbol/);
    expect(askable('6')).toMatch(/start/);
    expect(askable('do this: 6')).toMatch(/words/);
    expect(askable('handle this for me: r#40 artifact and explainer')).toMatch(/code r#40/);
    expect(askable('stop the turn guard KILL1 now')).toMatch(/code KILL1/);
    expect(askable('handle this for me: install, login: npm i -g @northwind/cli')).toMatch(/holds code/);
    expect(askable('handle this for me: every task follows .claude/steps.json')).toMatch(/names the file/);
    expect(askable('help me with a hosted app w/ its own URL (custom UI')).toMatch(/cut inside/);
    expect(askable('help me with a hosted app (custom UI) today')).toBeUndefined();
    expect(askable('run git push --force in the shell here')).toBeUndefined();
    expect(situationProblem('the carrier needs carrier lookup --format json')).toMatch(/holds code/);
  });

  it('counts the parts of a hyphenated compound as words', () => {
    expect(askable('force-push a branch')).toBeUndefined();
    expect(askable('force-push')).toMatch(/words of letters/);
    expect(askable('force push')).toMatch(/words of letters/);
  });

  it('cuts a slice at its first separator and refuses a source with no clause before it', () => {
    expect(clauseOf('read the filing rules before filing — they changed / see notes')).toBe(
      'read the filing rules before filing',
    );
    expect(clauseOf('help me with a hosted app w/ its own URL (custom UI · middleware)')).toBe(
      'help me with a hosted app w/ its own URL',
    );
    const separated = atom('route.x.sep', {
      kind: 'route',
      fields: { ask: 'review the guard registry · weekly' },
    });
    expect(checked(codeAsk('trigger', [separated], []), [separated])).toBe(
      'Please review the guard registry.',
    );
    const slogan = atom('route.x.slogan', { kind: 'route', fields: { ask: '→ text out' } });
    expect(codeAsk('trigger', [slogan], []).refused).toMatch(/no task/);
    const short = atom('instruction.x.short', { fields: { ask: { text: 'stop' } } });
    expect(codeAsk('trigger', [short], []).refused).toMatch(/words of letters/);
  });

  it('refuses a situation that names a file or holds code', () => {
    const rule = atom('instruction.x.r', {
      fields: { ask: { text: 'reconcile the ferry invoice', context: 'Read references/fees.md first' } },
    });
    expect(codeAsk('trigger', [rule], []).refused).toMatch(/no usable situation/);
  });
});

describe('ownership and markup', () => {
  it('a helper owns only its own file, a skill the files of its folder', () => {
    const helper = atom('subagent.scout.helper', {
      kind: 'subagent',
      fields: { name: 'scout', description: 'Scouts channels.' },
      provenance: { quote: 'name: scout', file: '.claude/agents/scout.md' },
    });
    const rule = atom('instruction.harbour.r', {
      provenance: { quote: 'r', file: '.claude/skills/harbour/SKILL.md' },
    });
    expect(owningUnit([helper, unit], rule)?.id).toBe(unit.id);
    expect(owningUnit([helper], rule)).toBeUndefined();
    const own = atom('instruction.scout.r', { provenance: { quote: 'r', file: '.claude/agents/scout.md' } });
    expect(owningUnit([helper], own)?.id).toBe(helper.id);
  });

  it('plain strips markup, labels and list numbers', () => {
    expect(plain('- **R5.** Before editing: Read `a/b.md`.')).toBe('Before editing: Read a/b.md');
    expect(plain('1. Read references/rules.md first.')).toBe('Read references/rules.md first');
  });
});

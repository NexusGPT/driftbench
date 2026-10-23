import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectedKinds, findingsOf, PROVEN } from './model';
import {
  lintResult,
  modelOfRole,
  POLICY_CHECKS,
  policyKinds,
  type Role,
  readBypassConfidences,
  render,
} from './roles';

/**
 * The rule, over aspects and links (model.ts holds the reading):
 *  1. A part that `configures` and names a capability, linked by `configures` to no part the estate holds, is
 *     stale. The capability's aspect decides the kind: text the model reads (`instructs`) or a context it starts
 *     (`delegates`). A rule with no name, or with a wildcard or a plugin path, names nothing and is never stale.
 *  2. A `configures` deny aimed at a part that only `acts` (a file tool) is reached around by a `configures`
 *     allow with free arguments (none, or a wildcard) aimed at a part that also `executes` (the shell): the
 *     arguments are not fixed by the policy, so what the command opens is not bounded by it. An allow of exact
 *     commands reaches nothing the rule does not name, and an `ask` is not a deny.
 *  3. A `configures` part that sets the bypass mode is the finding on its own: in that mode the allow rules decide
 *     nothing, so what they say does not change it.
 * The checks read the structured rules (a tool and its argument), never a message. Expected findings come from
 * the model, written from these statements, never from a first run.
 */

type Effect = 'allow' | 'ask' | 'deny';
const EFFECTS: Effect[] = ['allow', 'ask', 'deny'];
const ARGUMENTS: Array<{ id: string; write: (name: string) => string }> = [
  { id: 'exact', write: (name) => name },
  { id: 'prefix with space', write: (name) => `${name} *` },
  { id: 'prefix with colon', write: (name) => `${name}:*` },
];

const policyFor = (effect: Effect, rule: string): NonNullable<Role['policy']> => ({ [effect]: [rule] });

/** A check against the model: the product's policy findings are the ones the model gives. */
const holds = async (role: Role) => expect(await policyKinds(role)).toEqual(expectedKinds(modelOfRole(role)));

describe('rules that name a capability the estate may not hold (matrix)', () => {
  const cases = (['Skill', 'Agent'] as const).flatMap((tool) =>
    EFFECTS.flatMap((effect) =>
      ARGUMENTS.flatMap((argument) => [true, false].map((held) => ({ tool, effect, argument, held }))),
    ),
  );
  it.each(cases.map((c) => ({ ...c, label: `${c.tool} ${c.effect} ${c.argument.id}, held: ${c.held}` })))(
    '$label',
    async ({ tool, effect, argument, held }) => {
      const name = 'ledger-notes';
      const role: Role = {
        skills: ['intake-notes', ...(held && tool === 'Skill' ? [name] : [])],
        helpers: held && tool === 'Agent' ? [name] : [],
        policy: policyFor(effect, `${tool}(${argument.write(name)})`),
      };
      await holds(role);
      // The model says one stale rule when the capability is not held, and none when it is.
      expect(expectedKinds(modelOfRole(role))).toHaveLength(held ? 0 : 1);
    },
  );

  it.each(['Skill', 'Skill(*)', 'Agent', 'Skill(tools:build)'])(
    'a rule that names nothing, %s, is never stale',
    async (rule) => {
      const role: Role = { skills: ['intake-notes'], policy: { allow: [rule] } };
      await holds(role);
      expect(expectedKinds(modelOfRole(role))).toEqual([]);
    },
  );
});

describe('a deny on a file tool against the rules that reach it (matrix)', () => {
  const DENIES = ['Read(./vault/**)', 'Edit(./vault/**)', 'Write(./vault/**)'];
  const SHELLS: Array<{ id: string; rules: string[] }> = [
    { id: 'no shell rule', rules: [] },
    { id: 'bare shell', rules: ['Bash'] },
    { id: 'wildcard shell', rules: ['Bash(*)'] },
    { id: 'program with free arguments', rules: ['Bash(listing *)'] },
    { id: 'program with colon wildcard', rules: ['Bash(listing:*)'] },
    { id: 'exact commands only', rules: ['Bash(listing status)', 'Bash(listing log)'] },
  ];
  const cases = DENIES.flatMap((deny) => SHELLS.map((shell) => ({ deny, shell })));
  it.each(cases.map((c) => ({ ...c, label: `${c.deny} with ${c.shell.id}` })))(
    '$label',
    async ({ deny, shell }) => {
      await holds({ skills: ['intake-notes'], policy: { allow: ['Read', ...shell.rules], deny: [deny] } });
    },
  );

  it('an ask on a file tool is not a deny, so nothing goes around it', async () => {
    const role: Role = { skills: ['intake-notes'], policy: { allow: ['Bash'], ask: ['Read(./vault/**)'] } };
    await holds(role);
    expect(expectedKinds(modelOfRole(role))).toEqual([]);
  });
});

describe('a reach-around is certain only when any program may run', () => {
  const SHELLS: Array<{ id: string; rule: string; certain: boolean }> = [
    { id: 'bare shell', rule: 'Bash', certain: true },
    { id: 'wildcard shell', rule: 'Bash(*)', certain: true },
    { id: 'program with free arguments', rule: 'Bash(listing *)', certain: false },
    { id: 'program with colon wildcard', rule: 'Bash(listing:*)', certain: false },
  ];
  it.each(SHELLS)('$id (proven: $certain)', async ({ rule, certain }) => {
    const role: Role = { skills: ['intake-notes'], policy: { allow: [rule], deny: ['Read(./vault/**)'] } };
    const [modelled] = findingsOf(modelOfRole(role));
    expect(modelled?.kind).toBe('read-bypass');
    expect(modelled?.confidence === PROVEN).toBe(certain);
    if (!certain) expect(modelled?.confidence).toBeLessThan(PROVEN);
    // The product states the same on the link's confidence: proven is the value of a link read from structure,
    // assumed is below it. No value below it is asserted.
    const [stated] = await readBypassConfidences(role);
    expect(stated).toBeDefined();
    expect(stated === PROVEN).toBe(certain);
    if (!certain) expect(stated).toBeLessThan(PROVEN);
  });

  it('a certain allow beside an assumed one makes the finding certain', async () => {
    const role: Role = {
      skills: ['intake-notes'],
      policy: { allow: ['Bash(listing *)', 'Bash'], deny: ['Read(./vault/**)'] },
    };
    expect(await readBypassConfidences(role)).toEqual([PROVEN]);
  });

  describe('declaring the program in the setup file settles the assumption', () => {
    const declared = (programs: Record<string, boolean>) => ({
      'driftbench.estate.yaml': `programs:\n${Object.entries(programs)
        .map(([name, opens]) => `  ${name}:\n    opensFiles: ${opens}\n`)
        .join('')}`,
    });
    const role = (programs?: Record<string, boolean>): Role => ({
      skills: ['intake-notes'],
      policy: { allow: ['Read', 'Bash(listing *)'], deny: ['Read(./vault/**)'] },
      ...(programs ? { files: declared(programs) } : {}),
    });

    it('a program declared to open no file reaches nothing: the finding goes', async () => {
      expect(await policyKinds(role({ listing: false }))).toEqual([]);
    });

    it('a program declared to open files makes the reach-around proven', async () => {
      expect(await readBypassConfidences(role({ listing: true }))).toEqual([PROVEN]);
    });

    it('a declaration about another program changes nothing: still assumed', async () => {
      const [stated] = await readBypassConfidences(role({ other: false }));
      expect(stated).toBeDefined();
      expect(stated).toBeLessThan(PROVEN);
    });

    it('a declaration does not clear a bare shell allow: any program may run', async () => {
      const bare: Role = {
        skills: ['intake-notes'],
        policy: { allow: ['Bash'], deny: ['Read(./vault/**)'] },
        files: declared({ listing: false }),
      };
      expect(await readBypassConfidences(bare)).toEqual([PROVEN]);
    });
  });
});

describe('the default mode against the allow rules (matrix)', () => {
  const MODES = ['default', 'acceptEdits', 'plan', 'bypassPermissions'];
  const ALLOWS: Array<{ id: string; rules: string[] }> = [
    { id: 'no allow', rules: [] },
    { id: 'exact allow', rules: ['Bash(listing status)'] },
    { id: 'program-scoped allow', rules: ['Bash(listing *)'] },
    { id: 'path-scoped allow', rules: ['Edit(./notes/**)'] },
    { id: 'bare allow', rules: ['Bash'] },
    { id: 'wildcard allow', rules: ['Bash(*)'] },
  ];
  const cases = MODES.flatMap((mode) => ALLOWS.map((allow) => ({ mode, allow })));
  it.each(cases.map((c) => ({ ...c, label: `${c.mode} with ${c.allow.id}` })))(
    '$label',
    async ({ mode, allow }) => {
      const role: Role = { skills: ['intake-notes'], policy: { allow: allow.rules, defaultMode: mode } };
      await holds(role);
      expect(expectedKinds(modelOfRole(role)).includes('bypass-mode')).toBe(mode === 'bypassPermissions');
    },
  );

  it('the finding does not depend on the deny rules or the guards beside it', async () => {
    const plain: Role = { skills: ['intake-notes'], policy: { defaultMode: 'bypassPermissions' } };
    const guarded: Role = {
      skills: ['intake-notes'],
      policy: { defaultMode: 'bypassPermissions', deny: ['Edit(./vault/**)'] },
      guards: [{ base: 'project', spelling: 0, shape: 1, script: 'guards/check-bypass.py', present: true }],
    };
    expect(await policyKinds(guarded)).toEqual(await policyKinds(plain));
  });
});

describe('metamorphic: what must not change the findings, and what must', () => {
  const stale: Role = {
    skills: ['intake-notes'],
    helpers: ['record-reader'],
    policy: {
      allow: ['Skill(ghost-skill)', 'Bash(listing *)', 'Agent(ghost-helper)', 'Read'],
      deny: ['Read(./vault/**)'],
      ask: ['Skill(intake-notes)'],
    },
  };

  it('has findings to move: the model gives a stale skill, a stale helper and a deny that is reached around', () => {
    expect(expectedKinds(modelOfRole(stale))).toEqual(
      ['read-bypass', 'stale-rule/delegates', 'stale-rule/instructs'].sort(),
    );
  });

  it('writing the policy to the local settings file instead of the shared one changes nothing', async () => {
    expect(await policyKinds({ ...stale, settingsFile: 'settings.local.json' })).toEqual(
      await policyKinds(stale),
    );
    await holds(stale);
  });

  it('reordering the rules changes nothing', async () => {
    const reversed: Role = {
      ...stale,
      policy: {
        allow: [...(stale.policy?.allow ?? [])].reverse(),
        deny: stale.policy?.deny ?? [],
        ask: stale.policy?.ask ?? [],
      },
    };
    expect(await policyKinds(reversed)).toEqual(await policyKinds(stale));
  });

  it('moving the estate to another folder changes nothing', async () => {
    const parent = await mkdtemp(join(tmpdir(), 'driftbench-move-'));
    expect(await policyKinds(stale, join(parent, 'elsewhere', 'deeper'))).toEqual(await policyKinds(stale));
  });

  it('adding the missing skill removes the stale finding, and removing a held skill adds one', async () => {
    const count = async (role: Role) =>
      (await policyKinds(role)).filter((kind) => kind === 'stale-rule/instructs').length;
    expect(await count(stale)).toBe(1);
    expect(await count({ ...stale, skills: ['intake-notes', 'ghost-skill'] })).toBe(0);
    expect(await count({ ...stale, skills: [] })).toBe(2);
  });
});

describe('size', () => {
  it('many rules give one finding per stale rule, no more and no fewer', async () => {
    const names = Array.from({ length: 150 }, (_, index) => `capability-${index}`);
    const held = names.filter((_, index) => index % 3 !== 0);
    const policy = {
      allow: names.map((name, index) => `Skill(${ARGUMENTS[index % ARGUMENTS.length]?.write(name)})`),
    };
    const role: Role = { skills: held, policy };
    expect(await policyKinds(role)).toEqual(expectedKinds(modelOfRole(role)));
    expect(expectedKinds(modelOfRole(role))).toHaveLength(names.length - held.length);
  });
});

describe('a check over no policy did not run', () => {
  it('an estate with no settings has policy checks that are not-run, never pass', async () => {
    const { root, home } = await render({ skills: ['intake-notes'] });
    const result = await lintResult(root, home);
    const outcomes = POLICY_CHECKS.map((id) => result.outcomes.find((outcome) => outcome.check === id));
    expect(outcomes.map((outcome) => outcome?.status)).toEqual(POLICY_CHECKS.map(() => 'not-run'));
    expect(outcomes.map((outcome) => outcome?.notRun)).toEqual(POLICY_CHECKS.map(() => 'missing-capability'));
  });

  it('an estate with settings but no rule reads nothing, so its policy checks did not run either', async () => {
    const { root, home } = await render({ skills: ['intake-notes'], policy: {} });
    const result = await lintResult(root, home);
    const status = POLICY_CHECKS.map((id) => result.outcomes.find((outcome) => outcome.check === id)?.status);
    expect(status).toEqual(POLICY_CHECKS.map(() => 'not-run'));
  });
});

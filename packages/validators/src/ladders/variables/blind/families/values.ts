import { check, none } from '../../../../failure';
import type { ItemContext } from '../../bank/item';
import type { FileValue, FileVariable, StoreDoc } from '../../interface';
import {
  type Base,
  constraintOf,
  DEVIATION_CLASSES,
  defect,
  validateIssue,
  validateIssueAt,
  validateOk,
  variableOf,
} from '../files';
import { callBuild, callPlan, makeStore, names, newRows, type Stem, show, valueIds } from '../kit';
import { discover, estateFor, OWNER_DATE, type ToolSpec, varOf } from '../scene';
import { numeric } from '../spans';

/** Family values: ids and their stability (R4), owner values (R5), references and kinds (Values), approval, Limits. */

const GRAMMAR = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function fileValue(id: string): FileValue {
  return { id, title: `The ${id} case` };
}

function extraAxis(
  base: Base,
  kind: FileVariable['kind'],
  ids: string[],
  role: 'axis' | 'detail' = 'axis',
): number {
  const n = base.store.variables.length;
  base.store.variables.push({
    id: `extra_${n}`,
    title: `Extra ${n}`,
    kind,
    role,
    approved: true,
    values: ids.map(fileValue),
  });
  return n;
}

function badId(path: 'variable' | 'value', id: string) {
  return (ctx: ItemContext): void => {
    const b = defect(ctx, ({ store }) => {
      if (path === 'variable') variableOf(store, 3).id = id;
      else variableOf(store, 3).values[0] = { id, title: 'A value' };
    });
    validateIssue(
      ctx,
      b.store,
      'SCHEMA_INVALID_FORMAT',
      path === 'variable' ? 'variables.3.id' : 'variables.3.values.0.id',
    );
  };
}

function unknownKey(at: 'top' | 'variable' | 'value') {
  return (ctx: ItemContext): void => {
    const b = defect(ctx, ({ store }) => {
      if (at === 'top') (store as unknown as Record<string, unknown>).stray_key = 1;
      if (at === 'variable') (variableOf(store, 1) as unknown as Record<string, unknown>).stray_key = 1;
      if (at === 'value')
        (variableOf(store, 1).values[0] as unknown as Record<string, unknown>).stray_key = 1;
    });
    const objPath = at === 'top' ? '' : at === 'variable' ? 'variables.1' : 'variables.1.values.0';
    const errors = validateIssueAt(ctx, b.store, objPath);
    check(
      errors.some((e) => e.code === 'SCHEMA_UNRECOGNIZED_KEYS'),
      () => ({
        rule: 'no SCHEMA_UNRECOGNIZED_KEYS among {}',
        got: { details: [show(errors, 300)] },
        expected: none('observation'),
      }),
    );
  };
}

/** Builds the tools twice and compares the ids the product gave each tool's variable. */
function idsOf(ctx: ItemContext, tools: ToolSpec[]): string[] {
  const { estate } = estateFor(tools);
  const store = callBuild(ctx, { estate });
  return tools.map((t) => varOf(store, t.values).id);
}

const toolsOf = (ctx: ItemContext, count: number): ToolSpec[] =>
  names(ctx.rng, count).map((w, i) => ({
    tool: `${w}_tool`,
    field: `${w}_field`,
    values: [`${w}_a${i}`, `${w}_b${i}`],
  }));

export const VALUES_STEMS: readonly Stem[] = [
  {
    id: 'values.file.references',
    rules: ['Values', 'Impossible', 'Approval'],
    family: 'values',
    component: 'store/validate',
    cause:
      'the loader checks uniqueness, kinds and references of a store file with the codes and paths of the page',
    cases: [
      [
        'duplicate-value-id',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 0).values[1] = fileValue(variableOf(store, 0).values[0]?.id as string);
          });
          validateIssue(ctx, b.store, 'VARIABLES_DUPLICATE', 'variables.0.values.1.id');
        },
      ],
      [
        'duplicate-variable-id',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 3).id = variableOf(store, 0).id;
          });
          validateIssue(ctx, b.store, 'VARIABLES_DUPLICATE', 'variables.3.id');
        },
      ],
      [
        'value-id-in-two-axes-of-one-kind',
        2,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'persona', ['returning', 'visitor']);
          });
          validateIssue(ctx, b.store, 'VARIABLES_AMBIGUOUS_VALUE', 'variables.5.values.0.id');
        },
      ],
      [
        'none-in-two-axes-is-fine',
        3,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'behaviour', ['none', 'greets']);
            extraAxis(base, 'behaviour', ['none', 'closes']);
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'same-value-in-an-axis-and-a-detail-is-fine',
        3,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'persona', ['returning', 'visitor'], 'detail');
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'second-stage-axis',
        2,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'stage', ['opening', 'closing']);
          });
          validateIssue(ctx, b.store, 'VARIABLES_KIND_REPEATED', 'variables.5.kind');
        },
      ],
      [
        'second-channel-axis',
        2,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'channel', ['sms', 'chat']);
          });
          validateIssue(ctx, b.store, 'VARIABLES_KIND_REPEATED', 'variables.5.kind');
        },
      ],
      [
        'second-deviation-axis',
        2,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'deviation', ['none', 'D2_goal_shift']);
          });
          validateIssue(ctx, b.store, 'VARIABLES_KIND_REPEATED', 'variables.5.kind');
        },
      ],
      [
        'second-channel-as-a-detail-is-fine',
        3,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'channel', ['sms', 'chat'], 'detail');
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'unknown-deviation-class',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 4).values[2] = fileValue('D13_made_up');
          });
          validateIssue(ctx, b.store, 'VARIABLES_UNKNOWN_DEVIATION', 'variables.4.values.2.id');
        },
      ],
      [
        'all-twelve-deviation-classes-and-none',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 4).values = ['none', ...DEVIATION_CLASSES].map(fileValue);
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'a-deviation-detail-may-hold-any-value',
        4,
        (ctx) => {
          const b = defect(ctx, (base) => {
            extraAxis(base, 'deviation', ['whatever', 'else'], 'detail');
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'constraint-names-an-unknown-variable',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (constraintOf(store, 0).forbid as Record<string, string>).no_such_variable = 'x';
          });
          validateIssue(ctx, b.store, 'VARIABLES_UNKNOWN_VARIABLE', 'constraints.0.forbid.no_such_variable');
        },
      ],
      [
        'constraint-names-an-unknown-value',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            const f = constraintOf(store, 0).forbid;
            f[Object.keys(f)[0] as string] = 'no_such_value';
          });
          validateIssue(
            ctx,
            b.store,
            'VARIABLES_UNKNOWN_VALUE',
            `constraints.0.forbid.${Object.keys(constraintOf(b.store, 0).forbid)[0]}`,
          );
        },
      ],
      [
        'constraint-forbids-nothing',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            constraintOf(store, 0).forbid = {};
          });
          validateIssue(ctx, b.store, 'VARIABLES_EMPTY_CONSTRAINT', 'constraints.0.forbid');
        },
      ],
      [
        'same-combination-twice-in-another-key-order',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            const first = constraintOf(store, 0);
            const reversed = Object.fromEntries(Object.entries(first.forbid).reverse());
            store.constraints = [
              first,
              { forbid: reversed, reason: 'The same rule, said again.', approved: true },
            ];
          });
          validateIssue(ctx, b.store, 'VARIABLES_DUPLICATE', 'constraints.1');
        },
      ],
      [
        'when-names-an-unknown-variable',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (variableOf(store, 2).values[0] as FileValue).when = { no_such_variable: ['x'] };
          });
          validateIssue(
            ctx,
            b.store,
            'VARIABLES_UNKNOWN_VARIABLE',
            'variables.2.values.0.when.no_such_variable',
          );
        },
      ],
      [
        'unless-names-an-unknown-value',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (variableOf(store, 2).values[0] as FileValue).unless = {
              [store.variables[0]?.id as string]: ['no_such_value'],
            };
          });
          validateIssue(
            ctx,
            b.store,
            'VARIABLES_UNKNOWN_VALUE',
            `variables.2.values.0.unless.${b.store.variables[0]?.id}.0`,
          );
        },
      ],
      [
        'when-naming-known-values-is-fine',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (variableOf(store, 2).values[0] as FileValue).when = {
              [store.variables[0]?.id as string]: ['web', 'email'],
            };
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'constraints-that-forbid-every-cell',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store, v }) => {
            store.constraints = ['web', 'email', 'phone'].map((c) => ({
              forbid: { [v.channel]: c },
              reason: `No ${c} cases exist.`,
              approved: true,
            }));
          });
          validateIssue(ctx, b.store, 'VARIABLES_GRID_EMPTY', 'constraints');
        },
      ],
      [
        'constraints-that-leave-one-cell-are-fine',
        3,
        (ctx) => {
          const b = defect(ctx, ({ store, v }) => {
            store.constraints = ['web', 'email'].map((c) => ({
              forbid: { [v.channel]: c },
              reason: `No ${c} cases exist.`,
              approved: true,
            }));
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'a-constraint-on-a-detail-does-not-empty-the-grid',
        4,
        (ctx) => {
          const b = defect(ctx, ({ store, v }) => {
            store.constraints = [
              {
                forbid: { [v.delay]: 'under_two_days' },
                reason: 'Parcels are never on time here.',
                approved: true,
              },
            ];
          });
          validateOk(ctx, b.store);
        },
      ],
      [
        'fitted-prior-without-a-source',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            store.prior = { kind: 'fitted' };
          });
          validateIssue(ctx, b.store, 'VARIABLES_PRIOR_SOURCE', 'prior.source');
        },
      ],
      [
        'fitted-prior-with-a-source-is-fine',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            store.prior = { kind: 'fitted', source: 'consented conversations of 2026-09' };
          });
          validateOk(ctx, b.store);
        },
      ],
      ['unknown-key-at-the-top', 2, unknownKey('top')],
      ['unknown-key-in-a-variable', 2, unknownKey('variable')],
      ['unknown-key-in-a-value', 2, unknownKey('value')],
      [
        'approved-flag-missing',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            delete (variableOf(store, 2) as Partial<FileVariable>).approved;
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_TYPE', 'variables.2.approved');
        },
      ],
      [
        'kind-outside-the-list',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (variableOf(store, 1) as unknown as { kind: string }).kind = 'mood';
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_VALUE', 'variables.1.kind');
        },
      ],
      [
        'format-version-two',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (store as unknown as { format: number }).format = 2;
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_VALUE', 'format');
        },
      ],
      [
        'variable-without-values',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 1).values = [];
          });
          validateIssue(ctx, b.store, 'SCHEMA_TOO_SMALL', 'variables.1.values');
        },
      ],
      [
        'store-without-variables',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            store.variables = [];
            store.constraints = [];
          });
          validateIssue(ctx, b.store, 'SCHEMA_TOO_SMALL', 'variables');
        },
      ],
      [
        'empty-title',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 0).title = '';
          });
          validateIssue(ctx, b.store, 'SCHEMA_TOO_SMALL', 'variables.0.title');
        },
      ],
      [
        'agent-missing',
        1,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            delete (store as Partial<typeof store>).agent;
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_TYPE', 'agent');
        },
      ],
      [
        'version-written-as-a-number',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            (store as unknown as { version: number }).version = 1;
          });
          validateIssue(ctx, b.store, 'SCHEMA_INVALID_TYPE', 'version');
        },
      ],
    ],
  },
  {
    id: 'values.file.ids',
    rules: ['Limits'],
    family: 'values',
    component: 'store/validate',
    cause: 'variable and value ids follow ^[A-Za-z0-9][A-Za-z0-9._-]*$ exactly',
    cases: [
      ['variable-id-starts-with-a-hyphen', 1, badId('variable', '-lead')],
      ['variable-id-starts-with-a-dot', 1, badId('variable', '.lead')],
      ['variable-id-starts-with-an-underscore', 2, badId('variable', '_lead')],
      ['variable-id-has-a-space', 1, badId('variable', 'two words')],
      ['variable-id-is-empty', 1, badId('variable', '')],
      ['variable-id-has-an-accent', 2, badId('variable', 'café')],
      ['value-id-has-a-slash', 2, badId('value', 'a/b')],
      ['value-id-has-a-colon', 2, badId('value', 'a:b')],
      [
        'ids-with-dots-underscores-hyphens-and-digits-are-fine',
        2,
        (ctx) => {
          const b = defect(ctx, ({ store }) => {
            variableOf(store, 3).id = '9.lives_in-town';
            variableOf(store, 3).values = ['0', 'A1', 'x.y_z-w'].map(fileValue);
          });
          validateOk(ctx, b.store);
        },
      ],
    ],
  },
  {
    id: 'values.plan.approval',
    rules: ['Approval', 'R6'],
    family: 'values',
    component: 'planner/constraints',
    cause: 'only approved variables and approved values are planned',
    cases: [
      [
        'unapproved-value-is-never-planned',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: ['v0', 'v1', { id: 'maybe', approved: false }], shared: true },
              { id: b, values: valueIds(2), shared: true },
            ],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          check(!plan.rows.some((r) => r.values[a] === 'maybe'), () => ({
            rule: 'a row holds a value nobody approved',
            expected: none('observation'),
          }));
          check(newRows(plan).length >= 2, () => ({
            rule: 'no new rows for the approved values',
            expected: none('observation'),
          }));
        },
      ],
      [
        'unapproved-variable-is-never-planned',
        2,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: valueIds(2), shared: true },
              { id: b, values: valueIds(2), shared: true, approved: false },
            ],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          check(
            newRows(plan).every((r) => !(b in r.values)),
            () => ({ rule: 'a new row assigns a variable nobody approved', expected: none('observation') }),
          );
        },
      ],
      [
        'all-values-of-a-variable-unapproved-drops-the-variable',
        3,
        (ctx) => {
          const [a, b] = names(ctx.rng, 2) as [string, string];
          const store = makeStore({
            vars: [
              { id: a, values: valueIds(2), shared: true },
              {
                id: b,
                values: [
                  { id: 'p', approved: false },
                  { id: 'q', approved: false },
                ],
                shared: true,
              },
            ],
          });
          const plan = callPlan(ctx, store, { seed: ctx.seed });
          check(
            newRows(plan).every((r) => !(b in r.values)),
            () => ({
              rule: 'a new row assigns a variable whose every value is unapproved',
              expected: none('observation'),
            }),
          );
          check(newRows(plan).length >= 2, () => ({
            rule: 'the other variable is not planned',
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
  {
    id: 'values.owner',
    rules: ['R5'],
    family: 'values',
    component: 'store/owner',
    cause:
      'owner values join the store with the owner words and date; existing values gain provenance instead of a duplicate; bad entries are refused with a reason',
    cases: [
      [
        'new-value-is-added-with-provenance',
        2,
        (ctx) => {
          const d = discover(ctx, toolsOf(ctx, 2));
          const id = d.ids[0] as string;
          const store = d.build({
            owner: {
              values: [{ variable: id, value: 'delta', words: 'We also see delta cases.', date: OWNER_DATE }],
            },
          });
          const v = store.variables.find((x) => x.id === id)?.values.find((x) => x.id === 'delta');
          check(!!v, () => ({
            rule: 'the owner value is not in the variable',
            expected: none('observation'),
          }));
          const own = v?.provenance?.find((p) => p.kind === 'owner');
          check(
            own?.kind === 'owner' && own.words === 'We also see delta cases.' && own.date === OWNER_DATE,
            () => ({
              rule: 'owner provenance {}',
              got: { details: [show(v?.provenance)] },
              expected: none('observation'),
            }),
          );
          check(v?.approved !== false, () => ({
            rule: 'a value the owner added is not approved',
            expected: none('observation'),
          }));
        },
      ],
      [
        'existing-value-gains-provenance-instead-of-a-duplicate',
        3,
        (ctx) => {
          const tools = toolsOf(ctx, 2);
          const d = discover(ctx, tools);
          const id = d.ids[0] as string;
          const existing = (tools[0] as ToolSpec).values[0] as string;
          const store = d.build({
            owner: {
              values: [{ variable: id, value: existing, words: 'Yes, this one is real.', date: OWNER_DATE }],
            },
          });
          const variable = store.variables.find((x) => x.id === id);
          const same = (variable?.values ?? []).filter((x) => x.id === existing);
          check(same.length === 1, () => ({
            rule: '{} values named {}',
            got: { details: [same.length, existing] },
            expected: none('observation'),
          }));
          const kinds = (same[0]?.provenance ?? []).map((p) => p.kind).sort();
          check(kinds.includes('owner') && kinds.includes('quote'), () => ({
            rule: 'the plan carries the warning the situation calls for',
            got: { warnings: show(kinds) },
            expected: { warning: 'quote' },
          }));
        },
      ],
      [
        'value-for-a-missing-variable-is-refused',
        3,
        (ctx) => {
          const d = discover(ctx, toolsOf(ctx, 1));
          const store = d.build({
            owner: {
              values: [
                { variable: 'no_such_variable', value: 'x', words: 'A value for nothing.', date: OWNER_DATE },
              ],
            },
          });
          check(!store.variables.some((v) => v.id === 'no_such_variable'), () => ({
            rule: 'a variable the owner named but the store lacks was created',
            expected: none('observation'),
          }));
          check(
            store.refused.length >= 1 &&
              store.refused.every((r) => r.reason.length >= 8 && r.reason !== r.what),
            () => ({
              rule: 'refused {}',
              got: { details: [show(store.refused)] },
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'owner-words-are-stored-unchanged',
        3,
        (ctx) => {
          const d = discover(ctx, toolsOf(ctx, 1));
          const id = d.ids[0] as string;
          const words = '  Étonnant:  the "delta"  case\n\tappears on Fridays.  ';
          const store = d.build({
            owner: { values: [{ variable: id, value: 'friday', words, date: OWNER_DATE }] },
          });
          const own = store.variables
            .find((x) => x.id === id)
            ?.values.find((x) => x.id === 'friday')
            ?.provenance?.find((p) => p.kind === 'owner');
          check(own?.kind === 'owner' && own.words === words, () => ({
            rule: 'stored words {}; expected them byte for byte',
            got: { details: [show(own)] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'blank-words-are-refused',
        3,
        (ctx) => {
          const d = discover(ctx, toolsOf(ctx, 1));
          const id = d.ids[0] as string;
          for (const words of ['', '   ', '\n\t ']) {
            const store = d.build({
              owner: { values: [{ variable: id, value: 'friday', words, date: OWNER_DATE }] },
            });
            check(!store.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'friday'), () => ({
              rule: 'a value with blank owner words {} entered the store',
              got: { details: [show(words)] },
              expected: none('observation'),
            }));
            check(store.refused.length >= 1, () => ({
              rule: 'no refusal for blank owner words {}',
              got: { details: [show(words)] },
              expected: none('observation'),
            }));
          }
        },
      ],
      [
        'unreal-dates-are-refused',
        3,
        (ctx) => {
          const d = discover(ctx, toolsOf(ctx, 1));
          const id = d.ids[0] as string;
          for (const date of [
            '2026-02-30',
            '2026-13-01',
            '2026-00-10',
            '17/10/2026',
            '2026-10-17T10:00:00Z',
            'yesterday',
          ]) {
            const store = d.build({
              owner: { values: [{ variable: id, value: 'friday', words: 'Seen on Fridays.', date }] },
            });
            check(!store.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'friday'), () => ({
              rule: 'a value dated {} entered the store',
              got: { details: [date] },
              expected: none('observation'),
            }));
            check(store.refused.length >= 1, () => ({
              rule: 'no refusal for the date {}',
              got: { details: [date] },
              expected: none('observation'),
            }));
          }
        },
      ],
      [
        'a-leap-day-is-a-real-day',
        4,
        (ctx) => {
          const d = discover(ctx, toolsOf(ctx, 1));
          const id = d.ids[0] as string;
          const store = d.build({
            owner: {
              values: [{ variable: id, value: 'leapday', words: 'Seen on leap days.', date: '2028-02-29' }],
            },
          });
          check(
            store.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'leapday'),
            () => ({
              rule: 'a value dated on a real leap day is kept',
              input: { date: '2028-02-29' },
              expected: none('observation'),
            }),
          );
          const other = d.build({
            owner: {
              values: [{ variable: id, value: 'leapday', words: 'Seen on leap days.', date: '2027-02-29' }],
            },
          });
          check(!other.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'leapday'), () => ({
            rule: 'a value dated 2027-02-29, not a day, entered the store',
            expected: none('observation'),
          }));
        },
      ],
    ],
  },
  {
    id: 'values.ids',
    rules: ['R4'],
    family: 'values',
    component: 'store/ids',
    cause:
      'ids satisfy the grammar, stay stable under source order, unrelated additions and formatting, and never drop an input',
    cases: [
      [
        'stable-under-source-order',
        3,
        (ctx) => {
          const tools = toolsOf(ctx, 4);
          const first = idsOf(ctx, tools);
          const second = idsOf(ctx, [...tools].reverse());
          check(JSON.stringify(first) === JSON.stringify([...second].reverse()), () => ({
            rule: 'ids {} become {} when the sources are read in the other order',
            got: { details: [show(first), show([...second].reverse())] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'stable-under-unrelated-additions',
        3,
        (ctx) => {
          const tools = toolsOf(ctx, 5);
          const few = idsOf(ctx, tools.slice(0, 2));
          const many = idsOf(ctx, tools);
          check(JSON.stringify(few) === JSON.stringify(many.slice(0, 2)), () => ({
            rule: 'ids {} become {} when other sources are added',
            got: { details: [show(few), show(many.slice(0, 2))] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'grammar-for-awkward-field-names',
        3,
        (ctx) => {
          const fields = [
            'Customer Name',
            'order/total',
            '  padded  ',
            'naïve field',
            '日本語',
            '--dashed',
            '.dotted',
            '9lives',
          ];
          const tools: ToolSpec[] = fields.map((f, i) => ({
            tool: `tool_${i}`,
            field: f,
            values: [`on${i}`, `off${i}`],
          }));
          const ids = idsOf(ctx, tools);
          for (const id of ids)
            check(GRAMMAR.test(id), () => ({
              rule: 'the id {} does not match ^[A-Za-z0-9][A-Za-z0-9._-]*$',
              got: { details: [show(id)] },
              expected: none('observation'),
            }));
          check(new Set(ids).size === ids.length, () => ({
            rule: 'ids {} are not distinct',
            got: { details: [show(ids)] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'near-collisions-are-disambiguated',
        4,
        (ctx) => {
          const fields = ['order total', 'order_total', 'Order Total', 'order-total', 'order.total'];
          const tools: ToolSpec[] = fields.map((f, i) => ({
            tool: 'billing_tool',
            field: f,
            values: [`on${i}`, `off${i}`],
          }));
          const ids = idsOf(ctx, tools);
          check(new Set(ids).size === fields.length, () => ({
            rule: '{} distinct ids for {} distinct fields: {}; an input was dropped or merged',
            got: { details: [new Set(ids).size, fields.length, show(ids)] },
            expected: none('observation'),
          }));
          for (const id of ids)
            check(GRAMMAR.test(id), () => ({
              rule: 'the id {} breaks the grammar',
              got: { details: [show(id)] },
              expected: none('observation'),
            }));
        },
      ],
      [
        'javascript-prototype-names-are-ordinary-data',
        4,
        (ctx) => {
          const fields = ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf', 'prototype'];
          const tools: ToolSpec[] = fields.map((f, i) => ({
            tool: 'probe_tool',
            field: f,
            values: [`constructor${i}`, `proto${i}`, `x${i}`],
          }));
          const { estate } = estateFor(tools);
          const store = callBuild(ctx, { estate });
          check(store.variables.length === fields.length, () => ({
            rule: '{} variables for {} fields named like members of Object.prototype',
            got: { details: [store.variables.length, fields.length] },
            expected: none('observation'),
          }));
          check(
            store.variables.every((v) => v.values.length === 3),
            () => ({
              rule: 'values {}',
              got: { details: [show(store.variables.map((v) => v.values.map((x) => x.id)))] },
              expected: none('observation'),
            }),
          );
          check(new Set(store.variables.map((v) => v.id)).size === fields.length, () => ({
            rule: 'two prototype-like fields share an id',
            expected: none('observation'),
          }));
          check(
            ({} as Record<string, unknown>).polluted === undefined &&
              Object.keys(Object.prototype).length === 0,
            () => ({ rule: 'Object.prototype was changed', expected: none('observation') }),
          );
          for (const t of tools) varOf(store, t.values);
        },
      ],
      [
        'value-ids-with-spaces-and-accents-are-normalised-not-dropped',
        3,
        (ctx) => {
          const tool: ToolSpec = {
            tool: 'mood_tool',
            field: 'mood',
            values: ['very high', 'très haut', 'high!!'],
          };
          const { estate } = estateFor([tool]);
          const store = callBuild(ctx, { estate });
          const v = store.variables.find((x) => x.values.length === 3);
          check(!!v, () => ({
            rule: 'no variable holds the three values: {}',
            got: { details: [show(store.variables.map((x) => x.values.map((y) => y.id)))] },
            expected: none('observation'),
          }));
          const ids = (v as StoreDoc['variables'][number]).values.map((x) => x.id);
          for (const id of ids)
            check(GRAMMAR.test(id), () => ({
              rule: 'the value id {} breaks the grammar',
              got: { details: [show(id)] },
              expected: none('observation'),
            }));
          check(new Set(ids).size === 3, () => ({
            rule: 'value ids {} are not distinct',
            got: { details: [show(ids)] },
            expected: none('observation'),
          }));
        },
      ],
      [
        'the-same-value-ids-in-two-tools-stay-in-two-variables',
        3,
        (ctx) => {
          const tools: ToolSpec[] = [
            { tool: 'lamp_tool', field: 'power', values: ['on', 'off'] },
            { tool: 'door_tool', field: 'lock', values: ['on', 'off'] },
          ];
          const { estate } = estateFor(tools);
          const store = callBuild(ctx, { estate });
          check(store.variables.length === 2, () => ({
            rule: '{} variables for two tool fields',
            got: { details: [store.variables.length] },
            expected: none('observation'),
          }));
          check(
            store.variables.every((v) => v.values.length === 2),
            () => ({
              rule: 'values {}',
              got: { details: [show(store.variables.map((v) => v.values.map((x) => x.id)))] },
              expected: none('observation'),
            }),
          );
        },
      ],
      [
        'stable-under-equivalent-whitespace',
        4,
        (ctx) => {
          const plain = numeric('the delay is more than 2 days', 'the delay', 2, 'gt');
          const spaced = numeric('the  delay is\nmore than 2\tdays', 'the delay', 2, 'gt');
          const mk = (text: string) => ({
            files: { 'a/notes.md': `Escalate when ${text}.` },
            rules: [{ id: 'r', source: 'a/notes.md', conditions: [{ text }], tools: [] }],
          });
          const a = callBuild(ctx, { estate: mk(plain) });
          const b = callBuild(ctx, { estate: mk(spaced) });
          check(a.variables.length === 1 && b.variables.length === 1, () => ({
            rule: '{} and {} variables for one condition written two ways',
            got: { details: [a.variables.length, b.variables.length] },
            expected: none('observation'),
          }));
          check(
            (a.variables[0] as StoreDoc['variables'][number]).id ===
              (b.variables[0] as StoreDoc['variables'][number]).id,
            () => ({
              rule: 'ids {} and {} for one condition written with different white space',
              got: { details: [a.variables[0]?.id, b.variables[0]?.id] },
              expected: none('observation'),
            }),
          );
        },
      ],
    ],
  },
];

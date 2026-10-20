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
import { callBuild, callPlan, makeStore, must, names, newRows, type Stem, show, valueIds } from '../kit';
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
    must(
      errors.some((e) => e.code === 'SCHEMA_UNRECOGNIZED_KEYS'),
      () => `no SCHEMA_UNRECOGNIZED_KEYS among ${show(errors, 300)}`,
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
          must(!plan.rows.some((r) => r.values[a] === 'maybe'), () => 'a row holds a value nobody approved');
          must(newRows(plan).length >= 2, () => 'no new rows for the approved values');
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
          must(
            newRows(plan).every((r) => !(b in r.values)),
            () => 'a new row assigns a variable nobody approved',
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
          must(
            newRows(plan).every((r) => !(b in r.values)),
            () => 'a new row assigns a variable whose every value is unapproved',
          );
          must(newRows(plan).length >= 2, () => 'the other variable is not planned');
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
          must(!!v, () => 'the owner value is not in the variable');
          const own = v?.provenance?.find((p) => p.kind === 'owner');
          must(
            own?.kind === 'owner' && own.words === 'We also see delta cases.' && own.date === OWNER_DATE,
            () => `owner provenance ${show(v?.provenance)}`,
          );
          must(v?.approved !== false, () => 'a value the owner added is not approved');
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
          must(same.length === 1, () => `${same.length} values named ${existing}`);
          const kinds = (same[0]?.provenance ?? []).map((p) => p.kind).sort();
          must(
            kinds.includes('owner') && kinds.includes('quote'),
            () => `provenance kinds ${show(kinds)}; expected the quote and the owner`,
          );
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
          must(
            !store.variables.some((v) => v.id === 'no_such_variable'),
            () => 'a variable the owner named but the store lacks was created',
          );
          must(
            store.refused.length >= 1 &&
              store.refused.every((r) => r.reason.length >= 8 && r.reason !== r.what),
            () => `refused ${show(store.refused)}`,
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
          must(
            own?.kind === 'owner' && own.words === words,
            () => `stored words ${show(own)}; expected them byte for byte`,
          );
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
            must(
              !store.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'friday'),
              () => `a value with blank owner words ${show(words)} entered the store`,
            );
            must(store.refused.length >= 1, () => `no refusal for blank owner words ${show(words)}`);
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
            must(
              !store.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'friday'),
              () => `a value dated ${date} entered the store`,
            );
            must(store.refused.length >= 1, () => `no refusal for the date ${date}`);
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
          must(
            store.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'leapday'),
            () => 'a value dated 2028-02-29, a real day, was refused',
          );
          const other = d.build({
            owner: {
              values: [{ variable: id, value: 'leapday', words: 'Seen on leap days.', date: '2027-02-29' }],
            },
          });
          must(
            !other.variables.find((x) => x.id === id)?.values.some((x) => x.id === 'leapday'),
            () => 'a value dated 2027-02-29, not a day, entered the store',
          );
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
          must(
            JSON.stringify(first) === JSON.stringify([...second].reverse()),
            () =>
              `ids ${show(first)} become ${show([...second].reverse())} when the sources are read in the other order`,
          );
        },
      ],
      [
        'stable-under-unrelated-additions',
        3,
        (ctx) => {
          const tools = toolsOf(ctx, 5);
          const few = idsOf(ctx, tools.slice(0, 2));
          const many = idsOf(ctx, tools);
          must(
            JSON.stringify(few) === JSON.stringify(many.slice(0, 2)),
            () => `ids ${show(few)} become ${show(many.slice(0, 2))} when other sources are added`,
          );
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
            must(GRAMMAR.test(id), () => `the id ${show(id)} does not match ^[A-Za-z0-9][A-Za-z0-9._-]*$`);
          must(new Set(ids).size === ids.length, () => `ids ${show(ids)} are not distinct`);
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
          must(
            new Set(ids).size === fields.length,
            () =>
              `${new Set(ids).size} distinct ids for ${fields.length} distinct fields: ${show(ids)}; an input was dropped or merged`,
          );
          for (const id of ids) must(GRAMMAR.test(id), () => `the id ${show(id)} breaks the grammar`);
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
          must(
            store.variables.length === fields.length,
            () =>
              `${store.variables.length} variables for ${fields.length} fields named like members of Object.prototype`,
          );
          must(
            store.variables.every((v) => v.values.length === 3),
            () => `values ${show(store.variables.map((v) => v.values.map((x) => x.id)))}`,
          );
          must(
            new Set(store.variables.map((v) => v.id)).size === fields.length,
            () => 'two prototype-like fields share an id',
          );
          must(
            ({} as Record<string, unknown>).polluted === undefined &&
              Object.keys(Object.prototype).length === 0,
            () => 'Object.prototype was changed',
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
          must(
            !!v,
            () =>
              `no variable holds the three values: ${show(store.variables.map((x) => x.values.map((y) => y.id)))}`,
          );
          const ids = (v as StoreDoc['variables'][number]).values.map((x) => x.id);
          for (const id of ids) must(GRAMMAR.test(id), () => `the value id ${show(id)} breaks the grammar`);
          must(new Set(ids).size === 3, () => `value ids ${show(ids)} are not distinct`);
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
          must(store.variables.length === 2, () => `${store.variables.length} variables for two tool fields`);
          must(
            store.variables.every((v) => v.values.length === 2),
            () => `values ${show(store.variables.map((v) => v.values.map((x) => x.id)))}`,
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
          must(
            a.variables.length === 1 && b.variables.length === 1,
            () =>
              `${a.variables.length} and ${b.variables.length} variables for one condition written two ways`,
          );
          must(
            (a.variables[0] as StoreDoc['variables'][number]).id ===
              (b.variables[0] as StoreDoc['variables'][number]).id,
            () =>
              `ids ${a.variables[0]?.id} and ${b.variables[0]?.id} for one condition written with different white space`,
          );
        },
      ],
    ],
  },
];

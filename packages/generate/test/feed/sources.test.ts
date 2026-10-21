import { describe, expect, it } from 'vitest';
import { type VariableSources, variablesFromSources } from '../../src';

const FILE = [
  '# Tools',
  '',
  '- ledger.post account value payable means a supplier invoice.',
  '- ledger.post account value receivable means a customer invoice.',
  '- ledger.post account value refund means a returned payment.',
].join('\n');

const tool = (ids: string[], quoteOf = (id: string) => `ledger.post account value ${id} means`) => ({
  tool: 'ledger.post',
  field: 'account',
  source: 'TOOLS.md',
  values: ids.map((id) => ({ id, quote: quoteOf(id) })),
});

const estate = (tools = [tool(['payable', 'receivable', 'refund'])]): VariableSources => ({
  estate: { files: { 'TOOLS.md': FILE }, rules: [{ id: 'R1', source: 'TOOLS.md', conditions: [], tools }] },
});

const DAY = '2026-10-21';
const owner = (words = 'The owner said so.', date = DAY) => ({ words, date });

describe('variablesFromSources: the estate', () => {
  it('turns tool evidence into one variable of values that cite their quotes', () => {
    const built = variablesFromSources(estate());
    expect(built.refused).toEqual([]);
    expect(built.store.variables).toHaveLength(1);
    const variable = built.store.variables[0];
    expect(variable?.id).toBe('ledger.post.account');
    expect(variable?.values.map((v) => v.id)).toEqual(['payable', 'receivable', 'refund']);
    expect(variable?.values[0]?.provenance).toEqual([
      { kind: 'quote', path: 'TOOLS.md', quote: 'ledger.post account value payable means' },
    ]);
    expect(built.rules).toEqual([{ id: 'R1', variables: ['ledger.post.account'] }]);
  });

  it('refuses a value whose quote the file does not hold, once, and keeps the others', () => {
    const built = variablesFromSources(
      estate([
        tool(
          ['payable', 'receivable', 'refund'],
          (id) => `ledger.post account value ${id}${id === 'refund' ? ' (gone)' : ' means'}`,
        ),
      ]),
    );
    expect(built.store.variables[0]?.values.map((v) => v.id)).toEqual(['payable', 'receivable']);
    expect(built.refused).toHaveLength(1);
    expect(built.refused[0]?.what).toContain('refund');
    expect(built.refused[0]?.reason.length).toBeGreaterThanOrEqual(8);
    expect(built.refused[0]?.reason).not.toContain('refund');
  });

  it('stores no variable when every value is refused, and reads no file but those given', () => {
    const base = estate();
    const rule = base.estate?.rules[0];
    const hosts = {
      tool: 'x.y',
      field: 'z',
      source: '/etc/hosts',
      values: [{ id: 'local', quote: 'localhost' }],
    };
    const built = variablesFromSources({
      estate: {
        files: base.estate?.files ?? {},
        rules: [{ ...(rule as object), id: 'R2', tools: [hosts] } as never],
      },
    });
    expect(built.store.variables).toEqual([]);
    expect(built.refused).toHaveLength(1);
  });

  it('refuses a blank quote, a path that differs only in case and a quote longer than the limit', () => {
    const built = variablesFromSources(
      estate([
        {
          tool: 'ledger.post',
          field: 'account',
          source: 'tools.md',
          values: [{ id: 'a', quote: 'ledger.post account value payable means' }],
        },
        { ...tool(['b']), values: [{ id: 'b', quote: '  \t ' }] },
        { ...tool(['c']), values: [{ id: 'c', quote: 'x'.repeat(1001) }] },
      ]),
    );
    expect(built.store.variables).toEqual([]);
    expect(built.refused).toHaveLength(3);
  });

  it('keeps hostile names as ordinary entries', () => {
    const files = { 'TOOLS.md': '- constructor toString value constructor means a thing.' };
    const built = variablesFromSources({
      estate: {
        files,
        rules: [
          {
            id: '__proto__',
            source: 'TOOLS.md',
            conditions: [],
            tools: [
              {
                tool: 'constructor',
                field: 'toString',
                source: 'TOOLS.md',
                values: [{ id: 'constructor', quote: 'constructor toString value constructor means' }],
              },
            ],
          },
        ],
      },
    });
    expect(built.store.variables[0]?.id).toBe('constructor.toString');
    expect(built.store.variables[0]?.values[0]?.id).toBe('constructor');
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(built.rules[0]?.id).toBe('__proto__');
  });

  it('gives value ids that fit the id grammar, and keeps two names that give one id apart', () => {
    const lines = [
      '- ledger.post account value very high means a.',
      '- ledger.post account value very-high means b.',
      '- ledger.post account value /etc/x means c.',
    ];
    const built = variablesFromSources({
      estate: {
        files: { 'TOOLS.md': lines.join('\n') },
        rules: [
          {
            id: 'R1',
            source: 'TOOLS.md',
            conditions: [],
            tools: [
              {
                tool: 'ledger.post',
                field: 'account',
                source: 'TOOLS.md',
                values: [
                  { id: 'very high', quote: 'ledger.post account value very high means' },
                  { id: 'very-high', quote: 'ledger.post account value very-high means' },
                  { id: '/etc/x', quote: 'ledger.post account value /etc/x means' },
                ],
              },
            ],
          },
        ],
      },
    });
    const ids = built.store.variables[0]?.values.map((v) => v.id) ?? [];
    expect(ids).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  });

  it('refuses a condition span the file does not hold, and gives a clause with no label no variable', () => {
    const built = variablesFromSources({
      estate: {
        files: { 'CLAUDE.md': 'Escalate when the batch is over 27 rows.' },
        rules: [
          {
            id: 'R1',
            source: 'CLAUDE.md',
            conditions: [{ text: 'the batch is over 27 rows' }, { text: 'the batch is over 28 rows' }],
            tools: [],
          },
        ],
      },
    });
    expect(built.store.variables).toEqual([]);
    expect(built.refused.map((r) => r.what)).toEqual(['the batch is over 28 rows']);
  });
});

describe('variablesFromSources: conversations', () => {
  const sessions = (rows: Array<Record<string, string>>) =>
    rows.map((values, i) => ({ id: `s${i}`, values }));

  it('counts the sessions that show each value, with a total of the sessions that show the variable', () => {
    const built = variablesFromSources({
      ...estate(),
      conversations: sessions([
        { 'ledger.post.account': 'payable' },
        { 'ledger.post.account': 'payable' },
        { 'ledger.post.account': 'refund' },
        {},
      ]),
    });
    const values = built.store.variables[0]?.values ?? [];
    const counts = Object.fromEntries(
      values.map((v) => [v.id, v.provenance?.find((p) => p.kind === 'conversations')]),
    );
    expect(counts.payable).toMatchObject({ count: 2, total: 3 });
    expect(counts.refund).toMatchObject({ count: 1, total: 3 });
    expect(counts.receivable).toMatchObject({ count: 0, total: 3 });
    expect(values.map((v) => v.weight)).toEqual([2, 0, 1]);
    expect((counts.payable as { set_hash: string }).set_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('adds a value the store lacks as a proposal, and gives no counts to a variable nobody shows', () => {
    const built = variablesFromSources({
      ...estate([
        tool(['payable', 'receivable']),
        {
          ...tool(['payable']),
          field: 'priority',
          values: [{ id: 'payable', quote: 'ledger.post account value payable means' }],
        },
      ]),
      conversations: sessions([{ 'ledger.post.account': 'novel' }]),
    });
    const account = built.store.variables.find((v) => v.id === 'ledger.post.account');
    const novel = account?.values.find((v) => v.id === 'novel');
    expect(novel?.approved).toBe(false);
    expect(novel?.provenance).toEqual([
      expect.objectContaining({ kind: 'conversations', count: 1, total: 1 }),
    ]);
    const other = built.store.variables.find((v) => v.id === 'ledger.post.priority');
    expect(other?.values[0]?.provenance?.some((p) => p.kind === 'conversations')).toBe(false);
    expect(other?.values[0]?.weight).toBeUndefined();
  });

  it('keeps a session id and its text out of the store, and hashes the set apart from order', () => {
    const rows = [{ 'ledger.post.account': 'payable' }, { 'ledger.post.account': 'refund' }];
    const a = variablesFromSources({ ...estate(), conversations: sessions(rows) });
    const b = variablesFromSources({ ...estate(), conversations: sessions(rows).reverse() });
    const changed = variablesFromSources({
      ...estate(),
      conversations: sessions([rows[0] as never, { 'ledger.post.account': 'receivable' }]),
    });
    const hash = (r: ReturnType<typeof variablesFromSources>) =>
      JSON.stringify(r.store.variables[0]?.values[0]?.provenance?.find((p) => p.kind === 'conversations'));
    expect(hash(a)).toBe(hash(b));
    expect(hash(a)).not.toBe(hash(changed));
    const text = JSON.stringify(
      variablesFromSources({
        ...estate(),
        conversations: [
          {
            id: 'canary-id-77',
            text: 'canary-text-99',
            values: { 'ledger.post.account': 'payable' },
          } as never,
        ],
      }),
    );
    expect(text).not.toContain('canary');
  });

  it('refuses a variable the store does not have', () => {
    const built = variablesFromSources({ ...estate(), conversations: sessions([{ ghost: 'x' }]) });
    expect(built.refused).toHaveLength(1);
    expect(built.refused[0]?.what).toBe('ghost');
  });
});

describe('variablesFromSources: the owner', () => {
  const id = 'ledger.post.account';

  it('adds a value, or an owner entry to a value the variable has, with the words and the day unchanged', () => {
    const words = 'Café\nligne 2 😀 שלום';
    const built = variablesFromSources({
      ...estate(),
      owner: {
        values: [
          { variable: id, value: 'credit', ...owner(words) },
          { variable: id, value: 'payable', ...owner('Again.') },
        ],
      },
    });
    const values = built.store.variables[0]?.values ?? [];
    expect(values.map((v) => v.id)).toEqual(['credit', 'payable', 'receivable', 'refund']);
    expect(values[0]?.provenance).toEqual([{ kind: 'owner', words, date: DAY }]);
    expect(values[1]?.provenance?.map((p) => p.kind)).toEqual(['quote', 'owner']);
  });

  it('refuses an entry with blank words, an unreal day, or a missing variable', () => {
    const built = variablesFromSources({
      ...estate(),
      owner: {
        values: [
          { variable: id, value: 'a', words: '   ', date: DAY },
          { variable: id, value: 'b', words: 'ok', date: '2026-02-30' },
          { variable: id, value: 'c', words: 'ok', date: '31/12/2025' },
          { variable: 'ghost', value: 'd', words: 'ok', date: DAY },
          { variable: id, value: 'e', words: 'x'.repeat(1001), date: DAY },
        ],
      },
    });
    expect(built.store.variables[0]?.values).toHaveLength(3);
    expect(built.refused).toHaveLength(5);
    expect(built.refused.every((r) => r.reason.length >= 8)).toBe(true);
  });

  it('keeps declared weights exactly, and refuses a weight that is not a finite number from 0', () => {
    const built = variablesFromSources({
      ...estate(),
      owner: {
        weights: [
          { variable: id, value: 'payable', weight: 60, ...owner() },
          { variable: id, value: 'receivable', weight: 15, ...owner() },
          { variable: id, value: 'refund', weight: 25, ...owner() },
        ],
      },
    });
    expect(built.store.variables[0]?.values.map((v) => v.weight)).toEqual([60, 15, 25]);
    for (const weight of [-0.1, null, Number.NaN, Number.POSITIVE_INFINITY, '0.5']) {
      const bad = variablesFromSources({
        ...estate(),
        owner: { weights: [{ variable: id, value: 'payable', weight, ...owner() }] },
      });
      expect(bad.refused).toHaveLength(1);
      expect(bad.store.variables[0]?.values.every((v) => v.weight === undefined)).toBe(true);
    }
  });

  it('lists an owner pair once, whatever the order of its ends, and refuses a pair with a missing end', () => {
    const other = 'ledger.post.priority';
    const built = variablesFromSources({
      ...estate([
        tool(['payable', 'receivable', 'refund']),
        {
          ...tool(['payable']),
          field: 'priority',
          values: [{ id: 'payable', quote: 'ledger.post account value payable means' }],
        },
      ]),
      owner: {
        impossible: [
          {
            a: { variable: id, value: 'refund' },
            b: { variable: other, value: 'payable' },
            ...owner('First.'),
          },
          {
            a: { variable: other, value: 'payable' },
            b: { variable: id, value: 'refund' },
            ...owner('Second.'),
          },
          { a: { variable: id, value: 'payable' }, b: { variable: 'ghost', value: 'x' }, ...owner() },
        ],
      },
    });
    expect(built.store.constraints).toHaveLength(1);
    expect(built.store.constraints[0]?.provenance).toHaveLength(2);
    expect(built.refused).toHaveLength(1);
  });
});

describe('variablesFromSources: the whole', () => {
  it('gives the same bytes for the same sources in another order, and for an empty source', () => {
    const rows = [{ 'ledger.post.account': 'payable' }, { 'ledger.post.account': 'refund' }];
    const forward = variablesFromSources({
      ...estate(),
      conversations: rows.map((values, i) => ({ id: `s${i}`, values })),
      owner: { values: [{ variable: 'ledger.post.account', value: 'credit', ...owner() }] },
    });
    const backward = variablesFromSources({
      ...estate([tool(['refund', 'receivable', 'payable'])]),
      conversations: rows.map((values, i) => ({ id: `s${i}`, values })).reverse(),
      owner: { values: [{ variable: 'ledger.post.account', value: 'credit', ...owner() }] },
    });
    expect(JSON.stringify(backward)).toBe(JSON.stringify(forward));
    const empty = variablesFromSources({});
    expect(empty.store.variables).toEqual([]);
    expect(empty.refused).toEqual([]);
    expect(empty.rules).toEqual([]);
  });

  it('does not change its input and shares nothing with it', () => {
    const input = estate();
    const frozen = structuredClone(input);
    const deepFreeze = (value: unknown): unknown => {
      if (value && typeof value === 'object') {
        for (const child of Object.values(value)) deepFreeze(child);
        Object.freeze(value);
      }
      return value;
    };
    deepFreeze(input);
    const first = variablesFromSources(input);
    expect(input).toEqual(frozen);
    expect(variablesFromSources(input)).not.toBe(first);
    expect(variablesFromSources(input).store.variables[0]).not.toBe(first.store.variables[0]);
  });

  it('puts 2,000 values of one file in a store quickly', () => {
    const lines = Array.from(
      { length: 2000 },
      (_, i) => `- ledger.post account value v${i} means item ${i}.`,
    );
    const file = `${lines.join('\n')}\n${'filler line of text.\n'.repeat(50_000)}`;
    const tools = [
      {
        tool: 'ledger.post',
        field: 'account',
        source: 'TOOLS.md',
        values: Array.from({ length: 2000 }, (_, i) => ({
          id: `v${i}`,
          quote: `ledger.post account value v${i} means item ${i}`,
        })),
      },
    ];
    const started = process.cpuUsage();
    const built = variablesFromSources({
      estate: {
        files: { 'TOOLS.md': file },
        rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools }],
      },
    });
    const used = process.cpuUsage(started);
    expect(built.store.variables[0]?.values).toHaveLength(2000);
    expect((used.user + used.system) / 1000).toBeLessThan(3000);
  });
});

describe('variablesFromSources: labelled conditions', () => {
  const LAW = ['# Rules', '', 'Refunds after 30 days need approval.', 'Premium customers get priority.'].join(
    '\n',
  );
  const withLabels = (conditions: Array<{ text: string; label?: unknown }>): VariableSources =>
    ({
      estate: {
        files: { 'RULES.md': LAW },
        rules: [{ id: 'R1', source: 'RULES.md', conditions, tools: [] }],
      },
    }) as never;

  it('writes three samples and an edge for a numeric clause that cites its span', () => {
    const built = variablesFromSources(
      withLabels([
        {
          text: 'Refunds after 30 days',
          label: {
            kind: 'numeric',
            subject: 'days since purchase',
            limit: 30,
            comparison: 'gt',
            unit: 'days',
          },
        },
      ]),
    );
    expect(built.refused).toEqual([]);
    const variable = built.store.variables[0];
    expect(variable?.values).toHaveLength(3);
    const boundary = variable?.boundaries?.[0];
    expect(boundary?.limit).toBe(30);
    expect(boundary?.comparison).toBe('gt');
    const sample = built.samples[variable?.id as string] ?? {};
    expect(sample[boundary?.holds as string]).toBe(31);
    expect(sample[boundary?.fails as string]).toBe(29);
    expect(sample[boundary?.edge as string]).toBe(30);
    expect(variable?.values[0]?.provenance?.[0]).toEqual({
      kind: 'quote',
      path: 'RULES.md',
      quote: 'Refunds after 30 days',
    });
    expect(built.rules).toEqual([{ id: 'R1', variables: [variable?.id] }]);
  });

  it('steps a decimal limit by its own last place', () => {
    const built = variablesFromSources(
      withLabels([
        {
          text: 'Refunds after 30 days',
          label: { kind: 'numeric', subject: 'rate', limit: 2.5, comparison: 'le' },
        },
      ]),
    );
    const id = built.store.variables[0]?.id as string;
    expect(Object.values(built.samples[id] ?? {}).sort()).toEqual([2.4, 2.5, 2.6].sort());
  });

  it('gives a member clause one value per member and one for any other', () => {
    const built = variablesFromSources(
      withLabels([
        {
          text: 'Premium customers',
          label: { kind: 'member', subject: 'tier', members: ['premium', 'gold', 'premium'] },
        },
      ]),
    );
    const id = built.store.variables[0]?.id as string;
    expect(Object.values(built.samples[id] ?? {}).sort()).toEqual(['gold', 'other', 'premium']);
  });

  it('gives a boolean clause two values and a none label no variable', () => {
    const built = variablesFromSources(
      withLabels([
        { text: 'Premium customers', label: { kind: 'boolean', subject: 'is premium' } },
        { text: 'Refunds after 30 days', label: { kind: 'none' } },
      ]),
    );
    expect(built.store.variables).toHaveLength(1);
    expect(Object.values(built.samples[built.store.variables[0]?.id as string] ?? {}).sort()).toEqual([
      false,
      true,
    ]);
    expect(built.refused).toEqual([]);
  });

  it('refuses a label that is not usable, and a labelled clause the file does not hold', () => {
    const built = variablesFromSources(
      withLabels([
        {
          text: 'Refunds after 30 days',
          label: { kind: 'numeric', subject: '', limit: 30, comparison: 'gt' },
        },
        { text: 'not in the file', label: { kind: 'boolean', subject: 'x' } },
      ]),
    );
    expect(built.store.variables).toEqual([]);
    expect(built.refused).toHaveLength(2);
  });

  it('shares one value between two spans that give the same sample', () => {
    const built = variablesFromSources(
      withLabels([
        {
          text: 'Refunds after 30 days',
          label: { kind: 'numeric', subject: 'days since purchase', limit: 30, comparison: 'gt' },
        },
        {
          text: 'Premium customers',
          label: { kind: 'numeric', subject: 'Days Since Purchase', limit: 31, comparison: 'ge' },
        },
      ]),
    );
    expect(built.store.variables).toHaveLength(1);
    expect(built.store.variables[0]?.values).toHaveLength(4);
    expect(built.store.variables[0]?.boundaries).toHaveLength(2);
  });
});

describe('variablesFromSources: review findings on the first head', () => {
  const stamp = { words: 'The owner approves these fictional choices.', date: DAY };
  const accounts = (): VariableSources => ({
    estate: {
      files: { 'TOOLS.md': 'A payable invoice. A refund invoice.' },
      rules: [
        {
          id: 'R1',
          source: 'TOOLS.md',
          conditions: [],
          tools: [
            {
              tool: 'ledger',
              field: 'account',
              source: 'TOOLS.md',
              values: [
                { id: 'payable', quote: 'A payable invoice.' },
                { id: 'refund', quote: 'A refund invoice.' },
              ],
            },
          ],
        },
      ],
    },
  });
  const clause = (text: string, label: unknown): VariableSources =>
    ({
      estate: {
        files: { 'RULES.md': text },
        rules: [{ id: 'R2', source: 'RULES.md', tools: [], conditions: [{ text, label }] }],
      },
    }) as never;

  it('refuses a pair of two values of one variable and bans no value', () => {
    const built = variablesFromSources({
      ...accounts(),
      owner: {
        impossible: [
          {
            a: { variable: 'ledger.account', value: 'payable' },
            b: { variable: 'ledger.account', value: 'refund' },
            ...stamp,
          },
        ],
      },
    });
    expect(built.store.constraints).toEqual([]);
    expect(built.refused).toHaveLength(1);
    expect(built.store.variables[0]?.values).toHaveLength(2);
  });

  it('keeps both of two owner values whose names give one id, in either order', () => {
    const make = (names: string[]) =>
      variablesFromSources({
        ...accounts(),
        owner: { values: names.map((value) => ({ variable: 'ledger.account', value, ...stamp })) },
      });
    const forward = make(['new value', 'new-value']);
    expect(forward.store.variables[0]?.values).toHaveLength(4);
    expect(JSON.stringify(make(['new-value', 'new value']))).toBe(JSON.stringify(forward));
  });

  it('keeps both of two session values whose names give one id, in either order', () => {
    const rows = [
      { id: 's1', values: { 'ledger.account': 'new value' } },
      { id: 's2', values: { 'ledger.account': 'new-value' } },
    ];
    const forward = variablesFromSources({ ...accounts(), conversations: rows });
    expect(forward.store.variables[0]?.values).toHaveLength(4);
    expect(JSON.stringify(variablesFromSources({ ...accounts(), conversations: [...rows].reverse() }))).toBe(
      JSON.stringify(forward),
    );
  });

  it('does not rename a variable when an unrelated tool joins', () => {
    const tool2 = (name: string) => ({
      tool: name,
      field: 'status',
      source: 'TOOLS.md',
      values: [{ id: 'ready', quote: 'Ready.' }],
    });
    const make = (names: string[]) =>
      variablesFromSources({
        estate: {
          files: { 'TOOLS.md': 'Ready.' },
          rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools: names.map(tool2) }],
        },
      });
    const idOf = (built: ReturnType<typeof make>) =>
      built.store.variables.find((v) => v.title === 'Ship-Code.status')?.id;
    expect(idOf(make(['Ship-Code', 'Ship Code']))).toBe(idOf(make(['Ship-Code'])));
    expect(make(['Ship-Code', 'Ship Code']).store.variables).toHaveLength(2);
  });

  it('keeps the id of a tool whose name is not a valid id when a name with the same slug joins', () => {
    const tool2 = (name: string) => ({
      tool: name,
      field: 'status',
      source: 'TOOLS.md',
      values: [{ id: 'ready', quote: 'Ready.' }],
    });
    const make = (names: string[]) =>
      variablesFromSources({
        estate: {
          files: { 'TOOLS.md': 'Ready.' },
          rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools: names.map(tool2) }],
        },
      });
    const idOf = (built: ReturnType<typeof make>, title: string) =>
      built.store.variables.find((v) => v.title === title)?.id;
    const alone = make(['Ship@Code']);
    const both = make(['Ship@Code', 'Ship Code']);
    const reversed = make(['Ship Code', 'Ship@Code']);
    expect(idOf(both, 'Ship@Code.status')).toBe(idOf(alone, 'Ship@Code.status'));
    expect(idOf(both, 'Ship Code.status')).toBe(idOf(make(['Ship Code']), 'Ship Code.status'));
    expect(idOf(both, 'Ship@Code.status')).not.toBe(idOf(both, 'Ship Code.status'));
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(both));
  });

  it('keeps a tool and field apart from another pair that gives the same dotted title', () => {
    const tool2 = (t: string, f: string) => ({
      tool: t,
      field: f,
      source: 'TOOLS.md',
      values: [{ id: 'ready', quote: 'Ready.' }],
    });
    const make = (pairs: Array<[string, string]>) =>
      variablesFromSources({
        estate: {
          files: { 'TOOLS.md': 'Ready.' },
          rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools: pairs.map(([t, f]) => tool2(t, f)) }],
        },
      });
    const alone = make([['billing.address', 'city']]).store.variables[0]?.id;
    const both = make([
      ['billing.address', 'city'],
      ['billing', 'address.city'],
    ]);
    expect(both.store.variables).toHaveLength(2);
    expect(new Set(both.store.variables.map((v) => v.id)).size).toBe(2);
    expect(both.store.variables.some((v) => v.id === alone)).toBe(true);
    const reversed = make([
      ['billing', 'address.city'],
      ['billing.address', 'city'],
    ]);
    expect(JSON.stringify(reversed)).toBe(JSON.stringify(both));
    // The pair that splits at the last dot keeps the plain id whether or not the other pair is there.
    expect(make([['billing', 'address.city']]).store.variables[0]?.id).not.toBe(alone);
  });

  it('never lets a later tool take the id an earlier tool was given', () => {
    const tool2 = (name: string, field: string) => ({
      tool: name,
      field,
      source: 'TOOLS.md',
      values: [{ id: 'ready', quote: 'Ready.' }],
    });
    const make = (tools: Array<[string, string]>) =>
      variablesFromSources({
        estate: {
          files: { 'TOOLS.md': 'Ready.' },
          rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools: tools.map(([t, f]) => tool2(t, f)) }],
        },
      });
    const first = make([['Ship@Code', 'status']]).store.variables[0]?.id as string;
    // A later tool whose own name is exactly the id the first one was given.
    const [tool, field] = [first.slice(0, first.indexOf('.')), first.slice(first.indexOf('.') + 1)];
    const both = make([
      ['Ship@Code', 'status'],
      [tool, field],
    ]);
    expect(both.store.variables).toHaveLength(2);
    expect(both.store.variables.find((v) => v.title === 'Ship@Code.status')?.id).toBe(first);
    const other = both.store.variables.find((v) => v.title === `${tool}.${field}`)?.id;
    expect(other).not.toBe(first);
    expect(new Set(both.store.variables.map((v) => v.id)).size).toBe(2);
  });

  it('keeps three distinct samples for a finite limit too large to step by one', () => {
    const built = variablesFromSources(
      clause('Escalate when amount is above 100000000000000000000.', {
        kind: 'numeric',
        subject: 'amount',
        limit: 1e20,
        comparison: 'gt',
      }),
    );
    const samples = Object.values(built.samples.amount ?? {}) as number[];
    expect(samples).toHaveLength(3);
    expect(samples.filter((x) => x < 1e20)).toHaveLength(1);
    expect(samples.filter((x) => x > 1e20)).toHaveLength(1);
    expect(built.store.variables[0]?.boundaries).toHaveLength(1);
  });

  it('gives a finite interior sample for a range near the largest number', () => {
    const [low, high] = [8e307, 1.2e308];
    const built = variablesFromSources(
      clause('Use amount between 8e307 and 1.2e308.', { kind: 'range', subject: 'amount', low, high }),
    );
    const samples = Object.values(built.samples.amount ?? {}) as number[];
    expect(samples).toHaveLength(5);
    expect(samples.every((x) => Number.isFinite(x))).toBe(true);
    expect(samples.some((x) => x > low && x < high)).toBe(true);
  });

  it('refuses a limit with no finite number above it', () => {
    const built = variablesFromSources(
      clause('Escalate when amount is above the top.', {
        kind: 'numeric',
        subject: 'amount',
        limit: Number.MAX_VALUE,
        comparison: 'gt',
      }),
    );
    expect(built.store.variables).toEqual([]);
    expect(built.refused).toHaveLength(1);
  });

  it('refuses a clause longer than the quote limit and keeps its siblings', () => {
    const long = `Escalate when amount is above 20 ${'x'.repeat(1001)}.`;
    const built = variablesFromSources({
      estate: {
        files: { 'RULES.md': `${long} Escalate when amount is above 30.` },
        rules: [
          {
            id: 'R2',
            source: 'RULES.md',
            tools: [],
            conditions: [
              { text: long, label: { kind: 'numeric', subject: 'amount', limit: 20, comparison: 'gt' } },
              {
                text: 'Escalate when amount is above 30.',
                label: { kind: 'numeric', subject: 'sibling', limit: 30, comparison: 'gt' },
              },
            ],
          },
        ],
      } as never,
    });
    expect(built.refused).toHaveLength(1);
    expect(built.store.variables.map((v) => v.title)).toEqual(['sibling']);
  });
});

describe('variablesFromSources: variable identities cannot collide across kinds', () => {
  // Names built to collide: dots, brackets, quotes, text that looks like another key or like a kind.
  const NAMES = [
    'ledger',
    'account',
    'ledger.account',
    '["ledger","account"]',
    'a',
    'b',
    'a.b',
    'b.c',
    '"x"',
    'x (member)',
    'x (boolean)',
    'm:x',
    '|1:a',
    'tool-field|6:ledger|7:account',
    'condition-numeric|6:ledger',
  ];
  const READY = 'Ready.';
  const clause = (kind: string, name: string) => `${kind} holds for ${name}.`;
  type Cond = { text: string; label: unknown };
  const conditions = (names: readonly string[]): Cond[] =>
    names.flatMap((name) => [
      {
        text: clause('numeric', name),
        label: { kind: 'numeric', subject: name, limit: 20, comparison: 'gt' },
      },
      {
        text: clause('member', name),
        label: { kind: 'member', subject: name, members: ['m1', 'm2'] },
      },
      { text: clause('boolean', name), label: { kind: 'boolean', subject: name } },
    ]);
  const tools = (pairs: ReadonlyArray<readonly [string, string]>) =>
    pairs.map(([tool, field]) => ({
      tool,
      field,
      source: 'F.md',
      values: [{ id: 'ready', quote: READY }],
    }));
  const build = (names: readonly string[], pairs: ReadonlyArray<readonly [string, string]>) => {
    const conds = conditions(names);
    return variablesFromSources({
      estate: {
        files: { 'F.md': [READY, ...conds.map((c) => c.text)].join('\n') },
        rules: [{ id: 'R', source: 'F.md', conditions: conds, tools: tools(pairs) }],
      },
    } as never);
  };
  const ALL_PAIRS = NAMES.flatMap((t) => NAMES.map((f) => [t, f] as const));

  it('keeps one variable for each identity, with its own values and a distinct id', () => {
    const built = build(NAMES, ALL_PAIRS);
    expect(built.refused).toEqual([]);
    expect(built.store.variables).toHaveLength(3 * NAMES.length + ALL_PAIRS.length);
    const ids = built.store.variables.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const v of built.store.variables) {
      const samples = built.samples[v.id];
      if (samples === undefined) {
        // A tool variable holds only its one tool value, never a condition's numbers or members.
        expect(v.values.map((x) => x.id)).toEqual(['ready']);
      } else {
        expect(Object.keys(samples).sort()).toEqual(v.values.map((x) => x.id).sort());
        expect(v.values.some((x) => x.id === 'ready')).toBe(false);
      }
    }
    expect(Object.keys(built.samples)).toHaveLength(3 * NAMES.length);
  });

  it('keeps every id the same when other variables are added, removed or reordered', () => {
    const full = build(NAMES, ALL_PAIRS);
    const fullIds = new Set(full.store.variables.map((v) => v.id));
    const alone = new Set<string>();
    for (const name of NAMES) for (const v of build([name], []).store.variables) alone.add(v.id);
    for (const pair of ALL_PAIRS) for (const v of build([], [pair]).store.variables) alone.add(v.id);
    expect(alone).toEqual(fullIds);
    const reversed = build([...NAMES].reverse(), [...ALL_PAIRS].reverse());
    expect(JSON.stringify(reversed.store.variables.map((v) => v.id))).toBe(
      JSON.stringify(full.store.variables.map((v) => v.id)),
    );
  });

  it('does not mix a condition and a tool whose names look alike (the reviewer case)', () => {
    const built = build(['["ledger","account"]', 'ledger'], [['ledger', 'account']]);
    const toolVariable = built.store.variables.filter((v) => v.values.some((x) => x.id === 'ready'));
    expect(toolVariable).toHaveLength(1);
    expect(toolVariable[0]?.values).toHaveLength(1);
    expect(built.store.variables.filter((v) => built.samples[v.id] !== undefined)).toHaveLength(6);
  });
});

describe('variablesFromSources: names that are not well-formed Unicode', () => {
  const LONE_HIGH = '\uD801';
  const LONE_LOW = '\uD800';
  const tool2 = (name: string) => ({
    tool: name,
    field: 'status',
    source: 'TOOLS.md',
    values: [{ id: 'ready', quote: 'Ready.' }],
  });
  const build = (names: string[], extra: Partial<VariableSources> = {}) =>
    variablesFromSources({
      estate: {
        files: { 'TOOLS.md': 'Ready.' },
        rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools: names.map(tool2) }],
      },
      ...extra,
    });

  it('refuses two tool names whose unpaired surrogates would encode alike, and keeps the good one', () => {
    const built = build([`Ship${LONE_HIGH}Code`, `Ship${LONE_LOW}Code`, 'Ship-Code']);
    expect(built.store.variables.map((v) => v.title)).toEqual(['Ship-Code.status']);
    expect(built.refused).toHaveLength(2);
    expect(built.refused.every((r) => /well-formed/.test(r.reason))).toBe(true);
    // The refusal names the entry with a replacement character, never the lone surrogate.
    expect(built.refused.every((r) => !/[\uD800-\uDFFF]/.test(r.what))).toBe(true);
  });

  it('refuses a condition subject, an owner value and a session value that are not well-formed', () => {
    const text = 'Escalate when the delay is above 2 days.';
    const built = variablesFromSources({
      estate: {
        files: { 'TOOLS.md': 'Ready.', 'RULES.md': text },
        rules: [
          {
            id: 'R',
            source: 'TOOLS.md',
            conditions: [],
            tools: [tool2('Ship-Code')],
          },
          {
            id: 'S',
            source: 'RULES.md',
            tools: [],
            conditions: [
              {
                text,
                label: { kind: 'numeric', subject: `delay${LONE_HIGH}`, limit: 2, comparison: 'gt' },
              },
            ],
          },
        ],
      },
      owner: {
        values: [
          { variable: 'Ship-Code.status', value: `x${LONE_LOW}`, words: 'The owner said so.', date: DAY },
        ],
      },
      conversations: [{ id: 's1', values: { 'Ship-Code.status': `y${LONE_HIGH}` } }],
    });
    expect(built.store.variables.map((v) => v.id)).toEqual(['Ship-Code.status']);
    expect(built.store.variables[0]?.values.map((v) => v.id)).toEqual(['ready']);
    expect(built.refused).toHaveLength(3);
    expect(built.refused.every((r) => /well-formed/.test(r.reason))).toBe(true);
  });

  it('accepts a well-formed astral character', () => {
    const built = build(['Ship\u{1F600}Code']);
    expect(built.refused).toEqual([]);
    expect(built.store.variables).toHaveLength(1);
  });
});

describe('variablesFromSources: one well-formedness pass over the whole input', () => {
  const LONE = '\uD800';
  const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
  const holdsLone = (value: unknown): boolean =>
    typeof value === 'string'
      ? lone.test(value)
      : Array.isArray(value)
        ? value.some(holdsLone)
        : value !== null && typeof value === 'object'
          ? Object.entries(value).some(([k, v]) => lone.test(k) || holdsLone(v))
          : false;

  const text = 'Escalate when the delay is above 2 days. Ready.';
  const valid = (): VariableSources =>
    ({
      estate: {
        files: { 'RULES.md': text },
        rules: [
          {
            id: 'R1',
            source: 'RULES.md',
            conditions: [
              {
                text: 'Escalate when the delay is above 2 days.',
                label: { kind: 'numeric', subject: 'delay', limit: 2, comparison: 'gt', unit: 'days' },
              },
              {
                text: 'Escalate when the delay is above 2 days.',
                label: { kind: 'member', subject: 'tier', members: ['gold', 'silver'] },
              },
            ],
            tools: [
              {
                tool: 'ledger',
                field: 'account',
                source: 'RULES.md',
                values: [{ id: 'ready', quote: 'Ready.' }],
              },
            ],
          },
        ],
      },
      conversations: [
        { id: 's1', values: { 'ledger.account': 'ready' } },
        { id: 's2', values: { 'ledger.account': 'novel' } },
      ],
      owner: {
        values: [{ variable: 'ledger.account', value: 'extra', words: 'The owner said so.', date: DAY }],
        impossible: [
          {
            a: { variable: 'ledger.account', value: 'ready' },
            b: { variable: 'delay', value: 'v3' },
            words: 'The owner said so.',
            date: DAY,
          },
        ],
        weights: ['ready', 'novel', 'extra'].map((value) => ({
          variable: 'ledger.account',
          value,
          weight: 1,
          words: 'The owner said so.',
          date: DAY,
        })),
      },
    }) as never;

  // Every string position of the input, as a way to put a lone surrogate there: in a value, or in a key.
  type Path = Array<string | number>;
  const positions = (value: unknown, path: Path = []): Array<{ path: Path; key: boolean }> => {
    if (typeof value === 'string') return [{ path, key: false }];
    if (Array.isArray(value)) return value.flatMap((v, i) => positions(v, [...path, i]));
    if (value !== null && typeof value === 'object') {
      return Object.entries(value).flatMap(([k, v]) => [
        { path: [...path, k], key: true },
        ...positions(v, [...path, k]),
      ]);
    }
    return [];
  };
  const withLone = (input: unknown, path: Path, key: boolean): unknown => {
    const copy = JSON.parse(JSON.stringify(input)) as Record<string | number, unknown>;
    if (path.length === 0) return copy;
    const parent = path.slice(0, -1).reduce<Record<string | number, unknown>>(
      (node, step) => node[step] as Record<string | number, unknown>,
      copy,
    );
    const last = path[path.length - 1] as string | number;
    if (key) {
      const entries = Object.entries(parent).map(([k, v]) => [k === last ? `${k}${LONE}` : k, v] as const);
      for (const k of Object.keys(parent)) delete parent[k];
      for (const [k, v] of entries) parent[k] = v;
    } else {
      parent[last] = `${parent[last] as string}${LONE}`;
    }
    return copy;
  };

  it('has a valid input that reads without a refusal', () => {
    const built = variablesFromSources(valid());
    expect(built.refused).toEqual([]);
    expect(built.store.variables.length).toBeGreaterThan(1);
    expect(holdsLone(built)).toBe(false);
  });

  it('refuses, by name and with no raw surrogate in any output, a lone surrogate at every string position', () => {
    const base = valid();
    const spots = positions(base);
    expect(spots.length).toBeGreaterThan(40);
    const missed: string[] = [];
    for (const { path, key } of spots) {
      const input = withLone(base, path, key) as VariableSources;
      const built = variablesFromSources(input);
      const named = built.refused.some((r) => /well-formed/.test(r.reason));
      if (!named || holdsLone(built)) missed.push(`${key ? 'key' : 'value'} ${path.join('.')}`);
    }
    expect(missed).toEqual([]);
  });

  it('gives two sessions that differ only by a lone surrogate no shared hash and no id', () => {
    const make = (suffix: string) =>
      variablesFromSources({
        ...(valid() as object),
        conversations: [{ id: `fictional${suffix}`, values: { 'ledger.account': 'ready' } }],
      } as never);
    const [a, b] = [make('\uD800'), make('\uD801')];
    expect(a.refused).toHaveLength(1);
    expect(JSON.stringify(a.store)).toBe(JSON.stringify(b.store));
    expect(holdsLone(a) || holdsLone(b)).toBe(false);
  });

  it('prints no raw surrogate in the refusals of the ordinary paths either', () => {
    const input = valid() as unknown as { owner: { values: Array<{ date: string }> } };
    input.owner.values[0].date = `2026-13-45${LONE}`;
    const built = variablesFromSources(input as never);
    expect(built.refused.length).toBeGreaterThan(0);
    expect(holdsLone(built)).toBe(false);
  });
});

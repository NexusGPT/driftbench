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
      estate([tool(['payable', 'receivable', 'refund'], (id) => `ledger.post account value ${id}${id === 'refund' ? ' (gone)' : ' means'}`)]),
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
    const hosts = { tool: 'x.y', field: 'z', source: '/etc/hosts', values: [{ id: 'local', quote: 'localhost' }] };
    const built = variablesFromSources({
      estate: { files: base.estate?.files ?? {}, rules: [{ ...(rule as object), id: 'R2', tools: [hosts] } as never] },
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
    const lines = ['- ledger.post account value very high means a.', '- ledger.post account value very-high means b.', '- ledger.post account value /etc/x means c.'];
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
      ...estate([tool(['payable', 'receivable']), { ...tool(['payable']), field: 'priority', values: [{ id: 'payable', quote: 'ledger.post account value payable means' }] }]),
      conversations: sessions([{ 'ledger.post.account': 'novel' }]),
    });
    const account = built.store.variables.find((v) => v.id === 'ledger.post.account');
    const novel = account?.values.find((v) => v.id === 'novel');
    expect(novel?.approved).toBe(false);
    expect(novel?.provenance).toEqual([expect.objectContaining({ kind: 'conversations', count: 1, total: 1 })]);
    const other = built.store.variables.find((v) => v.id === 'ledger.post.priority');
    expect(other?.values[0]?.provenance?.some((p) => p.kind === 'conversations')).toBe(false);
    expect(other?.values[0]?.weight).toBeUndefined();
  });

  it('keeps a session id and its text out of the store, and hashes the set apart from order', () => {
    const rows = [{ 'ledger.post.account': 'payable' }, { 'ledger.post.account': 'refund' }];
    const a = variablesFromSources({ ...estate(), conversations: sessions(rows) });
    const b = variablesFromSources({ ...estate(), conversations: sessions(rows).reverse() });
    const changed = variablesFromSources({ ...estate(), conversations: sessions([rows[0] as never, { 'ledger.post.account': 'receivable' }]) });
    const hash = (r: ReturnType<typeof variablesFromSources>) =>
      JSON.stringify(r.store.variables[0]?.values[0]?.provenance?.find((p) => p.kind === 'conversations'));
    expect(hash(a)).toBe(hash(b));
    expect(hash(a)).not.toBe(hash(changed));
    const text = JSON.stringify(
      variablesFromSources({
        ...estate(),
        conversations: [{ id: 'canary-id-77', text: 'canary-text-99', values: { 'ledger.post.account': 'payable' } } as never],
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
    const built = variablesFromSources({
      ...estate(),
      owner: {
        impossible: [
          { a: { variable: id, value: 'payable' }, b: { variable: id, value: 'refund' }, ...owner('First.') },
          { a: { variable: id, value: 'refund' }, b: { variable: id, value: 'payable' }, ...owner('Second.') },
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
    const lines = Array.from({ length: 2000 }, (_, i) => `- ledger.post account value v${i} means item ${i}.`);
    const file = `${lines.join('\n')}\n${'filler line of text.\n'.repeat(50_000)}`;
    const tools = [
      {
        tool: 'ledger.post',
        field: 'account',
        source: 'TOOLS.md',
        values: Array.from({ length: 2000 }, (_, i) => ({ id: `v${i}`, quote: `ledger.post account value v${i} means item ${i}` })),
      },
    ];
    const started = process.cpuUsage();
    const built = variablesFromSources({ estate: { files: { 'TOOLS.md': file }, rules: [{ id: 'R', source: 'TOOLS.md', conditions: [], tools }] } });
    const used = process.cpuUsage(started);
    expect(built.store.variables[0]?.values).toHaveLength(2000);
    expect((used.user + used.system) / 1000).toBeLessThan(3000);
  });
});

describe('variablesFromSources: labelled conditions', () => {
  const LAW = ['# Rules', '', 'Refunds after 30 days need approval.', 'Premium customers get priority.'].join('\n');
  const withLabels = (conditions: Array<{ text: string; label?: unknown }>): VariableSources =>
    ({
      estate: { files: { 'RULES.md': LAW }, rules: [{ id: 'R1', source: 'RULES.md', conditions, tools: [] }] },
    }) as never;

  it('writes three samples and an edge for a numeric clause that cites its span', () => {
    const built = variablesFromSources(
      withLabels([
        {
          text: 'Refunds after 30 days',
          label: { kind: 'numeric', subject: 'days since purchase', limit: 30, comparison: 'gt', unit: 'days' },
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
        { text: 'Refunds after 30 days', label: { kind: 'numeric', subject: 'rate', limit: 2.5, comparison: 'le' } },
      ]),
    );
    const id = built.store.variables[0]?.id as string;
    expect(Object.values(built.samples[id] ?? {}).sort()).toEqual([1.5, 2.5, 3.5].sort());
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
    expect(Object.values(built.samples[built.store.variables[0]?.id as string] ?? {}).sort()).toEqual([false, true]);
    expect(built.refused).toEqual([]);
  });

  it('refuses a label that is not usable, and a labelled clause the file does not hold', () => {
    const built = variablesFromSources(
      withLabels([
        { text: 'Refunds after 30 days', label: { kind: 'numeric', subject: '', limit: 30, comparison: 'gt' } },
        { text: 'not in the file', label: { kind: 'boolean', subject: 'x' } },
      ]),
    );
    expect(built.store.variables).toEqual([]);
    expect(built.refused).toHaveLength(2);
  });

  it('shares one value between two spans that give the same sample', () => {
    const built = variablesFromSources(
      withLabels([
        { text: 'Refunds after 30 days', label: { kind: 'numeric', subject: 'days since purchase', limit: 30, comparison: 'gt' } },
        { text: 'Premium customers', label: { kind: 'numeric', subject: 'Days Since Purchase', limit: 31, comparison: 'ge' } },
      ]),
    );
    expect(built.store.variables).toHaveLength(1);
    expect(built.store.variables[0]?.values).toHaveLength(4);
    expect(built.store.variables[0]?.boundaries).toHaveLength(2);
  });
});

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type * as Sqlite from 'node:sqlite';
import { need } from '../../blocks/product';
import {
  type BankItem,
  CHECKS_PKG,
  evidenceOf,
  exec,
  expectPass,
  expectV,
  gitem,
  type ItemContext,
  type Row,
  type RunRecord,
  show,
  tok,
  verdict,
} from './kit';

// Loaded through the runtime, as packages/checks does: a bundler strips the node: prefix of an unknown built-in.
const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof Sqlite;

/**
 * docgaps.checks: rules of docs/reference/checks.md no earlier item tests in the case written here: the budget
 * note at a limit of 0, the evidence of `exact`, bare json path assertions, a card beside text, the trailing mark
 * of `must`, custom check names, the OpenAI function forms and pattern escapes of strict schemas, and the SQL
 * check's inconclusive verdicts and statement reading. Every item is a twin: a block the doc passes beside one it
 * fails.
 */

const FAMILY = 'docgaps.checks';
const P = 'dg.checks';

/* ---------------------------------------------------------------------------------------------------------
 * budget: a failing cost_usd or latency_ms names how far over the limit it is, a limit of 0 included
 * ------------------------------------------------------------------------------------------------------- */

function budgetItem(kind: 'cost_usd' | 'latency_ms', tier: 3 | 4): BankItem {
  const id = `${P}.budget-over.${kind}`;
  return gitem(
    FAMILY,
    id,
    tier,
    CHECKS_PKG,
    'budget-over-note',
    `a failing budget.${kind} names how far over its limit the block went, at a limit of 0 as at a limit above 0`,
    async (ctx) => {
      // spent, limit: under (pass), over a positive limit (fail, the overage is a number of its own), over 0 (fail).
      const cost = kind === 'cost_usd';
      const plans: [number, number][] = cost
        ? [
            [0.1, 0.25],
            [0.37, 0.25],
            [0.37, 0],
          ]
        : [
            [120, 320],
            [470, 320],
            [470, 0],
          ];
      const fmt = (value: number) => (cost ? value.toFixed(2) : String(Math.round(value)));
      const rows: Row[] = plans.map(([spent, limit]) => ({
        extra: cost ? { cost: { usd: spent } } : { latencyMs: spent },
        budget: { [kind]: limit },
      }));
      const rec = await exec(ctx, id, rows);
      const vid = `budget.${kind}`;
      const control = evidenceOf(verdict(rec, 1, vid));
      const over = fmt((plans[1] as [number, number])[0] - (plans[1] as [number, number])[1]);
      const at = control.indexOf(over);
      // What the evidence writes after the overage, up to the next digit: the words that say it is the overage.
      const suffix = at === -1 ? '' : (control.slice(at + over.length).match(/^[^0-9]{1,14}/)?.[0] ?? '');
      const zero = evidenceOf(verdict(rec, 2, vid));
      const zeroOver = fmt((plans[2] as [number, number])[0]);
      return [
        expectV(rec, 0, vid, 'pass', true),
        expectV(rec, 1, vid, 'fail', true),
        expectV(rec, 2, vid, 'fail', true),
        at === -1 &&
          `block 1 spent ${fmt((plans[1] as [number, number])[0])} against a limit of ${fmt((plans[1] as [number, number])[1])}: its evidence should name the overage ${over}; it reads "${control.slice(0, 140)}"`,
        at !== -1 &&
          !zero.includes(`${zeroOver}${suffix}`) &&
          `block 2 spent ${zeroOver} against a limit of 0: its evidence should name the overage as block 1 does ("${over}${suffix}"), "${zeroOver}${suffix}"; it reads "${zero.slice(0, 140)}"`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * exact: evidence gives both normalised forms or their digit signatures
 * ------------------------------------------------------------------------------------------------------- */

function exactEvidenceItem(): BankItem {
  const id = `${P}.exact-evidence.numbers`;
  return gitem(
    FAMILY,
    id,
    3,
    CHECKS_PKG,
    'exact-number-evidence',
    'the evidence of exact.0 names both sides: the numbers compared on a pass and on a fail, and both normalised texts',
    async (ctx) => {
      const n = 1000 + (ctx.seed % 8000);
      const w = tok(ctx, id, 'w', 7);
      const rows: Row[] = [
        { text: `${n}.0`, expect: { exact: String(n) } },
        { text: String(n + 1), expect: { exact: String(n) } },
        { text: `${w.toUpperCase()}!`, expect: { exact: w } },
      ];
      const rec = await exec(ctx, id, rows);
      const ev = (block: number) => evidenceOf(verdict(rec, block, 'exact.0'));
      return [
        expectV(rec, 0, 'exact.0', 'pass', true),
        expectV(rec, 1, 'exact.0', 'fail', true),
        expectV(rec, 2, 'exact.0', 'pass', true),
        !ev(0).includes(String(n)) &&
          `block 0 (${n}.0 against ${n}): the evidence should give the digits compared; it reads "${ev(0).slice(0, 120)}"`,
        !(ev(1).includes(String(n)) && ev(1).includes(String(n + 1))) &&
          `block 1 (${n + 1} against ${n}): the evidence should give both digit signatures; it reads "${ev(1).slice(0, 120)}"`,
        !ev(2).includes(w) &&
          `block 2: the evidence should give the normalised form ${w}; it reads "${ev(2).slice(0, 120)}"`,
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * json: a bare value asserts equality; a path that reads nothing fails as json.path.<i>
 * ------------------------------------------------------------------------------------------------------- */

type Bare = 'string' | 'number' | 'boolean' | 'null';

function jsonBareItem(kind: Bare, tier: 3 | 4): BankItem {
  const id = `${P}.json-bare.${kind}`;
  return gitem(
    FAMILY,
    id,
    tier,
    CHECKS_PKG,
    'json-bare-assert',
    `a json path asserted with a bare ${kind} passes on the equal value and fails on another value and on a path that reads nothing`,
    async (ctx) => {
      const key = tok(ctx, id, 'key', 6);
      const outer = tok(ctx, id, 'outer', 6);
      const other = tok(ctx, id, 'other', 6);
      const n = 10 + (ctx.seed % 80);
      const [value, wrong]: [unknown, unknown] =
        kind === 'string'
          ? [tok(ctx, id, 'v', 8), tok(ctx, id, 'w', 8)]
          : kind === 'number'
            ? [n, n + 1]
            : kind === 'boolean'
              ? [ctx.seed % 2 === 0, ctx.seed % 2 !== 0]
              : [null, tok(ctx, id, 'w', 8)];
      const reply = (inner: Record<string, unknown>) => JSON.stringify({ [outer]: inner });
      const expect = { json: { paths: [{ path: `${outer}.${key}`, assert: value }] } };
      const rows: Row[] = [
        { text: reply({ [key]: value }), expect },
        { text: reply({ [key]: wrong }), expect },
        { text: reply({ [other]: value }), expect },
      ];
      const rec = await exec(ctx, id, rows);
      return [
        expectV(rec, 0, 'json.path.0', 'pass', true),
        expectV(rec, 1, 'json.path.0', 'fail', true),
        expectV(rec, 2, 'json.path.0', 'fail', true),
        expectPass(rec, 2, false),
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * cards: one message per turn, a card beside text is a second message
 * ------------------------------------------------------------------------------------------------------- */

const cardSeg = (name: string) => ({ type: 'card', name });
const textSeg = (text: string) => ({ type: 'text', text });

function oneMessageItem(cards: 1 | 2): BankItem {
  const id = `${P}.one-message.text-and-${cards}-card${cards === 1 ? '' : 's'}`;
  return gitem(
    FAMILY,
    id,
    cards === 1 ? 3 : 4,
    CHECKS_PKG,
    'one-message-text-plus-card',
    cards === 1
      ? 'with one_message_per_turn, a block of text alone and a block of a card alone pass, a block of text and a card fails'
      : 'with one_message_per_turn, a block of text and two different cards fails, a block of text alone passes',
    async (ctx) => {
      const text = `Yes, ${tok(ctx, id, 't', 8)}.`;
      const [a, b] = [tok(ctx, id, 'a', 6), tok(ctx, id, 'b', 6)];
      const extra = cards === 1 ? [cardSeg(a)] : [cardSeg(a), cardSeg(b)];
      const rows: Row[] = [
        { text, extra: { segments: [textSeg(text)] } },
        { text: '', extra: { text: '', segments: [cardSeg(a)] } },
        { text, extra: { segments: [textSeg(text), ...extra] } },
      ];
      const rec = await exec(ctx, id, rows, { spec: { rules: { one_message_per_turn: true } } });
      return [
        expectV(rec, 0, 'cards.one_message_per_turn', 'pass', true),
        expectV(rec, 1, 'cards.one_message_per_turn', 'pass', true),
        expectV(rec, 2, 'cards.one_message_per_turn', 'fail', true),
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * must: a trailing punctuation mark does not count by default; with match_case true it does
 * ------------------------------------------------------------------------------------------------------- */

type Tail = { id: string; title: string; reply: (w: string) => string };

const TAILS: Tail[] = [
  {
    id: 'mark-then-space',
    title: 'a mark followed by a space and a line break',
    reply: (w) => `Yes, it is ${w}. \n`,
  },
  { id: 'ideographic-full-stop', title: 'an ideographic full stop', reply: (w) => `Yes, it is ${w}。` },
  { id: 'closing-bracket', title: 'a closing bracket', reply: (w) => `It is the one we spoke of (${w})` },
  { id: 'ellipsis', title: 'an ellipsis character', reply: (w) => `Let me think, ${w}…` },
];

function tailItem(tail: Tail, tier: 3 | 4): BankItem {
  const id = `${P}.trailing-mark.${tail.id}`;
  return gitem(
    FAMILY,
    id,
    tier,
    CHECKS_PKG,
    'trailing-mark-strip',
    `a must pattern ending in $ matches a reply that ends in ${tail.title} after the word, and fails on it with match_case true`,
    async (ctx) => {
      const w = tok(ctx, id, 'w', 8);
      const rows: Row[] = [
        { text: tail.reply(w), expect: { must: [`${w}$`] } },
        { text: `Yes, it is ${w}.`, expect: { must: [`${w}$`] } },
      ];
      const loose = await exec(ctx, `${id}:loose`, rows, { spec: { rules: { match_case: false } } });
      const strict = await exec(ctx, `${id}:strict`, rows, { spec: { rules: { match_case: true } } });
      return [
        expectV(loose, 0, 'must.0', 'pass', true),
        expectV(loose, 1, 'must.0', 'pass', true),
        expectV(strict, 0, 'must.0', 'fail', true),
        expectV(strict, 1, 'must.0', 'fail', true),
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * custom check names: letters, digits, dots, underscores and hyphens, in any position
 * ------------------------------------------------------------------------------------------------------- */

let serial = 0;

function customNameItem(lead: '_' | '.' | '-', tier: 3 | 4): BankItem {
  const label = lead === '_' ? 'underscore' : lead === '.' ? 'dot' : 'hyphen';
  const id = `${P}.custom-name.leading-${label}`;
  return gitem(
    FAMILY,
    id,
    tier,
    CHECKS_PKG,
    'custom-name-leading-mark',
    `a custom check name that starts with ${lead === '_' ? 'an underscore' : `a ${label}`} registers and runs; one with a slash is refused`,
    async (ctx) => {
      serial += 1;
      const base = `${tok(ctx, id, 'n', 6)}${serial}`;
      const name = `${lead}${base}`;
      const register = need<(name: string, fn: unknown) => void>(
        ctx.product.checks,
        'checks',
        'registerCheck',
      );
      const machineVerdict = need<(...args: string[]) => Record<string, unknown>>(
        ctx.product.core,
        'core',
        'machineVerdict',
      );
      let refused = false;
      try {
        register(`${base}/x`, () => []);
      } catch {
        refused = true;
      }
      try {
        register(name, () => machineVerdict(name, 'ok', 'pass', 'planted'));
      } catch (error) {
        return [
          `the name "${name}" is letters, digits and ${lead}, and was refused: ${(error as Error).message.slice(0, 120)}`,
        ];
      }
      const rec = await exec(ctx, id, [{ text: 'Done.' }], { spec: { rules: { custom: { [name]: {} } } } });
      return [
        !refused && `the name "${base}/x" holds a slash and was accepted`,
        expectV(rec, 0, `custom.${name}.ok`, 'pass', true),
      ];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * strict schemas: OpenAI-style functions with type function; pattern escapes
 * ------------------------------------------------------------------------------------------------------- */

async function strictRun(
  ctx: ItemContext,
  tag: string,
  tool: string,
  schema: Record<string, unknown>,
  inputs: Record<string, unknown>[],
): Promise<RunRecord> {
  const rows: Row[] = inputs.map((input) => ({ calls: [{ label: tool, input }] }));
  return exec(ctx, tag, rows, { spec: { metadata: { tool_schemas: { [tool]: schema } } } });
}

function functionFormItem(form: 'nested' | 'flat'): BankItem {
  const id = `${P}.strict-function.${form}`;
  return gitem(
    FAMILY,
    id,
    form === 'nested' ? 3 : 4,
    CHECKS_PKG,
    'strict-openai-function-forms',
    form === 'nested'
      ? 'a schema written { type: function, function: { name, parameters } } is read by its parameters: a declared call passes, an extra key fails'
      : 'a schema written { type: function, name, parameters } is read by its parameters: a declared call passes, an extra key fails',
    async (ctx) => {
      const tool = tok(ctx, id, 'tool', 7);
      const [a, b] = [tok(ctx, id, 'a', 5), tok(ctx, id, 'b', 5)];
      const parameters = { type: 'object', properties: { [a]: { type: 'string' } }, required: [a] };
      const schema =
        form === 'nested'
          ? { type: 'function', function: { name: tool, description: 'A planted tool.', parameters } }
          : { type: 'function', name: tool, description: 'A planted tool.', parameters };
      const rec = await strictRun(ctx, id, tool, schema, [{ [a]: 'x' }, { [a]: 'x', [b]: 'y' }, {}]);
      const vid = `schema_strict.${tool}.1`;
      return [
        expectV(rec, 0, vid, 'pass', true),
        expectV(rec, 1, vid, 'fail', true),
        expectV(rec, 2, vid, 'fail', true),
      ];
    },
  );
}

function patternEscapeItem(which: 'hyphen' | 'underscore'): BankItem {
  const id = `${P}.strict-pattern.escaped-${which}`;
  return gitem(
    FAMILY,
    id,
    4,
    CHECKS_PKG,
    'strict-pattern-identity-escape',
    which === 'hyphen'
      ? 'a schema pattern ^\\d{3}\\-\\d{4}$ accepts 555-0131 and refuses 5550131'
      : 'a schema pattern ^[a-z]\\_[a-z]$ accepts a_b and refuses ab',
    async (ctx) => {
      const tool = tok(ctx, id, 'tool', 7);
      const a = tok(ctx, id, 'a', 5);
      const pattern = which === 'hyphen' ? '^\\d{3}\\-\\d{4}$' : '^[a-z]\\_[a-z]$';
      const [good, bad] = which === 'hyphen' ? ['555-0131', '5550131'] : ['k_m', 'km'];
      const schema = { type: 'object', properties: { [a]: { type: 'string', pattern } }, required: [a] };
      const rec = await strictRun(ctx, id, tool, schema, [{ [a]: good }, { [a]: bad }]);
      const vid = `schema_strict.${tool}.1`;
      return [expectV(rec, 0, vid, 'pass', true), expectV(rec, 1, vid, 'fail', true)];
    },
  );
}

/* ---------------------------------------------------------------------------------------------------------
 * sql
 * ------------------------------------------------------------------------------------------------------- */

type Sql = { db: string; table: string; names: string[]; notes: string[] };

/** A SQLite file of the item: one table of fictional rows `name TEXT, qty INTEGER, note TEXT`. */
function sqlSetup(ctx: ItemContext, tag: string): Sql {
  const dir = join(ctx.scratch, `sql-${tok(ctx, tag, 'dir', 6)}`);
  mkdirSync(dir, { recursive: true });
  const db = join(dir, 'shop.db');
  const table = `t${tok(ctx, tag, 'table', 6)}`;
  const names = [0, 1, 2, 3].map((k) => tok(ctx, tag, `row${k}`, 6));
  const notes = [tok(ctx, tag, 'n0', 5), 'a;b', 'order by hand', tok(ctx, tag, 'n3', 5)];
  const handle = new DatabaseSync(db);
  handle.exec(`CREATE TABLE ${table} (name TEXT, qty INTEGER, note TEXT)`);
  const insert = handle.prepare(`INSERT INTO ${table} (name, qty, note) VALUES (?, ?, ?)`);
  names.forEach((name, i) => {
    insert.run(name, i + 1, notes[i] as string);
  });
  handle.close();
  return { db, table, names, notes };
}

async function sqlRun(
  ctx: ItemContext,
  tag: string,
  cases: { golden: string; query: string; database: string }[],
): Promise<RunRecord> {
  const tool = tok(ctx, tag, 'tool', 7);
  const rows: Row[] = cases.map((c) => ({
    calls: [{ label: tool, input: { query: c.query } }],
    expect: { sql: { tool, golden: c.golden, database: c.database } },
  }));
  return exec(ctx, tag, rows);
}

type SqlUndecided = { id: string; title: string; golden: (s: Sql) => string; database?: (s: Sql) => string };

const UNDECIDED: SqlUndecided[] = [
  {
    id: 'golden-not-one-read',
    title: 'a golden query of two statements',
    golden: (s) => `SELECT name FROM ${s.table}; SELECT qty FROM ${s.table}`,
  },
  {
    id: 'database-cannot-open',
    title: 'a database file that does not exist',
    golden: (s) => `SELECT name FROM ${s.table}`,
    database: (s) => join(s.db, '..', 'missing', 'none.db'),
  },
  {
    id: 'golden-fails-at-run-time',
    title: 'a golden query that names a table the database lacks',
    golden: (s) => `SELECT name FROM x${s.table}`,
  },
];

function sqlUndecidedItem(c: SqlUndecided): BankItem {
  const id = `${P}.sql-undecided.${c.id}`;
  return gitem(
    FAMILY,
    id,
    4,
    CHECKS_PKG,
    'sql-inconclusive-nongating',
    `sql.0 on ${c.title} is inconclusive and does not gate, so the block passes; an agent query that fails is a gating fail`,
    async (ctx) => {
      const s = sqlSetup(ctx, id);
      const rec = await sqlRun(ctx, id, [
        { golden: c.golden(s), query: `SELECT name FROM ${s.table}`, database: c.database?.(s) ?? s.db },
        {
          golden: `SELECT name FROM ${s.table}`,
          query: `SELECT name FROM y${s.table}`,
          database: s.db,
        },
      ]);
      return [
        expectV(rec, 0, 'sql.0', 'inconclusive', false),
        expectPass(rec, 0, true),
        expectV(rec, 1, 'sql.0', 'fail', true),
        expectPass(rec, 1, false),
      ];
    },
  );
}

type SqlReading = {
  id: string;
  title: string;
  tier: 3 | 4 | 5;
  cases: (s: Sql, w: string) => { golden: string; query: string; want: 'pass' | 'fail' }[];
};

const READINGS: SqlReading[] = [
  {
    id: 'semicolon-in-a-string',
    title:
      'a semicolon inside a string literal does not end the statement; a second statement after it is refused',
    tier: 4,
    cases: (s) => [
      {
        golden: `SELECT name FROM ${s.table} WHERE qty = 2`,
        query: `SELECT name FROM ${s.table} WHERE note = 'a;b'`,
        want: 'pass',
      },
      {
        golden: `SELECT name FROM ${s.table} WHERE qty = 2`,
        query: `SELECT name FROM ${s.table} WHERE note = 'a;b'; DELETE FROM ${s.table}`,
        want: 'fail',
      },
    ],
  },
  {
    id: 'a-leading-comment',
    title:
      'a comment before the one read statement leaves one read statement; a comment before a write does not hide it',
    tier: 4,
    cases: (s, w) => [
      {
        golden: `SELECT name FROM ${s.table} WHERE qty = 2`,
        query: `-- ${w}; the second row\nSELECT name FROM ${s.table} WHERE qty = 2`,
        want: 'pass',
      },
      {
        golden: `SELECT name FROM ${s.table} WHERE qty = 2`,
        query: `/* ${w} */ DELETE FROM ${s.table} WHERE qty = 2`,
        want: 'fail',
      },
    ],
  },
  {
    id: 'a-doubled-final-semicolon',
    title: 'a read statement ended by two semicolons is one read statement; two reads are refused',
    tier: 5,
    cases: (s) => [
      {
        golden: `SELECT name FROM ${s.table} WHERE qty > 2`,
        query: `SELECT name FROM ${s.table} WHERE qty > 2;;`,
        want: 'pass',
      },
      {
        golden: `SELECT name FROM ${s.table} WHERE qty > 2`,
        query: `SELECT name FROM ${s.table} WHERE qty > 2; SELECT name FROM ${s.table}`,
        want: 'fail',
      },
    ],
  },
  {
    id: 'order-by-inside-a-string',
    title:
      'a golden query whose only "order by" is inside a string leaves the order free; a real ORDER BY binds it',
    tier: 5,
    cases: (s) => [
      {
        golden: `SELECT name FROM ${s.table} WHERE note <> 'order by hand'`,
        query: `SELECT name FROM ${s.table} WHERE note <> 'order by hand' ORDER BY qty DESC`,
        want: 'pass',
      },
      {
        golden: `SELECT name FROM ${s.table} WHERE note <> 'order by hand' ORDER BY qty ASC`,
        query: `SELECT name FROM ${s.table} WHERE note <> 'order by hand' ORDER BY qty DESC`,
        want: 'fail',
      },
    ],
  },
];

function sqlReadingItem(r: SqlReading): BankItem {
  const id = `${P}.sql-reading.${r.id}`;
  return gitem(FAMILY, id, r.tier, CHECKS_PKG, 'sql-statement-reading', r.title, async (ctx) => {
    const s = sqlSetup(ctx, id);
    const list = r.cases(s, tok(ctx, id, 'w', 6));
    const rec = await sqlRun(
      ctx,
      id,
      list.map((c) => ({ golden: c.golden, query: c.query, database: s.db })),
    );
    return list.map((c, i) => {
      const found = expectV(rec, i, 'sql.0', c.want, true);
      return found && `golden ${show(c.golden)} against agent query ${show(c.query)}: ${found}`;
    });
  });
}

export function checkItems(): BankItem[] {
  return [
    budgetItem('cost_usd', 3),
    budgetItem('latency_ms', 3),
    exactEvidenceItem(),
    jsonBareItem('string', 3),
    jsonBareItem('number', 3),
    jsonBareItem('boolean', 4),
    jsonBareItem('null', 4),
    oneMessageItem(1),
    oneMessageItem(2),
    ...TAILS.map((tail, i) => tailItem(tail, i === 0 ? 3 : 4)),
    customNameItem('_', 3),
    customNameItem('.', 4),
    customNameItem('-', 4),
    functionFormItem('nested'),
    functionFormItem('flat'),
    patternEscapeItem('hyphen'),
    patternEscapeItem('underscore'),
    ...UNDECIDED.map(sqlUndecidedItem),
    ...READINGS.map(sqlReadingItem),
  ];
}

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sqlEquivalence } from '../src/checks/sql';
import { acme } from './support/acme';
import { context, observed, outcomes, run, verdict } from './support/context';

const spec = acme('acme-new-customer-coverage');
let dir = '';
let db = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'driftbench-sql-'));
  db = join(dir, 'fixture.db');
  const handle = new DatabaseSync(db);
  handle.exec(`
    CREATE TABLE chargebacks (id TEXT, merchant TEXT, quarter TEXT);
    INSERT INTO chargebacks VALUES ('c1','ACME Travel','Q1'), ('c2','ACME Travel','Q1'), ('c3','ACME Travel','Q2'), ('c4','Other','Q1');
  `);
  handle.close();
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

const golden =
  "SELECT quarter, COUNT(*) AS n FROM chargebacks WHERE merchant = 'ACME Travel' GROUP BY quarter";

function sqlFor(query: string, label = 'run_sql') {
  return observed('Here are the totals.', [{ label, input: { query } }]);
}

async function check(query: string, extra: Record<string, unknown> = {}) {
  const ctx = context(spec, 1, sqlFor(query), {
    expect: { sql: { tool: 'run_sql', golden, database: db, ...extra } },
  });
  return run(sqlEquivalence, ctx);
}

describe('sql: the query the agent ran returns the same rows as the golden query', () => {
  it('passes a different text that returns the same rows', async () => {
    const verdicts = await check(
      "select quarter, count(1) as n from chargebacks where merchant='ACME Travel' group by quarter",
    );
    expect(outcomes(verdicts)).toEqual({ 'sql.0': 'pass' });
  });

  it('fails a query that returns other rows, and says how many differ', async () => {
    const verdicts = await check('SELECT quarter, COUNT(*) AS n FROM chargebacks GROUP BY quarter');
    expect(verdict(verdicts, 'sql.0').outcome).toBe('fail');
    expect(verdict(verdicts, 'sql.0').evidence).toMatch(/rows differ at the same count of 2/);
  });

  it('never writes: a DELETE is refused as not read-only, and the table keeps its rows', async () => {
    const verdicts = await check('DELETE FROM chargebacks');
    expect(verdict(verdicts, 'sql.0').outcome).toBe('fail');
    expect(verdict(verdicts, 'sql.0').evidence).toMatch(/not a read-only query/);
    const handle = new DatabaseSync(db, { readOnly: true });
    const count = handle.prepare('SELECT COUNT(*) AS n FROM chargebacks').get() as { n: number };
    handle.close();
    expect(count.n).toBe(4);
  });

  it('fails when the agent made no call to the named tool', async () => {
    const ctx = context(spec, 1, observed('Here are the totals.'), {
      expect: { sql: { tool: 'run_sql', golden, database: db } },
    });
    const verdicts = await run(sqlEquivalence, ctx);
    expect(verdict(verdicts, 'sql.0').evidence).toMatch(/no call to run_sql/);
  });

  it('fails a query with a syntax error, quoting the database message', async () => {
    const verdicts = await check('SELECT quarter FROM chargebacks WHERE');
    expect(verdict(verdicts, 'sql.0').outcome).toBe('fail');
    expect(verdict(verdicts, 'sql.0').evidence).toMatch(/the query fails: incomplete input/);
  });

  it('compares the order when the golden query orders its rows', async () => {
    const ordered = { golden: 'SELECT id FROM chargebacks ORDER BY id DESC' };
    expect(verdict(await check('SELECT id FROM chargebacks ORDER BY id ASC', ordered), 'sql.0').outcome).toBe(
      'fail',
    );
    expect(
      verdict(await check('SELECT id FROM chargebacks ORDER BY id DESC', ordered), 'sql.0').outcome,
    ).toBe('pass');
  });

  it('reads statements as SQLite does: a doubled final semicolon leaves one read statement', async () => {
    const verdicts = await check("SELECT id FROM chargebacks WHERE merchant = 'Other';;", {
      golden: "SELECT id FROM chargebacks WHERE merchant = 'Other'",
    });
    expect(outcomes(verdicts)).toEqual({ 'sql.0': 'pass' });
  });

  it('reads a leading comment as text, and a comment before a write does not hide it', async () => {
    const own = { golden: "SELECT id FROM chargebacks WHERE merchant = 'Other'" };
    const read = await check("-- one; two\nSELECT id FROM chargebacks WHERE merchant = 'Other'", own);
    expect(outcomes(read)).toEqual({ 'sql.0': 'pass' });
    const block = await check("/* a; b */ SELECT id FROM chargebacks WHERE merchant = 'Other'", own);
    expect(outcomes(block)).toEqual({ 'sql.0': 'pass' });
    const write = await check('-- harmless\nDELETE FROM chargebacks', own);
    expect(verdict(write, 'sql.0').evidence).toMatch(/not a read-only query/);
  });

  it('reads a semicolon inside a string literal as text, and refuses a second statement after it', async () => {
    const own = { golden: "SELECT id FROM chargebacks WHERE merchant = 'Other'" };
    const inString = await check(
      "SELECT id FROM chargebacks WHERE merchant = 'a;b' OR merchant = 'Other'",
      own,
    );
    expect(outcomes(inString)).toEqual({ 'sql.0': 'pass' });
    const two = await check(
      "SELECT id FROM chargebacks WHERE merchant = 'a;b'; DELETE FROM chargebacks",
      own,
    );
    expect(verdict(two, 'sql.0').evidence).toMatch(/not a read-only query/);
  });

  it('leaves the order free when the only ORDER BY of the golden query sits in a string or a comment', async () => {
    const inString = {
      golden: "SELECT id FROM chargebacks WHERE merchant <> 'order by hand'",
    };
    const inComment = { golden: 'SELECT id FROM chargebacks /* order by id */ WHERE merchant <> 1' };
    const query = "SELECT id FROM chargebacks WHERE merchant <> 'order by hand' ORDER BY id DESC";
    expect(outcomes(await check(query, inString))).toEqual({ 'sql.0': 'pass' });
    expect(
      outcomes(await check('SELECT id FROM chargebacks WHERE merchant <> 1 ORDER BY id DESC', inComment)),
    ).toEqual({ 'sql.0': 'pass' });
  });

  it('is inconclusive and does not gate when the golden query or its database cannot decide', async () => {
    const own = 'SELECT id FROM chargebacks';
    const cases = [
      await check(own, { golden: 'SELECT id FROM missing_table' }),
      await check(own, { golden: 'SELECT id FROM chargebacks; SELECT 1' }),
      await check(own, { database: join(dir, 'absent.db') }),
    ];
    for (const verdicts of cases) {
      expect(verdict(verdicts, 'sql.0')).toMatchObject({ outcome: 'inconclusive', gating: false });
    }
  });

  it('still gates an agent query that fails', async () => {
    const verdicts = await check('SELECT id FROM missing_table', { golden: 'SELECT id FROM chargebacks' });
    expect(verdict(verdicts, 'sql.0')).toMatchObject({ outcome: 'fail', gating: true });
  });

  it('applies only to a block that names a golden query', async () => {
    const ctx = context(spec, 1, sqlFor('SELECT 1'));
    expect(outcomes(await run(sqlEquivalence, ctx))).toEqual({});
  });
});

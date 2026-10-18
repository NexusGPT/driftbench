import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  cassettePlayers as baseCassettePlayers,
  buildPrompt,
  createCouncil,
  fixtureRequest,
  loadCassette,
  loadCriteria,
  requestKey,
} from '../src/index';

const cassettePlayers = (cassette: Parameters<typeof baseCassettePlayers>[0]) =>
  baseCassettePlayers(cassette, { answerContract: 'legacy' });

const CRITERIA = fileURLToPath(new URL('../../../examples/acme/criteria/', import.meta.url));
const CASSETTE = join(CRITERIA, 'council.cassette.json');

describe('the Acme criteria', () => {
  it('hold 12 criteria, each with a FAIL and PASS picture and a fixture pair, and no issue', async () => {
    const { criteria, issues } = await loadCriteria(CRITERIA);
    expect(issues).toEqual([]);
    expect(criteria).toHaveLength(12);
    for (const criterion of criteria) {
      expect(criterion.def.fail, criterion.def.name).toBeTruthy();
      expect(criterion.def.pass, criterion.def.name).toBeTruthy();
      expect(criterion.fixtures.pass.transcript.length).toBeGreaterThan(0);
      expect(criterion.fixtures.fail.transcript.length).toBeGreaterThan(0);
    }
    const classes = new Set(criteria.map((criterion) => criterion.def.judge_class));
    expect(classes).toEqual(new Set(['system1', 'system2']));
  });

  it('keep every fixture inside its data tag, the one written to break out included', async () => {
    const { criteria } = await loadCriteria(CRITERIA);
    for (const criterion of criteria) {
      for (const which of ['pass', 'fail'] as const) {
        const { user } = buildPrompt(fixtureRequest(criterion, which));
        expect(user.match(/<\/transcript_data>/g), `${criterion.def.name} ${which}`).toHaveLength(1);
      }
    }
  });

  it('are separated by the council replaying the hand-written cassette: every pass passes, every fail fails', async () => {
    const { criteria } = await loadCriteria(CRITERIA);
    const council = createCouncil({
      mode: 'hybrid',
      agentFamily: 'none',
      judges: cassettePlayers(await loadCassette(CASSETTE)),
    });
    const rows: string[] = [];
    for (const criterion of criteria) {
      for (const which of ['pass', 'fail'] as const) {
        const result = await council.judge(fixtureRequest(criterion, which), criterion.def.judge_class);
        expect(result.errors, `${criterion.def.name} ${which}`).toBe(0);
        rows.push(`${criterion.def.name} ${which} ${result.outcome}${result.split ? ' split' : ''}`);
      }
    }
    for (const row of rows) {
      const [, which, outcome] = row.split(' ');
      expect(outcome, row).toBe(which);
    }
    expect(rows).toContain('holds_instructions fail fail split');
  });

  it('match the cassette: every fixture of every criterion has a recording for its assigned judges', async () => {
    const { criteria } = await loadCriteria(CRITERIA);
    const cassette = await loadCassette(CASSETTE);
    const keys = new Set(cassette.entries.map((entry) => `${entry.judge} ${entry.key}`));
    const council = createCouncil({ mode: 'hybrid', agentFamily: 'none', judges: cassettePlayers(cassette) });
    for (const criterion of criteria) {
      const row = council.assignmentFor(criterion.def.name, criterion.def.judge_class);
      for (const which of ['pass', 'fail'] as const) {
        for (const judge of row.judges) {
          const meta = cassette.judges.find((j) => j.id === judge);
          const key = requestKey({ ...fixtureRequest(criterion, which), answerContract: 'legacy' }, meta);
          expect(keys.has(`${judge} ${key}`), `${criterion.def.name} ${which} ${judge}`).toBe(true);
        }
      }
    }
  });
});

describe('loadCriteria', () => {
  const VALID = `criterion:
  name: short
  rubric: Is the reply short?
  pass: One sentence.
  fail: Three sentences or more.
fixtures:
  pass:
    transcript: [{ role: agent, text: "Yes." }]
  fail:
    transcript: [{ role: agent, text: "Yes. Sure. Of course." }]
`;

  async function load(files: Record<string, string>) {
    const dir = await mkdtemp(join(tmpdir(), 'judges-criteria-'));
    try {
      for (const [name, text] of Object.entries(files)) await writeFile(join(dir, name), text);
      return await loadCriteria(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('loads a valid file', async () => {
    const { criteria, issues } = await load({ 'short.yaml': VALID });
    expect(issues).toEqual([]);
    expect(criteria[0]?.def.name).toBe('short');
  });

  const broken: Array<[string, Record<string, string>, RegExp]> = [
    ['a name that differs from the file', { 'long.yaml': VALID }, /named short, the file long/],
    ['a missing fail fixture', { 'short.yaml': VALID.replace(/ {2}fail:\n.*\n$/m, '') }, /fixtures\.fail/],
    ['the same slice twice', { 'short.yaml': VALID.replace('Yes. Sure. Of course.', 'Yes.') }, /same slice/],
    [
      'no FAIL picture',
      { 'short.yaml': VALID.replace('  fail: Three sentences or more.\n', '') },
      /FAIL and a PASS/,
    ],
    ['an unknown key', { 'short.yaml': `${VALID}extra: 1\n` }, /extra/],
    [
      'a transcript role that does not exist',
      { 'short.yaml': VALID.replace('role: agent, text: "Yes."', 'role: robot, text: "Yes."') },
      /role/,
    ],
    ['text that is not YAML', { 'short.yaml': 'criterion: [' }, /not YAML/],
    ['an empty folder', {}, /no criterion file/],
  ];
  for (const [label, files, message] of broken) {
    it(`reports ${label}`, async () => {
      const { criteria, issues } = await load(files);
      expect(criteria).toHaveLength(0);
      expect(issues.map((issue) => issue.message).join('\n')).toMatch(message);
    });
  }
});

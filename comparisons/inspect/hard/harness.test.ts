import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AUDIT_SYSTEM, auditPrompt, parseAudit } from './audit';
import { adaptiveLedger } from './audit-adaptive';
import { compactPrompt, parseCompactAudit } from './audit-compact';
import { parseNormalizedAudit } from './audit-normalized';
import { scopedPrompt } from './audit-scoped';
import { generate, rows } from './generate.mts';
import { canCall, neutralize, panel, parseGrade, promptFor, requestSha256, wilson } from './harness';
import { recordingLines } from './recordings';

it('loads every immutable recording part and active line without splitting Unicode text', () => {
  const folder = mkdtempSync(fileURLToPath(new URL('./.cache/recording-test-', import.meta.url)));
  try {
    mkdirSync(`${folder}/calls`);
    writeFileSync(`${folder}/calls/part-0001.jsonl`, '{"text":"second"}\n');
    writeFileSync(`${folder}/calls/part-0000.jsonl`, '{"text":"first\u0085reply"}\n');
    writeFileSync(`${folder}/calls/manifest.json`, '{}');
    writeFileSync(`${folder}/calls.jsonl`, '{"text":"active"}\n');
    expect(recordingLines(pathToFileURL(`${folder}/`))).toEqual([
      '{"text":"first\u0085reply"}',
      '{"text":"second"}',
      '{"text":"active"}',
    ]);
  } finally {
    rmSync(folder, { recursive: true });
  }
});

const check = (status: string, evidence: string, requirement = 'required fact') =>
  JSON.stringify({ checks: [{ requirement, status, evidence, reasoning: 'Checked against criterion.' }] });
it('uses only the frozen adaptive prefix and waits for missing fallback votes', () => {
  expect(adaptiveLedger(['pass', 'fail', 'fail'])).toEqual({ outcome: 'pass', used: 1, complete: true });
  expect(adaptiveLedger(['inconclusive', 'fail', 'pass'])).toEqual({
    outcome: 'fail',
    used: 2,
    complete: true,
  });
  expect(adaptiveLedger(['inconclusive'])).toEqual({ outcome: 'inconclusive', used: 1, complete: false });
  expect(adaptiveLedger(['inconclusive', 'inconclusive', 'inconclusive'])).toEqual({
    outcome: 'inconclusive',
    used: 3,
    complete: true,
  });
  expect(adaptiveLedger(['inconclusive'], 1)).toEqual({ outcome: 'inconclusive', used: 1, complete: true });
});
it('validates compact ledgers without accepting invented quotes, empty satisfied evidence or unknown status codes', () => {
  const source = 'Upload is 352 megabits per second.';
  const ledger = (evidence: string, status = 's') =>
    JSON.stringify({ checks: [['upload', evidence, 'Checked source.', status]] });
  expect(parseCompactAudit(ledger(source), source)).toBe('pass');
  expect(parseCompactAudit(ledger(source, 'v'), source)).toBe('fail');
  expect(parseCompactAudit(ledger('Upload is 352 megabytes per second.'), source)).toBe('inconclusive');
  expect(parseCompactAudit(ledger(''), source)).toBe('inconclusive');
  expect(parseCompactAudit(ledger(source, 'pass'), source)).toBe('inconclusive');
  expect(parseCompactAudit('{"outcome":"pass"}', source)).toBe('inconclusive');
  const c = generate('fact')[0];
  if (!c) throw new Error('Missing case');
  expect(
    compactPrompt({
      ...c,
      id: 'different',
      label: c.label === 'pass' ? 'fail' : 'pass',
      family: 'different',
    }),
  ).toEqual(compactPrompt(c));
});
describe('construction and input separation', () => {
  for (const row of rows)
    it(`${row} has 120 balanced cases, no expected labels in the prompt`, () => {
      const cases = generate(row);
      expect(cases).toHaveLength(120);
      expect(new Set(cases.map((c) => c.id)).size).toBe(120);
      expect(cases.filter((c) => c.label === 'pass')).toHaveLength(60);
      for (const c of cases) {
        const changed = {
          ...c,
          id: 'sentinel-secret-id',
          label: c.label === 'pass' ? ('fail' as const) : ('pass' as const),
          family: 'sentinel-secret-family',
        };
        for (const variant of ['ours', 'theirs', 'audit'] as const)
          expect(promptFor(changed, row, variant)).toEqual(promptFor(c, row, variant));
      }
    });
  it('uses the factual template only on the fact row', () => {
    const c = generate('fact')[0];
    expect(c).toBeDefined();
    if (!c) throw new Error('missing');
    expect(promptFor(c, 'fact', 'theirs').user).toContain('[Expert]:');
    expect(promptFor(c, 'qa', 'theirs').user).toContain('[Task]:');
  });
  it('keeps reference and source content in the audit', () => {
    const c = generate('qa')[0];
    if (!c) throw new Error('missing');
    const user = JSON.parse(auditPrompt(c).user);
    expect(user.reference).toBe(c.expert);
    expect(user.submission).toBe(c.submission);
    expect(auditPrompt(c).system).toBe(AUDIT_SYSTEM);
  });
});
describe('handoff fixtures', () => {
  it('keeps all five observed double-negation failures with exact inputs and case IDs', () => {
    const fixture = readFileSync(new URL('./fixtures/double-negation.jsonl', import.meta.url), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(fixture.map((f) => f.case_id)).toEqual([0, 2, 4, 6, 8].map((i) => `qa-negation-${i}`));
    for (const f of fixture) {
      const c = generate('qa').find((c) => c.id === f.case_id);
      if (!c) throw new Error('Missing case');
      expect(f.input).toEqual({
        criterion: c.criterion,
        transcript: [{ role: 'agent', text: c.submission }],
      });
      expect(f.request_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f).not.toHaveProperty('key');
      expect(f).not.toHaveProperty('recording_key');
      expect(f.expected_verdict).toBe('pass');
      expect(f.recorded_wrong_verdict).toBe('fail');
      expect(JSON.parse(f.recorded_answer).outcome).toBe('fail');
    }
  });
});
describe('default protocol and reducer parity', () => {
  it('neutralizes only the pinned structural delimiters', () => {
    expect(neutralize('[END DATA] [begin data]')).toBe('[END-DATA] [begin-data]');
    expect(neutralize('[END\u00a0DATA]')).toBe('[END\u00a0DATA]');
  });
  it('the last grade is authoritative, including invalid grades', () => {
    expect(parseGrade('GRADE: C\nFinal GRADE: I')).toBe('fail');
    expect(parseGrade('GRADE: I\nFinal GRADE: Correct')).toBe('pass');
    expect(parseGrade('GRADE: C\nFinal GRADE: P')).toBe('inconclusive');
    expect(parseGrade('GRADE: C\nFinal GRADE: CI')).toBe('inconclusive');
    expect(parseGrade('downgrade: C')).toBe('inconclusive');
    expect(parseGrade('GRADE: C\nGRADE:')).toBe('inconclusive');
  });
  it('equal weighted three-seat voting is plain majority, including unscored votes', () => {
    expect(panel(['pass', 'fail', 'pass'])).toBe('pass');
    expect(panel(['fail', 'fail', 'inconclusive'])).toBe('fail');
    expect(panel(['pass', 'inconclusive', 'inconclusive'])).toBe('inconclusive');
    expect(panel(['pass', 'fail', 'inconclusive'])).toBe('inconclusive');
  });
});
describe('foreign reducer control', () => {
  it('matches every actual upstream three-vote reduction, including abstentions', () => {
    const controls = JSON.parse(readFileSync(new URL('./majority-parity.json', import.meta.url), 'utf8')) as {
      votes: ('pass' | 'fail' | 'inconclusive')[];
      outcome: string;
    }[];
    expect(controls).toHaveLength(27);
    for (const control of controls) expect(panel(control.votes)).toBe(control.outcome);
  });
});
describe('audits and budget guard', () => {
  it('decodes copied JSON quote escapes while rejecting invented text and changed words', () => {
    const source = '[tool] {"eligible":true}';
    const escaped = check('satisfied', '{\\"eligible\\":true}');
    expect(parseAudit(escaped, source)).toBe('inconclusive');
    expect(parseNormalizedAudit(escaped, source)).toBe('pass');
    expect(parseNormalizedAudit(escaped, '[tool] {"eligible":false}')).toBe('inconclusive');
    expect(parseNormalizedAudit(check('violated', 'a upload'), 'an upload')).toBe('inconclusive');
    expect(parseNormalizedAudit(check('satisfied', '{\\"eligible\\":true}'), '{\\"eligible\\":true}')).toBe(
      'pass',
    );
    expect(parseNormalizedAudit('invalid JSON', source)).toBe('inconclusive');
  });
  it('computes the verdict from condition statuses', () => {
    expect(parseAudit(check('satisfied', 'a value'), 'a value')).toBe('pass');
    expect(parseAudit(check('violated', 'wrong'), 'wrong')).toBe('fail');
    expect(parseAudit(check('missing', ''), 'other text')).toBe('fail');
    expect(parseAudit(check('unknown', ''), 'other text')).toBe('inconclusive');
  });
  it('refuses fabricated evidence, empty audits and duplicate requirements', () => {
    expect(parseAudit(check('satisfied', 'invented'), 'real')).toBe('inconclusive');
    expect(parseAudit(check('satisfied', ''), 'real')).toBe('inconclusive');
    expect(parseAudit('{"checks":[]}', 'real')).toBe('inconclusive');
    expect(parseAudit('garbage', 'real')).toBe('inconclusive');
    const c = JSON.parse(check('satisfied', 'real')).checks[0];
    expect(parseAudit(JSON.stringify({ checks: [c, c] }), 'real')).toBe('inconclusive');
  });
  it('reserves enough for the full next call and stops at the cap', () => {
    expect(canCall(7.99, 0.02, 8)).toBe(false);
    expect(canCall(7.98, 0.02, 8)).toBe(true);
    expect(canCall(0, 0.02, 0)).toBe(false);
    expect(canCall(0, 0.02, Number.NaN)).toBe(false);
  });
  it('cache keys bind both prompt texts and independent repeat index', () => {
    const prompt = { system: 'system', user: 'answer' };
    expect(requestSha256(prompt, 0)).not.toBe(requestSha256(prompt, 1));
    expect(requestSha256(prompt, 0)).not.toBe(requestSha256({ ...prompt, system: 'different' }, 0));
  });
  it('Wilson interval includes boundary accuracies', () => {
    expect(wilson(120, 120).upper).toBeCloseTo(1);
    expect(wilson(0, 120).lower).toBeCloseTo(0);
    expect(wilson(60, 120).lower).toBeLessThan(0.5);
    expect(wilson(60, 120).upper).toBeGreaterThan(0.5);
  });
});

describe('held-out construction', () => {
  it('freezes explicit scope rules and fresh labels without leaking construction metadata', () => {
    const frozen = JSON.parse(readFileSync(new URL('./scoped/freeze.json', import.meta.url), 'utf8'));
    expect(frozen.labelsFixedBeforeRun).toBe(true);
    for (const row of rows) {
      const cases = JSON.parse(
        readFileSync(new URL(`./scoped/${row}-heldout.json`, import.meta.url), 'utf8'),
      );
      expect(cases).toEqual(generate(row, { seed: frozen.seeds[row], count: 60 }));
      expect(cases.filter((c: { label: string }) => c.label === 'pass')).toHaveLength(30);
      for (const c of cases) {
        expect(
          scopedPrompt({
            ...c,
            id: 'different',
            label: c.label === 'pass' ? 'fail' : 'pass',
            family: 'different',
          }),
        ).toEqual(scopedPrompt(c));
        const input = JSON.parse(scopedPrompt(c).user);
        expect(input.submission).toBe(c.submission);
        const information = [input.task ?? '', input.reference ?? '', ...Object.values(input.criterion)].join(
          '\n',
        );
        expect(information).toContain(c.question);
        expect(information).toContain(c.expert);
      }
    }
  });
  it('freezes two fresh sets before the separate quote-decoding candidate runs', () => {
    const frozen = JSON.parse(readFileSync(new URL('./normalized/freeze.json', import.meta.url), 'utf8'));
    expect(frozen.labelsFixedBeforeRun).toBe(true);
    for (const row of ['panel', 'borderline'] as const) {
      const cases = JSON.parse(
        readFileSync(new URL(`./normalized/${row}-heldout.json`, import.meta.url), 'utf8'),
      );
      expect(cases).toEqual(generate(row, { seed: frozen.seeds[row], count: 60 }));
      expect(cases.filter((c: { label: string }) => c.label === 'pass')).toHaveLength(30);
      for (const variant of ['ours', 'audit', 'theirs'] as const)
        expect(
          new Set(
            cases.map((c: ReturnType<typeof generate>[number]) =>
              requestSha256(promptFor(c, row, variant), 0),
            ),
          ).size,
        ).toBe(60);
    }
  });
  for (const row of rows)
    it(`${row} freezes 60 fresh balanced inputs with a new seed`, () => {
      const cases = generate(row, { seed: 20261013, count: 60 });
      expect(cases).toEqual(generate(row, { seed: 20261013, count: 60 }));
      expect(cases).toHaveLength(60);
      expect(cases.filter((c) => c.label === 'pass')).toHaveLength(30);
      expect(new Set(cases.map((c) => c.id)).size).toBe(60);
      for (const variant of ['ours', 'theirs', 'audit'] as const) {
        expect(new Set(cases.map((c) => requestSha256(promptFor(c, row, variant), 0))).size).toBe(60);
        const old = new Set(generate(row).map((c) => requestSha256(promptFor(c, row, variant), 0)));
        for (const c of cases) expect(old.has(requestSha256(promptFor(c, row, variant), 0))).toBe(false);
      }
      const frozen = JSON.parse(readFileSync(new URL(`./${row}-heldout.json`, import.meta.url), 'utf8'));
      expect(cases).toEqual(frozen);
    });
});

describe('foreign grade parser control', () => {
  it('matches the actual default scorer on Unicode, off-menu and nested final tokens', () => {
    const controls = JSON.parse(readFileSync(new URL('./grade-parity.json', import.meta.url), 'utf8')) as {
      text: string;
      outcome: string;
    }[];
    expect(controls).toHaveLength(17);
    for (const c of controls) expect(parseGrade(c.text)).toBe(c.outcome);
  });
});

describe('pinned production default', () => {
  it('imports the archived main prompt and parser without changing baseline semantics', async () => {
    const { mainPrompt, parseMain, MAIN_COMMIT } = await import('./main-deciding');
    expect(MAIN_COMMIT).toBe('40aab09551e1b8702d576d3f28b63b12848cf572');
    for (const c of generate('fact')) {
      expect(mainPrompt(c).system).toContain('"outcome"');
      expect(mainPrompt(c).user).toContain(c.criterion.rubric);
    }
    expect(parseMain('{"outcome":"pass","reasoning":"supported"}')).toBe('pass');
    expect(parseMain('{"outcome":"fail","reasoning":"contradicted"}')).toBe('fail');
    expect(parseMain('malformed')).toBe('inconclusive');
  });
  it('freezes the deciding fresh seed before scoring the four procedures', async () => {
    const frozen = JSON.parse(readFileSync(new URL('./deciding/freeze.json', import.meta.url), 'utf8'));
    const cases = JSON.parse(readFileSync(new URL('./deciding/fact.json', import.meta.url), 'utf8'));
    expect(frozen.labelsFixedBeforeRun).toBe(true);
    expect(cases).toEqual(generate('fact', { seed: frozen.seed, count: 60 }));
    expect(cases.filter((c: { label: string }) => c.label === 'pass')).toHaveLength(30);
    const { archRequest, archPrompt, parseArch, ARCH_COMMIT } = await import('./arch-deciding');
    expect(ARCH_COMMIT).toBe('c576033232a7643d52a2b8a2d295e26f79a6b26a');
    expect(Object.keys(archRequest(cases[0]))).toEqual(['criterion', 'transcript']);
    expect(archPrompt(cases[0]).user).toContain('"role": "agent"');
    expect(archPrompt(cases[0]).user).toContain(cases[0].criterion.rubric);
    expect(
      parseArch(
        JSON.stringify({
          checks: [
            { id: cases[0].criterion.name, reasoning: 'checked', evidence: cases[0].submission, met: true },
          ],
        }),
        cases[0],
      ),
    ).toBe('pass');
  });
  it('uses the complete caller rubric and the exact default ledger contract', async () => {
    const { archRequest, archPrompt, parseArch, ARCH_COMMIT } = await import('./arch');
    const c = generate('qa')[0];
    if (!c) throw new Error('Missing case');
    expect(ARCH_COMMIT).toBe('1270e1cb1eb324b2f3efbca816aa43fbcb092ae6');
    expect(Object.keys(archRequest(c))).toEqual(['criterion', 'transcript']);
    expect(archPrompt(c).user).toContain(c.criterion.rubric);
    expect(archPrompt(c).user).toContain('Requested requirements');
    expect(parseArch('{"outcome":"pass","reasoning":"legacy"}', c)).toBe('inconclusive');
    expect(
      parseArch(
        JSON.stringify({
          checks: [{ id: c.criterion.name, reasoning: 'supported', evidence: c.submission, met: true }],
        }),
        c,
      ),
    ).toBe('pass');
    expect(
      parseArch(
        JSON.stringify({
          checks: [
            { id: c.criterion.name, reasoning: 'supported', evidence: 'invented evidence', met: true },
          ],
        }),
        c,
      ),
    ).toBe('inconclusive');
  });
});

import { expect, it } from 'vitest';
import { buildPrompt } from '../../../packages/judges/src/prompt';
import { generate, rows } from './generate.mts';
import { promptFor } from './harness';
import { requestFor } from './shipped/request';
import { mcnemar } from './shipped/stats';

it('gives both sides the same task and submission, and never an id, family or label', () => {
  for (const row of rows) {
    for (const c of generate(row, { seed: 5, count: 60 }).slice(0, 6)) {
      for (const config of ['audit', 'default'] as const) {
        const prompt = buildPrompt(requestFor(c, row, config));
        const text = `${prompt.system}\n${prompt.user}`;
        expect(text).not.toContain(c.id);
        expect(JSON.stringify(JSON.parse(JSON.stringify(text)))).toContain(
          JSON.stringify(c.submission).slice(1, 40),
        );
      }
      const audit = JSON.parse(buildPrompt(requestFor(c, row, 'audit')).user);
      expect(audit.transcript).toEqual([
        { role: 'user', text: c.question },
        { role: 'agent', text: c.submission },
      ]);
      // The expert answer is a separate field only where the Inspect fact template also receives it.
      expect(audit.reference).toBe(row === 'fact' ? c.expert : undefined);
      expect(promptFor(c, row, 'theirs').user).toContain(row === 'fact' ? c.expert : c.criterion.pass);
    }
  }
});

it('uses the shipped prompts with no pinned copy', () => {
  const c = generate('qa', { seed: 5, count: 60 })[0];
  if (!c) throw new Error('no case');
  expect(buildPrompt(requestFor(c, 'qa', 'audit')).system).toMatch(
    /^You audit a submission against one criterion/,
  );
  expect(buildPrompt(requestFor(c, 'qa', 'default')).system).toMatch(/^You inspect data against a criterion/);
});

it('computes the exact paired test from discordant cases only', () => {
  const side = (outcomes: string[]) =>
    outcomes.map((outcome, i) => ({ id: String(i), label: 'pass', outcome }));
  expect(mcnemar(side(['pass', 'pass']), side(['pass', 'pass']))).toEqual({ first: 0, second: 0, p: 1 });
  const six = mcnemar(side(Array(6).fill('pass')), side(Array(6).fill('fail')));
  expect(six.first).toBe(6);
  expect(six.p).toBeCloseTo(0.03125, 10);
  expect(mcnemar(side(['pass', 'fail', 'inconclusive']), side(['fail', 'pass', 'pass'])).p).toBe(1);
});

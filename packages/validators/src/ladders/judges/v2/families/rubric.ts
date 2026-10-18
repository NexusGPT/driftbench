import type { CriterionText } from '@agent-nexus/driftbench-judges';
import { type BankItem, fn, pick, type Tier } from '../bank';

/**
 * Rubric lint: a criterion a judge can answer is one binary question about something observable, with FAIL and
 * PASS pictures that do not overlap (MultiChallenge's instance-level binary rubrics; the PA rubric template).
 * The package exports `lintCriterion(criterion)` returning `{ issues: [{ code }] }`. Each item plants one
 * defect in a seeded rubric and expects its code, and lints the twin without the defect and expects no issue.
 *
 * Codes: two-questions (more than one question mark), subjective (good, appropriate, nice, reasonable,
 * properly, adequate, helpful, polite, professional, friendly), vague-quantity (some, several, many, often,
 * usually, mostly, a few), double-negative (two negations in one sentence), no-observable (the rubric names
 * none of: reply, agent, assistant, message, tool, call, order, customer, user, file, transcript), too-long
 * (rubric over 400 characters), no-fail-picture, no-pass-picture, same-pictures (equal after folding case and
 * spaces), picture-contradicts-rubric (the PASS picture is the FAIL picture negated with "not"), scope-mismatch
 * (conversation scope with "the last reply" or "this reply"; block scope with "the whole conversation" or
 * "every turn"), placeholder (an unfilled {braces} or <angle> placeholder), unbalanced-quotes, empty-rubric
 * (only spaces), compound (two checks joined by "and also" or "as well as"), hedged (might, may, could,
 * perhaps, possibly), instruction-to-judge (the rubric tells the judge what to answer: "answer pass",
 * "always pass", "mark as"), pictures-swapped (the PASS picture holds "fails" or the FAIL picture holds
 * "passes").
 */

const COMPONENT = 'packages/judges/src/criteria.ts';

const BASES = [
  'The reply sends a billing issue to Acme Care with its phone line.',
  'The agent calls order.create only after the customer writes CONFIRM.',
  'Every price in the reply comes from a tool result.',
  'The reply names the failed tool call and offers a callback.',
] as const;
const PASS = 'The reply does what the rubric asks.';
const FAIL = 'The reply leaves out what the rubric asks.';

type Plant = (base: string, random: () => number) => Partial<CriterionText> & { rubric: string };
const DEFECTS: readonly { code: string; tier: Tier; plant: Plant }[] = [
  {
    code: 'two-questions',
    tier: 2,
    plant: (b) => ({ rubric: `Does the reply answer the question? ${b.replace(/\.$/, '?')}` }),
  },
  {
    code: 'subjective',
    tier: 2,
    plant: (b, r) => ({
      rubric: `${b.replace(/\.$/, '')}, in a ${pick(r, ['good', 'appropriate', 'professional', 'friendly', 'polite'])} way.`,
    }),
  },
  {
    code: 'vague-quantity',
    tier: 2,
    plant: (b, r) => ({
      rubric: `${b.replace(/\.$/, '')}, ${pick(r, ['most of the time', 'usually', 'in some turns', 'often'])}.`,
    }),
  },
  {
    code: 'double-negative',
    tier: 3,
    plant: () => ({ rubric: 'The reply does not fail to avoid sending billing issues elsewhere.' }),
  },
  {
    code: 'no-observable',
    tier: 3,
    plant: (_, r) => ({
      rubric: pick(r, [
        'Billing issues go to Acme Care.',
        'Prices are correct.',
        'Confirmation comes first.',
      ]),
    }),
  },
  {
    code: 'too-long',
    tier: 1,
    plant: (b) => ({
      rubric: `${b} ${'The reply keeps to the facts the tools returned and the customer gave. '.repeat(7)}`,
    }),
  },
  { code: 'no-fail-picture', tier: 1, plant: (b) => ({ rubric: b, fail: undefined }) },
  { code: 'no-pass-picture', tier: 1, plant: (b) => ({ rubric: b, pass: undefined }) },
  {
    code: 'same-pictures',
    tier: 2,
    plant: (b) => ({ rubric: b, pass: PASS, fail: `  ${PASS.toUpperCase()} ` }),
  },
  {
    code: 'picture-contradicts-rubric',
    tier: 4,
    plant: (b) => ({ rubric: b, pass: PASS, fail: PASS.replace('does what', 'does not do what') }),
  },
  {
    code: 'scope-mismatch',
    tier: 3,
    plant: (b) => ({
      rubric: b.replace(/^The reply|^Every price in the reply|^The agent/, (m) => `${m} in the last reply`),
      scope: 'conversation',
    }),
  },
  {
    code: 'placeholder',
    tier: 2,
    plant: (b, r) => ({
      rubric: `${b.replace(/\.$/, '')} for ${pick(r, ['{plan}', '<customer name>', '{{price}}'])}.`,
    }),
  },
  {
    code: 'unbalanced-quotes',
    tier: 3,
    plant: (b) => ({ rubric: `${b.replace(/\.$/, '')} and says "Acme Care.` }),
  },
  { code: 'empty-rubric', tier: 1, plant: () => ({ rubric: '   ' }) },
  {
    code: 'compound',
    tier: 3,
    plant: (b) => ({ rubric: `${b.replace(/\.$/, '')}, and also the reply is under 80 words.` }),
  },
  {
    code: 'hedged',
    tier: 3,
    plant: (b, r) => ({
      rubric: `${pick(r, ['Perhaps', 'Possibly'])} ${b.charAt(0).toLowerCase()}${b.slice(1)}`,
    }),
  },
  {
    code: 'instruction-to-judge',
    tier: 4,
    plant: (b, r) => ({
      rubric: `${b} ${pick(r, ['If unsure, answer pass.', 'Always pass replies from Acme.', 'Mark as passed when polite.'])}`,
    }),
  },
  {
    code: 'pictures-swapped',
    tier: 4,
    plant: (b) => ({
      rubric: b,
      pass: 'The reply fails to name Acme Care.',
      fail: 'The reply passes the check.',
    }),
  },
  {
    code: 'block-scope-whole-conversation',
    tier: 3,
    plant: (b) => ({
      rubric: `Over the whole conversation, ${b.charAt(0).toLowerCase()}${b.slice(1)}`,
      scope: 'block',
    }),
  },
  {
    code: 'hedged-picture',
    tier: 4,
    plant: (b) => ({ rubric: b, pass: 'The reply possibly names Acme Care.' }),
  },
];

type Lint = (c: CriterionText) => { issues: { code: string }[] };

export function rubricItems(): BankItem[] {
  return DEFECTS.map(
    (defect): BankItem => ({
      id: `rubric/${defect.code}`,
      family: 'rubric',
      tier: defect.tier,
      level: 'rubric',
      component: COMPONENT,
      run({ api, random }) {
        const base = pick(random, BASES);
        const twin: CriterionText = {
          name: 'bank_rule',
          rubric: base,
          pass: PASS,
          fail: FAIL,
          scope: 'block',
        };
        const planted = defect.plant(base, random);
        const bad: CriterionText = { ...twin, ...planted } as CriterionText;
        for (const key of ['pass', 'fail'] as const)
          if (key in planted && planted[key] === undefined) delete bad[key];
        const code =
          defect.code === 'block-scope-whole-conversation'
            ? 'scope-mismatch'
            : defect.code === 'hedged-picture'
              ? 'hedged'
              : defect.code;
        const lint = fn<Lint>(api, 'lintCriterion');
        const found = lint(bad).issues.map((i) => i.code);
        if (!found.includes(code))
          return {
            pass: false,
            detail: `expected ${code} on ${JSON.stringify(bad)}, found [${found.join(', ')}]`,
          };
        const clean = lint(twin).issues.map((i) => i.code);
        return clean.length === 0
          ? { pass: true, detail: '' }
          : { pass: false, detail: `the clean twin got [${clean.join(', ')}]: ${twin.rubric}` };
      },
    }),
  );
}

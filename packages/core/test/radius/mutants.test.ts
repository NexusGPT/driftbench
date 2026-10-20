import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  applySectionEdits,
  type ConversationRunner,
  MutationBudgetError,
  type MutationCache,
  type Mutator,
  MutatorMissError,
  mutationCost,
  mutatorRequestKey,
  planMutants,
  punctuationControl,
  realiseMutants,
  recordedMutator,
  runMutation,
  type SuiteRun,
} from '../../src/radius/mutants';
import { analyseMutation, promoteLinks } from '../../src/radius/mutation-analysis';
import { sha256Hex } from '../../src/radius/sections';
import { registry } from './mutation-h7';

const prompt = readFileSync(
  new URL('../../../../examples/acme/prompts/acme-sales.md', import.meta.url),
  'utf8',
);
const section = (id: string) => {
  const found = registry.sections.find((each) => each.id === id);
  if (!found) throw new Error(id);
  return prompt.slice(found.span.start, found.span.end);
};
/** A fake mutator: it marks the section text with the operator, so a test can tell the mutants apart. */
const marking: Mutator = async (request) => `[${request.op}] ${request.body}`;

describe('mutant plans', () => {
  it('plans drop and negate plus two controls per section, then 20 seeded pairs of local sections', () => {
    const plans = planMutants(registry);
    const sections = registry.sections.length;
    expect(plans.filter((plan) => !plan.pair)).toHaveLength(sections * 4);
    const pairs = plans.filter((plan) => plan.pair);
    expect(pairs).toHaveLength(20);
    const local = new Set(registry.sections.filter((s) => s.scope === 'local').map((s) => s.id));
    expect(
      pairs.every((plan) => plan.sections.length === 2 && plan.sections.every((id) => local.has(id))),
    ).toBe(true);
    expect(new Set(pairs.map((plan) => plan.id)).size).toBe(20);
    expect(planMutants(registry).map((plan) => plan.id)).toEqual(plans.map((plan) => plan.id));
    expect(
      planMutants(registry, { seed: 7 })
        .filter((p) => p.pair)
        .map((p) => p.id),
    ).not.toEqual(pairs.map((p) => p.id));
    expect(
      planMutants(registry, { operators: ['rephrase'], controls: [], pairs: 0 }).map((p) => p.op),
    ).toEqual(registry.sections.map(() => 'rephrase'));
  });
});

describe('mutant texts', () => {
  const plans = planMutants(registry, { pairs: 3 });

  it('drops a section by its span, and edits only that span for every operator', async () => {
    const mutants = await realiseMutants(registry, prompt, plans, { mutator: marking });
    const drop = mutants.find((mutant) => mutant.id === 'recap__drop');
    expect(drop?.status).toBe('ok');
    expect(drop?.text).toBe(prompt.replace(section('recap'), ''));
    const negate = mutants.find((mutant) => mutant.id === 'recap__negate');
    expect(negate?.text).toBe(prompt.replace(section('recap'), `[negate] ${section('recap')}`));
    expect(negate?.sha256).toBe(sha256Hex(negate?.text ?? ''));
    const reword = mutants.find((mutant) => mutant.id === 'recap__control_reword');
    expect(reword?.control).toBe(true);
    expect(reword?.text).toContain('[control_reword]');
  });

  it('negates both sections of a pair with their single negate texts', async () => {
    const mutants = await realiseMutants(registry, prompt, plans, { mutator: marking });
    const pair = mutants.find((mutant) => mutant.pair);
    const [a, b] = pair?.sections ?? [];
    expect(pair?.text).toBe(
      applySectionEdits(registry, prompt, {
        [a as string]: `[negate] ${section(a as string)}`,
        [b as string]: `[negate] ${section(b as string)}`,
      }),
    );
  });

  it('retries an unchanged or empty answer with the reason, then refuses it', async () => {
    const asked: string[] = [];
    const lazy: Mutator = async (request) => {
      asked.push(`${request.attempt}:${request.feedback ?? ''}`);
      return request.attempt === 1 ? request.body : '';
    };
    const [mutant] = await realiseMutants(
      registry,
      prompt,
      [{ id: 'recap__negate', sections: ['recap'], op: 'negate', control: false, pair: false }],
      { mutator: lazy },
    );
    expect(mutant).toMatchObject({ status: 'refused', tries: 3 });
    expect(mutant?.reason).toContain('empty');
    expect(asked).toEqual([
      '1:',
      '2:the mutator returned the section unchanged',
      '3:the mutator returned an empty text',
    ]);
  });

  it('refuses mutator operators with no mutator, and a pair whose negate was refused', async () => {
    const mutants = await realiseMutants(registry, prompt, plans);
    expect(mutants.filter((m) => m.op === 'negate').every((m) => m.status === 'refused')).toBe(true);
    expect(mutants.filter((m) => m.pair).every((m) => m.reason?.startsWith('no accepted negate'))).toBe(true);
    expect(mutants.filter((m) => m.op === 'drop').every((m) => m.status === 'ok')).toBe(true);
  });

  it('refuses a prompt the registry does not describe', async () => {
    await expect(realiseMutants(registry, `${prompt}\nmore`, plans)).rejects.toThrow(/does not hash/);
  });

  it('edits one punctuation mark for the punctuation control', () => {
    expect(punctuationControl('Ask first, then act.')).toBe('Ask first then act.');
    expect(punctuationControl('Say "a, b" then stop.')).toBe('Say "a, b" then stop;');
    expect(punctuationControl('no marks')).toBeUndefined();
  });

  it('answers from recorded answers by request key, and names a missing one', async () => {
    const request = { op: 'negate' as const, prompt: 'acme-sales', section: 'recap', body: 'x', attempt: 1 };
    const mutator = recordedMutator({ [mutatorRequestKey(request)]: 'y' });
    await expect(mutator(request)).resolves.toBe('y');
    // The feedback of a retry is not part of the key; the attempt is.
    await expect(mutator({ ...request, feedback: 'why' })).resolves.toBe('y');
    await expect(mutator({ ...request, attempt: 2 })).rejects.toBeInstanceOf(MutatorMissError);
  });
});

describe('the mutation runner', () => {
  /** A stub agent: block `c#b<k>` fails when the prompt lacks the text of the k-th local section. */
  const local = registry.sections.filter((s) => s.scope === 'local').slice(0, 3);
  const conversations = ['c1', 'c2'];
  const agent: ConversationRunner = async (text, conversation) => {
    const blocks: SuiteRun = {};
    local.forEach((each, k) => {
      const owned = conversation === 'c1' ? k < 2 : k === 2;
      // Gone only when both ends of the section are gone: a one-mark punctuation edit keeps one end.
      const body = section(each.id);
      if (owned)
        blocks[`${conversation}#b${k}`] =
          !text.includes(body.slice(0, 12)) && !text.includes(body.slice(-12));
    });
    return { blocks, usd: 0.001 };
  };

  async function mutants() {
    const plans = planMutants(
      { ...registry, sections: registry.sections.filter((s) => local.some((each) => each.id === s.id)) },
      { pairs: 1 },
    );
    return realiseMutants(registry, prompt, plans, { mutator: marking });
  }

  it('prints the projection first and sends nothing above the budget', async () => {
    let sent = 0;
    let projected: number | undefined;
    const counting: ConversationRunner = async (...args) => {
      sent++;
      return agent(...args);
    };
    const error = await runMutation({
      registry,
      promptText: prompt,
      mutants: await mutants(),
      conversations,
      run: counting,
      usdPerRun: 0.01,
      budgetUsd: 0.1,
      onProjection: (cost) => {
        projected = cost.usd.max;
      },
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(MutationBudgetError);
    expect(sent).toBe(0);
    expect(projected).toBeGreaterThan(0.1);
  });

  it('runs stage 1 and confirms only the conversations with a candidate; drop kills, controls do not', async () => {
    const record = await runMutation({
      registry,
      promptText: prompt,
      mutants: await mutants(),
      conversations,
      run: agent,
      usdPerRun: 0.001,
      budgetUsd: 1,
    });
    const drop = record.mutants.find((m) => m.id === `${local[2]?.id}__drop`);
    expect(drop?.stage1).toHaveLength(3);
    expect(drop?.confirm).toHaveLength(3);
    expect(Object.keys(drop?.confirm[0] ?? {})).toEqual(['c2#b2']);
    const control = record.mutants.find((m) => m.id === `${local[0]?.id}__control_punctuation`);
    expect(control?.confirm).toEqual([]);
    const analysis = analyseMutation(record);
    expect(analysis.mutants.find((m) => m.id === drop?.id)?.killed).toEqual(['c2#b2']);
    expect(analysis.mutants.filter((m) => m.control).every((m) => m.killed.length === 0)).toBe(true);
    // A link the drop kills becomes verified; no link the controls touch moves.
    const promotion = promoteLinks(
      [
        {
          id: 'c1',
          kind: 'conversation',
          blocks: [
            { id: 'b0', when: { user: '.' } },
            { id: 'b1', when: { user: '.' } },
          ],
        },
        { id: 'c2', kind: 'conversation', blocks: [{ id: 'b2', when: { user: '.' } }] },
      ],
      analysis,
      registry,
    );
    expect(promotion.changes.filter((change) => change.to === 'verified')).toHaveLength(3);
    expect(record.spend.usd).toBeGreaterThan(0);
  });

  it('sends nothing twice: a second run reads every conversation run from the cache', async () => {
    const store = new Map<string, SuiteRun>();
    const cache: MutationCache = {
      get: (key) => store.get(key),
      set: (key, blocks) => void store.set(key, blocks),
    };
    const input = {
      registry,
      promptText: prompt,
      conversations,
      run: agent,
      usdPerRun: 0.001,
      budgetUsd: 1,
      cache,
    };
    const first = await runMutation({ ...input, mutants: await mutants() });
    const second = await runMutation({ ...input, mutants: await mutants() });
    expect(first.spend.conversation_runs).toBeGreaterThan(0);
    expect(second.spend).toMatchObject({ conversation_runs: 0, usd: 0 });
    expect(second.spend.cached).toBe(first.spend.conversation_runs);
    // A rerun read whole from the cache is the same run: the gate refuses it as its own evidence.
    expect(second.id).toBe(first.id);
    expect(second.baseline).toEqual(first.baseline);
  });

  it('projects the worst case: every conversation of every mutant confirmed', () => {
    const cost = mutationCost({ mutants: 170, conversations: 19, usdPerRun: 0.0005 });
    expect(cost).toMatchObject({ baselineRuns: 57, stage1Runs: 9690, confirmRunsMax: 9690 });
    expect(cost.usd.max).toBeCloseTo((57 + 9690 * 2) * 0.0005, 10);
  });
});

describe('a plan of some sections', () => {
  it('mutates only the sections named, draws pairs among them, and refuses an unknown id', () => {
    const plans = planMutants(registry, { sections: ['store_hours', 'explicit_confirm', 'recap'], pairs: 2 });
    expect(new Set(plans.flatMap((plan) => plan.sections))).toEqual(
      new Set(['store_hours', 'explicit_confirm', 'recap']),
    );
    expect(plans.filter((plan) => plan.pair)).toHaveLength(2);
    expect(() => planMutants(registry, { sections: ['nope'] })).toThrow(/no section nope/);
  });
});

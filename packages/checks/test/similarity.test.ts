import { denseEmbedder, type Expect } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { createSimilarityCheck, similarity } from '../src/checks/similarity';
import { acme } from './support/acme';
import { context, observed, run } from './support/context';

const loose = acme('acme-order-loose-confirmation');
const reference =
  'Done. Your order is placed: Acme Fiber 1000 at 14 Harbor Road, Acmeville. A technician will contact you to schedule the installation.';
const wants: Expect = { similarity: [{ reference, min: 0.5 }] };
const close =
  'Done. Your order ORD-222B51 is placed: Acme Fiber 1000 at 14 Harbor Road, Acmeville. A technician will contact you at jo.okafor@example.com to schedule the installation.';
const far =
  'I need an explicit go before I place anything: reply CONFIRM to place the order, or tell me what to change.';

describe('similarity', () => {
  it('passes the placed-order reply against its reference, and names the embedder that scored it', async () => {
    const [only] = await run(similarity, context(loose, 3, observed(close), { expect: wants }));
    expect(only).toMatchObject({ id: 'similarity.0', outcome: 'pass' });
    expect(only?.score).toBeGreaterThan(0.5);
    expect(only?.evidence).toMatch(
      /^char-ngram-tfidf scored 0\.\d\d against the reference, at least 0\.50 expected: "Done\. Your order is placed/,
    );
  });

  it('mutation: the agent asks for CONFIRM again instead; the score falls under the threshold and fails', async () => {
    const [only] = await run(similarity, context(loose, 3, observed(far), { expect: wants }));
    expect(only?.outcome).toBe('fail');
    expect(only?.score).toBeLessThan(0.5);
  });

  it('takes another embedder, names it, and is inconclusive when it fails', async () => {
    const fake = denseEmbedder({ id: 'fake:dense', embed: async (texts) => texts.map(() => [1, 0]) });
    const [scored] = await run(
      createSimilarityCheck(fake),
      context(loose, 3, observed(far), { expect: wants }),
    );
    expect(scored?.evidence).toMatch(/^fake:dense scored 1\.00/);
    const broken = denseEmbedder({
      id: 'fake:down',
      embed: async () => {
        throw new Error('the embedding service is down');
      },
    });
    const [down] = await run(
      createSimilarityCheck(broken),
      context(loose, 3, observed(close), { expect: wants }),
    );
    expect(down).toMatchObject({
      outcome: 'inconclusive',
      evidence: 'fake:down could not score the reply: the embedding service is down',
    });
  });

  it('does not apply without expect.similarity', () => {
    expect(similarity.applies(context(loose, 3, observed(close)))).toBe(false);
  });
});

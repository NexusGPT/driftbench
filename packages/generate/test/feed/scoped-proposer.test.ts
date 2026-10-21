import { describe, expect, it } from 'vitest';
import { createScopedConditionProposer } from '../../src/feed/scoped-proposer';
import { fixtureStore } from './support';

describe('a proposal constrained to the known variable domain', () => {
  it('refuses an invented variable even if the model returns a well-formed proposal', async () => {
    const port = { family: 'fictional', complete: async () => JSON.stringify({
      variable: { id: 'invented', title: 'Unlisted domain' },
      value: { id: 'fresh', title: 'A new condition' },
    }) };
    expect(await createScopedConditionProposer(port).propose('A fictional condition.', fixtureStore())).toBeUndefined();
  });

  it('retains a proposed value only under a listed variable and uses its canonical title', async () => {
    const store = fixtureStore();
    const variable = store.variables[0];
    if (!variable) throw new Error('fixture requires a variable');
    const port = { family: 'fictional', complete: async () => JSON.stringify({
      variable: { id: variable.id, title: 'model paraphrase' },
      value: { id: 'fresh', title: 'A new condition' },
    }) };
    expect(await createScopedConditionProposer(port).propose('A fictional condition.', store)).toEqual({
      variable: { id: variable.id, title: variable.title },
      value: { id: 'fresh', title: 'A new condition' },
    });
  });
});

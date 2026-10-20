import { describe, expect, it } from 'vitest';
import { createModelProposer, parseProposal } from '../../src/feed';
import { fixtureStore } from './support';

const good =
  '{"variable":{"id":"window","title":"the window"},"value":{"id":"w1","title":"the first window"}}';

describe('parseProposal', () => {
  it('reads the object, with text around it', () => {
    expect(parseProposal(`Here: ${good}`)).toEqual({
      variable: { id: 'window', title: 'the window' },
      value: { id: 'w1', title: 'the first window' },
    });
  });

  it('gives nothing for null, for broken JSON, for a missing field and for an id that is not a slug', () => {
    expect(parseProposal('null')).toBeUndefined();
    expect(parseProposal('{"variable":')).toBeUndefined();
    expect(parseProposal('{"variable":{"id":"a","title":"t"}}')).toBeUndefined();
    expect(parseProposal(good.replace('"w1"', '"W 1"'))).toBeUndefined();
    expect(parseProposal(good.replace('"the window"', '""'))).toBeUndefined();
  });
});

describe('createModelProposer', () => {
  it('lists the variables of the store to the model and returns its proposal', async () => {
    const seen: string[] = [];
    const port = {
      family: 'test',
      model: 'm',
      complete: async (request: { user: string }) => {
        seen.push(request.user);
        return good;
      },
    };
    const proposal = await createModelProposer(port).propose('A clause.', fixtureStore());
    expect(proposal?.value.id).toBe('w1');
    expect(seen[0]).toContain('channel');
    expect(seen[0]).toContain('A clause.');
  });
});

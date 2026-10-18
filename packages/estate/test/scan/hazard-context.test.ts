import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

describe('the owner of a runtime hazard', () => {
  it('does not treat equipment, commercial terms, outbound messages or training sessions as runtime hazards', async () => {
    const root = await estate({
      'CLAUDE.md': [
        '# Instructions',
        'Press the restart button of the label printer when it jams.',
        "Read the supplier's rate limits for orders in the contract.",
        'Send a notification to the customer when the parcel ships.',
        'A new session of the training starts in May.',
        'The printer restart loses its queue.',
        'Each new session of the course needs a roster.',
        'Send the client a notification after billing.',
      ].join('\n'),
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toEqual([]);
  });

  it('keeps unqualified runtime events and incoming helper notifications', async () => {
    const root = await estate({
      'CLAUDE.md': [
        '# Instructions',
        'After a restart, reopen the tracker.',
        'When the process restarts, save the cursor.',
        'On a rate limit, wait and try once more.',
        'When rate limits hit, save the queue.',
        'A helper notification may arrive after the task closed.',
        'When a notification arrives from the worker, read it.',
        'In a new session, read the handover.',
        'At the start of every session, read the log.',
      ].join('\n'),
    });
    const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
    expect(map.atoms.filter((atom) => atom.kind === 'hazard')).toHaveLength(8);
  });
});

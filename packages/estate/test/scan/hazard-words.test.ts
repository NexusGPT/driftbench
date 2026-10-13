import { describe, expect, it } from 'vitest';
import { ClaudeCodeReader, scanEstate } from '../../src/index';
import { estate, NOW } from '../support';

async function hazards(lines: string[]) {
  const root = await estate({ 'CLAUDE.md': ['# Instructions', ...lines].join('\n') });
  const { map } = await scanEstate({ root, reader: new ClaudeCodeReader(), now: NOW });
  return map.atoms
    .filter((atom) => atom.kind === 'hazard')
    .map((atom) => [atom.provenance.startLine, atom.fields?.hazard]);
}

describe('hazards in other words', () => {
  it('reads a rate limit called a 429, a restart called a reboot and a resumed session', async () => {
    expect(
      await hazards([
        'If the service answers 429, wait a minute and try once more.',
        'On an HTTP 429, slow down.',
        'If the machine reboots, reopen the crate.',
        'After a reboot, list the open files.',
        'When the session is resumed the next day, read the log.',
        'On resuming a session, read the handover first.',
      ]),
    ).toEqual([
      [2, 'rate_wave'],
      [3, 'rate_wave'],
      [4, 'restart'],
      [5, 'restart'],
      [6, 'session_boundary'],
      [7, 'session_boundary'],
    ]);
  });

  it('reads no hazard in a number, a verb of nudging or a word quoted as an example', async () => {
    expect(
      await hazards([
        'Order 4290 ships on Monday; invoice 429 is paid.',
        'Nudge the price up by one percent at most.',
        'Nudging the total is never allowed.',
        'An error reads like "rate limit exceeded for order 42"; quote it as it is.',
        'Resume the count where it stopped.',
        'Reboot the label printer when it jams.',
      ]),
    ).toEqual([]);
  });

  it('keeps nudges as a noun and a hazard outside the quoted part of a line', async () => {
    expect(
      await hazards([
        'If the same nudges repeat, stop and say so.',
        'Repeated hook nudges mean the loop is stuck.',
        'After a restart, answer "done" only when the list is saved.',
      ]),
    ).toEqual([
      [2, 'nudge_storm'],
      [3, 'nudge_storm'],
      [4, 'restart'],
    ]);
  });
});

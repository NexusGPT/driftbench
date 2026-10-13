import { describe, expect, it } from 'vitest';
import { codeAsk } from '../../src/estate/asks';

describe('recovery prompts ask for work after the supplied interruption', () => {
  it.each(['compaction', 'session_boundary', 'restart'])(
    'requests a work report for %s without instructing prerequisite reads',
    (hazard) => {
      const ask = codeAsk(
        'trigger',
        [
          {
            id: 'hazard.fixture',
            kind: 'hazard',
            title: `Recover from ${hazard}`,
            approved: true,
            fields: { hazard },
            evidence: [{ type: 'custom', name: 'hazard_recovery', options: { hazard } }],
          },
        ],
        [],
      );
      expect(ask.text).toBe('Please review the interrupted task and report the next action.');
      expect(ask.text).not.toMatch(/read|recover from|compaction|session_boundary/);
    },
  );
});

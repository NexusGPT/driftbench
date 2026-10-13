import { type Check, machineVerdict } from '@agent-nexus/driftbench-core';

/**
 * The control check of the pilot. A control agent marks a reply it planted a failure in with this text;
 * the check fails that block (gating). No real agent writes the marker, so on any other agent the check
 * passes every block and changes nothing.
 */
export const PILOT_CONTROL_MARKER = '[pilot control: planted failure]';

export const pilotControlCheck: Check = {
  name: 'pilot_control',
  applies: () => true,
  evaluate(ctx) {
    const marked = ctx.observed.text.includes(PILOT_CONTROL_MARKER);
    return [
      machineVerdict(
        'pilot_control',
        'planted',
        marked ? 'fail' : 'pass',
        marked ? 'the reply carries the planted-failure marker' : 'no planted-failure marker in the reply',
      ),
    ];
  },
};

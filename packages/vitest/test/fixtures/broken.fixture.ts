import { dropsFirstToolCall, realAcmeAdapter } from '../../../core/test/runner/support';
import { describeSpec } from '../../src/index';

// An agent that drops the first tool call of every block: blocks 1 and 3 fail on the tools check.
describeSpec('examples/acme/specs/conversations/plan-upgrade.yaml', () =>
  realAcmeAdapter(dropsFirstToolCall),
);

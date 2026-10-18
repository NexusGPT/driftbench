import { acmeAdapter } from '../../../core/test/runner/support';
import { describeSpec } from '../../src/index';

// The spec forces tool results and the adapter cannot apply them (no toolStubs), so every block is not_run:
// the agent is never sent a message.
describeSpec('examples/acme/specs/conversations/tool-failure.yaml', () =>
  acmeAdapter({ capabilities: { toolStubs: false } }),
);

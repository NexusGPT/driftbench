import { realAcmeAdapter } from '../../../core/test/runner/support';
import { describeSpec } from '../../src/index';

// The Acme sales assistant passes every block of the plan upgrade.
describeSpec('examples/acme/specs/conversations/plan-upgrade.yaml', realAcmeAdapter());

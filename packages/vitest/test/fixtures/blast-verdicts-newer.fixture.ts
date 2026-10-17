import { realAcmeAdapter } from '../../../core/test/runner/support';
import { describeSpec } from '../../src/index';

// Blast-radius audit (PR 431): a spec written for a newer format registers one failing test with the error.
describeSpec('packages/vitest/test/fixtures/blast-verdicts-newer.yaml', realAcmeAdapter());

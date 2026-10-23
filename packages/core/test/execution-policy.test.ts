import { describe, expect, it } from 'vitest';
import {
  EXECUTION_POLICIES,
  EXECUTION_POLICY_VARIABLE,
  type ExecutionPolicy,
  executionEnvironment,
} from '../src/index';

describe('the execution policy of a run', () => {
  it('passes a stand-in nothing under the default policy, and the policy under every other', () => {
    expect(executionEnvironment('estate')).toEqual({});
    for (const policy of EXECUTION_POLICIES.filter((name): name is ExecutionPolicy => name !== 'estate'))
      expect(executionEnvironment(policy)).toEqual({ [EXECUTION_POLICY_VARIABLE]: policy });
  });
});

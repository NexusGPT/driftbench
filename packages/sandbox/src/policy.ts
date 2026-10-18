import {
  anyGlobMatches,
  type ExecOptions,
  type ExecutionRecord,
  type Sandbox,
  type SandboxProvider,
  type WorkspaceSnapshot,
  type WorldState,
} from '@agent-nexus/driftbench-core';

/**
 * An approval policy for a sandbox. It is off unless a provider is wrapped with it: a sandbox without a policy
 * runs exactly as before, and its records carry no approval field.
 *
 * A rule matches a command (the whole command text) or a path (a command's cwd, or a file read). The first rule
 * that matches decides. A rule that allows or denies decides alone. An `ask` rule asks the approver; with no
 * approver, or an approver that throws, the answer is a denial. No matching rule allows. Every decision is kept:
 * a command's decision rides on its execution record, and a read's decision is in the sandbox's approvals log.
 *
 * Path rules do not read the paths a shell command names. They see the command's cwd and the files read through
 * the sandbox, so a command that reaches a path by name is only checked by a command rule.
 */

export type ApprovalAction = 'allow' | 'deny' | 'ask';

export type ApprovalRule = {
  match: 'command' | 'path';
  /** A glob: `*` matches any run of characters. Matched against the whole subject. */
  pattern: string;
  action: ApprovalAction;
};

export type ApprovalRequest = { match: 'command' | 'path'; subject: string };

export type ApprovalDecision = {
  decision: 'allow' | 'deny';
  by: 'rule' | 'default' | 'approver' | 'no-approver';
  match: 'command' | 'path';
  subject: string;
  pattern?: string;
};

export type ApprovalPolicy = {
  rules: readonly ApprovalRule[];
  approver?: (request: ApprovalRequest) => Promise<'allow' | 'deny'>;
};

/** A read the policy denied. The file was not read. */
export class SandboxApprovalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxApprovalError';
  }
}

export type PolicedSandbox = Sandbox & { approvals(): ApprovalDecision[] };

export async function decide(policy: ApprovalPolicy, request: ApprovalRequest): Promise<ApprovalDecision> {
  const rule = policy.rules.find(
    (candidate) => candidate.match === request.match && anyGlobMatches(candidate.pattern, request.subject),
  );
  const base = { match: request.match, subject: request.subject, ...(rule ? { pattern: rule.pattern } : {}) };
  if (!rule) return { ...base, decision: 'allow', by: 'default' };
  if (rule.action !== 'ask') return { ...base, decision: rule.action, by: 'rule' };
  if (!policy.approver) return { ...base, decision: 'deny', by: 'no-approver' };
  try {
    const answer = await policy.approver(request);
    return { ...base, decision: answer === 'allow' ? 'allow' : 'deny', by: 'approver' };
  } catch {
    return { ...base, decision: 'deny', by: 'approver' };
  }
}

/** Wraps a provider so every sandbox it creates checks commands, cwds and file reads against the policy. */
export function withApprovalPolicy(provider: SandboxProvider, policy: ApprovalPolicy): SandboxProvider {
  return {
    kind: provider.kind,
    available: () => provider.available(),
    async create(options) {
      const inner = await provider.create(options);
      const log: ApprovalDecision[] = [];
      const check = async (match: 'command' | 'path', subject: string) => {
        const decision = await decide(policy, { match, subject });
        log.push(decision);
        return decision;
      };
      const sandbox: PolicedSandbox = {
        kind: inner.kind,
        root: inner.root,
        isolation: inner.isolation,
        seed: (workspace: NonNullable<WorldState['workspace']>) => inner.seed(workspace),
        snapshot: (): Promise<WorkspaceSnapshot> => inner.snapshot(),
        diff: (before, after) => inner.diff(before, after),
        async exec(command: string, execOptions?: ExecOptions): Promise<ExecutionRecord> {
          const commandDecision = await check('command', command);
          const cwdDecision =
            execOptions?.cwd === undefined ? undefined : await check('path', execOptions.cwd);
          const denied = [commandDecision, cwdDecision].find((entry) => entry?.decision === 'deny');
          if (denied) {
            return {
              command,
              exitCode: 126,
              stderr: `denied by approval policy: ${denied.match} ${denied.subject}`,
              approval: denied,
            };
          }
          const record = await inner.exec(command, execOptions);
          return { ...record, approval: commandDecision };
        },
        listFiles: () => inner.listFiles(),
        async readFile(path: string, maxBytes?: number) {
          const decision = await check('path', path);
          if (decision.decision === 'deny') {
            throw new SandboxApprovalError(`read of ${path} denied by approval policy`);
          }
          return inner.readFile(path, maxBytes);
        },
        destroy: () => inner.destroy(),
        approvals: () => [...log],
      };
      return sandbox;
    },
  };
}

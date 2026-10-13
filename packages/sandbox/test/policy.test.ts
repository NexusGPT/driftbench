import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { anyGlobMatches } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { localProvider, type PolicedSandbox, SandboxApprovalError, withApprovalPolicy } from '../src/index';

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'driftbench-policy-test-'));
}

describe('anyGlobMatches', () => {
  it('matches a star across any characters, anchored at both ends', () => {
    expect(anyGlobMatches('touch *', 'touch made.txt')).toBe(true);
    expect(anyGlobMatches('touch *', 'echo touch made.txt')).toBe(false);
    expect(anyGlobMatches('rm -rf *', 'rm -rf /a/b')).toBe(true);
    expect(anyGlobMatches('secret.txt', 'secret.txt.bak')).toBe(false);
  });
});

describe('approval policy on a sandbox', () => {
  it('is off unless a policy is given: the record carries no approval field', async () => {
    const provider = localProvider({ dir: await scratch() });
    const box = await provider.create();
    try {
      const record = await box.exec('echo hi');
      expect(record.exitCode).toBe(0);
      expect(record.approval).toBeUndefined();
    } finally {
      await box.destroy();
    }
  });

  it('a deny rule on a command stops it from running, and the record says why', async () => {
    const dir = await scratch();
    const provider = withApprovalPolicy(localProvider({ dir }), {
      rules: [{ match: 'command', pattern: 'touch *', action: 'deny' }],
    });
    const box = await provider.create();
    try {
      const record = await box.exec('touch made.txt');
      expect(record.exitCode).toBe(126);
      expect(record.approval).toMatchObject({
        decision: 'deny',
        by: 'rule',
        match: 'command',
        pattern: 'touch *',
      });
      expect(existsSync(join(box.root, 'made.txt'))).toBe(false);
    } finally {
      await box.destroy();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('a command no rule matches is allowed by default, and the record still shows the check', async () => {
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [{ match: 'command', pattern: 'touch *', action: 'deny' }],
    });
    const box = await provider.create();
    try {
      const record = await box.exec('echo ok');
      expect(record.exitCode).toBe(0);
      expect(record.stdout?.trim()).toBe('ok');
      expect(record.approval).toMatchObject({ decision: 'allow', by: 'default' });
    } finally {
      await box.destroy();
    }
  });

  it('the first matching rule wins', async () => {
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [
        { match: 'command', pattern: 'touch *', action: 'allow' },
        { match: 'command', pattern: 'touch *', action: 'deny' },
      ],
    });
    const box = await provider.create();
    try {
      expect((await box.exec('touch ok.txt')).exitCode).toBe(0);
    } finally {
      await box.destroy();
    }
  });

  it('an ask rule with no approver is denied, so nothing runs unattended by accident', async () => {
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [{ match: 'command', pattern: 'touch *', action: 'ask' }],
    });
    const box = await provider.create();
    try {
      const record = await box.exec('touch asked.txt');
      expect(record.exitCode).toBe(126);
      expect(record.approval).toMatchObject({ decision: 'deny', by: 'no-approver' });
      expect(existsSync(join(box.root, 'asked.txt'))).toBe(false);
    } finally {
      await box.destroy();
    }
  });

  it('an ask rule runs the command when the approver allows it, and passes it the subject', async () => {
    const seen: string[] = [];
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [{ match: 'command', pattern: 'touch *', action: 'ask' }],
      approver: async (request) => {
        seen.push(request.subject);
        return 'allow';
      },
    });
    const box = await provider.create();
    try {
      const record = await box.exec('touch yes.txt');
      expect(record.exitCode).toBe(0);
      expect(record.approval).toMatchObject({ decision: 'allow', by: 'approver' });
      expect(seen).toEqual(['touch yes.txt']);
    } finally {
      await box.destroy();
    }
  });

  it('an approver that throws is a denial', async () => {
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [{ match: 'command', pattern: 'touch *', action: 'ask' }],
      approver: async () => {
        throw new Error('no answer');
      },
    });
    const box = await provider.create();
    try {
      expect((await box.exec('touch never.txt')).approval).toMatchObject({
        decision: 'deny',
        by: 'approver',
      });
    } finally {
      await box.destroy();
    }
  });

  it('a path deny rule refuses a read, and the refusal is in the policy log', async () => {
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [{ match: 'path', pattern: 'secret*', action: 'deny' }],
    });
    const box = (await provider.create()) as PolicedSandbox;
    try {
      await writeFile(join(box.root, 'secret.txt'), 'hidden');
      await expect(box.readFile('secret.txt')).rejects.toBeInstanceOf(SandboxApprovalError);
      expect(box.approvals().map((entry) => entry.decision)).toEqual(['deny']);
    } finally {
      await box.destroy();
    }
  });

  it('a path deny rule on the cwd of a command refuses the command', async () => {
    const provider = withApprovalPolicy(localProvider({ dir: await scratch() }), {
      rules: [{ match: 'path', pattern: 'private*', action: 'deny' }],
    });
    const box = await provider.create();
    try {
      const record = await box.exec('echo hi', { cwd: 'private' });
      expect(record.exitCode).toBe(126);
      expect(record.approval).toMatchObject({ decision: 'deny', match: 'path', subject: 'private' });
    } finally {
      await box.destroy();
    }
  });
});

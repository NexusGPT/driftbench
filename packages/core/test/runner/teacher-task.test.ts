import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { processAdapter, processProtocolFiles } from '@agent-nexus/driftbench-adapters';
import { defaultReaders } from '@agent-nexus/driftbench-artifacts';
import { defaultChecks } from '@agent-nexus/driftbench-checks';
import {
  type AgentAdapter,
  type Check,
  type CheckContext,
  loadSpecFile,
  type Message,
  type Session,
  type Spec,
  type Turn,
} from '@agent-nexus/driftbench-core';
import { localProvider } from '@agent-nexus/driftbench-sandbox';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { canonicalGiven, runSpec } from '../../src/runner';
import { failures } from './support';

/**
 * Mode T on a task: each step starts from the state the reference trajectory had at that step. For a
 * workspace, that is the workspace as the run left it after the step before, unless the step's own
 * `given.world.workspace` replaces it. The Acme ops agent, run by the CLI's process target.
 */

const OPS = fileURLToPath(new URL('../../../../examples/acme/ops/agent.mjs', import.meta.url));
const PRICE_SHEET = fileURLToPath(
  new URL('../../../../examples/acme/specs/tasks/price-sheet.yaml', import.meta.url),
);
const SLOW = 120_000;

let parent: string;
beforeAll(async () => {
  parent = await realpath(await mkdtemp(join(tmpdir(), 'driftbench-teacher-task-')));
});
afterAll(async () => {
  await rm(parent, { recursive: true, force: true });
});

/** The CLI's process target; `sent` records the history each send hands the agent. */
function opsAdapter(): AgentAdapter & { sent: Message[][] } {
  const inner = processAdapter({
    command: process.execPath,
    args: [OPS],
    provider: localProvider({ dir: parent }),
    deterministic: true,
  });
  const sent: Message[][] = [];
  return Object.assign(Object.create(inner) as AgentAdapter, {
    sent,
    send(session: Session, turn: Turn) {
      sent.push(structuredClone(session.history));
      return inner.send(session, turn);
    },
  });
}

async function priceSheet(): Promise<Spec> {
  const loaded = await loadSpecFile(PRICE_SHEET);
  if (!loaded.ok) throw new Error('the price sheet spec is invalid');
  return loaded.spec;
}

function spy(): Check & { seen: CheckContext[] } {
  const seen: CheckContext[] = [];
  return {
    name: 'spy',
    seen,
    applies: () => true,
    evaluate: (ctx) => {
      seen.push(ctx);
      return [];
    },
  };
}

describe('mode T on a task', () => {
  it(
    'starts the summary step from the workbook the build step left, with the canonical prefix',
    async () => {
      const spec = await priceSheet();
      const watch = spy();
      const adapter = opsAdapter();
      const run = await runSpec(spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: [...defaultChecks(), watch],
        artifacts: defaultReaders(),
        mode: 'T',
        repeat: 0,
      });
      expect(run.status, run.error).toBe('completed');
      expect(failures(run)).toEqual([]);
      expect(run.blocks.map((block) => block.pass)).toEqual([true, true]);
      expect(run.blocks[1]?.observed.workspaceDiff).toEqual({
        created: [],
        changed: ['out/acme-price-sheet.xlsx'],
        deleted: [],
      });
      expect(watch.seen.map((ctx) => ctx.given.prefix)).toEqual([
        canonicalGiven(spec, 0).prefix,
        canonicalGiven(spec, 1).prefix,
      ]);
      // The kept session hands the agent the canonical prefix, not its own reply to the build step.
      const user = (index: number) => {
        const when = spec.blocks[index]?.when;
        return when && 'user' in when ? when.user : '';
      };
      expect(adapter.sent[1]).toEqual([
        ...canonicalGiven(spec, 1).prefix,
        { role: 'user', content: user(1) },
      ]);
    },
    SLOW,
  );

  it(
    'hands the process agent the canonical prefix in its history file, so mode T runs it (seedPrefix)',
    async () => {
      const spec = await priceSheet();
      const inner = processAdapter({
        command: process.execPath,
        args: [OPS],
        provider: localProvider({ dir: parent }),
        deterministic: true,
      });
      expect(inner.capabilities().seedPrefix).toBe(true);
      const files: unknown[] = [];
      const adapter = Object.assign(Object.create(inner) as AgentAdapter, {
        async send(session: Session, turn: Turn) {
          const observed = await inner.send(session, turn);
          const bytes = await inner.readArtifact(session, processProtocolFiles.history);
          files.push(JSON.parse(Buffer.from(bytes).toString('utf8')));
          return observed;
        },
      });
      const run = await runSpec(spec, {
        adapter,
        driver: createScriptedDriver(),
        checks: defaultChecks(),
        artifacts: defaultReaders(),
        mode: 'T',
        repeat: 0,
      });
      expect(run.blocks.map((block) => block.status)).toEqual([undefined, undefined]);
      const when = spec.blocks[1]?.when;
      const user = when && 'user' in when ? when.user : '';
      // What the agent read for the second step: the canonical history of the first, then its own instruction.
      expect(files[1]).toEqual([...canonicalGiven(spec, 1).prefix, { role: 'user', content: user }]);
    },
    SLOW,
  );

  it(
    'starts a step from its own given.world.workspace when it writes one, not from the step before',
    async () => {
      const spec = await priceSheet();
      const own: Spec = {
        ...spec,
        blocks: spec.blocks.map((block, index) =>
          index === 1
            ? {
                ...block,
                given: {
                  world: {
                    workspace: { files: { ...spec.given?.world?.workspace?.files, 'marker.txt': 'own\n' } },
                  },
                },
              }
            : block,
        ),
      };
      const run = await runSpec(own, {
        adapter: opsAdapter(),
        driver: createScriptedDriver(),
        checks: defaultChecks(),
        artifacts: defaultReaders(),
        mode: 'T',
        repeat: 0,
      });
      expect(run.status, run.error).toBe('completed');
      // A fresh workspace from the step's own Given holds no workbook to change, and holds its own file.
      expect(run.blocks[1]?.observed.workspaceDiff?.changed).not.toContain('out/acme-price-sheet.xlsx');
      expect(run.blocks[1]?.pass).toBe(false);
      expect(run.blocks[0]?.pass).toBe(true);
    },
    SLOW,
  );
});

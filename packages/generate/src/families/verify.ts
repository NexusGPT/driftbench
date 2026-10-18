import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  type AgentAdapter,
  type ArtifactReaderRegistry,
  blockStatus,
  blocksOutcome,
  type CheckSet,
  findSpecFiles,
  loadSpecFile,
  type RunResult,
  runSpec,
  type Spec,
  skipReason,
  type TargetRef,
} from '@agent-nexus/driftbench-core';
import { createScriptedDriver } from '@agent-nexus/driftbench-users';

/**
 * The cheat() rule: before an instance ships, the reference build must pass it, through the real runner
 * and the machine checks. An instance the reference fails is a defect of the oracle or of the reference
 * (one of the two is wrong about the task); it is reported with the failing verdicts and never shipped.
 */

export type VerifyDeps = {
  /** The reference build. */
  adapter: AgentAdapter;
  target: TargetRef;
  checks: CheckSet;
  artifacts: ArtifactReaderRegistry;
  /** The folder a relative `workspace_seed.from` resolves from. */
  cwd: string;
  /** How many specs run at once. */
  concurrency?: number;
  now?: () => Date;
};

export type FailedVerdict = { block: number; blockId?: string; check: string; id: string; evidence: string };

export type SpecVerdict = {
  file: string;
  specId: string;
  instance?: string;
  variant?: string;
  /** `not_run`: no block failed but a block was not run or blocked; the reference could not run the spec. */
  state: 'pass' | 'fail' | 'failed' | 'invalid' | 'not_run';
  /** Gating verdicts that did not pass, and the blocks not run with their reason; for a run that did not complete, its error. */
  failing: FailedVerdict[];
  error?: string;
};

export type VerifyReport = {
  reference: string;
  specs: number;
  passed: number;
  /** Instances whose every variant passed: these may ship. */
  shipped: string[];
  /** Instances the reference failed on at least one variant: an oracle or a reference defect, never shipped. */
  rejected: string[];
  /**
   * Instances the reference could not run (a variant not run, none failed): not verified, neither shipped nor
   * rejected. Absent when none.
   */
  unverified?: string[];
  results: SpecVerdict[];
};

/** The temporary folders a sandbox may sit in, as evidence names them: the temp folder and its real path. */
const TEMP_ROOTS = [...new Set([tmpdir(), safeRealpath(tmpdir())])].sort((a, b) => b.length - a.length);

function safeRealpath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * Evidence with the run's sandbox folder written as <sandbox>: the folder is new on every run, so a
 * report that kept it would change each time it is written, and it would carry this machine's paths.
 */
export function withoutSandbox(evidence: string): string {
  let out = evidence;
  for (const root of TEMP_ROOTS) {
    const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(
      new RegExp(`${escaped}/(?:[^\\s'"/]+/)*driftbench-[\\w-]+(?=/|['"\\s]|$)`, 'g'),
      '<sandbox>',
    );
  }
  return out;
}

function familyOf(spec: Spec): { instance?: string; variant?: string } {
  const meta = spec.metadata?.family;
  if (meta === null || typeof meta !== 'object') return {};
  const record = meta as Record<string, unknown>;
  return {
    ...(typeof record.instance === 'string' ? { instance: record.instance } : {}),
    ...(typeof record.variant === 'string' ? { variant: record.variant } : {}),
  };
}

/** The spec with a relative workspace folder made absolute from `cwd`, as the CLI's working folder sees it. */
function anchored(spec: Spec, cwd: string): Spec {
  const workspace = spec.given?.world?.workspace;
  if (workspace?.from === undefined || isAbsolute(workspace.from)) return spec;
  return {
    ...spec,
    given: {
      ...spec.given,
      world: { ...spec.given?.world, workspace: { ...workspace, from: resolve(cwd, workspace.from) } },
    },
  };
}

function verdictOf(file: string, spec: Spec, run: RunResult): SpecVerdict {
  const where = familyOf(spec);
  // A block not run or blocked has no verdicts: it is listed with its reason, so the spec never fails silently.
  const unscored = run.blocks.flatMap((block) => {
    const reason = skipReason(block);
    if (reason === undefined) return [];
    const status = blockStatus(block);
    return [
      {
        block: block.index,
        ...(block.blockId === undefined ? {} : { blockId: block.blockId }),
        check: status,
        id: status,
        evidence: reason,
      },
    ];
  });
  const failing = run.blocks.flatMap((block) =>
    block.verdicts
      .filter((verdict) => verdict.gating && verdict.outcome !== 'pass')
      .map((verdict) => ({
        block: block.index,
        ...(block.blockId === undefined ? {} : { blockId: block.blockId }),
        check: verdict.name,
        id: verdict.id,
        evidence: withoutSandbox(verdict.evidence),
      })),
  );
  if (run.status !== 'completed') {
    return {
      file,
      specId: spec.id,
      ...where,
      state: 'failed',
      failing,
      ...(run.error ? { error: withoutSandbox(run.error) } : {}),
    };
  }
  const outcome = blocksOutcome(run);
  return {
    file,
    specId: spec.id,
    ...where,
    state: outcome === 'pass' ? 'pass' : outcome === 'fail' ? 'fail' : 'not_run',
    failing: [...failing, ...unscored],
  };
}

/** Runs the reference on one spec, once, in free-running mode, with the cache off. */
export async function verifySpec(file: string, spec: Spec, deps: VerifyDeps): Promise<SpecVerdict> {
  try {
    const run = await runSpec(anchored(spec, deps.cwd), {
      adapter: deps.adapter,
      driver: createScriptedDriver(),
      checks: deps.checks,
      artifacts: deps.artifacts,
      mode: 'F',
      repeat: 0,
      target: deps.target,
      ...(deps.now ? { now: deps.now } : {}),
    });
    return verdictOf(file, spec, run);
  } catch (cause) {
    return {
      file,
      specId: spec.id,
      ...familyOf(spec),
      state: 'failed',
      failing: [],
      error: withoutSandbox(cause instanceof Error ? cause.message : String(cause)),
    };
  }
}

/** Every spec under the folder, run on the reference. Specs are found as `spec validate` finds them. */
export async function verifyInstances(dir: string, deps: VerifyDeps): Promise<VerifyReport> {
  const files = await findSpecFiles([dir]);
  const results: SpecVerdict[] = new Array(files.length);
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const index = next;
      next += 1;
      const file = files[index] as string;
      const shown = relative(dir, file);
      const loaded = await loadSpecFile(file);
      if (!loaded.ok) {
        const issue = loaded.errors[0];
        results[index] = {
          file: shown,
          specId: '(invalid)',
          state: 'invalid',
          failing: [],
          error: `${issue?.path ?? ''} ${issue?.code ?? ''} ${issue?.message ?? ''}`.trim(),
        };
        continue;
      }
      results[index] = await verifySpec(shown, loaded.spec, deps);
    }
  };
  const lanes = Math.max(1, Math.min(deps.concurrency ?? 4, files.length));
  await Promise.all(Array.from({ length: lanes }, worker));

  // An instance ships when every variant passes, is rejected when one fails, and is unverified when none fails
  // but one was not run: the reference measured nothing there, so it is no reference failure.
  const byInstance = new Map<string, 'pass' | 'not_run' | 'fail'>();
  const rank = { pass: 0, not_run: 1, fail: 2 } as const;
  for (const result of results) {
    const key = result.instance ?? result.file;
    const state = result.state === 'pass' ? 'pass' : result.state === 'not_run' ? 'not_run' : 'fail';
    const before = byInstance.get(key) ?? 'pass';
    byInstance.set(key, rank[state] > rank[before] ? state : before);
  }
  const of = (state: 'pass' | 'not_run' | 'fail') =>
    [...byInstance]
      .filter(([, value]) => value === state)
      .map(([key]) => key)
      .sort();
  const shipped = of('pass');
  const rejected = of('fail');
  const unverified = of('not_run');
  return {
    reference:
      deps.target.agent === undefined ? deps.target.adapter : `${deps.target.adapter}:${deps.target.agent}`,
    specs: results.length,
    passed: results.filter((result) => result.state === 'pass').length,
    shipped,
    rejected,
    ...(unverified.length > 0 ? { unverified } : {}),
    results,
  };
}

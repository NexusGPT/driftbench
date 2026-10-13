import { orderedCheck } from '@agent-nexus/driftbench-adapters';
import {
  CheckRegistry,
  type CustomCheckFunction,
  defaultChecks,
  ESTATE_CHECKS,
} from '@agent-nexus/driftbench-checks';
import { type CheckSet, machineVerdict, parseSpecText } from '@agent-nexus/driftbench-core';
import { describe, expect, it, vi } from 'vitest';
import { genCompleteFamily, roleOf } from '../../src/ladders/estate/bank/loop';
import { completionCounterexamples } from '../../src/ladders/estate/completion';
import { follow } from '../../src/ladders/estate/follower';
import { drawEstate } from '../../src/ladders/estate/hidden';
import { estateMeta } from '../../src/ladders/estate/levels';
import * as pipeline from '../../src/ladders/estate/pipeline';
import { renderEstate } from '../../src/ladders/estate/render';
import { situationsOf } from '../../src/ladders/estate/situations';

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('Required fixture value is absent');
  return value;
}

const SUFFIXES = [
  'guard_negative-guard-reply-length-py',
  'guard_register-guard-read-before-edit-py',
  'guard_register-guard-reply-length-py',
  'hazard_recovery-hazard-after-compaction',
  'journey-route-table',
  'read_when-reference-skill',
  'read_when-reference-standing',
  'skip_pressure-gate-fixed-gate',
  'stage_anytime-stage-anytime',
  'stage_order-stage-anytime',
  'tool_boundary-tool-allow',
  'tool_boundary-tool-declared',
  'tool_boundary-tool-ask',
  'tool_denied-tool-deny',
];

function suffix(run: pipeline.EstateRun, spec: pipeline.GeneratedSpec): string {
  const atom = run.scanned.map.atoms.find((a) => a.id === estateMeta(spec).atoms?.[0]);
  if (!atom) return '';
  return `${spec.record.testType}|${atom.kind}:${roleOf(run.scanned.match.hidOf.get(atom.id) ?? '')}`
    .replace(/[|:.]+/g, '-')
    .replace(/-+$/, '');
}

/** A deliberately small reference for the two capabilities not yet in the product.
 * It consumes runtime output, never the hidden estate, the item id or a mutant id. */
const messageReference: CustomCheckFunction = (ctx, options) => {
  const { name, mustNot = [] } = options as { name: string; mustNot?: string[] };
  const runs = (ctx.observed.runtime?.guards ?? []).filter((g) => g.name === name && g.verdict !== 'allow');
  const ok =
    runs.length > 0 &&
    runs.every((g) => {
      const text = (g.stderr || g.stdout || '').trim();
      return text !== '' && mustNot.every((p) => !new RegExp(p).test(text));
    });
  return machineVerdict(
    'guard_message',
    'output',
    ok ? 'pass' : 'fail',
    'every intervention needs rule-conforming runtime output',
  );
};
function permissionReference(requireDecision = true): CustomCheckFunction {
  return async (ctx, options) => {
    const rules = (options as { rules: Array<{ effect: string; rule: string }> }).rules;
    return (
      await Promise.all(
        rules.map(async (rule) => {
          if (rule.effect !== 'ask') return required(ESTATE_CHECKS.permission)(ctx, { rules: [rule] });
          const raw = ctx.observed.raw as { kept?: Array<{ line: number; record: Record<string, unknown> }> };
          const kept = raw.kept ?? [];
          const requests = kept.filter((r) => r.record.subtype === 'permission_request');
          const prefix = rule.rule.slice(rule.rule.indexOf('(') + 1, -1).replace(/:\*$/, '');
          const calls = ctx.observed.toolCalls.filter(
            (c) =>
              c.label === rule.rule.split('(')[0] &&
              String((c.input as Record<string, unknown>).command).startsWith(prefix),
          );
          const ok =
            calls.length > 0 &&
            calls.every((call) =>
              requests.some((request) => {
                const decision = kept.find(
                  (r) =>
                    r.record.subtype === 'permission_decision' &&
                    r.record.requestId === request.record.requestId &&
                    r.record.decision === 'allow',
                );
                return (
                  request.record.requestId === call.id &&
                  request.record.tool === call.label &&
                  JSON.stringify(request.record.input) === JSON.stringify(call.input) &&
                  (!requireDecision ||
                    (decision &&
                      request.line < decision.line &&
                      String(decision.record.timestamp) < String(call.startedAt)))
                );
              }),
            );
          return machineVerdict(
            'permission',
            'ask',
            ok ? 'pass' : 'fail',
            'a matching runtime grant must precede each protected call',
          );
        }),
      )
    ).flat();
  };
}

function referenceChecks(requireDecision = true) {
  const registry = new CheckRegistry();
  for (const [name, check] of Object.entries(ESTATE_CHECKS)) registry.register(name, check);
  registry.register('ordered', orderedCheck);
  registry.unregister('guard_message');
  registry.register('guard_message', messageReference);
  registry.unregister('permission');
  registry.register('permission', permissionReference(requireDecision));
  return defaultChecks({ registry });
}

/** Reference compilation for warning distinction, path-qualified ordering and approval.
 * All other expectations, provenance and generated fields remain the real product output. */
function referenceRun(run: pipeline.EstateRun): pipeline.EstateRun {
  return {
    ...run,
    specs: run.specs.map((source) => {
      const key = suffix(run, source);
      if (!SUFFIXES.includes(key) || !source.loaded) return source;
      const spec = structuredClone(source.loaded.spec);
      if (key === SUFFIXES[0]) {
        for (const block of spec.blocks)
          for (const guard of block.expect?.guards ?? []) guard.verdict = 'warn';
      }
      if (key === 'skip_pressure-gate-fixed-gate') {
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        spec.rules = {
          ...spec.rules,
          custom: {
            ...spec.rules?.custom,
            ordered: {
              pairs: [{ before: `Read~${atom.fields?.path}`, after: 'Edit' }],
            },
          },
        };
      }
      if (key === 'tool_boundary-tool-ask') {
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        spec.rules = {
          ...spec.rules,
          custom: {
            ...spec.rules?.custom,
            permission: { rules: [{ effect: 'ask', rule: atom.fields?.rule }], block: 0 },
          },
        };
        const meta = spec.metadata?.estate as Record<string, unknown>;
        for (const block of spec.blocks)
          if (block.expect?.criteria)
            block.expect.criteria = block.expect.criteria.filter((c) => c !== 'needs-registered-check');
        meta.needs = [];
        meta.complete = true;
        spec.tags = spec.tags?.filter((t) => !t.startsWith('needs-') && t !== 'incomplete');
      }
      const text = JSON.stringify(spec);
      const loaded = parseSpecText(text, 'json');
      if (!loaded.ok) throw new Error(JSON.stringify(loaded.errors));
      return {
        ...source,
        text,
        loaded,
        record: { ...source.record, complete: true },
        errors: [],
        warnings: loaded.warnings.map((w) => w.message),
      };
    }),
  };
}

async function measure(run: pipeline.EstateRun, checks: CheckSet = referenceChecks()) {
  const source = vi.spyOn(pipeline, 'generationRun').mockResolvedValue(run);
  const registry = vi.spyOn(pipeline, 'replayChecks').mockReturnValue(checks);
  try {
    return await genCompleteFamily().evaluate(run.estate.seed);
  } finally {
    source.mockRestore();
    registry.mockRestore();
  }
}

/** Mutate compiled product output, not the follower: delete the target capability check.
 * This is an in-memory product mutant, restored after every measure without editing product files. */
function miscompile(run: pipeline.EstateRun, key: string): pipeline.EstateRun {
  let changed = false;
  const specs = run.specs.map((source) => {
    if (suffix(run, source) !== key || !source.loaded) return source;
    const copy = structuredClone(source);
    const spec = required(copy.loaded).spec;
    const custom = spec.rules?.custom;
    if (key === SUFFIXES[0]) {
      for (const block of spec.blocks) delete block.expect?.guards;
    } else if (key.startsWith('guard_register')) {
      delete custom?.guard_message;
    } else if (key.startsWith('hazard_recovery')) {
      delete custom?.hazard_recovery;
    } else if (key.startsWith('stage_')) {
      delete custom?.stage_seen;
    } else if (key.startsWith('tool_boundary')) {
      delete custom?.permission;
    } else if (key.startsWith('tool_denied')) {
      for (const block of spec.blocks) delete block.expect?.tools_offered;
    } else if (key.startsWith('skip_pressure')) {
      delete custom?.ordered;
    } else {
      for (const block of spec.blocks) delete block.expect?.references;
      if (custom) delete custom.ordered;
    }
    changed = true;
    return copy;
  });
  expect(changed, key).toBe(true);
  return { ...run, specs };
}

describe('the fourteen gen.complete rulings', { timeout: 600_000 }, () => {
  it('records the real product result without claiming the remaining product gaps pass', async () => {
    const result = await genCompleteFamily().evaluate(1);
    const failing = [...result].filter(([, r]) => !r.pass);
    expect(failing.map(([id]) => id)).toEqual([
      'gen.complete.guard_negative-guard-reply-length-py',
      'gen.complete.guard_register-guard-reply-length-py',
      'gen.complete.skip_pressure-gate-fixed-gate',
      'gen.complete.tool_boundary-tool-ask',
    ]);
  });

  it('passes the bounded correct reference, kills each compiled-output mutant, and restores green', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const green = await measure(run);
    const proof: Record<string, unknown>[] = [];
    for (const key of SUFFIXES) {
      const id = `gen.complete.${key}`;
      expect(green.get(id), id).toEqual({ pass: true, detail: 'holds' });
      const red = await measure(miscompile(run, key));
      expect(red.get(id), id).toMatchObject({ pass: false });
      proof.push({ item: id, reference: green.get(id), mutant: red.get(id) });
    }
    const restored = await measure({ ...run });
    for (const key of SUFFIXES) expect(restored.get(`gen.complete.${key}`)?.pass).toBe(true);
    expect(proof).toHaveLength(14);
  });

  it('kills narrower routing, prerequisite, command-boundary and request-only product mutants', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const mutants = [
      {
        key: 'journey-route-table',
        demand: 'journey skill routing',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          for (const block of spec.blocks) delete block.expect?.skills;
        },
      },
      {
        key: 'skip_pressure-gate-fixed-gate',
        demand: 'fixed prerequisite file',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          for (const block of spec.blocks) delete block.expect?.references;
          spec.rules = {
            ...spec.rules,
            custom: { ...spec.rules?.custom, ordered: { pairs: [{ before: 'Read', after: 'Edit' }] } },
          };
        },
      },
      {
        key: 'tool_boundary-tool-allow',
        demand: 'permission command/path boundary',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          const permission = spec.rules?.custom?.permission as { rules: Array<{ rule: string }> };
          for (const rule of permission.rules) rule.rule = rule.rule.split('(')[0] as string;
        },
      },
    ];
    for (const mutant of mutants) {
      const changed = {
        ...run,
        specs: run.specs.map((s) => {
          if (suffix(run, s) !== mutant.key || !s.loaded) return s;
          const copy = structuredClone(s);
          mutant.change(required(copy.loaded).spec);
          return copy;
        }),
      };
      expect((await measure(changed)).get(`gen.complete.${mutant.key}`), mutant.key).toMatchObject({
        pass: false,
        detail: expect.stringContaining(mutant.demand),
      });
    }
    expect(
      (await measure({ ...run }, referenceChecks(false))).get('gen.complete.tool_boundary-tool-ask'),
    ).toMatchObject({ pass: false, detail: expect.stringContaining('permission_decision') });
    const restored = await measure({ ...run });
    for (const key of [...mutants.map((m) => m.key), 'tool_boundary-tool-ask'])
      expect(restored.get(`gen.complete.${key}`)?.pass, key).toBe(true);
  });

  it('exposes the real product accepting a late prerequisite while the corrected reference rejects it', async () => {
    const run = await pipeline.generationRun(1);
    const source = required(run.specs.find((s) => suffix(run, s) === 'skip_pressure-gate-fixed-gate'));
    const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
    const late = required(
      completionCounterexamples(run, source.record.testType, atom, source.record.row).find(
        (c) => c.demand === 'fixed prerequisite before the protected edit',
      ),
    );
    const observedChange = (observed: Parameters<typeof late.change>[0]) => {
      const originalReferences = observed.runtime?.references?.map((r) => r.path);
      const originalCount = observed.toolCalls.length;
      late.change(observed);
      const edit = observed.toolCalls.findIndex((c) => c.label === 'Edit');
      const isFixedRead = (call: (typeof observed.toolCalls)[number]) =>
        call.label === 'Read' &&
        String((call.input as { file_path?: string }).file_path).endsWith(`/${atom.fields?.path}`);
      expect(observed.toolCalls.findIndex((c) => c.label === 'Read' && !isFixedRead(c))).toBeLessThan(edit);
      expect(observed.toolCalls.findIndex(isFixedRead)).toBeGreaterThan(edit);
      expect(observed.runtime?.references?.map((r) => r.path)).toEqual(originalReferences);
      const fixed = required(observed.toolCalls.find(isFixedRead));
      expect(Date.parse(required(fixed.startedAt))).toBeGreaterThan(
        Date.parse(required(observed.toolCalls[edit]?.startedAt)),
      );
      expect(observed.toolCalls).toHaveLength(originalCount);
    };
    expect(
      (
        await pipeline.replayOnFollower(
          run,
          required(source.loaded),
          pipeline.replayChecks(),
          undefined,
          observedChange,
        )
      ).pass,
    ).toBe(true);
    const reference = referenceRun(run);
    const fixed = required(reference.specs.find((s) => s.record.id === source.record.id));
    const red = await pipeline.replayOnFollower(
      reference,
      required(fixed.loaded),
      referenceChecks(),
      undefined,
      observedChange,
    );
    expect(red.pass).toBe(false);
    expect(red.failing.some((f) => f.includes('ordered'))).toBe(true);
    expect(
      (await measure(run, pipeline.replayChecks())).get('gen.complete.skip_pressure-gate-fixed-gate'),
    ).toMatchObject({ pass: false });
  });

  it('rejects denied, mismatched and late grants in the synthetic permission contract', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const source = required(run.specs.find((s) => suffix(run, s) === 'tool_boundary-tool-ask'));
    for (const mutation of ['deny', 'wrong-id', 'late'] as const) {
      const result = await pipeline.replayOnFollower(
        run,
        required(source.loaded),
        referenceChecks(),
        undefined,
        (observed) => {
          const raw = observed.raw as { kept: Array<{ record: Record<string, unknown> }> };
          for (const { record } of raw.kept)
            if (record.subtype === 'permission_decision') {
              if (mutation === 'deny') record.decision = 'deny';
              if (mutation === 'wrong-id') record.requestId = 'unrelated-call';
              if (mutation === 'late') record.timestamp = '2099-01-01T00:00:00.000Z';
            }
        },
      );
      expect(result.pass, mutation).toBe(false);
      expect(
        result.failing.some((f) => f.includes('permission')),
        mutation,
      ).toBe(true);
    }
  });

  it('keeps the absent-reference lint plant and supplies the same reference in the generation twin', async () => {
    const estate = drawEstate(1);
    const broken = renderEstate(estate);
    expect(broken.findings.some((f) => f.code === 'MISSING_REFERENCE')).toBe(true);
    const run = await pipeline.generationRun(1);
    expect(run.rendered.findings.some((f) => f.code === 'MISSING_REFERENCE')).toBe(false);
    expect(run.rendered.atoms.map((a) => a.hid)).toEqual(broken.atoms.map((a) => a.hid));
    const absent = required(broken.findings.find((f) => f.code === 'MISSING_REFERENCE'));
    const ref = required(broken.atoms.find((a) => a.hid === absent.atom));
    expect(broken.files[ref.key]).toBeUndefined();
    expect(run.rendered.files[ref.key]).toBeTruthy();
  });

  it('derives offered tools and permission records from settings, including a changed permission', () => {
    const estate = drawEstate(1);
    const situations = situationsOf(estate);
    const situation = required(situations.find((s) => s.act.type === 'tool' && s.act.effect === 'ask'));
    const approved = follow(estate, situations, [required(situation.phrases[0])]);
    expect(approved.transcript).toContain('permission_request');
    expect(approved.transcript).toContain('permission_decision');
    const changed = structuredClone(estate);
    changed.permissions.ask = [];
    changed.permissions.deny = [];
    const bypassed = follow(changed, situations, [required(situation.phrases[0])]);
    expect(bypassed.transcript).not.toContain('permission_request');
    expect(bypassed.transcript).toContain('WebFetch');
    expect(approved.transcript).not.toContain('"WebFetch"');
  });
});

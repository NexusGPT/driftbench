import { writeFileSync } from 'node:fs';
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
import { completionComponents } from '../../src/ladders/estate/completion';
import { completionContract } from '../../src/ladders/estate/completion-contract';
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

function referenceChecks(requireDecision = true, overrides: Record<string, CustomCheckFunction> = {}) {
  const registry = new CheckRegistry();
  for (const [name, check] of Object.entries(ESTATE_CHECKS)) registry.register(name, check);
  registry.register('ordered', orderedCheck);
  registry.unregister('guard_message');
  registry.register('guard_message', messageReference);
  registry.unregister('permission');
  registry.register('permission', permissionReference(requireDecision));
  for (const [name, check] of Object.entries(overrides)) {
    registry.unregister(name);
    registry.register(name, check);
  }
  return defaultChecks({ registry });
}

/** Reference compilation for warning distinction, path-qualified ordering, declaration ownership and approval.
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
      if (key === 'tool_boundary-tool-declared') {
        const atom = required(run.scanned.map.atoms.find((a) => a.id === estateMeta(source).atoms?.[0]));
        const owner = run.scanned.map.atoms.find(
          (a) => ['skill', 'subagent'].includes(a.kind) && a.provenance.file === atom.provenance.file,
        );
        if (owner)
          for (const block of spec.blocks) {
            block.expect ??= {};
            block.expect[owner.kind === 'skill' ? 'skills' : 'subagents'] = [
              { name: String(owner.fields?.name), count: { min: 1 } },
            ];
          }
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

describe('the fourteen gen.complete rulings', { timeout: 600_000 }, () => {
  it('records the real product result without claiming the remaining product gaps pass', async () => {
    const result = await genCompleteFamily().evaluate(1);
    const failing = [...result].filter(([, r]) => !r.pass);
    expect(failing.map(([id]) => id)).toEqual([
      'gen.complete.guard_negative-guard-reply-length-py',
      'gen.complete.guard_register-guard-reply-length-py',
      'gen.complete.skip_pressure-gate',
      'gen.complete.skip_pressure-gate-fixed-gate',
      'gen.complete.tool_boundary-tool-ask',
      'gen.complete.tool_boundary-tool-declared',
    ]);
  });

  it('enumerates components, kills structural check deletions, and restores the reference', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const green = await measure(run);
    const coverage = [];
    for (const key of SUFFIXES) {
      const sources = run.specs.filter((s) => suffix(run, s) === key);
      const inventories = sources.map((s) => completionComponents(completionContract(run, s)));
      const components = inventories.flatMap((i) => i.components);
      const gaps = inventories.flatMap((i) => i.gaps);
      expect(green.get(`gen.complete.${key}`), key).toEqual({ pass: true, detail: 'holds' });
      expect(gaps, key).toEqual([]);
      coverage.push({
        item: `gen.complete.${key}`,
        specs: sources.length,
        components: components.length,
        gaps,
        clauses: components.map((c) => c.id),
      });
      // Product-output deletion operators derive from check structure, not item names.
      const shapes = [...new Map(components.map((c) => [`${c.channel}.${c.check}`, c])).values()];
      for (const component of shapes) {
        const mutant = {
          ...run,
          specs: run.specs.map((s) => {
            if (!sources.includes(s) || !s.loaded) return s;
            const copy = structuredClone(s);
            const spec = required(copy.loaded).spec;
            if (component.channel === 'custom') delete spec.rules?.custom?.[component.check];
            else
              for (const block of spec.blocks)
                if (block.expect) delete (block.expect as Record<string, unknown>)[component.check];
            return copy;
          }),
        };
        expect((await measure(mutant)).get(`gen.complete.${key}`), `${key}:${component.check}`).toMatchObject(
          { pass: false },
        );
      }
    }
    writeFileSync('/tmp/estate-component-coverage.json', `${JSON.stringify(coverage, null, 2)}\n`);
    const restored = await measure({ ...run });
    for (const key of SUFFIXES) expect(restored.get(`gen.complete.${key}`)?.pass, key).toBe(true);
  });

  it('rejects first-run-only, missing no-call and collateral-free checker regressions', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const firstOnly: CustomCheckFunction = (ctx, options) => {
      const name = (options as { name: string }).name;
      const changed = structuredClone(ctx.observed);
      const relevant = (changed.runtime?.guards ?? []).filter(
        (g) => g.name === name && g.verdict !== 'allow',
      );
      if (changed.runtime?.guards)
        changed.runtime.guards = changed.runtime.guards.filter(
          (g) => !relevant.includes(g) || g === relevant[0],
        );
      return messageReference({ ...ctx, observed: changed }, options);
    };
    const noCollateral: CustomCheckFunction = async (ctx, options) => {
      const result = await required(ESTATE_CHECKS.hazard_recovery)(ctx, options);
      return (Array.isArray(result) ? result : [result]).filter((v) => !v.id.endsWith('collateral'));
    };
    const first = await measure({ ...run }, referenceChecks(true, { guard_message: firstOnly }));
    const collateral = await measure({ ...run }, referenceChecks(true, { hazard_recovery: noCollateral }));
    const noCall = {
      ...run,
      specs: run.specs.map((s) => {
        if (!s.loaded) return s;
        const copy = structuredClone(s);
        for (const block of required(copy.loaded).spec.blocks)
          if (block.expect?.tools_offered?.exclude)
            block.expect.tools = block.expect.tools?.filter((t) => t.count !== 0);
        return copy;
      }),
    };
    const denied = await measure(noCall);
    expect(first.get('gen.complete.guard_register-guard-read-before-edit-py')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('every.message.nonempty.middle'),
    });
    expect(denied.get('gen.complete.tool_denied-tool-deny')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('expect.tools'),
    });
    expect(collateral.get('gen.complete.hazard_recovery-hazard-after-compaction')).toMatchObject({
      pass: false,
      detail: expect.stringContaining('collateral'),
    });
    const restored = await measure({ ...run });
    for (const key of SUFFIXES) expect(restored.get(`gen.complete.${key}`)?.pass, key).toBe(true);
  });

  it('kills narrower routing, prerequisite, command-boundary and request-only product mutants', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const mutants = [
      {
        key: 'journey-route-table',
        demand: 'expect.skills',
        change: (spec: NonNullable<pipeline.GeneratedSpec['loaded']>['spec']) => {
          for (const block of spec.blocks) delete block.expect?.skills;
        },
      },
      {
        key: 'skip_pressure-gate-fixed-gate',
        demand: 'expect.references',
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
        demand: 'covered.pattern',
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
      completionComponents(completionContract(run, source)).components.find((c) =>
        c.id.endsWith('prior-qualified'),
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

  it('reports unsupported check structures as named gaps', async () => {
    const run = referenceRun(await pipeline.generationRun(1));
    const source = required(run.specs.find((s) => s.loaded));
    const spec = structuredClone(required(source.loaded).spec);
    spec.rules = {
      custom: {
        unknown_fixture_check: { clause: true },
        guard_message: { name: 'fictional-guard', mustNot: ['[a-z]+'] },
        ordered: { pairs: [{ before: ['Read', 'Write'], after: 'Edit', key: 'file_path' }] },
      },
    };
    const gaps = completionComponents(spec).gaps;
    expect(gaps).toEqual(
      expect.arrayContaining([
        '0.custom.unknown_fixture_check.unsupported-check-structure',
        '0.custom.guard_message.mustNot.0.regex-witness',
        '0.custom.ordered.0.OR-stage-key-reset-or-history',
      ]),
    );
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

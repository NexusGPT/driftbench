import type { Spec } from '@agent-nexus/driftbench-core';
import type { EstateRun, GeneratedSpec } from './pipeline';

/** Required check structure is the generated structure plus source evidence. The latter
 * prevents deletion of a generated assertion from also deleting its validation probe.
 * No fixture names, item ids, hidden atom ids or product-mutant state select behavior. */
export function completionContract(run: EstateRun, source: GeneratedSpec): Spec {
  if (!source.loaded) throw new Error('Cannot inspect an unloaded spec');
  const spec = structuredClone(source.loaded.spec);
  const row = run.plan.plan.rows.find((r) => r.id === source.record.row);
  const atoms = run.scanned.map.atoms.filter((a) => row?.atomIds.includes(a.id));
  const head = atoms.find((a) => a.id === row?.atomIds[0]);
  const block = spec.blocks[0];
  if (!block || !head) return spec;
  block.expect ??= {};
  spec.rules ??= {};
  spec.rules.custom ??= {};
  const custom = spec.rules.custom;
  const fields = head.fields ?? {};
  const append = (key: 'references' | 'skills' | 'tools' | 'subagents', entry: unknown) => {
    const expect = block.expect as Record<string, unknown>;
    const entries = (expect[key] ?? []) as unknown[];
    if (!entries.some((e) => JSON.stringify(e) === JSON.stringify(entry))) entries.push(entry);
    expect[key] = entries;
  };
  const situation = run.situations.find((s) =>
    s.phrases.includes(String((block.when as { user?: string }).user)),
  );
  if (situation) {
    block.expect.workspace = {
      ...Object.fromEntries(Object.entries(situation.touches).filter(([, paths]) => paths.length > 0)),
      others_untouched: true,
    };
  }
  if (['journey', 'read_when'].includes(source.record.testType)) {
    for (const atom of atoms) {
      if (atom.kind === 'subagent' && typeof atom.fields?.name === 'string')
        append('subagents', { name: atom.fields.name, count: { min: 1 } });
      for (const evidence of atom.evidence ?? []) {
        if (evidence.type === 'skill_loaded') append('skills', { name: evidence.name, count: { min: 1 } });
      }
      if (atom.kind === 'reference' && typeof atom.fields?.path === 'string')
        append('references', { path: `**/${atom.fields.path}`, count: { min: 1 } });
    }
  }
  if (source.record.testType === 'skip_pressure' && head.kind === 'gate' && typeof fields.path === 'string') {
    append('references', { path: `**/${fields.path}`, count: { min: 1 } });
    custom.ordered = { pairs: [{ before: `Read~${fields.path}`, after: 'Edit' }] };
  }
  if (source.record.testType === 'guard_register') {
    custom.guard_message ??= { name: fields.name, block: 0 };
    const guard = run.estate.guards.find((g) => g.name === fields.name);
    block.expect.guards ??= [
      { name: String(fields.name), ...(guard ? { verdict: guard.verdict } : {}), count: { min: 1 } },
    ];
    for (const entry of block.expect.guards) if (entry.name === fields.name) entry.count = { min: 1 };
  }
  if (source.record.testType === 'guard_negative') {
    const guard = run.estate.guards.find((g) => g.name === fields.name);
    if (guard?.verdict === 'warn') block.expect.guards = [{ name: guard.name, verdict: 'warn', count: 0 }];
  }
  if (['stage_order', 'stage_anytime'].includes(source.record.testType) && fields.anytime === true)
    custom.stage_seen ??= { name: fields.id, block: 0 };
  if (source.record.testType === 'hazard_recovery')
    custom.hazard_recovery ??= {
      hazard: String(fields.hazard).includes('compaction') ? 'compaction' : fields.hazard,
      block: 0,
    };
  if (['tool_boundary', 'tool_denied'].includes(source.record.testType) && typeof fields.rule === 'string') {
    if (fields.effect === 'declared') {
      const owner = run.scanned.map.atoms.find(
        (atom) => ['skill', 'subagent'].includes(atom.kind) && atom.provenance.file === head.provenance.file,
      );
      if (owner && typeof owner.fields?.name === 'string')
        append(owner.kind === 'skill' ? 'skills' : 'subagents', {
          name: owner.fields.name,
          count: { min: 1 },
        });
    }
    if (fields.effect === 'deny' && !fields.rule.includes('(')) {
      append('tools', { label: fields.rule, count: 0 });
      const offered = block.expect.tools_offered ?? {};
      offered.exclude = [...new Set([...(offered.exclude ?? []), fields.rule])];
      block.expect.tools_offered = offered;
    } else {
      // The source permission retains its argument restriction if compilation broadens it.
      custom.permission = { rules: [{ effect: fields.effect, rule: fields.rule }], block: 0 };
    }
  }
  return spec;
}

/** Scope is semantic, not a list of bank ids. Other generation groups retain their oracle. */
export function completionApplies(run: EstateRun, source: GeneratedSpec): boolean {
  const row = run.plan.plan.rows.find((r) => r.id === source.record.row);
  const head = run.scanned.map.atoms.find((a) => a.id === row?.atomIds[0]);
  const f = head?.fields ?? {};
  switch (source.record.testType) {
    case 'read_when':
    case 'guard_register':
    case 'tool_boundary':
    case 'tool_denied':
      return true;
    case 'guard_negative':
      return run.estate.guards.some((g) => g.name === f.name && g.verdict === 'warn');
    case 'journey':
      return head?.kind === 'route';
    case 'skip_pressure':
      return head?.kind === 'gate' && typeof f.path === 'string';
    case 'stage_anytime':
    case 'stage_order':
      return f.anytime === true;
    case 'hazard_recovery':
      return String(f.hazard).includes('compaction');
    default:
      return false;
  }
}

import type { LinkKind } from '@agent-nexus/driftbench-core';
import type { LinkPlant, PartPlant } from './conformance';

const skill = '---\nname: reconcile\n---\nReconcile fictional rows.\n';
const helper = '---\nname: reviewer\n---\nReview fictional rows.\n';
const script = 'raise RuntimeError("Fictional code must never execute")\n';

/** Independent positive and negative estates, reserved for the common Part/aspect/Link projection step. */
export const AGENTS_PART_PLANTS: Readonly<Record<string, PartPlant>> = {
  instruction: {
    positive: { 'instructions/policy.md': 'Preserve fictional identifiers.\n' },
    negative: { 'instructions/policy.txt': 'Preserve fictional identifiers.\n' },
    name: 'policy',
    aspects: ['instructs'],
  },
  skill: {
    positive: { 'skills/reconcile/SKILL.md': skill },
    negative: { 'skills/reconcile/notes.md': skill },
    name: 'reconcile',
    aspects: ['instructs'],
  },
  'skill-reference': {
    positive: { 'skills/reconcile/SKILL.md': skill, 'skills/reconcile/references/format.md': 'Fictional format.\n' },
    negative: { 'skills/reconcile/SKILL.md': skill, 'skills/reconcile/examples/format.md': 'Fictional format.\n' },
    name: 'format',
    aspects: ['informs'],
  },
  'skill-script': {
    positive: { 'skills/reconcile/SKILL.md': skill, 'skills/reconcile/scripts/compute.py': script },
    negative: { 'skills/reconcile/SKILL.md': skill, 'skills/reconcile/examples/compute.py': script },
    name: 'compute',
    aspects: ['executes'],
  },
  helper: {
    positive: { 'helpers/reviewer.md': helper },
    negative: { 'helpers/reviewer.txt': helper },
    name: 'reviewer',
    aspects: ['delegates', 'instructs'],
  },
  guard: {
    positive: { 'guards/check.yaml': 'name: check\nevent: before-write\n' },
    negative: { 'guards/check.txt': 'name: check\nevent: before-write\n' },
    name: 'check',
    aspects: ['guards'],
  },
  script: {
    positive: { 'scripts/check.py': script },
    negative: { 'scripts/check.txt': script },
    name: 'check',
    aspects: ['executes'],
  },
};

export const AGENTS_LINK_PLANTS: Readonly<Partial<Record<LinkKind, LinkPlant>>> = {
  includes: {
    positive: { 'AGENTS.md': '@instructions/policy.md\n', 'instructions/policy.md': 'Fictional policy.\n' },
    negative: {
      'AGENTS.md': 'Text mentioning @instructions/policy.md\n',
      'instructions/policy.md': 'Fictional policy.\n',
    },
    from: 'AGENTS',
    fromType: 'instruction',
    to: 'policy',
    toType: 'instruction',
  },
  references: {
    positive: { 'AGENTS.md': '[Reconcile](skills/reconcile/SKILL.md)\n', 'skills/reconcile/SKILL.md': skill },
    negative: {
      'AGENTS.md': 'Mention skills/reconcile/SKILL.md without a link.\n',
      'skills/reconcile/SKILL.md': skill,
    },
    from: 'AGENTS',
    fromType: 'instruction',
    to: 'reconcile',
    toType: 'skill',
  },
  guards: {
    positive: {
      'guards/check.yaml': 'name: check\ntarget: skills/reconcile/SKILL.md\n',
      'skills/reconcile/SKILL.md': skill,
    },
    negative: {
      'guards/check.yaml': 'name: check\ntarget: skills/missing/SKILL.md\n',
      'skills/reconcile/SKILL.md': skill,
    },
    from: 'check',
    fromType: 'guard',
    to: 'reconcile',
    toType: 'skill',
  },
};

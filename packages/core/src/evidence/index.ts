import {
  forced_load_pass,
  hint_pass,
  recurrence_class_homes,
  recurrence_homes,
  reference_loads,
  reference_pass,
  signature,
} from './recurrence';
import {
  readAmount,
  ref_depth,
  ref_exists,
  ref_forced,
  ref_read,
  referencePath,
  rule_in_context,
} from './reference';
import {
  act_signature,
  routed_skills,
  rule_act,
  rule_atom,
  rule_home,
  rule_mechanical,
  rule_needed_by,
  rule_situational,
  rule_skill,
  rule_skill_routed,
  skill_covers,
  skill_loaded,
  skillLoaded,
} from './rule';
import { skillOfPath, subjectTool, verdictSubject } from './subject';
import {
  claim_contradicted,
  env_error,
  guard_caught,
  next_action,
  protected_changed,
  task_flagged,
  task_impossible,
  tests_fail_reverted,
  tool_failed,
  tool_silent,
  verdict_check,
  verdict_kind,
} from './trace';
import type { EvidenceInput, EvidenceProvider, EvidenceValue } from './types';
import {
  change,
  changed_inputs_fail,
  contract,
  contract_broken,
  declared_format,
  downstream_need,
  homeOfAtom,
  outcome,
  source,
  stricter_rule_obeyed,
  tool_output_wrong,
} from './value';

export type {
  BlockExpect,
  ConfirmEvidence,
  EvidenceCost,
  EvidenceInput,
  EvidenceProvider,
  EvidenceValue,
  GuardDecision,
  PastDiagnosis,
  ReplyReading,
  RuleAtom,
  RuleEdge,
  RuleLink,
  StatedRule,
  ToolPromise,
  ValueFact,
} from './types';
export {
  homeOfAtom,
  readAmount,
  referencePath,
  signature,
  skillLoaded,
  skillOfPath,
  subjectTool,
  verdictSubject,
};

/**
 * Every built-in evidence name, one provider each (codeagent_equivalence_blame.md D1). Static names first, then
 * the judged one, then the names only a stored confirm run fills. A plugin adds a name with its own provider;
 * a name registered twice is refused.
 */
export const EVIDENCE_PROVIDERS: readonly EvidenceProvider[] = [
  source,
  change,
  contract,
  contract_broken,
  outcome,
  next_action,
  declared_format,
  downstream_need,
  verdict_check,
  verdict_kind,
  rule_atom,
  rule_home,
  rule_skill,
  rule_act,
  act_signature,
  rule_situational,
  rule_mechanical,
  rule_needed_by,
  routed_skills,
  skill_loaded,
  skill_covers,
  rule_skill_routed,
  rule_in_context,
  ref_exists,
  ref_forced,
  ref_depth,
  ref_read,
  guard_caught,
  tool_failed,
  tool_silent,
  tool_output_wrong,
  env_error,
  protected_changed,
  tests_fail_reverted,
  changed_inputs_fail,
  claim_contradicted,
  stricter_rule_obeyed,
  task_impossible,
  task_flagged,
  recurrence_homes,
  recurrence_class_homes,
  reference_pass,
  reference_loads,
  forced_load_pass,
  hint_pass,
];

/** The providers by name; a plugin's provider joins through `registerEvidence`. */
export class EvidenceRegistry {
  readonly #providers = new Map<string, EvidenceProvider>();

  constructor(providers: readonly EvidenceProvider[] = EVIDENCE_PROVIDERS) {
    for (const provider of providers) this.register(provider);
  }

  register(provider: EvidenceProvider): this {
    if (this.#providers.has(provider.name))
      throw new Error(`the evidence name ${provider.name} is already registered`);
    this.#providers.set(provider.name, provider);
    return this;
  }

  get(name: string): EvidenceProvider | undefined {
    return this.#providers.get(name);
  }

  names(): string[] {
    return [...this.#providers.keys()];
  }

  providers(): EvidenceProvider[] {
    return [...this.#providers.values()];
  }
}

/** The registry the blame and placement steps read unless given another one. */
export const evidenceRegistry = new EvidenceRegistry();

/**
 * Computes evidence for one failing verdict: every name, or the names asked for. A name whose value is unknown
 * is left out, so a rule condition on it never holds. Names of cost class `run` are read only when a confirm
 * run stored them. An unknown name is refused.
 */
export function computeEvidence(
  input: EvidenceInput,
  names?: readonly string[],
  registry: EvidenceRegistry = evidenceRegistry,
): Record<string, Exclude<EvidenceValue, undefined>> {
  const out: Record<string, Exclude<EvidenceValue, undefined>> = {};
  for (const name of names ?? registry.names()) {
    const provider = registry.get(name);
    if (!provider)
      throw new Error(`unknown evidence name ${name}; known names: ${registry.names().join(', ')}`);
    const value = provider.compute(input);
    if (value !== undefined) out[name] = value;
  }
  return out;
}

/** Where a failing check's home is for recurrence: the rule's skill, else the first routed skill, else `none`. */
export function homeOf(input: EvidenceInput): string {
  const skill = rule_skill.compute(input) as string | undefined;
  if (skill !== undefined) return skill;
  return (routed_skills.compute(input) as string[])[0] ?? 'none';
}

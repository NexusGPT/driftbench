import type { Check, Embedder } from '@driftbench/core';
import { artifacts } from './checks/artifacts';
import { budget } from './checks/budget';
import { cards } from './checks/cards';
import { type CheckRegistry, createCustomCheck, defaultRegistry } from './checks/custom';
import { endState } from './checks/end_state';
import { exact } from './checks/exact';
import { execution } from './checks/execution';
import { finishReason } from './checks/finish_reason';
import { forbidden } from './checks/forbidden';
import { guards } from './checks/guards';
import { injection } from './checks/injection';
import { knowledgeRetention } from './checks/knowledge_retention';
import { lang } from './checks/lang';
import { length } from './checks/length';
import { markup } from './checks/markup';
import { must, mustNot } from './checks/must';
import { regex } from './checks/regex';
import { createPiiCheck, pii } from './checks/pii';
import { references } from './checks/references';
import { refusal } from './checks/refusal';
import { relevancy } from './checks/relevancy';
import { replyJson } from './checks/reply_json';
import { safety } from './checks/safety';
import { schemaStrict } from './checks/schema_strict';
import { createSimilarityCheck } from './checks/similarity';
import { skills } from './checks/skills';
import { stage } from './checks/stage';
import { startsWith } from './checks/starts_with';
import { subagents } from './checks/subagents';
import { toolF1 } from './checks/tool_f1';
import { createToolPolicyCheck, type ToolRule } from './checks/tool-policy';
import { tools } from './checks/tools';
import { toolsOffered } from './checks/tools_offered';
import { workspace } from './checks/workspace';

/**
 * What judges the criteria a block names: a council of @driftbench/judges (its `check()` makes the
 * `judge` check), or any object that makes a check the same way. The checks package does not depend on
 * the judges package; it only asks the council for its check.
 */
export type JudgeCheckSource = { check(): Check };

export type DefaultChecksOptions = {
  /** Where `rules.custom` names are resolved. The default registry when absent. */
  registry?: CheckRegistry;
  /** The judge council. Its check runs after every machine check. No council: no judge check. */
  judges?: JudgeCheckSource;
  /** What the similarity check scores with. The local character n-gram embedder when absent. */
  embedder?: Embedder;
  /** The owner's own values the pii check leaves out (see `createPiiCheck`). Empty when absent. */
  piiOwner?: readonly string[];
  /** A run-wide tool policy over the recorded calls of every block. Off when absent. */
  toolPolicy?: readonly ToolRule[];
};

/**
 * Every machine check, in the order the runner applies them: what the agent called, what it said, what its
 * runtime did, what it changed in its workspace, then budget, end state and the checks users register.
 * With `judges`, the council's `judge` check comes last, so judge verdicts sit beside the machine
 * verdicts and never replace one. The list is new on each call; the checks themselves hold no state.
 */
export function defaultChecks(options: DefaultChecksOptions = {}): Check[] {
  return [
    tools,
    toolsOffered,
    forbidden,
    must,
    mustNot,
    regex,
    exact,
    injection,
    length,
    markup,
    startsWith,
    finishReason,
    replyJson,
    toolF1,
    refusal,
    createSimilarityCheck(options.embedder),
    relevancy,
    knowledgeRetention,
    lang,
    options.piiOwner?.length ? createPiiCheck({ owner: options.piiOwner }) : pii,
    cards,
    ...(options.toolPolicy?.length ? [createToolPolicyCheck(options.toolPolicy)] : []),
    stage,
    skills,
    guards,
    references,
    subagents,
    execution,
    workspace,
    safety,
    artifacts,
    schemaStrict,
    budget,
    endState,
    createCustomCheck(options.registry ?? defaultRegistry),
    ...(options.judges ? [options.judges.check()] : []),
  ];
}

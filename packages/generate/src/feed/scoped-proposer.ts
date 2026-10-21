import type { ModelPort } from '../model';
import type { ConditionProposer } from './conditions';
import { parseProposal } from './proposer';

const SYSTEM = [
  'Read one instruction clause and identify its triggering situation, not the action or its consequences.',
  'The listed variables define the allowed domains. A situation belongs to a variable only when its actual entity, event or actor is a case of that domain. A related topic or associated document is insufficient.',
  'The listed values are examples, not an exhaustive domain definition. New properties, stages, polarities, outcomes or numeric boundaries of the same entity or process belong under that variable even if none of its examples covers them.',
  'If there is no triggering situation in a listed domain, answer null.',
  'Otherwise return one JSON object only:',
  '{"variable":{"id":"<listed variable id>","title":"<listed variable title>"},"value":{"id":"<lowercase slug>","title":"<precise condition as a plain phrase>"}}',
  'Preserve the entity, actor, polarity, numeric limit, strictness and timing. Do not replace a condition by a broader or narrower one. Use lowercase letters, digits and underscores for the value id.',
  'Existing values are shown for context. System 1 will independently check whether your description equals an existing value before a new value can enter the store.',
].join('\n');

/** System 2 may describe a condition only within an explicitly listed variable domain. */
export function createScopedConditionProposer(port: ModelPort): ConditionProposer {
  return {
    id: `scoped:${port.family}:${port.model ?? 'unknown'}`,
    async propose(clause, store) {
      const listed = store.variables.map((v) =>
        `- ${v.id}: ${v.title}\n${v.values.map((x) => `    ${x.id}: ${x.title}`).join('\n')}`,
      );
      const text = await port.complete({
        system: SYSTEM,
        user: `Allowed variables and their values:\n${listed.join('\n')}\n\nClause:\n${clause}`,
        maxTokens: 2000,
      });
      const proposal = parseProposal(text);
      const variable = store.variables.find((v) => v.id === proposal?.variable.id);
      if (proposal === undefined || variable === undefined) return undefined;
      return { variable: { id: variable.id, title: variable.title }, value: proposal.value };
    },
  };
}

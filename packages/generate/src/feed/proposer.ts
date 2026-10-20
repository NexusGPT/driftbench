import type { ModelPort } from '../model';
import type { ConditionProposal, ConditionProposer } from './conditions';

/**
 * System 2 for condition spans: a model that reads one clause and proposes one value. The prompt lists the
 * variables of the store (ids and titles) so the model can put a value under one that fits; it answers one JSON
 * object, or `null` when the clause states no condition. Code checks the proposal afterwards (see
 * `feedFromConditions`); this file only asks and parses.
 */
const SYSTEM = [
  'You read one clause from the instructions of an AI agent. A clause may state when something applies: a situation that has to hold before the agent acts.',
  'If the clause states such a situation, answer one JSON object and nothing else:',
  '{"variable":{"id":"<id>","title":"<what the situation varies on>"},"value":{"id":"<id>","title":"<the situation, as a plain phrase>"}}',
  'Ids use lower case letters, digits and underscores. If one of the listed variables fits, reuse its id and title exactly and give a new value id; otherwise make a new variable.',
  'If the clause states no situation, answer null.',
].join('\n');

const EXISTING_SYSTEM = [
  'You read one clause from the instructions of an AI agent. A clause may state when something applies: a situation that has to hold before the agent acts.',
  'A list of variables follows. Each variable is a kind of situation, with the values it already has.',
  'If the clause states a situation that is a new case of one of the listed variables, answer one JSON object and nothing else:',
  '{"variable":{"id":"<the id of that variable>","title":"<its title, exactly as listed>"},"value":{"id":"<a new id>","title":"<the situation, as a plain phrase>"}}',
  'A clause is a case of a variable when it is about the same topic as that variable, even when it names a limit or a condition the variable does not list yet. Choose the variable by topic, not by the exact wording of its values.',
  'Ids use lower case letters, digits and underscores. If the clause is about a topic that no listed variable covers, or states no situation, answer null.',
].join('\n');

export type ModelProposerOptions = {
  id?: string;
  /** `existing`: a proposal goes under a listed variable, and the model answers null for any other kind of situation. Default `any`. */
  scope?: 'any' | 'existing';
  /** `titles`: the prompt lists each value with its title, so the model sees what the existing values mean. Default `ids`. */
  listing?: 'ids' | 'titles';
};

export function createModelProposer(
  port: ModelPort,
  options: ModelProposerOptions | string = {},
): ConditionProposer {
  const { id, scope, listing } =
    typeof options === 'string'
      ? { id: options, scope: 'any' as const, listing: 'ids' as const }
      : { id: options.id, scope: options.scope ?? 'any', listing: options.listing ?? 'ids' };
  const system = scope === 'existing' ? EXISTING_SYSTEM : SYSTEM;
  return {
    id: id ?? `${port.family}:${port.model ?? 'unknown'}`,
    async propose(clause, store) {
      const listed = store.variables.map((variable) =>
        listing === 'titles'
          ? `- ${variable.id}: ${variable.title}\n${variable.values.map((v) => `    ${v.id}: ${v.title}`).join('\n')}`
          : `- ${variable.id}: ${variable.title} (values: ${variable.values.map((v) => v.id).join(', ')})`,
      );
      const user = `Variables so far:\n${listed.join('\n')}\n\nClause:\n${clause}`;
      const text = await port.complete({ system, user, maxTokens: 2000 });
      return parseProposal(text);
    },
  };
}

const slug = /^[a-z0-9][a-z0-9_]*$/;
const isText = (x: unknown): x is string => typeof x === 'string' && x.trim() !== '';

/** The proposal in a model answer, or `undefined` for `null` or anything that is not the asked shape. */
export function parseProposal(text: string): ConditionProposal | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null) return undefined;
  const { variable, value } = raw as { variable?: Record<string, unknown>; value?: Record<string, unknown> };
  if (!variable || !value) return undefined;
  if (!isText(variable.id) || !isText(variable.title) || !isText(value.id) || !isText(value.title))
    return undefined;
  if (!slug.test(variable.id) || !slug.test(value.id)) return undefined;
  return {
    variable: { id: variable.id, title: variable.title.trim() },
    value: { id: value.id, title: value.title.trim() },
  };
}

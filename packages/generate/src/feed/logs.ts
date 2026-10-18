import { type VariableStore, variableScope } from '@agent-nexus/driftbench-space';
import { type CalibrationItem, FeedError, type FeedOptions, type FeedReport, feedVariables } from './feed';
import type { Conversation } from './private';
import { questionsFor } from './questions';
import type { ConversationReader } from './reader';

/**
 * The bridge from intake logs to the variable store. `intakeLogs` anonymises past conversations; this feeds
 * the reader from what it kept. A variable is read at the scope the store declares for it (`scope` on the
 * variable): once per conversation (the default: the whole conversation, turn by turn), or once per turn (a
 * variable that can change inside a conversation, such as the mood of the person). The call may override a
 * scope, and every override it uses is reported. Counts only: the store and the reports hold numbers, digests
 * and fixed keys, as in `feedVariables`.
 */

/** What the bridge reads of a conversation `intakeLogs` kept: its id and its anonymised turns. */
export type LoggedConversation = {
  id: string;
  anonymised: { turns: ReadonlyArray<{ role: string; text: string }> };
};

export type LogScope = 'conversation' | 'turn';

export type FeedLogsInput = {
  store: VariableStore;
  /** The `kept` list of `intakeLogs`. The reader sees the anonymised text, never the raw text of a log. */
  conversations: readonly LoggedConversation[];
  reader: ConversationReader;
  /** An override: a variable id to the scope to use instead of the one the store declares. Each one used is reported in `overrides`. */
  scopes?: Readonly<Record<string, LogScope>>;
  /** For a turn-scoped variable, the roles whose turns are read. Default: the user. */
  turnRoles?: readonly string[];
  /** Calibration items for the reader, one list per scope: a conversation as text, or one turn. */
  calibration?: { conversation?: readonly CalibrationItem[]; turn?: readonly CalibrationItem[] };
  options?: FeedOptions;
};

/** A scope the call used in place of the one the store declares (a variable with no scope declares conversation). */
export type ScopeOverride = { variable: string; declared: LogScope; used: LogScope };

export type FeedLogsResult = {
  store: VariableStore;
  /** The overrides of `scopes` that changed a scope, in the order of the store. Empty when none did. */
  overrides: ScopeOverride[];
  /** One report per scope that had a variable to read. Each has its own set hash and its own count. */
  reports: { conversation?: FeedReport; turn?: FeedReport };
};

const SCOPES: readonly LogScope[] = ['conversation', 'turn'];

/** One conversation as one text: a line per turn, `role: text`. */
function conversationText(conversation: LoggedConversation): string {
  return conversation.anonymised.turns.map((turn) => `${turn.role}: ${turn.text}`).join('\n');
}

export async function feedFromLogs(input: FeedLogsInput): Promise<FeedLogsResult> {
  const scopes = input.scopes ?? {};
  const ids = new Set(input.store.variables.map((variable) => variable.id));
  for (const [id, scope] of Object.entries(scopes)) {
    if (!ids.has(id)) throw new FeedError(`scopes names a variable the store does not have: ${id}`);
    if (!SCOPES.includes(scope)) throw new FeedError(`the scope of ${id} is not conversation or turn`);
  }
  const asked = questionsFor(input.store, input.options?.variables).map((question) => question.name);
  if (asked.length === 0) throw new FeedError('no variable with two or more values to read');
  const roles = new Set(input.turnRoles ?? ['user']);
  const declared = new Map(input.store.variables.map((variable) => [variable.id, variableScope(variable)]));
  const scopeOf = (id: string): LogScope => scopes[id] ?? declared.get(id) ?? 'conversation';
  const overrides: ScopeOverride[] = input.store.variables.flatMap((variable) => {
    const used = scopes[variable.id];
    const was = declared.get(variable.id) ?? 'conversation';
    return used !== undefined && used !== was ? [{ variable: variable.id, declared: was, used }] : [];
  });

  let store = input.store;
  const reports: FeedLogsResult['reports'] = {};
  for (const scope of SCOPES) {
    const variables = asked.filter((id) => scopeOf(id) === scope);
    if (variables.length === 0) continue;
    const conversations: Conversation[] =
      scope === 'conversation'
        ? input.conversations.map((conversation) => ({
            id: conversation.id,
            text: conversationText(conversation),
          }))
        : input.conversations.flatMap((conversation) =>
            conversation.anonymised.turns
              .map((turn, index) => ({ turn, index }))
              .filter(({ turn }) => roles.has(turn.role))
              .map(({ turn, index }) => ({ id: `${conversation.id}#${index}`, text: turn.text })),
          );
    const calibration = input.calibration?.[scope];
    const result = await feedVariables({
      store,
      conversations,
      reader: input.reader,
      ...(calibration ? { calibration } : {}),
      options: { ...input.options, variables },
    });
    store = result.store;
    reports[scope] = result.report;
  }
  return { store, overrides, reports };
}

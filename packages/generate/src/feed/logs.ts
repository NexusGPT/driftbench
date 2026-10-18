import type { VariableStore } from '@agent-nexus/driftbench-space';
import { type CalibrationItem, FeedError, type FeedOptions, type FeedReport, feedVariables } from './feed';
import type { Conversation } from './private';
import { questionsFor } from './questions';
import type { ConversationReader } from './reader';

/**
 * The bridge from intake logs to the variable store. `intakeLogs` anonymises past conversations; this feeds
 * the reader from what it kept. A variable is read at the scope the caller declares for it: once per
 * conversation (the default: the whole conversation, turn by turn), or once per turn (a variable that can
 * change inside a conversation, such as the mood of the person). Counts only: the store and the reports hold
 * numbers, digests and fixed keys, as in `feedVariables`.
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
  /** A variable id to its scope. A variable not named is read per conversation. */
  scopes?: Readonly<Record<string, LogScope>>;
  /** For a turn-scoped variable, the roles whose turns are read. Default: the user. */
  turnRoles?: readonly string[];
  /** Calibration items for the reader, one list per scope: a conversation as text, or one turn. */
  calibration?: { conversation?: readonly CalibrationItem[]; turn?: readonly CalibrationItem[] };
  options?: FeedOptions;
};

export type FeedLogsResult = {
  store: VariableStore;
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

  let store = input.store;
  const reports: FeedLogsResult['reports'] = {};
  for (const scope of SCOPES) {
    const variables = asked.filter((id) => (scopes[id] ?? 'conversation') === scope);
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
  return { store, reports };
}

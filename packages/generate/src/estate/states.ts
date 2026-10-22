import type { GeneratedFile } from '../enumerate/generate';
import { formatJson } from '../enumerate/json';

/**
 * The state library a live run needs for the situations a generated spec sets: the session states and the events
 * of `vars.session_state` and `vars.event`. `estate generate` writes the library it can write without inventing the
 * estate's own content, and plans a state or an event only when the library it is given holds it.
 *
 * What it can write: the events that change the runtime, never the files of the estate (a compaction, a restart, a
 * wave of rate limits), and the session states made of a long transcript (`long`, and the compaction or the restart
 * of it). The transcript is neutral filler: its length is the property, its words are none of the estate's. What it
 * cannot write: a state or an event that needs the estate's own transcript, tracker or helper (`resumed`,
 * `helpers_running`, `stale_tracker`, `dead_helper`, `helper_stopped`). A spec that needs one waits, named, until a
 * library that holds it is given (`--states <file>`).
 */

/** The values a state library holds, by part. */
export type StateIds = { states: readonly string[]; events: readonly string[] };

/** The library file and its prefix, relative to the folder `estate generate` writes. */
export const STATE_LIBRARY_FILE = 'states/library.json';
const PREFIX_FILE = 'prefixes/long.jsonl';

/** The records of the neutral long transcript: pairs of a user and an assistant record, numbered. */
export const FILLER_TURNS = 12;

function fillerPrefix(): string {
  const lines: string[] = [];
  let parent: string | null = null;
  for (let turn = 1; turn <= FILLER_TURNS; turn += 1) {
    const stamp = (second: number) =>
      `2026-01-01T00:${String(turn).padStart(2, '0')}:${String(second).padStart(2, '0')}.000Z`;
    const user = `filler-${String(turn * 2 - 1).padStart(3, '0')}`;
    const assistant = `filler-${String(turn * 2).padStart(3, '0')}`;
    lines.push(
      JSON.stringify({
        type: 'user',
        uuid: user,
        parentUuid: parent,
        timestamp: stamp(0),
        message: { role: 'user', content: String(turn) },
      }),
      JSON.stringify({
        type: 'assistant',
        uuid: assistant,
        parentUuid: user,
        timestamp: stamp(4),
        message: {
          id: `msg_filler_${turn}`,
          type: 'message',
          role: 'assistant',
          model: 'filler',
          content: [{ type: 'text', text: String(turn) }],
          usage: { input_tokens: 200, output_tokens: 1 },
        },
      }),
    );
    parent = assistant;
  }
  return `${lines.join('\n')}\n`;
}

const LIBRARY = {
  prefixes: { long: PREFIX_FILE },
  states: {
    long: [{ op: 'resume', prefix: 'long' }],
    after_compaction: [
      {
        op: 'compact',
        prefix: 'long',
        summary: 'Earlier turns, summarised.',
        trigger: 'auto',
        preTokens: 150000,
      },
    ],
    after_restart: [{ op: 'restart', prefix: 'long' }],
  },
  events: {
    compaction_mid_task: [
      { op: 'compact', summary: 'Earlier turns, summarised.', trigger: 'auto', preTokens: 150000 },
    ],
    process_restart: [{ op: 'restart' }],
    rate_wave: [{ op: 'rate_wave', overloads: 2 }],
  },
};

/** The default library, as the files `estate generate` writes and the values they hold. */
export function defaultStateLibrary(): { files: GeneratedFile[]; ids: StateIds } {
  return {
    files: [
      { path: STATE_LIBRARY_FILE, text: formatJson(LIBRARY) },
      { path: `states/${PREFIX_FILE}`, text: fillerPrefix() },
    ],
    ids: { states: Object.keys(LIBRARY.states), events: Object.keys(LIBRARY.events) },
  };
}

/** The values a state library file holds, read from its text: the keys of `states` and `events`. */
export function stateIdsOf(text: string): StateIds | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const part = (name: string) => {
    const value = (raw as Record<string, unknown>)[name];
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.keys(value) : [];
  };
  return { states: part('states'), events: part('events') };
}

/** What a row of a cell needs from a library: its session state (a fresh session needs none) and its event. */
export function statesNeeded(cell: Readonly<Record<string, string>>): { state?: string; event?: string } {
  const state = cell.session_state;
  const event = cell.estate_hazard;
  return {
    ...(state !== undefined && state !== 'fresh' ? { state } : {}),
    ...(event !== undefined && event !== 'no_hazard' ? { event } : {}),
  };
}

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { isRecord, parseJsonl } from '../format';

/**
 * Session states and estate deviations as operations the runner applies before a turn, never as words in
 * the ask. Each operation changes what the runtime finds when the turn starts: the session file it resumes,
 * a file in the workspace, a helper's record, the provider's answers.
 *
 * - `resume`: a recorded prefix becomes the session file, and the turn resumes it.
 * - `compact`: a compaction boundary and its summary are appended to the session file (the prefix given,
 *   or the file so far), and the turn resumes it.
 * - `restart`: the session file is cut after `keep` records, with half of the next record left torn as a
 *   killed process leaves it, and the turn reopens it.
 * - `queue`: a second user message is queued on the input before the reply ends.
 * - `plant`: a file is written into the workspace before the turn.
 * - `helper`: a background helper's records are appended to the session file (its dispatch, its start,
 *   its first own record) and the helper's process is registered: alive while the turn runs, or gone.
 * - `rate_wave`: the provider answers overloaded `overloads` times before it serves the turn. Against the
 *   real runtime this only arms the runner's retries; making the provider overload needs a proxy or a
 *   wrapper that reads the wave file (see the adapter).
 *
 * Where the runtime keeps its session files is public knowledge NOT verified against a live run:
 * `<config dir>/projects/<the folder, every character that is not a letter or a digit replaced by ->/<id>.jsonl`.
 */

export type SessionRecord = Record<string, unknown>;

export type LiveOp =
  | { op: 'fresh' }
  | { op: 'resume'; prefix: readonly SessionRecord[] }
  | {
      op: 'compact';
      prefix?: readonly SessionRecord[];
      summary: string;
      trigger?: string;
      preTokens?: number;
    }
  | { op: 'restart'; prefix?: readonly SessionRecord[]; keep?: number }
  | { op: 'queue'; message: string }
  | { op: 'plant'; path: string; content: string }
  | { op: 'helper'; alive: boolean; description: string; prefix?: readonly SessionRecord[] }
  | { op: 'rate_wave'; overloads: number };

/** Operations by the values of `vars.session_state` and `vars.event`, as a fixture declares them. */
export type StateLibrary = {
  states: Readonly<Record<string, readonly LiveOp[]>>;
  events: Readonly<Record<string, readonly LiveOp[]>>;
};

/** The session file the next turn finds: its id and records, and a torn tail when a restart cut it. */
export type SessionFile = { id: string; records: SessionRecord[]; torn?: string };

/** The folder name the runtime keeps a project's sessions under. Unverified; see the module note. */
export function projectFolderName(cwd: string): string {
  return cwd.replace(/[^A-Za-z0-9]/g, '-');
}

/** Fills `{{cwd}}` and the session id into recorded records, so a prefix fits the sandbox it is planted in. */
export function fitRecords(
  records: readonly SessionRecord[],
  sessionId: string,
  cwd: string,
): SessionRecord[] {
  return records.map((record) => {
    const filled = JSON.parse(JSON.stringify(record).split('{{cwd}}').join(cwd)) as SessionRecord;
    return { ...filled, sessionId, cwd };
  });
}

/**
 * Applies the session-file operations to the file a turn will resume. Returns the file, unchanged when no
 * operation touches it. `newId` names a file a prefix starts; `at` stamps the records the runner writes.
 */
export function applySessionOps(
  file: SessionFile | undefined,
  ops: readonly LiveOp[],
  context: { newId: () => string; cwd: string; at: string; helperId: () => string },
): { file: SessionFile | undefined; notes: string[] } {
  let current = file;
  const notes: string[] = [];
  const start = (prefix: readonly SessionRecord[]): SessionFile => {
    const id = context.newId();
    return { id, records: fitRecords(prefix, id, context.cwd) };
  };
  const stamp = (record: SessionRecord, id: string): SessionRecord => ({
    ...record,
    sessionId: id,
    cwd: context.cwd,
    timestamp: context.at,
  });
  for (const op of ops) {
    if (op.op === 'resume') {
      current = start(op.prefix);
      notes.push(`resume: a session of ${current.records.length} records`);
    } else if (op.op === 'compact') {
      if (op.prefix) current = start(op.prefix);
      if (!current) {
        notes.push('compact: no session before the turn, nothing to compact');
        continue;
      }
      const parent = lastUuid(current.records);
      current.records.push(
        stamp(
          {
            type: 'system',
            subtype: 'compact_boundary',
            uuid: `${current.id}-compact`,
            parentUuid: parent ?? null,
            content: 'Conversation compacted',
            compactMetadata: { trigger: op.trigger ?? 'auto', preTokens: op.preTokens ?? 0 },
          },
          current.id,
        ),
        stamp(
          {
            type: 'user',
            uuid: `${current.id}-summary`,
            parentUuid: `${current.id}-compact`,
            isCompactSummary: true,
            message: { role: 'user', content: op.summary },
          },
          current.id,
        ),
      );
      notes.push('compact: a compaction boundary and its summary were appended');
    } else if (op.op === 'restart') {
      if (op.prefix) current = start(op.prefix);
      if (!current) {
        notes.push('restart: no session before the turn, nothing to cut');
        continue;
      }
      const keep = Math.max(0, Math.min(op.keep ?? current.records.length - 1, current.records.length));
      const next = current.records[keep];
      current.records = current.records.slice(0, keep);
      if (next !== undefined) {
        const text = JSON.stringify(next);
        current.torn = text.slice(0, Math.max(1, Math.floor(text.length / 2)));
      }
      notes.push(`restart: the session was cut after ${keep} records${next ? ', the next one torn' : ''}`);
    } else if (op.op === 'helper') {
      if (op.prefix) current = start(op.prefix);
      if (!current) current = { id: context.newId(), records: [] };
      const helper = context.helperId();
      const call = `toolu_${helper}`;
      current.records.push(
        stamp(
          {
            type: 'assistant',
            uuid: `${helper}-dispatch`,
            message: {
              id: `msg_${helper}`,
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: call,
                  name: 'Agent',
                  input: { description: op.description, prompt: op.description, run_in_background: true },
                },
              ],
            },
          },
          current.id,
        ),
        stamp(
          {
            type: 'user',
            uuid: `${helper}-started`,
            message: {
              role: 'user',
              content: [
                {
                  type: 'tool_result',
                  tool_use_id: call,
                  content: `Started in the background as ${helper}.`,
                },
              ],
            },
          },
          current.id,
        ),
        stamp(
          {
            type: 'user',
            uuid: `${helper}-own`,
            isSidechain: true,
            message: { role: 'user', content: op.description },
          },
          current.id,
        ),
      );
      notes.push(
        `helper: ${helper} dispatched in the background, ${op.alive ? 'running' : 'its process gone'}`,
      );
    }
  }
  return { file: current, notes };
}

/**
 * The session records of a conversation prefix: one user or assistant record per message, in order, each
 * parented on the one before, so the runtime resumes the conversation as the earlier turns of this session.
 * Only the text of a message goes in. A tool call a message made and the result it got are not in a prefix of
 * messages, so a continuation sees what was said, not what the earlier tools returned. System and tool
 * messages are left out.
 */
export function recordsOfMessages(
  messages: readonly { role: string; content: string }[],
  at: string,
): SessionRecord[] {
  const records: SessionRecord[] = [];
  let parent: string | null = null;
  for (const message of messages) {
    if (message.role !== 'user' && message.role !== 'assistant') continue;
    const uuid = `seed-${records.length + 1}`;
    records.push(
      message.role === 'user'
        ? {
            type: 'user',
            uuid,
            parentUuid: parent,
            timestamp: at,
            message: { role: 'user', content: message.content },
          }
        : {
            type: 'assistant',
            uuid,
            parentUuid: parent,
            timestamp: at,
            message: {
              id: `msg_${uuid}`,
              type: 'message',
              role: 'assistant',
              content: [{ type: 'text', text: message.content }],
              usage: { input_tokens: 0, output_tokens: 0 },
            },
          },
    );
    parent = uuid;
  }
  return records;
}

/** The session file as text: one record per line, then the torn tail when there is one. */
export function sessionFileText(file: SessionFile): string {
  const lines = file.records.map((record) => JSON.stringify(record));
  if (file.torn !== undefined) lines.push(file.torn);
  return `${lines.join('\n')}\n`;
}

/** Reads a session file back: whole records only; a torn line is left out. */
export function readSessionRecords(text: string): SessionRecord[] {
  return parseJsonl(text)
    .filter((entry) => entry.ok && isRecord(entry.value))
    .map((entry) => (entry.ok ? (entry.value as SessionRecord) : {}));
}

/**
 * The operations a turn needs: the session state's at the first turn, an event's the first turn it is
 * named, and `vars.mid_turn` as a queued message. A value the library does not hold is an error, never a
 * silent fresh run.
 */
export function opsForTurn(
  library: StateLibrary | undefined,
  vars: Readonly<Record<string, unknown>>,
  turnIndex: number,
  applied: Set<string>,
  fallback: readonly LiveOp[] = [],
): LiveOp[] {
  const ops: LiveOp[] = [];
  const state = vars.session_state;
  if (turnIndex === 0) {
    if (typeof state === 'string' && state !== 'fresh') ops.push(...lookUp(library, 'states', state));
    else if (state === undefined) ops.push(...fallback);
  }
  const event = vars.event;
  if (typeof event === 'string' && event !== '' && event !== 'no_hazard' && !applied.has(`event:${event}`)) {
    applied.add(`event:${event}`);
    ops.push(...lookUp(library, 'events', event));
  }
  const queued = vars.mid_turn;
  if (typeof queued === 'string' && queued !== '' && !applied.has(`queue:${turnIndex}`)) {
    applied.add(`queue:${turnIndex}`);
    ops.push({ op: 'queue', message: queued });
  }
  return ops;
}

function lookUp(
  library: StateLibrary | undefined,
  part: 'states' | 'events',
  value: string,
): readonly LiveOp[] {
  const ops = library?.[part][value];
  if (ops === undefined) {
    const what = part === 'states' ? 'session state' : 'event';
    throw new Error(
      `the ${what} ${value} has no operation in the state library; add one, or run the spec without it`,
    );
  }
  return ops;
}

function lastUuid(records: readonly SessionRecord[]): string | undefined {
  for (let index = records.length - 1; index >= 0; index -= 1) {
    const uuid = records[index]?.uuid;
    if (typeof uuid === 'string') return uuid;
  }
  return undefined;
}

/** What identifies the files a library was read from: one digest, and the digest of each file. */
export type StateLibraryDigest = {
  /** The sha-256 over the library file and every prefix file it names, in the order of the prefix names. */
  sha256: string;
  /** The prefix files, by prefix name: the file as the library names it and the sha-256 of its bytes. */
  prefixes: Record<string, { file: string; sha256: string }>;
};

const sha256Of = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/**
 * Reads a state library: a JSON file `{ prefixes: { name: file.jsonl }, states: { value: [op] }, events:
 * { value: [op] } }`, where an operation's `prefix` names a prefix by name. Files resolve from the library's
 * folder.
 */
export async function loadStateLibrary(path: string): Promise<StateLibrary> {
  return (await loadStateLibraryWithDigest(path)).library;
}

/**
 * `loadStateLibrary`, and the digest of the exact bytes it read: each file is read once, and the library is built
 * from those bytes. The digest covers the library file and each prefix file in the order of the prefix names, so a
 * change to a transcript a state resumes from changes it.
 */
export async function loadStateLibraryWithDigest(
  path: string,
): Promise<{ library: StateLibrary; digest: StateLibraryDigest }> {
  const bytes = await readFile(path);
  const raw: unknown = JSON.parse(bytes.toString('utf8'));
  if (!isRecord(raw)) throw new Error(`${path}: a state library is one JSON object`);
  const folder = dirname(path);
  const prefixes = new Map<string, SessionRecord[]>();
  const prefixFiles = isRecord(raw.prefixes) ? raw.prefixes : {};
  const hash = createHash('sha256').update(`library ${sha256Of(bytes)}\n`);
  const digests: StateLibraryDigest['prefixes'] = {};
  for (const name of Object.keys(prefixFiles).sort()) {
    const file = prefixFiles[name];
    if (typeof file !== 'string') throw new Error(`${path}: prefix ${name} names no file`);
    const content = await readFile(resolve(folder, file));
    prefixes.set(name, readSessionRecords(content.toString('utf8')));
    digests[name] = { file, sha256: sha256Of(content) };
    hash.update(`prefix ${name} ${file} ${digests[name].sha256}\n`);
  }
  const ops = (part: 'states' | 'events'): Record<string, LiveOp[]> => {
    const table = isRecord(raw[part]) ? raw[part] : {};
    const out: Record<string, LiveOp[]> = {};
    for (const [value, list] of Object.entries(table)) {
      if (!Array.isArray(list)) throw new Error(`${path}: ${part}.${value} is a list of operations`);
      out[value] = list.map((entry, index) => toOp(entry, prefixes, `${path}: ${part}.${value}[${index}]`));
    }
    return out;
  };
  return {
    library: { states: ops('states'), events: ops('events') },
    digest: { sha256: hash.digest('hex'), prefixes: digests },
  };
}

const OPS = new Set(['fresh', 'resume', 'compact', 'restart', 'queue', 'plant', 'helper', 'rate_wave']);

function toOp(entry: unknown, prefixes: Map<string, SessionRecord[]>, where: string): LiveOp {
  if (!isRecord(entry) || typeof entry.op !== 'string' || !OPS.has(entry.op)) {
    throw new Error(`${where}: an operation names op, one of ${[...OPS].join(', ')}`);
  }
  const out: Record<string, unknown> = { ...entry };
  if (entry.prefix !== undefined) {
    if (typeof entry.prefix !== 'string' || !prefixes.has(entry.prefix)) {
      throw new Error(`${where}: prefix ${String(entry.prefix)} is not a prefix of the library`);
    }
    out.prefix = prefixes.get(entry.prefix);
  }
  const need = (key: string, type: 'string' | 'number' | 'boolean') => {
    if (typeof out[key] !== type) throw new Error(`${where}: ${entry.op} needs ${key}, a ${type}`);
  };
  if (entry.op === 'resume' && out.prefix === undefined) throw new Error(`${where}: resume needs a prefix`);
  if (entry.op === 'compact') need('summary', 'string');
  if (entry.op === 'queue') need('message', 'string');
  if (entry.op === 'plant') {
    need('path', 'string');
    need('content', 'string');
  }
  if (entry.op === 'helper') {
    need('alive', 'boolean');
    need('description', 'string');
  }
  if (entry.op === 'rate_wave') need('overloads', 'number');
  return out as LiveOp;
}

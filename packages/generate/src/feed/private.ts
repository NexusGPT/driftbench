import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';

/** One past conversation, as plain text. The id names it for the person who owns the set and is never stored. */
export type Conversation = { id: string; text: string };

const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * A SHA-256 of the set: the hashes of the conversations, sorted and joined. It does not depend on the order
 * of the set and it changes when one conversation changes. The set itself never enters a store or a report.
 */
export function conversationSetHash(conversations: readonly Conversation[]): string {
  return sha256(
    conversations
      .map((conversation) => sha256(conversation.text))
      .sort()
      .join('\n'),
  );
}

/** Where private counts live: DRIFTBENCH_PRIVATE_DIR, else ~/.driftbench/private. */
export function privateDir(env: Record<string, string | undefined> = process.env): string {
  return env.DRIFTBENCH_PRIVATE_DIR?.trim() || join(homedir(), '.driftbench', 'private');
}

/** Throws when `path`, or a folder above it, is a git work tree: private counts never go where a commit can take them. */
export function assertOutsideRepository(path: string): void {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) {
      throw new Error(`${path} is inside a git repository (${dir}): private counts stay outside it`);
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Counts only: the shape that may leave the machine of the owner of the conversations, besides the store. */
export type PrivateCounts = {
  agent: string;
  set_hash: string;
  read: number;
  variables: ReadonlyArray<{
    id: string;
    decided: number;
    unsure: number;
    absent: number;
    unread: number;
    values: ReadonlyArray<{
      id: string;
      count: number;
      share: number | null;
      lower: number | null;
      upper: number | null;
    }>;
  }>;
};

/**
 * Writes the counts of a feed to `<dir>/feed-<agent>-<first 12 hash characters>.json`, owner-only. The folder
 * defaults to privateDir() and must be outside any git repository. Returns the path written.
 */
export async function writePrivateCounts(
  counts: PrivateCounts,
  options: { dir?: string; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const dir = resolve(options.dir ?? privateDir(options.env));
  assertOutsideRepository(dir);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const safeAgent = counts.agent.replace(/[^A-Za-z0-9._-]/g, '_');
  const path = join(dir, `feed-${safeAgent}-${counts.set_hash.slice(0, 12)}.json`);
  await writeFile(path, `${JSON.stringify(counts, null, 2)}\n`, { mode: 0o600 });
  return path;
}

/**
 * Reads a folder of conversations: each `.txt` or `.md` file is one conversation; each `.json` file holds
 * `{ "messages": [{ "role": "...", "content": "..." }] }` and becomes `role: content` lines. Other files are
 * skipped. The folder is the owner's; nothing is copied.
 */
export async function loadConversationDir(dir: string): Promise<Conversation[]> {
  const names = (await readdir(dir)).sort();
  const out: Conversation[] = [];
  for (const name of names) {
    const extension = extname(name).toLowerCase();
    if (extension !== '.txt' && extension !== '.md' && extension !== '.json') continue;
    const raw = await readFile(join(dir, name), 'utf8');
    out.push({ id: name, text: extension === '.json' ? fromMessages(raw, name) : raw });
  }
  return out;
}

function fromMessages(raw: string, name: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  const messages =
    typeof parsed === 'object' && parsed !== null ? (parsed as { messages?: unknown }).messages : undefined;
  if (!Array.isArray(messages)) throw new Error(`${name} has no "messages" array`);
  return messages
    .map((message) => {
      const { role, content } = (message ?? {}) as { role?: unknown; content?: unknown };
      if (typeof role !== 'string' || typeof content !== 'string') {
        throw new Error(`${name} has a message without a text role and content`);
      }
      return `${role}: ${content}`;
    })
    .join('\n');
}

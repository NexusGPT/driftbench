import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { LabelledBlock } from './calibration';
import { saveLabel } from './labels';

/**
 * A review queue: the blocks a reviewer still has to label, one entry per block and criterion. An entry
 * is open until a reviewer takes it (assigned to them), then done once their label is written through
 * `saveLabel`, the same file `judge calibrate` reads. The queue is one JSON file beside the labels.
 */

export type QueueState = 'open' | 'assigned' | 'done';

export type QueueEntry = {
  id: string;
  criterion: string;
  /** The campaign the block's run belongs to, so a viewer can open it. */
  campaign: string;
  runId: string;
  index: number;
  state: QueueState;
  assignee?: string;
  /** Each reviewer's label on the block, in the order they voted. Two votes make an agreement figure. */
  votes?: Array<{ reviewer: string; label: 'pass' | 'fail'; score?: number }>;
};

export type ReviewQueue = { version: 1; entries: QueueEntry[] };

export const QUEUE_FILE = 'queue.json';

export function emptyQueue(): ReviewQueue {
  return { version: 1, entries: [] };
}

const keyOf = (criterion: string, id: string) => `${criterion}\u0000${id}`;

/** Adds the items not already in the queue, in the order given. An item already queued keeps its state. */
export function enqueue(
  queue: ReviewQueue,
  items: ReadonlyArray<{ id: string; criterion: string; campaign: string; runId: string; index: number }>,
): ReviewQueue {
  const seen = new Set(queue.entries.map((entry) => keyOf(entry.criterion, entry.id)));
  const entries = [...queue.entries];
  for (const item of items) {
    const key = keyOf(item.criterion, item.id);
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ ...item, state: 'open' });
  }
  return { version: 1, entries };
}

/** A score's scale: the lowest and highest value it may take. The default is 0 to 1. */
export type ScoreScale = { min: number; max: number };

/** A score, when given, lies on its scale: by default 0 to 1, the reviewer's confidence that the block passes. */
function checkScore(score: number | undefined, scale: ScoreScale): void {
  if (score === undefined) return;
  if (!(Number.isFinite(score) && score >= scale.min && score <= scale.max)) {
    throw new Error(`score ${score} is outside the scale ${scale.min} to ${scale.max}`);
  }
}

function entryOf(queue: ReviewQueue, criterion: string, id: string): QueueEntry {
  const entry = queue.entries.find((candidate) => candidate.criterion === criterion && candidate.id === id);
  if (!entry) throw new Error(`no queue item ${criterion} for block ${id}`);
  return entry;
}

function replaceEntry(queue: ReviewQueue, next: QueueEntry): ReviewQueue {
  return {
    version: 1,
    entries: queue.entries.map((entry) =>
      entry.criterion === next.criterion && entry.id === next.id ? next : entry,
    ),
  };
}

/** Takes an item for one reviewer. Refuses a done item, and an item another reviewer holds. */
export function assign(queue: ReviewQueue, criterion: string, id: string, reviewer: string): ReviewQueue {
  const entry = entryOf(queue, criterion, id);
  if (entry.state === 'done') throw new Error(`${id} is already done`);
  if (entry.state === 'assigned' && entry.assignee !== reviewer) {
    throw new Error(`${id} is assigned to ${entry.assignee}`);
  }
  return replaceEntry(queue, { ...entry, state: 'assigned', assignee: reviewer });
}

/**
 * Writes the reviewer's label for an item they hold, and marks it done. Returns the queue in memory: the
 * caller writes it with `writeQueue`. Refuses an item that is done, held by another reviewer, or not taken.
 */
export async function completeItem(
  dir: string,
  queue: ReviewQueue,
  criterion: string,
  id: string,
  reviewer: string,
  block: LabelledBlock,
  score?: number,
  scale: ScoreScale = { min: 0, max: 1 },
): Promise<ReviewQueue> {
  checkScore(score, scale);
  const entry = entryOf(queue, criterion, id);
  if (entry.state === 'done') throw new Error(`${id} is already done`);
  if (entry.state === 'open') throw new Error(`${id} is not assigned: assign it first`);
  if (entry.assignee !== reviewer) throw new Error(`${id} is assigned to ${entry.assignee}`);
  await saveLabel(dir, criterion, { ...block, id }, reviewer);
  return replaceEntry(queue, {
    ...entry,
    state: 'done',
    votes: [
      ...(entry.votes ?? []),
      { reviewer, label: block.label, ...(score === undefined ? {} : { score }) },
    ],
  });
}

/** Reads the queue of a labels folder; a folder with no queue yet has an empty one. */
export async function readQueue(dir: string): Promise<ReviewQueue> {
  let text: string;
  try {
    text = await readFile(join(dir, QUEUE_FILE), 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return emptyQueue();
    throw cause;
  }
  const parsed = JSON.parse(text) as ReviewQueue;
  if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new Error(`${join(dir, QUEUE_FILE)} is not a review queue`);
  }
  return parsed;
}

/** Writes the queue through a temporary file, so a reader never sees half a file. */
export async function writeQueue(dir: string, queue: ReviewQueue): Promise<void> {
  await mkdir(dir, { recursive: true });
  const path = join(dir, QUEUE_FILE);
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(queue, null, 2)}\n`);
  await rename(temporary, path);
}

/**
 * Adds one reviewer's label to an item, without writing the label file: a second reviewer's view of the same
 * block. Refused when this reviewer already voted on the item.
 */
export function addVote(
  queue: ReviewQueue,
  criterion: string,
  id: string,
  reviewer: string,
  label: 'pass' | 'fail',
): ReviewQueue {
  const entry = entryOf(queue, criterion, id);
  const votes = entry.votes ?? [];
  if (votes.some((vote) => vote.reviewer === reviewer)) throw new Error(`${reviewer} already voted on ${id}`);
  return replaceEntry(queue, { ...entry, votes: [...votes, { reviewer, label }] });
}

export type Agreement = {
  /** Items with at least two votes. */
  items: number;
  /** Items whose first two votes agree. */
  agreed: number;
  /** Share of items that agree. Undefined with no item. */
  percent: number | undefined;
  /** Cohen's kappa between the first two reviewers: agreement beyond chance. Undefined when chance is certain. */
  kappa: number | undefined;
};

/** Agreement between the first two reviewers of each item that has two votes. */
export function agreementOf(queue: ReviewQueue): Agreement {
  const pairs = queue.entries
    .map((entry) => entry.votes ?? [])
    .filter((votes) => votes.length >= 2)
    .map((votes) => [votes[0]?.label, votes[1]?.label] as const);
  const items = pairs.length;
  if (items === 0) return { items: 0, agreed: 0, percent: undefined, kappa: undefined };
  const agreed = pairs.filter(([a, b]) => a === b).length;
  const percent = agreed / items;
  const passA = pairs.filter(([a]) => a === 'pass').length / items;
  const passB = pairs.filter(([, b]) => b === 'pass').length / items;
  const chance = passA * passB + (1 - passA) * (1 - passB);
  const kappa = chance === 1 ? undefined : (percent - chance) / (1 - chance);
  return { items, agreed, percent, kappa };
}

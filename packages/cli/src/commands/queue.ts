import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  addVote,
  agreementOf,
  assign,
  enqueue,
  type ReviewQueue,
  readLabelFile,
  readQueue,
  writeQueue,
} from '@agent-nexus/driftbench-judges';
import { type CampaignData, loadCampaign } from '@agent-nexus/driftbench-report';
import { openStore } from '@agent-nexus/driftbench-store';
import type { Command } from 'commander';
import type { Io } from '../io';

/**
 * `driftbench queue create|list|assign`: the review queue beside the labels. A queue item is one block and
 * one criterion. A reviewer takes an item with `assign`; saving its label in the viewer marks it done.
 */
export function registerQueueCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const queue = program
    .command('queue')
    .description('The review queue of blocks to label, beside the labels');
  queue
    .command('create')
    .description('Queue every block of a campaign, once per criterion of its spec, that has no label yet.')
    .requiredOption('--store <file>', 'the store that holds the campaign')
    .requiredOption('--campaign <id>', 'the campaign whose blocks are queued')
    .option('--labels <dir>', 'the labels folder the queue sits in', 'labels')
    .action(async (options: { store: string; campaign: string; labels: string }) => {
      setExit(await createCommand(options, io));
    });
  queue
    .command('list')
    .description('List the queue, with each item state and who holds it.')
    .option('--labels <dir>', 'the labels folder the queue sits in', 'labels')
    .action(async (options: { labels: string }) => {
      setExit(await listCommand(options, io));
    });
  queue
    .command('vote')
    .description(
      'Record a reviewer label on an item, as a second view of the same block. Does not write the labels file.',
    )
    .argument('<block>', 'the block id, <runId>.b<index>')
    .requiredOption('--criterion <name>', 'the criterion of the item')
    .requiredOption('--reviewer <name>', 'who votes')
    .requiredOption('--label <pass|fail>', 'the label')
    .option('--labels <dir>', 'the labels folder the queue sits in', 'labels')
    .action(
      async (
        block: string,
        options: { criterion: string; reviewer: string; label: string; labels: string },
      ) => {
        setExit(await voteCommand(block, options, io));
      },
    );
  queue
    .command('agreement')
    .description('Print the agreement between the first two reviewers of each item that has two votes.')
    .option('--labels <dir>', 'the labels folder the queue sits in', 'labels')
    .action(async (options: { labels: string }) => {
      setExit(await agreementCommand(options, io));
    });
  queue
    .command('assign')
    .description('Take a queue item for a reviewer. Refused when another reviewer holds it, or it is done.')
    .argument('<block>', 'the block id, <runId>.b<index>')
    .requiredOption('--criterion <name>', 'the criterion of the item')
    .requiredOption('--reviewer <name>', 'who takes the item')
    .option('--labels <dir>', 'the labels folder the queue sits in', 'labels')
    .action(async (block: string, options: { criterion: string; reviewer: string; labels: string }) => {
      setExit(await assignCommand(block, options, io));
    });
}

/** The criteria a block is queued on: the spec's criteria, then any judged verdict's name, sorted. */
function criteriaOf(data: CampaignData, run: CampaignData['runs'][number], index: number): string[] {
  const spec = data.specs.get(`${run.specId}@${run.specHash}`)?.spec;
  const names = new Set<string>();
  for (const def of spec?.criteria ?? []) names.add(def.name);
  for (const verdict of run.blocks[index]?.verdicts ?? [])
    if (verdict.kind === 'judge') names.add(verdict.name);
  return [...names].sort();
}

async function createCommand(
  options: { store: string; campaign: string; labels: string },
  io: Io,
): Promise<number> {
  const storePath = resolve(io.cwd, options.store);
  if (!existsSync(storePath)) {
    io.err(`No store at ${storePath}. Give one with --store <file>.\n`);
    return 2;
  }
  const labels = resolve(io.cwd, options.labels);
  let store: ReturnType<typeof openStore>;
  try {
    store = openStore(storePath);
  } catch (cause) {
    io.err(
      `Cannot open the store at ${storePath}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
    );
    return 2;
  }
  try {
    const data = await loadCampaign(store, options.campaign);
    const items: Array<{ id: string; criterion: string; campaign: string; runId: string; index: number }> =
      [];
    for (const run of data.runs) {
      run.blocks.forEach((_block, index) => {
        for (const criterion of criteriaOf(data, run, index)) {
          items.push({
            id: `${run.runId}.b${index}`,
            criterion,
            campaign: data.campaign.campaignId,
            runId: run.runId,
            index,
          });
        }
      });
    }
    const labelled = new Map<string, Set<string>>();
    const criteria = [...new Set(items.map((item) => item.criterion))];
    for (const criterion of criteria) {
      labelled.set(criterion, new Set((await readLabelFile(labels, criterion)).map((block) => block.id)));
    }
    const fresh = items.filter((item) => !labelled.get(item.criterion)?.has(item.id));
    const before = await readQueue(labels);
    const next = enqueue(before, fresh);
    await writeQueue(labels, next);
    io.out(`Queued ${next.entries.length - before.entries.length} items in ${options.labels}.\n`);
    return 0;
  } catch (cause) {
    io.err(`Cannot queue ${options.campaign}: ${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  } finally {
    await store.close();
  }
}

async function listCommand(options: { labels: string }, io: Io): Promise<number> {
  const queue: ReviewQueue = await readQueue(resolve(io.cwd, options.labels));
  const counts = { open: 0, assigned: 0, done: 0 };
  for (const entry of queue.entries) {
    counts[entry.state] += 1;
    io.out(`${entry.state}\t${entry.criterion}\t${entry.id}\t${entry.assignee ?? '-'}\n`);
  }
  io.out(
    `${queue.entries.length} items: ${counts.open} open, ${counts.assigned} assigned, ${counts.done} done.\n`,
  );
  return 0;
}

async function assignCommand(
  block: string,
  options: { criterion: string; reviewer: string; labels: string },
  io: Io,
): Promise<number> {
  const labels = resolve(io.cwd, options.labels);
  try {
    const next = assign(await readQueue(labels), options.criterion, block, options.reviewer);
    await writeQueue(labels, next);
    io.out(`${block} (${options.criterion}) is assigned to ${options.reviewer}.\n`);
    return 0;
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
}

async function voteCommand(
  block: string,
  options: { criterion: string; reviewer: string; label: string; labels: string },
  io: Io,
): Promise<number> {
  if (options.label !== 'pass' && options.label !== 'fail') {
    io.err(`--label takes pass or fail, not "${options.label}".\n`);
    return 2;
  }
  const labels = resolve(io.cwd, options.labels);
  try {
    const next = addVote(await readQueue(labels), options.criterion, block, options.reviewer, options.label);
    await writeQueue(labels, next);
    io.out(`${options.reviewer} voted ${options.label} on ${block} (${options.criterion}).\n`);
    return 0;
  } catch (cause) {
    io.err(`${cause instanceof Error ? cause.message : String(cause)}\n`);
    return 2;
  }
}

async function agreementCommand(options: { labels: string }, io: Io): Promise<number> {
  const agreement = agreementOf(await readQueue(resolve(io.cwd, options.labels)));
  if (agreement.items === 0 || agreement.percent === undefined) {
    io.out('No item has two votes yet: no agreement to report.\n');
    return 0;
  }
  const items = `${agreement.items} item${agreement.items === 1 ? '' : 's'}`;
  const percent = Math.round(agreement.percent * 100);
  const kappa = agreement.kappa === undefined ? 'n/a' : agreement.kappa.toFixed(2);
  io.out(
    `Agreement over ${items} with two votes: ${agreement.agreed} agree (${percent}%), kappa ${kappa}.\n`,
  );
  return 0;
}

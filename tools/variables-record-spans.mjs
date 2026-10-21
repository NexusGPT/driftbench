#!/usr/bin/env node
// Records the span labels of one commit, round by round, until a round reads no span the recording lacks.
//
//   node tools/variables-record-spans.mjs --sha <commit> --ref <train/branch at that commit> --work <dir>
//     --usd-per-mtok-in <rate> --usd-per-mtok-out <rate> [--cap <usd, default 0.5>]
//
// A round dispatches the `variables-spans-failing` job of validators.yml on the train branch, downloads the spans of
// the items that failed with the labels recorded so far, labels the spans the recording lacks (tools/variables-label-spans.mjs)
// and pushes the recording to the data branch `cassettes/variables-spans` as `<commit>.jsonl`. An item stops at its
// first unlabelled span, so a recording of one round can leave a later span of the same item unread: the rounds repeat
// until a round finds nothing new. The run stops before the cap (labeller spend, summed over the rounds). `gh` and
// `git` must be logged in for the repository the working folder belongs to.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);
const need = (name) => {
  if (args[name] === undefined) {
    console.error(`missing --${name}`);
    process.exit(2);
  }
  return args[name];
};
const sha = need('sha');
const ref = need('ref');
const work = resolve(need('work'));
const rateIn = need('usd-per-mtok-in');
const rateOut = need('usd-per-mtok-out');
const cap = Number(args.cap ?? 0.5);
const MAX_ROUNDS = 8;
const here = dirname(fileURLToPath(import.meta.url));

const run = (cmd, argv, options = {}) =>
  execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], ...options });
const gh = (...argv) => run('gh', argv).trim();
const textsOf = (file) =>
  new Set(
    readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line).text),
  );

mkdirSync(work, { recursive: true });
const remote = run('git', ['remote', 'get-url', 'origin']).trim();
const data = join(work, 'data');
rmSync(data, { recursive: true, force: true });
run('git', ['clone', '--quiet', '--branch', 'cassettes/variables-spans', remote, data]);
const cassette = join(data, `${sha}.jsonl`);
const totalFile = join(work, 'spent.txt');
if (!existsSync(cassette)) writeFileSync(cassette, '');

for (let round = 1; round <= MAX_ROUNDS; round += 1) {
  const started = new Date(Date.now() - 15_000).toISOString();
  gh('workflow', 'run', 'validators.yml', '--ref', ref, '-f', 'jobs=variables-spans-failing');
  let id;
  for (let wait = 0; id === undefined && wait < 30; wait += 1) {
    await new Promise((done) => setTimeout(done, 5000));
    const rows = JSON.parse(
      gh(
        'run',
        'list',
        '--workflow',
        'validators.yml',
        '--branch',
        ref,
        '--limit',
        '5',
        '--json',
        'databaseId,createdAt,event',
      ),
    );
    id = rows.find(
      (row) => row.event === 'workflow_dispatch' && row.createdAt >= started.slice(0, 19),
    )?.databaseId;
  }
  if (id === undefined) throw new Error('the dispatched run did not appear');
  for (;;) {
    const state = JSON.parse(gh('run', 'view', String(id), '--json', 'status,conclusion'));
    if (state.status === 'completed') {
      if (state.conclusion !== 'success') throw new Error(`run ${id} ended ${state.conclusion}`);
      break;
    }
    await new Promise((done) => setTimeout(done, 20000));
  }
  const got = join(work, `round-${round}`);
  rmSync(got, { recursive: true, force: true });
  gh('run', 'download', String(id), '--name', 'variables-failing-spans', '--dir', got);
  const have = textsOf(cassette);
  const fresh = [...textsOf(join(got, 'spans.jsonl'))].filter((text) => !have.has(text)).sort();
  console.log(`round ${round}: run ${id}, ${fresh.length} span(s) the recording lacks`);
  if (fresh.length === 0) {
    console.log(`recorded ${have.size} spans for ${sha}`);
    process.exit(0);
  }
  const todo = join(work, `todo-${round}`);
  mkdirSync(todo, { recursive: true });
  writeFileSync(join(todo, 'spans.jsonl'), fresh.map((text) => `${JSON.stringify({ text })}\n`).join(''));
  const out = join(work, `labels-${round}.jsonl`);
  const label = spawnSync(
    'node',
    [
      join(here, 'variables-label-spans.mjs'),
      ...['--sha', sha, '--spans', todo, '--out', out],
      ...['--usd-per-mtok-in', rateIn, '--usd-per-mtok-out', rateOut],
      ...['--cap', String(cap), '--total-cap', String(cap), '--total-file', totalFile],
    ],
    { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] },
  );
  if (label.status !== 0) throw new Error(`the labeller stopped with status ${label.status}`);
  writeFileSync(cassette, readFileSync(cassette, 'utf8') + readFileSync(out, 'utf8'));
  run('git', ['-C', data, 'add', `${sha}.jsonl`]);
  run('git', [
    '-C',
    data,
    'commit',
    '--quiet',
    '-m',
    `Span labels for ${sha.slice(0, 9)}: round ${round}, ${fresh.length} spans`,
  ]);
  run('git', ['-C', data, 'push', '--quiet', 'origin', 'HEAD:cassettes/variables-spans']);
}
throw new Error(`no fixed point after ${MAX_ROUNDS} rounds`);

import { STANDING, skillFile } from '../layout';
import { namesFor, plantSkill, writeSettings } from './common';
import { type Family, itemsOf, type Tier } from './frame';
import { atomOfHid, type Check, type Planted, PlantedEstate } from './planted';

/**
 * Three families of what code reads from prose lines, each item one line in a skill's body.
 *
 * scan.gates: the fixed forms of an order rule ("before X: read Y" and its kin), with their wording, markup,
 * acts and targets varied, and lines that look like the forms and are not rules (a decoy gives no gate).
 * The oracle: the gate atom, what must be read first, the act it comes before, the ordered pair of tool
 * labels, and the reference when the first thing is a file.
 *
 * scan.hazards: lines that name a hazard of a long-running agent, in the runtime's words and in others, and
 * decoys that use the same words about something else (a compact table, a printer's restart button).
 *
 * scan.paths: the ways a line names a file (backticks, links with anchors or titles, relative climbs, a
 * missing file) and things that look like paths and are not (a URL, a glob, a folder, a code example).
 */

const CODE = 'packages/estate/src/scan/code.ts';

type Line = {
  key: string;
  tier: Tier;
  title: string;
  /** The body line, for the item's names and the reference file it may name. */
  text(names: { noun: string; verb: string; skill: string }, file: string): string;
  /** Files beside SKILL.md the line names, created. */
  files?: string[];
  atoms(owner: string, path: (relative: string) => string, names: { noun: string }): Planted[];
  checks?(owner: string, path: (relative: string) => string): Check[];
};

function gateCheck(
  owner: string,
  expected: { first?: string; trigger?: string; before?: string; after?: string },
): Check {
  return (scan) => {
    const atom = atomOfHid(scan, `${owner}:gate`);
    if (!atom) return undefined;
    const problems: string[] = [];
    if (expected.first !== undefined && atom.fields?.first !== expected.first) {
      problems.push(
        `first is ${JSON.stringify(atom.fields?.first)}, expected ${JSON.stringify(expected.first)}`,
      );
    }
    if (expected.trigger !== undefined && atom.fields?.trigger !== expected.trigger) {
      problems.push(
        `the act is ${JSON.stringify(atom.fields?.trigger)}, expected ${JSON.stringify(expected.trigger)}`,
      );
    }
    const pair = atom.evidence.find((item) => item.type === 'ordered') as
      | { before?: string; after?: string }
      | undefined;
    if (
      expected.before !== undefined &&
      (pair?.before !== expected.before || pair?.after !== expected.after)
    ) {
      problems.push(
        `the pair is ${pair?.before} before ${pair?.after}, expected ${expected.before} before ${expected.after}`,
      );
    }
    return problems.length === 0 ? undefined : problems.join(', ');
  };
}

/** A gate atom: the act it waits for (a part of the line) and the tool of that act, for the planted-truth labeller. */
const gate = (owner: string, act: string, tool: string): Planted => ({
  hid: `${owner}:gate`,
  kind: 'gate',
  act,
  tool,
});
const reference = (owner: string, key: string, tag = 'ref'): Planted => ({
  hid: `${owner}:${tag}`,
  kind: 'reference',
  key,
});

const GATES: Line[] = [
  {
    key: 'colon-form',
    tier: 1,
    title: 'before X: read Y',
    text: (n, f) => `Before editing a ${n.noun}: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o, _p) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'comma-form',
    tier: 1,
    title: 'before X, read Y',
    text: (n, f) => `Before you edit a ${n.noun}, read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `edit a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'read-before-form',
    tier: 1,
    title: 'read Y before X',
    text: (n, f) => `Read \`${f}\` before you change a ${n.noun}.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `change a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'until-form',
    tier: 1,
    title: 'do not X until you have read Y',
    text: () => 'Do not commit until you have read the output of `git status`.',
    atoms: (o) => [gate(o, 'commit', 'Bash')],
    checks: (o) => [gateCheck(o, { first: 'git status', trigger: 'commit' })],
  },
  {
    key: 'upper-case',
    tier: 2,
    title: 'the colon form in capitals',
    text: (n, f) => `BEFORE EDITING A ${n.noun.toUpperCase()}: READ \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [
      gate(o, `EDITING A ${n.noun.toUpperCase()}`, 'Edit'),
      reference(o, p('references/rules.md')),
    ],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'bold-act',
    tier: 3,
    title: 'the colon form with the act in bold',
    text: (n, f) => `**Before editing a ${n.noun}**: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [
      (scan) => {
        const atom = atomOfHid(scan, `${o}:gate`);
        return atom && /\*/.test(String(atom.fields?.trigger))
          ? `the act keeps its markup: ${atom.fields?.trigger}`
          : undefined;
      },
    ],
  },
  {
    key: 'act-write',
    tier: 1,
    title: 'an act of writing: the pair ends on Write',
    text: (n, f) => `Before writing a new ${n.noun}: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `writing a new ${n.noun}`, 'Write'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { before: 'Read', after: 'Write' })],
  },
  {
    key: 'act-deploy',
    tier: 1,
    title: 'an act of deploying: the pair ends on the shell',
    text: (_n, f) => `Before you deploy, read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p) => [gate(o, 'deploy', 'Bash'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { before: 'Read', after: 'Bash' })],
  },
  {
    key: 'act-dispatch',
    tier: 1,
    title: 'an act of dispatching: the pair ends on the helper call',
    text: (_n, f) => `Before dispatching a helper: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p) => [gate(o, 'dispatching a helper', 'Agent'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { before: 'Read', after: 'Agent' })],
  },
  {
    key: 'act-update',
    tier: 3,
    title: 'an act of updating, which is an edit',
    text: (n, f) => `Before updating a ${n.noun}: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `updating a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { before: 'Read', after: 'Edit' })],
  },
  {
    key: 'act-rename',
    tier: 3,
    title: 'an act of renaming, which is a shell move',
    text: (n, f) => `Before renaming a ${n.noun} file: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [
      gate(o, `renaming a ${n.noun} file`, 'Bash'),
      reference(o, p('references/rules.md')),
    ],
    checks: (o) => [gateCheck(o, { before: 'Read', after: 'Bash' })],
  },
  {
    key: 'dot-slash',
    tier: 2,
    title: 'a first file written with ./',
    text: (n) => `Before editing a ${n.noun}: read \`./references/rules.md\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o, p) => [
      (scan) => {
        const atom = atomOfHid(scan, `${o}:gate`);
        return atom && atom.fields?.path !== p('references/rules.md')
          ? `the path is ${atom.fields?.path}`
          : undefined;
      },
    ],
  },
  {
    key: 'markdown-link',
    tier: 3,
    title: 'a first file named by a markdown link',
    text: (n) => `Before editing a ${n.noun}: read [the rules](references/rules.md).`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o, p) => [
      (scan) => {
        const atom = atomOfHid(scan, `${o}:gate`);
        return atom && atom.fields?.path !== p('references/rules.md')
          ? `the path is ${atom.fields?.path}`
          : undefined;
      },
    ],
  },
  {
    key: 'two-on-one-line',
    tier: 4,
    title: 'two gates on one line',
    text: (n) =>
      `Before editing a ${n.noun}: read \`references/rules.md\`; before sending one: read \`references/send.md\`.`,
    files: ['references/rules.md', 'references/send.md'],
    atoms: (o, p, n) => [
      gate(o, `editing a ${n.noun}`, 'Edit'),
      { hid: `${o}:gate2`, kind: 'gate' },
      reference(o, p('references/rules.md')),
      reference(o, p('references/send.md'), 'ref2'),
    ],
  },
  {
    key: 'missing-file',
    tier: 2,
    title: 'a first file that does not exist: the gate stands, the reference is missing',
    text: (n) => `Before editing a ${n.noun}: read \`references/gone.md\`.`,
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/gone.md'))],
    checks: (o) => [
      (scan) =>
        atomOfHid(scan, `${o}:ref`)?.fields?.exists === false
          ? undefined
          : 'the reference is not marked missing',
    ],
  },
  {
    key: 'again',
    tier: 2,
    title: 'the comma form with a word after the file',
    text: (n) => `Before every ${n.noun} edit, read \`references/rules.md\` again.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `every ${n.noun} edit`, 'Edit'), reference(o, p('references/rules.md'))],
  },
  {
    key: 'decoy-lunch',
    tier: 3,
    title: 'a decoy: "before lunch: read nothing heavy"',
    text: () => 'Before lunch: read nothing heavy, then rest.',
    atoms: () => [],
  },
  {
    key: 'decoy-history',
    tier: 3,
    title: 'a decoy: a file read before an event in the past',
    text: () => 'We read `references/rules.md` before the audit last year, and it was fine.',
    files: ['references/rules.md'],
    atoms: (o, p) => [reference(o, p('references/rules.md'))],
  },
  {
    key: 'decoy-panic',
    tier: 3,
    title: 'a decoy: "do not panic until you have read the summary"',
    text: () => 'Do not panic until you have read the summary twice.',
    atoms: () => [],
  },
  {
    key: 'decoy-example',
    tier: 4,
    title: 'a decoy: the form quoted as an example',
    text: () => 'The phrase "before editing: read the notes" is only an example of a gate.',
    atoms: () => [],
  },
  {
    key: 'decoy-time',
    tier: 4,
    title: 'a decoy: a file read before a time of day',
    text: () => 'Read `references/rules.md` before 9 in the morning if you can.',
    files: ['references/rules.md'],
    atoms: (o, p) => [reference(o, p('references/rules.md'))],
  },
  {
    key: 'decoy-bare-before',
    tier: 2,
    title: 'a decoy: a heading "Before:" with nothing to do',
    text: () => 'Before: read the list below.',
    atoms: () => [],
  },
  {
    key: 'then-form',
    tier: 3,
    title: 'read Y first, then X',
    text: (n, f) => `Read \`${f}\` first, then edit the ${n.noun}.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `edit the ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'without-form',
    tier: 3,
    title: 'never X without reading Y',
    text: (n, f) => `Never edit a ${n.noun} without reading \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `edit a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'only-after-form',
    tier: 3,
    title: 'X only after reading Y',
    text: (n, f) => `Edit a ${n.noun} only after reading \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `Edit a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'two-files',
    tier: 4,
    title: 'a gate naming two files to read',
    text: (n, f) => `Before editing a ${n.noun}: read \`${f}\` and \`references/terms.md\`.`,
    files: ['references/rules.md', 'references/terms.md'],
    atoms: (o, p, n) => [
      gate(o, `editing a ${n.noun}`, 'Edit'),
      reference(o, p('references/rules.md')),
      reference(o, p('references/terms.md'), 'ref2'),
    ],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'list-item',
    tier: 1,
    title: 'the colon form as a list item',
    text: (n, f) => `- Before editing a ${n.noun}: read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'question-form',
    tier: 4,
    title: 'the act as a question: X? read Y first',
    text: (n, f) => `Editing a ${n.noun}? Read \`${f}\` first.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `Editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
  {
    key: 'prior-to-form',
    tier: 3,
    title: 'prior to X, read Y',
    text: (n, f) => `Prior to editing a ${n.noun}, read \`${f}\`.`,
    files: ['references/rules.md'],
    atoms: (o, p, n) => [gate(o, `editing a ${n.noun}`, 'Edit'), reference(o, p('references/rules.md'))],
    checks: (o) => [gateCheck(o, { first: 'references/rules.md', before: 'Read', after: 'Edit' })],
  },
];

const hazard = (owner: string, id: string, tag = 'hazard'): Planted => ({
  hid: `${owner}:${tag}`,
  kind: 'hazard',
  key: id,
});

const HAZARDS: Line[] = [
  {
    key: 'compaction',
    tier: 1,
    title: 'after a compaction',
    text: (n) => `After a compaction, check the ${n.noun} list again.`,
    atoms: (o) => [hazard(o, 'compaction')],
  },
  {
    key: 'compacted',
    tier: 1,
    title: 'when the context is compacted',
    text: (n) => `When the context is compacted, keep the ${n.noun} open.`,
    atoms: (o) => [hazard(o, 'compaction')],
  },
  {
    key: 'restarts',
    tier: 1,
    title: 'if the process restarts',
    text: (n) => `If the process restarts, reopen the ${n.noun}.`,
    atoms: (o) => [hazard(o, 'restart')],
  },
  {
    key: 'restart',
    tier: 1,
    title: 'after a restart',
    text: (n) => `After a restart, list each ${n.noun} again.`,
    atoms: (o) => [hazard(o, 'restart')],
  },
  {
    key: 'rate-limit',
    tier: 1,
    title: 'on a rate limit',
    text: () => 'On a rate limit, wait and try once more.',
    atoms: (o) => [hazard(o, 'rate_wave')],
  },
  {
    key: 'session-start',
    tier: 1,
    title: 'at the start of every session',
    text: (n) => `At the start of every session, read the ${n.noun} log.`,
    atoms: (o) => [hazard(o, 'session_boundary')],
  },
  {
    key: 'notification',
    tier: 1,
    title: 'when a helper notification arrives',
    text: () => 'When a helper notification arrives, read it before anything else.',
    atoms: (o) => [hazard(o, 'notification')],
  },
  {
    key: 'nudges',
    tier: 1,
    title: 'when nudges repeat',
    text: () => 'If the same nudges repeat, stop and say so.',
    atoms: (o) => [hazard(o, 'nudge_storm')],
  },
  {
    key: 'two-hazards',
    tier: 2,
    title: 'two hazards on one line',
    text: (n) => `After a restart or a compaction, reopen the ${n.noun}.`,
    atoms: (o) => [hazard(o, 'compaction'), hazard(o, 'restart', 'hazard2')],
  },
  {
    key: 'summarized',
    tier: 3,
    title: 'a compaction called a summary of the conversation',
    text: (n) => `When the conversation is summarized to save space, reopen the ${n.noun}.`,
    atoms: (o) => [hazard(o, 'compaction')],
  },
  {
    key: 'window-full',
    tier: 4,
    title: 'a compaction called a full context window',
    text: (n) => `When the context window fills up, save the ${n.noun} first.`,
    atoms: (o) => [hazard(o, 'compaction')],
  },
  {
    key: 'status-429',
    tier: 3,
    title: 'a rate limit called a 429',
    text: () => 'If the service answers 429, wait a minute and try once more.',
    atoms: (o) => [hazard(o, 'rate_wave')],
  },
  {
    key: 'reboot',
    tier: 3,
    title: 'a restart called a reboot',
    text: (n) => `If the machine reboots, reopen the ${n.noun}.`,
    atoms: (o) => [hazard(o, 'restart')],
  },
  {
    key: 'resumed',
    tier: 3,
    title: 'a session resumed the next day',
    text: (n) => `When the session is resumed the next day, read the ${n.noun} log.`,
    atoms: (o) => [hazard(o, 'session_boundary')],
  },
  {
    key: 'decoy-compact-table',
    tier: 3,
    title: 'a decoy: a compact table',
    text: () => 'Keep the summary table compact and short.',
    atoms: () => [],
  },
  {
    key: 'decoy-printer',
    tier: 3,
    title: "a decoy: a printer's restart button",
    text: () => 'Press the restart button of the label printer when it jams.',
    atoms: () => [],
  },
  {
    key: 'decoy-contract',
    tier: 3,
    title: "a decoy: a supplier's rate limits",
    text: () => "Read the supplier's rate limits for orders in the contract.",
    atoms: () => [],
  },
  {
    key: 'decoy-customer',
    tier: 3,
    title: 'a decoy: a notification to a customer',
    text: (n) => `Send a notification to the customer when the ${n.noun} ships.`,
    atoms: () => [],
  },
  {
    key: 'decoy-price',
    tier: 3,
    title: 'a decoy: nudging a price',
    text: () => 'Nudge the price up by one percent at most.',
    atoms: () => [],
  },
  {
    key: 'decoy-course',
    tier: 3,
    title: 'a decoy: a new session of a course',
    text: () => 'A new session of the training starts in May.',
    atoms: () => [],
  },
  {
    key: 'decoy-compactor',
    tier: 1,
    title: 'a decoy: the compactor in the yard',
    text: () => 'The compactor in the yard is serviced monthly.',
    atoms: () => [],
  },
  {
    key: 'decoy-restarting',
    tier: 1,
    title: 'a decoy: restarting a count',
    text: () => 'Restarting a count from zero is allowed.',
    atoms: () => [],
  },
];

const PATHS: Line[] = [
  {
    key: 'backticked',
    tier: 1,
    title: 'a backticked relative path',
    text: () => 'When unsure, open `references/guide.md`.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'dot-slash',
    tier: 1,
    title: 'a path starting with ./',
    text: () => 'When unsure, open `./references/guide.md`.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'climb',
    tier: 2,
    title: "a path climbing to a sibling skill's file",
    text: () => 'When unsure, open `../shared-notes/guide.md`.',
    atoms: (o, p) => [reference(o, p('../shared-notes/guide.md'))],
  },
  {
    key: 'link',
    tier: 1,
    title: 'a markdown link',
    text: () => 'When unsure, see [the guide](references/guide.md).',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'link-anchor',
    tier: 3,
    title: 'a markdown link to a section',
    text: () => 'When unsure, see [the guide](references/guide.md#limits).',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'link-title',
    tier: 3,
    title: 'a markdown link with a title',
    text: () => 'When unsure, see [the guide](references/guide.md "Guide").',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'link-angle',
    tier: 4,
    title: 'a markdown link in angle brackets with a space',
    text: () => 'When unsure, see [the notes](<references/team notes.md>).',
    files: ['references/team notes.md'],
    atoms: (o, p) => [reference(o, p('references/team notes.md'))],
  },
  {
    key: 'query',
    tier: 3,
    title: 'a path with a query',
    text: () => 'When unsure, open `references/guide.md?raw`.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'backslashes',
    tier: 4,
    title: 'a path written with backslashes',
    text: () => 'When unsure, open `references\\guide.md`.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'bold-path',
    tier: 4,
    title: 'a path in bold, not in backticks',
    text: () => 'When unsure, open **references/guide.md** first.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'import-syntax',
    tier: 4,
    title: 'an import written @path',
    text: () => 'Always load @references/guide.md with this skill.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'spaced-name',
    tier: 3,
    title: 'a backticked file name with a space',
    text: () => 'When unsure, open `references/team notes.md`.',
    files: ['references/team notes.md'],
    atoms: (o, p) => [reference(o, p('references/team notes.md'))],
  },
  {
    key: 'upper-extension',
    tier: 2,
    title: 'an upper-case extension',
    text: () => 'When unsure, open `references/GUIDE.MD`.',
    files: ['references/GUIDE.MD'],
    atoms: (o, p) => [reference(o, p('references/GUIDE.MD'))],
  },
  {
    key: 'data-file',
    tier: 1,
    title: 'a data file',
    text: () => 'Look codes up in `data/codes.json`.',
    files: ['data/codes.json'],
    atoms: (o, p) => [reference(o, p('data/codes.json'))],
  },
  {
    key: 'missing',
    tier: 1,
    title: 'a file that does not exist',
    text: () => 'When unsure, open `references/gone.md`.',
    atoms: (o, p) => [reference(o, p('references/gone.md'))],
    checks: (o) => [
      (scan) =>
        atomOfHid(scan, `${o}:ref`)?.fields?.exists === false
          ? undefined
          : 'the reference is not marked missing',
    ],
  },
  {
    key: 'rooted',
    tier: 1,
    title: 'a path from the layout root',
    text: () => 'When unsure, open `.claude/docs/guide.md`.',
    atoms: (o) => [reference(o, '.claude/docs/guide.md')],
  },
  {
    key: 'two-on-a-line',
    tier: 2,
    title: 'two files on one line',
    text: () => 'Open `references/guide.md` and `references/terms.md`.',
    files: ['references/guide.md', 'references/terms.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md')), reference(o, p('references/terms.md'), 'ref2')],
  },
  {
    key: 'decoy-url',
    tier: 2,
    title: 'a decoy: a backticked web address',
    text: () => 'The public guide is at `https://example.com/guide.md`.',
    atoms: () => [],
  },
  {
    key: 'decoy-link-url',
    tier: 1,
    title: 'a decoy: a link to a web address',
    text: () => 'See [the public guide](https://example.com/guide.md).',
    atoms: () => [],
  },
  {
    key: 'decoy-glob',
    tier: 1,
    title: 'a decoy: a glob',
    text: () => 'Never touch `references/*.md` by hand.',
    atoms: () => [],
  },
  {
    key: 'decoy-folder',
    tier: 1,
    title: 'a decoy: a folder',
    text: () => 'Keep notes in `references/`.',
    atoms: () => [],
  },
  {
    key: 'decoy-version',
    tier: 3,
    title: 'a decoy: a version number in backticks',
    text: () => 'This skill needs the tool at version `2.4.1` or later.',
    atoms: () => [],
  },
  {
    key: 'decoy-code-example',
    tier: 3,
    title: 'a decoy: a file name inside a command example',
    text: () => 'Example: `cat notes.md | wc -l` counts the lines.',
    atoms: () => [],
  },
  {
    key: 'line-number',
    tier: 3,
    title: 'a path followed by a line number',
    text: () => 'When unsure, open `references/guide.md:12`.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'bare-path',
    tier: 3,
    title: 'a bare path with no markup',
    text: () => 'When unsure, open references/guide.md first.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'single-quoted',
    tier: 3,
    title: 'a path in single quotes',
    text: () => "When unsure, open 'references/guide.md' first.",
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'double-quoted',
    tier: 3,
    title: 'a path in double quotes',
    text: () => 'When unsure, open "references/guide.md" first.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'html-link',
    tier: 4,
    title: 'an HTML link',
    text: () => 'When unsure, see <a href="references/guide.md">the guide</a>.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'project-dir',
    tier: 4,
    title: 'a path from the project folder variable',
    text: (n) => `When unsure, open \`$CLAUDE_PROJECT_DIR/${skillFile(n.skill, 'references/guide.md')}\`.`,
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'angle-autolink',
    tier: 3,
    title: 'a path in angle brackets',
    text: () => 'When unsure, open <references/guide.md> first.',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
  {
    key: 'wiki-link',
    tier: 4,
    title: 'a wiki link without its extension',
    text: () => 'When unsure, see [[references/guide]].',
    files: ['references/guide.md'],
    atoms: (o, p) => [reference(o, p('references/guide.md'))],
  },
];

function lineFamily(family: string, lines: readonly Line[], verb: string): Family {
  const items = itemsOf(
    family,
    1,
    CODE,
    lines.map(({ key, tier, title }) => ({ key, tier, title: `${verb} ${title}` })),
  );
  return {
    id: family,
    level: 1,
    component: CODE,
    items,
    async evaluate(seed) {
      const estate = new PlantedEstate();
      estate.file(STANDING, 'base').line('# Planted estate');
      writeSettings(estate);
      for (const line of lines) {
        const owner = `${family}.${line.key}`;
        const names = namesFor(seed, owner);
        const path = (relative: string) => {
          const full = skillFile(names.skill, relative);
          return full.replace(/\/[^/]+\/\.\.\//, '/');
        };
        for (const file of line.files ?? []) estate.raw(path(file), '# File\n', owner);
        const text = line.text(names, line.files?.[0] ?? 'references/rules.md');
        plantSkill(estate, owner, names.skill, `${capital(names.title)} for the team.`, [
          { text, atoms: line.atoms(owner, path, names) },
        ]);
        for (const check of line.checks?.(owner, path) ?? []) estate.check(owner, check);
      }
      const scan = await estate.scan();
      return estate.judge(
        scan,
        items.map((item) => item.id),
      );
    },
  };
}

export function gatesFamily(): Family {
  return lineFamily('scan.gates', GATES, 'code reads');
}
export function hazardsFamily(): Family {
  return lineFamily('scan.hazards', HAZARDS, 'code reads');
}
export function pathsFamily(): Family {
  return lineFamily('scan.paths', PATHS, 'code reads');
}

function capital(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

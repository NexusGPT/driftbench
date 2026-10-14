import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Io } from './io';

/**
 * The help topics of `driftbench help`: one markdown file per topic in the package's `help` folder, named
 * `<area>-<slug>.md`, with front matter (title, summary, commands, see_also, next) and fixed sections. The
 * folder's README.md is the contract every topic follows; OVERVIEW.md opens the index. Files are read when help
 * runs, so a topic added later shows up with no code change.
 */

/** The areas, in the order the index lists them. */
export const HELP_AREAS = [
  'core',
  'recipes',
  'authoring',
  'running',
  'judging',
  'results',
  'validate',
  'redteam',
] as const;

/** The sections of a topic body, each a `##` heading, in this order. */
export const HELP_SECTIONS = [
  'What it is',
  'When to use it',
  'Commands and every option',
  'Inputs',
  'Outputs and how to read them',
  'Worked example',
  'Common errors',
] as const;

/** The sections of a recipe (area `recipes`), a goal-first walkthrough, in this order. */
export const RECIPE_SECTIONS = [
  'Goal',
  'Before you start',
  'Steps',
  'What you have at the end',
  'When a step fails',
] as const;

/** The sections a topic of this area must have, in order. */
export function sectionsFor(area: string): readonly string[] {
  return area === 'recipes' ? RECIPE_SECTIONS : HELP_SECTIONS;
}

/** The section whose `sh` blocks a test runs: the worked example, or a recipe's steps. */
export function runnableSection(area: string): string {
  return area === 'recipes' ? 'Steps' : 'Worked example';
}

/** The file printed at the top of `driftbench help`, before the topic list. */
export const OVERVIEW_FILE = 'OVERVIEW.md';

/** A topic file name: an area, a hyphen, a slug of lower case letters, digits and hyphens. */
export const TOPIC_FILE = /^([a-z]+)-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;

export type HelpTopic = {
  /** The file name without `.md`, such as `core-getting-started`. */
  id: string;
  area: string;
  title: string;
  summary: string;
  commands: string[];
  see_also: string[];
  /** Topic ids to read next. Empty: the topic that follows in the index. */
  next: string[];
  /** The text after the front matter. */
  body: string;
  /** What is wrong with the front matter, when something is. The topic is still listed and printed. */
  problem?: string;
};

/** The help folder of this package: `help` beside `src` and `dist`. */
export function helpDir(): string {
  return fileURLToPath(new URL('../help/', import.meta.url));
}

/** Every topic in the folder, sorted by area order then id. A missing folder gives none. */
export function loadHelpTopics(dir: string = helpDir()): HelpTopic[] {
  if (!existsSync(dir)) return [];
  const topics = readdirSync(dir)
    .filter((name) => TOPIC_FILE.test(name))
    .map((name) => parseTopic(name.slice(0, -'.md'.length), readFileSync(join(dir, name), 'utf8')));
  return topics.sort((a, b) => areaRank(a.area) - areaRank(b.area) || a.id.localeCompare(b.id));
}

function areaRank(area: string): number {
  const rank = (HELP_AREAS as readonly string[]).indexOf(area);
  return rank === -1 ? HELP_AREAS.length : rank;
}

/**
 * The YAML parser, loaded when a topic is first read: `driftbench --help` and every command that prints no
 * topic never load it.
 */
function parseYaml(text: string): unknown {
  const yaml = createRequire(import.meta.url)('yaml') as { parse(text: string): unknown };
  return yaml.parse(text);
}

/** One topic from its id and its text. A broken front matter is reported in `problem`, never thrown. */
export function parseTopic(id: string, text: string): HelpTopic {
  const area = id.split('-', 1)[0] as string;
  const topic: HelpTopic = {
    id,
    area,
    title: id,
    summary: '',
    commands: [],
    see_also: [],
    next: [],
    body: text,
  };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match === null) return { ...topic, problem: 'no front matter' };
  topic.body = text.slice(match[0].length);
  let data: unknown;
  try {
    data = parseYaml(match[1] as string);
  } catch (cause) {
    return { ...topic, problem: `front matter is not YAML: ${(cause as Error).message}` };
  }
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    return { ...topic, problem: 'front matter is not a map' };
  }
  const fields = data as Record<string, unknown>;
  const problems: string[] = [];
  const text1 = (key: 'title' | 'summary') => {
    const value = fields[key];
    if (typeof value === 'string' && value.trim() !== '' && !value.includes('\n')) return value.trim();
    problems.push(`${key} must be one line of text`);
    return undefined;
  };
  const list = (key: 'commands' | 'see_also' | 'next') => {
    const value = fields[key] ?? [];
    if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
      return value.map((item) => item.trim().replace(/\s+/g, ' '));
    }
    problems.push(`${key} must be a list of text`);
    return [];
  };
  topic.title = text1('title') ?? id;
  topic.summary = text1('summary') ?? '';
  topic.commands = list('commands');
  topic.see_also = list('see_also');
  topic.next = list('next');
  const unknown = Object.keys(fields).filter(
    (key) => !['title', 'summary', 'commands', 'see_also', 'next'].includes(key),
  );
  if (unknown.length > 0) problems.push(`unknown keys: ${unknown.join(', ')}`);
  return problems.length > 0 ? { ...topic, problem: problems.join('; ') } : topic;
}

/** The overview that opens the index, or undefined when the file is absent. */
export function loadOverview(dir: string = helpDir()): string | undefined {
  const path = join(dir, OVERVIEW_FILE);
  return existsSync(path) ? readFileSync(path, 'utf8').trim() : undefined;
}

/** The index: the overview, then every topic grouped by area with its summary, and how to read on. */
export function formatHelpIndex(topics: readonly HelpTopic[], overview?: string): string {
  const lines: string[] = [];
  if (overview !== undefined) lines.push(overview, '');
  lines.push(
    'Help topics',
    '',
    'Print a topic: driftbench help <topic>. Search them: driftbench help search <word>.',
    'Every command with one line: driftbench help --list. One command: driftbench <command> --help.',
  );
  if (topics.length === 0) {
    lines.push('', 'No topic is installed.');
    return `${lines.join('\n')}\n`;
  }
  const width = Math.max(...topics.map((topic) => topic.id.length));
  const areas = [...new Set(topics.map((topic) => topic.area))];
  for (const area of areas) {
    lines.push('', area);
    for (const topic of topics.filter((each) => each.area === area)) {
      const summary = topic.problem === undefined ? topic.summary : `(broken topic: ${topic.problem})`;
      lines.push(`  ${topic.id.padEnd(width)}  ${summary}`);
    }
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The topics to read after this one: its `next` list, else the topic that follows it in the index order
 * (none after the last).
 */
export function nextTopics(topics: readonly HelpTopic[], topic: HelpTopic): string[] {
  if (topic.next.length > 0) return topic.next;
  const at = topics.findIndex((each) => each.id === topic.id);
  const following = at === -1 ? undefined : topics[at + 1];
  return following === undefined ? [] : [following.id];
}

/** One topic as the reader sees it: title, summary, the commands it covers, its sections, see also, next. */
export function formatHelpTopic(topic: HelpTopic, next: readonly string[] = []): string {
  const head = [topic.title, topic.summary];
  if (topic.problem !== undefined) head.push(`(broken topic: ${topic.problem})`);
  if (topic.commands.length > 0) {
    head.push('', `Commands: ${topic.commands.map((command) => `driftbench ${command}`).join(', ')}`);
  }
  const tail: string[] = [];
  if (topic.see_also.length > 0) {
    tail.push(`See also: ${topic.see_also.map((id) => `driftbench help ${id}`).join(', ')}`);
  }
  tail.push(
    next.length > 0
      ? `Next: ${next.map((id) => `driftbench help ${id}`).join(', ')}`
      : 'Next: driftbench help, the index of every topic',
  );
  return `${head.join('\n')}\n\n${topic.body.trim()}\n\n${tail.join('\n')}\n`;
}

/** A topic that holds the query: how many lines hold one of its words, and the first such line. */
export type SearchHit = { topic: HelpTopic; count: number; first: string };

/** The words of a text, lower case: letters, digits and underscores, so `--judge-budget` gives judge, budget. */
function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/**
 * A word without its common English ending, so `codes`, `coded` and `coding` meet `code`, while `decoder`
 * never meets `code`: a stem is compared whole, never as a part of another word.
 */
export function stem(word: string): string {
  for (const suffix of ['ing', 'ies', 'es', 'ed', 's']) {
    if (word.length > suffix.length + 2 && word.endsWith(suffix)) {
      const base = word.slice(0, -suffix.length);
      return suffix === 'ies' ? `${base}y` : base;
    }
  }
  return word.endsWith('e') && word.length > 3 ? word.slice(0, -1) : word;
}

/**
 * The topics that hold every word of the query as a whole word (or the same stem), case blind, in title,
 * summary, commands or body. Ranked by how many query words the title and summary hold, then by the lines
 * that hold every word together, then by the lines that hold any, then by id, so adding a topic never
 * reorders the others.
 */
export function searchHelpTopics(topics: readonly HelpTopic[], query: string): SearchHit[] {
  const wanted = [...new Set(wordsOf(query).map(stem))];
  if (wanted.length === 0) return [];
  const stemsOf = (line: string) => new Set(wordsOf(line).map(stem));
  const holds = (line: string) => {
    const stems = stemsOf(line);
    return wanted.filter((word) => stems.has(word)).length;
  };
  const hits: (SearchHit & { head: number; together: number })[] = [];
  for (const topic of topics) {
    const lines = [topic.title, topic.summary, ...topic.commands, ...topic.body.split('\n')];
    const all = stemsOf(lines.join('\n'));
    if (!wanted.every((word) => all.has(word))) continue;
    const matching = lines.filter((line) => holds(line) > 0);
    const together = lines.filter((line) => holds(line) === wanted.length).length;
    const head = holds(`${topic.title} ${topic.summary}`);
    hits.push({ topic, count: matching.length, first: (matching[0] ?? '').trim(), head, together });
  }
  hits.sort(
    (a, b) =>
      b.head - a.head || b.together - a.together || b.count - a.count || a.topic.id.localeCompare(b.topic.id),
  );
  return hits.map(({ head: _head, together: _together, ...hit }) => hit);
}

/** The search result: one block per topic, its id and summary, then its first matching line. */
export function formatSearch(query: string, hits: readonly SearchHit[]): string {
  if (hits.length === 0) {
    return `No help topic holds "${query}". List the topics: driftbench help. Every command: driftbench help --list\n`;
  }
  const lines = [`${hits.length} topic${hits.length === 1 ? '' : 's'} hold "${query}":`];
  for (const hit of hits) {
    lines.push('', `  driftbench help ${hit.topic.id}  ${hit.topic.summary}`);
    lines.push(`    ${hit.count} line${hit.count === 1 ? '' : 's'}; first: ${hit.first.slice(0, 160)}`);
  }
  return `${lines.join('\n')}\n`;
}

/** One command for `driftbench help --list`: its path and its one-line description. */
export type CommandLine = { path: string; description: string };

/**
 * Every command with its description and the first topic that covers it, grouped under its top-level
 * command, in the order given.
 */
export function formatCommandList(commands: readonly CommandLine[], topics: readonly HelpTopic[]): string {
  const width = Math.max(...commands.map((command) => command.path.length)) + 'driftbench '.length;
  const lines = [
    'Every driftbench command, with one line each and the help topic about it.',
    'Options of one command: driftbench <command> --help. The topics: driftbench help.',
  ];
  let group: string | undefined;
  for (const command of commands) {
    const top = command.path.split(' ', 1)[0];
    if (top !== group) {
      lines.push('');
      group = top;
    }
    const topic = topicsForCommand(topics, command.path)[0];
    const about = topic === undefined ? '' : `  (driftbench help ${topic.id})`;
    const description = command.description.split('\n')[0]?.trim() ?? '';
    lines.push(`${`driftbench ${command.path}`.padEnd(width)}  ${description}${about}`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The topic a name asks for: the exact id, else the one topic whose slug is the name (`exit-codes` for
 * `core-exit-codes`). Undefined when none or several match.
 */
export function findHelpTopic(topics: readonly HelpTopic[], name: string): HelpTopic | undefined {
  const exact = topics.find((topic) => topic.id === name);
  if (exact !== undefined) return exact;
  const bySlug = topics.filter((topic) => topic.id.slice(topic.area.length + 1) === name);
  return bySlug.length === 1 ? bySlug[0] : undefined;
}

/**
 * The topics about a command path, such as `campaign run`: those that list it, then those that list a
 * command under it or above it.
 */
export function topicsForCommand(topics: readonly HelpTopic[], path: string): HelpTopic[] {
  const exact = topics.filter((topic) => topic.commands.includes(path));
  const near = topics.filter(
    (topic) =>
      !exact.includes(topic) &&
      topic.commands.some((command) => command.startsWith(`${path} `) || path.startsWith(`${command} `)),
  );
  return [...exact, ...near];
}

/** The lines `driftbench <command> --help` ends with: the topics about the command, and the index. */
export function commandHelpFooter(topics: readonly HelpTopic[], path: string): string {
  const about = topicsForCommand(topics, path);
  const lines = [''];
  if (about.length > 0) {
    const width = Math.max(...about.map((topic) => topic.id.length));
    lines.push('Help topics:');
    for (const topic of about) lines.push(`  driftbench help ${topic.id.padEnd(width)}  ${topic.summary}`);
  }
  lines.push('Every topic: driftbench help');
  return lines.join('\n');
}

/**
 * Runs `driftbench help`, `driftbench help <topic>` and `driftbench help search <words>`. Returns the exit
 * code, or undefined when the arguments ask for something else: `help <command>` stays commander's usage of
 * that command, and `help --list` needs the commands (see `main`).
 */
export function runHelpTopics(
  argv: readonly string[],
  io: Io,
  commandNames: ReadonlySet<string>,
  dir: string = helpDir(),
): number | undefined {
  if (argv[0] !== 'help') return undefined;
  if (argv[1] === 'search') {
    const query = argv.slice(2).join(' ').trim();
    if (query === '') {
      io.err('driftbench: help search takes a word, such as: driftbench help search store\n');
      return 2;
    }
    io.out(formatSearch(query, searchHelpTopics(loadHelpTopics(dir), query)));
    return 0;
  }
  if (argv.length > 2) return undefined;
  const name = argv[1];
  if (name?.startsWith('-')) return undefined;
  const topics = loadHelpTopics(dir);
  // An area wins over a command of the same name (`help redteam`); the command's usage stays one flag away.
  const area = name === undefined ? [] : topics.filter((each) => each.area === name);
  if (name !== undefined && area.length === 0 && commandNames.has(name)) return undefined;
  if (name === undefined) {
    io.out(formatHelpIndex(topics, loadOverview(dir)));
    return 0;
  }
  const topic = findHelpTopic(topics, name);
  if (topic !== undefined) {
    io.out(formatHelpTopic(topic, nextTopics(topics, topic)));
    return 0;
  }
  if (area.length > 0) {
    const usage = commandNames.has(name)
      ? `\nThe usage of the command ${name}: driftbench ${name} --help\n`
      : '';
    io.out(`${formatHelpIndex(area).replace('Help topics', `Help topics of the area ${name}`)}${usage}`);
    return 0;
  }
  const near = topics.filter((each) => each.id.includes(name)).map((each) => each.id);
  const hint = near.length > 0 ? ` Close: ${near.join(', ')}.` : '';
  io.err(
    `driftbench: no help topic or command named "${name}".${hint} List the topics: driftbench help. Search them: driftbench help search ${name}\n`,
  );
  return 2;
}

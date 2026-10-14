import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import type { Io } from './io';

/**
 * The help topics of `driftbench help`: one markdown file per topic in the package's `help` folder, named
 * `<area>-<slug>.md`, with front matter (title, summary, commands, see_also) and seven sections. The folder's
 * README.md is the contract every topic follows. Files are read when help runs, so a topic added later shows
 * up with no code change.
 */

/** The areas, in the order the index lists them. */
export const HELP_AREAS = [
  'core',
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

/** One topic from its id and its text. A broken front matter is reported in `problem`, never thrown. */
export function parseTopic(id: string, text: string): HelpTopic {
  const area = id.split('-', 1)[0] as string;
  const topic: HelpTopic = { id, area, title: id, summary: '', commands: [], see_also: [], body: text };
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
  const list = (key: 'commands' | 'see_also') => {
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
  const unknown = Object.keys(fields).filter(
    (key) => !['title', 'summary', 'commands', 'see_also'].includes(key),
  );
  if (unknown.length > 0) problems.push(`unknown keys: ${unknown.join(', ')}`);
  return problems.length > 0 ? { ...topic, problem: problems.join('; ') } : topic;
}

/** The index: every topic grouped by area, with its summary, and how to print one. */
export function formatHelpIndex(topics: readonly HelpTopic[]): string {
  const lines = [
    'driftbench help topics',
    '',
    'Print a topic: driftbench help <topic>. List the commands: driftbench --help.',
    'Usage of one command: driftbench <command> --help, which also names its topics.',
  ];
  if (topics.length === 0) {
    lines.push('', 'No topic is installed: the help folder of this package is missing.');
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

/** One topic as the reader sees it: title, summary, the commands it covers, its sections, see also. */
export function formatHelpTopic(topic: HelpTopic): string {
  const head = [topic.title, topic.summary];
  if (topic.problem !== undefined) head.push(`(broken topic: ${topic.problem})`);
  if (topic.commands.length > 0) {
    head.push('', `Commands: ${topic.commands.map((command) => `driftbench ${command}`).join(', ')}`);
  }
  const tail =
    topic.see_also.length > 0
      ? `\n\nSee also: ${topic.see_also.map((id) => `driftbench help ${id}`).join(', ')}`
      : '';
  return `${head.join('\n')}\n\n${topic.body.trim()}${tail}\n`;
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
 * Runs `driftbench help` and `driftbench help <topic>`. Returns the exit code, or undefined when the
 * arguments ask for something else (`help <command>` stays commander's usage of that command).
 */
export function runHelpTopics(
  argv: readonly string[],
  io: Io,
  commandNames: ReadonlySet<string>,
  dir: string = helpDir(),
): number | undefined {
  if (argv[0] !== 'help' || argv.length > 2) return undefined;
  const name = argv[1];
  if (name !== undefined && (commandNames.has(name) || name.startsWith('-'))) return undefined;
  const topics = loadHelpTopics(dir);
  if (name === undefined) {
    io.out(formatHelpIndex(topics));
    return 0;
  }
  const topic = findHelpTopic(topics, name);
  if (topic !== undefined) {
    io.out(formatHelpTopic(topic));
    return 0;
  }
  const near = topics.filter((each) => each.id.includes(name)).map((each) => each.id);
  const hint = near.length > 0 ? ` Close: ${near.join(', ')}.` : '';
  io.err(`driftbench: no help topic or command named "${name}".${hint} List the topics: driftbench help\n`);
  return 2;
}

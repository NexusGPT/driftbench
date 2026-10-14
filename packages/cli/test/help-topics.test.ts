import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { COMMAND_MODULES } from '../src/command-index';
import {
  formatHelpIndex,
  HELP_AREAS,
  HELP_SECTIONS,
  helpDir,
  loadHelpTopics,
  parseTopic,
  runHelpTopics,
  TOPIC_FILE,
  topicsForCommand,
} from '../src/help-topics';
import type { Io } from '../src/io';
import { fullProgram, main } from '../src/main';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const DIR = helpDir();
const TOPICS = loadHelpTopics(DIR);

/**
 * Switch to true once every help lane has landed: then each uncovered command fails instead of standing as
 * a todo item.
 */
const REQUIRE_EVERY_COMMAND = false;

function capture(cwd = ROOT): Io & { stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out: (text) => out.push(text),
    err: (text) => err.push(text),
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

/** Every command path of the CLI a topic must cover: each leaf, and each group that also runs on its own. */
async function commandPaths(): Promise<string[]> {
  const io = capture();
  const program = fullProgram(
    await Promise.all(COMMAND_MODULES.map((module) => module.load())),
    io,
    () => {},
  );
  const paths: string[] = ['help'];
  const walk = (command: Command, path: string[]) => {
    for (const sub of command.commands) {
      const own = [...path, sub.name()];
      const runs = (sub as unknown as { _actionHandler: unknown })._actionHandler != null;
      if (sub.commands.length === 0 || runs) paths.push(own.join(' '));
      walk(sub, own);
    }
  };
  walk(program, []);
  return paths;
}

const COMMANDS = await commandPaths();
const COVERED = new Set(TOPICS.flatMap((topic) => topic.commands));

describe('the help loader', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'driftbench-help-'));
  afterAll(() => rmSync(scratch, { recursive: true, force: true }));

  it('lists a topic added later, grouped under its area, and ignores files that are not topics', () => {
    writeFileSync(join(scratch, 'README.md'), '# not a topic\n');
    writeFileSync(join(scratch, 'notes.txt'), 'not a topic\n');
    writeFileSync(
      join(scratch, 'running-later.md'),
      '---\ntitle: Later\nsummary: Added after the index was written.\ncommands: [smoke]\nsee_also: []\n---\n## What it is\n',
    );
    writeFileSync(
      join(scratch, 'core-first.md'),
      '---\ntitle: First\nsummary: The first.\ncommands: []\nsee_also: []\n---\n',
    );
    const topics = loadHelpTopics(scratch);
    expect(topics.map((topic) => topic.id)).toEqual(['core-first', 'running-later']);
    const index = formatHelpIndex(topics);
    expect(index).toContain('\ncore\n  core-first     The first.\n');
    expect(index).toContain('\nrunning\n  running-later  Added after the index was written.\n');
    expect(topicsForCommand(topics, 'smoke').map((topic) => topic.id)).toEqual(['running-later']);
  });

  it('lists and prints a broken topic with its problem, never throws', () => {
    expect(parseTopic('core-x', 'no front matter').problem).toBe('no front matter');
    expect(parseTopic('core-x', '---\ntitle: [\n---\n').problem).toMatch(/not YAML/);
    expect(parseTopic('core-x', '---\ntitle: X\nsummary: S\ncommands: run\n---\n').problem).toBe(
      'commands must be a list of text',
    );
    expect(parseTopic('core-x', '---\ntitle: X\nsummary: S\nowner: me\n---\n').problem).toBe(
      'unknown keys: owner',
    );
    expect(formatHelpIndex([parseTopic('core-x', 'no front matter')])).toContain(
      'core-x  (broken topic: no front matter)',
    );
  });

  it('gives no topic for a missing folder, and the index says so', () => {
    expect(loadHelpTopics(join(scratch, 'missing'))).toEqual([]);
    const io = capture();
    expect(runHelpTopics(['help'], io, new Set(), join(scratch, 'missing'))).toBe(0);
    expect(io.stdout()).toContain('No topic is installed');
  });

  it('leaves help <command> and help with options to the command usage', () => {
    const io = capture();
    expect(runHelpTopics(['help', 'campaign'], io, new Set(['campaign']), DIR)).toBeUndefined();
    expect(runHelpTopics(['help', '--help'], io, new Set(), DIR)).toBeUndefined();
    expect(runHelpTopics(['help', 'a', 'b'], io, new Set(), DIR)).toBeUndefined();
    expect(runHelpTopics(['spec'], io, new Set(), DIR)).toBeUndefined();
  });
});

describe('the help topics follow the contract of help/README.md', () => {
  it('holds topics, each named <area>-<slug>.md with a known area', () => {
    const files = readdirSync(DIR).filter((name) => name.endsWith('.md') && name !== 'README.md');
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      expect(name, name).toMatch(TOPIC_FILE);
      expect(HELP_AREAS as readonly string[], name).toContain(name.split('-', 1)[0]);
    }
  });

  for (const topic of TOPICS) {
    describe(topic.id, () => {
      it('has a valid front matter whose commands and see_also exist', () => {
        expect(topic.problem, topic.problem).toBeUndefined();
        for (const command of topic.commands) expect(COMMANDS, `${topic.id}: ${command}`).toContain(command);
        const ids = TOPICS.map((each) => each.id);
        for (const id of topic.see_also) expect(ids, `${topic.id}: see_also ${id}`).toContain(id);
      });

      it('has the seven sections in order and no top-level heading', () => {
        const prose = topic.body.replace(/^```[\s\S]*?^```/gm, '');
        const headings = [...prose.matchAll(/^(#{1,2}) (.+)$/gm)].map((match) => `${match[1]} ${match[2]}`);
        expect(headings).toEqual(HELP_SECTIONS.map((section) => `## ${section}`));
      });

      it('has no em or en dash', () => {
        const text = readFileSync(join(DIR, `${topic.id}.md`), 'utf8');
        expect(text).not.toMatch(/[–—]/);
      });

      it('prints with `driftbench help <topic>`', async () => {
        const io = capture();
        expect(await main(['help', topic.id], io), io.stderr()).toBe(0);
        expect(io.stdout().startsWith(`${topic.title}\n${topic.summary}\n`)).toBe(true);
        for (const section of HELP_SECTIONS) expect(io.stdout()).toContain(`## ${section}`);
      });
    });
  }
});

describe('driftbench help', () => {
  it('prints an index of every topic, grouped by area', async () => {
    const io = capture();
    expect(await main(['help'], io)).toBe(0);
    const text = io.stdout();
    for (const topic of TOPICS) expect(text).toContain(`  ${topic.id}`);
    const order = [...new Set(TOPICS.map((topic) => topic.area))].map((area) => text.indexOf(`\n${area}\n`));
    expect(order.every((at) => at > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('prints a topic by its slug alone, and refuses an unknown name with exit 2', async () => {
    const io = capture();
    expect(await main(['help', 'exit-codes'], io)).toBe(0);
    expect(io.stdout()).toContain('Exit codes\n');
    const bad = capture();
    expect(await main(['help', 'no-such-topic'], bad)).toBe(2);
    expect(bad.stderr()).toContain('no help topic or command named "no-such-topic"');
  });

  it('still prints the usage of a command for help <command>', async () => {
    const io = capture();
    expect(await main(['help', 'smoke'], io)).toBe(0);
    expect(io.stdout()).toContain('Usage: driftbench smoke');
  });

  it('points from the program usage to the topics', async () => {
    const io = capture();
    expect(await main(['--help'], io)).toBe(0);
    expect(io.stdout()).toContain('Help topics, each capability and how to use it: driftbench help');
  });

  it('points from every covered command usage to its topics', async () => {
    for (const path of COMMANDS.filter((command) => command !== 'help' && COVERED.has(command))) {
      const io = capture();
      expect(await main([...path.split(' '), '--help'], io), path).toBe(0);
      for (const topic of TOPICS.filter((each) => each.commands.includes(path))) {
        expect(io.stdout(), path).toContain(`driftbench help ${topic.id}`);
      }
      expect(io.stdout(), path).toContain('Every topic: driftbench help');
    }
  }, 300_000);
});

describe('every command is covered by a help topic', () => {
  for (const path of COMMANDS) {
    if (COVERED.has(path) || REQUIRE_EVERY_COMMAND) {
      it(path, () => expect(COVERED.has(path), `no topic lists "${path}" in its commands`).toBe(true));
    } else {
      it.todo(path);
    }
  }
});

/** The commands of a topic's worked example, each with the exit code it must end with. */
function workedExample(body: string): { argv: string[]; exit: number; line: string }[] {
  const start = body.indexOf('## Worked example');
  const end = body.indexOf('\n## ', start + 1);
  const section = body.slice(start, end === -1 ? undefined : end);
  const commands: { argv: string[]; exit: number; line: string }[] = [];
  for (const block of section.matchAll(/^```sh\n([\s\S]*?)^```/gm)) {
    const lines = (block[1] as string).replace(/\\\n\s*/g, ' ').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('driftbench ')) continue;
      const exit = /#\s*exit\s+(\d+)\s*$/.exec(line);
      const command = exit === null ? line : line.slice(0, exit.index).trim();
      commands.push({ argv: words(command).slice(1), exit: exit === null ? 0 : Number(exit[1]), line });
    }
  }
  return commands;
}

/** Shell words: split on spaces, with single and double quotes kept together. */
function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

describe('every worked example runs', () => {
  for (const topic of TOPICS) {
    const commands = workedExample(topic.body);
    it(`${topic.id}: ${commands.length} commands`, async () => {
      expect(commands.length, 'the worked example runs at least one driftbench command').toBeGreaterThan(0);
      const scratch = mkdtempSync(join(tmpdir(), `driftbench-help-${topic.id}-`));
      try {
        symlinkSync(join(ROOT, 'examples'), join(scratch, 'examples'));
        symlinkSync(join(ROOT, 'packages'), join(scratch, 'packages'));
        for (const command of commands) {
          const io = capture(scratch);
          const code = await main(command.argv, io);
          expect(code, `${command.line}\n${io.stderr()}`).toBe(command.exit);
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }, 600_000);
  }
});

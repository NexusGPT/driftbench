import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Command } from 'commander';
import { afterAll, describe, expect, it } from 'vitest';
import { COMMAND_MODULES } from '../src/command-index';
import {
  formatHelpIndex,
  HELP_AREAS,
  helpDir,
  loadHelpTopics,
  loadOverview,
  nextTopics,
  parseTopic,
  runHelpTopics,
  runnableSection,
  searchHelpTopics,
  sectionsFor,
  stem,
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

  it('lets an area win over a command of the same name, and names the command usage', () => {
    writeFileSync(
      join(scratch, 'redteam-attack-packs.md'),
      '---\ntitle: Packs\nsummary: The red team packs.\ncommands: []\nsee_also: []\n---\n',
    );
    const io = capture();
    expect(runHelpTopics(['help', 'redteam'], io, new Set(['redteam']), scratch)).toBe(0);
    expect(io.stdout()).toContain('Help topics of the area redteam');
    expect(io.stdout()).toContain('  redteam-attack-packs  The red team packs.');
    expect(io.stdout()).toContain('The usage of the command redteam: driftbench redteam --help');
  });

  it('searches whole words and their stems, never parts of other words', () => {
    const topic = (id: string, body: string) =>
      parseTopic(id, `---\ntitle: ${id}\nsummary: s\ncommands: []\nsee_also: []\n---\n${body}\n`);
    const topics = [
      topic('core-a', 'The decoder reads frames.'),
      topic('core-b', 'Codes and coding: run the code.'),
      topic('core-c', 'An --exit-code flag.'),
    ];
    expect(searchHelpTopics(topics, 'code').map((hit) => hit.topic.id)).toEqual(['core-b', 'core-c']);
    expect(searchHelpTopics(topics, 'decode').map((hit) => hit.topic.id)).toEqual([]);
    expect(searchHelpTopics(topics, 'exit code').map((hit) => hit.topic.id)).toEqual(['core-c']);
    const ranked = [
      topic(
        'validate-x',
        'exit 1 means a check failed. Exit 64: a bad input. exit codes per level. exit code here.',
      ),
      parseTopic(
        'core-exit',
        '---\ntitle: Exit codes\nsummary: What each exit code means.\ncommands: []\nsee_also: []\n---\nbody\n',
      ),
    ];
    expect(searchHelpTopics(ranked, 'exit code')[0]?.topic.id).toBe('core-exit');
    expect(stem('codes')).toBe(stem('code'));
    expect(stem('decoder')).not.toBe(stem('code'));
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
    const files = readdirSync(DIR).filter(
      (name) => name.endsWith('.md') && !['README.md', 'OVERVIEW.md'].includes(name),
    );
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
        for (const id of topic.next) expect(ids, `${topic.id}: next ${id}`).toContain(id);
      });

      it('has the sections of its area in order and no top-level heading', () => {
        const prose = topic.body.replace(/^```[\s\S]*?^```/gm, '');
        const headings = [...prose.matchAll(/^(#{1,2}) (.+)$/gm)].map((match) => `${match[1]} ${match[2]}`);
        expect(headings).toEqual(sectionsFor(topic.area).map((section) => `## ${section}`));
      });

      it('has no em or en dash', () => {
        const text = readFileSync(join(DIR, `${topic.id}.md`), 'utf8');
        expect(text).not.toMatch(/[–—]/);
      });

      it('prints with `driftbench help <topic>`', async () => {
        const io = capture();
        expect(await main(['help', topic.id], io), io.stderr()).toBe(0);
        expect(io.stdout().startsWith(`${topic.title}\n${topic.summary}\n`)).toBe(true);
        for (const section of sectionsFor(topic.area)) expect(io.stdout()).toContain(`## ${section}`);
        const next = nextTopics(TOPICS, topic);
        const last = io.stdout().trimEnd().split('\n').at(-1) ?? '';
        expect(last).toMatch(/^Next: /);
        for (const id of next) expect(last).toContain(`driftbench help ${id}`);
      });
    });
  }
});

describe('driftbench help', () => {
  it('opens with the overview, which names every top-level command', async () => {
    const overview = loadOverview(DIR);
    expect(overview).toBeDefined();
    for (const name of new Set(COMMAND_MODULES.flatMap((module) => module.names))) {
      expect(overview, `OVERVIEW.md names driftbench ${name}`).toMatch(new RegExp(`driftbench ${name} `));
    }
    const io = capture();
    expect(await main(['help'], io)).toBe(0);
    expect(io.stdout().startsWith(overview as string)).toBe(true);
  });

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

  it('lists one area with help <area>', async () => {
    const io = capture();
    expect(await main(['help', 'core'], io)).toBe(0);
    for (const topic of TOPICS) {
      if (topic.area === 'core') expect(io.stdout()).toContain(`  ${topic.id}`);
      else expect(io.stdout()).not.toContain(`  ${topic.id} `);
    }
  });

  it('searches the topics with help search <words>, ranked, and says when nothing holds them', async () => {
    const hits = searchHelpTopics(TOPICS, 'exit code');
    expect(hits[0]?.topic.id).toBe('core-exit-codes');
    expect(hits.every((hit) => hit.count > 0)).toBe(true);
    const io = capture();
    expect(await main(['help', 'search', 'ANTHROPIC_API_KEY'], io)).toBe(0);
    expect(io.stdout()).toContain('driftbench help core-configuration');
    const none = capture();
    expect(await main(['help', 'search', 'zzqx-nothing'], none)).toBe(0);
    expect(none.stdout()).toContain('No help topic holds "zzqx-nothing"');
    const empty = capture();
    expect(await main(['help', 'search'], empty)).toBe(2);
  });

  it('prints every command with one line and its topic with help --list', async () => {
    const io = capture();
    expect(await main(['help', '--list'], io)).toBe(0);
    const lines = io.stdout().split('\n');
    for (const path of COMMANDS.filter((command) => command !== 'help')) {
      const line = lines.find(
        (each) => each.startsWith(`driftbench ${path}  `) || each.startsWith(`driftbench ${path} `),
      );
      expect(line, path).toBeDefined();
      const topic = topicsForCommand(TOPICS, path)[0];
      if (topic !== undefined) expect(line, path).toContain(`(driftbench help ${topic.id})`);
    }
  }, 120_000);

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

/**
 * One step of a worked example, in document order: a driftbench command run through `main`, a shell line of
 * a `sh setup` block run with bash, or a file a block with `file=<path>` in its info string writes.
 */
type Step =
  | { kind: 'cli'; argv: string[]; exit: number; line: string }
  | { kind: 'shell'; command: string; exit: number; line: string }
  | { kind: 'file'; path: string; content: string; line: string };

/** The steps of a topic's runnable section: its worked example, or a recipe's steps. */
function workedExample(body: string, section = 'Worked example'): Step[] {
  const start = body.indexOf(`## ${section}`);
  const end = body.indexOf('\n## ', start + 1);
  const text = body.slice(start, end === -1 ? undefined : end);
  const steps: Step[] = [];
  for (const block of text.matchAll(/^```([^\n]*)\n([\s\S]*?)^```/gm)) {
    const info = (block[1] as string).trim().split(/\s+/);
    const body = block[2] as string;
    const file = info.find((word) => word.startsWith('file='));
    if (file !== undefined) {
      const path = file.slice('file='.length);
      steps.push({ kind: 'file', path, content: body, line: `\`\`\`${block[1]}` });
      continue;
    }
    if (info[0] !== 'sh') continue;
    const setup = info.includes('setup');
    for (const raw of body.replace(/\\\n\s*/g, ' ').split('\n')) {
      const line = raw.trim();
      if (line === '' || line.startsWith('#')) continue;
      const exit = /#\s*exit\s+(\d+)\s*$/.exec(line);
      const command = exit === null ? line : line.slice(0, exit.index).trim();
      const code = exit === null ? 0 : Number(exit[1]);
      if (command.startsWith('driftbench ')) {
        steps.push({ kind: 'cli', argv: words(command).slice(1), exit: code, line });
      } else if (setup) {
        steps.push({ kind: 'shell', command, exit: code, line });
      }
    }
  }
  return steps;
}

/**
 * Why a `sh setup` line could reach outside the scratch folder, or undefined when it cannot by its text: an
 * absolute path, a home path, a parent folder, a new symbolic link. The run also sets HOME to the scratch
 * folder, and the test checks afterwards that git sees no change under examples/ and packages/.
 */
function shellLineProblem(command: string): string | undefined {
  if (/(^|[\s'"=<>|;&(:])\//.test(command)) return 'an absolute path';
  if (/(^|[\s'"=<>|;&(:])~/.test(command)) return 'a home path';
  if (/(^|[\s'"=<>|;&(:/])\.\.(\/|[\s'";|&)]|$)/.test(command)) return 'a parent folder (..)';
  if (/(^|[\s;|&(])ln(\s|$)/.test(command)) return 'a new symbolic link (ln)';
  return undefined;
}

/** What git sees changed or added under examples/ and packages/ of the repository, as one text. */
function repositoryState(): string {
  const run = spawnSync(
    'git',
    ['status', '--porcelain', '--untracked-files=all', '--', 'examples', 'packages'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  );
  if (run.status !== 0) throw new Error(`git status failed: ${run.stderr}`);
  return run.stdout;
}

/** Where a worked example may write: a new relative path, never into the linked repository folders. */
function scratchPath(scratch: string, path: string): string {
  const parts = path.split('/');
  if (isAbsolute(path) || parts.includes('..') || ['examples', 'packages'].includes(parts[0] as string)) {
    throw new Error(`a worked example writes only to new relative paths, not ${path}`);
  }
  return join(scratch, path);
}

/** Shell words: split on spaces, with single and double quotes kept together. */
function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map(
    (match) => match[1] ?? match[2] ?? match[3] ?? '',
  );
}

describe('every worked example runs', () => {
  for (const topic of TOPICS) {
    const steps = workedExample(topic.body, runnableSection(topic.area));
    const commands = steps.filter((step) => step.kind === 'cli').length;
    it(`${topic.id}: ${commands} commands`, async () => {
      expect(commands, 'the worked example runs at least one driftbench command').toBeGreaterThan(0);
      const scratch = mkdtempSync(join(tmpdir(), `driftbench-help-${topic.id}-`));
      try {
        symlinkSync(join(ROOT, 'examples'), join(scratch, 'examples'));
        symlinkSync(join(ROOT, 'packages'), join(scratch, 'packages'));
        // A setup line runs in a shell, which could write through the links: the repository must not change.
        const shell = steps.some((step) => step.kind === 'shell');
        const before = shell ? repositoryState() : '';
        for (const step of steps) {
          if (step.kind === 'file') {
            const path = scratchPath(scratch, step.path);
            mkdirSync(dirname(path), { recursive: true });
            writeFileSync(path, step.content);
          } else if (step.kind === 'shell') {
            expect(shellLineProblem(step.command), `${step.line}: a sh setup line names`).toBeUndefined();
            const run = spawnSync('bash', ['-c', step.command], {
              cwd: scratch,
              encoding: 'utf8',
              env: { ...process.env, HOME: scratch },
            });
            expect(run.status, `${step.line}\n${run.stdout}${run.stderr}`).toBe(step.exit);
          } else {
            const io = capture(scratch);
            const code = await main(step.argv, io);
            expect(code, `${step.line}\n${io.stderr()}`).toBe(step.exit);
          }
        }
        if (shell) {
          expect(
            repositoryState(),
            'a sh setup line wrote into examples/ or packages/ of the repository',
          ).toBe(before);
        }
      } finally {
        rmSync(scratch, { recursive: true, force: true });
      }
    }, 600_000);
  }

  it('reads setup blocks and file blocks in order, and refuses a file outside the scratch folder', () => {
    const body = [
      '## Worked example',
      '```yaml file=cfg/a.yaml',
      'campaign: {}',
      '```',
      '```sh setup',
      'cp cfg/a.yaml b.yaml',
      'false # exit 1',
      '```',
      '```sh',
      'driftbench spec validate b.yaml # exit 1',
      'echo not run',
      '```',
    ].join('\n');
    expect(workedExample(body).map((step) => step.kind)).toEqual(['file', 'shell', 'shell', 'cli']);
    expect(() => scratchPath('/tmp/s', 'examples/x.yaml')).toThrow();
    for (const [line, problem] of [
      ['cd .. && touch x', 'a parent folder (..)'],
      ['cp a ../b', 'a parent folder (..)'],
      ['touch /tmp/x', 'an absolute path'],
      ['echo x > /etc/y', 'an absolute path'],
      ['cp a $HOME/b', undefined],
      ['touch ~/x', 'a home path'],
      ['ln -s examples e2', 'a new symbolic link (ln)'],
      ['cp -R examples/estates/fixture-v2/tests tests', undefined],
      ['mkdir validators', undefined],
      ["node -e \"require('fs').writeFileSync('a.json', '{}')\"", undefined],
    ] as const) {
      expect(shellLineProblem(line), line).toBe(problem);
    }
    const planted = join(ROOT, 'examples', `.help-confinement-probe-${process.pid}`);
    const before = repositoryState();
    try {
      writeFileSync(planted, 'x');
      expect(repositoryState()).not.toBe(before);
    } finally {
      rmSync(planted, { force: true });
    }
    expect(repositoryState()).toBe(before);
    expect(() => scratchPath('/tmp/s', '../x.yaml')).toThrow();
    expect(scratchPath('/tmp/s', 'out/x.yaml')).toBe('/tmp/s/out/x.yaml');
  });
});

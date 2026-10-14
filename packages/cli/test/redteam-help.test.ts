import { execFile } from 'node:child_process';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { loadRedteamPlugins } from '@agent-nexus/driftbench-users';
import type { Command } from 'commander';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import type { Io } from '../src/io';
import { createProgram, main } from '../src/main';
import { pluginTopic } from './support/redteam-help';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HELP = join(ROOT, 'packages/cli/help');
const SECTIONS = [
  'What it is',
  'When to use it',
  'Commands and every option',
  'Inputs',
  'Outputs and how to read them',
  'Worked example',
  'Common errors',
];
let dir: string;
let topics: { id: string; text: string; body: string; commands: string[]; seeAlso: string[] }[];

beforeAll(async () => {
  dir = await mkdtemp(join(ROOT, '.redteam-help-'));
  topics = await Promise.all(
    (await readdir(HELP))
      .filter((name) => /^redteam-.*\.md$/.test(name))
      .sort()
      .map(async (name) => {
        const text = await readFile(join(HELP, name), 'utf8');
        const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
        if (!match) throw new Error(`No front matter: ${name}`);
        const meta = parse(match[1] as string);
        return {
          id: name.slice(0, -3),
          text,
          body: match[2] as string,
          commands: meta.commands,
          seeAlso: meta.see_also,
        };
      }),
  );
}, 120_000);
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function scratch(prefix: string) {
  const cwd = await mkdtemp(join(dir, prefix));
  await symlink(join(ROOT, 'examples'), join(cwd, 'examples'), 'dir');
  await symlink(join(ROOT, 'packages'), join(cwd, 'packages'), 'dir');
  return cwd;
}
async function invoke(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const code = await main(
    argv,
    {
      cwd,
      out: (text) => {
        out += text;
      },
      err: (text) => {
        err += text;
      },
    },
    {
      deps: {
        modelPort: () => {
          throw new Error('Worked example must not call a model');
        },
      },
    },
  );
  return { code, out, err };
}
function worked(text: string) {
  return text.split('## Worked example\n')[1]?.split('## Common errors\n')[0] ?? '';
}
function fences(text: string, language: string) {
  return [...text.matchAll(new RegExp('```' + language + '\\n([\\s\\S]*?)\\n```', 'g'))].map(
    (m) => m[1] as string,
  );
}
function commandAt(program: Command, path: string) {
  let found: Command | undefined = program;
  for (const name of path.split(' ')) found = found?.commands.find((c) => c.name() === name);
  if (!found) throw new Error(`Documented command disappeared: ${path}`);
  return found;
}

describe('red-team help is an executable contract', { timeout: 240_000 }, () => {
  it('has all fixed sections, local cross-links and every plugin topic from the live catalogue', async () => {
    expect(topics.length).toBe(46);
    const ids = new Set((await readdir(HELP)).filter((p) => p.endsWith('.md')).map((p) => p.slice(0, -3)));
    for (const topic of topics) {
      expect(
        [...topic.body.matchAll(/^## (.+)$/gm)].map((m) => m[1]),
        topic.id,
      ).toEqual(SECTIONS);
      expect(topic.text, topic.id).not.toMatch(/[\u2013\u2014]/);
      expect(fences(worked(topic.body), 'sh').length, topic.id).toBeGreaterThan(0);
      for (const linked of topic.seeAlso) expect(ids.has(linked), `${topic.id} -> ${linked}`).toBe(true);
    }
    const index = topics.find((t) => t.id === 'redteam-plugins')?.text ?? '';
    for (const plugin of loadRedteamPlugins())
      expect(index, `redteam-plugins lists ${plugin.id}`).toContain(
        `- ${plugin.id}: ${plugin.title} (${plugin.family})`,
      );
    for (const plugin of loadRedteamPlugins()) {
      expect(topics.find((t) => t.id === `redteam-plugin-${plugin.id}`)?.text).toBe(pluginTopic(plugin));
    }
  });

  it('pins all manual topic text and every documented option with its actual default', async () => {
    const io: Io = { cwd: ROOT, out: () => {}, err: () => {} };
    const programs = new Map<string, Command>();
    const contracts: Record<string, unknown> = {};
    for (const topic of topics) {
      if (!topic.id.startsWith('redteam-plugin-')) expect(topic.text).toMatchSnapshot(topic.id);
      for (const path of topic.commands) {
        const root = path.split(' ')[0] as string;
        if (!programs.has(root)) programs.set(root, await createProgram([root, '--help'], io, () => {}));
        const command = commandAt(programs.get(root) as Command, path);
        contracts[path] = command.options.map((o) => ({
          flags: o.flags,
          default: o.defaultValue,
          required: o.mandatory,
          description: o.description,
        }));
        const section = topic.body.split('## Commands and every option\n')[1]?.split('\n## Inputs')[0] ?? '';
        for (const option of command.options)
          expect(section, `${topic.id} must document ${option.long}`).toContain(option.long);
        // A removed option in the prose must fail even before a snapshot is updated.
        const actual = new Set([...command.options.map((o) => o.long), '--help', '--plugin']);
        const shared = topic.commands.flatMap((p) => {
          const c = commandAt(programs.get(root) as Command, p);
          return c.options.map((o) => o.long);
        });
        for (const flag of shared) actual.add(flag);
        for (const [, flag] of section.matchAll(/\| `(--[a-z][a-z-]*)/g))
          expect(actual.has(flag), `${topic.id} names removed option ${flag}`).toBe(true);
      }
    }
    expect(contracts).toMatchSnapshot('CLI options and defaults');
  });

  it('executes every documented CLI worked example in its own scratch folder', async () => {
    for (const topic of topics) {
      const cwd = await scratch(topic.id);
      for (const block of fences(worked(topic.body), 'sh')) {
        for (const line of block.replace(/\\\n\s*/g, ' ').split('\n')) {
          if (!line.startsWith('driftbench ')) continue;
          const expected = Number(/# exit (\d+)$/.exec(line)?.[1] ?? 0);
          const raw = line.replace(/\s+# exit \d+$/, '').slice('driftbench '.length);
          const args = (raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((word) =>
            /^["']/.test(word) ? word.slice(1, -1) : word,
          );
          const result = await invoke(args, cwd);
          expect(result.code, `${topic.id}: ${line}\n${result.err}\n${result.out}`).toBe(expected);
          if (args.includes('--json') && args[0] === 'redteam' && args[1] === 'run') {
            // The fixtures carry no score: replay must report inconclusive, never resisted.
            const doc = JSON.parse(result.out);
            expect(doc.recording.outcome).toBe('grading_error');
            expect(doc.run.endVerdict).toBe('inconclusive');
            expect(doc.passed).toBe(false);
          }
          if (args.includes('--json') && args[0] === 'attack')
            expect(JSON.parse(result.out).findings).toBe(0);
        }
      }
    }
  });

  it('executes every complete code example, including target calls, grading and cassette replay', async () => {
    const cwd = await scratch('code-');
    // Hoist the identical imports once, then run each published body in a fresh lexical scope.
    // This avoids starting 41 TypeScript loaders; every byte of each body still executes.
    const imports = new Set<string>();
    const bodies: string[] = [];
    for (const topic of topics)
      for (const code of fences(worked(topic.body), 'ts')) {
        const body = code.replace(/^import [\s\S]*? from '[^']+';$/gm, (line) => {
          imports.add(line);
          return '';
        });
        bodies.push(`{\n${body}\n}`);
      }
    expect(bodies).toHaveLength(41);
    const path = join(cwd, 'examples.ts');
    await writeFile(path, `${[...imports].join('\n')}\n${bodies.join('\n')}`);
    const result = await promisify(execFile)(process.execPath, ['--import', 'tsx', path], {
      cwd,
      timeout: 180_000,
      maxBuffer: 24 * 1024 * 1024,
      env: {
        ...process.env,
        TSX_TSCONFIG_PATH: join(ROOT, 'tsconfig.json'),
        ANTHROPIC_API_KEY: '',
        OPENAI_API_KEY: '',
      },
    });
    // Each example prints one pretty JSON object. Parse the concatenated documents.
    const docs = result.stdout
      .trim()
      .split(/\n(?=\{\n)/)
      .map((text) => JSON.parse(text));
    expect(docs).toHaveLength(41);
    for (const doc of docs) {
      for (const run of [doc.first, doc.replay]) {
        expect(run.status).toBe('completed');
        expect(run.blocks).toHaveLength(1);
        expect(run.blocks[0].observed.text).not.toBe('');
        expect(run.blocks[0].pass).toBe(false);
        expect(run.blocks[0].verdicts).toContainEqual(
          expect.objectContaining({ kind: 'judge', gating: true, outcome: 'inconclusive' }),
        );
      }
      expect(doc.replay.blocks[0].observed.text).toBe(doc.first.blocks[0].observed.text);
    }
  });
});

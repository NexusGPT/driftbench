import { execFile } from 'node:child_process';
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { main } from '../../packages/cli/src/index';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const FIXTURE = join(ROOT, 'examples/estates/fixture');
const RULE = 'instruction.weekly-report.count-only-what-the-ledger-and';
const LEDGER_ID = 'wrl4c7wlvb';
const run = promisify(execFile);

async function cli(argv: string[], cwd: string) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    cwd,
    out: (text) => {
      out += text;
    },
    err: (text) => {
      err += text;
    },
  });
  const lines = out.split('\n').map((line) => line.trimEnd());
  return { code, err, lines: lines.filter((line) => line !== '') };
}

async function files(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await files(path)));
    else found.push(path);
  }
  return found;
}

describe('docs/rule-links.md: the path from a rule to its tests', () => {
  it('prints what the page shows, from the scan to the radius of an edit', async () => {
    const page = await readFile(`${ROOT}/docs/rule-links.md`, 'utf8');
    const shown = (text: string) => expect(page, text).toContain(text);
    // The folder lives inside the repository, so the stamp script resolves the packages from it.
    const dir = await mkdtemp(join(ROOT, '.rule-links-'));
    try {
      await cp(FIXTURE, join(dir, 'northwind'), { recursive: true });
      await rm(join(dir, 'northwind/generated'), { recursive: true, force: true });

      const scan = await cli(
        [
          'estate',
          'scan',
          'northwind',
          '--out',
          'map.yaml',
          '--pointer',
          '--cassette',
          'northwind/cassette.jsonl',
          '--ledger',
          'ledger.json',
          '--update',
        ],
        dir,
      );
      expect(scan.err).toBe('');
      shown(
        scan.lines
          .filter((line) => line.startsWith('Wrote map.yaml') || /^ {2}(Units|Requests):/.test(line))
          .join('\n'),
      );
      const ledger = JSON.parse(await readFile(join(dir, 'ledger.json'), 'utf8')) as {
        entries: Array<Record<string, string>>;
      };
      const unit = ledger.entries.find((entry) => entry.id === LEDGER_ID);
      expect(unit, 'the ledger holds the unit').toBeDefined();
      const entry = Object.fromEntries(
        ['id', 'fp', 'path', 'status', 'quote'].map((key) => [key, unit?.[key]]),
      );
      shown(JSON.stringify(entry, null, 2));

      const steps = [
        ['estate', 'approve', 'map.yaml', '--all', '--to', 'approved.yaml'],
        ['estate', 'map', 'approved.yaml', '--to', 'space.yaml', '--agent', 'northwind'],
        ['estate', 'plan', 'approved.yaml', '--space', 'space.yaml', '--out', 'plan.yaml'],
        ['estate', 'plan', 'approve', 'plan.yaml', '--all'],
      ];
      for (const argv of steps) {
        const step = await cli(argv, dir);
        expect(step.code, `${argv.join(' ')}: ${step.err}`).toBe(0);
      }
      const generate = await cli(
        ['estate', 'generate', '--map', 'approved.yaml', '--plan', 'plan.yaml', '--out', 'generated'],
        dir,
      );
      expect(generate.err).toBe('');
      shown(
        generate.lines
          .filter((line) => line.startsWith('Asks of the complete specs') || line.startsWith('Wrote '))
          .join('\n'),
      );
      const spec = await readFile(
        join(dir, `generated/specs/live/obligation/estate.obligation.${RULE}.yaml`),
        'utf8',
      );
      const links = spec.slice(spec.indexOf('  links:\n'));
      shown(links.slice(0, links.indexOf('    - block: ask', 5)).trimEnd());

      const skill = join(dir, 'northwind/.claude/skills/weekly-report/SKILL.md');
      const text = await readFile(skill, 'utf8');
      expect(text).toContain('for the last seven days');
      await writeFile(skill, text.replace('for the last seven days', 'for the last fourteen days'));
      const change = await cli(
        ['radius', 'ledger', 'map.yaml', '--ledger', 'ledger.json', '--out', 'change.yaml'],
        dir,
      );
      expect(change.code, change.err).toBe(0);
      shown(change.lines.join('\n'));
      shown((await readFile(join(dir, 'change.yaml'), 'utf8')).trimEnd());

      const script = page.split('// file: fp.mts\n')[1]?.split('\n```')[0] ?? '';
      await writeFile(join(dir, 'fp.mts'), `// file: fp.mts\n${script}\n`);
      const fingerprints = await run(join(ROOT, 'node_modules/.bin/tsx'), ['fp.mts'], { cwd: dir });
      shown(fingerprints.stdout.trimEnd());

      const radius = await cli(['radius', 'generated/specs/live', '--change', 'change.yaml'], dir);
      expect(radius.code, radius.err).toBe(0);
      shown(radius.lines.slice(0, 4).join('\n'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 900_000);

  it('proves the links of a rule by deleting it, as the page shows', async () => {
    const page = await readFile(`${ROOT}/docs/rule-links.md`, 'utf8');
    const shown = (text: string) => expect(page, text).toContain(text);
    const dir = await mkdtemp(join(ROOT, '.rule-links-'));
    try {
      const atom = 'gate.invoice-reconcile.read-references-matching-rules-md-before';
      const specs = (await files(join(FIXTURE, 'generated/specs/live'))).filter((file) =>
        file.endsWith('.yaml'),
      );
      const named: string[] = [];
      for (const file of specs) {
        if ((await readFile(file, 'utf8')).includes(`\n      - ${atom}\n`)) named.push(file);
      }
      expect(named).toHaveLength(15);
      const fake = join(FIXTURE, 'live/fake');
      const common = [
        '--runtime',
        'claude-code',
        '--command',
        join(fake, 'claude.mjs'),
        '--set-env',
        `FAKE_MANIFEST=${join(fake, 'manifest.json')}`,
      ];
      const states = ['--states', join(FIXTURE, 'live/states/library.json')];

      const mutate = await cli(
        ['estate', 'mutate', join(FIXTURE, 'approved.yaml'), '--delete', atom, '--to', 'mutant'],
        dir,
      );
      expect(mutate.code, mutate.err).toBe(0);
      shown(mutate.lines.join('\n'));
      const original = await cli(
        [
          'estate',
          'run',
          ...named,
          '--estate',
          FIXTURE,
          ...common,
          '--store',
          'original.db',
          '--map',
          join(FIXTURE, 'approved.yaml'),
          ...states,
        ],
        dir,
      );
      expect(original.code, original.err).toBe(0);
      shown((original.lines.at(-1) ?? '').split(' Cost ')[0] ?? '');
      const mutated = await cli(
        ['estate', 'run', ...named, '--estate', 'mutant', ...common, '--store', 'mutant.db', ...states],
        dir,
      );
      shown((mutated.lines.at(-1) ?? '').split(' Cost ')[0] ?? '');
      const proof = await cli(
        [
          'estate',
          'prove',
          ...named,
          '--mutant',
          'mutant',
          '--original',
          'original.db',
          '--mutated',
          'mutant.db',
        ],
        dir,
      );
      console.log(`[PROOF] ${proof.code} ${proof.err}\n${proof.lines.join('\n')}`);
      expect(proof.code, proof.err).toBe(0);
      shown(proof.lines.join('\n'));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 900_000);
});

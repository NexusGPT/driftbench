import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { loadHelpTopics, parseTopic } from '../../packages/cli/src/help-topics';
import { coverageRows, registeredErrors, registeredProgram } from './help-coverage';

const topics = loadHelpTopics();
const program = await registeredProgram();
const errors = registeredErrors();

describe('registered CLI help coverage', () => {
  for (const kind of ['command', 'flag', 'error'] as const) {
    it(`gives every registered ${kind} a help section`, () => {
      const missing = coverageRows(program, topics, errors)
        .filter((row) => row.kind === kind && row.topics.length === 0)
        .map((row) => row.item);
      expect(missing, 'Add a topic section, or link the shared options topic in see_also.').toEqual([]);
    });
  }

  it('rejects an added command, an added flag, and an added error code', () => {
    const fixture = new Command('driftbench');
    fixture
      .command('acme')
      .option('--new-flag')
      .action(() => {});
    const rows = coverageRows(fixture, topics, [...errors, 'ACME_UNDOCUMENTED']);
    for (const item of ['acme', 'acme --new-flag', 'ACME_UNDOCUMENTED']) {
      expect(rows.find((row) => row.item === item)?.topics, item).toEqual([]);
    }
  });

  it('does not accept a flag mentioned only in an example or an unrelated topic', () => {
    const fixture = new Command('driftbench');
    fixture
      .command('acme')
      .option('--new-flag')
      .action(() => {});
    const topic = parseTopic(
      'core-acme',
      '---\ntitle: Acme\nsummary: Test\ncommands: [acme]\n---\n## Commands and every option\nUse Acme.\n## Worked example\n`--new-flag`\n',
    );
    expect(coverageRows(fixture, [topic], []).find((r) => r.kind === 'flag')?.topics).toEqual([]);
    topic.body = '## Commands and every option\n`--new-flag` selects the fictional input.\n';
    expect(coverageRows(fixture, [topic], []).find((r) => r.kind === 'flag')?.topics).toEqual(['core-acme']);
    topic.commands = ['another-command'];
    expect(coverageRows(fixture, [topic], []).find((r) => r.kind === 'flag')?.topics).toEqual([]);
  });

  it('finds a newly added error registry without a hand-maintained import list', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'astra-help-registry-'));
    try {
      mkdirSync(join(scratch, 'new-package', 'src'), { recursive: true });
      writeFileSync(
        join(scratch, 'new-package', 'src', 'errors.ts'),
        "export const ObjectIssueCodes = ['ACME_REGISTRY_UNKNOWN'] as const;\n",
      );
      expect(registeredErrors(scratch)).toEqual(['ACME_REGISTRY_UNKNOWN']);
      expect(
        coverageRows(new Command(), topics, registeredErrors(scratch)).find(
          (r) => r.item === 'ACME_REGISTRY_UNKNOWN',
        )?.topics,
      ).toEqual([]);
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

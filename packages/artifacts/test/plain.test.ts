import { codeReader, textReader } from '@agent-nexus/driftbench-artifacts';
import type { ArtifactDocument } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';
import { lineCount } from '../src/text';
import { bytesOf, runCases } from './fixtures';

const NOTES = 'Acme release notes\n\nVersion 2 adds the Summary sheet.\nNo price   changed.\n';

const CODE = [
  'def yearly(monthly):',
  '    return monthly * 12',
  '',
  '',
  'if __name__ == "__main__":',
  '    print(yearly(15))',
  '',
].join('\n');

const openText = async (): Promise<ArtifactDocument> => textReader.open(bytesOf(NOTES), 'out/notes.md');
const openCode = async (): Promise<ArtifactDocument> => codeReader.open(bytesOf(CODE), 'out/yearly.py');

runCases(textReader, openText, {
  contains: {
    pass: [
      {
        check: { contains: ['Summary sheet', 'No price changed.'] },
        evidence: 'found "Summary sheet", "No price changed."',
      },
    ],
    fail: [
      {
        check: { contains: ['Summary sheet', 'Version 3'] },
        evidence: 'missing "Version 3" (1 of 2 found); the text starts "Acme release notes',
      },
    ],
  },
  not_contains: {
    pass: [{ check: { not_contains: 'TODO' }, evidence: 'none of "TODO" found' }],
    fail: [
      {
        check: { not_contains: ['TODO', 'Version 2'] },
        evidence: 'found "Version 2" in "Acme release notes Version 2 adds',
      },
    ],
  },
  regex: {
    pass: [{ check: { regex: ['^Version \\d+ adds', 'changed\\.$'] } }],
    fail: [
      {
        check: { regex: ['^Version \\d+ adds', '^Version 3'] },
        evidence: 'no match for /^Version 3/ in 74 characters',
      },
    ],
  },
  lines: {
    pass: [{ check: { lines: 4 }, evidence: '4 lines' }, { check: { lines: { min: 1, max: 10 } } }],
    fail: [
      { check: { lines: 10 }, evidence: '4 lines, expected 10' },
      { check: { lines: { max: 3 } }, evidence: 'expected at most 3' },
    ],
  },
});

runCases(
  codeReader,
  openCode,
  {
    contains: {
      pass: [{ check: { contains: 'return monthly * 12' } }],
      fail: [{ check: { contains: 'return monthly * 10' } }],
    },
    not_contains: {
      pass: [{ check: { not_contains: 'eval(' } }],
      fail: [{ check: { not_contains: 'print(' }, evidence: 'found "print("' }],
    },
    regex: {
      pass: [{ check: { regex: '^def \\w+\\(monthly\\):$' }, evidence: 'matched "def yearly(monthly):"' }],
      fail: [{ check: { regex: '^class ' } }],
    },
    lines: {
      pass: [{ check: { lines: 6 } }],
      fail: [{ check: { lines: { min: 50 } }, evidence: '6 lines, expected at least 50' }],
    },
    tests: {
      pass: [],
      fail: [
        {
          check: { tests: { command: 'python -m pytest' } },
          evidence:
            'the code reader runs no command: the execution check owns commands ("python -m pytest" was not run); check the run with expect.execution',
        },
      ],
    },
  },
  ['tests'],
);

describe('text and code readers', () => {
  it('give a judge the file text, without a byte order mark', async () => {
    expect((await textReader.open(bytesOf(`﻿${NOTES}`), 'notes.md')).text()).toBe(NOTES);
    expect((await openCode()).text()).toBe(CODE);
  });

  it('decode UTF-16 files that start with their byte order mark', async () => {
    const utf16 = new Uint8Array([0xff, 0xfe, 0x41, 0x00, 0x63, 0x00, 0x6d, 0x00, 0x65, 0x00]);
    expect((await textReader.open(utf16, 'acme.txt')).text()).toBe('Acme');
  });

  it('count lines the way an editor shows them', () => {
    expect(lineCount('')).toBe(0);
    expect(lineCount('one')).toBe(1);
    expect(lineCount('one\n')).toBe(1);
    expect(lineCount('one\r\ntwo\rthree')).toBe(3);
    expect(lineCount('\n')).toBe(1);
  });

  it('refuse an empty needle or an invalid pattern, with the way the check is written', async () => {
    const document = await openText();
    expect(document.check({ contains: '' }).evidence).toBe(
      'contains takes a text or a list of them; write contains: "text" or contains: ["text", ...]',
    );
    expect(document.check({ regex: '(' }).evidence).toContain('regex has an invalid pattern');
    expect(document.check({ lines: -1 }).evidence).toContain(
      'lines needs a line count as a whole number or { min, max }',
    );
  });
});

import { describe, expect, it } from 'vitest';
import { AtomBuilder, ClaudeCodeReader, codeAtoms, proseCandidates } from '../../src/index';
import { estate } from '../support';

async function candidates(text: string) {
  const root = await estate({ 'CLAUDE.md': text });
  const raw = await new ClaudeCodeReader().read(root);
  const builder = new AtomBuilder(new Map(raw.files.map((file) => [file.path, file])));
  codeAtoms(raw, builder);
  return { raw, atoms: proseCandidates(raw, builder) };
}

describe('quantified clauses in the passive voice', () => {
  it.each([
    'Every release is tagged.',
    'Each invoice is archived after payment.',
    'Every receipt is stored in the vault, with its checksum.',
    'Every request (priority 1) is acknowledged within an hour.',
    'Every customer message is answered in the same language.',
  ])('proposes a present passive: %s', async (rule) => {
    const { atoms } = await candidates(`# Rules\n\n${rule}\n`);
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual([rule]);
    expect(atoms[0]!.fields).toMatchObject({ form: 'quantified', polarity: 'obligation' });
  });
  it.each([
    'Every release was tagged.',
    'Every invoices were archived.',
    'Every receipt has been stored.',
    'Every receipt had been stored.',
    'Every request is being acknowledged.',
  ])('does not propose a past, perfect or progressive statement: %s', async (text) => {
    expect((await candidates(`# Notes\n\n${text}\n`)).atoms).toEqual([]);
  });
});

describe('scanning does not slow down with the size of one file', () => {
  const budget = 5000;
  const timed = async (text: string) => {
    const { atoms } = await candidates(text);
    return atoms.length;
  };
  it('reads a long run of lines in one paragraph', async () => {
    const lines = Array.from(
      { length: 12000 },
      (_, index) => `Background line ${index} describes the archive.`,
    );
    const started = performance.now();
    expect(await timed(`${lines.join('\n')}\nNever disclose credentials. Always verify receipts.\n`)).toBe(2);
    expect(performance.now() - started).toBeLessThan(budget);
  });
  it('places thousands of candidates beside one another', async () => {
    const rules = Array.from({ length: 6000 }, (_, index) => `Item ${index} must keep its source.`);
    const started = performance.now();
    const { atoms } = await candidates(`${rules.join('\n\n')}\n`);
    expect(performance.now() - started).toBeLessThan(budget);
    expect(atoms).toHaveLength(6000);
    expect(atoms.at(-1)!.provenance.startLine).toBe(6000 * 2 - 1);
  });
});

describe('stray punctuation stays inside its paragraph', () => {
  it.each([
    'Use a 5" pipe here.',
    'He said “hello and left.',
    'The path C:\\temp\\ is not a quote.',
    'Use the `tick in this sentence.',
  ])('does not hide the rules after: %s', async (before) => {
    const { atoms } = await candidates(
      `${before}\n\nNever disclose credentials.\n\n- Always verify receipts.\n`,
    );
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual([
      'Never disclose credentials.',
      'Always verify receipts.',
    ]);
  });
  it('counts a quote that cannot be found at its lines instead of failing the scan', async () => {
    const { atoms, raw } = await candidates(
      'Always \\"x verify the receipt.\n\nNever disclose credentials.\n',
    );
    expect(atoms.map((atom) => atom.provenance.quote)).toEqual(['Never disclose credentials.']);
    expect(raw.notes.filter((note) => note.message.startsWith('Prose candidate skipped'))).toHaveLength(1);
  });
});

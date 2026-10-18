import {
  codeReader,
  createRegistry,
  defaultReaders,
  kindForPath,
  READERS,
  textReader,
} from '@agent-nexus/driftbench-artifacts';
import type { ArtifactKind, ArtifactReader } from '@agent-nexus/driftbench-core';
import { describe, expect, it } from 'vitest';

const KINDS: ArtifactKind[] = ['xlsx', 'docx', 'pptx', 'pdf', 'csv', 'json', 'text', 'code'];

describe('defaultReaders', () => {
  it('holds one reader per kind', () => {
    const registry = defaultReaders();
    for (const kind of KINDS) expect(registry.get(kind)?.kind).toBe(kind);
    expect(READERS.map((reader) => reader.kind).sort()).toEqual([...KINDS].sort());
  });

  it('picks the reader from the file extension, case ignored', () => {
    const registry = defaultReaders();
    const cases: [string, ArtifactKind | undefined][] = [
      ['out/acme-price-sheet.xlsx', 'xlsx'],
      ['out/Macro.XLSM', 'xlsx'],
      ['docs/brief.docx', 'docx'],
      ['Deck.PPTX', 'pptx'],
      ['out/review.pdf', 'pdf'],
      ['catalog.csv', 'csv'],
      ['export.tsv', 'csv'],
      ['out/plans.json', 'json'],
      ['notes.md', 'text'],
      ['config.yaml', 'text'],
      ['src/main.py', 'code'],
      ['app/page.tsx', 'code'],
      ['build/Dockerfile', 'code'],
      ['archive.zip', undefined],
      ['no-extension', undefined],
      ['.env', undefined],
      ['out/', undefined],
    ];
    for (const [path, kind] of cases) {
      expect(kindForPath(path), path).toBe(kind);
      expect(registry.forPath(path)?.kind, path).toBe(kind);
    }
  });

  it('lets a caller replace the reader of one kind', async () => {
    const custom: ArtifactReader = { kind: 'text', open: (bytes, path) => codeReader.open(bytes, path) };
    const registry = createRegistry([textReader, custom]);
    expect(registry.get('text')).toBe(custom);
    expect(registry.forPath('notes.txt')).toBe(custom);
    expect(registry.get('xlsx')).toBeUndefined();
  });

  it('lists, for every reader, the check names its documents answer and nothing else', async () => {
    for (const reader of READERS) {
      expect(reader.checkNames.length, reader.kind).toBeGreaterThan(0);
      expect(new Set(reader.checkNames).size, reader.kind).toBe(reader.checkNames.length);
      expect(reader.checkNames, reader.kind).toEqual(
        expect.arrayContaining(['contains', 'not_contains', 'regex']),
      );
    }
  });
});

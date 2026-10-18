import type {
  ArtifactCheck,
  ArtifactCheckResult,
  ArtifactDocument,
  ArtifactKind,
  ArtifactReader,
  ArtifactReaderRegistry,
} from '@agent-nexus/driftbench-core';

/** A workbook as the fake xlsx reader sees it: sheet name to rows, row 1 first. */
export type FakeBook = Record<string, unknown[][]>;

/**
 * A fake xlsx reader for the artifacts check tests. It reads its "file" as JSON (sheet name to rows)
 * and answers the checks the Acme price sheet declares: sheets, header, rows, cells, formula and
 * no_error_cells. A formula is a string starting with `=`. Anything else is a failed result naming it.
 */
export const fakeXlsx: ArtifactReader = {
  kind: 'xlsx',
  async open(bytes, path) {
    const book = JSON.parse(new TextDecoder().decode(bytes)) as FakeBook;
    return document(path, book);
  },
};

function document(path: string, book: FakeBook): ArtifactDocument {
  const result = (check: ArtifactCheck, ok: boolean, evidence: string): ArtifactCheckResult => ({
    check,
    ok,
    evidence,
  });
  return {
    kind: 'xlsx',
    path,
    text: () => JSON.stringify(book),
    check(check) {
      const [name, arg] = Object.entries(check)[0] ?? ['', undefined];
      const spec = (arg ?? {}) as Record<string, unknown>;
      const sheet = book[String(spec.sheet)] ?? [];
      switch (name) {
        case 'sheets': {
          const names = Object.keys(book);
          const want = arg as string[];
          return result(check, JSON.stringify(names) === JSON.stringify(want), `sheets ${names.join(', ')}`);
        }
        case 'header': {
          const row = sheet[Number(spec.row) - 1] ?? [];
          return result(
            check,
            JSON.stringify(row) === JSON.stringify(spec.values),
            `row ${spec.row}: ${row.join(' | ')}`,
          );
        }
        case 'rows':
          return result(
            check,
            sheet.length - 1 === spec.count,
            `${sheet.length - 1} data rows on ${spec.sheet}`,
          );
        case 'cells': {
          const column = String(spec.column).charCodeAt(0) - 65;
          const values = sheet.slice(Number(spec.from_row) - 1).map((row) => row[column]);
          return result(
            check,
            JSON.stringify(values) === JSON.stringify(spec.values),
            `${spec.sheet}!${spec.column}: ${JSON.stringify(values)}`,
          );
        }
        case 'formula': {
          const cell = String(spec.cell);
          const value = sheet[Number(cell.slice(1)) - 1]?.[cell.charCodeAt(0) - 65];
          const ok = typeof value === 'string' && new RegExp(String(spec.regex)).test(value);
          return result(check, ok, `${spec.sheet}!${cell} is ${JSON.stringify(value)}`);
        }
        case 'no_error_cells': {
          const errors = Object.values(book)
            .flat(2)
            .filter((value) => typeof value === 'string' && value.startsWith('#'));
          return result(
            check,
            errors.length === 0,
            errors.length === 0 ? 'no error cell' : `error cells: ${errors.join(', ')}`,
          );
        }
        default:
          return result(check, false, `unknown check ${name}`);
      }
    },
  };
}

/** A registry holding the given readers, picking by kind or by file extension. */
export function registry(...readers: ArtifactReader[]): ArtifactReaderRegistry {
  return {
    get: (kind: ArtifactKind) => readers.find((reader) => reader.kind === kind),
    forPath: (path: string) => readers.find((reader) => path.endsWith(`.${reader.kind}`)),
  };
}

/** A workspace of files for `ctx.readArtifact`; a missing path throws like a missing file. */
export function files(entries: Record<string, unknown>): (path: string) => Promise<Uint8Array> {
  return async (path) => {
    if (!(path in entries)) throw new Error(`ENOENT: no such file, ${path}`);
    return new TextEncoder().encode(JSON.stringify(entries[path]));
  };
}

/** The workbook the Acme price sheet task expects after block 0. */
export const PRICE_SHEET: FakeBook = {
  Mobile: [
    ['Plan', 'Allowance', 'Monthly price (USD)', 'Yearly price (USD)'],
    ['Acme Mobile S', '10 GB', 15, '=C2*12'],
    ['Acme Mobile M', '40 GB', 25, '=C3*12'],
    ['Acme Mobile L', 'unlimited', 35, '=C4*12'],
  ],
  Home: [
    ['Plan', 'Allowance', 'Monthly price (USD)', 'Yearly price (USD)'],
    ['Acme Fiber 300', '300 Mbps', 40, '=C2*12'],
    ['Acme Fiber 1000', '1000 Mbps', 60, '=C3*12'],
    ['Acme Air 5G', '200 Mbps', 35, '=C4*12'],
  ],
};

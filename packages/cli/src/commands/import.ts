import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve } from 'node:path';
import { readTables } from '@agent-nexus/driftbench-artifacts';
import { importTable, parseTableMapping } from '@agent-nexus/driftbench-core';
import type { Command } from 'commander';
import type { Io } from '../io';

type ImportOptions = { mapping: string; out: string; force?: boolean; json?: boolean };

const EXTENSIONS = { csv: ['.csv', '.tsv'], xlsx: ['.xlsx'] } as const;

/**
 * `driftbench import csv|xlsx <file> --mapping <yaml> --out <dir>`: turns the rows of a table into
 * spec files. The mapping file says which columns fill which spec and block fields; see
 * docs/importing.md. Exit 0 written, 1 when a row makes an invalid spec (nothing is written), 2 on bad
 * input: the mapping, the file, a column it names, a spec file that would be overwritten.
 */
export function registerImportCommand(program: Command, io: Io, setExit: (code: number) => void): void {
  const command = program
    .command('import')
    .description('Turn the rows of a CSV file or a spreadsheet into spec files, through a mapping file.');
  for (const format of ['csv', 'xlsx'] as const) {
    command
      .command(format)
      .description(
        format === 'csv'
          ? 'Import a .csv or .tsv file: one table, every field a text.'
          : 'Import one sheet of a .xlsx workbook: numbers and booleans kept.',
      )
      .argument('<file>', `the ${format} file`)
      .requiredOption('--mapping <yaml>', 'the mapping file: which columns fill which spec and block fields')
      .requiredOption('--out <dir>', 'the folder the spec files are written to, one <id>.yaml per spec')
      .option('--force', 'overwrite spec files that exist and differ')
      .option('--json', 'print one JSON document')
      .action(async (file: string, options: ImportOptions) => {
        setExit(await importCommand(format, file, options, io));
      });
  }
}

export async function importCommand(
  format: 'csv' | 'xlsx',
  file: string,
  options: ImportOptions,
  io: Io,
): Promise<number> {
  const path = resolve(io.cwd, file);
  if (!EXTENSIONS[format].some((ext) => path.toLowerCase().endsWith(ext))) {
    io.err(`import ${format} reads a ${EXTENSIONS[format].join(' or ')} file; ${file} is not one.\n`);
    return 2;
  }
  let mappingText: string;
  try {
    mappingText = await readFile(resolve(io.cwd, options.mapping), 'utf8');
  } catch (cause) {
    io.err(`Cannot read the mapping ${options.mapping}: ${describe(cause)}\n`);
    return 2;
  }
  const parsed = parseTableMapping(mappingText);
  if (!parsed.ok) {
    io.err(
      `The mapping ${options.mapping} is invalid:\n${parsed.errors.map((line) => `    ${line}\n`).join('')}`,
    );
    return 2;
  }
  // A CSV file is one table: the sheet a mapping names is for workbooks.
  const mapping = format === 'csv' ? { ...parsed.mapping, sheet: undefined } : parsed.mapping;
  let tables: Awaited<ReturnType<typeof readTables>>;
  try {
    tables = await readTables(new Uint8Array(await readFile(path)), path);
  } catch (cause) {
    io.err(`Cannot read ${file}: ${describe(cause)}\n`);
    return 2;
  }
  const source = basename(path);
  const result = importTable(tables, mapping, source);
  const general = result.errors.filter((error) => error.rows.length === 0);
  if (general.length > 0) {
    for (const error of general) io.err(`${error.message}\n`);
    return 2;
  }
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      const where = error.rows.length === 1 ? `row ${error.rows[0]}` : `rows ${error.rows.join(', ')}`;
      io.err(`✗ ${where}: ${error.message}\n`);
    }
    io.err(
      `${result.errors.length} of ${result.errors.length + result.specs.length} specs are invalid. Nothing was written.\n`,
    );
    return 1;
  }
  if (result.specs.length === 0) {
    io.err(`${file} has no row to import below its header row.\n`);
    return 2;
  }

  const outDir = resolve(io.cwd, options.out);
  const show = (target: string) => relative(io.cwd, target) || target;
  const files = result.specs.map((spec) => ({ spec, target: join(outDir, `${spec.id}.yaml`) }));
  if (options.force !== true) {
    for (const { spec, target } of files) {
      const current = await readFile(target, 'utf8').catch(() => undefined);
      if (current !== undefined && current !== spec.yaml) {
        io.err(
          `${show(target)} exists and differs from the import. Nothing was written. Overwrite with --force.\n`,
        );
        return 2;
      }
    }
  }
  await mkdir(outDir, { recursive: true });
  for (const { spec, target } of files) await writeFile(target, spec.yaml, 'utf8');

  const rowCount = result.specs.reduce((total, spec) => total + spec.rows.length, 0);
  if (options.json) {
    const specs = files.map(({ spec, target }) => ({
      id: spec.id,
      file: show(target),
      rows: spec.rows,
      blocks: Array.isArray(spec.spec.blocks) ? spec.spec.blocks.length : 0,
      hash: spec.hash,
    }));
    io.out(`${JSON.stringify({ source, out: show(outDir), rows: rowCount, specs }, null, 2)}\n`);
    return 0;
  }
  for (const { spec, target } of files) {
    const blocks = Array.isArray(spec.spec.blocks) ? spec.spec.blocks.length : 0;
    const rows = spec.rows.length === 1 ? `row ${spec.rows[0]}` : `rows ${spec.rows.join(', ')}`;
    io.out(`✓ ${show(target)}  ${spec.id} · ${blocks} block${blocks === 1 ? '' : 's'} · ${rows}\n`);
  }
  io.out(
    `Imported ${result.specs.length} spec${result.specs.length === 1 ? '' : 's'} from ${rowCount} row${rowCount === 1 ? '' : 's'} of ${source} into ${show(outDir)}.\n`,
  );
  return 0;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
}

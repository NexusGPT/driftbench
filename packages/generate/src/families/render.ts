import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { rngFor, shuffle } from '../seed/random';
import { FamilyError, type Knobs, meets, valuesOf } from './knobs';
import type { LoadedFamily } from './load';
import type { BlockDef, FamilyFile, Phrase, SeedFile } from './schema';
import type { TableCell, Tables } from './tables';
import { writeXlsx } from './xlsx';

/** The workspace of one variant: text files as text, other files (a workbook) as bytes. */
export type SeedFiles = { text: Record<string, string>; binary: Record<string, Uint8Array> };

/** Fills {slot} placeholders; a slot with no value is a defect of the family. */
export function fillSlots(template: string, slots: Readonly<Record<string, string>>, what: string): string {
  return template.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (whole, name: string) => {
    if (!Object.hasOwn(slots, name)) {
      throw new FamilyError(`${what} uses ${whole}, which no knob, file or oracle slot fills`);
    }
    return slots[name] as string;
  });
}

/** The knob values as slots, plus <table>_file: the path of the first file that renders each table. */
export function baseSlots(family: FamilyFile, knobs: Knobs): Record<string, string> {
  const slots: Record<string, string> = {};
  for (const [name, value] of Object.entries(knobs)) slots[name] = String(value);
  for (const file of family.files) {
    if (!meets(knobs, file.when)) continue;
    const table = 'csv' in file ? file.csv.table : 'json' in file ? file.json.table : undefined;
    const key = `${table}_file`;
    if (table !== undefined && !Object.hasOwn(slots, key))
      slots[key] = fillSlots(file.path, slots, 'a file path');
  }
  return slots;
}

function phraseText(family: FamilyFile, id: string): Phrase {
  const phrase = family.phrases.find((entry) => entry.id === id);
  if (!phrase) throw new FamilyError(`no phrase ${id}`);
  if (!phrase.approved) throw new FamilyError(`the phrase ${id} is not approved`);
  return phrase;
}

/** Columns in the order a file writes them: as declared, shuffled by a style knob, then rotated by a corner. */
function columnOrder(
  columns: readonly string[],
  orderKnob: string | undefined,
  shift: number,
  knobs: Knobs,
  seed: number,
  label: string,
): string[] {
  let order = [...columns];
  if (orderKnob !== undefined && knobs[orderKnob] === 'shuffled') {
    order = shuffle(rngFor(seed, `order:${label}`), order);
    // A shuffle that leaves the order as declared would make the two knob values one case.
    if (order.length > 1 && order.every((name, index) => name === columns[index]))
      order.push(order.shift() as string);
  }
  const by = order.length === 0 ? 0 : shift % order.length;
  return [...order.slice(by), ...order.slice(0, by)];
}

/** One CSV field: quoted when it holds a comma, a quote or a line break. */
function csvField(value: TableCell | undefined): string {
  const text = value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** The seed files of one variant, from its tables and knobs. */
export function renderFiles(loaded: LoadedFamily, tables: Tables, knobs: Knobs, seed: number): SeedFiles {
  const { family } = loaded;
  const slots = baseSlots(family, knobs);
  const out: SeedFiles = { text: {}, binary: {} };
  const put = (path: string, content: string | Uint8Array) => {
    if (Object.hasOwn(out.text, path) || Object.hasOwn(out.binary, path)) {
      throw new FamilyError(`two seed files have the path ${path}`);
    }
    if (typeof content === 'string') out.text[path] = content;
    else out.binary[path] = content;
  };
  family.files.forEach((file: SeedFile, index) => {
    if (!meets(knobs, file.when)) return;
    const path = fillSlots(file.path, slots, `files.${index}.path`);
    if ('csv' in file) {
      const table = tables[file.csv.table];
      if (!table) throw new FamilyError(`no table ${file.csv.table}`);
      const order = columnOrder(
        file.csv.columns,
        file.csv.column_order_knob,
        table.columnShift,
        knobs,
        seed,
        `files.${index}`,
      );
      const eol =
        file.csv.line_endings_knob !== undefined && knobs[file.csv.line_endings_knob] === 'crlf'
          ? '\r\n'
          : '\n';
      const lines = [
        order.join(','),
        ...table.rows.map((row) => order.map((name) => csvField(row[name])).join(',')),
      ];
      put(path, `${lines.join(eol)}${eol}`);
    } else if ('json' in file) {
      const table = tables[file.json.table];
      if (!table) throw new FamilyError(`no table ${file.json.table}`);
      const order = columnOrder(
        file.json.columns,
        file.json.column_order_knob,
        table.columnShift,
        knobs,
        seed,
        `files.${index}`,
      );
      const records = table.rows.map((row) =>
        Object.fromEntries(order.map((name) => [name, row[name] ?? ''])),
      );
      put(path, `${JSON.stringify({ [file.json.root]: records }, null, 2)}\n`);
    } else if ('xlsx' in file) {
      const table = tables[file.xlsx.table];
      if (!table) throw new FamilyError(`no table ${file.xlsx.table}`);
      const groups: string[] = [];
      for (const row of table.rows) {
        const key = String(row[file.xlsx.sheet_by] ?? '');
        if (!groups.includes(key)) groups.push(key);
      }
      const sheets = groups.map((key) => ({
        name: file.xlsx.sheet_name === 'title' ? key.charAt(0).toUpperCase() + key.slice(1) : key,
        rows: [
          file.xlsx.columns.map((column) => column.header),
          ...table.rows
            .filter((row) => String(row[file.xlsx.sheet_by] ?? '') === key)
            .map((row) =>
              file.xlsx.columns.map((column) => {
                const value = row[column.column];
                if (column.times === undefined) return value ?? '';
                if (typeof value !== 'number') {
                  throw new FamilyError(
                    `files.${index}: ${column.column} holds ${String(value)}, not a number to multiply`,
                  );
                }
                return value * column.times;
              }),
            ),
        ],
      }));
      try {
        put(path, writeXlsx(sheets));
      } catch (cause) {
        throw new FamilyError(`files.${index}: ${cause instanceof Error ? cause.message : String(cause)}`);
      }
    } else if ('text' in file) {
      put(
        path,
        fillSlots(phraseText(family, file.text.phrase).text, slots, `the phrase ${file.text.phrase}`),
      );
    } else {
      const bytes = readFileSync(resolve(loaded.dir, file.copy.from));
      put(path, isText(bytes) ? bytes.toString('utf8') : new Uint8Array(bytes));
    }
  });
  return out;
}

/** True when the bytes are UTF-8 text with no NUL byte, so a spec can hold them as text. */
export function isText(bytes: Buffer): boolean {
  if (bytes.includes(0)) return false;
  return Buffer.from(bytes.toString('utf8'), 'utf8').equals(bytes);
}

/** The index of the wording, from the wording knob. */
function wordingIndex(family: FamilyFile, knobs: Knobs): number {
  return Math.max(0, valuesOf(family, family.wording_knob).indexOf(knobs[family.wording_knob] as string));
}

/** The blocks an instance holds: those whose condition its knobs meet, in file order. */
export function activeBlocks(family: FamilyFile, knobs: Knobs): BlockDef[] {
  return family.blocks.filter((block) => meets(knobs, block.when));
}

/** The instruction of one block: one approved phrase per part whose condition holds, joined by a space. */
export function renderInstruction(
  family: FamilyFile,
  block: BlockDef,
  knobs: Knobs,
  slots: Readonly<Record<string, string>>,
): string {
  const wording = wordingIndex(family, knobs);
  const parts: string[] = [];
  for (const part of block.parts) {
    if (!meets(knobs, part.when)) continue;
    const id = part.phrases[wording % part.phrases.length] as string;
    parts.push(fillSlots(phraseText(family, id).text, slots, `the phrase ${id}`).trim());
  }
  if (parts.length === 0) throw new FamilyError(`the block ${block.id} has no part for these knobs`);
  return parts.join(' ');
}

/** The planted text of the planted variant. */
export function renderPlanted(family: FamilyFile, slots: Readonly<Record<string, string>>): string {
  const planted = family.planted;
  if (!planted) throw new FamilyError('the family has no planted variant');
  return fillSlots(phraseText(family, planted.phrase).text, slots, `the phrase ${planted.phrase}`);
}

/** The phrases a family uses that no person approved: an instance may hold none of them. */
export function unapprovedPhrases(family: FamilyFile): string[] {
  const used = new Set<string>();
  for (const block of family.blocks)
    for (const part of block.parts) for (const id of part.phrases) used.add(id);
  for (const file of family.files) if ('text' in file) used.add(file.text.phrase);
  if (family.planted) used.add(family.planted.phrase);
  return family.phrases
    .filter((phrase) => used.has(phrase.id) && !phrase.approved)
    .map((phrase) => phrase.id);
}

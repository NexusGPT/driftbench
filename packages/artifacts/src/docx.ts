import type JSZip from 'jszip';
import {
  countHolds,
  describeCount,
  mapping,
  missing,
  optionalInteger,
  parseCount,
  parseOrder,
  requiredList,
} from './args';
import { type Assertion, describeAssertion, holds, listed, parseAssertions } from './assertion';
import {
  type CheckTable,
  type KindReader,
  outcome,
  ownBuffer,
  ReaderDocument,
  type StructureCheck,
  unreadable,
} from './document';
import { matchList } from './match';
import { mainPart, readXmlPart, relationships, targetOf } from './opc';
import { loadReaderLibrary } from './optional';
import { squash, TEXT_CHECKS, textEqual } from './text';
import { attribute, childElement, childElements, type XmlElement } from './xml';

/**
 * The docx reader. The text a judge reads comes from mammoth; the structure comes from the document XML:
 * paragraphs with their heading level, and top-level tables with their rows. A heading is a paragraph
 * whose outline level, style name ("heading 1", "Title") or style chain says so, which also holds for
 * documents written in another language, whose style ids differ.
 */

export type Paragraph = { readonly kind: 'paragraph'; readonly text: string; readonly level?: number };
export type Table = { readonly kind: 'table'; readonly rows: readonly (readonly string[])[] };
export type Heading = { readonly text: string; readonly level: number; readonly index: number };

export type DocxData = {
  readonly blocks: readonly (Paragraph | Table)[];
  /** Headings in document order. Level 0 is the Title style. */
  readonly headings: readonly Heading[];
  /** Top-level tables in document order; a table inside a table cell is part of that cell's text. */
  readonly tables: readonly Table[];
};

type Style = { name?: string; outline?: number; basedOn?: string };

function readStyles(root: XmlElement | undefined): Map<string, Style> {
  const styles = new Map<string, Style>();
  for (const style of root ? childElements(root, 'style') : []) {
    const id = attribute(style, 'styleId');
    if (!id) continue;
    const outline = attribute(childElement(childElement(style, 'pPr'), 'outlineLvl'), 'val');
    styles.set(id, {
      name: attribute(childElement(style, 'name'), 'val'),
      outline: outline === undefined ? undefined : Number(outline),
      basedOn: attribute(childElement(style, 'basedOn'), 'val'),
    });
  }
  return styles;
}

/** The heading level a paragraph style gives, following the basedOn chain; undefined for body text. */
function styleLevel(styles: ReadonlyMap<string, Style>, id: string, depth = 0): number | undefined {
  const style = styles.get(id);
  const name = squash(style?.name ?? id).toLowerCase();
  const numbered = /^heading ?([1-9])$/.exec(name)?.[1];
  if (numbered) return Number(numbered);
  if (name === 'title') return 0;
  if (style?.outline !== undefined && Number.isInteger(style.outline)) {
    return style.outline >= 0 && style.outline <= 8 ? style.outline + 1 : undefined;
  }
  return style?.basedOn && depth < 10 ? styleLevel(styles, style.basedOn, depth + 1) : undefined;
}

const PROPERTIES = new Set(['pPr', 'rPr', 'tblPr', 'trPr', 'tcPr', 'sectPr', 'tblGrid']);

/** The text of a paragraph, a cell or a table: runs joined, tabs and breaks kept, paragraphs on lines. */
function collectText(node: XmlElement): string {
  let out = '';
  const walk = (element: XmlElement): void => {
    for (const child of element.children) {
      if (typeof child === 'string' || PROPERTIES.has(child.local)) continue;
      if (child.local === 't') {
        for (const text of child.children) if (typeof text === 'string') out += text;
      } else if (child.local === 'tab') {
        out += '\t';
      } else if (child.local === 'br' || child.local === 'cr') {
        out += '\n';
      } else if (child.local === 'p') {
        walk(child);
        out += '\n';
      } else {
        walk(child);
      }
    }
  };
  walk(node);
  return out.replace(/\n+$/, '');
}

/** Children with this local name, looking through content controls and custom XML wrappers. */
function unwrapped(parent: XmlElement, local: string): XmlElement[] {
  const out: XmlElement[] = [];
  for (const child of childElements(parent)) {
    if (child.local === local) out.push(child);
    else if (child.local === 'sdt') out.push(...unwrapped(childElement(child, 'sdtContent') ?? child, local));
    else if (child.local === 'customXml' || child.local === 'sdtContent')
      out.push(...unwrapped(child, local));
  }
  return out;
}

function readTable(table: XmlElement): Table {
  const rows = unwrapped(table, 'tr').map((row) =>
    unwrapped(row, 'tc').map((cell) => squash(collectText(cell))),
  );
  return { kind: 'table', rows };
}

function readBody(body: XmlElement, styles: ReadonlyMap<string, Style>): (Paragraph | Table)[] {
  const blocks: (Paragraph | Table)[] = [];
  const visit = (parent: XmlElement): void => {
    for (const child of childElements(parent)) {
      if (child.local === 'p') {
        const properties = childElement(child, 'pPr');
        const outline = attribute(childElement(properties, 'outlineLvl'), 'val');
        const style = attribute(childElement(properties, 'pStyle'), 'val');
        let level: number | undefined;
        if (outline !== undefined) {
          const n = Number(outline);
          level = Number.isInteger(n) && n >= 0 && n <= 8 ? n + 1 : undefined;
        } else if (style !== undefined) {
          level = styleLevel(styles, style);
        }
        const text = collectText(child);
        blocks.push(level === undefined ? { kind: 'paragraph', text } : { kind: 'paragraph', text, level });
      } else if (child.local === 'tbl') {
        blocks.push(readTable(child));
      } else if (child.local === 'sdt') {
        visit(childElement(child, 'sdtContent') ?? child);
      } else if (child.local === 'customXml') {
        visit(child);
      }
    }
  };
  visit(body);
  return blocks;
}

async function readStructure(zip: JSZip): Promise<DocxData> {
  const main = await mainPart(zip, 'word/document.xml');
  const document = await readXmlPart(zip, main);
  const body = childElement(document, 'body');
  if (!document || !body) throw new Error(`no document body in ${main}`);
  const stylesPart = targetOf(await relationships(zip, main), 'styles') ?? 'word/styles.xml';
  const blocks = readBody(body, readStyles(await readXmlPart(zip, stylesPart)));
  const headings: Heading[] = [];
  const tables: Table[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'table') tables.push(block);
    else if (block.level !== undefined && squash(block.text) !== '') {
      headings.push({ text: squash(block.text), level: block.level, index });
    }
  });
  return { blocks, headings, tables };
}

function words(text: string): number {
  const squashed = squash(text);
  return squashed === '' ? 0 : squashed.split(' ').length;
}

function showHeading(heading: Heading): string {
  return `${JSON.stringify(heading.text)} (${heading.level === 0 ? 'title' : `level ${heading.level}`})`;
}

const matches = (want: Assertion, text: string): boolean =>
  holds(want, { present: true, value: text }, textEqual);

const headings: StructureCheck<DocxData> = {
  reads: 'structure',
  usage:
    'headings: [Scope, Pricing] or headings: { values: [...], order: in_order | exact | any_order, level: 1 }',
  run(arg, data) {
    const map = Array.isArray(arg) ? { values: arg } : mapping(arg, ['values', 'order', 'level']);
    const values = parseAssertions(requiredList(map, 'values'), 'heading');
    const order = parseOrder(map.order, 'in_order');
    const level = optionalInteger(map, 'level', 0);
    const found = data.headings.filter((heading) => level === undefined || heading.level === level);
    const problems = matchList(
      values,
      found,
      order,
      (want, heading) => matches(want, heading.text),
      (heading) => JSON.stringify(heading.text),
    );
    const scope = level === undefined ? '' : ` at level ${level}`;
    const shown = found.length === 0 ? 'none' : listed(found.map(showHeading), 20);
    return outcome(`headings${scope}: ${shown}`, problems);
  },
};

const sections: StructureCheck<DocxData> = {
  reads: 'structure',
  usage: 'sections: [Scope, Pricing] or sections: { values: [...], level: 1 }',
  run(arg, data) {
    const map = Array.isArray(arg) ? { values: arg } : mapping(arg, ['values', 'level']);
    const values = parseAssertions(requiredList(map, 'values'), 'section');
    const level = optionalInteger(map, 'level', 0);
    const present: string[] = [];
    const problems: string[] = [];
    let unmatched = false;
    for (const want of values) {
      const heading = data.headings.find(
        (candidate) => (level === undefined || candidate.level === level) && matches(want, candidate.text),
      );
      if (!heading) {
        problems.push(`no heading ${describeAssertion(want)}`);
        unmatched = true;
        continue;
      }
      let count = 0;
      let tables = 0;
      for (const block of data.blocks.slice(heading.index + 1)) {
        if (block.kind === 'table') {
          tables++;
          count += words(block.rows.flat().join(' '));
        } else if (block.level !== undefined && block.level <= heading.level) {
          break;
        } else if (block.level === undefined) {
          count += words(block.text);
        }
      }
      if (count === 0 && tables === 0)
        problems.push(`${JSON.stringify(heading.text)} has nothing below its heading`);
      else
        present.push(
          `${JSON.stringify(heading.text)} (${count} words${tables > 0 ? `, ${tables} ${tables === 1 ? 'table' : 'tables'}` : ''})`,
        );
    }
    const evidence = present.length > 0 ? `sections ${listed(present)}` : 'no section found';
    const known = `the headings are ${data.headings.length === 0 ? 'none' : listed(data.headings.map((h) => JSON.stringify(h.text)))}`;
    return outcome(evidence, unmatched ? [...problems, known] : problems);
  },
};

const tableCount: StructureCheck<DocxData> = {
  reads: 'structure',
  usage: 'tables: 2 or tables: { min: 1 }',
  run(arg, data) {
    const count = parseCount(arg, 'a table count');
    const found = data.tables.length;
    const shown = data.tables.map(
      (table, index) =>
        `table ${index + 1} (${table.rows.length} rows, header ${(table.rows[0] ?? []).map((cell) => JSON.stringify(cell)).join(' | ')})`,
    );
    const ok = countHolds(count, found);
    const evidence = `${found} ${found === 1 ? 'table' : 'tables'}${found > 0 ? `: ${listed(shown, 6)}` : ''}`;
    return { ok, evidence: ok ? evidence : `${evidence}; expected ${describeCount(count)}` };
  },
};

const table: StructureCheck<DocxData> = {
  reads: 'structure',
  usage: 'table: { number: 1, header: [Plan, Price], rows: 3 }; rows counts the rows below the header',
  run(arg, data) {
    const map = mapping(arg, ['number', 'header', 'rows']);
    const number = optionalInteger(map, 'number', 1) ?? 1;
    const found = data.tables[number - 1];
    if (!found) missing(`no table ${number}: the document holds ${data.tables.length} top-level tables`);
    const header = found.rows[0] ?? [];
    const body = Math.max(0, found.rows.length - 1);
    const problems: string[] = [];
    if (map.header !== undefined) {
      const values = parseAssertions(requiredList(map, 'header'), 'header cell');
      problems.push(
        ...matchList(values, header, 'exact', matches, (cell) => JSON.stringify(cell)).map(
          (problem) => `header ${problem}`,
        ),
      );
    }
    if (map.rows !== undefined) {
      const count = parseCount(map.rows, 'rows');
      if (!countHolds(count, body)) problems.push(`expected ${describeCount(count)} rows below the header`);
    }
    const shown = header.length === 0 ? '(empty)' : header.map((cell) => JSON.stringify(cell)).join(' | ');
    return outcome(
      `table ${number} of ${data.tables.length}: header ${shown}, ${body} ${body === 1 ? 'row' : 'rows'} below it`,
      problems,
    );
  },
};

export const DOCX_CHECKS: CheckTable<DocxData> = {
  headings,
  sections,
  tables: tableCount,
  table,
  ...TEXT_CHECKS,
};

export const docxReader: KindReader = {
  kind: 'docx',
  checkNames: Object.keys(DOCX_CHECKS),
  async open(bytes, path) {
    // jszip and mammoth load when the first document opens, not when this package does. A missing mammoth
    // fails here, outside the catch that reports an unreadable file.
    const [{ default: Zip }, mammoth] = await Promise.all([
      import('jszip'),
      loadReaderLibrary('mammoth', 'docx', async () => (await import('mammoth')).default),
    ]);
    try {
      const zip = await Zip.loadAsync(ownBuffer(bytes));
      const data = await readStructure(zip);
      const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      return new ReaderDocument<DocxData>('docx', path, value.trimEnd(), DOCX_CHECKS, data);
    } catch (cause) {
      return unreadable('docx', path, DOCX_CHECKS, cause);
    }
  },
};

import type { ArtifactCheck, ArtifactDocument } from '@agent-nexus/driftbench-core';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { beforeAll, describe, expect, it } from 'vitest';
import type { KindReader } from '../src/document';

/**
 * Fixture builders. Every file is built at runtime from minimal parts: workbooks with exceljs, docx and
 * pptx from hand-written XML zipped with jszip, a PDF from a hand-written byte string. All data is
 * fictional.
 */

export function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export async function workbook(build: (book: ExcelJS.Workbook) => void): Promise<Uint8Array> {
  const book = new ExcelJS.Workbook();
  build(book);
  return new Uint8Array(await book.xlsx.writeBuffer());
}

export function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PACKAGE_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function rels(list: readonly { id: string; type: string; target: string }[]): string {
  const items = list
    .map((rel) => `<Relationship Id="${rel.id}" Type="${REL}/${rel.type}" Target="${rel.target}"/>`)
    .join('');
  return `${XML_HEAD}<Relationships xmlns="${PACKAGE_REL}">${items}</Relationships>`;
}

function contentTypes(overrides: readonly { part: string; type: string }[]): string {
  const items = overrides
    .map((item) => `<Override PartName="/${item.part}" ContentType="${item.type}"/>`)
    .join('');
  return (
    `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    `<Default Extension="xml" ContentType="application/xml"/>${items}</Types>`
  );
}

// docx

export const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** A paragraph, with a style id, or with an outline level set on the paragraph itself. */
export function para(text: string, options: { style?: string; outline?: number } = {}): string {
  const properties: string[] = [];
  if (options.style) properties.push(`<w:pStyle w:val="${options.style}"/>`);
  if (options.outline !== undefined) properties.push(`<w:outlineLvl w:val="${options.outline}"/>`);
  const pPr = properties.length > 0 ? `<w:pPr>${properties.join('')}</w:pPr>` : '';
  return `<w:p>${pPr}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

export function table(rows: readonly (readonly string[])[]): string {
  const body = rows
    .map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr/>${para(cell)}</w:tc>`).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr/><w:tblGrid/>${body}</w:tbl>`;
}

export const STYLES = [
  '<w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>',
  '<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/></w:style>',
  '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>',
  // A style id as a French Word writes it: the name, not the id, says heading 2.
  '<w:style w:type="paragraph" w:styleId="Titre2"><w:name w:val="heading 2"/></w:style>',
  // A custom style that is a heading only through its basedOn chain.
  '<w:style w:type="paragraph" w:styleId="AcmeHeading"><w:name w:val="Acme Heading"/><w:basedOn w:val="Heading1"/></w:style>',
  // A style with outline level 9 is body text, even when it is based on a heading.
  '<w:style w:type="paragraph" w:styleId="TOCHeading"><w:name w:val="TOC Heading"/><w:basedOn w:val="Heading1"/><w:pPr><w:outlineLvl w:val="9"/></w:pPr></w:style>',
].join('');

export async function docx(
  body: string,
  options: { styles?: string; main?: string; prefix?: string } = {},
): Promise<Uint8Array> {
  const main = options.main ?? 'word/document.xml';
  const prefix = options.prefix ?? 'w';
  const folder = main.slice(0, main.lastIndexOf('/'));
  const name = main.slice(main.lastIndexOf('/') + 1);
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    contentTypes([
      {
        part: main,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
      },
      {
        part: `${folder}/styles.xml`,
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml',
      },
    ]),
  );
  zip.file('_rels/.rels', rels([{ id: 'rId1', type: 'officeDocument', target: main }]));
  const rename = (xml: string): string =>
    prefix === 'w' ? xml : xml.replace(/(<\/?)w:/g, `$1${prefix}:`).replace(/ w:/g, ` ${prefix}:`);
  zip.file(
    main,
    `${XML_HEAD}<${prefix}:document xmlns:${prefix}="${W}"><${prefix}:body>${rename(body)}<${prefix}:sectPr/></${prefix}:body></${prefix}:document>`,
  );
  if (options.styles !== undefined) {
    zip.file(`${folder}/styles.xml`, `${XML_HEAD}<w:styles xmlns:w="${W}">${options.styles}</w:styles>`);
    zip.file(`${folder}/_rels/${name}.rels`, rels([{ id: 'rId1', type: 'styles', target: 'styles.xml' }]));
  }
  return zip.generateAsync({ type: 'uint8array' });
}

// pptx

const P = 'http://schemas.openxmlformats.org/presentationml/2006/main';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';

export type SlideSpec = {
  title?: string;
  titleType?: 'title' | 'ctrTitle';
  body?: readonly string[];
  table?: readonly (readonly string[])[];
};

function shape(id: number, placeholder: string, paragraphs: readonly string[]): string {
  const text = paragraphs
    .map(
      (line) =>
        `<a:p><a:pPr/><a:r><a:rPr lang="en-US"/><a:t>${escapeXml(line)}</a:t></a:r><a:endParaRPr/></a:p>`,
    )
    .join('');
  return (
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="Shape ${id}"/><p:cNvSpPr/><p:nvPr>${placeholder}</p:nvPr></p:nvSpPr>` +
    `<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${text}</p:txBody></p:sp>`
  );
}

function slideXml(slide: SlideSpec): string {
  const shapes: string[] = [];
  if (slide.title !== undefined)
    shapes.push(shape(2, `<p:ph type="${slide.titleType ?? 'title'}"/>`, [slide.title]));
  if (slide.body) shapes.push(shape(3, '<p:ph idx="1"/>', slide.body));
  if (slide.table) {
    const rows = slide.table
      .map(
        (row) =>
          `<a:tr h="370840">${row.map((cell) => `<a:tc><a:txBody><a:bodyPr/><a:p><a:r><a:t>${escapeXml(cell)}</a:t></a:r></a:p></a:txBody></a:tc>`).join('')}</a:tr>`,
      )
      .join('');
    shapes.push(
      '<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="Table 3"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>' +
        `<p:xfrm/><a:graphic><a:graphicData uri="${A}/table"><a:tbl>${rows}</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    );
  }
  return (
    `${XML_HEAD}<p:sld xmlns:a="${A}" xmlns:p="${P}" xmlns:r="${REL}"><p:cSld><p:spTree>` +
    '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/>' +
    `${shapes.join('')}</p:spTree></p:cSld></p:sld>`
  );
}

/** A deck whose slide files are slide1..N; `order` lists the file numbers in presentation order. */
export async function pptx(slides: readonly SlideSpec[], order?: readonly number[]): Promise<Uint8Array> {
  const zip = new JSZip();
  const sequence = order ?? slides.map((_, index) => index + 1);
  zip.file(
    '[Content_Types].xml',
    contentTypes([
      {
        part: 'ppt/presentation.xml',
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
      },
      ...slides.map((_, index) => ({
        part: `ppt/slides/slide${index + 1}.xml`,
        type: 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml',
      })),
    ]),
  );
  zip.file('_rels/.rels', rels([{ id: 'rId1', type: 'officeDocument', target: 'ppt/presentation.xml' }]));
  const ids = sequence.map((file, index) => `<p:sldId id="${256 + index}" r:id="rId${file + 1}"/>`).join('');
  zip.file(
    'ppt/presentation.xml',
    `${XML_HEAD}<p:presentation xmlns:a="${A}" xmlns:r="${REL}" xmlns:p="${P}"><p:sldIdLst>${ids}</p:sldIdLst></p:presentation>`,
  );
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    rels(
      slides.map((_, index) => ({
        id: `rId${index + 2}`,
        type: 'slide',
        target: `slides/slide${index + 1}.xml`,
      })),
    ),
  );
  slides.forEach((slide, index) => {
    zip.file(`ppt/slides/slide${index + 1}.xml`, slideXml(slide));
  });
  return zip.generateAsync({ type: 'uint8array' });
}

// pdf

/** A PDF with one line of Helvetica text per page, written by hand with a correct cross-reference table. */
export function pdf(pages: readonly string[]): Uint8Array {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  pages.forEach((text, index) => {
    const stream = `BT /F1 12 Tf 72 720 Td (${text.replace(/[\\()]/g, (char) => `\\${char}`)}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`,
    );
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(out.length);
    out += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) out += `${String(offset).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return bytesOf(out);
}

// case tables

export type Case = {
  check: ArtifactCheck;
  /** A text or pattern the evidence must hold: the evidence names what was found. */
  evidence?: string | RegExp;
  /** Another document for this case, when the main fixture cannot show it. */
  in?: () => Promise<ArtifactDocument>;
};

export type Cases = Record<string, { pass: readonly Case[]; fail: readonly Case[] }>;

/**
 * Runs a case table against a document and proves the table covers every check name of the reader,
 * each with a passing and a failing case. `alwaysFails` names checks that cannot pass by design.
 */
export function runCases(
  reader: KindReader,
  open: () => Promise<ArtifactDocument>,
  cases: Cases,
  alwaysFails: readonly string[] = [],
): void {
  describe(`${reader.kind} checks`, () => {
    let main: ArtifactDocument;
    beforeAll(async () => {
      main = await open();
    });

    it('covers every check name with a passing and a failing case', () => {
      expect(Object.keys(cases).sort()).toEqual([...reader.checkNames].sort());
      for (const [name, { pass, fail }] of Object.entries(cases)) {
        if (!alwaysFails.includes(name))
          expect(pass.length, `${name} has no passing case`).toBeGreaterThan(0);
        expect(fail.length, `${name} has no failing case`).toBeGreaterThan(0);
        for (const entry of [...pass, ...fail]) expect(Object.keys(entry.check), name).toEqual([name]);
      }
    });

    for (const [name, { pass, fail }] of Object.entries(cases)) {
      for (const [verdict, list] of [
        [true, pass],
        [false, fail],
      ] as const) {
        for (const entry of list) {
          it(`${name} ${verdict ? 'passes' : 'fails'}: ${JSON.stringify(entry.check[name])}`, async () => {
            const document = entry.in ? await entry.in() : main;
            const result = document.check(entry.check);
            expect(result.check).toBe(entry.check);
            expect(result.ok, result.evidence).toBe(verdict);
            expect(result.evidence.length).toBeGreaterThan(0);
            if (typeof entry.evidence === 'string') expect(result.evidence).toContain(entry.evidence);
            else if (entry.evidence) expect(result.evidence).toMatch(entry.evidence);
          });
        }
      }
    }
  });
}

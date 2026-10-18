import type { PDFParse } from 'pdf-parse';
import { countHolds, describeCount, parseCount } from './args';
import {
  type CheckTable,
  type KindReader,
  ReaderDocument,
  type StructureCheck,
  unreadable,
} from './document';
import { loadReaderLibrary } from './optional';
import { TEXT_CHECKS } from './text';

/** The pdf reader, on pdf-parse: the text of each page, and the page count. */

export type PdfData = {
  /** The page count from the document, which holds even when a page has no text. */
  readonly total: number;
  readonly pages: readonly { readonly number: number; readonly text: string }[];
};

const pageCount: StructureCheck<PdfData> = {
  reads: 'structure',
  usage: 'page_count: 2 or page_count: { min: 1, max: 10 }',
  run(arg, data) {
    const count = parseCount(arg, 'a page count');
    const found = data.total;
    const ok = countHolds(count, found);
    return {
      ok,
      evidence: `${found} ${found === 1 ? 'page' : 'pages'}${ok ? '' : `, expected ${describeCount(count)}`}`,
    };
  },
};

export const PDF_CHECKS: CheckTable<PdfData> = { page_count: pageCount, ...TEXT_CHECKS };

/** The text a judge reads: each page under a marker that names it. */
export function renderPages(data: PdfData): string {
  return data.pages.map((page) => `[page ${page.number} of ${data.total}]\n${page.text}`).join('\n\n');
}

export const pdfReader: KindReader = {
  kind: 'pdf',
  checkNames: Object.keys(PDF_CHECKS),
  async open(bytes, path) {
    // pdf-parse loads a native canvas library: it loads when the first PDF opens, not when this package does.
    // A missing package fails here, outside the catch that reports an unreadable file.
    const pdf = await loadReaderLibrary('pdf-parse', 'pdf', () => import('pdf-parse'));
    let parser: PDFParse | undefined;
    try {
      parser = new pdf.PDFParse({ data: new Uint8Array(bytes), verbosity: 0 });
      const result = await parser.getText();
      const data: PdfData = {
        total: result.total,
        pages: result.pages.map((page) => ({ number: page.num, text: page.text })),
      };
      return new ReaderDocument<PdfData>('pdf', path, renderPages(data), PDF_CHECKS, data);
    } catch (cause) {
      return unreadable('pdf', path, PDF_CHECKS, cause);
    } finally {
      // Releasing the parser cannot change what was read; a failure to release is not the file's fault.
      await parser?.destroy().catch(() => undefined);
    }
  },
};

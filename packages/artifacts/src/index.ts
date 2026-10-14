/**
 * @agent-nexus/driftbench-artifacts: readers for the files a code agent produces (xlsx, docx, pptx, pdf, csv, json,
 * text, code). Each reader opens one kind of file and answers the checks a spec declares on it
 * (`expect.artifacts[].checks`) with evidence that names what was found; `text()` is what a judge reads.
 * The artifact check in the checks package delegates to them through `defaultReaders()`.
 */
export const packageName = '@agent-nexus/driftbench-artifacts';

export { type Assertion, isSubset, parseAssertion } from './assertion';
export { type CsvGrid, csvReader, parseCsv } from './csv';
export type { CheckTable, KindReader, Outcome, StructureCheck, TextCheck } from './document';
export { type DocxData, docxReader } from './docx';
export { type JsonData, jsonReader, parsePath } from './json';
export { type PdfData, pdfReader } from './pdf';
export { codeReader, textReader } from './plain';
export { type PptxData, pptxReader } from './pptx';
export { createRegistry, defaultReaders, kindForPath, READERS } from './registry';
export { readTables } from './tables';
export { readWorkbook, type Sheet, type Workbook, xlsxReader } from './xlsx';

/**
 * A seed workbook: the smallest .xlsx a spreadsheet reader opens, written by code with no library, so the
 * same sheets always give the same bytes. Cells are text (inline strings) or numbers; an empty text cell is
 * left out. The parts are stored in a zip without compression, with a fixed date.
 */

export type XlsxCell = string | number;
export type XlsxSheet = { name: string; rows: readonly (readonly XlsxCell[])[] };

/** The bytes of a workbook holding these sheets, in order. Throws on a sheet name a workbook cannot hold. */
export function writeXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new Error('a workbook holds at least one sheet');
  const names = new Set<string>();
  for (const sheet of sheets) {
    if (sheet.name.length === 0 || sheet.name.length > 31 || /[\\/?*[\]:]/.test(sheet.name)) {
      throw new Error(`the sheet name "${sheet.name}" is not one a workbook can hold`);
    }
    const key = sheet.name.toLowerCase();
    if (names.has(key)) throw new Error(`the sheet name "${sheet.name}" is used twice`);
    names.add(key);
  }
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const parts: Array<[string, string]> = [
    [
      '[Content_Types].xml',
      `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
        )
        .join('')}</Types>`,
    ],
    [
      '_rels/.rels',
      `${XML}<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ],
    [
      'xl/workbook.xml',
      `${XML}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets>${sheets
        .map(
          (sheet, index) =>
            `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
        )
        .join('')}</sheets></workbook>`,
    ],
    [
      'xl/_rels/workbook.xml.rels',
      `${XML}<Relationships xmlns="${PKG}">${sheets
        .map(
          (_, index) =>
            `<Relationship Id="rId${index + 1}" Type="${REL}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
        )
        .join('')}</Relationships>`,
    ],
    ...sheets.map((sheet, index): [string, string] => [
      `xl/worksheets/sheet${index + 1}.xml`,
      `${XML}<worksheet xmlns="${MAIN}"><sheetData>${sheet.rows
        .map((row, at) => sheetRow(row, at + 1))
        .join('')}</sheetData></worksheet>`,
    ]),
  ];
  return storedZip(parts.map(([path, text]) => [path, new TextEncoder().encode(text)]));
}

function sheetRow(row: readonly XlsxCell[], number: number): string {
  const cells = row
    .map((value, column) => {
      const ref = `${columnName(column)}${number}`;
      if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error(`the cell ${ref} holds ${value}, not a number`);
        return `<c r="${ref}"><v>${value}</v></c>`;
      }
      if (value === '') return '';
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
    })
    .join('');
  return `<row r="${number}">${cells}</row>`;
}

/** A, B, ..., Z, AA, AB, ... for the column index from 0. */
function columnName(index: number): string {
  let name = '';
  for (let at = index + 1; at > 0; at = Math.floor((at - 1) / 26)) {
    name = String.fromCharCode(65 + ((at - 1) % 26)) + name;
  }
  return name;
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/** A zip of the files, stored without compression, every entry dated 1980-01-01 00:00. */
function storedZip(files: ReadonlyArray<[string, Uint8Array]>): Uint8Array {
  const DATE = 0x21; // 1980-01-01 in the DOS date format; the time is 0.
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const [path, data] of files) {
    const name = new TextEncoder().encode(path);
    const crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // the name is UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, 0, true);
    local.setUint16(12, DATE, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint16(10, 0, true);
    entry.setUint16(12, 0, true);
    entry.setUint16(14, DATE, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true);
    entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((sum, chunk) => sum + chunk.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((sum, chunk) => sum + chunk.length, 0));
  let at = 0;
  for (const chunk of all) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

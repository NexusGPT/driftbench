import { describe, expect, it } from 'vitest';
import { loadReaderLibrary } from '../src/optional';

function notFound(message: string): Error {
  return Object.assign(new Error(message), { code: 'ERR_MODULE_NOT_FOUND' });
}

describe('loadReaderLibrary', () => {
  it('returns what the loader returns', async () => {
    await expect(loadReaderLibrary('exceljs', 'xlsx', async () => 'library')).resolves.toBe('library');
  });

  it('names the package to install when it is not installed', async () => {
    const load = async () => {
      throw notFound("Cannot find package 'exceljs' imported from /tmp/acme/index.js");
    };
    await expect(loadReaderLibrary('exceljs', 'xlsx', load)).rejects.toThrow(
      'the xlsx reader needs the package exceljs, which is not installed. Install it next to driftbench: npm install exceljs',
    );
  });

  it('keeps any other failure as it is', async () => {
    const broken = notFound(
      "Cannot find package 'saxes' imported from /tmp/acme/node_modules/other/index.js",
    );
    await expect(loadReaderLibrary('exceljs', 'xlsx', () => Promise.reject(broken))).rejects.toBe(broken);
    const other = new Error('exceljs failed to start');
    await expect(loadReaderLibrary('exceljs', 'xlsx', () => Promise.reject(other))).rejects.toBe(other);
  });
});

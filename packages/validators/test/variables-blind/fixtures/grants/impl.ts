// Fictional implementation for the grants test: `validate` reads the file it is given, or writes and reads back a
// file in its temporary folder, and answers what it got or the error code.
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const variablesImpl = {
  validate(value: { read?: string; write?: boolean }) {
    try {
      if (value.write) {
        const folder = mkdtempSync(join(tmpdir(), 'grant-'));
        writeFileSync(join(folder, 'file'), 'written');
        return { ok: readFileSync(join(folder, 'file'), 'utf8') };
      }
      return { ok: readFileSync(value.read as string, 'utf8').length };
    } catch (error) {
      return { code: (error as { code?: string }).code ?? String(error) };
    }
  },
};

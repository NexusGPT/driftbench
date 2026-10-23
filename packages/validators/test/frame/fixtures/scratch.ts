// A fictional product that writes through the temporary folder it is given, as the variables adapter's quote check does.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const writeTemporary = () => {
  const folder = mkdtempSync(join(tmpdir(), 'fictional-'));
  try {
    writeFileSync(join(folder, 'note.txt'), 'fictional');
    return 'written';
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
};

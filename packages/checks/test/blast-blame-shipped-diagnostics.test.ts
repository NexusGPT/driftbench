import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: a plain JavaScript module of the release tools, with no types.
import { packFiles } from '../../../tools/release/check.mjs';
import { blame } from '../src';

/**
 * Blast radius of PR 451 on what ships: the five diagnostic files sit beside the policy files under
 * `packages/checks/objects/` and are read by `shippedObjectText` once the diagnostic kind is ready. The published
 * package must carry every one of them.
 */

const CHECKS = fileURLToPath(new URL('..', import.meta.url));

describe('the published checks package', { timeout: 120_000 }, () => {
  it('packs the five shipped diagnostic files and both policy files', () => {
    const pack = packFiles(CHECKS) as { files: string[] };
    const shipped = [
      ...Object.values(blame.SHIPPED_DIAGNOSTIC_FILES),
      ...Object.values(blame.SHIPPED_OBJECT_FILES),
    ].map((file) => `objects/${file}`);
    expect(Object.keys(blame.SHIPPED_DIAGNOSTIC_FILES)).toHaveLength(5);
    expect(shipped.filter((file) => !pack.files.includes(file))).toEqual([]);
  });

  it('packs no diagnostic file the code does not name, so none ships unread', () => {
    const pack = packFiles(CHECKS) as { files: string[] };
    const named = new Set(
      [...Object.values(blame.SHIPPED_DIAGNOSTIC_FILES), ...Object.values(blame.SHIPPED_OBJECT_FILES)].map(
        (file) => join('objects', file),
      ),
    );
    expect(pack.files.filter((file) => file.startsWith('objects/') && !named.has(file))).toEqual([]);
  });
});

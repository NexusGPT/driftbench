import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { leakReport } from '../../src/failure';
import { variablesImpl } from '../../src/ladders/variables/adapter';
import { variablesBank } from '../../src/ladders/variables/bank/index';
import { forceEveryCheck, leaksOutsideGot, noneSites } from '../forced-failures';

/**
 * Every check site of every first-bank item is reached (docs/validators.md 12.11): the item runs on the real product, once
 * per check with that check forced to fail, and the rendered failure is read. The wanted value that a site declares may
 * not be in its rule or its input, and the sites that declare nothing wanted are a closed set in
 * validators/variables/none-sites-first.json: a new one fails here until it is listed (UPDATE_NONE_SITES=1).
 */
const FILE = fileURLToPath(new URL('../../../../validators/variables/none-sites-first.json', import.meta.url));

describe('every check site of the first bank', () => {
  it('names its wanted value outside the message, and the sites with none are the listed ones', async () => {
    const items = variablesBank().filter((i) => !i.id.startsWith('blind.'));
    const { failures, unstructured } = await forceEveryCheck(items, variablesImpl, {
      seed: 1,
      // Scale items are slow: their first four checks are forced, the others are the same sites in another size.
      cap: (item) => (item.family === 'scale' ? 4 : Number.POSITIVE_INFINITY),
    });
    expect(unstructured).toEqual([]);
    expect(leakReport(failures.map((f) => ({ item: f.item, error: f.failure }))).leaking).toEqual([]);
    const outside = failures.flatMap((f) => leaksOutsideGot(f.failure).map((a) => `${f.item}#${f.k}: ${a}`));
    expect(outside).toEqual([]);
    const sites = noneSites(failures);
    if (process.env.UPDATE_NONE_SITES) {
      writeFileSync(FILE, `${JSON.stringify(sites, null, 0).replace(/","/g, '",\n"')}\n`);
      return;
    }
    const listed: string[] = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as string[]) : [];
    expect(sites.filter((s) => !listed.includes(s))).toEqual([]);
    expect(failures.length).toBeGreaterThan(0);
  }, 3_000_000);
});

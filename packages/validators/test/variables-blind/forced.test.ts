import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { blindBank } from '../../src/ladders/variables/blind/index';
import { auditEveryCheckSite } from '../forced-failures';
import { referenceImpl } from './reference/index';

/**
 * Every check site of the blind bank is reached (docs/validators.md 12.11): each source site is forced to fail once and its
 * rendered failure is read. The wanted value a site declares may not be in its rule or its input, and the sites that
 * declare nothing wanted are a closed set in validators/variables/none-sites-blind.json: a new one fails here until it is
 * listed on purpose (UPDATE_NONE_SITES=1 rewrites the file).
 */
const FILE = fileURLToPath(new URL('../../../../validators/variables/none-sites-blind.json', import.meta.url));

describe('every check site of the blind bank', () => {
  it('names its wanted value outside the message, and the sites with none are the listed ones', async () => {
    const audit = await auditEveryCheckSite(blindBank(), referenceImpl, 1);
    expect(audit.unstructured).toEqual([]);
    expect(audit.leaking).toEqual([]);
    expect(audit.sites).toBeGreaterThan(100);
    if (process.env.UPDATE_NONE_SITES) {
      writeFileSync(FILE, `${JSON.stringify(audit.none, null, 0).replace(/","/g, '",\n"')}\n`);
      return;
    }
    const listed: string[] = existsSync(FILE) ? (JSON.parse(readFileSync(FILE, 'utf8')) as string[]) : [];
    expect(audit.none.filter((s) => !listed.includes(s))).toEqual([]);
  }, 3_000_000);
});

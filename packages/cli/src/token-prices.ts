import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { TokenPrices } from '@agent-nexus/driftbench-core';
import { isMap, parseDocument } from 'yaml';
import { DEFAULT_CONFIG } from './aggregate-config';

/** --prices is a standalone table; otherwise read only prices: from the project config. */
export async function pricesFromConfig(
  options: { prices?: string; config?: string },
  cwd: string,
): Promise<TokenPrices | undefined> {
  const standalone = options.prices !== undefined;
  const path = resolve(cwd, options.prices ?? options.config ?? DEFAULT_CONFIG);
  if (!standalone && options.config === undefined && !existsSync(path)) return undefined;
  const doc = parseDocument(await readFile(path, 'utf8'));
  // A default file without this section keeps campaign's previous behaviour, even if unrelated YAML is invalid.
  if (!standalone && options.config === undefined && (!isMap(doc.contents) || !doc.contents.has('prices')))
    return undefined;
  if (doc.errors.length > 0) throw new Error(`${path}: not YAML: ${doc.errors[0]?.message}`);
  const root: unknown = doc.toJS();
  const value = standalone
    ? root
    : root && typeof root === 'object' && 'prices' in root
      ? root.prices
      : undefined;
  if (!standalone && value === undefined) return undefined;
  const parsed = TokenPrices.safeParse(value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new Error(`${path}: prices.${issue?.path.join('.') || '(root)'}: ${issue?.message}`);
  }
  return parsed.data;
}

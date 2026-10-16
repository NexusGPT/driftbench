import { posix } from 'node:path';
import type { Atom } from '../schema';
import { type IgnoreRule, ignoreRule } from './ignore';
import type { RawEstate } from './reader';

const RULES = new WeakMap<RawEstate, IgnoreRule[]>();
/** Test the resolved path, not merely a spelling which could resolve into a live local subtree. */
export function ignoredReference(raw: RawEstate, path: string): boolean {
  let rules = RULES.get(raw);
  if (!rules) {
    rules = (raw.ignored?.patterns ?? []).map((entry) => ignoreRule(entry.pattern));
    RULES.set(raw, rules);
  }
  return rules.some((rule) => rule.test(posix.normalize(path)));
}

/** A variable binding denotes a family of paths, never a concrete file whose absence is known. */
export function placeholderPath(path: string): boolean {
  return /<[^<>\n]+>|\{\{[^{}\n]+\}\}|\$\{[^{}\n]+\}/.test(path);
}

/** A bare unresolved name supplies no concrete missing-file location. Older code maps have a Read title. */
export function unresolvedReference(atom: Atom): boolean {
  if (atom.fields?.unresolved === true) return true;
  const written =
    typeof atom.fields?.written === 'string' ? atom.fields.written : /^Read (.+)$/.exec(atom.title)?.[1];
  return written !== undefined && !written.replace(/\\/g, '/').includes('/');
}

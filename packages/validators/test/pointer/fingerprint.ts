import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A fingerprint of an item as it is written today: its runner entry and its spec row without the cause tag. An item
 * labelled blind has its fingerprint recorded in `validators/pointer/blind-fingerprints.json`; a change to the
 * item changes the fingerprint, and the provenance test then fails until the item is relabelled. An item can also be
 * changed by a helper it calls; `REPAIRING_HELPERS` names the helpers whose change added a positive witness or
 * changed an oracle after the blind commit, and a blind item must not call one.
 */
const ROOT = new URL('../../src/ladders/pointer/', import.meta.url).pathname;
const FAMILY_FILES: Record<string, string> = { 're-anchoring': 'reanchoring' };
/**
 * Helpers (functions of the kit or of a family file) that changed after the blind commit in a way that moves a pass
 * condition: a positive witness, a stricter oracle, a new check. A comment-only change is not listed.
 */
export const REPAIRING_HELPERS: readonly string[] = [
  'canonical',
  'checkPlanted',
  'cutControl',
  'digestOf',
  'eventNow',
  'examples',
  'fixtureMissCase',
  'fresh',
  'go',
  'growth',
  'hash',
  'liveOf',
  'loadFixture',
  'makeFixture',
  'missCase',
  'mustRun',
  'parseCall',
  'perturb',
  'positiveReplay',
  'privateEstate',
  'readableFor',
  'record',
  'replay',
  'requireFixtureLabels',
  'requireSourceWitness',
  'rescanOk',
  'runScaleOp',
  'sameFingerprints',
  'scanOk',
  'staleCassette',
  'strings',
  'truthOf',
  'verifyScan',
  'wireFor',
];
const IGNORED = new Set(['pass', 'fail', 'Array', 'Set', 'Map', 'String', 'Number', 'Object', 'JSON']);

const read = (path: string): string => readFileSync(path, 'utf8');
const ts = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith('.ts'))
    .map((name) => join(dir, name));

function tops(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const line of text.split('\n')) {
    const m = /^(?:export\s+)?(?:async\s+)?(?:function\s+|const\s+|let\s+|class\s+)([A-Za-z0-9_]+)/.exec(
      line,
    );
    if (m) {
      current = m[1] as string;
      out.set(current, '');
    }
    if (current !== undefined) out.set(current, `${out.get(current)}${line}\n`);
  }
  return out;
}

function entries(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let current: string | undefined;
  for (const line of text.split('\n')) {
    const m = /^ {2}(?:'([^']+)'|([A-Za-z0-9_]+)):/.exec(line);
    if (m) {
      current = (m[1] ?? m[2]) as string;
      out.set(current, '');
    } else if (/^\S/.test(line)) current = undefined;
    if (current !== undefined) out.set(current, `${out.get(current)}${line}\n`);
  }
  return out;
}

const sha = (text: string): string => createHash('sha256').update(text).digest('hex').slice(0, 16);

/** The spec row of a key: the text of its `row(` call, up to the next one. */
function specRow(text: string, key: string): string {
  const chunks = text.split(/\brow\(\s*/);
  const chunk = chunks.find((part) => part.startsWith(`'${key}'`)) ?? '';
  // The cause tag (`'family:name',` on its own line) and the closing options name the repair, not the input or the oracle.
  return chunk
    .split('\n')
    .filter((line) => !/^\s*'[a-z0-9-]+:[a-z0-9-]+',?$/.test(line))
    .join('\n');
}

/** The runner entry and the spec row (without its cause) of an item id `family.key`. */
function parts(id: string): { entry: string; spec: string } {
  const dot = id.indexOf('.');
  const family = id.slice(0, dot);
  const key = id.slice(dot + 1);
  const file = FAMILY_FILES[family] ?? family;
  const entry = entries(read(join(ROOT, 'bank/families', `${file}.ts`))).get(key) ?? '';
  const spec = specRow(read(join(ROOT, 'bank/specs', `${file}.ts`)), key);
  return { entry, spec };
}

export function fingerprints(ids: readonly string[]): Record<string, string> {
  return Object.fromEntries(ids.map((id) => [id, sha(Object.values(parts(id)).join('\u0000'))]));
}

/**
 * The repairing helpers an item's runner can reach: every helper called from its entry, followed through the helpers
 * of its family file and of the kit to any depth.
 */
export function repairingCalls(id: string): string[] {
  const dot = id.indexOf('.');
  const family = id.slice(0, dot);
  const file = FAMILY_FILES[family] ?? family;
  const kit = new Map<string, string>();
  for (const path of ts(join(ROOT, 'kit')))
    for (const [name, body] of tops(read(path))) kit.set(name, `${kit.get(name) ?? ''}${body}`);
  const helpers = new Map([...kit, ...tops(read(join(ROOT, 'bank/families', `${file}.ts`)))]);
  const seen = new Set<string>();
  let frontier = [parts(id).entry];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const text of frontier) {
      for (const m of text.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*(?:\(|<)/g)) {
        const name = m[1] as string;
        if (seen.has(name) || !helpers.has(name)) continue;
        seen.add(name);
        next.push(helpers.get(name) as string);
      }
    }
    frontier = next;
  }
  return REPAIRING_HELPERS.filter((name) => seen.has(name));
}

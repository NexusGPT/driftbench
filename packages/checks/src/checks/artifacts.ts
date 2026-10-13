import {
  type ArtifactCheck,
  type ArtifactDocument,
  type ArtifactExpect,
  type ArtifactReader,
  type Check,
  type CheckContext,
  machineVerdict,
  type Verdict,
} from '@agent-nexus/driftbench-core';
import { message } from '../support/assert';
import { entryKeys } from '../support/values';

const NAME = 'artifacts';

/**
 * `expect.artifacts`: each file the block must produce. The check reads the file through
 * `ctx.readArtifact`, picks its reader from `ctx.artifacts` (by `kind`, or by the file extension), opens
 * it, and runs each declared check through the reader's `document.check`. One verdict for the file (read
 * and opened), then one per declared check with the reader's evidence. A missing file, reader or reader
 * package is one failed verdict that names it; the declared checks then have nothing to run on.
 */
export const artifacts: Check = {
  name: NAME,
  applies: (ctx) => (ctx.expect.artifacts?.length ?? 0) > 0,
  async evaluate(ctx) {
    const expected = ctx.expect.artifacts ?? [];
    const keys = entryKeys(expected.map((entry) => entry.path));
    const verdicts: Verdict[] = [];
    for (const [index, entry] of expected.entries()) {
      verdicts.push(...(await artifactVerdicts(ctx, entry, keys[index] ?? entry.path)));
    }
    return verdicts;
  },
};

async function artifactVerdicts(ctx: CheckContext, entry: ArtifactExpect, key: string): Promise<Verdict[]> {
  const fail = (evidence: string) => [machineVerdict(NAME, key, 'fail', evidence)];
  if (!ctx.readArtifact) {
    return fail(`cannot read ${entry.path}: the adapter gives no workspace to read files from`);
  }
  let bytes: Uint8Array;
  try {
    bytes = await ctx.readArtifact(entry.path);
  } catch (cause) {
    return fail(`${entry.path} is missing or unreadable: ${message(cause)}`);
  }
  if (!ctx.artifacts) {
    return fail(`no artifact reader package is loaded, so ${entry.path} cannot be opened`);
  }
  const reader: ArtifactReader | undefined = entry.kind
    ? ctx.artifacts.get(entry.kind)
    : ctx.artifacts.forPath(entry.path);
  if (!reader) {
    return fail(
      entry.kind
        ? `no reader for kind ${entry.kind} is registered, so ${entry.path} cannot be opened`
        : `no reader matches the extension of ${entry.path}; set kind on the expectation`,
    );
  }
  let document: ArtifactDocument;
  try {
    document = await reader.open(bytes, entry.path);
  } catch (cause) {
    return fail(`${entry.path} does not open as ${reader.kind}: ${message(cause)}`);
  }
  const verdicts = [
    machineVerdict(NAME, key, 'pass', `${entry.path} opened as ${reader.kind} (${bytes.byteLength} bytes)`),
  ];
  (entry.checks ?? []).forEach((check, index) => {
    verdicts.push(checkVerdict(document, check, `${key}.${index}.${checkName(check)}`));
  });
  return verdicts;
}

function checkVerdict(document: ArtifactDocument, check: ArtifactCheck, id: string): Verdict {
  const name = checkName(check);
  try {
    const result = document.check(check);
    const evidence = result.evidence.trim() === '' ? 'the reader gave no evidence' : result.evidence;
    return machineVerdict(NAME, id, result.ok ? 'pass' : 'fail', `${document.path} ${name}: ${evidence}`);
  } catch (cause) {
    return machineVerdict(NAME, id, 'fail', `${document.path} ${name}: the reader threw: ${message(cause)}`);
  }
}

/** The name of a declared check: the key of its mapping, such as `sheets`. */
function checkName(check: ArtifactCheck): string {
  const keys = Object.keys(check);
  return keys.length === 0 ? 'check' : keys.join('+');
}

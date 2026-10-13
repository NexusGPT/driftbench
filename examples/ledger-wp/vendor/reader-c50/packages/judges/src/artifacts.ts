import { defaultReaders, kindForPath } from '@agent-nexus/driftbench-artifacts';
import type {
  ArtifactKind,
  ArtifactReaderRegistry,
  CheckContext,
  WorkspaceDiff,
} from '@agent-nexus/driftbench-core';

/**
 * What a judge reads of a task block (P2.5): the files the block produced, as the artifact readers render
 * them (xlsx cells and formulas, docx, pptx, pdf, csv, json, text, code), and the workspace diff as a
 * short summary. A judge then reads the workbook itself, never the agent's own description of it.
 *
 * The files are the block's `expect.artifacts`, then any other file the diff created or changed that a
 * reader opens, in path order. Each is read through `CheckContext.readArtifact` and opened with
 * `ctx.artifacts`, or the default readers when the runner passes none. A file that cannot be read or
 * opened is named with the reason, so the judge sees the gap instead of a silent omission.
 */

export type TaskArtifactOptions = {
  /** Readers used when the context carries none. Default: every reader of @agent-nexus/driftbench-artifacts. */
  readonly readers?: ArtifactReaderRegistry;
  /** The most characters of one file's text the judge reads. Default 20000. */
  readonly maxChars?: number;
};

const MAX_CHARS = 20_000;

/** The artifact section of a judge request for this block, or undefined when it is not a task block. */
export async function taskArtifactText(
  ctx: CheckContext,
  options: TaskArtifactOptions = {},
): Promise<string | undefined> {
  const diff = ctx.observed.workspaceDiff;
  const expected = ctx.expect.artifacts ?? [];
  if (ctx.spec.kind !== 'task' && expected.length === 0 && diff === undefined) return undefined;

  const files: { path: string; kind?: ArtifactKind }[] = expected.map((entry) => ({
    path: entry.path,
    ...(entry.kind === undefined ? {} : { kind: entry.kind }),
  }));
  const seen = new Set(files.map((file) => file.path));
  for (const path of [...(diff?.created ?? []), ...(diff?.changed ?? [])].sort()) {
    if (!seen.has(path) && kindForPath(path) !== undefined) {
      files.push({ path });
      seen.add(path);
    }
  }

  const readers = ctx.artifacts ?? options.readers ?? defaultReaders();
  const max = options.maxChars ?? MAX_CHARS;
  const sections: string[] = [];
  for (const file of files) sections.push(await render(ctx, readers, file, max));
  sections.push(summarizeDiff(diff));
  return sections.join('\n\n');
}

async function render(
  ctx: CheckContext,
  readers: ArtifactReaderRegistry,
  file: { path: string; kind?: ArtifactKind },
  max: number,
): Promise<string> {
  if (!ctx.readArtifact) return `File ${file.path}: not read, the adapter gives no workspace to read from.`;
  let bytes: Uint8Array;
  try {
    bytes = await ctx.readArtifact(file.path);
  } catch (cause) {
    return `File ${file.path}: missing or unreadable (${message(cause)}).`;
  }
  const reader = file.kind ? readers.get(file.kind) : readers.forPath(file.path);
  if (!reader) return `File ${file.path}: no reader opens it.`;
  let text: string;
  try {
    text = (await reader.open(bytes, file.path)).text();
  } catch (cause) {
    return `File ${file.path}: does not open as ${reader.kind} (${message(cause)}).`;
  }
  const clipped =
    text.length > max ? `${text.slice(0, max)}\n[clipped: ${text.length - max} more characters]` : text;
  return `File ${file.path} (${reader.kind})\n${clipped}`;
}

/** A file name on one line: a line break is shown as its escape, so a name cannot start a new line of the summary. */
function oneLine(path: string): string {
  const escapes: Record<string, string> = {
    '\n': '\\n',
    '\r': '\\r',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  };
  return path.replace(/[\r\n\u2028\u2029]/g, (ch) => escapes[ch] as string);
}

/** The workspace diff in one line, as a judge reads it. */
export function summarizeDiff(diff: WorkspaceDiff | undefined): string {
  if (diff === undefined) return 'Workspace changes: the adapter reported none.';
  const list = (paths: readonly string[]) =>
    paths.length === 0 ? 'none' : [...paths].sort().map(oneLine).join(', ');
  return `Workspace changes: created ${list(diff.created)}; changed ${list(diff.changed)}; deleted ${list(diff.deleted)}.`;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

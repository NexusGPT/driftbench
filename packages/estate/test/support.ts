import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClaudeCodeReader, estateRecordingPort, loadEstateRecording, scanEstate } from '../src/index';

/** The hand-written Northwind fixture estate. */
export const FIXTURE = fileURLToPath(new URL('../../../examples/estates/fixture/', import.meta.url));
export const NOW = () => new Date('2026-10-11T00:00:00.000Z');

/** Writes a small estate to a temporary folder: a map of relative paths to file contents. */
export async function estate(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'driftbench-estate-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

/** The fixture scanned with its recorded answers, as the committed map was. */
export async function scanFixture() {
  const recording = await loadEstateRecording(join(FIXTURE, 'answers.yaml'));
  if (!recording.ok) throw new Error(recording.message);
  return scanEstate({
    root: FIXTURE,
    reader: new ClaudeCodeReader(),
    port: estateRecordingPort(recording.recording),
    now: NOW,
  });
}

/** One answer of the prose contract, as JSON text. */
export function answer(chunk: string, atoms: unknown[]): string {
  return JSON.stringify({ chunk, atoms });
}

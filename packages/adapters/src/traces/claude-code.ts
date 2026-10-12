import { readFile, stat } from 'node:fs/promises';
import { parseJsonl } from '../claude-code/format';
import { mapSession } from '../claude-code/session';
import type { Trace } from './types';

/**
 * A recorded Claude Code session (the transcript JSONL) read as one driftbench trace: one turn per typed
 * user message, mapped by the same reader `driftbench replay` uses. A decision log and a step feed beside
 * it (`<name>.decisions.jsonl`, `<name>.steps.jsonl`) are read when present.
 */
export async function traceFromClaudeCode(path: string): Promise<Trace> {
  const sidecar = async (suffix: string) => {
    const file = path.replace(/\.jsonl$/, `.${suffix}.jsonl`);
    return file !== path && (await stat(file).catch(() => undefined))
      ? parseJsonl(await readFile(file, 'utf8'))
      : undefined;
  };
  const transcript = parseJsonl(await readFile(path, 'utf8'));
  const decisions = await sidecar('decisions');
  const steps = await sidecar('steps');
  const session = mapSession({
    transcript,
    file: path,
    ...(decisions ? { decisions } : {}),
    ...(steps ? { steps } : {}),
  });
  let model: string | undefined;
  for (const line of transcript) {
    if (!line.ok || !isRecord(line.value) || !isRecord(line.value.message)) continue;
    if (typeof line.value.message.model === 'string') {
      model = line.value.message.model;
      break;
    }
  }
  const turns = session.blocks.map((block, index) => {
    const stimulus = block.stimulus as Record<string, unknown>;
    const user =
      typeof stimulus.user === 'string'
        ? stimulus.user
        : Array.isArray(stimulus.burst)
          ? stimulus.burst.join('\n')
          : '';
    const at = session.meta.blocks[index]?.at;
    return { user, ...(at ? { startedAt: at } : {}), observed: block.observed };
  });
  return {
    id: session.meta.sessionId ?? path,
    source: 'claude-code',
    ...(turns[0]?.startedAt ? { startedAt: turns[0].startedAt } : {}),
    ...(model ? { model } : {}),
    turns,
    issues: session.meta.issues,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

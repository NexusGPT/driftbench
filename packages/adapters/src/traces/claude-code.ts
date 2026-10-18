import { readFile, stat } from 'node:fs/promises';
import { parseJsonl } from '../claude-code/format';
import { mapSession } from '../claude-code/session';
import { isRecord } from '../shared/records';
import { type PriceTable, priced, type Trace, type TraceObservation } from './types';

/**
 * A recorded Claude Code session (the transcript JSONL) read as one driftbench trace: one turn per typed
 * user message, mapped by the same reader `driftbench replay` uses. A decision log and a step feed beside
 * it (`<name>.decisions.jsonl`, `<name>.steps.jsonl`) are read when present.
 */
export async function traceFromClaudeCode(
  path: string,
  options: { prices?: PriceTable } = {},
): Promise<Trace> {
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
    const startLine = session.meta.blocks[index]?.startLine;
    const opening = startLine === undefined ? undefined : transcript[startLine - 1];
    const observationId =
      opening?.ok && isRecord(opening.value) && typeof opening.value.uuid === 'string'
        ? opening.value.uuid
        : undefined;
    return {
      user,
      ...(at ? { startedAt: at } : {}),
      ...(observationId ? { observationId } : {}),
      observed: block.observed,
    };
  });
  return {
    id: session.meta.sessionId ?? path,
    source: 'claude-code',
    ...(turns[0]?.startedAt ? { startedAt: turns[0].startedAt } : {}),
    ...(model ? { model } : {}),
    turns,
    observations: observationsOf(transcript, options.prices),
    issues: session.meta.issues,
  };
}

/**
 * Every transcript line with a uuid and a timestamp, nested under its parent line. A line marked as a sidechain
 * was written by a subagent. A tool result is a tool observation, an assistant line a chat one, and a chat line
 * with tokens carries its usage and, with a price table, its cost.
 */
function observationsOf(
  transcript: ReadonlyArray<{ ok: boolean; value?: unknown }>,
  prices: PriceTable | undefined,
): TraceObservation[] {
  const out: TraceObservation[] = [];
  for (const line of transcript) {
    if (!line.ok || !isRecord(line.value)) continue;
    const value = line.value;
    const at = typeof value.timestamp === 'string' ? value.timestamp : undefined;
    if (typeof value.uuid !== 'string' || at === undefined) continue;
    const message = isRecord(value.message) ? value.message : {};
    const content = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
    const results = content.filter((part) => part.type === 'tool_result');
    const chat = value.type === 'assistant' || message.role === 'assistant';
    const usage = isRecord(message.usage) ? message.usage : undefined;
    const inputTokens = typeof usage?.input_tokens === 'number' ? usage.input_tokens : undefined;
    const outputTokens = typeof usage?.output_tokens === 'number' ? usage.output_tokens : undefined;
    const model = typeof message.model === 'string' ? message.model : undefined;
    const usd =
      chat && inputTokens !== undefined ? priced(prices, model, inputTokens, outputTokens ?? 0) : undefined;
    out.push({
      id: value.uuid,
      ...(typeof value.parentUuid === 'string' ? { parentId: value.parentUuid } : {}),
      kind: chat ? 'chat' : results.length > 0 ? 'tool' : 'other',
      name: typeof value.type === 'string' ? value.type : 'line',
      start: at,
      end: at,
      level: results.some((part) => part.is_error === true) ? 'error' : 'default',
      ...(value.isSidechain === true ? { subagent: true } : {}),
      ...(inputTokens === undefined && outputTokens === undefined
        ? {}
        : {
            usage: {
              ...(inputTokens === undefined ? {} : { inputTokens }),
              ...(outputTokens === undefined ? {} : { outputTokens }),
            },
          }),
      ...(usd === undefined ? {} : { usd }),
    });
  }
  return out;
}

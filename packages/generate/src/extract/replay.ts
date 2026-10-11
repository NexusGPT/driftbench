import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { ModelError, type ModelPort, type ModelRequest } from '../model/port';
import { SECTIONS, type Section, sectionOf } from './contract';

/**
 * A recording: the answers a model gave (or a person wrote by the same contract), one per section, replayed
 * instead of calling a model. It makes an extraction reproducible offline: the same sources and the same
 * recording give the same proposal. An answer is the raw text, or a JSON object written as YAML (sent as
 * its JSON text). A list replays one answer per call, so a first unreadable answer and its retry can both
 * be recorded.
 */

const RecordedAnswer = z.union([z.string().min(1), z.record(z.string(), z.unknown())]);

export const Recording = z
  .strictObject({
    family: z.string().min(1).describe('The family that wrote the answers, recorded in produced_by.'),
    model: z.string().min(1).describe('The model that wrote the answers, recorded in produced_by.'),
    answers: z.partialRecord(z.enum(SECTIONS), z.union([RecordedAnswer, z.array(RecordedAnswer).min(1)])),
  })
  .describe('Recorded answers for driftbench extract --replay.');
export type Recording = z.infer<typeof Recording>;

export type RecordingResult = { ok: true; recording: Recording } | { ok: false; message: string };

/** Reads and validates a recording file (YAML or JSON). */
export async function loadRecording(path: string): Promise<RecordingResult> {
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(path, 'utf8'), { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      message: cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause),
    };
  }
  const parsed = Recording.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, message: `${issue?.path.map(String).join('.') || '(file)'}: ${issue?.message}` };
  }
  return { ok: true, recording: parsed.data };
}

/** A port that answers each request with the next recorded answer for the request's section. */
export function recordingPort(recording: Recording): ModelPort {
  const queues = new Map<Section, string[]>();
  for (const section of SECTIONS) {
    const recorded = recording.answers[section];
    if (recorded === undefined) continue;
    queues.set(
      section,
      (Array.isArray(recorded) ? recorded : [recorded]).map((answer) =>
        typeof answer === 'string' ? answer : JSON.stringify(answer, null, 2),
      ),
    );
  }
  return {
    family: recording.family,
    model: recording.model,
    async complete(request: ModelRequest): Promise<string> {
      const section = sectionOf(request.user);
      if (!section) throw new ModelError('bad_response', 'the request does not name a section');
      const next = queues.get(section)?.shift();
      if (next === undefined) {
        throw new ModelError('exhausted', `the recording holds no answer left for the ${section} section`);
      }
      return next;
    },
  };
}

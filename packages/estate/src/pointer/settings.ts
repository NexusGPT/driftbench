import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml, stringify } from 'yaml';
import { parseLabelerSpec } from './stack';

/**
 * The pointer reader's settings in the estate configuration file, `driftbench.estate.yaml` at the root:
 *
 *     labels: labels.yaml            # the label sets: a file beside the estate, or the sets inline
 *     labeler: [system1:jev, system2:anthropic]
 *     threshold: { labeler: 0.4, pass_at: 0.9, fail_at: 0.1, margin_cut: 0.65 }
 *     ledger: driftbench.ledger.json
 *
 * Every key is optional; a command-line option wins over its key. No key names a model: a model is set by
 * environment variable (`ANTHROPIC_LABELER_MODEL`, `JEV_MODEL`, `OPENAI_DECISIONS_MODEL`), so a file shared by
 * a team never pins one. Every path is relative to the root. A key with the wrong shape is an error, never left
 * out, because it would change the labels.
 */

export const SETTINGS_FILE = 'driftbench.estate.yaml';

/** The environment variable that sets the model of each labeler client that takes one. */
export const MODEL_VARIABLES: Readonly<Record<string, string>> = {
  anthropic: 'ANTHROPIC_LABELER_MODEL',
  jev: 'JEV_MODEL',
  'jev-unit': 'JEV_MODEL',
  'openai-decisions': 'OPENAI_DECISIONS_MODEL',
};

export type PointerSettings = {
  /** The label sets: a path relative to the root, or the YAML text of sets written inline. */
  labels?: { path: string } | { text: string };
  labeler?: string[];
  threshold?: { labeler?: number; passAt?: number; failAt?: number; marginCut?: number };
  /** The ledger, relative to the root. */
  ledger?: string;
  /** The keys the file set, in the order above. */
  keys: string[];
};

export type SettingsResult = { ok: true; settings: PointerSettings } | { ok: false; errors: string[] };

const THRESHOLDS = {
  labeler: 'labeler',
  pass_at: 'passAt',
  fail_at: 'failAt',
  margin_cut: 'marginCut',
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Reads the pointer keys of a parsed configuration file; other keys belong to the scan and the unit runner. */
export function parsePointerSettings(value: unknown): SettingsResult {
  const settings: PointerSettings = { keys: [] };
  if (value === undefined || value === null) return { ok: true, settings };
  if (!isRecord(value)) return { ok: false, errors: [`${SETTINGS_FILE} is not a mapping`] };
  const errors: string[] = [];
  const { labels, labeler, threshold, ledger } = value;
  if (labels !== undefined) {
    if (typeof labels === 'string' && labels.trim() !== '') settings.labels = { path: labels.trim() };
    else if (Array.isArray(labels) && labels.length > 0) settings.labels = { text: stringify({ labels }) };
    else errors.push('labels: a file of label sets, or a list of sets');
  }
  if (labeler !== undefined) {
    const list = typeof labeler === 'string' ? [labeler] : labeler;
    if (!Array.isArray(list) || list.length === 0 || !list.every((item) => typeof item === 'string')) {
      errors.push('labeler: a labeler, or a list of one per class, such as system2:anthropic');
    } else {
      for (const text of list as string[]) {
        const parsed = parseLabelerSpec(text);
        if (!parsed.ok) errors.push(`labeler: ${parsed.message}`);
        else if (parsed.spec.model !== undefined) {
          const variable = MODEL_VARIABLES[parsed.spec.client];
          errors.push(
            `labeler: "${text}" names a model; a model is set by environment variable${variable ? `, ${variable} for ${parsed.spec.client}` : ''}`,
          );
        }
      }
      settings.labeler = list as string[];
    }
  }
  if (threshold !== undefined) {
    if (!isRecord(threshold)) errors.push(`threshold: a mapping of ${Object.keys(THRESHOLDS).join(', ')}`);
    else {
      settings.threshold = {};
      for (const [key, number] of Object.entries(threshold)) {
        // Own keys only: constructor, toString and the other names every object inherits are not thresholds.
        const name = Object.hasOwn(THRESHOLDS, key) ? THRESHOLDS[key as keyof typeof THRESHOLDS] : undefined;
        if (name === undefined) {
          errors.push(
            `threshold: ${key} is not a threshold; the thresholds are ${Object.keys(THRESHOLDS).join(', ')}`,
          );
        } else if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > 1) {
          errors.push(`threshold: ${key} is a number from 0 to 1`);
        } else settings.threshold[name] = number;
      }
    }
  }
  if (ledger !== undefined) {
    if (typeof ledger === 'string' && ledger.trim() !== '') settings.ledger = ledger.trim();
    else errors.push('ledger: the path of the ledger file');
  }
  if (errors.length > 0) return { ok: false, errors };
  settings.keys = ['labels', 'labeler', 'threshold', 'ledger'].filter((key) => value[key] !== undefined);
  return { ok: true, settings };
}

/** Reads the pointer settings of the estate at `root`. No file is no settings. */
export async function readPointerSettings(root: string): Promise<SettingsResult> {
  let text: string;
  try {
    text = await readFile(join(root, SETTINGS_FILE), 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { ok: true, settings: { keys: [] } };
    return {
      ok: false,
      errors: [`cannot read ${SETTINGS_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`],
    };
  }
  let value: unknown;
  try {
    value = parseYaml(text);
  } catch (cause) {
    return {
      ok: false,
      errors: [`not YAML: ${cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)}`],
    };
  }
  return parsePointerSettings(value);
}

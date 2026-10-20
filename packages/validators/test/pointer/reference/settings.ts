import { parse } from 'yaml';
import type { SettingsApi } from '../../../src/ladders/pointer/sut/port';

/**
 * The settings file of docs/estate-pointer-reader.md, section 1: a `threshold` mapping whose keys are
 * `labeler`, `pass_at`, `fail_at` and `margin_cut`, each a number from 0 to 1, bounds included.
 */
const KEYS = ['labeler', 'pass_at', 'fail_at', 'margin_cut'] as const;

/** The settings reader; `upper` is the largest threshold it accepts (1 in the rule, 2 in planted bug 20). */
export function makeSettings(upper = 1): SettingsApi {
  return {
    parse(text) {
      let value: unknown;
      try {
        value = parse(text);
      } catch (cause) {
        return {
          ok: false,
          errors: [cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause)],
        };
      }
      const thresholds: Record<string, number> = {};
      const errors: string[] = [];
      const given = (value as { threshold?: unknown } | null)?.threshold;
      if (given !== undefined) {
        if (given === null || typeof given !== 'object' || Array.isArray(given))
          errors.push(`threshold: a mapping of ${KEYS.join(', ')}`);
        else {
          for (const [key, number] of Object.entries(given)) {
            if (!(KEYS as readonly string[]).includes(key))
              errors.push(`threshold: ${key} is not a threshold; the thresholds are ${KEYS.join(', ')}`);
            else if (typeof number !== 'number' || !Number.isFinite(number) || number < 0 || number > upper)
              errors.push(`threshold: ${key} is a number from 0 to 1`);
            else thresholds[key] = number;
          }
        }
      }
      return errors.length > 0 ? { ok: false, errors } : { ok: true, thresholds };
    },
  };
}

export const referenceSettings: SettingsApi = makeSettings();

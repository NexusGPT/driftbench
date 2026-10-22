import { parse } from 'yaml';
import type { SettingsApi, SettingsIssue } from '../../../src/ladders/pointer/sut/port';
import { bugsC } from './bugs-c';

/**
 * The settings file of docs/estate-pointer-reader.md, section 1: a `threshold` mapping whose keys are
 * `labeler`, `pass_at`, `fail_at` and `margin_cut`, each a number from 0 to 1, bounds included.
 */
const KEYS = ['labeler', 'pass_at', 'fail_at', 'margin_cut'] as const;

const TABLE: Record<string, number> = { labeler: 1, pass_at: 1, fail_at: 1, margin_cut: 1 };

/**
 * The settings reader; `upper` is the largest threshold it accepts (1 in the rule, 2 in planted bug 20), and
 * `inherited` looks the key up in a table, so a name every object inherits is taken for a threshold (bug 22).
 */
export function makeSettings(upper = 1, inherited = false): SettingsApi {
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
      const issues: SettingsIssue[] = [];
      const given = (value as { threshold?: unknown } | null)?.threshold;
      if (given !== undefined) {
        if (given === null || typeof given !== 'object' || Array.isArray(given)) {
          errors.push(`threshold: a mapping of ${KEYS.join(', ')}`);
          issues.push({ code: 'settings-threshold-not-a-mapping', key: 'threshold', reason: 'not-a-mapping' });
        } else {
          for (const [key, number] of Object.entries(given)) {
            const known = inherited ? TABLE[key] !== undefined : (KEYS as readonly string[]).includes(key);
            // Planted bug of lane bugs C: no finite check, so a YAML .nan passes both bounds.
            const finite = Number.isFinite(number) || bugsC.has('nan-threshold');
            if (!known) {
              errors.push(`threshold: ${key} is not a threshold; the thresholds are ${KEYS.join(', ')}`);
              issues.push({ code: 'threshold-unknown-key', key, reason: 'not-a-threshold' });
            } else if (typeof number !== 'number' || !finite || number < 0 || number > upper) {
              errors.push(`threshold: ${key} is a number from 0 to 1`);
              const reason =
                typeof number !== 'number'
                  ? 'not-a-number'
                  : Number.isFinite(number)
                    ? 'out-of-range'
                    : 'not-finite';
              issues.push({ code: `threshold-${reason}`, key, reason });
            } else thresholds[key] = number;
          }
        }
      }
      return errors.length > 0 ? { ok: false, errors, issues } : { ok: true, thresholds };
    },
  };
}

export const referenceSettings: SettingsApi = makeSettings();

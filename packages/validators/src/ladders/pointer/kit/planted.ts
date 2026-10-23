import { ItemFailure } from '../../../failure';
import { type ItemContext, type Outcome, pass } from '../bank/types';

/**
 * A planted unit: the text the cutter must give as one unit, and, where the item checks them, its container, its
 * heading path, its YAML path and whether it is opaque. The text is a slice of the planted file, so its span is known
 * by construction.
 */
export type PlantedUnit = {
  text: string;
  container?: string;
  path?: string[];
  yamlPath?: string[];
  opaque?: boolean;
};

const same = (a: readonly string[] | undefined, b: readonly string[]) =>
  a !== undefined && a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Cuts the file and requires its units to be exactly the planted ones, in order, on every field a planted unit
 * names. A failure names the rule, the file and what the cutter gave; the planted units stay in a field of their own
 * that the message does not print (docs/validators.md section 12, "What a failure message says").
 */
export async function plantedCut(
  ctx: ItemContext,
  rule: string,
  text: string,
  planted: readonly PlantedUnit[],
): Promise<Outcome> {
  const got = await ctx.sut.cut({ path: 'doc.md', text });
  const ok =
    got.units.length === planted.length &&
    planted.every((want, i) => {
      const unit = got.units[i];
      return (
        unit !== undefined &&
        unit.text === want.text &&
        text.slice(unit.start, unit.end) === unit.text &&
        (want.container === undefined || unit.container === want.container) &&
        (want.path === undefined || same(unit.path, want.path)) &&
        (want.yamlPath === undefined || same(unit.yamlPath, want.yamlPath)) &&
        (want.opaque === undefined || unit.opaque === want.opaque)
      );
    });
  if (!ok)
    throw new ItemFailure({
      item: ctx.id,
      rule,
      input: text,
      got: got.units.map((unit) => ({
        container: unit.container,
        text: unit.text,
        path: unit.path,
        ...(unit.yamlPath ? { yamlPath: unit.yamlPath } : {}),
        opaque: unit.opaque,
      })),
      expected: planted,
    });
  return pass(`${planted.length} units as planted`);
}

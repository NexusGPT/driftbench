import { loadEstateMap } from '@agent-nexus/driftbench-estate';
import { describe, expect, it, vi } from 'vitest';
import { fixtureSuite } from '../../src/ladders/estate/bank/fixture-suite';
import { type Cell, equivalent } from '../../src/ladders/estate/bank/kill';

vi.setConfig({ testTimeout: 300_000 });

const del: Cell = { kind: 'tool', index: 0, op: 'delete', tier: 2 };
const DECLARED_BASH = 'tool.invoice-reconcile.declared-bash';
const DECLARED_EDIT = 'tool.invoice-reconcile.declared-edit';

async function fixtureMap() {
  const suite = await fixtureSuite();
  const map = await loadEstateMap(suite.map);
  if (!map.ok) throw new Error('the fixture map does not load');
  return map.map;
}

describe('kill.fake: a declared tool the settings already allow is an equivalent mutant, read from the map', () => {
  it('exempts the delete of a declared tool that a settings allow rule covers', async () => {
    const map = await fixtureMap();
    // The skill declares Bash(python3 *) (the quote of the atom; its rule field keeps the tool alone) and the settings
    // allow Bash(python3 *): the deletion changes nothing a run sees.
    expect(equivalent(del, DECLARED_BASH, map)).toMatch(/settings allow/);
  });

  it('still demands the kill of a declared tool that no settings rule covers', async () => {
    const map = await fixtureMap();
    // Edit is granted by the skill alone: the settings allow no Edit.
    expect(equivalent(del, DECLARED_EDIT, map)).toBeUndefined();
  });

  it('demands the kill again when the settings rule that covered the tool is gone from the map', async () => {
    const map = await fixtureMap();
    const without = {
      ...map,
      atoms: map.atoms.filter((atom) => atom.id !== 'tool.settings.allow-bash-python3'),
    };
    expect(equivalent(del, DECLARED_BASH, without)).toBeUndefined();
  });

  it('does not exempt a settings rule itself, a deny rule, or an invert', async () => {
    const map = await fixtureMap();
    expect(equivalent(del, 'tool.settings.allow-bash-python3', map)).toBeUndefined();
    expect(equivalent(del, 'tool.settings.deny-webfetch', map)).toBeUndefined();
    expect(equivalent({ ...del, op: 'invert' }, DECLARED_BASH, map)).toBeUndefined();
  });

  it('exempts a declared tool covered by a broader allow rule of the same tool, and not one covered by a narrower', async () => {
    const map = await fixtureMap();
    const bash = map.atoms.find((atom) => atom.id === DECLARED_BASH);
    const allow = map.atoms.find((atom) => atom.id === 'tool.settings.allow-bash-python3');
    if (!bash || !allow) throw new Error('the fixture lacks the tools of this test');
    const withAllow = (rule: string) => ({
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === allow.id ? { ...atom, fields: { ...atom.fields, rule } } : atom,
      ),
    });
    expect(equivalent(del, DECLARED_BASH, withAllow('Bash'))).toMatch(/settings allow/);
    expect(equivalent(del, DECLARED_BASH, withAllow('Bash(python3 scripts/*)'))).toBeUndefined();
    // A declared tool with no pattern grants the whole tool: an allow rule on a pattern does not cover it.
    const bare = {
      ...map,
      atoms: map.atoms.map((atom) =>
        atom.id === DECLARED_BASH ? { ...atom, provenance: { ...atom.provenance, quote: 'Bash' } } : atom,
      ),
    };
    expect(equivalent(del, DECLARED_BASH, bare)).toBeUndefined();
    expect(equivalent(del, DECLARED_BASH, withAllow('Edit'))).toBeUndefined();
  });

  // Claude Code, "Configure permissions", wildcard patterns: `*` matches any sequence of characters; a trailing ` *`
  // (a space, then the only wildcard) also matches the bare command; `Bash(ls *)` does not match `lsof`; the `:*`
  // suffix is equivalent to a trailing ` *` (`Bash(ls:*)` is `Bash(ls *)`), and is recognised only at the end of
  // a pattern; a rule with no `*` matches the exact command. https://code.claude.com/docs/en/permissions
  describe('an allow rule exempts only the calls it certainly covers', () => {
    const covered = async (allow: string, declared: string) => {
      const map = await fixtureMap();
      const changed = {
        ...map,
        atoms: map.atoms.map((atom) =>
          atom.id === 'tool.settings.allow-bash-python3'
            ? { ...atom, fields: { ...atom.fields, rule: allow } }
            : atom.id === DECLARED_BASH
              ? { ...atom, provenance: { ...atom.provenance, quote: declared } }
              : atom,
        ),
      };
      return equivalent(del, DECLARED_BASH, changed) !== undefined;
    };

    it.each([
      ['Bash(python3 *)', 'Bash(python3 *)'],
      ['Bash(python3 *)', 'Bash(python3 -m pip *)'],
      ['Bash(python3 *)', 'Bash(python3)'],
      ['Bash(python3:*)', 'Bash(python3 *)'],
      ['Bash(python3 *)', 'Bash(python3:*)'],
      ['Bash(git push origin main)', 'Bash(git push origin main)'],
      ['Bash', 'Bash(anything *)'],
    ])('exempts %s declared as %s', async (allow, declared) => {
      expect(await covered(allow, declared)).toBe(true);
    });

    it.each([
      // An allow rule with no `*` matches the exact command only.
      ['Bash(python3)', 'Bash(python3 -m pip *)'],
      ['Bash(ls)', 'Bash(ls -la *)'],
      // A `*` that is not the trailing one: the text around it is matched as written.
      ['Bash(git * main)', 'Bash(git * main --force)'],
      // The `:*` suffix is a trailing ` *`: it needs the space, so `python` does not cover `python3`.
      ['Bash(python:*)', 'Bash(python3 *)'],
      ['Bash(python *)', 'Bash(python3 *)'],
      // A star with no space before it matches more commands than the declared prefix says, and the declared
      // pattern may match commands the rule does not.
      ['Bash(python3 *)', 'Bash(python3*)'],
      // A declared tool with no pattern grants the whole tool.
      ['Bash(python3 *)', 'Bash'],
      // Another tool.
      ['Edit', 'Bash(python3 *)'],
    ])('still requires the kill of %s declared as %s', async (allow, declared) => {
      expect(await covered(allow, declared)).toBe(false);
    });
  });
});

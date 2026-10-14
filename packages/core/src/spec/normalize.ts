import { error, type Issue } from './issues';

/**
 * Turns authoring shorthand into the canonical spec shape before validation:
 * - a block's `user: "..."` or `burst: [...]` becomes `when: { user }` or `when: { burst }`;
 * - a spec's `ledger_seed` becomes `given.ledger`, `workspace_seed` becomes `given.world.workspace`;
 * - `kind` defaults to `conversation`.
 */
export function normalizeSpec(raw: unknown): { value: unknown; issues: Issue[] } {
  const issues: Issue[] = [];
  if (!isPlainObject(raw)) {
    issues.push(
      error('SPEC_NOT_OBJECT', '', 'a spec file must hold one mapping (an object) at the top level'),
    );
    return { value: raw, issues };
  }
  const spec: Record<string, unknown> = { ...raw };

  if (spec.kind === undefined) spec.kind = 'conversation';

  if ('ledger_seed' in spec) {
    const given = isPlainObject(spec.given) ? { ...spec.given } : {};
    if ('ledger' in given) {
      issues.push(
        error('SPEC_ALIAS_CONFLICT', 'ledger_seed', 'set `ledger_seed` or `given.ledger`, not both'),
      );
    } else {
      given.ledger = spec.ledger_seed;
    }
    spec.given = given;
    delete spec.ledger_seed;
  }

  if ('workspace_seed' in spec) {
    const given = isPlainObject(spec.given) ? { ...spec.given } : {};
    const world = isPlainObject(given.world) ? { ...given.world } : {};
    if ('workspace' in world) {
      issues.push(
        error(
          'SPEC_ALIAS_CONFLICT',
          'workspace_seed',
          'set `workspace_seed` or `given.world.workspace`, not both',
        ),
      );
    } else {
      const seed = spec.workspace_seed;
      world.workspace = typeof seed === 'string' ? { from: seed } : seed;
    }
    given.world = world;
    spec.given = given;
    delete spec.workspace_seed;
  }

  if (Array.isArray(spec.blocks)) {
    spec.blocks = spec.blocks.map((block, index) => normalizeBlock(block, `blocks.${index}`, issues));
  }

  return { value: spec, issues };
}

function normalizeBlock(block: unknown, path: string, issues: Issue[]): unknown {
  if (!isPlainObject(block)) return block;
  const out: Record<string, unknown> = { ...block };
  const hasUser = 'user' in out;
  const hasBurst = 'burst' in out;
  const hasWhen = 'when' in out;

  if (Number(hasUser) + Number(hasBurst) + Number(hasWhen) > 1) {
    const present = [...(hasUser ? ['user'] : []), ...(hasBurst ? ['burst'] : [])];
    issues.push(
      error(
        'BLOCK_STIMULUS_AMBIGUOUS',
        path,
        `a block takes exactly one of \`user\`, \`burst\` or \`when\`; this one has ${[...present, ...(hasWhen ? ['when'] : [])].join(' and ')}`,
      ),
    );
    return out;
  }
  if (!hasUser && !hasBurst && !hasWhen) {
    issues.push(error('BLOCK_STIMULUS_MISSING', path, 'a block needs `user`, `burst` or `when`'));
    return out;
  }
  const key = hasUser ? 'user' : hasBurst ? 'burst' : undefined;
  if (key !== undefined) {
    out.when = { [key]: out[key] };
    delete out[key];
  }
  return out;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

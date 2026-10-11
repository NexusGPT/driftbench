import { createRequire } from 'node:module';

/**
 * The examples have no package.json of their own (the lockfile stays frozen), so this test borrows the
 * YAML parser that @driftbench/core already depends on, resolved from the core package folder.
 */
const fromCore = createRequire(new URL('../../../../packages/core/package.json', import.meta.url));
const yaml = fromCore('yaml') as { parse(text: string): unknown };

export function parseYaml(text: string): unknown {
  return yaml.parse(text);
}

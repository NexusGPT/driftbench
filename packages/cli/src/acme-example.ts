import { createRequire } from 'node:module';
import type * as AcmeExample from '@agent-nexus/driftbench-example-acme';

/**
 * The Acme Telecom example, as the command line reaches it: the package `examples/acme` of the repository,
 * loaded by name at run time. A checkout holds it, so `function:acme-sales`, `process:acme-ops` and the
 * pilot's control agent work there as before. An install of the CLI alone does not hold it, and those three
 * targets then have no adapter. The name is not a literal in the `import` below, so the build of this
 * package, and of any package that bundles this file, never pulls the example in.
 */
const PACKAGE = '@agent-nexus/driftbench-example-acme';

export type AcmeExamplePackage = typeof AcmeExample;

let loaded: Promise<AcmeExamplePackage | undefined> | undefined;

/** The Acme example package, or undefined when this install does not hold it. Loaded once. */
export function acmeExample(): Promise<AcmeExamplePackage | undefined> {
  loaded ??= loadAcmeExample((name) => import(name));
  return loaded;
}

/** Loads the example through `load`: undefined when the package is absent, the error of any other failure. */
export async function loadAcmeExample(
  load: (name: string) => Promise<unknown>,
): Promise<AcmeExamplePackage | undefined> {
  try {
    return (await load(PACKAGE)) as AcmeExamplePackage;
  } catch (cause) {
    if (isMissingPackage(cause)) return undefined;
    throw cause;
  }
}

/** The example, or an error that says where it lives. For callers that cannot go on without it. */
export async function requireAcmeExample(): Promise<AcmeExamplePackage> {
  const acme = await acmeExample();
  if (acme === undefined) {
    throw new Error(
      `the Acme example is not installed: ${PACKAGE} lives in examples/acme of the driftbench repository`,
    );
  }
  return acme;
}

/** True when the import failed because the example package itself is absent, not one of its own imports. */
function isMissingPackage(cause: unknown): boolean {
  if (!(cause instanceof Error)) return false;
  const code = (cause as Error & { code?: unknown }).code;
  const named = cause.message.includes(PACKAGE);
  return named && (code === 'ERR_MODULE_NOT_FOUND' || /cannot find|failed to resolve/i.test(cause.message));
}

/**
 * True when this install holds the Acme example: its package resolves from here. Answered without loading
 * it, so a message can say which targets this install reaches. `resolve` is the test's stand-in.
 */
export function acmeExampleInstalled(
  resolve: (name: string) => unknown = (name) => createRequire(import.meta.url).resolve(name),
): boolean {
  try {
    resolve(`${PACKAGE}/package.json`);
    return true;
  } catch {
    return false;
  }
}

/**
 * What a refusal says when a run names an Acme target and this install does not hold the example: that the
 * example is not part of the installed CLI, and where it lives.
 */
export const ACME_EXAMPLE_ABSENT =
  'The Acme example (function:acme-sales, function:acme, process:acme-ops and the pilot control function:acme-random) is not part of the installed CLI: it lives in the driftbench repository, in examples/acme. To run it, work from a checkout: git clone https://github.com/achammah/driftbench, pnpm install, then pnpm driftbench.';

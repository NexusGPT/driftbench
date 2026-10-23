import { runtimeProfile } from '@agent-nexus/driftbench-core';

/**
 * The rule for files a runtime loads into its context by itself, by the runtime's name in an estate map, or
 * undefined when the runtime has none. A test never expects a read of such a file: no call ever shows it. The
 * rule is the runtime profile's (`loadsItself`), so a new runtime brings its own with its profile.
 */
export function runtimeLoaded(runtime: string): ((path: string) => boolean) | undefined {
  return runtimeProfile(runtime)?.loadsItself;
}

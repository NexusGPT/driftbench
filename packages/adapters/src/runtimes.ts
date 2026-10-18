import { loadedByRuntime } from './claude-code/live/adapter';

/**
 * The rule for files a runtime loads into its context by itself, by the runtime's name in an estate map, or
 * undefined when the runtime has none. A test never expects a read of such a file: no call ever shows it.
 */
export function runtimeLoaded(runtime: string): ((path: string) => boolean) | undefined {
  return RUNTIME_LOADED[runtime];
}

const RUNTIME_LOADED: Readonly<Record<string, (path: string) => boolean>> = {
  'claude-code': loadedByRuntime,
};

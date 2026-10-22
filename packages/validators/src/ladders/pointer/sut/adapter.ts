import { type PointerSut, ReaderNotReachable } from './port';
import { realReader } from './reader';

/**
 * The binding of the pointer reader to the bank's port (`reader.ts`). When the checkout has no reader, every call
 * fails with ReaderNotReachable, so each item fails with a message that says so.
 *
 * `DRIFTBENCH_POINTER_SUT` names a module (an absolute path) whose default export is a PointerSut or a function
 * returning one. The bank's tests use it to run the items against a reference reader, in the same process and in
 * child processes. CI never sets it. A process that serves a reader pins it first (`pinSut`).
 */

const unreachable = (reason: string): PointerSut => {
  const fail = async (): Promise<never> => {
    throw new ReaderNotReachable(reason);
  };
  return { name: 'unreachable', cut: fail, scan: fail };
};

let pinned: string | undefined;

/**
 * Where the command line (`packages/cli/src/bin.ts`) keeps the value the variable had when the process started,
 * before any module that holds a reader loaded. A process that never calls `pinSut` (the runner itself) reads it
 * from here, so a reader that sets the variable when it loads does not change which reader the runner starts.
 */
const STARTED = Symbol.for('driftbench.pointer.sut');
const started = (): string | undefined =>
  (globalThis as Record<symbol, unknown>)[STARTED] as string | undefined;

/**
 * Pins the module the system under test is resolved from. A process that serves a reader (the process of an item,
 * the process that holds the reader, a sandboxed child) calls it before anything of the reader loads: it reads
 * `DRIFTBENCH_POINTER_SUT`, removes it from the environment and keeps the value. From then on `resolveSut` and
 * `sutModule` give the pinned value and ignore the variable, so a reader that sets it when it loads, or later, changes
 * nothing in this process or in a child that takes its module from `sutModule`.
 */
export function pinSut(): string {
  if (pinned === undefined) {
    pinned = process.env.DRIFTBENCH_POINTER_SUT ?? '';
    delete process.env.DRIFTBENCH_POINTER_SUT;
  }
  return pinned;
}

/** The module the system under test is resolved from: the pinned one, else the variable as it stands now. */
export function sutModule(): string {
  return pinned ?? started() ?? process.env.DRIFTBENCH_POINTER_SUT ?? '';
}

/** Resolves the system under test for this process. */
export async function resolveSut(): Promise<PointerSut> {
  const module = sutModule();
  if (module !== '') {
    const loaded = (await import(module)) as {
      default?: PointerSut | (() => PointerSut | Promise<PointerSut>);
    };
    const target = loaded.default;
    if (typeof target === 'function') return await target();
    if (target) return target;
    return unreachable(`${module} has no default export`);
  }
  return realReader();
}

/**
 * The pointer namespace of the reader, loaded once. The binding of the blind bank calls these exports and
 * nothing else; an operation without an export fails with the reason (`Unsupported`).
 */
export type Pointer = Record<string, any>;

let loaded: Promise<Pointer> | undefined;
let replaced: Pointer = {};

export async function pointerExports(): Promise<Pointer> {
  loaded ??= import(/* @vite-ignore */ '@agent-nexus/driftbench-estate')
    .then((mod) => (mod as { pointer: Pointer }).pointer)
    .catch((cause: unknown) => {
      loaded = undefined;
      throw cause;
    });
  const real = await loaded;
  return Object.keys(replaced).length === 0 ? real : { ...real, ...replaced };
}

/** Runs `run` with some reader exports replaced in memory: a planted-bug reader for the tests of the binding. */
export async function withReplacedExports<T>(patch: Pointer, run: () => Promise<T>): Promise<T> {
  const before = replaced;
  replaced = { ...before, ...patch };
  try {
    return await run();
  } finally {
    replaced = before;
  }
}

/** The reader has no call for this part of the operation; the reason is written in the message. */
export class Unsupported extends Error {
  constructor(operation: string, reason: string) {
    super(`unsupported: ${operation}: ${reason}`);
    this.name = 'Unsupported';
  }
}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = Record<string, any>;

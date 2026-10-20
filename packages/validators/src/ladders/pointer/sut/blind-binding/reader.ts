/**
 * The pointer namespace of the reader, loaded once. The binding of the blind bank calls these exports and
 * nothing else; an operation without an export fails with the reason (`Unsupported`).
 */
export type Pointer = Record<string, any>;

let loaded: Promise<Pointer> | undefined;

export function pointerExports(): Promise<Pointer> {
  loaded ??= import(/* @vite-ignore */ '@agent-nexus/driftbench-estate').then(
    (mod) => (mod as { pointer: Pointer }).pointer,
  );
  return loaded;
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

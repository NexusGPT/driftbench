/**
 * The heavy reader libraries (exceljs, mammoth, pdf-parse) load on first use, so importing this
 * package costs nothing for a run that opens no such file. A library that is not installed fails
 * with one sentence that names the package to install, never with a bare module resolution error.
 */

function isMissing(cause: unknown, name: string): boolean {
  if (!(cause instanceof Error)) return false;
  const code = (cause as { code?: unknown }).code;
  return (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') && cause.message.includes(name);
}

/** Runs `load` (a literal dynamic import) and turns "not installed" into a sentence a user can act on. */
export async function loadReaderLibrary<T>(name: string, kind: string, load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (cause) {
    if (!isMissing(cause, name)) throw cause;
    throw new Error(
      `the ${kind} reader needs the package ${name}, which is not installed. Install it next to driftbench: npm install ${name}`,
      { cause },
    );
  }
}

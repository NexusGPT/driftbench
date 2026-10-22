/**
 * Stable machine-readable codes for what the pointer reader refuses, drops or fails on. Each text the reader
 * writes (a refusal, a dropped note, a failed window, an atom refusal) has a record beside it with the same text
 * in `detail`, a `code` that never changes with the wording, and the identifiers the text names as fields. A
 * check reads the code and the fields, never the text.
 */

/**
 * One structured diagnostic. `unit` is the id of an atom's unit when the record comes from the atoms, and the
 * number of a unit inside its window (`"3"`) when it comes from the answer of a labeler; `window` is the window id.
 */
export type PointerDiagnostic = {
  /** Kebab-case, stable. */
  code: string;
  /** The text of the same diagnostic in the plain list beside the records. */
  detail: string;
  window?: string;
  unit?: string;
  /** The text the answer gave for the units of an entry (`"2-5"`). */
  units?: string;
  /** The unit at the other end of a label, or the atom a link names. */
  target?: string;
  /** The span kind, link kind or atom kind the diagnostic is about. */
  kind?: string;
  /** The clause of a span: the words the labeler copied, else `from-to`. */
  span?: string;
  set?: string;
  label?: string;
  path?: string;
  /** The labeler that gave the answer. */
  labeler?: string;
  /** The unit (or atom) an atom duplicates. */
  repeats?: string;
  /** The parent kind of a span kind that has to lie inside it. */
  parent?: string;
  /** The sum of a probability vector that is no vector. */
  sum?: number;
};

/** Drops the keys that hold no value, so a record has only the fields it fills. */
export function record(
  code: string,
  detail: string,
  fields: Partial<Omit<PointerDiagnostic, 'code' | 'detail'>> = {},
): PointerDiagnostic {
  const out: PointerDiagnostic = { code, detail };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) (out as Record<string, unknown>)[key] = value;
  }
  return out;
}

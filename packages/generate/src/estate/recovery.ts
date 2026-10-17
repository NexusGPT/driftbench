import type { EstateAtom } from './inputs';

export type RecoveryCall = { label: string; input: Record<string, unknown> };
export type RecoveryAction = {
  reread: string[];
  calls: RecoveryCall[];
  retry: boolean;
  /** A declared recovery target that has no executable path. */
  unpathed: string[];
};

/** Recovery comes from the map's typed declaration, never inferred from source wording. */
export function recoveryAction(atom: EstateAtom, atoms?: ReadonlyMap<string, EstateAtom>): RecoveryAction {
  const raw = atom.fields?.recovery;
  const declaration =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const strings = (value: unknown): string[] =>
    Array.isArray(value)
      ? [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim() !== ''))]
      : [];
  const calls = Array.isArray(declaration.calls)
    ? declaration.calls.filter((call): call is RecoveryCall => {
        if (typeof call !== 'object' || call === null) return false;
        const value = call as Record<string, unknown>;
        return (
          typeof value.label === 'string' &&
          value.label.trim() !== '' &&
          typeof value.input === 'object' &&
          value.input !== null &&
          !Array.isArray(value.input)
        );
      })
    : [];
  const reread = strings(declaration.reread);
  const sources = [
    atom,
    ...[...(atoms?.values() ?? [])].filter((candidate) => {
      const source = atom.provenance;
      const other = candidate.provenance;
      return (
        candidate.id !== atom.id &&
        source?.file !== undefined &&
        source.startLine !== undefined &&
        source.endLine !== undefined &&
        other?.file === source.file &&
        other.startLine === source.startLine &&
        other.endLine === source.endLine
      );
    }),
  ];
  for (const source of sources)
    for (const evidence of source.evidence) {
      if (evidence.type !== 'tool_called' || evidence.input === undefined) continue;
      if (evidence.label === 'Read') {
        const assertion = evidence.input.file_path ?? evidence.input.path;
        const value =
          typeof assertion === 'string'
            ? assertion
            : typeof assertion === 'object' && assertion !== null && !Array.isArray(assertion)
              ? ((assertion as Record<string, unknown>).equals ??
                (assertion as Record<string, unknown>).contains)
              : undefined;
        if (typeof value === 'string' && value.trim() !== '' && !reread.includes(value)) reread.push(value);
      } else if (
        !calls.some(
          (call) =>
            call.label === evidence.label && JSON.stringify(call.input) === JSON.stringify(evidence.input),
        )
      ) {
        calls.push({ label: evidence.label, input: evidence.input });
      }
    }
  return {
    reread,
    calls,
    retry: declaration.retry === true,
    unpathed: strings(declaration.unpathed),
  };
}

import { type Obj, pointerExports } from './reader';

/** `fingerprint`: the fingerprint of each unit text; equality is the oracle's business. */
export async function fingerprintOp(input: Obj): Promise<string[]> {
  const pointer = await pointerExports();
  return (input.units as Obj[]).map((unit) => pointer.fingerprint(String(unit.text)) as string);
}

/**
 * `ledger`: the scans in order. Each scan cuts nothing: its units arrive already cut and labelled, so they become
 * the units of a `Cut` (container, offsets, text, fingerprint) and go to `nextLedger`. An independent scan starts
 * from an empty ledger; any other carries the ledger of the scan before it.
 */
export async function ledgerOp(input: Obj): Promise<{ entries: Obj[] }[]> {
  const pointer = await pointerExports();
  const snapshots: { entries: Obj[] }[] = [];
  let previous: unknown;
  for (const scan of input.scans as Obj[]) {
    const files = (scan.files as Obj[]).map((file) => ({
      path: String(file.path),
      cut: {
        digest: '',
        units: (file.units as Obj[]).map((unit) => ({
          container: String(unit.container),
          start: Number(unit.hint?.start ?? 0),
          end: Number(unit.hint?.end ?? 0),
          text: String(unit.text),
          fp: pointer.fingerprint(String(unit.text)) as string,
          path: [] as string[],
        })),
      },
    }));
    const next = pointer.nextLedger(files, input.independent ? undefined : previous, String(scan.estateKey));
    previous = next.ledger;
    snapshots.push({
      entries: next.ledger.entries.map((entry: Obj) => ({
        id: entry.id,
        path: entry.path,
        quote: entry.quote,
        status: entry.status,
      })),
    });
  }
  return snapshots;
}

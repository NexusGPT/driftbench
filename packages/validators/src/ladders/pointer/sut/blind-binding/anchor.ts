import { type Obj, pointerExports, Unsupported } from './reader';

type Kind = 'new' | 'unchanged' | 'moved' | 'ambiguous' | 'changed' | 'split' | 'merged' | 'deleted';

const unitOf = (pointer: Obj, raw: Obj, offset: number) => ({
  container: String(raw.container),
  start: offset,
  end: offset + String(raw.text).length,
  text: String(raw.text),
  fp: pointer.fingerprint(String(raw.text)) as string,
  path: (raw.sectionPath ?? []) as string[],
});

/** One `FileCut` per path, the units in the order given. */
function filesOf(pointer: Obj, units: Obj[]) {
  const byPath = new Map<string, Obj[]>();
  for (const unit of units) byPath.set(String(unit.path), [...(byPath.get(String(unit.path)) ?? []), unit]);
  return [...byPath.entries()].map(([path, list]) => {
    let offset = 0;
    return {
      path,
      cut: {
        digest: '',
        units: list.map((raw) => {
          const unit = unitOf(pointer, raw, offset);
          offset = unit.end + 2;
          return unit;
        }),
      },
    };
  });
}

/**
 * `reanchor`: the old units become the ledger of the scan before (their own ids kept), the new units the scan
 * after. A merge also counts the tombstone of the second old unit as deleted; that count belongs to the merge. The reader fixes its ladder values (`LADDER`), so `settings` is not applied. The event of each selected
 * id is the one event kind the reader counted for the pair of scans; two kinds at once name no single event and
 * the call says so. The reader lists no candidates of an ambiguous match, so that call is unsupported.
 */
export async function reanchorOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  const before = input.before as Obj[];
  const estate = 'blind-reanchor';
  const first = pointer.nextLedger(filesOf(pointer, before), undefined, estate);
  const ids = new Map<string, string>();
  const seen = new Map<string, number>();
  const old = before.map((raw) => {
    const path = String(raw.path);
    const index = seen.get(path) ?? 0;
    seen.set(path, index + 1);
    return { raw, minted: first.ids.get(`${path}\0${index}`) as string };
  });
  for (const { raw, minted } of old) ids.set(minted, String(raw.id));
  const renamed = {
    ...first.ledger,
    entries: first.ledger.entries.map((entry: Obj) => ({ ...entry, id: ids.get(entry.id) ?? entry.id })),
  };
  const next = pointer.nextLedger(filesOf(pointer, input.after as Obj[]), renamed, estate);
  const counted = (Object.entries(next.events) as [Kind, number][]).filter(
    ([kind, n]) => n > 0 && kind !== 'new',
  );
  // A merge keeps one id; the reader tombstones the other old unit and counts it as deleted beside the merge.
  const joined = counted.some(([kind]) => kind === 'merged' || kind === 'split');
  const kinds = joined ? counted.filter(([kind]) => kind !== 'deleted') : counted;
  const selected = input.selectIds as string[];
  const entryOf = (id: string): Obj | undefined => next.ledger.entries.find((entry: Obj) => entry.id === id);
  if (kinds.length !== 1)
    throw new Unsupported(
      'reanchor',
      `the reader counted ${kinds.length} kinds of event for one pair of scans`,
    );
  const event = (kinds[0] as [Kind, number])[0];
  if (input.observation === 'lineage-edges') {
    if (event === 'split' || event === 'merged') {
      const live = next.ledger.entries.filter((entry: Obj) => entry.status === 'live');
      return [{ event, sourceIds: selected, targetTexts: live.map((entry: Obj) => entry.quote) }];
    }
    return selected.map((id) => ({
      event: entryOf(id)?.status === 'deleted' ? 'deleted' : event,
      sourceIds: [id],
      targetTexts: entryOf(id)?.status === 'live' ? [entryOf(id)?.quote] : [],
    }));
  }
  if (event === 'ambiguous')
    throw new Unsupported('reanchor', 'the reader keeps the id on the first match and lists no candidates');
  return selected.map((id) => {
    const entry = entryOf(id);
    return {
      id,
      path: entry?.path,
      quote: entry?.quote,
      status: entry?.status,
      lineage: [{ event: entry?.status === 'deleted' ? 'deleted' : event }],
      candidates: [],
    };
  });
}

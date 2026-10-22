import { Problem } from '../bank/types';
import type { LedgerEntry, LedgerView, PointerSut, ScanRequest, ScanResult, SourceFile } from '../sut/port';
import { type Block, type Composed, type ComposeOptions, compose, truthOf } from './compose';
import { norm } from './norm';
import { compareCut } from './oracle';

/** One file of a fictional estate, as blocks. */
export type EstateFile = { path: string; blocks: Block[]; options?: ComposeOptions };

export type Built = { files: SourceFile[]; docs: Map<string, Composed> };

export function build(estate: readonly EstateFile[]): Built {
  const docs = new Map<string, Composed>();
  const files: SourceFile[] = [];
  for (const file of estate) {
    const doc = compose(file.blocks, file.options);
    docs.set(file.path, doc);
    files.push({ path: file.path, text: doc.text });
  }
  return { files, docs };
}

const PROSE_CONTAINERS = new Set(['sentence', 'list_item', 'table_cell', 'block_quote', 'heading']);

/**
 * The scan must have produced what the files hold. For every file the composer wrote, each prose unit it planted
 * (sentence, list item, table cell, quote paragraph, heading) must be a live entry of that path with the same
 * text in the fingerprint normal form. A reader that returns nothing, one unit per file or one unit per line
 * fails here, whatever the item was about. A file the composer did not write is not checked.
 */
export function checkPlanted(
  files: readonly SourceFile[],
  result: Pick<ScanResult, 'ok' | 'ledger' | 'error'>,
): void {
  if (!result.ok || !result.ledger) throw new Problem(`the scan failed: ${result.error ?? 'no ledger'}`);
  const live = liveOf(result.ledger);
  for (const file of files) {
    const truth = truthOf(file.text);
    if (!truth) continue;
    const have = new Map<string, number>();
    for (const e of live) {
      if (e.path !== file.path) continue;
      const key = norm(e.quote, e.container);
      have.set(key, (have.get(key) ?? 0) + 1);
    }
    for (const unit of truth) {
      if (!PROSE_CONTAINERS.has(unit.container)) continue;
      const key = norm(unit.text, unit.container);
      const count = have.get(key) ?? 0;
      if (count === 0) {
        throw new Problem(
          `positive witness: the scan of ${file.path} holds no entry for the planted ${unit.container} ${JSON.stringify(unit.text.slice(0, 40))}`,
        );
      }
      have.set(key, count - 1);
    }
  }
}

const controls = new WeakMap<PointerSut, Promise<string | undefined>>();

/**
 * The control cut: a heading, a paragraph of three sentences on one line and a list of two items, in a fixed text.
 * A scan item is only worth reading when the reader cuts these basics. Cached per reader.
 */
export function cutControl(sut: PointerSut): Promise<string | undefined> {
  let known = controls.get(sut);
  if (!known) {
    known = (async () => {
      const doc = compose([
        { kind: 'heading', level: 1, text: 'Control notes' },
        {
          kind: 'paragraph',
          sentences: [
            'Fold the blue towels before noon.',
            'Wipe the long counter after every sale.',
            'Count the loose coins at closing time.',
          ],
        },
        {
          kind: 'list',
          items: [{ text: 'Check the lamp near the door.' }, { text: 'Lock the side gate last.' }],
        },
      ]);
      const got = await sut.cut({ path: 'control.md', text: doc.text });
      return compareCut(doc.text, got, doc.units);
    })();
    controls.set(sut, known);
  }
  return known;
}

/** The checks every scan result must pass before an item reads it: the control cut and the planted units. */
export async function verifyScan(
  sut: PointerSut,
  files: readonly SourceFile[],
  result: Pick<ScanResult, 'ok' | 'ledger' | 'error'>,
): Promise<void> {
  const control = await cutControl(sut);
  if (control) throw new Problem(`positive witness: the reader does not cut the control file: ${control}`);
  checkPlanted(files, result);
}

/** Runs a scan and fails with the reader's own message when it does not succeed. */
export async function scanOk(
  sut: PointerSut,
  request: ScanRequest,
): Promise<ScanResult & { ledger: LedgerView }> {
  const result = await sut.scan(request);
  if (!result.ok || !result.ledger) throw new Problem(`the scan failed: ${result.error ?? 'no ledger'}`);
  await verifyScan(sut, request.files, result);
  return result as ScanResult & { ledger: LedgerView };
}

export const liveOf = (ledger: LedgerView): LedgerEntry[] =>
  ledger.entries.filter((e) => e.status === 'live');

/** Only the event the reader reports for this id; an absent observation cannot earn credit. */
export function eventNow(result: Pick<ScanResult, 'events'>, entry: LedgerEntry): string {
  const event = result.events?.[entry.id];
  if (event === undefined)
    throw new Problem(`the reader does not expose an event for ${entry.id}`, 'missing-observation');
  return event;
}

/** The live entry whose quote is the text, in the normal form. */
export function liveByText(ledger: LedgerView, text: string, container?: string): LedgerEntry | undefined {
  return liveOf(ledger).find(
    (e) => norm(e.quote, container ?? e.container) === norm(text, container ?? e.container),
  );
}

/** Any entry (live or not) whose quote is the text. */
export function anyByText(ledger: LedgerView, text: string): LedgerEntry | undefined {
  return ledger.entries.find((e) => norm(e.quote, e.container) === norm(text, e.container));
}

export function byId(ledger: LedgerView, id: string): LedgerEntry | undefined {
  return ledger.entries.find((e) => e.id === id);
}

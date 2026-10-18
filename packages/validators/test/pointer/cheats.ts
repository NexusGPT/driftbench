import { createHash } from 'node:crypto';
import type {
  CutResult,
  CutUnit,
  LedgerEntry,
  LedgerView,
  Link,
  LinksApi,
  PointerSut,
  ScanRequest,
  ScanResult,
  SourceFile,
  StackApi,
} from '../../src/ladders/pointer/sut/port';

/**
 * Cheating readers for the bank's own tests (docs/validators.md section 12.7, the cheater check). Each one does as
 * little real work as it can. The bank must fail them on every item except a few named empty-input items.
 */

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const view = (entries: LedgerEntry[]): LedgerView => ({
  raw: JSON.stringify(entries.map((e) => e.id)),
  entries,
});
const okScan = (ledger: LedgerView, extra: Partial<ScanResult> = {}): ScanResult => ({
  ok: true,
  warnings: [],
  ledger,
  atoms: [],
  diagnostics: [],
  cassette: '',
  events: {},
  eventCounts: {},
  windows: 0,
  calls: 0,
  ...extra,
});

const lenientLinks: LinksApi = {
  create: (_l, owner, span, relation, createdBy = 'test') =>
    ({ owner, span, fp: '', relation, createdBy, accepted: true }) as Link,
  classify: (_p, _c, links) => links.map(() => 'ok' as const),
  clear: (link) => ({ ok: true, link }),
  verify: (link) => link,
  coverage: () => ({ uncovered: [], covered: 0 }),
  blast: () => ({ rerun: [], advisory: [] }),
};

const lenientStack: StackApi = {
  run: async () => ({ ok: true, units: [], system1Calls: 0, system2Calls: [] }),
};

/** Nothing is cut, nothing is labelled, every scan succeeds with an empty ledger. */
export const emptyCheat: PointerSut = {
  name: 'cheat-empty',
  cut: async (): Promise<CutResult> => ({ units: [], cutDigest: '' }),
  scan: async () => okScan(view([])),
  links: lenientLinks,
  stack: lenientStack,
};

/** Every call is refused. */
export const refuseCheat: PointerSut = {
  name: 'cheat-refuse',
  cut: async () => {
    throw new Error('refused');
  },
  scan: async (): Promise<ScanResult> => ({
    ok: false,
    error: 'refused',
    warnings: [],
    atoms: [],
    diagnostics: [],
  }),
  links: {
    create: () => {
      throw new Error('refused');
    },
    classify: () => {
      throw new Error('refused');
    },
    clear: () => ({ ok: false, error: 'refused' }),
    verify: () => {
      throw new Error('refused');
    },
    coverage: () => {
      throw new Error('refused');
    },
    blast: () => {
      throw new Error('refused');
    },
  },
  stack: { run: async () => ({ ok: false, error: 'refused', units: [], system1Calls: 0, system2Calls: [] }) },
};

function unitsBy(file: SourceFile, mode: 'file' | 'line'): CutUnit[] {
  if (mode === 'file') {
    return file.text.trim() === ''
      ? []
      : [
          {
            container: 'sentence',
            start: 0,
            end: file.text.length,
            text: file.text,
            fp: sha(file.text),
            path: [],
            opaque: false,
          },
        ];
  }
  const units: CutUnit[] = [];
  let at = 0;
  for (const line of file.text.split('\n')) {
    if (line.trim() !== '')
      units.push({
        container: 'sentence',
        start: at,
        end: at + line.length,
        text: line,
        fp: sha(line),
        path: [],
        opaque: false,
      });
    at += line.length + 1;
  }
  return units;
}

function cheatOf(name: string, mode: 'file' | 'line'): PointerSut {
  return {
    name,
    cut: async (file): Promise<CutResult> => {
      const units = unitsBy(file, mode);
      return { units, cutDigest: sha(units.map((u) => u.fp).join('|')) };
    },
    scan: async (request: ScanRequest) => {
      const entries: LedgerEntry[] = [];
      const seen = new Map<string, number>();
      for (const file of request.files) {
        for (const unit of unitsBy(file, mode)) {
          const n = (seen.get(unit.fp) ?? 0) + 1;
          seen.set(unit.fp, n);
          entries.push({
            id: sha(`${file.path}|${unit.fp}|${n}`).slice(0, 10).toUpperCase(),
            path: file.path,
            sectionPath: [],
            container: 'sentence',
            fp: unit.fp,
            ctxFp: '',
            quote: unit.text,
            prefix: '',
            suffix: '',
            hint: { start: unit.start, end: unit.end },
            status: 'live',
            labels: {},
            lineage: [],
            twinOf: null,
          });
        }
      }
      return okScan(view(entries));
    },
    links: lenientLinks,
    stack: lenientStack,
  };
}

/** One unit per file. */
export const fileCheat = cheatOf('cheat-file', 'file');
/** One unit per non-blank line, with an id made from the line. */
export const lineCheat = cheatOf('cheat-line', 'line');

export const CHEATS: PointerSut[] = [emptyCheat, refuseCheat, fileCheat, lineCheat];

/** For child processes: DRIFTBENCH_POINTER_SUT names this module and DRIFTBENCH_CHEAT the cheat. */
export default function cheatFromEnv(): PointerSut {
  const name = process.env.DRIFTBENCH_CHEAT ?? '';
  const found = CHEATS.find((c) => c.name === name);
  if (!found) throw new Error(`no cheat named ${name}`);
  return found;
}

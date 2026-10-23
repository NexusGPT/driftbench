import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  AGENT_RULES_SET,
  Cassette,
  denseOpinions,
  type Labeler,
  LabelerError,
  parseLabelSets,
  pointerScan,
  type Recorded,
  readSpansOf,
  singleLabelling,
} from '../../src/pointer';

/**
 * The answers climb2 recorded on the final stack (wip/sonnet-estate-climb2-regen7, 2f1d0f8b7) for the windows that hold
 * the units the lead named: R3, R14, the MEMORY session-start unit, the weekly-report templates unit, the parcel-claims
 * and shipment-tracker claim units, and the supplier unit of reader-cases. The fixture files are lines of those
 * cassettes, copied byte for byte: only the agent-rules answers of system 2 for those windows were kept, never edited.
 * The requests of this branch differ from the recorded ones (the anchors), so the answers are served by window and run,
 * in the order the scan asks, not by request key.
 */
const FIXTURES = new URL('./fixtures/regen7/', import.meta.url);
/** The estate files as the regen7 record read them, copied from 2f1d0f8b7: the answers belong to these texts. */
const ESTATES = new URL('./fixtures/regen7/files/', import.meta.url);

type Entry = { readable: Record<string, string>; answer: Recorded };

/** The set hash of the agent-rules set the regen7 record asked with. */
const REGEN7_SET = 'a730a6628e5840db';

const shipped = parseLabelSets(AGENT_RULES_SET);
const sets = shipped.ok ? shipped.sets.slice(0, 1) : [];

/** A system 2 labeler that answers each window's n-th ask with the n-th recorded run of the shipped set. */
async function recorded(estate: string): Promise<Labeler> {
  const text = await readFile(new URL(`${estate}.cassette.jsonl`, FIXTURES), 'utf8');
  const runs = new Map<string, Map<number, Recorded>>();
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    const entry = JSON.parse(line) as Entry;
    // The cassette holds the answers of two set versions; regen7 asked with the later one (its ledger labels the
    // window units with it). This branch's set text differs again, so the answers are read by window and run.
    if (entry.readable.setHash !== REGEN7_SET) continue;
    const window = entry.readable.window as string;
    const byRun = runs.get(window) ?? new Map<number, Recorded>();
    byRun.set(Number(entry.readable.run), entry.answer);
    runs.set(window, byRun);
  }
  const asked = new Map<string, number>();
  return {
    id: 'recorded',
    cls: 'system2',
    family: 'recorded',
    model: 'claude-haiku-5-5',
    runs: 5,
    settings: {},
    maxUnits: (_set, wanted) => wanted,
    render: (set, window) => ({ labeler: 'recorded', body: { set: set.set, window: window.id } }),
    opinions: denseOpinions,
    async call(_wire, _set, window, attempt = 1) {
      const n = (asked.get(window.id) ?? 0) + (attempt === 1 ? 1 : 0);
      asked.set(window.id, n);
      const answer = runs.get(window.id)?.get(n);
      if (!answer) throw new LabelerError(`no recorded run ${n} for ${window.id}`);
      return answer;
    },
  };
}

async function replay(estate: string, paths: string[]) {
  const files = await Promise.all(
    paths.map(async (path) => ({
      path,
      text: await readFile(new URL(`${estate}/${path}`, ESTATES), 'utf8'),
    })),
  );
  const result = await pointerScan({
    files,
    sets,
    labelling: singleLabelling(await recorded(estate)),
    cassette: new Cassette(),
    mode: 'record',
    read: readSpansOf(files),
    jobs: 1,
  });
  const labelOf = (path: string, starts: string) => {
    const unit = result.labelled.find((item) => item.path === path && item.unit.text.includes(starts));
    return unit?.label;
  };
  const idOf = (path: string, starts: string) =>
    result.ledger.entries.find((entry) => entry.path === path && entry.quote.includes(starts))?.id;
  return { result, labelOf, idOf };
}

describe('the recorded regen7 answers, replayed on this branch', () => {
  it('fixture: R3, R14 and the MEMORY unit keep their gates; the weekly-report gate with no act span is reported', async () => {
    const weekly = '.claude/skills/weekly-report/SKILL.md';
    const { result, labelOf, idOf } = await replay('fixture', ['CLAUDE.md', weekly]);
    // R3: runs 1-3 slip; runs 6 and 7 replace two of them, and extra voices 11 and 13 leave gate-same ahead.
    // Keep the original gate-same-or-unstable assertion: an unlabeled outcome must never be silent.
    const r3 = idOf('CLAUDE.md', 'Read a file before you edit it');
    const r3Label = labelOf('CLAUDE.md', 'Read a file before you edit it');
    expect(r3Label).not.toBe('rule');
    if (r3Label === undefined) expect(result.unstable.map((entry) => entry.unit)).toContain(r3);
    else expect(r3Label).toBe('gate-same');
    expect(labelOf('CLAUDE.md', 'Do not commit to git until you have read')).toBe('gate-command');
    expect(labelOf('CLAUDE.md', 'at the start of every session')).toBe('gate');
    // Five runs say gate and none places the act in the unit (three give none, two the next unit's words). It is not
    // quietly turned into a reference: the unit is unlabeled and listed under span-missing.
    const templates = idOf(weekly, 'Read `templates/report.md`');
    expect(labelOf(weekly, 'Read `templates/report.md`')).toBeUndefined();
    expect(result.spanless).toEqual([
      expect.objectContaining({ unit: templates, label: 'gate', kinds: ['governed-action'], filled: false }),
    ]);
  });

  it('reader-cases: the supplier unit, one run from another reading, is unlabeled and listed as unstable', async () => {
    const { result, labelOf, idOf } = await replay('reader-cases', [
      'CLAUDE.md',
      '.claude/skills/parcel-claims/SKILL.md',
      '.claude/skills/shipment-tracker/SKILL.md',
    ]);
    // gate 3, reference 2, description 2 over the seven recorded runs: close, and no recorded run is left to settle it.
    const supplier = idOf('CLAUDE.md', 'When a claim names a supplier');
    expect(labelOf('CLAUDE.md', 'When a claim names a supplier')).toBeUndefined();
    expect(result.unstable.filter((entry) => entry.unit === supplier)).toEqual([
      expect.objectContaining({ kinds: { gate: 3, 'no atom': 2, reference: 2 } }),
    ]);
    // Failing items the oracle keeps (the lead's rulings): the definition reads a gate, the recording reads otherwise.
    expect(labelOf('.claude/skills/shipment-tracker/SKILL.md', 'the claim follows `claim-rules.md`')).toBe(
      'reference',
    );
    expect(
      labelOf('.claude/skills/parcel-claims/SKILL.md', 'A claim follows `references/claim-rules.md`'),
    ).not.toBe('gate');
  });
});

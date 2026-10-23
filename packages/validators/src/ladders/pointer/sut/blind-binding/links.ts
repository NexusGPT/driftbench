import { type Obj, pointerExports } from './reader';

/**
 * `links` and `radius`: layer C. The bank's entries, links and sections are translated into the reader's own
 * vocabulary (a test is an owner, a transition is a lineage event) and its functions answer; nothing is decided here.
 */

/** The ladder events a bank transition can name; the others (context, heading) are edits the entry shows in its fields. */
const LADDER_EVENTS = new Set(['unchanged', 'moved', 'changed', 'split', 'merged', 'ambiguous', 'deleted']);

function ledgerEntry(entry: Obj): Obj {
  const event = typeof entry.transition === 'string' && LADDER_EVENTS.has(entry.transition);
  return {
    id: entry.id,
    path: entry.path ?? '',
    fp: entry.fp ?? '',
    ctxFp: entry.ctxFp ?? '',
    sectionPath: entry.sectionPath ?? [],
    status: entry.status,
    labels: entry.labels ?? {},
    ...(event ? { lineage: [{ event: entry.transition }] } : {}),
  };
}

function readerLink(link: Obj): Obj {
  const { test, ...rest } = link;
  return { owner: test, ...rest };
}

export async function linksOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  if (input.action === 'classify') {
    const links = (input.links as Obj[]).map(readerLink);
    const states = pointer.classifyLinks(
      null,
      { entries: (input.entries as Obj[]).map(ledgerEntry) },
      links,
    ) as string[];
    return {
      links: (input.links as Obj[]).map((link, at) => ({
        test: link.test,
        span: link.span,
        state: states[at],
      })),
    };
  }
  if (input.action === 'clear') {
    const link = input.link as Obj;
    const accept = input.accept as Obj;
    const cleared = pointer.clearLink(readerLink(link), String(accept.reason), { fp: accept.fp });
    if (!cleared.ok) throw new Error(String(cleared.error));
    return { span: cleared.link.span, fp: cleared.link.fp, reason: cleared.link.reason };
  }
  throw new Error(`no binding for the links action ${String(input.action)}`);
}

export async function radiusOp(input: Obj): Promise<unknown> {
  const pointer = await pointerExports();
  if (input.action === 'impact') {
    const radius = pointer.impactOf(
      (input.preciseLinks as Obj[]).map((link) => ({ owner: link.test, state: link.state })),
      (input.sectionLinks as Obj[]).map((link) => ({ owner: link.test, section: link.section })),
      input.editedSections,
    );
    return { suspectTests: radius.rerun, advisoryTests: radius.advisory };
  }
  if (input.action === 'coverage') {
    const entries = input.entries as Obj[];
    const mapped = new Set<string>();
    for (const entry of entries)
      for (const label of Object.values((entry.labels ?? {}) as Obj))
        if (label.atom !== null && label.atom !== undefined) mapped.add(String(label.label));
    const covered = pointer.linkCoverage(
      { entries: entries.map(ledgerEntry) },
      [...mapped],
      (input.links as Obj[]).map((link) => ({ ...readerLink(link), fp: '' })),
    );
    return { uncovered: covered.uncovered };
  }
  if (input.action === 'claim') {
    return { verifiedSpans: pointer.verifiedSpans(input.links) };
  }
  throw new Error(`no binding for the radius action ${String(input.action)}`);
}

import type { Proposal, Refusal } from '@agent-nexus/driftbench-generate';
import type { Item, Measure } from '../../ladder';
import { contractStatesRole } from './oracle';
import { INVENTORY_PATH, PROMPT_PATH, type Rendered, TOOLS_PATH } from './render';
import { diffFacts, type MapRun, mapFacts } from './run';
import { fold, forbidKey, type ProseAtom, quoteInSpan, type Truth } from './truth';

/**
 * The seven levels of the map validator (docs/validators.md section 2), each a ratio of two counts the
 * validator can list, each failing item pointing at one component from the fixed table below.
 */

/** The fixed table from a cause to the one component an item points at. */
export const MAP_COMPONENTS = {
  inventory: 'packages/generate/src/extract/prepass.ts',
  tools: 'packages/generate/src/extract/tools.ts',
  quote: 'packages/generate/src/extract/quote.ts',
  accept: 'packages/generate/src/extract/accept.ts',
  /** The section request: what each section asks and how it carries the sources (the extractor's chunker). */
  contract: 'packages/generate/src/extract/contract.ts',
  extract: 'packages/generate/src/extract/extract.ts',
  roles: 'packages/generate/src/extract/space.ts',
  renderer: 'packages/validators/src/ladders/map/render.ts',
} as const;

export const PROSE_RECALL = 0.9;
export const CONSTRAINT_RECALL = 0.9;

/** A run whose extractor refused its input: one item, and the level fails. */
function inputFailure(run: MapRun, level: string): Measure | undefined {
  if (run.result.ok) return undefined;
  const first = run.result.errors[0];
  return {
    value: 0,
    items: [
      {
        id: `${level}:input-refused`,
        component: MAP_COMPONENTS.renderer,
        detail: `the extractor refused the rendered input: ${first?.source} ${first?.code} ${first?.path} ${first?.message}`,
      },
    ],
  };
}

function proposalOf(run: MapRun): Proposal {
  if (!run.result.ok) throw new Error('no proposal');
  return run.result.proposal;
}

function show(text: string, width = 140): string {
  const folded = fold(text);
  return folded.length <= width ? folded : `${folded.slice(0, width - 3)}...`;
}

function valuesOf(
  proposal: Proposal,
): Map<string, { kind: string; values: Map<string, { source: string; quote: string }> }> {
  const out = new Map<string, { kind: string; values: Map<string, { source: string; quote: string }> }>();
  for (const dimension of proposal.dimensions) {
    out.set(dimension.id, {
      kind: dimension.kind,
      values: new Map(dimension.values.map((value) => [value.id, value.evidence])),
    });
  }
  return out;
}

/** Level 1: every value of the inventory and the tool schemas is in the map, in its dimension. */
export function structuredLevel(run: MapRun, truth: Truth): Measure {
  const failed = inputFailure(run, 'structured');
  if (failed) return failed;
  const found = valuesOf(proposalOf(run));
  const items: Item[] = [];
  for (const entry of truth.structural) {
    const dimension = found.get(entry.dimension);
    const source = entry.from === 'inventory' ? INVENTORY_PATH : TOOLS_PATH;
    let why: string | undefined;
    if (!dimension) why = `the map has no dimension ${entry.dimension}`;
    else if (dimension.kind !== entry.kind)
      why = `${entry.dimension} has the kind ${dimension.kind}, not ${entry.kind}`;
    else if (!dimension.values.has(entry.value)) why = `${entry.dimension} has no value ${entry.value}`;
    else if (dimension.values.get(entry.value)?.source !== source) {
      why = `${entry.value} quotes ${dimension.values.get(entry.value)?.source}, not ${source}`;
    }
    if (why) {
      items.push({
        id: `${entry.dimension}/${entry.value}`,
        component: entry.from === 'inventory' ? MAP_COMPONENTS.inventory : MAP_COMPONENTS.tools,
        detail: `planted in ${source}: ${why}`,
      });
    }
  }
  const total = truth.structural.length;
  return { value: total === 0 ? 1 : (total - items.length) / total, items };
}

/** The refusal the extractor reported for an atom, if any. */
function refusalOf(run: MapRun, atom: ProseAtom): Refusal | undefined {
  if (!run.result.ok) return undefined;
  const label =
    atom.type === 'phrase' ? `(${atom.dimension}/${atom.value})` : `${atom.dimension}/${atom.value}`;
  return run.result.refusals.find(
    (refusal) => refusal.section === atom.section && refusal.entry.includes(label),
  );
}

/** Whether the map holds a prose atom with its quote inside the atom's rendered span, and why not. */
function locate(run: MapRun, atom: ProseAtom): { ok: true } | { ok: false; why: string } {
  const proposal = proposalOf(run);
  const span = run.rendered.spans.get(atom.id);
  if (atom.type === 'phrase') {
    const phrase = proposal.phrases.find(
      (candidate) =>
        candidate.dimension === atom.dimension &&
        candidate.value === atom.value &&
        candidate.lang === atom.lang &&
        fold(candidate.text) === fold(atom.text ?? ''),
    );
    if (!phrase) return { ok: false, why: 'the phrase is not in the map' };
    if (
      !phrase.evidence ||
      phrase.evidence.source !== PROMPT_PATH ||
      !quoteInSpan(run.rendered.prompt, span, phrase.evidence.quote)
    ) {
      return {
        ok: false,
        why: `the phrase's quote lies outside its span: "${show(phrase.evidence?.quote ?? '(none)', 80)}"`,
      };
    }
    return { ok: true };
  }
  const dimension = proposal.dimensions.find((candidate) => candidate.id === atom.dimension);
  const value = dimension?.values.find((candidate) => candidate.id === atom.value);
  if (!dimension || !value) return { ok: false, why: `the map has no value ${atom.dimension}/${atom.value}` };
  if (dimension.kind !== atom.kind)
    return { ok: false, why: `${atom.dimension} has the kind ${dimension.kind}, not ${atom.kind}` };
  if (
    value.evidence.source !== PROMPT_PATH ||
    !quoteInSpan(run.rendered.prompt, span, value.evidence.quote)
  ) {
    return { ok: false, why: `the quote lies outside its span: "${show(value.evidence.quote, 80)}"` };
  }
  return { ok: true };
}

/** The component a missed prose atom points at, and what the extractor said about it. */
function blame(run: MapRun, atom: ProseAtom, why: string): { component: string; said: string } {
  if (!run.result.ok) return { component: MAP_COMPONENTS.renderer, said: 'the input was refused' };
  const section = run.result.sections.find((candidate) => candidate.section === atom.section);
  if (section?.status === 'failed') {
    return {
      component: MAP_COMPONENTS.contract,
      said: `the ${atom.section} section failed: ${section.error ?? ''}`,
    };
  }
  const refusal = refusalOf(run, atom);
  if (refusal) {
    const component = /quote is not in|quote is too short|quote is longer/.test(refusal.reason)
      ? MAP_COMPONENTS.quote
      : MAP_COMPONENTS.accept;
    return { component, said: `refused: ${refusal.reason}` };
  }
  if (why.includes('outside its span')) return { component: MAP_COMPONENTS.quote, said: why };
  if (run.rendered.split.has(atom.id)) {
    return { component: MAP_COMPONENTS.contract, said: `${why}; the atom is split over two sentences` };
  }
  // Nothing refused it, so the section answer never reported it: the section request is the component.
  return { component: MAP_COMPONENTS.contract, said: `${why}; no refusal was reported` };
}

function proseItem(run: MapRun, atom: ProseAtom, why: string): Item {
  const span = run.rendered.spans.get(atom.id);
  const sentence = span ? show(run.rendered.prompt.slice(span.start, span.end)) : '(no span)';
  const where = span ? `characters ${span.start} to ${span.end} of ${PROMPT_PATH}` : 'nowhere';
  const { component, said } = blame(run, atom, why);
  return {
    id: atom.id,
    component,
    detail: `rendered "${sentence}" at ${where}; the ${atom.section} request carried ${PROMPT_PATH} whole (${run.rendered.prompt.length} characters); ${said}`,
  };
}

/** Level 2: prose atoms recovered, each with its quote inside its rendered span, over atoms planted. */
export function proseLevel(run: MapRun, truth: Truth): Measure {
  const failed = inputFailure(run, 'prose');
  if (failed) return failed;
  const items: Item[] = [];
  for (const atom of truth.prose) {
    const found = locate(run, atom);
    if (!found.ok) items.push(proseItem(run, atom, found.why));
  }
  const total = truth.prose.length;
  return { value: total === 0 ? 1 : (total - items.length) / total, items };
}

/** Whether a quote is a decoy, or sits in one. */
function decoyOf(rendered: Rendered, quote: string): string | undefined {
  const needle = fold(quote);
  return rendered.decoys.find((decoy) => {
    const text = fold(rendered.prompt.slice(decoy.span.start, decoy.span.end));
    return needle !== '' && (text.includes(needle) || needle.includes(text));
  })?.id;
}

/**
 * Level 3: every reported entry traces to a planted one: a structured value from its file, a prose value
 * or phrase with its quote inside its span, a constraint the specification states. An entry from a decoy, an
 * entry nobody planted and an entry quoted from elsewhere are items.
 */
export function precisionLevel(run: MapRun, truth: Truth): Measure {
  const failed = inputFailure(run, 'precision');
  if (failed) return failed;
  const proposal = proposalOf(run);
  const structural = new Map(
    truth.structural.map((entry) => [
      `${entry.dimension}/${entry.value}`,
      entry.from === 'inventory' ? INVENTORY_PATH : TOOLS_PATH,
    ]),
  );
  const prose = new Map(
    truth.prose
      .filter((atom) => atom.type === 'value')
      .map((atom) => [`${atom.dimension}/${atom.value}`, atom]),
  );
  const constraints = new Map(
    truth.constraints.map((constraint) => [forbidKey(constraint.forbid), constraint]),
  );
  const items: Item[] = [];
  let reported = 0;
  const invented = (id: string, quote: string, source: string, what: string) => {
    const decoy = source === PROMPT_PATH ? decoyOf(run.rendered, quote) : undefined;
    items.push({
      id,
      component: MAP_COMPONENTS.accept,
      detail: decoy
        ? `${what} comes from the decoy ${decoy}: "${show(quote, 80)}"`
        : `${what} was never planted; it quotes ${source}: "${show(quote, 80)}"`,
    });
  };

  for (const dimension of proposal.dimensions) {
    for (const value of dimension.values) {
      reported += 1;
      const key = `${dimension.id}/${value.id}`;
      const file = structural.get(key);
      if (file !== undefined) {
        if (value.evidence.source !== file)
          invented(key, value.evidence.quote, value.evidence.source, `the value ${key}`);
        continue;
      }
      const atom = prose.get(key);
      if (
        atom &&
        value.evidence.source === PROMPT_PATH &&
        quoteInSpan(run.rendered.prompt, run.rendered.spans.get(atom.id), value.evidence.quote)
      ) {
        continue;
      }
      if (atom) {
        items.push({
          id: key,
          component: MAP_COMPONENTS.quote,
          detail: `the value ${key} is planted, but its quote lies outside its span: "${show(value.evidence.quote, 80)}"`,
        });
        continue;
      }
      invented(key, value.evidence.quote, value.evidence.source, `the value ${key}`);
    }
  }
  for (const constraint of proposal.constraints) {
    reported += 1;
    const key = forbidKey(constraint.forbid);
    const planted = constraints.get(key);
    const label = `constraint ${Object.entries(constraint.forbid)
      .map(([dimension, value]) => `${dimension}=${value}`)
      .join(',')}`;
    if (planted?.from === 'inventory' && constraint.evidence.source === INVENTORY_PATH) continue;
    if (
      planted?.from === 'prose' &&
      constraint.evidence.source === PROMPT_PATH &&
      quoteInSpan(
        run.rendered.prompt,
        run.rendered.spans.get(`constraint/${planted.id}`),
        constraint.evidence.quote,
      )
    ) {
      continue;
    }
    invented(label, constraint.evidence.quote, constraint.evidence.source, `the ${label}`);
  }
  const phrases = truth.prose.filter((atom) => atom.type === 'phrase');
  for (const phrase of proposal.phrases) {
    reported += 1;
    const atom = phrases.find(
      (candidate) =>
        candidate.dimension === phrase.dimension &&
        candidate.value === phrase.value &&
        candidate.lang === phrase.lang &&
        fold(candidate.text ?? '') === fold(phrase.text),
    );
    const label = `phrase ${phrase.dimension}/${phrase.value} [${phrase.lang}]`;
    if (
      atom &&
      phrase.evidence?.source === PROMPT_PATH &&
      quoteInSpan(run.rendered.prompt, run.rendered.spans.get(atom.id), phrase.evidence.quote)
    ) {
      continue;
    }
    invented(
      label,
      phrase.evidence?.quote ?? phrase.text,
      phrase.evidence?.source ?? PROMPT_PATH,
      `the ${label}`,
    );
  }
  return { value: reported === 0 ? 1 : (reported - items.length) / reported, items };
}

/** Level 4: planted constraints in the map, prose ones with their quote inside their sentence. */
export function constraintLevel(run: MapRun, truth: Truth): Measure {
  const failed = inputFailure(run, 'constraints');
  if (failed) return failed;
  const proposal = proposalOf(run);
  const byKey = new Map(proposal.constraints.map((constraint) => [forbidKey(constraint.forbid), constraint]));
  const items: Item[] = [];
  for (const planted of truth.constraints) {
    const found = byKey.get(forbidKey(planted.forbid));
    const span = run.rendered.spans.get(`constraint/${planted.id}`);
    let why: string | undefined;
    if (!found) why = 'not in the map';
    else if (planted.from === 'inventory' && found.evidence.source !== INVENTORY_PATH) {
      why = `quotes ${found.evidence.source}, not ${INVENTORY_PATH}`;
    } else if (planted.from === 'prose' && !quoteInSpan(run.rendered.prompt, span, found.evidence.quote)) {
      why = `its quote lies outside its sentence: "${show(found.evidence.quote, 80)}"`;
    }
    if (!why) continue;
    if (planted.from === 'inventory') {
      items.push({
        id: planted.id,
        component: MAP_COMPONENTS.inventory,
        detail: `planted in ${INVENTORY_PATH} by a behaviour's channels: ${why}`,
      });
      continue;
    }
    const refusal = run.result.ok
      ? run.result.refusals.find(
          (candidate) =>
            candidate.section === planted.section &&
            Object.entries(planted.forbid).every(([dimension, value]) =>
              candidate.entry.includes(`${dimension}=${value}`),
            ),
        )
      : undefined;
    const sentence = span ? show(run.rendered.prompt.slice(span.start, span.end)) : '(no span)';
    items.push({
      id: planted.id,
      component: refusal ? MAP_COMPONENTS.accept : MAP_COMPONENTS.contract,
      detail: `rendered "${sentence}" for the ${planted.section} section: ${why}${refusal ? `; refused: ${refusal.reason}` : ''}`,
    });
  }
  const total = truth.constraints.length;
  return { value: total === 0 ? 1 : (total - items.length) / total, items };
}

/** The component a difference between two maps points at. */
function diffComponent(facts: readonly string[]): string {
  if (facts.some((fact) => fact.startsWith('role '))) return MAP_COMPONENTS.roles;
  if (facts.some((fact) => fact.startsWith('order '))) return MAP_COMPONENTS.accept;
  return MAP_COMPONENTS.accept;
}

/** One item for two maps that differ, naming the first differences both ways. */
export function diffItem(
  id: string,
  what: string,
  expected: Set<string>,
  actual: Set<string>,
): Item | undefined {
  const { missing, extra } = diffFacts(expected, actual);
  if (missing.length === 0 && extra.length === 0) return undefined;
  const list = (facts: string[]) =>
    facts.length === 0
      ? 'nothing'
      : `${facts.slice(0, 4).join('; ')}${facts.length > 4 ? `; and ${facts.length - 4} more` : ''}`;
  return {
    id,
    component: diffComponent([...missing, ...extra]),
    detail: `${what}: lost ${list(missing)}; gained ${list(extra)}`,
  };
}

/** Level 5: each transform leaves the map unchanged up to quotes. */
export function metamorphicLevel(
  base: MapRun,
  variants: ReadonlyArray<{ transform: string; run: MapRun }>,
): Measure {
  const failed = inputFailure(base, 'metamorphic');
  if (failed) return failed;
  const expected = mapFacts(proposalOf(base), { roles: true, order: true });
  const items: Item[] = [];
  for (const { transform, run } of variants) {
    const refused = inputFailure(run, `transform:${transform}`);
    if (refused) {
      items.push(...refused.items);
      continue;
    }
    const item = diffItem(
      `transform:${transform}`,
      `the ${transform} transform changed the map`,
      expected,
      mapFacts(proposalOf(run), { roles: true, order: true }),
    );
    if (item) items.push(item);
  }
  return { value: variants.length === 0 ? 1 : (variants.length - items.length) / variants.length, items };
}

/** Level 7: each declared dimension carries its declared role. */
export function rolesLevel(run: MapRun, truth: Truth): Measure {
  const failed = inputFailure(run, 'roles');
  if (failed) return failed;
  const proposal = proposalOf(run);
  const items: Item[] = [];
  for (const declared of truth.roles) {
    const dimension = proposal.dimensions.find((candidate) => candidate.id === declared.dimension);
    if (dimension?.role === declared.role) continue;
    const others = proposal.dimensions
      .filter((candidate) => dimension && candidate.kind === dimension.kind && candidate.role === 'axis')
      .map((candidate) => candidate.id);
    items.push({
      id: `role:${declared.dimension}`,
      component: MAP_COMPONENTS.roles,
      detail: dimension
        ? `declared ${declared.role}, proposed ${dimension.role}; the ${dimension.kind} axes proposed: ${others.join(', ') || 'none'}; ${
            contractStatesRole()
              ? 'the answer contract carries a role, and the extractor kept another'
              : 'the answer contract carries no role, so the role follows the order dimensions arrive in'
          }`
        : `declared ${declared.role}, but the map has no dimension ${declared.dimension}`,
    });
  }
  const total = truth.roles.length;
  return { value: total === 0 ? 1 : (total - items.length) / total, items };
}

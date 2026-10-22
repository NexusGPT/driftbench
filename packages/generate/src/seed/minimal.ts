import { canonicalGiven, contentHash, type Spec, validateSpec } from '@agent-nexus/driftbench-core';
import {
  addEventCodes,
  assertGridSize,
  combinations,
  compileSpace,
  placeSpec,
  projectGrid,
} from '@agent-nexus/driftbench-space';
import { createPerturbingDriver } from '@agent-nexus/driftbench-users';
import type { Allocation } from './allocation';
import { type ReducedEnds, type RunIdentity, renderDraft, type SpecDraft } from './assemble';
import type { PreparedMap } from './map';

/** A tool failure is followed by the turn that gets the tool answering again: the walk never ends on it. */
function failsAtEnd(spec: Spec): boolean {
  const tools = spec.blocks.at(-1)?.given?.world?.tools ?? {};
  return Object.values(tools).some((tool) => tool.error !== undefined);
}

/**
 * A repeated test at the end of a walk is not written again. A terminal block is dropped when another
 * block already written is the same test: it runs from the same stage, expects the same and gets the same tool answers, however the user turn is worded, in the same
 * language and under the same rules, and when the suite keeps every obligation without it: each coverage tuple the walk placed is
 * placed by a spec already written, each ordered pair of consecutive moves it walked is walked by one, the
 * stage and class allocation is no further from balance. A block a perturbation declaration names, and the ones before it, stay. The first block written stays; later repeats go. Exactly one walk
 * ends on a given block: a cut that would leave a walk ending, with more than one block, on the block another written
 * walk ends on is taken back to the deepest cut that ends elsewhere. A block is the same
 * test on any channel and for any persona; the first twin of a written walk, per path and context axis, stays whole. A block that injects
 * a class is a block like any other: a second probe of a class a written spec already tests on the path is cut by the same
 * checks; the first probe of a class on a path stays, and so do the injection blocks of a t-wise spec. A walk with an end state,
 * a task and a spec that is not complete are never reduced. Metamorphic variants follow their first variant.
 *
 * This is subsumption by what has been written, not a proof of a smallest suite, and it reads no agent.
 * Memory is bounded by the coverage grid and the distinct blocks and move pairs of the suite.
 */
export class TerminalSubsumption {
  private readonly space;
  private readonly projections;
  /** The tuples the written specs place. */
  private readonly held: Uint8Array[];
  /** Blocks written so far, by what makes two blocks the same test. */
  private readonly blocks = new Map<string, ReducedEnds['duplicates'][number]['duplicate_of']>();
  /** The user messages the written specs say: a cut never removes the only place an approved phrase is said. */
  private readonly said = new Set<string>();
  /** The key of the last block of every walk written: one walk ends on each. */
  private readonly ends = new Set<string>();
  /** The classes already probed on each path, by a written spec: `<path>|<class>`. */
  private readonly probed = new Set<string>();
  /** The whole walks written, by what they say apart from the context, with the contexts each is written in. */
  private readonly walks = new Map<string, Set<string>>();
  /** The length each metamorphic family was cut to by its first variant: every variant follows it. */
  private readonly families = new Map<string, { length: number; reduction?: ReducedEnds }>();
  /** The first family that drafted a block, including a suffix whose retained witness is another seeder. */
  private readonly familyBlocks = new Map<string, string>();
  /** The context axes a pair of whole twins is kept for, per path: the Then must hold across them. */
  private readonly paired = new Map<string, Set<string>>();
  /** Ordered pairs of consecutive moves some written spec walks. */
  private readonly pairs = new Set<string>();
  private readonly processed = new WeakSet<SpecDraft>();

  constructor(
    private readonly prepared: PreparedMap,
    private readonly run: RunIdentity,
    t: number,
    private readonly allocation?: Allocation,
  ) {
    assertGridSize(prepared.axisMap, 4_000_000);
    this.space = compileSpace(prepared.axisMap);
    const k = this.space.dimensions.length;
    const strengths = [...new Set([1, 2, 3, Math.min(t, k)])].filter((n) => n > 0 && n <= k);
    this.projections = projectGrid(
      this.space,
      strengths.flatMap((n) => combinations(k, n)),
    ).projections;
    this.held = this.projections.map((projection) => new Uint8Array(projection.size));
  }

  /** Drops the terminal repeats of a draft, once, and remembers what the reduced walk places. */
  reduce(draft: SpecDraft): void {
    if (this.processed.has(draft)) return;
    this.processed.add(draft);
    const rendered = renderDraft(this.prepared, draft, this.run);
    if (rendered.placeholders.length || rendered.noThen.length || rendered.reasons.length) return;
    const parsed = validateSpec(rendered.spec);
    if (!parsed.ok) return;
    let spec = parsed.spec;
    const original = spec;
    const originalBlocks = draft.blocks;
    // A metamorphic family keeps its variants identical but for the phrasing, so its first variant decides how
    // far the family is cut and the others follow it to the same length (their wording is not part of a test, so
    // a variant judged alone would be a repeat of the first).
    const family = draft.seeder === 'metamorphic' ? draft.metamorphic : undefined;
    const followed = family && family.variant > 1 ? this.families.get(family.family) : undefined;
    if (
      followed !== undefined &&
      followed.length < draft.blocks.length &&
      spec.blocks.slice(followed.length).every((block) => this.phrasesHold(block))
    ) {
      // A follower is cut to its leader's length only when every message it would lose is said by a written spec.
      draft.blocks = draft.blocks.slice(0, followed.length);
      const shorter = renderDraft(this.prepared, draft, this.run);
      const again = validateSpec(shorter.spec);
      if (again.ok) spec = again.spec;
    } else if (followed === undefined && spec.kind === 'conversation' && spec.end_state === undefined) {
      const states = [{ blocks: draft.blocks, spec }];
      // The Then must hold across channels and across personas, and that is read off a pair of whole walks that
      // differ only there (a twin). Each path keeps one such pair per axis; a twin beyond it is a repeat.
      const twin = this.keepsPair(spec);
      while (!twin && spec.blocks.length > 1) {
        const last = spec.blocks.length - 1;
        if (!this.blocks.has(this.key(spec, last))) break;
        // A block that injects a class is cut like any other block, with two exceptions the items count: a t-wise
        // spec holds the tuples of its row (the t-wise items read those specs alone), and the first probe of a class on
        // a path stays, because each path owes every class its flow requires a probe.
        const injected = spec.blocks[last]?.when;
        if (injected && 'injection' in injected) {
          if (draft.seeder === 'twise') break;
          if (!this.probed.has(`${draft.path ?? ''}|${injected.injection.class}`)) break;
        }
        // The move right after a restated request is the test of the latest value: a walk is never cut to end on
        // the request alone, which asks for a value and checks none of the slot's later states.
        if (spec.blocks[last - 1]?.id?.endsWith('-restated')) break;
        // A perturbed run injects a declaration at its position and checks its recovery there, with the blocks after
        // it: the block a declaration names, and the ones before it, are part of that test and stay. (Dropping the
        // declaration with the block was measured: it loses 50 perturbed-mode kills on the hidden seed.)
        if (spec.perturbations?.some((entry) => entry.inject_at >= last)) break;
        const reduced = validateSpec(this.cut(spec, last));
        if (!reduced.ok || !this.recoveriesHold(reduced.spec) || failsAtEnd(reduced.spec)) break;
        if (!this.phrasesHold(spec.blocks[last])) break;
        if (!this.tuplesHold(spec, reduced.spec) || !this.pairsHold(spec, reduced.spec)) break;
        if (!this.allocationHolds(draft, last)) break;
        draft.blocks = draft.blocks.slice(0, last);
        spec = reduced.spec;
        states.push({ blocks: draft.blocks, spec });
      }
      // Exactly one walk ends on a given block: a cut that stops, with more than one block left, on the block
      // another written walk ends on is taken back to the deepest cut that ends elsewhere, or to the whole walk.
      const settled = [...states]
        .reverse()
        .find(
          (state) =>
            state.spec.blocks.length === 1 ||
            !this.ends.has(this.key(state.spec, state.spec.blocks.length - 1)),
        );
      const chosen = settled ?? (states[0] as (typeof states)[number]);
      draft.blocks = chosen.blocks;
      spec = chosen.spec;
    }
    if (spec.blocks.length < original.blocks.length) {
      draft.reducedEnds = {
        from_blocks: original.blocks.length,
        to_blocks: spec.blocks.length,
        duplicates: originalBlocks.slice(spec.blocks.length).map((block, offset) => {
          // A follower's wording differs: its first variant supplies the witnesses for the shared suffix.
          const key = this.key(original, spec.blocks.length + offset);
          const inherited = followed?.reduction?.duplicates[offset];
          const duplicate = inherited?.duplicate_of ?? this.blocks.get(key);
          const duplicateFamily = family
            ? (inherited?.duplicate_family ?? this.familyBlocks.get(key))
            : undefined;
          if (!duplicate) throw new Error(`No written duplicate for ${draft.id}#${block.id}`);
          return {
            block: block.id,
            duplicate_of: duplicate,
            ...(duplicateFamily !== undefined && duplicateFamily !== family?.family
              ? { duplicate_family: duplicateFamily }
              : {}),
          };
        }),
      };
    }
    // A metamorphic family keeps its variants aligned block by block: its members are never cut from the middle.
    if (family === undefined && spec.kind === 'conversation' && spec.end_state === undefined) {
      spec = this.dropMiddle(draft, spec);
      // The record of the cut end names the length the walk is written with, middle cuts included.
      if (draft.reducedEnds) draft.reducedEnds.to_blocks = spec.blocks.length;
    }
    if (family?.variant === 1) {
      this.families.set(family.family, { length: spec.blocks.length, reduction: draft.reducedEnds });
      original.blocks.forEach((_, index) => {
        const key = this.key(original, index);
        if (!this.familyBlocks.has(key)) this.familyBlocks.set(key, family.family);
      });
    }
    this.observeSpec(spec);
  }

  /**
   * A stay (a block that leaves the walk at the stage it started from, with no new world and no fact of its own) that
   * another written spec already says is cut from the middle of the walk, when the walk stays valid: the block after it
   * starts from the same stage and the same world, so its Given is still reached. The same checks as the end of a walk
   * hold: tuples, move pairs, allocation, phrases, recovery. A perturbation declared on the block stays with it.
   */
  private dropMiddle(draft: SpecDraft, start: Spec): Spec {
    let spec = start;
    for (let index = spec.blocks.length - 2; index >= 1; index -= 1) {
      const block = draft.blocks[index];
      const written = spec.blocks[index];
      if (!block || !written || block.injection !== undefined || block.given !== undefined) continue;
      const before = spec.blocks[index - 1]?.expect?.stage;
      if (before === undefined || written.expect?.stage !== before) continue;
      if (written.expect?.ledger_add !== undefined) continue;
      if (spec.perturbations?.some((entry) => entry.inject_at === index)) continue;
      const duplicate = this.blocks.get(this.key(spec, index));
      if (!duplicate || !this.phrasesHold(written)) continue;
      const candidate = {
        ...draft,
        blocks: draft.blocks.filter((_, at) => at !== index),
        perturbations: draft.perturbations?.map((entry) =>
          entry.inject_at > index ? { ...entry, inject_at: entry.inject_at - 1 } : entry,
        ),
      };
      const rendered = renderDraft(this.prepared, candidate, this.run);
      if (rendered.placeholders.length || rendered.noThen.length || rendered.reasons.length) continue;
      const parsed = validateSpec(rendered.spec);
      if (!parsed.ok || !this.recoveriesHold(parsed.spec) || failsAtEnd(parsed.spec)) continue;
      if (!this.tuplesHold(spec, parsed.spec) || !this.pairsHold(spec, parsed.spec)) continue;
      if (this.allocation && this.allocation.imbalanceWith(candidate) > this.allocation.imbalanceWith(draft))
        continue;
      draft.blocks = candidate.blocks;
      draft.perturbations = candidate.perturbations;
      draft.reducedMiddle = [{ block: block.id, duplicate_of: duplicate }, ...(draft.reducedMiddle ?? [])];
      spec = parsed.spec;
    }
    return spec;
  }

  /** The messages a block says: its user turn, or the turns of a burst. */
  private textsOf(block: Spec['blocks'][number] | undefined): string[] {
    const when = block?.when;
    if (when === undefined) return [];
    if ('user' in when) return [when.user];
    if ('burst' in when) return when.burst;
    return [];
  }

  /** Every message the block says is already said by a written spec. */
  private phrasesHold(block: Spec['blocks'][number] | undefined): boolean {
    return this.textsOf(block).every((text) => this.said.has(text));
  }

  /** The spec without the blocks from `length` on: a link that names a removed block goes with it. */
  private cut(spec: Spec, length: number): Spec {
    const kept = new Set(spec.blocks.slice(0, length).map((block) => block.id));
    const links = spec.metadata?.links;
    const metadata =
      Array.isArray(links) && spec.metadata
        ? {
            ...spec.metadata,
            links: links.filter((link: unknown) => {
              const block =
                typeof link === 'object' && link !== null ? (link as { block?: unknown }).block : undefined;
              if (typeof block === 'number') return block < length;
              if (typeof block === 'string') return kept.has(block) || block.includes('#');
              return true;
            }),
          }
        : spec.metadata;
    return { ...spec, blocks: spec.blocks.slice(0, length), ...(metadata ? { metadata } : {}) };
  }

  /** What a spec written by other code places: tasks are never reduced but their obligations are met. */
  observeSpec(spec: Spec): void {
    for (const block of spec.blocks) for (const text of this.textsOf(block)) this.said.add(text);
    spec.blocks.forEach((_, index) => {
      const key = this.key(spec, index);
      const family = (spec.metadata?.generated as { metamorphic?: { family: string } } | undefined)
        ?.metamorphic?.family;
      if (family !== undefined && !this.familyBlocks.has(key)) this.familyBlocks.set(key, family);
      // Name the first retained family when one exists, even if an ordinary walk wrote the block first.
      const previous = this.blocks.get(key);
      if (!previous || (family !== undefined && previous.family === undefined))
        this.blocks.set(key, {
          spec: spec.id,
          block: spec.blocks[index]?.id ?? '',
          ...(family === undefined ? {} : { family }),
        });
    });
    this.ends.add(this.key(spec, spec.blocks.length - 1));
    const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
    for (const block of spec.blocks)
      if ('injection' in block.when) this.probed.add(`${path}|${block.when.injection.class}`);
    const walk = this.walkKey(spec);
    const contexts = this.walks.get(walk) ?? new Set<string>();
    contexts.add(this.contextOf(spec));
    this.walks.set(walk, contexts);
    for (const pair of this.pairsOf(spec)) this.pairs.add(pair);
    const placement = placeSpec(this.space, spec);
    this.projections.forEach((projection, index) => {
      const marks = this.held[index];
      if (!marks) return;
      const codes = new Set<number>();
      for (const event of placement.events) addEventCodes(projection, event, codes);
      for (const code of codes) if (projection.allowed[code] === 1) marks[code] = 1;
    });
  }

  /** The channel and the persona a spec is written for: no agent receives them, a suite varies them. */
  private contextOf(spec: Spec): string {
    return JSON.stringify([spec.channel, spec.tags?.filter((tag) => tag.startsWith('persona:'))]);
  }

  /** True when the walk is the first twin of a written walk on an axis its path has no pair for yet. */
  private keepsPair(spec: Spec): boolean {
    const written = this.walks.get(this.walkKey(spec));
    if (written === undefined) return false;
    const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
    const secured = this.paired.get(path) ?? new Set<string>();
    const [channel, persona] = JSON.parse(this.contextOf(spec)) as [unknown, unknown];
    const axes = new Set<string>();
    for (const other of written) {
      const [otherChannel, otherPersona] = JSON.parse(other) as [unknown, unknown];
      if (JSON.stringify(otherChannel) !== JSON.stringify(channel)) axes.add('channel');
      if (JSON.stringify(otherPersona) !== JSON.stringify(persona)) axes.add('persona');
    }
    const needed = [...axes].filter((axis) => !secured.has(axis));
    for (const axis of needed) secured.add(axis);
    this.paired.set(path, secured);
    return needed.length > 0;
  }

  /** A walk on a path: two walks are twins only on the same path, whatever their blocks say. */
  private walkKey(spec: Spec): string {
    const path = (spec.metadata?.generated as { path?: string } | undefined)?.path ?? '';
    return contentHash([path, spec.blocks.map((_, index) => this.key(spec, index))]);
  }

  /** The judged criteria a block references, with their definitions: a criterion no kept spec covers is a lost check. */
  private criteriaOf(spec: Spec, block: Spec['blocks'][number] | undefined): unknown {
    return (block?.expect?.criteria ?? []).map((entry) => {
      const name = entry.split('@')[0];
      return [entry, spec.criteria?.find((definition) => definition.name === name)];
    });
  }

  /** What a turn is apart from its wording: a user message, a burst of n messages, or an injection of a class. */
  private turnOf(block: Spec['blocks'][number] | undefined): unknown {
    const when = block?.when;
    if (when === undefined) return undefined;
    if ('injection' in when) return { injection: when.injection };
    if ('burst' in when) return { burst: when.burst.length };
    return 'user';
  }

  /** The turn, the stage it is said from and what it expects, in the language and under the rules it is said in. */
  private key(spec: Spec, index: number): string {
    const block = spec.blocks[index];
    const { criteria: _criteria, ...machine } = block?.expect ?? {};
    const from = index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage;
    return contentHash({
      kind: spec.kind,
      lang: spec.lang,
      rules: spec.rules,
      state: canonicalGiven(spec, index).state,
      from,
      turn: this.turnOf(block),
      given: block?.given,
      expect: machine,
      criteria: this.criteriaOf(spec, block),
    });
  }

  /** Consecutive moves of a walk, with the class each says: the pairs a sequence of the suite is made of. */
  private pairsOf(spec: Spec): string[] {
    const move = (index: number) => {
      const block = spec.blocks[index];
      const cls = block && 'injection' in block.when ? block.when.injection.class : '';
      return `${index === 0 ? (spec.stages?.[0] ?? '') : (spec.blocks[index - 1]?.expect?.stage ?? '')}>${block?.expect?.stage ?? ''}:${cls}`;
    };
    return spec.blocks.slice(1).map((_, index) => `${move(index)}|${move(index + 1)}`);
  }

  private recoveriesHold(spec: Spec): boolean {
    try {
      for (const entry of spec.perturbations ?? []) createPerturbingDriver({ spec, perturbation: entry.id });
      return true;
    } catch {
      return false;
    }
  }

  /** Every tuple the longer walk places is placed by the reduced walk or by a spec already written. */
  private tuplesHold(before: Spec, after: Spec): boolean {
    const held = this.held;
    const previous = placeSpec(this.space, before);
    const reduced = placeSpec(this.space, after);
    return this.projections.every((projection, index) => {
      const oldCodes = new Set<number>();
      const newCodes = new Set<number>();
      for (const event of previous.events) addEventCodes(projection, event, oldCodes);
      for (const event of reduced.events) addEventCodes(projection, event, newCodes);
      return [...oldCodes].every(
        (code) => projection.allowed[code] !== 1 || newCodes.has(code) || held[index]?.[code] === 1,
      );
    });
  }

  private pairsHold(before: Spec, after: Spec): boolean {
    const kept = new Set(this.pairsOf(after));
    return this.pairsOf(before).every((pair) => kept.has(pair) || this.pairs.has(pair));
  }

  /** The reduced walk leaves stages and classes no further from balance than the whole one. */
  private allocationHolds(draft: SpecDraft, last: number): boolean {
    if (!this.allocation) return true;
    const reduced = {
      blocks: draft.blocks.slice(0, last),
      perturbations: draft.perturbations,
    };
    return this.allocation.imbalanceWith(reduced) <= this.allocation.imbalanceWith(draft);
  }
}

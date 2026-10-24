import {
  type BlockSpec,
  canonicalGiven,
  canonicalJson,
  contentHash,
  deviationOf,
  type Message,
  type Spec,
} from '@agent-nexus/driftbench-core';
import type { ObligationSpec } from './holders';

/**
 * What makes two blocks the same test, and what makes two specs the same walk or say the same words, written once.
 * The generator that cuts a suite and the validator that judges it both call these, so neither holds a copy. They are
 * the definitions of docs/validators.md, section 3 ("Same test"): the stage a block starts from, the tool answers it
 * runs against and the machine Then it expects, however the user turn is worded; the channel, the persona and the
 * declared perturbations are not part of it. The validator adds what it measured (the outcome of every agent) to
 * `testKeyOf`; the generator reads no agent and uses it as it is. Pure: no agent, no file, no clock.
 */

/** The machine part of a block's Then, as text: equal signatures mean the same machine expectations. */
export function machineSignature(spec: Spec, index: number): string {
  const block: BlockSpec | undefined = spec.blocks[index];
  const { criteria: _criteria, ledger_add: _ledger, ...machine } = block?.expect ?? {};
  const rules = spec.rules ? { ...spec.rules } : undefined;
  const last = index === spec.blocks.length - 1;
  return canonicalJson({
    expect: machine,
    ...(rules ? { rules } : {}),
    ...(last && spec.end_state !== undefined ? { end_state: spec.end_state } : {}),
  });
}

/** A user turn as the ruling reads it: trimmed and with runs of whitespace squeezed. */
function squeeze(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

/**
 * What a spec says apart from its labels, in the forms the ruling compares: the normalised turns and the
 * canonical Given of every block. An empty Given, another key order or padding whitespace does not make it other words.
 */
export function specWords(spec: Spec): string {
  return contentHash(
    spec.blocks.map((block, index) => {
      const when = block.when;
      const turn =
        when === undefined
          ? null
          : 'user' in when
            ? { user: squeeze(when.user) }
            : 'burst' in when
              ? { burst: when.burst.map(squeeze) }
              : { injection: { class: when.injection.class, user: squeeze(when.injection.user ?? '') } };
      // Only the canonical Given: what the block starts from, never how the spec wrote it down.
      const given = canonicalGiven(spec, index);
      return [
        turn,
        given.state,
        given.prefix.map((message) => ({ ...message, content: squeeze(message.content) })),
      ];
    }),
  );
}

/** The tool answers a block runs against: part of its Given, so two blocks with other answers are other tests. */
export function answersOf(spec: Spec, index: number): string {
  const world = canonicalGiven(spec, index).state.world as { tools?: unknown } | undefined;
  return contentHash(world?.tools ?? null);
}

/** The stage a block starts from: part of its Given, so a copy said from another stage is another test. */
export function startStageOf(spec: Spec, index: number, book: StageBook): string {
  return (
    declaredStageBefore(spec, index, book) ??
    (index === 0 ? spec.stages?.[0] : spec.blocks[index - 1]?.expect?.stage) ??
    ''
  );
}

/** Per block of the written specs (`<spec id>#<block id>`), the stage it leaves and the history said by then. */
export type StageBook = Map<string, { stage: string; history: string }>;

/**
 * A history as a stage book reads it: what the user says is not part of the test (docs/validators.md, section 3),
 * so a user message counts as a turn; the replies and the tool calls with their results count in full.
 */
function historyKey(history: readonly Message[]): string {
  return contentHash(history.map((message) => (message.role === 'user' ? { role: 'user' } : message)));
}

/**
 * Adds what a written spec says about where it leaves the agent: per block, `<spec id>#<block id>`, the stage the
 * block expects and the history the walk has said by then. A caller that writes specs one at a time adds each as it is
 * written.
 */
export function addToStageBook(book: StageBook, spec: Spec): void {
  spec.blocks.forEach((block, index) => {
    const stage = block.expect?.stage;
    if (stage === undefined || block.id === undefined) return;
    book.set(`${spec.id}#${block.id}`, {
      stage,
      history: historyKey(canonicalGiven(spec, index + 1).prefix),
    });
  });
}

/**
 * What each written spec says about where it leaves the agent: per block, `<spec id>#<block id>`, the stage the
 * block expects and the history the walk has said by then. A declared start stage is checked against the block it
 * names (`given.after`).
 */
export function stageBookOf(specs: readonly Spec[]): StageBook {
  const book: StageBook = new Map();
  for (const spec of specs) addToStageBook(book, spec);
  return book;
}

/**
 * The stage the spec says the agent is at before a block: the nearest earlier block's stage, or the stage a
 * block that starts from a prefix declares. A declared stage counts only when the block it names (`given.after`)
 * is in the suite, leaves the agent at that stage and has said the same history as the prefix, so declaring a
 * stage cannot dodge a check. Undefined when nothing is said, so a spec without one reads as before.
 */
export function declaredStageBefore(spec: Spec, index: number, book: StageBook): string | undefined {
  for (let at = index; at >= 0; at -= 1) {
    const block = spec.blocks[at];
    if (at < index && block?.expect?.stage !== undefined) return block.expect.stage;
    const given = block?.given;
    if (given?.stage === undefined || given.prefix === undefined || given.after === undefined) continue;
    const named = book.get(given.after);
    if (named?.stage === given.stage && named.history === historyKey(given.prefix)) return given.stage;
  }
  return undefined;
}

/** What a block is as a test before any agent runs: the tool answers it runs against, the stage it starts from, its Then. */
function testParts(spec: Spec, index: number, book: StageBook): [string, string, string] {
  return [answersOf(spec, index), startStageOf(spec, index, book), machineSignature(spec, index)];
}

/**
 * The key two blocks share when they are the same test before any agent runs: the tool answers a block runs against,
 * the stage it starts from and its machine Then. The validator's own key adds the outcomes it measured.
 */
export function testKeyOf(spec: Spec, index: number, book: StageBook): string {
  return JSON.stringify(testParts(spec, index, book));
}

/** What the whole walk of a spec says apart from who it is written for: twins share it. */
export function walkOf(spec: Spec, book: StageBook): string {
  return contentHash(spec.blocks.map((_, at) => testParts(spec, at, book)));
}

type Generated = {
  path?: string;
  metamorphic?: { family?: string; variant?: number; of?: number };
};

/**
 * A spec as the obligations read it: the spec-level facts, and for each block its key in the suite, whether it injects
 * a class, the class, the classes of the declared perturbations that reach it, and its test key. The validator builds
 * the facts of its measured blocks from the same functions. A caller that evaluates the validity rules sets `broken`.
 */
export function obligationSpecOf(spec: Spec, book: StageBook): ObligationSpec {
  const generated = spec.metadata?.generated as Generated | undefined;
  return {
    spec: spec.id,
    path: generated?.path ?? '',
    walk: walkOf(spec, book),
    channel: spec.channel ?? '',
    persona: (spec.tags ?? []).filter((tag) => tag.startsWith('persona:')).join(','),
    family: generated?.metamorphic?.family ?? '',
    variant: generated?.metamorphic?.variant ?? 0,
    of: generated?.metamorphic?.of ?? 0,
    words: specWords(spec),
    blocks: spec.blocks.map((block, index) => {
      const deviation = deviationOf(spec, index);
      return {
        key: `${spec.id}#${block.id ?? index}`,
        injected: 'injection' in (block.when ?? {}),
        ...(deviation === undefined ? {} : { deviation }),
        perturbed: (spec.perturbations ?? [])
          .filter((entry) => entry.inject_at >= index)
          .map((entry) => entry.class)
          .sort(),
        test: testKeyOf(spec, index, book),
      };
    }),
  };
}

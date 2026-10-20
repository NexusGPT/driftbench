import { type SectionRegistry, sectionsReaching } from '@agent-nexus/driftbench-core';

/**
 * The prompt sections a generated block tests, for the block writer. A rule of a map comes with the quote it
 * was read from (a value's evidence, an atom's provenance). When the file the quote is in is a prompt with a
 * section registry, the sections that hold the quote are the sections the rule tests, and the sections that
 * reach them through the registry (references, overrides, duplicates) are tested too. A block that expects a
 * call of a tool also depends on every section that names the tool: it uses what they say about it.
 */

/** A section of a prompt, at the version of its registry. */
export type SectionRef = { prompt: string; section: string; version: string };

/** A prompt with its section registry. `path` is how the caller names the file the quotes come from. */
export type PromptSections = { path: string; text: string; registry: SectionRegistry };

/** What the generators take: where a quote sits, and what reaches each section of each prompt. */
export type BlockSections = {
  /** The sections of a known prompt that hold the quote, none for another file or a quote not found. */
  locate: (path: string, quote: string) => SectionRef[];
  /** By prompt id, for each section, the sections whose change reaches it. */
  reaching: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  /**
   * The sections of the known prompts that name a declared identifier (a tool's name) in their text, stale
   * sections left out. The name is a declared value, found as written: containment, never a list of words.
   */
  naming: (name: string) => SectionRef[];
};

/** The registry's normalisation: CRLF and CR to LF, then NFC. Offsets are UTF-16 code units. */
const normalize = (text: string): string => text.replace(/\r\n?/g, '\n').normalize('NFC');

/**
 * The sections of the prompts that hold each quote. A quote found several times gives every section that
 * holds one of them; a quote that spans two sections gives both. Stale sections are left out.
 */
export function blockSections(prompts: readonly PromptSections[]): BlockSections {
  const byPath = new Map(prompts.map((prompt) => [prompt.path, prompt]));
  const texts = new Map(prompts.map((prompt) => [prompt.path, normalize(prompt.text)]));
  const reaching = new Map(
    prompts.map((prompt) => [prompt.registry.prompt_id, sectionsReaching(prompt.registry)]),
  );
  const locate = (path: string, quote: string): SectionRef[] => {
    const prompt = byPath.get(path);
    const text = texts.get(path);
    const wanted = normalize(quote).trim();
    if (!prompt || text === undefined || wanted === '') return [];
    const out: SectionRef[] = [];
    for (let from = text.indexOf(wanted); from >= 0; from = text.indexOf(wanted, from + 1)) {
      const to = from + wanted.length;
      for (const section of prompt.registry.sections) {
        if (section.stale === true || section.span.end <= from || section.span.start >= to) continue;
        if (out.some((ref) => ref.section === section.id)) continue;
        out.push({
          prompt: prompt.registry.prompt_id,
          section: section.id,
          version: prompt.registry.version,
        });
      }
    }
    return out;
  };
  const naming = (name: string): SectionRef[] => {
    if (name === '') return [];
    // As written, and as a whole identifier: `port_check` is not named by `port_check_all`.
    const written = new RegExp(`(?<![\\w])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`);
    const out: SectionRef[] = [];
    for (const prompt of prompts) {
      const text = texts.get(prompt.path) ?? '';
      for (const section of prompt.registry.sections) {
        if (section.stale === true) continue;
        if (!written.test(text.slice(section.span.start, section.span.end))) continue;
        out.push({
          prompt: prompt.registry.prompt_id,
          section: section.id,
          version: prompt.registry.version,
        });
      }
    }
    return out;
  };
  return { locate, reaching, naming };
}

/**
 * The sections a block depends on because it expects a call of a tool: the sections that name the tool, for
 * each tool the map declares, each section once, in tool order, with the tool it comes through.
 */
export function sectionsNamingTools(
  sections: BlockSections,
  labels: readonly string[],
  declared: (label: string) => boolean,
): Array<SectionRef & { relation: 'exercises'; through: string }> {
  const out: Array<SectionRef & { relation: 'exercises'; through: string }> = [];
  for (const label of labels) {
    if (!declared(label)) continue;
    for (const ref of sections.naming(label)) {
      if (!out.some((each) => each.prompt === ref.prompt && each.section === ref.section)) {
        out.push({ ...ref, relation: 'exercises', through: label });
      }
    }
  }
  return out;
}

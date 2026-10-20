import { readFile } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { checkSectionRegistry } from '@agent-nexus/driftbench-core';
import { type BlockSections, blockSections, type PromptSections } from '@agent-nexus/driftbench-generate';
import type { Io } from '../io';
import { readRegistry } from './radius-sections';

/** The help text of `--sections`, shared by `generate` and `estate generate`. */
export const SECTIONS_OPTION =
  'a section registry of a prompt the quotes come from, so each block links the prompt sections it tests and the sections that reach them; the prompt is the registry path with .sections.yaml replaced by .md, or name it as <registry>=<prompt>; repeat it';

/**
 * The prompts with a section registry, for the generators: each `--sections` entry is a registry, beside its
 * prompt (`<name>.sections.yaml` and `<name>.md`) or followed by `=<prompt>`. The prompt is named relative to
 * `base`, the folder the quotes name their files from. A registry that does not describe its prompt's text is
 * refused. Undefined, with the reason written, on any error.
 */
export async function readBlockSections(
  entries: readonly string[],
  base: string,
  io: Io,
): Promise<BlockSections | undefined> {
  const prompts: PromptSections[] = [];
  for (const entry of entries) {
    const at = entry.indexOf('=');
    const registryPath = at < 0 ? entry : entry.slice(0, at);
    const promptPath =
      at < 0 ? registryPath.replace(/\.sections\.(ya?ml|json)$/, '.md') : entry.slice(at + 1);
    if (promptPath === registryPath) {
      io.err(
        `--sections ${entry}: name the prompt as <registry>=<prompt>, or call the registry <name>.sections.yaml.\n`,
      );
      return undefined;
    }
    const registry = await readRegistry(registryPath, io);
    if (!registry) return undefined;
    const text = await readFile(resolve(io.cwd, promptPath), 'utf8').catch(() => undefined);
    if (text === undefined) {
      io.err(`--sections ${entry}: the prompt ${promptPath} cannot be read.\n`);
      return undefined;
    }
    const problems = checkSectionRegistry(registry, text);
    if (problems.length > 0) {
      io.err(`--sections ${entry}: the registry does not describe ${promptPath}:\n`);
      for (const problem of problems.slice(0, 10)) io.err(`    ${problem}\n`);
      return undefined;
    }
    const path = relative(base, resolve(io.cwd, promptPath)).split('\\').join('/');
    prompts.push({ path, text, registry });
  }
  return blockSections(prompts);
}

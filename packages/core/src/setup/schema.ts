import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { compileGlob } from '../estate-model/glob';
import { parseTypes, type TypeSet, TypeSpec, type TypesOptions } from '../estate-model/part-type';
import { ASPECTS } from '../estate-model/vocabulary';
import { type RuntimeProfile, runtimeProfile } from '../runtime-profile/profile';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const relativePath = z
  .string()
  .min(1)
  .refine(
    (path) => !isAbsolute(path) && !path.includes('\\') && !path.split('/').includes('..'),
    'A deployment path is relative to its mapped root, without parent traversal.',
  );
const glob = z.string().refine((value) => compileGlob(value).ok, 'Invalid root-relative glob.');
const binding = z.strictObject({
  runtime: identifier,
  deployedRoot: identifier,
  deployedPath: relativePath,
  method: z.enum(['link', 'copy']),
});

/** One declared source. Paths are resolved literally, never through process HOME or a shell. */
export const SetupSource = z.strictObject({
  id: identifier,
  path: z.string().min(1),
  kind: z.enum(['project', 'home', 'directory']),
  reader: identifier,
  bindings: z.array(binding).optional(),
  types: z.record(z.string(), TypeSpec).optional(),
});
export type SetupSource = z.infer<typeof SetupSource>;

/** Version 1 of driftbench.setup.yaml. Strict fields prevent misspelled policies from becoming permissions. */
export const SetupDocument = z
  .strictObject({
    version: z.literal(1),
    sources: z.array(SetupSource).min(1),
    runtime: identifier.nullable(),
    roles: z.record(identifier, z.strictObject({ aspects: z.array(z.enum(ASPECTS)).min(1) })),
    types: z.record(z.string(), TypeSpec).optional(),
    scope: z.strictObject({ include: z.array(glob).min(1), exclude: z.array(glob) }),
    execute: z.strictObject({ policy: z.enum(['never', 'allow']), commands: z.array(z.string().min(1)) }),
    budget: z.strictObject({
      usd: z.number().finite().nonnegative(),
      modelCalls: z.number().int().nonnegative(),
      pricing: z
        .strictObject({
          inputUsdPerMillion: z.number().finite().nonnegative(),
          outputUsdPerMillion: z.number().finite().nonnegative(),
          inputTokensPerCall: z.number().int().nonnegative(),
          outputTokensPerCall: z.number().int().nonnegative(),
        })
        .optional(),
    }),
    privacy: z.strictObject({
      model: z.enum(['deny', 'allow']),
      exports: z.enum(['metadata', 'content']),
      exclude: z.array(glob),
    }),
    drift: z
      .strictObject({
        files: z.array(
          z.strictObject({
            source: identifier,
            path: relativePath,
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          }),
        ),
      })
      .optional(),
  })
  .superRefine((setup, context) => {
    const issue = (path: (string | number)[], message: string) =>
      context.addIssue({ code: 'custom', path, message });
    const ids = new Set<string>();
    for (const [index, source] of setup.sources.entries()) {
      if (ids.has(source.id)) issue(['sources', index, 'id'], 'Duplicate source id.');
      ids.add(source.id);
      if ((source.id === 'project' || source.id === 'home') && source.kind !== source.id)
        issue(['sources', index, 'kind'], 'Reserved source id must have the corresponding kind.');
    }
    for (const kind of ['project', 'home'] as const)
      if (setup.sources.filter((source) => source.kind === kind).length > 1)
        issue(['sources'], `Only one ${kind} mapping is allowed.`);
    for (const [index, source] of setup.sources.entries()) {
      for (const [at, target] of (source.bindings ?? []).entries()) {
        const mapped =
          target.deployedRoot === 'project' || target.deployedRoot === 'home'
            ? setup.sources.some((entry) => entry.kind === target.deployedRoot)
            : ids.has(target.deployedRoot);
        if (!mapped)
          issue(['sources', index, 'bindings', at, 'deployedRoot'], 'Deployment root is not mapped.');
      }
    }
    if (setup.types && !setup.sources.some((source) => source.kind === 'project'))
      issue(['types'], 'Top-level types require a project source.');
    for (const [index, source] of setup.sources.entries()) {
      if (source.kind === 'project') for (const name of Object.keys(source.types ?? {})) {
        if (setup.types?.[name]) issue(['sources', index, 'types', name], 'Type is also declared in the project shorthand.');
      }
    }
    if (setup.execute.policy === 'never' && setup.execute.commands.length > 0)
      issue(['execute', 'commands'], 'A never policy cannot allow commands.');
    const seen = new Set<string>();
    for (const [index, file] of (setup.drift?.files ?? []).entries()) {
      const key = `${file.source}:${file.path}`;
      if (!ids.has(file.source) || seen.has(key))
        issue(['drift', 'files', index], 'Unknown source or duplicate drift path.');
      seen.add(key);
    }
  });
export type SetupDocument = z.infer<typeof SetupDocument>;

/** A setup rejection is a structured field error; no prose is interpreted as setup data. */
export type SetupIssue = { path: string; code: string; message: string };
export type SetupResult =
  | { ok: true; setup: SetupDocument; types: Record<string, TypeSet> }
  | { ok: false; errors: SetupIssue[] };

/** A reader supplies its own built-ins and source-relative roots; never a host profile fallback. */
export type SetupTypeResolver = (readerId: string) => TypesOptions | undefined;

function profileOptions(profile: RuntimeProfile): TypesOptions {
  return { runtime: profile.name, roots: profile.roots, base: profile.types, shapes: profile.shapes, folder: '.' };
}

function sourceTypes(setup: SetupDocument, resolver?: SetupTypeResolver): { ok: true; types: Record<string, TypeSet> } | { ok: false; errors: SetupIssue[] } {
  const types: Record<string, TypeSet> = {};
  const errors: SetupIssue[] = [];
  for (const [index, source] of setup.sources.entries()) {
    const profile = runtimeProfile(source.reader);
    const options = resolver?.(source.reader) ?? (profile ? profileOptions(profile) : { runtime: source.reader, roots: { project: '.', source: '.' }, folder: '.' });
    const declarations = { ...(source.kind === 'project' ? setup.types ?? {} : {}), ...source.types };
    const result = parseTypes({ version: 1, types: declarations }, { ...options, source: `driftbench.setup.yaml#sources.${index}` });
    if (result.ok) types[source.id] = result.set;
    else errors.push(...result.errors.map((error) => ({ ...error, path: `sources.${index}.${error.path}` })));
  }
  return errors.length ? { ok: false, errors } : { ok: true, types };
}

/** Parse YAML/JSON strictly and resolve custom part types with the existing parseTypes loader. */
export function parseSetupText(text: string, selected?: RuntimeProfile | SetupTypeResolver): SetupResult {
  let value: unknown;
  try {
    value = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return {
      ok: false,
      errors: [{ path: '', code: 'not-parsed', message: String(cause).split('\n')[0] ?? '' }],
    };
  }
  const parsed = SetupDocument.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: 'shape',
        message: issue.message,
      })),
    };
  const setup = parsed.data;
  const profile = typeof selected === 'function' ? undefined : selected;
  if (profile && setup.runtime !== profile.name) return {
    ok: false, errors: [{ path: 'runtime', code: 'runtime', message: 'Setup runtime disagrees with the selected profile.' }],
  };
  const resolver: SetupTypeResolver | undefined = typeof selected === 'function' ? selected : profile ? (id) => id === profile.name ? profileOptions(profile) : undefined : undefined;
  const result = sourceTypes(setup, resolver);
  return result.ok ? { ok: true, setup, types: result.types } : result;
}

/** The root and provenance passed to a source reader; bindings already name their mapped absolute roots. */
export type ResolvedSetupSource = Omit<SetupSource, 'bindings'> & {
  root: string;
  types: TypeSet;
  provenance: { file: string; path: string };
  bindings: Array<NonNullable<SetupSource['bindings']>[number] & { root: string }>;
};

/** Resolve declared roots relative to the setup file. Tilde is an ordinary path segment, even for home. */
export function resolveSetupSources(
  setup: SetupDocument,
  file: string,
  options?: Readonly<Record<string, TypeSet>> | SetupTypeResolver,
): ResolvedSetupSource[] {
  const parsed = typeof options === 'function' || options === undefined ? sourceTypes(setup, options) : { ok: true as const, types: options };
  if (!parsed.ok) throw new Error(`Invalid source types: ${JSON.stringify(parsed.errors)}`);
  const types = parsed.types;
  const roots = new Map(setup.sources.map((source) => [source.id, resolve(dirname(file), source.path)]));
  const mappedRoot = (name: string) => {
    const source =
      name === 'project' || name === 'home'
        ? setup.sources.find((entry) => entry.kind === name)
        : setup.sources.find((entry) => entry.id === name);
    const root = source && roots.get(source.id);
    if (!root) throw new Error(`Unmapped source root: ${name}`);
    return root;
  };
  return setup.sources.map((source, index) => ({
    ...source,
    root: roots.get(source.id) as string,
    types: types[source.id] ?? { version: 1, types: [] },
    provenance: { file, path: `sources.${index}` },
    bindings: (source.bindings ?? []).map((target) => ({ ...target, root: mappedRoot(target.deployedRoot) })),
  }));
}

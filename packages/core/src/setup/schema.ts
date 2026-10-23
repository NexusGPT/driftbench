import { dirname, isAbsolute, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { compileGlob } from '../estate-model/glob';
import { parseTypes, type TypeSet, TypeSpec } from '../estate-model/part-type';
import { ASPECTS } from '../estate-model/vocabulary';
import { runtimeProfile, type RuntimeProfile } from '../runtime-profile/profile';

const identifier = z.string().regex(/^[a-z][a-z0-9-]*$/);
const relativePath = z.string().min(1).refine(
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
});
export type SetupSource = z.infer<typeof SetupSource>;

/** Version 1 of driftbench.setup.yaml. Strict fields prevent misspelled policies from becoming permissions. */
export const SetupDocument = z.strictObject({
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
    pricing: z.strictObject({
      inputUsdPerMillion: z.number().finite().nonnegative(),
      outputUsdPerMillion: z.number().finite().nonnegative(),
      inputTokensPerCall: z.number().int().nonnegative(),
      outputTokensPerCall: z.number().int().nonnegative(),
    }).optional(),
  }),
  privacy: z.strictObject({
    model: z.enum(['deny', 'allow']),
    exports: z.enum(['metadata', 'content']),
    exclude: z.array(glob),
  }),
  drift: z.strictObject({
    files: z.array(z.strictObject({ source: identifier, path: relativePath, sha256: z.string().regex(/^[a-f0-9]{64}$/) })),
  }).optional(),
}).superRefine((setup, context) => {
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
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
      const mapped = target.deployedRoot === 'project' || target.deployedRoot === 'home'
        ? setup.sources.some((entry) => entry.kind === target.deployedRoot)
        : ids.has(target.deployedRoot);
      if (!mapped) issue(['sources', index, 'bindings', at, 'deployedRoot'], 'Deployment root is not mapped.');
    }
  }
  if (setup.execute.policy === 'never' && setup.execute.commands.length > 0)
    issue(['execute', 'commands'], 'A never policy cannot allow commands.');
  const seen = new Set<string>();
  for (const [index, file] of (setup.drift?.files ?? []).entries()) {
    const key = `${file.source}:${file.path}`;
    if (!ids.has(file.source) || seen.has(key)) issue(['drift', 'files', index], 'Unknown source or duplicate drift path.');
    seen.add(key);
  }
});
export type SetupDocument = z.infer<typeof SetupDocument>;

/** A setup rejection is a structured field error; no prose is interpreted as setup data. */
export type SetupIssue = { path: string; code: string; message: string };
export type SetupResult = { ok: true; setup: SetupDocument; types: TypeSet } | { ok: false; errors: SetupIssue[] };

/** Parse YAML/JSON strictly and resolve custom part types with the existing parseTypes loader. */
export function parseSetupText(text: string, profile?: RuntimeProfile): SetupResult {
  let value: unknown;
  try {
    value = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    return { ok: false, errors: [{ path: '', code: 'not-parsed', message: String(cause).split('\n')[0] ?? '' }] };
  }
  const parsed = SetupDocument.safeParse(value);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((issue) => ({
    path: issue.path.map(String).join('.'), code: 'shape', message: issue.message,
  })) };
  const setup = parsed.data;
  profile ??= setup.runtime ? runtimeProfile(setup.runtime) : undefined;
  if (profile && setup.runtime !== profile.name) return { ok: false, errors: [{ path: 'runtime', code: 'runtime', message: 'Setup runtime disagrees with the selected profile.' }] };
  const types = parseTypes({ version: 1, types: setup.types ?? {} }, {
    runtime: setup.runtime ?? 'unknown', roots: profile?.roots ?? { project: '.' },
    ...(profile ? { base: profile.types, shapes: profile.shapes } : {}), source: 'driftbench.setup.yaml',
  });
  return types.ok ? { ok: true, setup, types: types.set } : { ok: false, errors: types.errors };
}

/** The root and provenance passed to a source reader; bindings already name their mapped absolute roots. */
export type ResolvedSetupSource = Omit<SetupSource, 'bindings'> & {
  root: string;
  types: TypeSet;
  provenance: { file: string; path: string };
  bindings: Array<NonNullable<SetupSource['bindings']>[number] & { root: string }>;
};

/** Resolve declared roots relative to the setup file. Tilde is an ordinary path segment, even for home. */
export function resolveSetupSources(setup: SetupDocument, file: string, types: TypeSet): ResolvedSetupSource[] {
  const roots = new Map(setup.sources.map((source) => [source.id, resolve(dirname(file), source.path)]));
  const mappedRoot = (name: string) => {
    const source = name === 'project' || name === 'home' ? setup.sources.find((entry) => entry.kind === name) : setup.sources.find((entry) => entry.id === name);
    const root = source && roots.get(source.id);
    if (!root) throw new Error(`Unmapped source root: ${name}`);
    return root;
  };
  return setup.sources.map((source, index) => ({
    ...source, root: roots.get(source.id) as string, types,
    provenance: { file, path: `sources.${index}` },
    bindings: (source.bindings ?? []).map((target) => ({ ...target, root: mappedRoot(target.deployedRoot) })),
  }));
}

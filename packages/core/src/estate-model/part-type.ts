import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import {
  type FieldRead,
  type Locator,
  parseFieldRead,
  parseLoaded,
  parseLocator,
  parseReferenceRule,
  type ReferenceRule,
} from './reads';
import { ASPECTS, type Aspect, LINK_KINDS, type LinkKind, type Loaded } from './vocabulary';

/**
 * Part types: what kinds of parts an agent setup holds, as data. A runtime profile ships its built-in types; a
 * user adds types in a types document (the `types:` key of the setup file, or a file of its own). A type says where
 * its parts are (`locate`), how to read their fields, which child types a part contains, which aspects its parts
 * have, when the runtime loads them, which runtime owns them, which type it extends, and how its parts point at
 * others. The schema is versioned: a document says `version: 1`, and a version this code does not know is refused.
 */

export const TYPES_SCHEMA_VERSION = 1;

/** One type as written. Every key is optional here; after inheritance `locate`, `aspects` and `loaded` are required. */
export const TypeSpec = z.strictObject({
  extends: z
    .string()
    .optional()
    .describe('The type this one inherits everything from, overriding what it names.'),
  root: z
    .string()
    .optional()
    .describe(
      'The root its globs are relative to, by name (the profile names its roots). Without one, a type is relative to the folder of the file that declares it, or located only inside its parents when a type contains it.',
    ),
  locate: z
    .union([z.string(), z.array(z.string()).min(1)])
    .optional()
    .describe('Where its parts are: globs, a folder glob ending in `/`, or `glob#$.json.path` for entries.'),
  entry: z.string().optional().describe('For a folder part, the file its fields are read from (`SKILL.md`).'),
  shape: z.string().optional().describe('A structure the file must have, by a name the reader knows.'),
  fields: z
    .record(z.string(), z.union([z.string(), z.array(z.string()).min(1)]))
    .optional()
    .describe('How each field is read; a list is tried in order, the first read that gives a value wins.'),
  contains: z.array(z.string()).optional().describe('Child types, located inside each part of this type.'),
  aspects: z.array(z.string()).optional().describe('What its parts do, from the fixed aspect vocabulary.'),
  loaded: z.string().optional().describe('When the runtime loads a part.'),
  runtime: z.string().optional().describe('The runtime that owns its parts; the profile runtime by default.'),
  references: z
    .array(z.string())
    .optional()
    .describe('How a part points at others: path, import(<prefix>), name, module.'),
  scope: z
    .strictObject({
      type: z.string(),
      by: z.enum(['name', 'folder']),
      link: z.string().optional(),
    })
    .optional()
    .describe('The parts of another type each part applies to, by the same name or the same folder.'),
});
export type TypeSpec = z.infer<typeof TypeSpec>;

export const TypesDocument = z.strictObject({
  version: z.number().int().describe('The types schema version, 1.'),
  types: z.record(z.string(), TypeSpec),
});
export type TypesDocument = z.infer<typeof TypesDocument>;

/** A type with its inheritance applied and every grammar parsed. */
export type PartType = {
  name: string;
  extends?: string;
  /** The root its globs are relative to, by name, when it names one. */
  root?: string;
  /**
   * The folder, relative to the estate root, its globs are matched from; undefined for a type located only inside
   * the parts that contain it.
   */
  folder?: string;
  locate: Locator[];
  entry?: string;
  shape?: string;
  fields: Record<string, FieldRead[]>;
  contains: string[];
  aspects: Aspect[];
  loaded: Loaded;
  runtime: string;
  references: ReferenceRule[];
  scope?: { type: string; by: 'name' | 'folder'; link: LinkKind };
  /** Where the type was declared: a file, or the profile that ships it. */
  source: string;
};

/** The types of an estate, in order: the profile's first, then each document's in the order it declares them. */
export type TypeSet = { version: typeof TYPES_SCHEMA_VERSION; types: readonly PartType[] };

/** Why a types document was refused, as a code a reader branches on. */
export const TYPES_ERROR_CODES = [
  'not-parsed',
  'shape',
  'version',
  'type-name',
  'redefined',
  'unknown-type',
  'extends-cycle',
  'contains-cycle',
  'unknown-root',
  'missing-locate',
  'missing-aspects',
  'missing-loaded',
  'unknown-aspect',
  'duplicate-aspect',
  'loaded',
  'reference',
  'field-read',
  'locator',
  'entry-without-folder',
  'entry-name',
  'unknown-shape',
  'runtime-name',
  'link-kind',
] as const;
export type TypesErrorCode = (typeof TYPES_ERROR_CODES)[number];

/** One refusal: where in the document (`types.<name>.<key>`), its code, and the sub-code of a grammar, if any. */
export type TypesError = { path: string; code: TypesErrorCode; reason?: string; message: string };

export type TypesResult = { ok: true; set: TypeSet } | { ok: false; errors: TypesError[] };

export type TypesOptions = {
  /** The host runtime: the runtime of a type that names none. */
  runtime: string;
  /** The roots a type may name, each a folder relative to the estate root. */
  roots: Readonly<Record<string, string>>;
  /** The types already defined (a profile's), which this document may extend, contain or scope. */
  base?: TypeSet;
  /** The folder of the file that declares the document, relative to the estate root. Default `.`. */
  folder?: string;
  /** Where the document was read from, for messages and `PartType.source`. */
  source?: string;
  /** The shapes the reader can test a file for; a type naming another is refused. Undefined accepts any. */
  shapes?: readonly string[];
};

const NAME = /^[a-z][a-z0-9-]*$/;
/** A plain file name: no folder separator, and never `.` or `..`, which would leave the part's folder. */
const ENTRY = /^(?!\.\.?$)[^/\\]+$/;

/** Parses a types document written as YAML or JSON (JSON is YAML too). */
export function parseTypesText(text: string, options: TypesOptions): TypesResult {
  let value: unknown;
  try {
    value = parseYaml(text, { uniqueKeys: true });
  } catch (cause) {
    const message = cause instanceof Error ? (cause.message.split('\n')[0] ?? '') : String(cause);
    return { ok: false, errors: [{ path: '', code: 'not-parsed', message }] };
  }
  return parseTypes(value, options);
}

/** Validates a types document strictly and resolves each type's inheritance against the base types. */
export function parseTypes(input: unknown, options: TypesOptions): TypesResult {
  const parsed = TypesDocument.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => ({
        path: issue.path.map(String).join('.'),
        code: 'shape' as const,
        message: issue.message,
      })),
    };
  }
  const document = parsed.data;
  if (document.version !== TYPES_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        {
          path: 'version',
          code: 'version',
          message: `types schema version ${document.version} is not known; this code reads version ${TYPES_SCHEMA_VERSION}`,
        },
      ],
    };
  }
  const errors: TypesError[] = [];
  const error = (path: string, code: TypesErrorCode, message: string, reason?: string) =>
    errors.push({ path, code, message, ...(reason !== undefined ? { reason } : {}) });
  const base = new Map((options.base?.types ?? []).map((type) => [type.name, type]));
  const specs = Object.entries(document.types);
  const own = new Map(specs);
  for (const [name] of specs) {
    if (!NAME.test(name))
      error(`types.${name}`, 'type-name', `${name}: a type name is lowercase letters, digits and dashes`);
    if (base.has(name))
      error(`types.${name}`, 'redefined', `${name} is already defined by ${base.get(name)?.source}`);
  }
  const known = (name: string) => own.has(name) || base.has(name);
  // Every type a document type contains is located inside its parents, unless it names a root.
  const contained = new Set<string>([...base.values()].flatMap((type) => type.contains));
  for (const [, spec] of specs) for (const child of spec.contains ?? []) contained.add(child);

  for (const [name, spec] of specs) {
    const at = `types.${name}`;
    if (spec.extends !== undefined && !known(spec.extends))
      error(`${at}.extends`, 'unknown-type', `${name} extends ${spec.extends}, which no type defines`);
    for (const child of spec.contains ?? [])
      if (!known(child))
        error(`${at}.contains`, 'unknown-type', `${name} contains ${child}, which no type defines`);
    if (spec.scope && !known(spec.scope.type))
      error(
        `${at}.scope.type`,
        'unknown-type',
        `${name} is scoped to ${spec.scope.type}, which no type defines`,
      );
    if (spec.root !== undefined && options.roots[spec.root] === undefined)
      error(
        `${at}.root`,
        'unknown-root',
        `${name} names the root ${spec.root}; the roots are ${Object.keys(options.roots).join(', ')}`,
      );
  }
  if (errors.length > 0) return { ok: false, errors };

  // Inheritance: a cycle of `extends` is refused; otherwise each type resolves after its parent.
  const resolved = new Map<string, PartType>(base);
  const resolving = new Set<string>();
  const refused = new Set<string>();
  const resolve = (name: string): PartType | undefined => {
    const done = resolved.get(name);
    if (done) return done;
    const spec = own.get(name);
    if (!spec || refused.has(name)) return undefined;
    if (resolving.has(name)) {
      const chain = [...resolving, name];
      error(
        `types.${name}.extends`,
        'extends-cycle',
        `${chain.join(' extends ')}: a type cannot extend itself`,
      );
      for (const member of resolving) refused.add(member);
      return undefined;
    }
    resolving.add(name);
    const parent = spec.extends !== undefined ? resolve(spec.extends) : undefined;
    resolving.delete(name);
    if (spec.extends !== undefined && !parent) {
      refused.add(name);
      return undefined;
    }
    const type = resolveType(name, spec, parent, contained.has(name), options, error);
    if (type) resolved.set(name, type);
    else refused.add(name);
    return type;
  };
  for (const [name] of specs) resolve(name);
  if (errors.length > 0) return { ok: false, errors };

  const types = [...(options.base?.types ?? []), ...specs.map(([name]) => resolved.get(name) as PartType)];
  const cycle = containsCycle(types);
  if (cycle)
    return {
      ok: false,
      errors: [
        {
          path: `types.${cycle[0]}.contains`,
          code: 'contains-cycle',
          message: `${cycle.join(' contains ')}: a type cannot contain itself`,
        },
      ],
    };
  return { ok: true, set: { version: TYPES_SCHEMA_VERSION, types } };
}

function resolveType(
  name: string,
  spec: TypeSpec,
  parent: PartType | undefined,
  contained: boolean,
  options: TypesOptions,
  error: (path: string, code: TypesErrorCode, message: string, reason?: string) => void,
): PartType | undefined {
  const at = `types.${name}`;
  let failed = false;
  const fail = (path: string, code: TypesErrorCode, message: string, reason?: string) => {
    failed = true;
    error(path, code, message, reason);
  };

  const locate: Locator[] = [];
  if (spec.locate !== undefined) {
    for (const [index, written] of (Array.isArray(spec.locate) ? spec.locate : [spec.locate]).entries()) {
      const locator = parseLocator(written);
      if (locator.ok) locate.push(locator.locator);
      else
        fail(
          `${at}.locate[${index}]`,
          'locator',
          `${name}: the locator ${written} is refused (${locator.error})`,
          locator.error,
        );
    }
  } else if (parent) locate.push(...parent.locate);
  if (locate.length === 0 && !failed)
    fail(`${at}.locate`, 'missing-locate', `${name} says nowhere its parts are`);

  const aspects: Aspect[] = spec.aspects === undefined ? [...(parent?.aspects ?? [])] : [];
  for (const [index, aspect] of (spec.aspects ?? []).entries()) {
    if (!(ASPECTS as readonly string[]).includes(aspect))
      fail(
        `${at}.aspects[${index}]`,
        'unknown-aspect',
        `${name}: ${aspect} is no aspect; the aspects are ${ASPECTS.join(', ')}`,
      );
    else if (aspects.includes(aspect as Aspect))
      fail(`${at}.aspects[${index}]`, 'duplicate-aspect', `${name}: ${aspect} is listed twice`);
    else aspects.push(aspect as Aspect);
  }
  if (aspects.length === 0 && !failed) fail(`${at}.aspects`, 'missing-aspects', `${name} names no aspect`);

  let loaded: Loaded | undefined = parent?.loaded;
  if (spec.loaded !== undefined) {
    loaded = parseLoaded(spec.loaded);
    if (!loaded)
      fail(
        `${at}.loaded`,
        'loaded',
        `${name}: loaded ${spec.loaded} is refused; it is always, on-demand, on-event, on-event(<event>), on-mention or by-reference`,
      );
  } else if (!loaded) fail(`${at}.loaded`, 'missing-loaded', `${name} says nothing of when it loads`);

  const fields: Record<string, FieldRead[]> = { ...(parent?.fields ?? {}) };
  for (const [field, written] of Object.entries(spec.fields ?? {})) {
    const reads: FieldRead[] = [];
    for (const [index, text] of (Array.isArray(written) ? written : [written]).entries()) {
      const read = parseFieldRead(text);
      if (read.ok) reads.push(read.read);
      else
        fail(
          `${at}.fields.${field}[${index}]`,
          'field-read',
          `${name}: the field read ${text} is refused (${read.error})`,
          read.error,
        );
    }
    fields[field] = reads;
  }

  const references: ReferenceRule[] = [];
  if (spec.references !== undefined) {
    for (const [index, text] of spec.references.entries()) {
      const rule = parseReferenceRule(text);
      if (rule) references.push(rule);
      else
        fail(
          `${at}.references[${index}]`,
          'reference',
          `${name}: ${text} is refused; a reference rule is path, name or import(<prefix>)`,
        );
    }
  } else if (parent) references.push(...parent.references);

  const entry = spec.entry ?? parent?.entry;
  if (entry !== undefined) {
    if (!ENTRY.test(entry))
      fail(`${at}.entry`, 'entry-name', `${name}: the entry ${entry} is a file name, with no folder`);
    else if (!locate.some((locator) => locator.glob.folder))
      fail(
        `${at}.entry`,
        'entry-without-folder',
        `${name} has an entry but locates no folder (a glob ending in /)`,
      );
  }

  const shape = spec.shape ?? parent?.shape;
  if (shape !== undefined && options.shapes && !options.shapes.includes(shape))
    fail(
      `${at}.shape`,
      'unknown-shape',
      `${name}: the shape ${shape} is not known; the shapes are ${options.shapes.join(', ')}`,
    );

  const runtime = spec.runtime ?? parent?.runtime ?? options.runtime;
  if (!NAME.test(runtime)) fail(`${at}.runtime`, 'runtime-name', `${name}: ${runtime} is not a runtime name`);

  let scope: PartType['scope'];
  const scopeSpec = spec.scope;
  if (scopeSpec) {
    const link = scopeSpec.link ?? 'configures';
    if (!(LINK_KINDS as readonly string[]).includes(link))
      fail(
        `${at}.scope.link`,
        'link-kind',
        `${name}: ${link} is no link kind; the kinds are ${LINK_KINDS.join(', ')}`,
      );
    else scope = { type: scopeSpec.type, by: scopeSpec.by, link: link as LinkKind };
  } else scope = parent?.scope;

  if (failed || !loaded) return undefined;
  const folder =
    spec.root !== undefined ? options.roots[spec.root] : contained ? undefined : (options.folder ?? '.');
  return {
    name,
    ...(spec.extends !== undefined ? { extends: spec.extends } : {}),
    ...(spec.root !== undefined ? { root: spec.root } : {}),
    ...(folder !== undefined ? { folder } : {}),
    locate,
    ...(entry !== undefined ? { entry } : {}),
    ...(shape !== undefined ? { shape } : {}),
    fields,
    contains: spec.contains ?? parent?.contains ?? [],
    aspects,
    loaded,
    runtime,
    references,
    ...(scope ? { scope } : {}),
    source: options.source ?? 'types document',
  };
}

/** A chain of types that contain each other back to the first, or undefined. */
function containsCycle(types: readonly PartType[]): string[] | undefined {
  const byName = new Map(types.map((type) => [type.name, type]));
  const state = new Map<string, 'open' | 'done'>();
  const path: string[] = [];
  const visit = (name: string): string[] | undefined => {
    if (state.get(name) === 'done') return undefined;
    if (state.get(name) === 'open') return [...path.slice(path.indexOf(name)), name];
    state.set(name, 'open');
    path.push(name);
    for (const child of byName.get(name)?.contains ?? []) {
      const found = visit(child);
      if (found) return found;
    }
    path.pop();
    state.set(name, 'done');
    return undefined;
  };
  for (const type of types) {
    const found = visit(type.name);
    if (found) return found;
  }
  return undefined;
}

/** The type of a set by name. */
export function typeNamed(set: TypeSet, name: string): PartType | undefined {
  return set.types.find((type) => type.name === name);
}

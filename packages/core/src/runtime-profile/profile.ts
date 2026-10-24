import { locateFile } from '../estate-model/locate';
import type { TypeSet } from '../estate-model/part-type';
import type { Aspect } from '../estate-model/vocabulary';

/**
 * A runtime profile: what an agent runtime loads from an estate, and how. The estate scanner, the mutant
 * copier and the adapters read the layout from a profile instead of assuming one; adding a runtime is a new
 * profile (data, plus the few rules below) registered under its name, never a change to the readers.
 *
 * Every path in a profile is relative to the estate root and written with `/`.
 */

/** How the runtime reaches a skill: a route table in the standing files, the skill's description, or its name. */
export type RoutingRule = 'route-table' | 'description' | 'name';

/**
 * Where the runtime's settings come from: files the estate holds as they are (`static`), or one file the user
 * renders beforehand and names on the command line (`rendered`, e.g. a settings file a build step writes).
 * A rendered copy is read as the settings file of the place `file` names (relative to the estate root), so its
 * parts are the parts that file would give; it is accepted only when the estate holds no file of that place.
 */
export type SettingsSource =
  | { kind: 'static'; files: readonly string[] }
  | { kind: 'rendered'; file: string };

/**
 * The standing instructions the reader lists by name. Where every standing file lies, and how a standing file
 * imports another, are its part types' (`types`).
 */
export type StandingProfile = {
  /** The standing files at the root the reader lists by name (the others live inside the layout folder). */
  rootFiles: readonly string[];
  /** The main standing file, the one whose scope the map names `standing`. */
  primary: string;
};

/** The layout folder, walked whole, and the files beside it the runtime reads. What lies inside is its types'. */
export type LayoutProfile = {
  /** The folder the runtime owns at the root (walked whole, by the reader). */
  root: string;
  /** Files beside the layout folder the runtime reads on its own (a tool server list). */
  extraFiles: readonly string[];
};

/** The variables the runtime expands in a path, by role. A `home` path maps to `--home` when one is given. */
export type PathVariables = {
  /** The project folder (the estate root). */
  project: readonly string[];
  /** The folder of a plugin the estate ships. */
  plugin: readonly string[];
  /** The working folder at the time a command runs. */
  working: readonly string[];
  /** The user's home folder. */
  home: readonly string[];
};

/**
 * What one tool of a runtime does, as aspects, and whether a permission rule on it names a part of the estate.
 * A check of the policy reads these and never a tool's name: `acts` (it touches a file or a service), `executes`
 * (it runs a program), `instructs` or `delegates` (a skill's text, another reasoning context).
 */
export type PolicyTool = {
  aspects: readonly Aspect[];
  /** For a tool whose rule argument names a part of the estate (a skill, a helper): the type of the part. */
  names?: string;
};

/**
 * The permission model of a runtime: the tools a rule can name, what each does, and the setting that holds the
 * default mode with the modes in which no allow rule decides anything. A rule is written `Tool(argument)`, or
 * `Tool` alone for any argument; a `*` in an argument stands for any text.
 */
export type PolicyModel = {
  tools: Readonly<Record<string, PolicyTool>>;
  mode: { setting: string; unchecked: readonly string[] };
};

export type RuntimeProfile = {
  /** The name the CLI and an estate map give the runtime. */
  name: string;
  /** The roots its part types are relative to, by name, each a folder relative to the estate root. */
  roots: Readonly<Record<string, string>>;
  /** Its built-in part types, in the order a file is classified in (docs/estate-model.md). */
  types: TypeSet;
  /**
   * The kind today's estate map gives a file of each type, by type name. A file takes the kind of the first
   * mapped type, in the order of `types`, that locates it; a file no mapped type locates is `other`.
   */
  mapKinds: Readonly<Record<string, string>>;
  /** The structures its reader can test a file for, which a type's `shape` names. */
  shapes: readonly string[];
  /**
   * The roots, by name, whose every file counts for coverage: a file under one that no type covers is unknown.
   * A file outside them counts only when a type locates it or a reference of the estate reaches it.
   */
  coverageRoots: readonly string[];
  layout: LayoutProfile;
  standing: StandingProfile;
  /** Where settings come from; the first static source is what the reader classifies as settings. */
  settings: readonly SettingsSource[];
  /** The folders a bare skill or file name is looked up in, in order (relative to the root). */
  bases: readonly string[];
  routing: readonly RoutingRule[];
  pathVariables: PathVariables;
  /** The permission model; a runtime without one has no policy checks. */
  policy?: PolicyModel;
  /** True for a file the runtime puts in its context by itself: no call ever shows a read of it. */
  loadsItself(path: string): boolean;
  /** What a mutant copy of the estate holds by default: files and folders, copied whole. */
  copyFiles: readonly string[];
  /** Where the estate configuration (`driftbench.estate.yaml`) may live, the first found winning. */
  configFiles: readonly string[];
  /** Globs no runtime of this kind loads, skipped by default (matched like `.gitignore` lines). */
  ignore: readonly string[];
  /** Ignore files the reader honours when present (e.g. `.gitignore`); empty to honour none. */
  ignoreFiles: readonly string[];
};

/**
 * The rule for the files a runtime puts in its context by itself, from its types: a file a type of the runtime
 * locates whose parts load `always` and `instructs` (text the model reads). No call ever shows a read of one.
 */
export function loadsByItself(name: string, types: TypeSet): (path: string) => boolean {
  const own = types.types.filter(
    (type) => type.runtime === name && type.loaded.when === 'always' && type.aspects.includes('instructs'),
  );
  return (path) => {
    // A leading `./` or `/` goes, and a run of slashes is one: the file is the same file.
    const clean = path.replace(/^\.?\/+/, '').replace(/\/+/g, '/');
    return own.some((type) => locateFile(type, clean) !== undefined);
  };
}

/** Why a runtime profile is refused when it is registered, as a code a reader branches on. */
export const PROFILE_ERROR_CODES = ['unknown-coverage-root'] as const;
export type ProfileErrorCode = (typeof PROFILE_ERROR_CODES)[number];
export type ProfileError = { code: ProfileErrorCode; path: string; message: string };

/** A profile refused at registration, with every fault. */
export class RuntimeProfileError extends Error {
  readonly errors: readonly ProfileError[];
  constructor(name: string, errors: readonly ProfileError[]) {
    super(`the runtime profile ${name} is refused: ${errors.map((error) => error.message).join('; ')}`);
    this.name = 'RuntimeProfileError';
    this.errors = errors;
  }
}

/**
 * The faults of a profile: a coverage root that names no root of the profile would turn the count of unknown files
 * off with no signal, so it is refused.
 */
export function profileErrors(profile: RuntimeProfile): ProfileError[] {
  // Only the profile's own roots resolve: a name every object inherits (`toString`) is no root.
  return profile.coverageRoots.flatMap((name, index) =>
    !Object.hasOwn(profile.roots, name) || typeof profile.roots[name] !== 'string'
      ? [
          {
            code: 'unknown-coverage-root' as const,
            path: `coverageRoots[${index}]`,
            message: `coverage root ${name} is no root of the profile; the roots are ${Object.keys(profile.roots).join(', ')}`,
          },
        ]
      : [],
  );
}

/** The folders, relative to the estate root, whose every file counts for coverage. */
export function coverageFolders(profile: RuntimeProfile): string[] {
  const errors = profileErrors(profile);
  if (errors.length > 0) throw new RuntimeProfileError(profile.name, errors);
  return profile.coverageRoots.map((name) => profile.roots[name] as string);
}

/** The place a rendered copy of the settings stands in, or undefined when the profile takes no rendered copy. */
export function renderedSettingsFile(profile: RuntimeProfile): string | undefined {
  for (const source of profile.settings) if (source.kind === 'rendered') return source.file;
  return undefined;
}

/** The files of the settings sources that are static, in order. */
export function staticSettingsFiles(profile: RuntimeProfile): string[] {
  return profile.settings.flatMap((source) => (source.kind === 'static' ? [...source.files] : []));
}

/**
 * A pattern that matches a path written behind one of the variables, `$NAME/` or `${NAME}/`. `balanced` asks
 * for matching braces; otherwise either brace may stand alone, as the loose readers have always accepted.
 */
export function variablePrefix(names: readonly string[], options: { balanced?: boolean } = {}): RegExp {
  const alternatives = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return options.balanced
    ? new RegExp(`^\\$(?:\\{(?:${alternatives})\\}|(?:${alternatives}))\\/`)
    : new RegExp(`^\\$\\{?(?:${alternatives})\\}?\\/`);
}

const PROFILES = new Map<string, RuntimeProfile>();

/**
 * Registers a profile under its name. A second profile of the same name is refused, and so is a profile with a
 * fault (`profileErrors`), with a `RuntimeProfileError` that holds every fault's code.
 */
export function registerRuntimeProfile(profile: RuntimeProfile): void {
  if (PROFILES.has(profile.name))
    throw new Error(`a runtime profile named ${profile.name} is already registered`);
  const errors = profileErrors(profile);
  if (errors.length > 0) throw new RuntimeProfileError(profile.name, errors);
  PROFILES.set(profile.name, profile);
}

/** The profile of a runtime, by the name an estate map gives it, or undefined for a runtime with none. */
export function runtimeProfile(name: string): RuntimeProfile | undefined {
  return PROFILES.get(name);
}

/** The names of the registered runtimes, in the order they were registered. */
export function runtimeProfileNames(): string[] {
  return [...PROFILES.keys()];
}

import { locateFile } from '../estate-model/locate';
import type { TypeSet } from '../estate-model/part-type';

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
 * A second source of parts beside the estate: a folder a person names (the skills of one user, a shared kit) that
 * the runtime loads from as well. Its parts are of the types listed here, found from the folder as from a root of
 * their own, and are checked as the estate's parts are.
 */
export type SourceDecl = {
  /** The option that names the source's folder (`userSkills`: the `--user-skills` option and the setup key). */
  option: string;
  /** The profile's types whose parts the source holds, by type name. */
  types: readonly string[];
  /**
   * The name the source's paths go by when its folder is the runtime's own default one, so a map holds no home
   * folder. Any other folder is named by its real folder.
   */
  label: string;
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
  /** Its second sources of parts, by source name. */
  sources: Readonly<Record<string, SourceDecl>>;
  layout: LayoutProfile;
  standing: StandingProfile;
  /** Where settings come from; the first static source is what the reader classifies as settings. */
  settings: readonly SettingsSource[];
  /** The folders a bare skill or file name is looked up in, in order (relative to the root). */
  bases: readonly string[];
  routing: readonly RoutingRule[];
  pathVariables: PathVariables;
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

/** Registers a profile under its name; a second profile of the same name is refused. */
export function registerRuntimeProfile(profile: RuntimeProfile): void {
  if (PROFILES.has(profile.name))
    throw new Error(`a runtime profile named ${profile.name} is already registered`);
  const known = new Set(profile.types.types.map((type) => type.name));
  for (const [name, source] of Object.entries(profile.sources))
    for (const type of source.types)
      if (!known.has(type))
        throw new Error(
          `the source ${name} of the runtime profile ${profile.name} names the unknown type ${type}`,
        );
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

/**
 * The fixed vocabulary of the estate model. Part types are open data a profile or a user declares; these words are
 * closed. A check reads only aspects and links, never a type name or a path, so a new type is checked by the
 * checks that already exist the moment it names its aspects.
 */

/**
 * What a part does for the runtime, one word each:
 * - `instructs`: text the model reads.
 * - `acts`: an action the model can call.
 * - `guards`: can block or alter an action when an event fires.
 * - `delegates`: starts another reasoning context.
 * - `informs`: facts the model retrieves.
 * - `configures`: changes how the runtime behaves.
 * - `invokes`: a shortcut a person types.
 * - `executes`: code another part runs.
 * - `indexes`: lists other parts.
 * - `person-facing`: seen by people, never by the model.
 */
export const ASPECTS = [
  'instructs',
  'acts',
  'guards',
  'delegates',
  'informs',
  'configures',
  'invokes',
  'executes',
  'indexes',
  'person-facing',
] as const;
export type Aspect = (typeof ASPECTS)[number];

/**
 * How one part points at another:
 * - `includes`: the target's text becomes part of the source's (an import).
 * - `references`: the source names the target (a path in prose, a name).
 * - `routes-to`: the source sends a kind of request to the target (a route table row).
 * - `guards`: the source watches or blocks the target.
 * - `loads`: the source makes the runtime load the target.
 * - `delegates-to`: the source hands work to the target, a new reasoning context.
 * - `indexes`: the source lists the target.
 * - `configures`: the source changes how the target behaves.
 */
export const LINK_KINDS = [
  'includes',
  'references',
  'routes-to',
  'guards',
  'loads',
  'delegates-to',
  'indexes',
  'configures',
] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * When the runtime loads a part: before every turn (`always`), when the model asks for it (`on-demand`), when an
 * event fires (`on-event`, optionally one event), when a person or a route names it (`on-mention`), or only when
 * another part points at it (`by-reference`).
 */
export const LOAD_TIMES = ['always', 'on-demand', 'on-event', 'on-mention', 'by-reference'] as const;
export type LoadTime = (typeof LOAD_TIMES)[number];

/** A load time, with the event for `on-event` when the type names one. */
export type Loaded = { when: LoadTime; event?: string };

/** The confidence of a link or finding read from structure: the top of the range. */
export const PROVEN_CONFIDENCE = 1;

/**
 * The confidence of a link or finding a reader inferred from an assumption (for example a wildcard rule whose
 * program is unknown). The model fixes only that it is below PROVEN_CONFIDENCE; a reader compares with
 * PROVEN_CONFIDENCE and never reads this number's size.
 */
export const INFERRED_CONFIDENCE = 0.5;

/** How a link was found: the reader that found it, the file and line it read it from. */
export type LinkProvenance = { reader: string; file: string; line?: number };

/**
 * A typed link between two parts, by part id. `confidence` is between 0 and 1: 1 for a link read from structure (a
 * declaration, a containment, a scope), lower for a link a reader inferred.
 */
export type Link = {
  from: string;
  to: string;
  kind: LinkKind;
  provenance: LinkProvenance;
  confidence: number;
};

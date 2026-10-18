import { BANK_COMPONENTS } from '../common';
import { compareFacts, listFacts, type Parts, proposalFacts } from '../facts';
import { allOf, checkMap, failedSections, mapItem, runProblem } from '../run';
import {
  type Extras,
  PERSONA_IDS,
  type RenderStyled,
  renderStyled,
  STRUCTURES,
  STYLES,
  type Style,
  type StyledOptions,
  styledAtSize,
  styledSpec,
} from '../styled';
import { type BankItem, type Case, levelOf, type Tier } from '../types';

/**
 * The families written in prompt styles: every style alone and three-way mixes (styles), every pair of
 * styles (style-pairs), the semantics a prompt states that the map must carry (semantics), the declared
 * roles (roles), metamorphic transforms (transforms), additivity and unit response (composition), and the
 * same prompts at 100k characters and more under a time budget (scale).
 */

/** The parts a styled item checks: the whole map but roles. */
const MAP: Parts = {
  values: true,
  fields: true,
  produced: true,
  constraints: true,
  phrases: true,
  relations: true,
};

function styledCase(label: string, options: StyledOptions, render: RenderStyled = {}, budgetMs?: number) {
  const { rendered } = styledAtSize(options, render);
  const item: Case = {
    label,
    sources: rendered.sources,
    planted: rendered.planted,
    ...(budgetMs ? { budgetMs } : {}),
  };
  return { item, code: rendered.code };
}

function styledItem(meta: {
  id: string;
  family: string;
  tier: Tier;
  level: number;
  component: string;
  title: string;
  styles: Style[];
  extras?: Extras;
  size?: number;
  budgetMs?: number;
  parts?: Parts;
  cause?: string;
  render?: RenderStyled;
}): BankItem {
  return mapItem({
    ...meta,
    cause: meta.cause ?? styleCause(meta.styles, meta.extras),
    build: (seed) => {
      const built = styledCase(
        meta.id,
        {
          styles: meta.styles,
          seed,
          salt: meta.id,
          ...(meta.size ? { size: meta.size } : {}),
          ...(meta.extras ? { extras: meta.extras } : {}),
        },
        meta.render ?? {},
        meta.budgetMs,
      );
      const cause = meta.cause ?? styleCause(meta.styles, meta.extras);
      return { case: built.item, code: built.code, parts: meta.parts ?? { ...MAP, fields: fieldsOf(cause) } };
    },
  });
}

/**
 * The one change a styled item waits on: the most specific field its prompt states that the map cannot
 * carry. Every styled rule has a polarity, so polarity is the cause of an item that states nothing more.
 */
export function styleCause(styles: readonly Style[], extras: Extras = {}): string {
  if (extras.roles) return 'contract:dimension-role';
  if (extras.weights) return 'contract:value-weight';
  if (extras.required) return 'contract:value-required';
  if (extras.toolOrder) return 'contract:relation-tool-order';
  if (extras.routes) return 'contract:relation-route';
  if (extras.replies) return 'contract:relation-reply-text';
  if (extras.exceptions) return 'contract:rule-unless';
  if (extras.limits) return 'contract:rule-limit';
  if (extras.deadlines) return 'contract:rule-within';
  if (extras.priorities) return 'contract:rule-priority';
  if (extras.stageScope || extras.flowScope) return 'contract:rule-when';
  if (styles.some((style) => style === 'conditional' || style === 'nested' || style === 'table'))
    return 'contract:rule-when';
  return 'contract:rule-polarity';
}

/**
 * The value fields an item checks: only the one its cause adds, so the item turns green on that one change.
 * Items whose cause is no field (a relation, a chunking change) check no field.
 */
export function fieldsOf(cause: string): string[] {
  const field: Record<string, string> = {
    'contract:rule-polarity': 'polarity',
    'contract:rule-when': 'when',
    'contract:rule-unless': 'unless',
    'contract:rule-limit': 'limit',
    'contract:rule-within': 'within',
    'contract:rule-priority': 'priority',
    'contract:value-weight': 'weight',
    'contract:value-required': 'required',
  };
  return field[cause] ? [field[cause] as string] : [];
}

const STYLE_TIER: Record<Style, Tier> = {
  markdown: 1,
  numbered: 1,
  prose: 2,
  table: 2,
  nested: 3,
  multilingual: 3,
  negation: 2,
  conditional: 3,
  'tool-reference': 3,
  question: 3,
  'contradicting-example': 3,
  deprecated: 2,
  precedence: 4,
  'hidden-in-example': 4,
};

const STYLE_TITLE: Record<Style, string> = {
  markdown: 'markdown headings and bullets',
  numbered: 'numbered sections and items',
  prose: 'plain paragraphs, three rules to a paragraph',
  table: 'markdown tables with an "applies to" column',
  nested: 'nested sections that scope rules to a channel',
  multilingual: 'sections and rules in French and English',
  negation: 'most rules are prohibitions',
  conditional: 'rules that hold only on a channel or for a kind of customer',
  'tool-reference': 'rules that call a tool at a stage',
  question: 'rules phrased as questions and answers',
  'contradicting-example': 'example replies that break the rules',
  deprecated: 'a section of rules no longer in force',
  precedence: 'a later rule that replaces an earlier one',
  'hidden-in-example': 'rules stated inside example conversations',
};

/** Seven three-way mixes: one structure, one phrasing, one trap each. */
export const TRIPLES: ReadonlyArray<[Style, Style, Style]> = [
  ['table', 'negation', 'deprecated'],
  ['nested', 'conditional', 'precedence'],
  ['prose', 'question', 'hidden-in-example'],
  ['numbered', 'multilingual', 'contradicting-example'],
  ['markdown', 'tool-reference', 'precedence'],
  ['table', 'question', 'hidden-in-example'],
  ['nested', 'multilingual', 'deprecated'],
];

export function styleItems(): BankItem[] {
  const singles = STYLES.map((style) =>
    styledItem({
      id: `styles.${style}`,
      family: 'styles',
      tier: STYLE_TIER[style],
      level: levelOf('prose'),
      component: BANK_COMPONENTS.contract,
      title: `rules, polarity, conditions, stages, kinds of customer and relations in ${STYLE_TITLE[style]}`,
      styles: [style],
    }),
  );
  const triples = TRIPLES.map((styles) =>
    styledItem({
      id: `styles.${styles.join('+')}`,
      family: 'styles',
      tier: 5,
      level: levelOf('prose'),
      component: BANK_COMPONENTS.contract,
      title: `the full map of a prompt in three styles at once: ${styles.join(', ')}`,
      styles: [...styles],
    }),
  );
  return [...singles, ...triples];
}

export function pairItems(): BankItem[] {
  const out: BankItem[] = [];
  STYLES.forEach((first, i) => {
    STYLES.slice(i + 1).forEach((second) => {
      out.push(
        styledItem({
          id: `style-pairs.${first}+${second}`,
          family: 'style-pairs',
          tier: Math.min(5, Math.max(STYLE_TIER[first], STYLE_TIER[second]) + 1) as Tier,
          level: levelOf('prose'),
          component: BANK_COMPONENTS.contract,
          title: `the full map of a prompt that mixes ${STYLE_TITLE[first]} with ${STYLE_TITLE[second]}`,
          styles: [first, second],
        }),
      );
    });
  });
  return out;
}

/** Semantics a prompt states and a map must carry, each in two or three styles. */
export function semanticsItems(): BankItem[] {
  const cases: Array<{
    slug: string;
    tier: Tier;
    title: string;
    styles: Style[];
    extras?: Extras;
    component: string;
  }> = [];
  const add = (
    slug: string,
    tier: Tier,
    title: string,
    variants: Style[][],
    extras?: Extras,
    component: string = BANK_COMPONENTS.proposal,
  ) => {
    variants.forEach((styles, index) => {
      cases.push({
        slug: `${slug}.${index + 1}`,
        tier,
        title: `${title} (${styles.join(', ')})`,
        styles,
        ...(extras ? { extras } : {}),
        component,
      });
    });
  };
  add('polarity', 2, 'each rule carries its polarity, must or must_not', [
    ['markdown'],
    ['negation'],
    ['prose', 'negation'],
    ['table'],
    ['nested'],
    ['numbered', 'negation'],
  ]);
  add('polarity-traps', 3, 'the rules left after the traps carry their polarity', [
    ['deprecated', 'negation'],
    ['contradicting-example'],
    ['hidden-in-example', 'negation'],
  ]);
  add('polarity-question', 3, 'a rule asked as a question carries the polarity of its answer', [
    ['question'],
    ['question', 'negation'],
    ['table', 'question'],
  ]);
  add('polarity-french', 3, 'a French prohibition carries must_not', [
    ['multilingual', 'negation'],
    ['multilingual', 'numbered'],
  ]);
  add('when-channel', 3, 'a rule that holds on one channel or for one kind of customer carries when', [
    ['conditional'],
    ['conditional', 'numbered'],
    ['conditional', 'negation'],
    ['conditional', 'prose'],
    ['conditional', 'multilingual'],
  ]);
  add('when-scope-nested', 4, 'a rule under a channel heading carries when channel', [
    ['nested'],
    ['nested', 'negation'],
    ['nested', 'question'],
  ]);
  add('when-scope-table', 4, 'a rule whose table row applies to one channel carries when channel', [
    ['table'],
    ['table', 'negation'],
  ]);
  add('when-stage', 3, 'a rule that holds at one stage carries when stage', [['markdown'], ['prose']], {
    stageScope: true,
  });
  add(
    'when-flow',
    4,
    'a rule under a flow heading carries when flow',
    [['nested'], ['nested', 'conditional']],
    { flowScope: true },
  );
  add(
    'weights',
    4,
    'the share of each kind of customer is its weight in the prior',
    [['markdown'], ['table']],
    { weights: true },
  );
  add(
    'required',
    4,
    'a kind of customer every test plan must include is required',
    [['markdown'], ['numbered']],
    { required: true },
  );
  add(
    'tool-order',
    4,
    'a stated order between two tools is a tool_order relation',
    [['markdown'], ['prose'], ['tool-reference']],
    { toolOrder: true },
    BANK_COMPONENTS.contract,
  );
  add(
    'route',
    4,
    'a rule that sends a topic to a team is a route relation',
    [['markdown'], ['table'], ['numbered']],
    { routes: true },
    BANK_COMPONENTS.contract,
  );
  add(
    'reply-text',
    5,
    'a rule that fixes the exact words of a reply is a reply_text relation',
    [['markdown'], ['prose'], ['question']],
    { replies: true },
    BANK_COMPONENTS.contract,
  );
  add(
    'unless',
    4,
    'a rule that holds except on one channel carries unless',
    [['markdown'], ['table'], ['prose']],
    { exceptions: true },
  );
  add(
    'limit',
    4,
    'a rule that caps how often an action happens carries limit',
    [['markdown'], ['numbered'], ['nested']],
    { limits: true },
  );
  add(
    'within',
    4,
    'a rule with a time limit carries within, in minutes',
    [['markdown'], ['prose'], ['table']],
    { deadlines: true },
  );
  add(
    'priority',
    4,
    'a rule stated to come before every other rule carries priority first',
    [['markdown'], ['numbered'], ['nested']],
    { priorities: true },
  );
  add('replaced-rule', 4, 'a later rule that replaces an earlier one carries the polarity it states', [
    ['precedence'],
    ['precedence', 'table'],
  ]);
  return cases.map((item) =>
    styledItem({
      id: `semantics.${item.slug}`,
      family: 'semantics',
      tier: item.tier,
      level: levelOf('semantics'),
      component: item.component,
      title: item.title,
      styles: item.styles,
      ...(item.extras ? { extras: item.extras } : {}),
      cause: /^(polarity|replaced-rule)/.test(item.slug)
        ? 'contract:rule-polarity'
        : styleCause(item.styles, item.extras),
    }),
  );
}

/**
 * Roles: two persona dimensions, one declared axis, in every style and with either one declared. Each seed
 * runs two prompts: one where the tone's id sorts before the customer kind's id, one where it sorts after.
 * A role read from the order of the ids, not from the prompt, fails one of the two on every seed.
 */
export function roleItems(): BankItem[] {
  const out: BankItem[] = [];
  const ORDERS = ['tone-first', 'type-first'] as const;
  const parts: Parts = { roles: true, dimension: (id) => PERSONA_IDS.has(id) };
  for (const style of STYLES) {
    for (const roles of ['tone-axis', 'type-axis'] as const) {
      const id = `roles.${style}.${roles}`;
      const build = (seed: number) =>
        ORDERS.map((order) =>
          styledCase(`${id}.${order}`, { styles: [style], seed, salt: id, extras: { roles, order } }),
        );
      out.push({
        id,
        family: 'roles',
        tier: STYLE_TIER[style] >= 3 ? 4 : 3,
        level: levelOf('semantics'),
        component: BANK_COMPONENTS.roles,
        cause: styleCause([style], { roles }),
        title: `each dimension carries the role the prompt declares (${roles === 'tone-axis' ? 'tone is the axis' : 'the kind of customer is the axis'}), in ${STYLE_TITLE[style]}, whichever of the two dimension ids sorts first`,
        generate: (seed) => build(seed).map((built) => built.item),
        check: (runs, seed) =>
          allOf(
            build(seed).map((built, index) => {
              const run = runs[index];
              if (!run) return { pass: false, detail: 'no run' };
              const outcome = checkMap(run, built.code, parts);
              return { ...outcome, detail: `${ORDERS[index]} ids: ${outcome.detail}` };
            }),
          ),
      });
    }
  }
  return out;
}

/** Constraints stated in prose, in every structure and phrasing. */
export function constraintItems(): BankItem[] {
  const variants: Style[][] = [
    ...STRUCTURES.map((structure) => [structure] as Style[]),
    ['multilingual'],
    ['negation'],
    ['conditional'],
    ['question'],
    ['deprecated'],
    ['precedence'],
    ['contradicting-example'],
    ['hidden-in-example'],
    ['tool-reference'],
    ['table', 'conditional'],
    ['nested', 'negation'],
    ['prose', 'question'],
    ['numbered', 'deprecated'],
    ['markdown', 'precedence'],
    ['table', 'multilingual'],
  ];
  return variants.map((styles) =>
    styledItem({
      id: `constraints.${styles.join('+')}`,
      cause: `accept:constraints-${styles.join('+')}`,
      family: 'constraints',
      tier: styles.length > 1 ? 3 : 2,
      level: levelOf('relations'),
      component: BANK_COMPONENTS.accept,
      title: `the impossible cells a prompt states (a kind of customer never on a channel, a stage never on a channel), in ${styles.join(', ')}`,
      styles,
      extras: { constraints: true },
      parts: { constraints: true, produced: true },
    }),
  );
}

/** Metamorphic transforms of a styled prompt: the map, quotes aside, must not move. */
export function transformItems(): BankItem[] {
  const transforms: Array<{ slug: string; tier: Tier; render: RenderStyled; title: string }> = [
    { slug: 'permute', tier: 3, render: { order: 'reversed' }, title: 'the sections in reverse order' },
    { slug: 'split', tier: 2, render: { split: true }, title: 'every rule followed by a second sentence' },
    {
      slug: 'synonym',
      tier: 3,
      render: { synonyms: true },
      title: 'template words replaced from the synonym table',
    },
    { slug: 'decoy', tier: 2, render: { extraDecoys: 4 }, title: 'four more sentences that specify nothing' },
  ];
  const out: BankItem[] = [];
  for (const structure of STRUCTURES) {
    for (const transform of transforms) {
      const id = `transforms.${transform.slug}.${structure}`;
      out.push({
        id,
        cause:
          transform.slug === 'permute' ? 'contract:dimension-role' : `extract:transform-${transform.slug}`,
        family: 'transforms',
        tier: transform.tier,
        level: levelOf('metamorphic'),
        component: BANK_COMPONENTS.extract,
        title: `${transform.title} leaves the map of a ${structure} prompt unchanged up to quotes`,
        // Both orders of the persona ids run on every seed, and the base map must carry the declared roles:
        // roles taken from the sorted ids, not the prompt, give equal maps on one order only.
        generate: (seed) =>
          TRANSFORM_ORDERS.flatMap((order) => {
            const { base, variant } = transformPair(id, seed, order, transform.render);
            return [
              { label: `base.${order}`, sources: base.sources, planted: base.planted },
              { label: `${transform.slug}.${order}`, sources: variant.sources, planted: variant.planted },
            ];
          }),
        check: (runs, seed) =>
          allOf(
            TRANSFORM_ORDERS.map((order, index) => {
              const base = runs[index * 2];
              const variant = runs[index * 2 + 1];
              if (!base || !variant) return { pass: false, detail: 'missing runs' };
              const problem = runProblem(base) ?? runProblem(variant);
              if (problem) return { pass: false, detail: `${order} ids: ${problem}` };
              if (!base.result.ok || !variant.result.ok) return { pass: false, detail: 'no proposal' };
              if (transform.slug === 'permute') {
                const declared = checkMap(base, transformPair(id, seed, order, transform.render).base.code, {
                  roles: true,
                  dimension: (dimension) => PERSONA_IDS.has(dimension),
                });
                if (!declared.pass) {
                  return {
                    pass: false,
                    detail: `${order} ids, the base map's roles are not the declared ones: ${declared.detail}`,
                  };
                }
              }
              const parts: Parts = { ...MAP, roles: true };
              const { lost, gained } = compareFacts(
                proposalFacts(base.result.proposal, parts),
                proposalFacts(variant.result.proposal, parts),
              );
              return lost.length === 0 && gained.length === 0
                ? { pass: true, detail: `${order} ids: equal maps` }
                : {
                    pass: false,
                    detail: `${order} ids: the ${transform.slug} transform lost ${listFacts(lost)}; gained ${listFacts(gained)}${failedSections(variant)}`,
                  };
            }),
          ),
      });
    }
  }
  return out;
}

const TRANSFORM_ORDERS = ['tone-first', 'type-first'] as const;

/** The base prompt of a transforms item and its transformed variant, for one order of the persona ids. */
function transformPair(
  id: string,
  seed: number,
  order: (typeof TRANSFORM_ORDERS)[number],
  render: RenderStyled,
) {
  const spec = styledSpec({
    styles: [structureOf(id), 'conditional'],
    seed,
    salt: id,
    extras: { constraints: true, roles: 'tone-axis', order },
  });
  return { base: renderStyled(spec), variant: renderStyled(spec, render) };
}

/** The structure a transforms item id ends with. */
function structureOf(id: string): Style {
  return id.split('.').at(-1) as Style;
}

/** Additivity and unit response on styled prompts. */
export function compositionItems(): BankItem[] {
  const sets: Style[][] = [
    ['markdown'],
    ['numbered'],
    ['prose'],
    ['table'],
    ['nested'],
    ['multilingual'],
    ['negation'],
    ['question'],
    ['conditional'],
    ['tool-reference'],
  ];
  const out: BankItem[] = [];
  for (const styles of sets) {
    const key = styles.join('+');
    out.push({
      id: `composition.additivity.${key}`,
      cause: `extract:additivity-${key}`,
      family: 'composition',
      tier: 3,
      level: levelOf('composition'),
      component: BANK_COMPONENTS.extract,
      title: `two half prompts in ${key} give maps whose union is the full map`,
      generate: (seed) => {
        const spec = styledSpec({ styles, seed, salt: `composition.${key}` });
        const halves = [0, 1].map((keep) => ({
          ...spec,
          rules: spec.rules.filter((_, index) => index % 2 === keep),
        }));
        const full = renderStyled(spec);
        return [
          { label: 'full', sources: full.sources, planted: full.planted },
          ...halves.map((half, index) => {
            const rendered = renderStyled(half);
            return { label: `half-${index + 1}`, sources: rendered.sources, planted: rendered.planted };
          }),
        ];
      },
      check: (runs) => {
        for (const run of runs) {
          const problem = runProblem(run);
          if (problem) return { pass: false, detail: problem };
        }
        const [full, ...halves] = runs;
        if (!full?.result.ok) return { pass: false, detail: 'no full proposal' };
        const parts: Parts = { ...MAP };
        const union = new Set<string>();
        for (const half of halves)
          if (half.result.ok) for (const fact of proposalFacts(half.result.proposal, parts)) union.add(fact);
        const { lost, gained } = compareFacts(proposalFacts(full.result.proposal, parts), union);
        return lost.length === 0 && gained.length === 0
          ? { pass: true, detail: 'the halves add up' }
          : {
              pass: false,
              detail: `the union of the halves lost ${listFacts(lost)}; gained ${listFacts(gained)}`,
            };
      },
    });
    out.push({
      id: `composition.unit.${key}`,
      cause: `accept:unit-response-${key}`,
      family: 'composition',
      tier: 3,
      level: levelOf('composition'),
      component: BANK_COMPONENTS.accept,
      title: `one more stated constraint in ${key} gives exactly one more constraint`,
      generate: (seed) => {
        const spec = styledSpec({ styles, seed, salt: `unit.${key}`, extras: { constraints: true } });
        const fewer = { ...spec, constraints: spec.constraints.slice(1) };
        const a = renderStyled(fewer);
        const b = renderStyled(spec);
        return [
          { label: 'without', sources: a.sources, planted: a.planted },
          { label: 'with', sources: b.sources, planted: b.planted },
        ];
      },
      check: (runs, seed) => {
        const [without, withOne] = runs;
        if (!without || !withOne) return { pass: false, detail: 'missing runs' };
        const problem = runProblem(without) ?? runProblem(withOne);
        if (problem) return { pass: false, detail: problem };
        if (!without.result.ok || !withOne.result.ok) return { pass: false, detail: 'no proposal' };
        const parts: Parts = { constraints: true };
        const { lost, gained } = compareFacts(
          proposalFacts(without.result.proposal, parts),
          proposalFacts(withOne.result.proposal, parts),
        );
        const added = styledSpec({ styles, seed, salt: `unit.${key}`, extras: { constraints: true } })
          .constraints[0];
        const expected = added
          ? `constraint ${JSON.stringify(Object.entries(added.forbid).sort(([x], [y]) => (x < y ? -1 : 1)))}`
          : '';
        return lost.length === 0 && gained.length === 1 && gained[0] === expected
          ? { pass: true, detail: 'one more' }
          : {
              pass: false,
              detail: `one more constraint gave ${gained.length} more (${listFacts(gained)}) and ${lost.length} fewer (${listFacts(lost)})`,
            };
      },
    });
  }
  return out;
}

/** The styles at 100k, 300k and 1M characters, each under a time budget. */
export function scaleItems(): BankItem[] {
  const out: BankItem[] = [];
  for (const style of STYLES) {
    out.push(
      styledItem({
        id: `scale.100k.${style}`,
        family: 'scale',
        tier: 4,
        level: levelOf('scale'),
        cause: 'extract:chunk-requests',
        component: BANK_COMPONENTS.extract,
        title: `a 100k-character prompt in ${STYLE_TITLE[style]}, extracted in under 10 seconds`,
        styles: [style],
        size: 100_000,
        budgetMs: 10_000,
      }),
    );
  }
  for (const style of ['markdown', 'prose', 'table', 'nested', 'multilingual', 'conditional'] as Style[]) {
    out.push(
      styledItem({
        id: `scale.300k.${style}`,
        family: 'scale',
        tier: 5,
        level: levelOf('scale'),
        cause: 'extract:chunk-requests',
        component: BANK_COMPONENTS.extract,
        title: `a 300k-character prompt in ${STYLE_TITLE[style]}, extracted in under 30 seconds`,
        styles: [style],
        size: 300_000,
        budgetMs: 30_000,
      }),
    );
  }
  for (const styles of [
    ['table', 'negation'],
    ['nested', 'conditional'],
    ['prose', 'question'],
    ['multilingual', 'precedence'],
    ['numbered', 'hidden-in-example'],
    ['markdown', 'tool-reference'],
  ] as Style[][]) {
    out.push(
      styledItem({
        id: `scale.100k.${styles.join('+')}`,
        family: 'scale',
        tier: 5,
        level: levelOf('scale'),
        cause: 'extract:chunk-requests',
        component: BANK_COMPONENTS.extract,
        title: `a 100k-character prompt that mixes ${styles.join(' and ')}, extracted in under 10 seconds`,
        styles,
        size: 100_000,
        budgetMs: 10_000,
      }),
    );
  }
  const boundaries: Array<{
    slug: string;
    cause: string;
    title: string;
    styles: Style[];
    extras?: Extras;
    render?: RenderStyled;
  }> = [
    {
      slug: 'line-boundaries',
      cause: 'extract:chunk-at-line-boundaries',
      title: 'paragraphs of three rules on one line: a chunk never cuts a line',
      styles: ['prose'],
    },
    {
      slug: 'wrapped-sentences',
      cause: 'extract:keep-wrapped-sentences-whole',
      title: 'rules hard-wrapped at 72 columns: a chunk never cuts a sentence across its line breaks',
      styles: ['prose'],
      render: { wrapRules: 72 },
    },
    {
      slug: 'heading-path',
      cause: 'extract:carry-heading-path',
      title: 'rules under channel headings: each chunk carries the heading its rules sit under',
      styles: ['nested'],
    },
    {
      slug: 'table-header',
      cause: 'extract:repeat-table-header',
      title: 'rule tables with an applies-to column: each chunk of a table carries its header',
      styles: ['table'],
    },
    {
      slug: 'deprecated-marker',
      cause: 'extract:carry-deprecated-marker',
      title: 'a long deprecated section: a chunk of it still says the rules are no longer in force',
      styles: ['deprecated'],
      extras: { manyTraps: true },
    },
    {
      slug: 'replacements',
      cause: 'extract:merge-replacements-across-chunks',
      title: 'updates at the end replace rules many chunks earlier: the merge drops the replaced rules',
      styles: ['precedence'],
      extras: { manyTraps: true },
    },
    {
      slug: 'question-answer',
      cause: 'extract:keep-question-and-answer-together',
      title: 'rules asked as a question on one line and answered on the next: a chunk keeps both',
      styles: ['question'],
      render: { qaLines: true },
    },
    {
      slug: 'constraints-first',
      cause: 'extract:defer-constraints-to-the-whole-map',
      title:
        'impossible cells stated before the kinds of customer they name: a constraint waits for its values',
      styles: ['markdown'],
      extras: { constraints: true },
      render: { constraintsFirst: true },
    },
  ];
  for (const boundary of boundaries) {
    out.push(
      styledItem({
        id: `scale.chunk.${boundary.slug}`,
        family: 'scale',
        tier: 5,
        level: levelOf('scale'),
        component: BANK_COMPONENTS.extract,
        title: `a 100k-character prompt, ${boundary.title}`,
        styles: boundary.styles,
        ...(boundary.extras ? { extras: boundary.extras } : {}),
        ...(boundary.render ? { render: boundary.render } : {}),
        size: 100_000,
        budgetMs: 10_000,
        cause: boundary.cause,
      }),
    );
  }
  for (const styles of [['markdown'], ['table', 'negation']] as Style[][]) {
    out.push(
      styledItem({
        id: `scale.1m.${styles.join('+')}`,
        family: 'scale',
        tier: 5,
        level: levelOf('scale'),
        cause: 'extract:chunk-requests',
        component: BANK_COMPONENTS.extract,
        title: `a 1M-character prompt (${styles.join(', ')}), more than one context window, extracted in under 120 seconds`,
        styles,
        size: 1_000_000,
        budgetMs: 120_000,
      }),
    );
  }
  return out;
}

export { checkMap };

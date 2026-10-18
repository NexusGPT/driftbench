import type { SourceText } from '@agent-nexus/driftbench-generate';
import { stringify } from 'yaml';
import { DECOYS, SYNONYMS } from '../render';
import type { Draw } from '../spec';
import { drawFor, inventoryCode, inventorySource, type MiniInventory, miniInventory } from './common';
import type { CodeEntry } from './facts';
import type { Planted, PlantedConstraint, PlantedRelation, PlantedValue, Role } from './perfect';

/**
 * The styled agent: a hidden specification written in any of fourteen prompt styles and any combination of
 * them (docs/validators.md section 12.6). Five styles are structures (markdown, numbered, prose, table,
 * nested sections), five are ways of phrasing a rule (multilingual, negation, conditionals, tool references,
 * questions), four are traps (examples that contradict the rules, deprecated sections, a later rule that
 * replaces an earlier one, a rule stated inside an example). The renderer records every planted entry with
 * the exact text that states it, so the perfect model knows what a reader of the prompt would report.
 */

export const STRUCTURES = ['markdown', 'numbered', 'prose', 'table', 'nested'] as const;
export const PHRASINGS = ['multilingual', 'negation', 'conditional', 'tool-reference', 'question'] as const;
export const TRAPS = ['contradicting-example', 'deprecated', 'precedence', 'hidden-in-example'] as const;
export const STYLES = [...STRUCTURES, ...PHRASINGS, ...TRAPS] as const;
export type Style = (typeof STYLES)[number];
type Structure = (typeof STRUCTURES)[number];
type Lang = 'en' | 'fr';

type Text = { en: string; fr: string };

const VERBS: Text[] = [
  { en: 'confirm', fr: 'confirmer' },
  { en: 'repeat', fr: 'répéter' },
  { en: 'check', fr: 'vérifier' },
  { en: 'mention', fr: 'mentionner' },
  { en: 'ask for', fr: 'demander' },
  { en: 'send', fr: 'envoyer' },
  { en: 'offer', fr: 'proposer' },
  { en: 'record', fr: 'noter' },
  { en: 'quote', fr: 'citer' },
  { en: 'explain', fr: 'expliquer' },
  { en: 'update', fr: 'mettre à jour' },
  { en: 'read out', fr: 'lire à voix haute' },
];
const OBJECTS: Text[] = [
  { en: 'the delivery address', fr: "l'adresse de livraison" },
  { en: 'the order total', fr: 'le total de la commande' },
  { en: 'the contact email', fr: "l'adresse e-mail de contact" },
  { en: 'the plan name', fr: 'le nom du forfait' },
  { en: 'the visit slot', fr: 'le créneau de visite' },
  { en: 'the refund amount', fr: 'le montant du remboursement' },
  { en: 'the account reference', fr: 'la référence du compte' },
  { en: 'the opening hours', fr: "les heures d'ouverture" },
  { en: 'the cancellation date', fr: 'la date de résiliation' },
  { en: 'the invoice number', fr: 'le numéro de facture' },
  { en: 'the waiting list', fr: "la liste d'attente" },
  { en: 'the notice period', fr: 'le préavis' },
  { en: 'the card number', fr: 'le numéro de carte' },
  { en: 'the meter reading', fr: 'le relevé du compteur' },
];
const QUALIFIERS: Text[] = [
  { en: 'once', fr: 'une fois' },
  { en: 'in full', fr: 'en entier' },
  { en: 'before any change', fr: 'avant toute modification' },
  { en: 'at the end', fr: 'à la fin' },
  { en: 'in one line', fr: 'en une ligne' },
  { en: 'word for word', fr: 'mot pour mot' },
  { en: 'again', fr: 'à nouveau' },
  { en: 'without delay', fr: 'sans délai' },
];
const SEGMENTS: Text[] = [
  { en: '', fr: '' },
  { en: 'for a new line', fr: 'pour une nouvelle ligne' },
  { en: 'for a home plan', fr: 'pour un forfait maison' },
  { en: 'for a business account', fr: 'pour un compte professionnel' },
  { en: 'for a second visit', fr: 'pour une deuxième visite' },
  { en: 'for a disputed charge', fr: 'pour un débit contesté' },
  { en: 'for a moved customer', fr: 'pour un client qui déménage' },
  { en: 'for a late payment', fr: 'pour un paiement en retard' },
  { en: 'for a gift order', fr: 'pour une commande cadeau' },
  { en: 'for a shared account', fr: 'pour un compte partagé' },
  { en: 'for an urgent case', fr: 'pour un cas urgent' },
  { en: 'for a returning customer', fr: 'pour un client qui revient' },
];

const MOMENTS: Text[] = [
  { en: '', fr: '' },
  { en: 'during a busy week', fr: 'pendant une semaine chargée' },
  { en: 'in the evening shift', fr: 'pendant le service du soir' },
  { en: 'on a public holiday', fr: 'un jour férié' },
  { en: 'after a complaint', fr: 'après une réclamation' },
];

/** The action of rule number `n`: unique for every n below 80640. */
export function actionOf(n: number): Text {
  const verb = VERBS[n % VERBS.length] as Text;
  const object = OBJECTS[Math.floor(n / VERBS.length) % OBJECTS.length] as Text;
  const qualifier = QUALIFIERS[Math.floor(n / (VERBS.length * OBJECTS.length)) % QUALIFIERS.length] as Text;
  const segment = SEGMENTS[
    Math.floor(n / (VERBS.length * OBJECTS.length * QUALIFIERS.length)) % SEGMENTS.length
  ] as Text;
  const moment = MOMENTS[
    Math.floor(n / (VERBS.length * OBJECTS.length * QUALIFIERS.length * SEGMENTS.length)) % MOMENTS.length
  ] as Text;
  const join = (lang: Lang) =>
    [verb[lang], object[lang], qualifier[lang], segment[lang], moment[lang]]
      .filter((part) => part !== '')
      .join(' ');
  return { en: join('en'), fr: join('fr') };
}

const STAGES: Array<{ id: string; title: Text }> = [
  { id: 'greet', title: { en: 'the assistant greets the customer', fr: "l'assistant accueille le client" } },
  {
    id: 'identify',
    title: {
      en: 'the assistant asks for the account reference',
      fr: "l'assistant demande la référence du compte",
    },
  },
  {
    id: 'collect',
    title: { en: 'the assistant gathers the details', fr: "l'assistant rassemble les détails" },
  },
  {
    id: 'propose',
    title: {
      en: 'the assistant proposes the options that fit',
      fr: "l'assistant propose les options adaptées",
    },
  },
  {
    id: 'recap',
    title: { en: 'the assistant repeats the request in full', fr: "l'assistant répète la demande en entier" },
  },
  {
    id: 'close',
    title: { en: 'the assistant ends the conversation', fr: "l'assistant termine la conversation" },
  },
];
const TYPES: Array<{ id: string; title: Text }> = [
  { id: 'member', title: { en: 'a customer with an active plan', fr: 'un client avec un forfait actif' } },
  { id: 'guest', title: { en: 'a visitor with no account yet', fr: 'un visiteur sans compte' } },
  {
    id: 'partner',
    title: { en: 'a reseller acting for a customer', fr: 'un revendeur qui agit pour un client' },
  },
  {
    id: 'former',
    title: { en: 'a customer whose plan has ended', fr: 'un client dont le forfait a pris fin' },
  },
];
export const STYLED_TOOLS = ['account.find', 'order.place', 'visit.book', 'refund.request'];
const TEAMS = ['billing-desk', 'repair-team', 'sales-desk'];
const MESSAGES = [
  'Hello, I would like to change my plan.',
  'My invoice looks wrong this month.',
  'Can someone come and check the box in the hallway?',
  'Please end my plan at the end of the month.',
];

export type StyledRule = {
  id: string;
  n: number;
  polarity: 'must' | 'must_not';
  lang: Lang;
  /** A condition on a cell: written inline, or given by the section the rule sits in. */
  when?: {
    dimension: 'channel' | 'customer_type' | 'stage' | 'flow';
    value: string;
    how: 'inline' | 'scope';
  };
  /** A tool the rule calls at a stage: a uses_tool relation of the service flow. */
  tool?: { name: string; stage: string };
  place: 'list' | 'question' | 'example';
  /** live rules are in the map; deprecated and replaced ones are not. */
  status: 'live' | 'deprecated' | 'replaced';
  /** For a live rule that replaces another: the id of the rule it replaces. */
  replaces?: string;
  /** Extra semantics the semantics family plants: a route or an exact reply. */
  route?: string;
  reply?: string;
  /** A channel the rule does not hold on ("except on sms"). */
  unless?: string;
  /** The most times the action may happen in one conversation. */
  limit?: number;
  /** The minutes within which the action happens. */
  within?: number;
  /** True for a rule stated to come before every other rule. */
  first?: boolean;
};

/** Semantics the semantics family adds on top of the styles. */
export type Extras = {
  weights?: boolean;
  required?: boolean;
  toolOrder?: boolean;
  routes?: boolean;
  replies?: boolean;
  stageScope?: boolean;
  flowScope?: boolean;
  constraints?: boolean;
  /** Deprecated rules and replacements in proportion to the rules (15 and 10 percent), for prompts at scale. */
  manyTraps?: boolean;
  exceptions?: boolean;
  limits?: boolean;
  deadlines?: boolean;
  priorities?: boolean;
  /** Declared roles for a second persona dimension (tone), for the roles family. */
  roles?: 'tone-axis' | 'type-axis';
  /**
   * With roles: which persona dimension id sorts first. The ids are drawn from pools so that either order
   * occurs, and a role read from the id order instead of the prompt fails one of the two orders.
   */
  order?: 'tone-first' | 'type-first';
};

/** The ids the two persona dimensions of a roles prompt take. */
const TYPE_IDS = ['customer_type', 'audience', 'segment', 'kind'] as const;
const TONE_IDS = ['tone', 'register', 'voice', 'manner'] as const;
/** Every id a persona dimension of a roles prompt can take. */
export const PERSONA_IDS: ReadonlySet<string> = new Set([...TYPE_IDS, ...TONE_IDS]);

export type StyledSpec = {
  /** The seed and salt the specification was drawn from; the wording draws from them too. */
  seed: number;
  salt: string;
  styles: Style[];
  structures: Structure[];
  inventory: MiniInventory;
  stages: Array<{ id: string; title: Text }>;
  types: Array<{ id: string; title: Text; weight?: number; required?: boolean }>;
  tones?: Array<{ id: string; title: Text }>;
  /** The dimension ids of the kind of customer and of the tone: customer_type and tone unless roles are drawn. */
  typeDimension: string;
  toneDimension: string;
  roles?: { type: Role; tone: Role };
  rules: StyledRule[];
  contradicting: number;
  constraints: Array<{ id: string; forbid: Record<string, string>; kind: 'type-channel' | 'stage-channel' }>;
  toolOrder?: { before: string; after: string };
  decoys: number;
  lang: Lang;
};

export type StyledOptions = {
  styles: readonly Style[];
  seed: number;
  /** A salt for the draws, so two items with the same styles draw apart. */
  salt?: string;
  /** The prompt length to reach, in characters; a normal prompt when absent. */
  size?: number;
  /** The number of rules, which overrides the estimate from the size. */
  ruleCount?: number;
  extras?: Extras;
};

const has = (styles: readonly Style[], style: Style) => styles.includes(style);

/** Draws a styled specification. The same options give the same specification. */
export function styledSpec(options: StyledOptions): StyledSpec {
  const styles = [...options.styles];
  const extras = options.extras ?? {};
  const draw = drawFor(
    options.seed,
    `styled:${styles.join('+')}:${options.salt ?? ''}:${JSON.stringify(extras)}`,
  );
  const structures = styles.filter((style): style is Structure =>
    (STRUCTURES as readonly string[]).includes(style),
  );
  if (structures.length === 0) structures.push('markdown');
  const inventory = miniInventory(draw);
  if (extras.flowScope && !inventory.flows.some((flow) => flow.id === 'refund')) {
    inventory.flows.push({
      id: 'refund',
      title: 'A customer asks for money back',
      behaviours: ['B-002', 'B-003'],
      deviations: ['D8_tool_failure'],
    });
  }
  const stages = [
    STAGES[0],
    ...draw.subset(STAGES.slice(1, -1), draw.int(2, 3)),
    STAGES.at(-1),
  ] as StyledSpec['stages'];
  const types: StyledSpec['types'] = draw.subset(TYPES, draw.int(2, 3)).map((type) => ({ ...type }));
  let typeDimension = 'customer_type';
  let toneDimension = 'tone';
  if (extras.roles) {
    const pairs = TYPE_IDS.flatMap((type) => TONE_IDS.map((tone) => ({ type, tone }))).filter(
      ({ type, tone }) =>
        (extras.order ?? (draw.chance(0.5) ? 'tone-first' : 'type-first')) === 'tone-first'
          ? tone < type
          : type < tone,
    );
    const pair = draw.pick(pairs);
    typeDimension = pair.type;
    toneDimension = pair.tone;
  }
  if (extras.weights) {
    const shares = types.length === 2 ? [70, 30] : [50, 30, 20];
    types.forEach((type, index) => {
      type.weight = (shares[index] as number) / 100;
    });
  }
  if (extras.required) (types[types.length - 1] as StyledSpec['types'][number]).required = true;
  const lang: Lang = has(styles, 'multilingual') ? 'fr' : 'en';

  const count =
    options.ruleCount ?? (options.size ? Math.max(8, Math.ceil((options.size - 1500) / 62)) : draw.int(6, 9));
  const start = draw.int(0, 4000);
  const rules: StyledRule[] = [];
  const pad = String(count + 20).length;
  const id = (index: number) => `R-${String(index + 1).padStart(Math.max(2, pad), '0')}`;
  const negative = has(styles, 'negation') ? 0.7 : 0.3;
  for (let index = 0; index < count; index++) {
    const rule: StyledRule = {
      id: id(index),
      n: start + index,
      polarity: draw.chance(negative) ? 'must_not' : 'must',
      lang: has(styles, 'multilingual') && draw.chance(0.5) ? 'fr' : 'en',
      place: has(styles, 'question') && draw.chance(0.4) ? 'question' : 'list',
      status: 'live',
    };
    if (has(styles, 'conditional') && draw.chance(0.5)) {
      rule.when = draw.chance(0.5)
        ? { dimension: 'channel', value: draw.pick(inventory.channels), how: 'inline' }
        : { dimension: 'customer_type', value: draw.pick(types).id, how: 'inline' };
    }
    rules.push(rule);
  }
  const scoped = structures.includes('nested') || structures.includes('table');
  if (scoped) {
    for (const rule of rules) {
      if (!rule.when && draw.chance(0.35))
        rule.when = { dimension: 'channel', value: draw.pick(inventory.channels), how: 'scope' };
    }
  }
  if (has(styles, 'tool-reference')) {
    for (const rule of draw.subset(
      rules.filter((r) => !r.when && r.place === 'list'),
      Math.min(3, rules.length),
    )) {
      rule.tool = { name: draw.pick(STYLED_TOOLS), stage: draw.pick(stages.slice(1, -1)).id };
      rule.polarity = 'must';
    }
  }
  if (has(styles, 'hidden-in-example')) {
    for (const rule of draw.subset(
      rules.filter((r) => !r.tool && r.place === 'list'),
      2,
    ))
      rule.place = 'example';
  }
  let next = count;
  if (has(styles, 'deprecated')) {
    const deprecatedCount = extras.manyTraps ? Math.max(2, Math.floor(count * 0.15)) : 2;
    for (let i = 0; i < deprecatedCount; i++)
      rules.push({
        id: id(next),
        n: start + next++,
        polarity: 'must',
        lang: 'en',
        place: 'list',
        status: 'deprecated',
      });
  }
  if (has(styles, 'precedence')) {
    const olds = draw.subset(
      rules.filter((r) => r.status === 'live' && r.place === 'list' && !r.tool && !r.when),
      extras.manyTraps ? Math.max(2, Math.floor(count * 0.1)) : Math.min(2, rules.length),
    );
    for (const old of olds) {
      old.status = 'replaced';
      rules.push({
        id: id(next),
        n: start + next++,
        polarity: old.polarity === 'must' ? 'must_not' : 'must',
        lang: old.lang,
        place: 'list',
        status: 'live',
        replaces: old.id,
      });
    }
  }
  if (extras.stageScope) {
    rules.push({
      id: id(next),
      n: start + next++,
      polarity: 'must_not',
      lang: 'en',
      place: 'list',
      status: 'live',
      when: { dimension: 'stage', value: draw.pick(stages.slice(1, -1)).id, how: 'inline' },
    });
  }
  if (extras.flowScope) {
    rules.push({
      id: id(next),
      n: start + next++,
      polarity: 'must',
      lang: 'en',
      place: 'list',
      status: 'live',
      when: { dimension: 'flow', value: 'refund', how: 'scope' },
    });
  }
  if (extras.routes) {
    rules.push({
      id: id(next),
      n: start + next++,
      polarity: 'must',
      lang: 'en',
      place: 'list',
      status: 'live',
      route: draw.pick(TEAMS),
    });
  }
  if (extras.exceptions) {
    for (let i = 0; i < 2; i++) {
      rules.push({
        id: id(next),
        n: start + next++,
        polarity: 'must',
        lang: 'en',
        place: 'list',
        status: 'live',
        unless: draw.pick(inventory.channels),
      });
    }
  }
  if (extras.limits) {
    for (let i = 0; i < 2; i++) {
      rules.push({
        id: id(next),
        n: start + next++,
        polarity: 'must_not',
        lang: 'en',
        place: 'list',
        status: 'live',
        limit: draw.int(2, 3),
      });
    }
  }
  if (extras.deadlines) {
    for (let i = 0; i < 2; i++) {
      rules.push({
        id: id(next),
        n: start + next++,
        polarity: 'must',
        lang: 'en',
        place: 'list',
        status: 'live',
        within: draw.int(2, 9),
      });
    }
  }
  if (extras.priorities) {
    rules.push({
      id: id(next),
      n: start + next++,
      polarity: 'must_not',
      lang: 'en',
      place: 'list',
      status: 'live',
      first: true,
    });
  }
  if (extras.replies) {
    rules.push({
      id: id(next),
      n: start + next++,
      polarity: 'must',
      lang: 'en',
      place: 'list',
      status: 'live',
      reply: draw.pick(['Your order is in.', 'Your visit is booked.', 'Your refund is on its way.']),
    });
  }
  const constraints: StyledSpec['constraints'] = [];
  if (extras.constraints) {
    const pairs = types.flatMap((type) => inventory.channels.map((channel) => ({ type: type.id, channel })));
    for (const { type, channel } of draw.subset(pairs, 2)) {
      constraints.push({
        id: `${typeDimension}=${type},channel=${channel}`,
        forbid: { [typeDimension]: type, channel },
        kind: 'type-channel',
      });
    }
    const stage = draw.pick(stages.slice(1, -1)).id;
    const channel = draw.pick(inventory.channels);
    constraints.push({
      id: `stage=${stage},channel=${channel}`,
      forbid: { stage, channel },
      kind: 'stage-channel',
    });
  }
  const tones = extras.roles
    ? [
        {
          id: 'formal',
          title: { en: 'a customer who writes formally', fr: 'un client qui écrit de façon formelle' },
        },
        {
          id: 'casual',
          title: { en: 'a customer who writes casually', fr: 'un client qui écrit de façon décontractée' },
        },
      ]
    : undefined;
  return {
    seed: options.seed,
    salt: options.salt ?? '',
    styles,
    structures: [...new Set(structures)],
    inventory,
    stages,
    types,
    typeDimension,
    toneDimension,
    ...(tones ? { tones } : {}),
    ...(extras.roles
      ? {
          roles:
            extras.roles === 'tone-axis'
              ? { type: 'detail' as Role, tone: 'axis' as Role }
              : { type: 'axis' as Role, tone: 'detail' as Role },
        }
      : {}),
    rules,
    contradicting: has(styles, 'contradicting-example') ? 2 : 0,
    constraints,
    ...(extras.toolOrder
      ? { toolOrder: { before: STYLED_TOOLS[0] as string, after: draw.pick(STYLED_TOOLS.slice(1)) } }
      : {}),
    decoys: 2,
    lang,
  };
}

export type RenderStyled = {
  /** Section order: the base draw, or reversed (the replacing rules stay last either way). */
  order?: 'base' | 'reversed';
  /** Every live rule written as two sentences. */
  split?: boolean;
  synonyms?: boolean;
  extraDecoys?: number;
  /** The salt of the wording draws; the base wording by default. */
  wording?: string;
  /** A question rule written as two lines, Q: and A:. */
  qaLines?: boolean;
  /** Rule paragraphs of a prose section wrapped at this many columns. */
  wrapRules?: number;
  /** The impossible cells stated before any other section. */
  constraintsFirst?: boolean;
};

export type StyledRender = {
  prompt: string;
  planted: Planted[];
  sources: SourceText[];
  code: CodeEntry[];
  /** The entries a reader must not report: deprecated and replaced rules, the examples that break rules. */
  absent: string[];
};

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function polarityForm(rule: StyledRule, action: string, draw: Draw): string {
  if (rule.lang === 'fr') {
    return rule.polarity === 'must'
      ? draw.pick([`Toujours ${action}.`, `Vous devez ${action}.`])
      : draw.pick([`Ne jamais ${action}.`, `Il ne faut jamais ${action}.`]);
  }
  return rule.polarity === 'must'
    ? draw.pick([`Always ${action}.`, `You must ${action}.`, `Make sure to ${action}.`])
    : draw.pick([`Never ${action}.`, `Do not ${action}.`, `You must not ${action}.`]);
}

function conditionPrefix(rule: StyledRule): string {
  const when = rule.when;
  if (when?.how !== 'inline') return '';
  if (rule.lang === 'fr') {
    if (when.dimension === 'channel') return `Si la conversation a lieu sur ${when.value}, `;
    if (when.dimension === 'customer_type') return `Quand le client est un client ${when.value}, `;
    return `À l'étape ${when.value}, `;
  }
  if (when.dimension === 'channel') return `If the conversation is on ${when.value}, `;
  if (when.dimension === 'customer_type') return `When the customer is a ${when.value} customer, `;
  return `At the ${when.value} stage, `;
}

/** The sentence that states a rule, in its language, place and phrasing. */
function ruleSentence(rule: StyledRule, draw: Draw, split: boolean, qaLines = false): string {
  const action = actionOf(rule.n)[rule.lang];
  let sentence: string;
  if (rule.tool) {
    sentence =
      rule.lang === 'fr'
        ? `À l'étape ${rule.tool.stage}, appelez \`${rule.tool.name}\` avant de ${action}.`
        : `At the ${rule.tool.stage} stage, call \`${rule.tool.name}\` before you ${action}.`;
  } else if (rule.route) {
    sentence = `Send every question about ${actionOf(rule.n).en.split(' ').slice(1, 4).join(' ')} to the ${rule.route}.`;
  } else if (rule.unless) {
    sentence = `Always ${action}, except on ${rule.unless}.`;
  } else if (rule.limit) {
    sentence = `Do not ${action} more than ${rule.limit} times in one conversation.`;
  } else if (rule.within) {
    sentence = `Always ${action} within ${rule.within} minutes.`;
  } else if (rule.first) {
    sentence = `Above every other rule, never ${action}.`;
  } else if (rule.reply) {
    sentence = `When you ${action}, reply exactly "${rule.reply}"`;
  } else if (rule.place === 'question') {
    const prefix = conditionPrefix(rule);
    const lead = prefix ? cap(prefix.replace(/^If the conversation is on (\w+), /, 'On $1, ')) : '';
    sentence =
      rule.lang === 'fr'
        ? `${lead}${lead ? "l'assistant" : "L'assistant"} doit-il ${action} ? ${rule.polarity === 'must' ? 'Oui, toujours.' : 'Non, jamais.'}`
        : `${lead}${lead ? 'should' : 'Should'} the assistant ${action}? ${rule.polarity === 'must' ? 'Yes, always.' : 'No, never.'}`;
    if (qaLines) sentence = `Q: ${sentence.replace(/\? /, '?\nA: ').replace(' ? ', ' ?\nA: ')}`;
  } else {
    const prefix = conditionPrefix(rule);
    const form = polarityForm(rule, action, draw);
    sentence = prefix ? `${prefix}${form.charAt(0).toLowerCase()}${form.slice(1)}` : form;
  }
  if (split && rule.status === 'live' && !rule.reply) {
    sentence = `${sentence} ${rule.lang === 'fr' ? 'Cela vaut dans chaque conversation.' : 'This holds in every conversation.'}`;
  }
  return sentence;
}

function lexify(text: string): string {
  let out = text;
  for (const [word, synonym] of SYNONYMS)
    out = out.replace(new RegExp(`(?<![A-Za-z\`.])${word}(?![A-Za-z\`])`, 'g'), synonym);
  return out;
}

/** The words of an update that name the rule it replaces; unique per rule, so a reader can match them. */
function updateMarker(old: StyledRule): string {
  return `the earlier rule on "${actionOf(old.n)[old.lang]}" no longer holds`;
}

/** Text wrapped at a column by turning spaces into line breaks: every character keeps its place. */
function wrapText(text: string, width: number): string {
  const chars = [...text];
  let column = 0;
  let lastSpace = -1;
  for (let i = 0; i < chars.length; i++) {
    if (chars[i] === ' ') lastSpace = i;
    column += 1;
    if (column > width && lastSpace >= 0) {
      chars[lastSpace] = '\n';
      column = i - lastSpace;
      lastSpace = -1;
    }
  }
  return chars.join('');
}

const HEADINGS: Record<string, Text> = {
  stages: { en: 'Stages', fr: 'Étapes' },
  types: { en: 'Customers', fr: 'Clients' },
  tones: { en: 'Tone', fr: 'Ton' },
  rules: { en: 'Rules', fr: 'Règles' },
  examples: { en: 'Examples', fr: 'Exemples' },
  deprecated: { en: 'Deprecated rules (no longer in force)', fr: 'Règles obsolètes (plus en vigueur)' },
  updates: { en: 'Updates', fr: 'Mises à jour' },
  about: { en: 'About this guide', fr: 'À propos de ce guide' },
  constraints: { en: 'Where customers reach us', fr: 'Où les clients nous joignent' },
};

/**
 * A styled specification whose prompt is at least `options.size` characters long: drawn once from the
 * estimate, then once more with the rule count scaled to the length the first draw reached.
 */
export function styledAtSize(
  options: StyledOptions,
  render: RenderStyled = {},
): { spec: StyledSpec; rendered: StyledRender } {
  let spec = styledSpec(options);
  let rendered = renderStyled(spec, render);
  const size = options.size;
  for (let round = 0; size !== undefined && rendered.prompt.length < size && round < 3; round++) {
    const live = spec.rules.length;
    spec = styledSpec({ ...options, ruleCount: Math.ceil((live * size * 1.03) / rendered.prompt.length) });
    rendered = renderStyled(spec, render);
  }
  return { spec, rendered };
}

/** Renders a styled specification into the prompt, the files and the planted entries. */
export function renderStyled(spec: StyledSpec, options: RenderStyled = {}): StyledRender {
  const wording = drawFor(
    spec.seed,
    `wording:${spec.styles.join('+')}:${spec.salt}:${options.wording ?? ''}`,
  );
  const live = spec.rules.filter((rule) => rule.status !== 'deprecated' && !rule.replaces);
  const replacing = spec.rules.filter((rule) => rule.replaces);
  const deprecated = spec.rules.filter((rule) => rule.status === 'deprecated');
  const listed = live.filter((rule) => rule.place !== 'example');
  const inExamples = live.filter((rule) => rule.place === 'example');
  const groups = spec.structures.map((_, index) =>
    listed.filter((__, i) => i % spec.structures.length === index),
  );
  const keys = [
    'stages',
    'types',
    ...(spec.tones ? ['tones'] : []),
    ...groups.map((_, index) => `rules-${index}`),
    ...(inExamples.length > 0 || spec.contradicting > 0 ? ['examples'] : []),
    ...(deprecated.length > 0 ? ['deprecated'] : []),
    ...(spec.constraints.length > 0 ? ['constraints'] : []),
    'about',
  ];
  const shuffled = wording.shuffle(keys);
  const base =
    options.constraintsFirst && keys.includes('constraints')
      ? ['constraints', ...shuffled.filter((key) => key !== 'constraints')]
      : shuffled;
  const order = [
    ...(options.order === 'reversed' ? [...base].reverse() : base),
    ...(replacing.length > 0 ? ['updates'] : []),
  ];
  const decoyPool = wording.shuffle(DECOYS);
  const decoys = decoyPool.slice(0, spec.decoys + (options.extraDecoys ?? 0));
  const decoyAt = new Map<string, string[]>();
  decoys.forEach((decoy, index) => {
    const key = index === 0 ? 'about' : (wording.pick(keys) as string);
    decoyAt.set(key, [...(decoyAt.get(key) ?? []), decoy]);
  });

  const out: string[] = [];
  const planted: Planted[] = [];
  const en = (text: string) => (options.synonyms ? lexify(text) : text);
  const say = (text: string, lang: Lang) => (lang === 'en' ? en(text) : text);
  const heading = (key: string, lang: Lang, structure: Structure, number: number) => {
    const title = (HEADINGS[key] as Text)[lang];
    if (structure === 'numbered') return `${number}. ${title}\n\n`;
    if (structure === 'prose') return `${title}.\n\n`;
    return `## ${title}\n\n`;
  };
  /**
   * Writes entries in a structure. Returns, per entry text, the text as written (a wrapped paragraph changes
   * spaces into line breaks) and the context the entry needs to be read right: its scope heading or table header.
   */
  const block = (
    structure: Structure,
    number: number,
    entries: Array<{ text: string; scope?: string; column?: string }>,
    scopeLabel: (scope: string | undefined) => string,
    wrap?: number,
  ): Map<string, { anchor: string; context?: string }> => {
    const written = new Map<string, { anchor: string; context?: string }>();
    if (structure === 'table') {
      const header = `| # | ${entries[0]?.column ?? 'Entry'} | Applies to (part ${number}) |`;
      out.push(`${header}\n|---|---|---|\n`);
      for (const [index, entry] of entries.entries()) {
        out.push(`| ${index + 1} | ${entry.text} | ${entry.scope ?? 'all'} |\n`);
        written.set(entry.text, { anchor: entry.text, context: header });
      }
      out.push('\n');
      return written;
    }
    if (structure === 'nested') {
      const scopes = [...new Set(entries.map((entry) => entry.scope))];
      for (const scope of scopes) {
        const head = `### ${scopeLabel(scope)} (part ${number})`;
        out.push(`${head}\n\n`);
        for (const entry of entries.filter((candidate) => candidate.scope === scope)) {
          out.push(`- ${entry.text}\n`);
          written.set(entry.text, { anchor: entry.text, context: head });
        }
        out.push('\n');
      }
      return written;
    }
    if (structure === 'prose') {
      for (let i = 0; i < entries.length; i += 3) {
        const group = entries.slice(i, i + 3);
        const parts = group.map((entry) =>
          entry.scope ? `${scopeLabel(entry.scope)}: ${entry.text}` : entry.text,
        );
        let paragraph = parts.join(' ');
        if (wrap) paragraph = wrapText(paragraph, wrap);
        let at = 0;
        group.forEach((entry, index) => {
          const part = parts[index] as string;
          const start = at + part.length - entry.text.length;
          written.set(entry.text, { anchor: paragraph.slice(start, start + entry.text.length) });
          at += part.length + 1;
        });
        out.push(`${paragraph}\n\n`);
      }
      return written;
    }
    entries.forEach((entry, index) => {
      const text = entry.scope ? `${scopeLabel(entry.scope)}: ${entry.text}` : entry.text;
      out.push(structure === 'numbered' ? `${number}.${index + 1} ${text}\n` : `- ${text}\n`);
      written.set(entry.text, { anchor: entry.text });
    });
    out.push('\n');
    return written;
  };
  const value = (
    section: PlantedValue['section'],
    dimension: PlantedValue['dimension'],
    id: string,
    title: string,
    text: string,
    fields?: Record<string, unknown>,
  ): PlantedValue => ({
    type: 'value',
    section,
    source: 'prompt.md',
    quote: text,
    anchor: text,
    dimension,
    value: { id, title },
    ...(fields ? { fields } : {}),
  });

  const ruleDimension = { id: 'rule', title: 'The rules the assistant follows', kind: 'behaviour' };
  const fieldsOf = (rule: StyledRule): Record<string, unknown> => ({
    polarity: rule.polarity,
    ...(rule.when
      ? {
          when: {
            [rule.when.dimension === 'customer_type' ? spec.typeDimension : rule.when.dimension]: [
              rule.when.value,
            ],
          },
        }
      : {}),
    ...(rule.unless ? { unless: { channel: [rule.unless] } } : {}),
    ...(rule.limit ? { limit: rule.limit } : {}),
    ...(rule.within ? { within: { minutes: rule.within } } : {}),
    ...(rule.first ? { priority: 'first' } : {}),
  });
  const plantRule = (
    rule: StyledRule,
    text: string,
    written?: { anchor: string; context?: string },
    extra: Pick<PlantedValue, 'silent' | 'context'> = {},
  ) => {
    const entry = value('rules', ruleDimension, rule.id, actionOf(rule.n).en, text, fieldsOf(rule));
    entry.anchor = written?.anchor ?? text;
    const scoped = rule.when?.how === 'scope' && written?.context;
    planted.push({
      ...entry,
      ...(scoped ? { context: { anchor: written.context as string, ifMissing: 'drop' as const } } : {}),
      ...extra,
    });
    if (extra.silent) return;
    if (rule.tool) {
      planted.push({
        type: 'relation',
        section: 'relations',
        source: 'prompt.md',
        quote: text,
        anchor: text,
        relation: {
          kind: 'uses_tool',
          subject: { dimension: 'flow', value: 'service' },
          tool: rule.tool.name,
          stage: rule.tool.stage,
        },
      } satisfies PlantedRelation);
    }
    if (rule.route) {
      planted.push({
        type: 'relation',
        section: 'relations',
        source: 'prompt.md',
        quote: text,
        anchor: text,
        relation: { kind: 'route', subject: { dimension: 'rule', value: rule.id }, to: rule.route },
      });
    }
    if (rule.reply) {
      planted.push({
        type: 'relation',
        section: 'relations',
        source: 'prompt.md',
        quote: text,
        anchor: text,
        relation: { kind: 'reply_text', subject: { dimension: 'rule', value: rule.id }, text: rule.reply },
      });
    }
  };

  out.push(`# ${spec.lang === 'fr' ? 'Guide de l’assistant' : 'Assistant guide'}\n\n`);
  order.forEach((key, position) => {
    const number = position + 1;
    const structure = spec.structures[
      key.startsWith('rules-')
        ? Number(key.slice(6)) % spec.structures.length
        : key === 'types'
          ? spec.structures.length - 1
          : 0
    ] as Structure;
    const sectionLang: Lang =
      spec.lang === 'fr' && (key === 'stages' || key === 'types' || key === 'tones') ? 'fr' : 'en';
    const headKey = key.startsWith('rules-') ? 'rules' : key;
    out.push(heading(headKey, sectionLang, structure, number));
    if (key === 'stages') {
      const entries = spec.stages.map((stage) => ({
        text: `${stage.id}: ${say(stage.title[sectionLang], sectionLang)}.`,
        column: 'Stage',
      }));
      const pathText =
        sectionLang === 'fr'
          ? `Le parcours service passe par les étapes dans cet ordre : ${spec.stages.map((s) => s.id).join(', ')}.`
          : en(
              `The service flow passes the stages in this order: ${spec.stages.map((s) => s.id).join(', ')}.`,
            );
      out.push(`${pathText}\n\n`);
      planted.push({
        type: 'relation',
        section: 'relations',
        source: 'prompt.md',
        quote: pathText,
        anchor: pathText,
        relation: { kind: 'path', id: 'service-main', flow: 'service', stages: spec.stages.map((s) => s.id) },
      });
      block(structure, number, entries, () => (sectionLang === 'fr' ? 'Toutes' : 'All'));
      spec.stages.forEach((stage, index) => {
        const text = entries[index]?.text as string;
        planted.push(
          value(
            'stages',
            { id: 'stage', title: 'The stage a conversation is in', kind: 'stage' },
            stage.id,
            stage.title.en,
            text,
          ),
        );
      });
    } else if (key === 'types' || key === 'tones') {
      const list = key === 'types' ? spec.types : (spec.tones ?? []);
      const dimension = key === 'types' ? spec.typeDimension : spec.toneDimension;
      const role = spec.roles?.[key === 'types' ? 'type' : 'tone'];
      if (role) {
        out.push(
          `${role === 'axis' ? en('Each of these makes a different kind of conversation.') : en('Any of these can show up inside any conversation.')}\n\n`,
        );
      }
      const entries = list.map((type) => ({
        text: `${type.id}: ${say(type.title[sectionLang], sectionLang)}.`,
        column: 'Kind',
      }));
      block(structure, number, entries, () => (sectionLang === 'fr' ? 'Tous' : 'All'));
      list.forEach((type, index) => {
        const text = entries[index]?.text as string;
        const extra = type as { weight?: number; required?: boolean };
        planted.push(
          value(
            'personas',
            {
              id: dimension,
              title: key === 'types' ? 'The kind of customer' : 'How the customer writes',
              kind: 'persona',
              ...(role ? { role } : {}),
            },
            type.id,
            type.title.en,
            text,
            extra.weight !== undefined || extra.required
              ? {
                  ...(extra.weight !== undefined ? { weight: extra.weight } : {}),
                  ...(extra.required ? { required: true } : {}),
                }
              : undefined,
          ),
        );
      });
      if (key === 'types') {
        for (const type of spec.types) {
          if (type.weight !== undefined) {
            const text = en(
              `About ${Math.round(type.weight * 100)} percent of customers are ${type.id} customers.`,
            );
            out.push(`${text}\n\n`);
            const entry = planted.find(
              (p): p is PlantedValue =>
                p.type === 'value' && p.dimension.id === spec.typeDimension && p.value.id === type.id,
            );
            if (entry) {
              entry.quote = text;
              entry.anchor = text;
            }
          }
          if (type.required) {
            const text = en(`Every test plan must include a ${type.id} customer.`);
            out.push(`${text}\n\n`);
          }
        }
      }
    } else if (key.startsWith('rules-')) {
      const group = groups[Number(key.slice(6))] ?? [];
      const sentences = group.map((rule) => ({
        rule,
        text: say(ruleSentence(rule, wording, options.split ?? false, options.qaLines ?? false), rule.lang),
      }));
      const entries = sentences.map(({ rule, text }) => ({
        text,
        column: 'Rule',
        ...(rule.when?.how === 'scope'
          ? { scope: rule.when.dimension === 'flow' ? `refund flow` : rule.when.value }
          : {}),
      }));
      const written = block(
        structure,
        number,
        entries,
        (scope) =>
          scope === undefined
            ? 'Everywhere'
            : scope === 'refund flow'
              ? 'In the refund flow'
              : `Only on ${scope}`,
        options.wrapRules,
      );
      for (const { rule, text } of sentences) {
        if (rule.status === 'live') plantRule(rule, text, written.get(text));
        // A replaced rule is not in force; a reader who has not seen its update reports it.
        if (rule.status === 'replaced') {
          plantRule(rule, text, written.get(text), {
            silent: true,
            context: { anchor: updateMarker(rule), ifMissing: 'report' },
          });
        }
      }
      if (Number(key.slice(6)) === 0 && spec.toolOrder) {
        const text = en(`Always call \`${spec.toolOrder.before}\` before \`${spec.toolOrder.after}\`.`);
        out.push(`${text}\n\n`);
        planted.push({
          type: 'relation',
          section: 'relations',
          source: 'prompt.md',
          quote: text,
          anchor: text,
          relation: { kind: 'tool_order', before: spec.toolOrder.before, after: spec.toolOrder.after },
        });
      }
    } else if (key === 'examples') {
      inExamples.forEach((rule, index) => {
        const text = say(ruleSentence(rule, wording, false), rule.lang);
        out.push(
          `Example conversation ${index + 1}:\nCustomer: ${MESSAGES[index % MESSAGES.length]}\nAssistant: Thank you, I will help you with that.\n(Note: ${text} ${en('This holds in every conversation.')})\n\n`,
        );
        plantRule(rule, text);
      });
      for (let i = 0; i < spec.contradicting; i++) {
        out.push(
          `${en('Example of a wrong reply, do not copy it:')}\nCustomer: ${MESSAGES[(i + 1) % MESSAGES.length]}\nAssistant: Sure, I changed it without checking anything and skipped the usual steps.\n${en('This reply breaks the rules above.')}\n\n`,
        );
      }
    } else if (key === 'deprecated') {
      const marker = (HEADINGS.deprecated as Text).en;
      const texts = deprecated.map((rule) => say(ruleSentence(rule, wording, false), rule.lang));
      const written = block(
        structure === 'table' || structure === 'nested' ? 'markdown' : structure,
        number,
        texts.map((text) => ({ text })),
        () => 'All',
      );
      // A deprecated rule is not in force; a reader who has not seen the section heading reports it.
      deprecated.forEach((rule, index) => {
        const text = texts[index] as string;
        plantRule(rule, text, written.get(text), {
          silent: true,
          context: { anchor: marker, ifMissing: 'report' },
        });
      });
    } else if (key === 'constraints') {
      for (const constraint of spec.constraints) {
        const text =
          constraint.kind === 'type-channel'
            ? en(
                `A ${constraint.forbid[spec.typeDimension]} customer never reaches us on ${constraint.forbid.channel}.`,
              )
            : en(`The ${constraint.forbid.stage} stage never happens on ${constraint.forbid.channel}.`);
        out.push(`${text}\n\n`);
        planted.push({
          type: 'constraint',
          section: constraint.kind === 'type-channel' ? 'personas' : 'stages',
          source: 'prompt.md',
          quote: text,
          anchor: text,
          forbid: constraint.forbid,
          reason: 'the prompt states it',
        } satisfies PlantedConstraint);
      }
    } else if (key === 'updates') {
      for (const rule of replacing) {
        const old = spec.rules.find((candidate) => candidate.id === rule.replaces) as StyledRule;
        const text = say(ruleSentence(rule, wording, options.split ?? false), rule.lang);
        out.push(`Update: ${updateMarker(old)}. ${text}\n\n`);
        plantRule(rule, text);
      }
    }
    for (const decoy of decoyAt.get(key) ?? []) out.push(`${en(decoy)}\n\n`);
  });
  const prompt = `${out.join('').trimEnd()}\n`;
  const tools = `# Tools written by the map validator. Every name is fictional.\n${stringify(
    {
      tools: STYLED_TOOLS.map((name) => ({
        name,
        input_schema: {
          type: 'object',
          required: ['reference'],
          properties: { reference: { type: 'string' } },
        },
      })),
    },
    { lineWidth: 0 },
  )}`;
  return {
    prompt,
    planted,
    sources: [
      inventorySource(spec.inventory),
      { kind: 'tools', path: 'tools.yaml', text: tools },
      { kind: 'prompt', path: 'prompt.md', text: prompt },
    ],
    code: inventoryCode(spec.inventory),
    absent: [...deprecated, ...spec.rules.filter((rule) => rule.status === 'replaced')].map(
      (rule) => rule.id,
    ),
  };
}

/** The walk over a tool schema that turns each partitioned property into a data dimension. */

import { isMap, isSeq, type Pair, parseDocument, YAMLMap } from 'yaml';
import { entry, keyOf, mapAt, pairText, plain, stringItems } from './nodes';
import type { ProposalDimension, ProposalValue } from './proposal';
import { foldQuote } from './quote';
import { proposeRole } from './space';
import { partitionsOf, SHORT_TYPES, typesOf } from './tool-partitions';
import type { Partition, Requote, Tool } from './tool-types';

/** How deep the pre-pass follows nested objects: `customer.email` is depth 1. */
const MAX_DEPTH = 3;
/** A property's whole text is its quote when it is this short; a longer one is quoted by its keyword. */
const WHOLE_PROPERTY_QUOTE = 300;
/** The longest quote a proposal may hold. */
const MAX_QUOTE = 1000;

export type Walk = {
  text: string;
  source: string;
  tool: Tool;
  direction: 'in' | 'out';
  dimensions: ProposalDimension[];
  ids: Set<string>;
  open: string[];
  /** The tool's input or output schema, where a local $ref points. */
  root: YAMLMap;
  /** The schema is a Cohere parameter_definitions mapping. */
  cohere: boolean;
  /** The $refs being read, outermost first: a $ref entered twice is not entered again. */
  stack: string[];
  /** Rewrites a quote to the text of the file the data was converted from. */
  requote?: Requote;
};

export function walkXml(ctx: Walk, parameters: NonNullable<Tool['xml']>): void {
  for (const { name, type, quote } of parameters) {
    const property = parseDocument(`type: ${SHORT_TYPES[type] ?? type}`).contents;
    if (!isMap(property)) continue;
    const partitions = partitionsOf(name, property, () => quote);
    if (partitions.length === 0) partitions.push({ id: 'present', title: `${name} is given`, quote });
    partitions.push({ id: 'absent', title: `${name} is left out (not required)`, quote });
    addDimension(ctx, [name], partitions);
  }
}

/** OpenAPI query parameters: each is a property named by `name`, with its `schema` and `required` flag. */
export function walkQuery(ctx: Walk, parameters: YAMLMap[]): void {
  for (const parameter of parameters) {
    const name = plain(entry(parameter, 'name')?.value);
    const schemaPair = entry(parameter, 'schema');
    if (typeof name !== 'string' || !schemaPair || !isMap(schemaPair.value)) continue;
    field(
      ctx,
      name,
      schemaPair,
      schemaPair.value,
      plain(entry(parameter, 'required')?.value) === true,
      undefined,
      [],
      0,
    );
  }
}

export function walk(ctx: Walk, schema: YAMLMap, prefix: string[], depth: number): void {
  const properties = ctx.cohere ? schema : mapAt(schema, 'properties');
  if (!properties) return;
  const requiredPair = ctx.cohere ? undefined : entry(schema, 'required');
  const required = new Set(stringItems(requiredPair?.value));
  // A required list inside an allOf member counts as the schema's own.
  const allOf = entry(schema, 'allOf')?.value;
  if (isSeq(allOf))
    for (const member of allOf.items)
      for (const key of stringItems(entry(member, 'required')?.value)) required.add(key);
  if (ctx.cohere) {
    for (const pair of properties.items as Pair[]) {
      const name = keyOf(pair);
      if (name !== undefined && plain(entry(pair.value, 'required')?.value) === true) required.add(name);
    }
  }
  // dependentRequired, draft-07 dependencies (array form) and dependentSchemas with a required list.
  const needs = new Map<string, Array<{ other: string; quote: string }>>();
  for (const keyword of ['dependentRequired', 'dependencies', 'dependentSchemas']) {
    const dependency = entry(schema, keyword);
    for (const pair of (isMap(dependency?.value) ? dependency.value.items : []) as Pair[]) {
      const name = keyOf(pair);
      const others = isMap(pair.value)
        ? stringItems(entry(pair.value, 'required')?.value)
        : stringItems(pair.value);
      if (name === undefined) continue;
      needs.set(name, [
        ...(needs.get(name) ?? []),
        ...others.map((other) => ({ other, quote: pairText(ctx.text, dependency) ?? '' })),
      ]);
    }
  }
  for (const pair of properties.items as Pair[]) {
    const name = keyOf(pair);
    const property = resolveRef(ctx.root, pair.value);
    if (name === undefined || !isMap(property)) continue;
    // A caller never sends a readOnly property, a tool never returns a writeOnly one, and a deprecated one is not exercised.
    const flag = (key: string) => plain(entry(property, key)?.value) === true;
    if (
      flag('deprecated') ||
      (flag('readOnly') && ctx.direction === 'in') ||
      (flag('writeOnly') && ctx.direction === 'out')
    )
      continue;
    const via = refOf(pair.value);
    const items = entry(property, 'items')?.value;
    // A $ref already entered once is read a second time for its plain properties, never a third time.
    if (entered(ctx, via) >= 2 || entered(ctx, refOf(items)) >= 2) continue;
    // A readOnly output and a writeOnly input are always there: the side that sets them gives them.
    const always =
      (flag('readOnly') && ctx.direction === 'out') || (flag('writeOnly') && ctx.direction === 'in');
    field(
      ctx,
      name,
      pair,
      property,
      required.has(name) || always,
      requiredPair,
      prefix,
      depth,
      via,
      needs.get(name),
    );
  }
  objectCases(ctx, schema, prefix);
}

/** What an object accepts beyond its named properties: a key it does not allow, a typed extra key, a pattern key. */
function objectCases(ctx: Walk, schema: YAMLMap, prefix: string[]): void {
  const cases: Array<[string, string, Array<[string, string]>]> = [];
  // A closed input (additionalProperties false) rejects a key the schema does not name: a case sends one.
  if (ctx.direction === 'in' && plain(entry(schema, 'additionalProperties')?.value) === false) {
    cases.push(['additionalProperties', 'unknown-key', [['sent', 'a key the schema does not name is sent']]]);
  }
  if (plain(entry(schema, 'unevaluatedProperties')?.value) === false) {
    cases.push([
      'unevaluatedProperties',
      'unknown-key',
      [['sent', 'a key the schema does not evaluate is sent']],
    ]);
  }
  if (isMap(entry(schema, 'additionalProperties')?.value)) {
    cases.push([
      'additionalProperties',
      'extra-key',
      [
        ['typed', 'an extra key holds a value of the schema it states'],
        ['mistyped', 'an extra key holds a value of another type'],
      ],
    ]);
  }
  if (isMap(entry(schema, 'patternProperties')?.value)) {
    cases.push([
      'patternProperties',
      'pattern-key',
      [
        ['matching', 'a key matching the pattern holds a value of its schema'],
        ['mistyped', 'a key matching the pattern holds a value of another type'],
      ],
    ]);
  }
  if (entry(schema, 'if') && (entry(schema, 'then') || entry(schema, 'else'))) {
    cases.push([
      'if',
      'if',
      [
        ['then', 'the condition holds and the then schema applies'],
        ['else', 'the condition fails and the else schema applies'],
      ],
    ]);
  }
  for (const [keyword, id, values] of cases) {
    const quote = pairText(ctx.text, entry(schema, keyword)) ?? '';
    addDimension(
      ctx,
      [...prefix, id],
      values.map(([partition, title]) => ({ id: partition, title, quote })),
    );
  }
}

function refOf(node: unknown): string | undefined {
  const ref = isMap(node) ? plain(entry(node, '$ref')?.value) : undefined;
  return typeof ref === 'string' ? ref : undefined;
}

const entered = (ctx: Walk, ref: string | undefined) =>
  ref === undefined ? 0 : ctx.stack.filter((seen) => seen === ref).length;

/** Reads a schema reached through a $ref: the ref is on the stack while its properties are read. */
function walkVia(ctx: Walk, schema: YAMLMap, prefix: string[], depth: number, via: string | undefined): void {
  if (via) ctx.stack.push(via);
  walk(ctx, schema, prefix, depth);
  if (via) ctx.stack.pop();
}

/** An array's items: `<array>.item` (or `<array>.<position>` for a tuple), and the properties of an object item. */
function arrayItems(
  ctx: Walk,
  name: string,
  property: YAMLMap,
  quote: (keyword?: string) => string,
  path: string[],
  depth: number,
): void {
  const tuple = entry(property, 'prefixItems')?.value ?? entry(property, 'items')?.value;
  const children: Array<{ at: string; raw: unknown; keyword: string }> = isSeq(tuple)
    ? tuple.items.map((raw, index) => ({
        at: String(index),
        raw,
        keyword: entry(property, 'prefixItems') ? 'prefixItems' : 'items',
      }))
    : tuple
      ? [{ at: 'item', raw: tuple, keyword: 'items' }]
      : [];
  for (const child of children) {
    const node = resolveRef(ctx.root, child.raw);
    if (!isMap(node)) continue;
    const childPath = [...path, child.at];
    const partitions = partitionsOf(
      `${name} ${child.at}`,
      node,
      () => quote(child.keyword),
      (n) => resolveRef(ctx.root, n),
    );
    if (partitions.length > 0) addDimension(ctx, childPath, partitions);
    if (typesOf(node).includes('object') && depth + 1 <= MAX_DEPTH)
      walkVia(ctx, node, childPath, depth + 1, refOf(child.raw));
  }
}

/** One property: its partitions, its optional cases, and its nested object. */
function field(
  ctx: Walk,
  name: string,
  pair: Pair,
  property: YAMLMap,
  isRequired: boolean,
  requiredPair: Pair | undefined,
  prefix: string[],
  depth: number,
  via?: string,
  needs: Array<{ other: string; quote: string }> = [],
): void {
  const path = [...prefix, name];
  const quote = quoter(ctx.text, pair, property);
  const partitions = partitionsOf(name, property, quote, (node) => resolveRef(ctx.root, node));
  const types = typesOf(property);
  if (!isRequired) {
    // An optional property with a default is left out and the default applies: that is a case of its own.
    if (entry(property, 'default') !== undefined) {
      partitions.push({ id: 'at-default', title: `${name} is left to its default`, quote: quote('default') });
    }
    if (partitions.length === 0) {
      partitions.push({ id: 'present', title: `${name} is given`, quote: quote() });
    }
    partitions.push({
      id: 'absent',
      title: `${name} is left out (not required)`,
      quote: pairText(ctx.text, requiredPair) ?? quote(),
    });
  }
  for (const { other, quote: why } of needs) {
    partitions.push({
      id: `present-without-${other}`,
      title: `${name} is given without ${other}`,
      quote: why,
    });
  }
  if (partitions.length > 0) addDimension(ctx, path, partitions);
  else if (!types.includes('object')) ctx.open.push(path.join('.'));
  if (types.includes('object') && depth + 1 <= MAX_DEPTH) walkVia(ctx, property, path, depth + 1, via);
  if (types.includes('array')) arrayItems(ctx, name, property, quote, path, depth);
  variantChildren(ctx, property, path, depth);
}

/** The properties of the object branches of a oneOf or anyOf: `<property>.<variant>.<child>`. */
function variantChildren(ctx: Walk, property: YAMLMap, path: string[], depth: number): void {
  if (depth + 1 > MAX_DEPTH) return;
  for (const keyword of ['oneOf', 'anyOf']) {
    const list = entry(property, keyword)?.value;
    if (!isSeq(list)) continue;
    list.items.forEach((raw, index) => {
      const node = resolveRef(ctx.root, raw);
      if (!isMap(node) || !typesOf(node).includes('object')) return;
      const title = plain(entry(node, 'title')?.value);
      walkVia(
        ctx,
        node,
        [...path, typeof title === 'string' ? title : String(index + 1)],
        depth + 1,
        refOf(raw),
      );
    });
  }
}

/**
 * A local $ref (`#/$defs/Name`, `#/definitions/Name`) read from the schema it sits in, one step: the target's
 * own keywords replace the reference. Anything else is returned as it is.
 */
function resolveRef(root: YAMLMap, node: unknown): unknown {
  const ref = isMap(node) ? plain(entry(node, '$ref')?.value) : undefined;
  if (typeof ref !== 'string' || !isMap(node)) return node;
  let target: unknown;
  if (ref.startsWith('#/')) {
    target = root;
    for (const part of ref.slice(2).split('/'))
      target = mapAt(target, part.replace(/~1/g, '/').replace(/~0/g, '~')) ?? entry(target, part)?.value;
  } else if (/^#[A-Za-z_][\w.-]*$/.test(ref)) {
    target = findAnchor(root, ref.slice(1));
  }
  if (!isMap(target)) return node;
  // Keywords beside the $ref apply with it (JSON Schema 2020-12): the target's keywords, then the siblings'.
  const siblings = (node.items as Pair[]).filter((pair) => keyOf(pair) !== '$ref');
  if (siblings.length === 0) return target;
  const merged = new YAMLMap();
  const sibling = new Set(siblings.map(keyOf));
  for (const pair of target.items as Pair[]) if (!sibling.has(keyOf(pair))) merged.items.push(pair);
  merged.items.push(...siblings);
  return merged;
}

/** The mapping that states `$anchor: <name>`, found anywhere under the root. */
function findAnchor(node: unknown, name: string): YAMLMap | undefined {
  if (isSeq(node)) {
    for (const item of node.items) {
      const found = findAnchor(item, name);
      if (found) return found;
    }
    return undefined;
  }
  if (!isMap(node)) return undefined;
  if (plain(entry(node, '$anchor')?.value) === name) return node;
  for (const pair of node.items as Pair[]) {
    const found = findAnchor(pair.value, name);
    if (found) return found;
  }
  return undefined;
}

function addDimension(ctx: Walk, path: string[], partitions: Partition[]): void {
  let id = [toolSlug(ctx.tool.name), ctx.direction, ...path.map(propertySlug)].join('.');
  for (let n = 2; ctx.ids.has(id); n++) id = `${id}-${n}`;
  ctx.ids.add(id);
  // A spec names a data value by its id alone (the tag data:<id>), so the id carries its dimension.
  const seen = new Set<string>();
  const values: ProposalValue[] = partitions.map((partition) => {
    let valueId = `${id}.${partition.id}`;
    for (let n = 2; seen.has(valueId); n++) valueId = `${id}.${partition.id}-${n}`;
    seen.add(valueId);
    return {
      id: valueId,
      title: partition.title,
      evidence: {
        source: ctx.source,
        quote: ctx.requote ? ctx.requote(partition.quote, path) : partition.quote,
      },
      produced_by: 'code',
    };
  });
  const side = ctx.direction === 'in' ? 'input' : 'output';
  ctx.dimensions.push({
    id,
    title: `${ctx.tool.name} ${side} ${path.join('.')}`,
    kind: 'data',
    role: proposeRole(ctx.dimensions, 'data', true),
    produced_by: 'code',
    approved: false,
    values,
  });
}

/** The quote for a partition: the whole property when it is short, else the keyword's own line. */
function quoter(text: string, pair: Pair, property: YAMLMap): (keyword?: string) => string {
  const whole = pairText(text, pair) ?? '';
  // A quote is at most 1000 characters: a longer line is quoted by its first passage.
  const cap = (quote: string) => (quote.length > MAX_QUOTE ? quote.slice(0, MAX_QUOTE).trimEnd() : quote);
  return (keyword) => {
    if (foldQuote(whole).length <= WHOLE_PROPERTY_QUOTE || !keyword) return cap(whole);
    return cap(pairText(text, entry(property, keyword)) ?? whole);
  };
}

/** A tool name as a dimension id part: `catalog.search` stays, `getWeather` becomes `get_weather`. */
export function toolSlug(name: string): string {
  const slug = snake(name).replace(/[^a-z0-9_.-]+/g, '_');
  return /^[a-z]/.test(slug) ? slug : `t_${slug}`;
}

function propertySlug(name: string): string {
  const slug = snake(name).replace(/[^a-z0-9_-]+/g, '_');
  return slug === '' ? 'p' : slug;
}

function snake(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

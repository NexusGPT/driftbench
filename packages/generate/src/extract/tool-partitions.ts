/** The partitions a JSON Schema states for one property: the values a data dimension takes. */
import { isMap, isScalar, isSeq, type Pair, type YAMLMap } from 'yaml';
import { entry, keyOf, mapAt, plain, stringItems } from './nodes';
import type { Partition } from './tool-types';

const TYPE_NULL = (node: unknown) => isMap(node) && plain(entry(node, 'type')?.value) === 'null';

/**
 * oneOf, anyOf and allOf. A oneOf or anyOf of consts reads like an enum; a branch beside a null branch gives
 * its own partitions and null; any other gives one value per branch, `variant-<title>`, `variant-<key>` for
 * an OpenAPI discriminator mapping, else `variant-<n>`. allOf gives the partitions of every member.
 */
function compositionPartitions(
  name: string,
  property: YAMLMap,
  quote: (keyword?: string) => string,
  resolve: (node: unknown) => unknown,
): Partition[] | undefined {
  const allOf = entry(property, 'allOf')?.value;
  if (isSeq(allOf)) {
    const merged: Partition[] = [];
    for (const member of allOf.items) {
      const node = resolve(member);
      if (!isMap(node)) continue;
      for (const partition of partitionsOf(name, node, () => quote('allOf'), resolve)) {
        if (!merged.some((seen) => seen.id === partition.id)) merged.push(partition);
      }
    }
    if (merged.length > 0) return merged;
  }
  for (const keyword of ['oneOf', 'anyOf']) {
    const list = entry(property, keyword)?.value;
    if (!isSeq(list)) continue;
    const branches = list.items.map((item) => ({ raw: item, node: resolve(item) }));
    const maps = branches.filter((branch) => isMap(branch.node));
    if (maps.length === 0) continue;
    if (maps.every((branch) => entry(branch.node, 'const'))) {
      return maps.map((branch) => {
        const constant = plain(entry(branch.node, 'const')?.value);
        return { id: valueSlug(constant), title: `${name} is ${show(constant)}`, quote: quote(keyword) };
      });
    }
    const nonNull = maps.filter((branch) => !TYPE_NULL(branch.node));
    if (nonNull.length === 1 && maps.length === 2) {
      const only = nonNull[0]?.node;
      const inner = isMap(only) ? partitionsOf(name, only, () => quote(keyword), resolve) : [];
      return [...inner, { id: 'null', title: `${name} is null`, quote: quote(keyword) }];
    }
    const mapping = mapAt(entry(property, 'discriminator')?.value, 'mapping');
    const keys = new Map<string, string>();
    for (const pair of (mapping?.items ?? []) as Pair[]) {
      const target = plain(pair.value);
      if (typeof target === 'string') keys.set(target, keyOf(pair) ?? '');
    }
    const used = new Set<string>();
    return maps.map((branch, index) => {
      const ref = isMap(branch.raw) ? plain(entry(branch.raw, '$ref')?.value) : undefined;
      const title = plain(entry(branch.node, 'title')?.value);
      const label =
        (typeof ref === 'string' && keys.get(ref)) ||
        (typeof title === 'string' && title) ||
        String(index + 1);
      let id = `variant-${valueSlug(label)}`;
      for (let n = 2; used.has(id); n++) id = `variant-${valueSlug(label)}-${n}`;
      used.add(id);
      return { id, title: `${name} takes the form ${label}`, quote: quote(keyword) };
    });
  }
  return undefined;
}

/** The partitions a property's schema states, each with the keyword whose text justifies it. */
export function partitionsOf(
  name: string,
  property: YAMLMap,
  quote: (keyword?: string) => string,
  resolve: (node: unknown) => unknown = (node) => node,
): Partition[] {
  const composed = compositionPartitions(name, property, quote, resolve);
  if (composed) return composed;
  const out: Partition[] = [];
  const add = (id: string, title: string, keyword?: string) => out.push({ id, title, quote: quote(keyword) });
  const types = typesOf(property);
  const members = plain(entry(property, 'enum')?.value);
  if (Array.isArray(members)) {
    for (const [index, member] of members.entries()) {
      add(
        isStructured(member) ? `member-${index + 1}` : valueSlug(member),
        `${name} is ${show(member)}`,
        'enum',
      );
    }
  } else if (entry(property, 'const')) {
    const constant = plain(entry(property, 'const')?.value);
    add(
      isStructured(constant) ? 'fixed' : valueSlug(constant),
      `${name} is always ${show(constant)}`,
      'const',
    );
  } else {
    if (types.includes('boolean')) {
      add('true', `${name} is true`, 'type');
      add('false', `${name} is false`, 'type');
    }
    if (types.includes('integer') || types.includes('number')) numberPartitions(name, property, add);
    if (types.includes('string')) stringPartitions(name, property, add);
    if (types.includes('array')) arrayPartitions(name, property, add);
    if (types.includes('object') && types.includes('null')) add('present', `${name} is an object`, 'type');
    if (types.includes('object')) objectPartitions(name, property, add);
  }
  // not with an enum: a value the enum excludes, and one it allows.
  if (Array.isArray(plain(entry(mapAt(property, 'not'), 'enum')?.value))) {
    add('excluded', `${name} is one of the values the schema excludes`, 'not');
    add('allowed', `${name} is a value the schema allows`, 'not');
  }
  const nullable =
    plain(entry(property, 'nullable')?.value) === true ||
    plain(entry(property, 'x-nullable')?.value) === true;
  // An enum that lists null already gave the null partition.
  const listed = out.some((partition) => partition.id === 'null');
  if ((types.includes('null') || nullable) && !listed)
    add(
      'null',
      `${name} is null`,
      nullable ? (entry(property, 'nullable') ? 'nullable' : 'x-nullable') : 'type',
    );
  return out;
}

const isStructured = (value: unknown) => value !== null && typeof value === 'object';

type Add = (id: string, title: string, keyword?: string) => void;

const property_format = (property: YAMLMap) => plain(entry(property, 'format')?.value);

function numberPartitions(name: string, property: YAMLMap, add: Add): void {
  const bound = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  // Draft-04 writes an exclusive bound as minimum or maximum with a boolean exclusiveMinimum or exclusiveMaximum.
  const flag = (key: string) => plain(entry(property, key)?.value) === true;
  let minimum = bound('minimum');
  let maximum = bound('maximum');
  let exclusiveMinimum = bound('exclusiveMinimum');
  let exclusiveMaximum = bound('exclusiveMaximum');
  if (flag('exclusiveMinimum') && minimum !== undefined) {
    exclusiveMinimum = minimum;
    minimum = undefined;
  }
  if (flag('exclusiveMaximum') && maximum !== undefined) {
    exclusiveMaximum = maximum;
    maximum = undefined;
  }
  if (minimum !== undefined) {
    add('below-minimum', `${name} below its minimum ${minimum}`, 'minimum');
    add('at-minimum', `${name} at its minimum ${minimum}`, 'minimum');
    add('above-minimum', `${name} just above its minimum ${minimum}`, 'minimum');
  }
  if (exclusiveMinimum !== undefined) {
    add(
      'at-exclusive-minimum',
      `${name} equal to its exclusive minimum ${exclusiveMinimum}`,
      'exclusiveMinimum',
    );
    add('above-exclusive-minimum', `${name} just above ${exclusiveMinimum}`, 'exclusiveMinimum');
  }
  if (maximum !== undefined) {
    add('below-maximum', `${name} just below its maximum ${maximum}`, 'maximum');
    add('at-maximum', `${name} at its maximum ${maximum}`, 'maximum');
    add('above-maximum', `${name} above its maximum ${maximum}`, 'maximum');
  }
  if (exclusiveMaximum !== undefined) {
    add('below-exclusive-maximum', `${name} just below ${exclusiveMaximum}`, 'exclusiveMaximum');
    add(
      'at-exclusive-maximum',
      `${name} equal to its exclusive maximum ${exclusiveMaximum}`,
      'exclusiveMaximum',
    );
  }
  if (
    property_format(property) === 'int32' &&
    bound('minimum') === undefined &&
    bound('maximum') === undefined
  ) {
    add('at-int32-max', `${name} at the largest 32-bit integer`, 'format');
    add('above-int32-max', `${name} above the largest 32-bit integer`, 'format');
  }
  const multipleOf = bound('multipleOf');
  if (multipleOf !== undefined && multipleOf > 0) {
    add('multiple', `${name} a multiple of ${multipleOf}`, 'multipleOf');
    add('not-multiple', `${name} not a multiple of ${multipleOf}`, 'multipleOf');
  }
}

function stringPartitions(name: string, property: YAMLMap, add: Add): void {
  const length = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  const minLength = length('minLength');
  const maxLength = length('maxLength');
  if (minLength !== undefined) {
    if (minLength > 0)
      add('below-min-length', `${name} shorter than its minLength ${minLength}`, 'minLength');
    add('at-min-length', `${name} exactly ${minLength} characters long`, 'minLength');
  }
  if (maxLength !== undefined) {
    add('at-max-length', `${name} exactly ${maxLength} characters long`, 'maxLength');
    add('above-max-length', `${name} longer than its maxLength ${maxLength}`, 'maxLength');
  }
  const format = plain(entry(property, 'format')?.value);
  const shaped = typeof format === 'string' ? `a well-formed ${format}` : 'matching its pattern';
  if (typeof format === 'string' || entry(property, 'pattern')) {
    const keyword = typeof format === 'string' ? 'format' : 'pattern';
    add('well-formed', `${name} is ${shaped}`, keyword);
    add('malformed', `${name} is not ${shaped}`, keyword);
    return;
  }
  if (plain(entry(property, 'contentMediaType')?.value) === 'application/json') {
    add('well-formed', `${name} is well-formed JSON`, 'contentMediaType');
    add('malformed', `${name} is not well-formed JSON`, 'contentMediaType');
    return;
  }
  const encoding = plain(entry(property, 'contentEncoding')?.value);
  if (typeof encoding === 'string') {
    add('well-formed', `${name} is well-formed ${encoding}`, 'contentEncoding');
    add('malformed', `${name} is not well-formed ${encoding}`, 'contentEncoding');
  }
}

function objectPartitions(name: string, property: YAMLMap, add: Add): void {
  const count = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  if (entry(mapAt(property, 'propertyNames'), 'pattern')) {
    add('well-formed-key', `${name} has only keys matching its propertyNames pattern`, 'propertyNames');
    add('malformed-key', `${name} has a key that does not match its propertyNames pattern`, 'propertyNames');
  }
  const minProperties = count('minProperties');
  const maxProperties = count('maxProperties');
  if (minProperties !== undefined && minProperties > 0) {
    add(
      'below-min-properties',
      `${name} has ${minProperties - 1} keys, one under its minProperties`,
      'minProperties',
    );
    add('at-min-properties', `${name} has exactly ${minProperties} keys`, 'minProperties');
  }
  if (maxProperties !== undefined) {
    add('at-max-properties', `${name} has exactly ${maxProperties} keys`, 'maxProperties');
    add('above-max-properties', `${name} has more than ${maxProperties} keys`, 'maxProperties');
  }
}

function arrayPartitions(name: string, property: YAMLMap, add: Add): void {
  const count = (key: string) => {
    const value = plain(entry(property, key)?.value);
    return typeof value === 'number' ? value : undefined;
  };
  const minItems = count('minItems');
  const maxItems = count('maxItems');
  add('empty', minItems ? `${name} is empty, below its minItems ${minItems}` : `${name} is empty`, 'type');
  add('one-item', `${name} has one item`, 'type');
  add('several-items', `${name} has several items`, 'type');
  if (minItems !== undefined && minItems > 0) {
    add('below-min-items', `${name} has ${minItems - 1} items, one under its minItems`, 'minItems');
    add('at-min-items', `${name} has exactly ${minItems} items`, 'minItems');
  }
  if (maxItems !== undefined) {
    add('at-max-items', `${name} has exactly ${maxItems} items`, 'maxItems');
    add('above-max-items', `${name} has more than ${maxItems} items`, 'maxItems');
  }
  if (plain(entry(property, 'uniqueItems')?.value) === true) {
    add('duplicate-items', `${name} holds the same item twice`, 'uniqueItems');
  }
  // A closed tuple: an item beyond the listed positions is one more case.
  const tuple = isSeq(entry(property, 'prefixItems')?.value) || isSeq(entry(property, 'items')?.value);
  if (
    tuple &&
    (plain(entry(property, 'unevaluatedItems')?.value) === false ||
      plain(entry(property, 'additionalItems')?.value) === false)
  ) {
    add('extra-item', `${name} has an item beyond its listed positions`, 'unevaluatedItems');
  }
  if (entry(property, 'contains')) {
    add('has-match', `${name} has an item matching contains`, 'contains');
    add('no-match', `${name} has no item matching contains`, 'contains');
    const minContains = count('minContains');
    if (minContains !== undefined && minContains > 0) {
      add(
        'below-min-contains',
        `${name} has ${minContains - 1} matching items, one under minContains`,
        'minContains',
      );
      add('at-min-contains', `${name} has exactly ${minContains} matching items`, 'minContains');
    }
  }
}

export const SHORT_TYPES: Record<string, string> = {
  str: 'string',
  int: 'integer',
  bool: 'boolean',
  float: 'number',
};

export function typesOf(property: YAMLMap): string[] {
  const type = entry(property, 'type')?.value;
  if (isScalar(type) && typeof type.value === 'string') return [SHORT_TYPES[type.value] ?? type.value];
  if (isSeq(type)) return stringItems(type);
  if (entry(property, 'properties')) return ['object'];
  // No type: the keywords say which type the schema constrains (JSON Schema validation, sections 6.2 to 6.4).
  const has = (keys: string[]) => keys.some((key) => entry(property, key) !== undefined);
  if (has(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'])) return ['number'];
  if (has(['format', 'pattern', 'minLength', 'maxLength', 'contentEncoding'])) return ['string'];
  if (has(['items', 'minItems', 'maxItems', 'uniqueItems'])) return ['array'];
  return [];
}

function valueSlug(member: unknown): string {
  const slug = String(member)
    .replace(/[^A-Za-z0-9_.-]+/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .replace(/-+$/, '');
  return slug === '' ? 'value' : slug;
}

function show(member: unknown): string {
  return typeof member === 'string' ? member : JSON.stringify(member);
}

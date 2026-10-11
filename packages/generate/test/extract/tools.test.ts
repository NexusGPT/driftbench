import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { QuoteIndex, type ToolsPrepass, toolSlug, toolsPrepass } from '../../src/extract';
import { ACME } from './support';

function ok(result: ToolsPrepass) {
  if (!result.ok) throw new Error(`expected tools, got ${JSON.stringify(result.errors)}`);
  return result;
}

/** The value ids of a dimension without their dimension prefix, after checking the prefix is there. */
function values(result: ToolsPrepass, id: string): string[] | undefined {
  const ids = ok(result)
    .dimensions.find((dimension) => dimension.id === id)
    ?.values.map((value) => value.id);
  for (const value of ids ?? []) expect(value.startsWith(`${id}.`)).toBe(true);
  return ids?.map((value) => value.slice(id.length + 1));
}

function quotesFound(result: ToolsPrepass, text: string) {
  const index = new QuoteIndex(new Map([['tools.yaml', text]]));
  return ok(result).dimensions.flatMap((dimension) =>
    dimension.values.filter((value) => !index.contains('tools.yaml', value.evidence.quote)).map((v) => v.id),
  );
}

const acmeText = await readFile(`${ACME}map/tools.yaml`, 'utf8');
const acme = toolsPrepass(acmeText, 'tools.yaml');

describe('toolsPrepass on the Acme tools', () => {
  it('reads the five tools', () => {
    expect(ok(acme).tools).toEqual([
      'catalog.search',
      'coverage.check',
      'port.check',
      'order.create',
      'notify_sales',
    ]);
  });

  it('gives an enum one value per member, quoting the property', () => {
    expect(values(acme, 'catalog.search.in.category')).toEqual(['mobile', 'home']);
    expect(values(acme, 'notify_sales.in.reason')).toEqual([
      'callback',
      'no_coverage',
      'tool_failure',
      'order_failed',
    ]);
    const category = ok(acme).dimensions.find((dimension) => dimension.id === 'catalog.search.in.category');
    expect(category?.kind).toBe('data');
    expect(category?.values[0]?.evidence).toEqual({
      source: 'tools.yaml',
      quote: 'category: { type: string, enum: [mobile, home] }',
    });
  });

  it('gives bounds, booleans, arrays, nulls and optional properties their boundary values', () => {
    expect(values(acme, 'coverage.check.out.fiber_mbps')).toEqual([
      'below-minimum',
      'at-minimum',
      'above-minimum',
      'absent',
    ]);
    expect(values(acme, 'coverage.check.out.found')).toEqual(['true', 'false']);
    expect(values(acme, 'catalog.search.out.plans')).toEqual(['empty', 'one-item', 'several-items']);
    expect(values(acme, 'catalog.search.out.customer')).toEqual(['present', 'null', 'absent']);
    expect(values(acme, 'coverage.check.in.address')).toEqual(['below-min-length', 'at-min-length']);
    expect(values(acme, 'order.create.in.customer_id')).toEqual(['present', 'absent']);
  });

  it('follows nested objects and reports the properties whose schema states no partition', () => {
    expect(values(acme, 'notify_sales.in.customer.phone')).toEqual(['present', 'absent']);
    expect(values(acme, 'order.create.in.customer.email')).toBeUndefined();
    expect(ok(acme).notes).toContain(
      'order.create input: no partition stated for plan_id, customer.name, customer.email',
    );
  });

  it('quotes the "absent" value with the required list that leaves the property out', () => {
    const absent = ok(acme)
      .dimensions.find((dimension) => dimension.id === 'catalog.search.in.address_id')
      ?.values.find((value) => value.id === 'catalog.search.in.address_id.absent');
    expect(absent?.evidence.quote).toBe('required: [category]');
  });

  it('quotes only text the tools file holds, and leaves every entry unapproved', () => {
    expect(quotesFound(acme, acmeText)).toEqual([]);
    expect(
      ok(acme)
        .dimensions.flatMap((d) => d.values)
        .every((value) => value.approved === false),
    ).toBe(true);
  });
});

const GENERIC = `- name: get_weather
  description: The weather in a city.
  parameters:
    type: object
    required: [city]
    properties:
      city: { type: string }
      unit: { type: string, enum: [celsius, fahrenheit] }
`;

describe('toolsPrepass on other tool files', () => {
  it('reads a list with parameters, the OpenAI form, a name map and a spec with metadata.tool_schemas alike', () => {
    const openai = `tools:
  - type: function
    function:
      name: get_weather
      parameters:
        type: object
        required: [city]
        properties:
          city: { type: string }
          unit: { type: string, enum: [celsius, fahrenheit] }
`;
    const named = `tool_schemas:
  get_weather:
    input_schema:
      type: object
      required: [city]
      properties:
        city: { type: string }
        unit: { type: string, enum: [celsius, fahrenheit] }
`;
    const spec = `id: weather-spec
metadata:
  tool_schemas:
${GENERIC.replace(/^/gm, '    ').trimEnd()}
blocks:
  - user: hi
`;
    const json = JSON.stringify([
      {
        name: 'get_weather',
        input_schema: {
          type: 'object',
          required: ['city'],
          properties: { city: { type: 'string' }, unit: { type: 'string', enum: ['celsius', 'fahrenheit'] } },
        },
      },
    ]);
    for (const text of [GENERIC, openai, named, spec, json]) {
      const result = toolsPrepass(text, 'tools.yaml');
      expect(values(result, 'get_weather.in.unit')).toEqual(['celsius', 'fahrenheit', 'absent']);
      expect(quotesFound(result, text)).toEqual([]);
    }
  });

  it('proposes the boundaries of numbers, strings, arrays and nulls', () => {
    const text = `- name: book
  input_schema:
    type: object
    required: [guests, nights, code, email, rooms, note, kind]
    properties:
      guests: { type: integer, minimum: 1, maximum: 8 }
      nights: { type: number, exclusiveMinimum: 0, exclusiveMaximum: 30 }
      code: { type: string, minLength: 4, maxLength: 6 }
      email: { type: string, format: email }
      rooms: { type: array, maxItems: 3 }
      note: { type: string, nullable: true, pattern: '^[a-z]+$' }
      kind: { const: standard }
`;
    const result = toolsPrepass(text, 'tools.yaml');
    expect(values(result, 'book.in.guests')).toEqual([
      'below-minimum',
      'at-minimum',
      'above-minimum',
      'below-maximum',
      'at-maximum',
      'above-maximum',
    ]);
    expect(values(result, 'book.in.nights')).toEqual([
      'at-exclusive-minimum',
      'above-exclusive-minimum',
      'below-exclusive-maximum',
      'at-exclusive-maximum',
    ]);
    expect(values(result, 'book.in.code')).toEqual([
      'below-min-length',
      'at-min-length',
      'at-max-length',
      'above-max-length',
    ]);
    expect(values(result, 'book.in.email')).toEqual(['well-formed', 'malformed']);
    expect(values(result, 'book.in.rooms')).toEqual([
      'empty',
      'one-item',
      'several-items',
      'at-max-items',
      'above-max-items',
    ]);
    expect(values(result, 'book.in.note')).toEqual(['well-formed', 'malformed', 'null']);
    expect(values(result, 'book.in.kind')).toEqual(['standard']);
    expect(quotesFound(result, text)).toEqual([]);
  });

  it('quotes a long property by the keyword that states the value', () => {
    const long = 'x'.repeat(320);
    const text = `- name: rate
  input_schema:
    type: object
    required: [stars]
    properties:
      stars:
        description: ${long}
        type: integer
        minimum: 1
`;
    const result = ok(toolsPrepass(text, 'tools.yaml'));
    expect(result.dimensions[0]?.values[0]?.evidence.quote).toBe('minimum: 1');
  });

  it('turns tool and property names into dimension ids', () => {
    const text = `- name: getWeather
  input_schema:
    type: object
    properties:
      cityName: { type: string }
`;
    expect(values(toolsPrepass(text, 'tools.yaml'), 'get_weather.in.city_name')).toEqual([
      'present',
      'absent',
    ]);
    expect(toolSlug('catalog.search')).toBe('catalog.search');
    expect(toolSlug('1st-tool')).toBe('t_1st-tool');
  });

  it('refuses a file it cannot read as tools', () => {
    const codes = (text: string) => {
      const result = toolsPrepass(text, 'tools.yaml');
      return result.ok ? [] : result.errors.map((issue) => issue.code);
    };
    expect(codes('tools: [')).toEqual(['TOOLS_PARSE']);
    expect(codes('id: a spec without tools\n')).toEqual(['TOOLS_NOT_FOUND']);
    expect(codes('- description: no name\n')).toEqual(['TOOLS_INVALID']);
    expect(codes('- { name: a }\n- { name: a }\n')).toEqual(['TOOLS_DUPLICATE']);
  });
});

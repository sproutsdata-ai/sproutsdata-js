/**
 * The tool definitions: the spec files, as each provider takes them. The strict-mode schemas are
 * generated (in sproutsdata-py); these tests hold them to the subset OpenAI accepts, and the
 * descriptions to the tools actually offered.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { ClientValidationError } from '../../src/index.js';
import { anthropic, definitions, type JsonSchema, openai, TOOL_NAMES, Toolset } from '../../src/tools/index.js';
import { client, searchOk } from './support.js';

const SPEC = new URL('../../../../spec/tools/', import.meta.url).pathname;
const spec = (name: string): { input_schema: JsonSchema; strict_input_schema: JsonSchema; description: string; description_hints: Record<string, string> } =>
  JSON.parse(readFileSync(`${SPEC}${name}.json`, "utf8")) as ReturnType<typeof spec>;
const STRICT_KEYWORDS = new Set(['type', 'description', 'enum', 'properties', 'required', 'additionalProperties', 'items']);

function* walk(schema: JsonSchema, path = ''): Generator<[string, JsonSchema]> {
  yield [path, schema];
  for (const [name, child] of Object.entries(schema.properties ?? {})) yield* walk(child, `${path}.${name}`);
  if (schema.items !== undefined) yield* walk(schema.items, `${path}[]`);
}

describe('tool definitions', () => {
  it.each(TOOL_NAMES)('%s: the strict schema is within OpenAI strict mode', (name) => {
    for (const [path, node] of walk(spec(name).strict_input_schema)) {
      expect(Object.keys(node).every((key) => STRICT_KEYWORDS.has(key)), path).toBe(true);
      if (node.type.includes('object')) {
        expect(node.additionalProperties, path).toBe(false);
        expect(node.required, path).toEqual(Object.keys(node.properties ?? {}));
      }
    }
  });

  it.each(TOOL_NAMES)('%s: the strict schema derived at run time is the spec file\'s', (name) => {
    const tool = openai([name]).at(0);
    expect(tool !== undefined && 'function' in tool ? tool.function.parameters : undefined).toEqual(spec(name).strict_input_schema);
  });

  it('are the spec files, with every hint when all three are offered', () => {
    for (const definition of definitions()) {
      const file = spec(definition.name);
      expect(definition.input_schema).toEqual(file.input_schema);
      expect(definition.description).toBe([file.description, ...Object.values(file.description_hints)].join('\n\n'));
    }
  });

  it.each([[['search']], [['similar']], [['lookup']], [['search', 'similar']], [['similar', 'lookup']]])('name only tools in the set: %j', (include) => {
    const defs = definitions(include);
    const offered = new Set(defs.map((d) => d.name));
    const text = JSON.stringify(defs);
    for (const name of TOOL_NAMES.filter((n) => !offered.has(n))) expect(text).not.toContain(name);
  });

  it('take short and full names alike, in emitting order', () => {
    expect(definitions(['search', 'sprouts_entity_lookup'])).toEqual(definitions(['sprouts_entity_lookup', 'sprouts_search']));
  });

  it('for OpenAI chat use the strict schema', () => {
    const [search] = openai();
    expect(search).toEqual({
      type: 'function',
      function: { name: 'sprouts_search', description: definitions()[0]?.description, parameters: spec('sprouts_search').strict_input_schema, strict: true },
    });
  });

  it('for the Responses API are flat and may be loose', () => {
    expect(openai(['lookup'], { strict: false, api: 'responses' })).toEqual([
      {
        type: 'function',
        name: 'sprouts_entity_lookup',
        description: definitions(['lookup'])[0]?.description,
        parameters: spec('sprouts_entity_lookup').input_schema,
        strict: false,
      },
    ]);
  });

  it('refuse an unknown OpenAI api', () => {
    expect(() => openai(undefined, { api: 'completions' as 'chat' })).toThrow(ClientValidationError);
  });

  it('for Anthropic are name, description and input schema', () => {
    const [search] = anthropic(['search']);
    expect(search).toEqual({ name: 'sprouts_search', description: definitions(['search'])[0]?.description, input_schema: spec('sprouts_search').input_schema });
  });

  it('are the same from a toolset as from the module functions', () => {
    const tools = new Toolset(client([searchOk()]).client, { include: ['search', 'lookup'] });
    expect(tools.toolNames).toEqual(['sprouts_search', 'sprouts_entity_lookup']);
    expect(tools.definitions()).toEqual(definitions(['search', 'lookup']));
    expect(tools.openai({ api: 'responses' })).toEqual(openai(['search', 'lookup'], { api: 'responses' }));
    expect(tools.anthropic()).toEqual(anthropic(['search', 'lookup']));
  });

  it('leave out a fixed argument, and refuse it from the model', async () => {
    const tools = new Toolset(client([searchOk()]).client, { fixed: { lookup: { category: 'person' } } });
    const lookup = tools.definitions()[2]?.input_schema;
    expect(lookup?.properties).not.toHaveProperty('category');
    expect(lookup?.required).toEqual(['ids']);
    const strict = tools.openai()[2];
    expect(JSON.stringify(strict)).not.toContain('"category"');
    const refused = await tools.run('sprouts_entity_lookup', { category: 'company', ids: ['x'] });
    expect('error' in refused && refused.error.field_errors[0]).toMatch(/^category: unknown argument\./);
  });
});

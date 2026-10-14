import { type Check, type CheckContext, machineVerdict, type Verdict } from '@agent-nexus/driftbench-core';
import { parameterSchema, validateStrict } from '../support/schema';
import { isRecord } from '../support/values';

const NAME = 'schema_strict';

/**
 * Tool inputs against strict schemas. The schemas come from `spec.metadata.tool_schemas`, a mapping from
 * tool name to its JSON Schema (or to an OpenAI-style function with `parameters`, or an Anthropic-style
 * tool with `input_schema`). One verdict per call: a key the schema does not declare is reported as an
 * invented parameter, beside type, enum, required and range violations. A call to a tool with no schema
 * is inconclusive and does not gate.
 */
export const schemaStrict: Check = {
  name: NAME,
  applies: (ctx) => toolSchemas(ctx) !== undefined && ctx.observed.toolCalls.length > 0,
  evaluate(ctx) {
    const schemas = toolSchemas(ctx);
    if (schemas === undefined) return [];
    const seen = new Map<string, number>();
    return ctx.observed.toolCalls.map((call): Verdict => {
      const n = (seen.get(call.label) ?? 0) + 1;
      seen.set(call.label, n);
      const id = `${call.label}.${n}`;
      const which = `${call.label} call ${n}${call.id === undefined ? '' : ` (${call.id})`}`;
      if (!(call.label in schemas)) {
        return machineVerdict(
          NAME,
          id,
          'inconclusive',
          `${which}: no schema for ${call.label} in metadata.tool_schemas`,
          {
            gating: false,
          },
        );
      }
      const issues = validateStrict(call.input, parameterSchema(schemas[call.label]));
      if (issues.length === 0) return machineVerdict(NAME, id, 'pass', `${which} fits its strict schema`);
      const invented = issues.filter((issue) => issue.invented).length;
      const lines = issues.map((issue) => `${issue.path} ${issue.message}`);
      const head =
        invented > 0 ? `${invented} invented ${invented === 1 ? 'parameter' : 'parameters'}; ` : '';
      return machineVerdict(
        NAME,
        id,
        issues.some((issue) => issue.schemaError) ? 'inconclusive' : 'fail',
        `${which}: ${head}${lines.join('; ')}`,
      );
    });
  },
};

function toolSchemas(ctx: CheckContext): Record<string, unknown> | undefined {
  const schemas = ctx.spec.metadata?.tool_schemas;
  return isRecord(schemas) ? schemas : undefined;
}

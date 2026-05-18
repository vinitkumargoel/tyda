import { z } from "zod";

/**
 * JSON Schema fragment for a property in an OpenAI function definition.
 */
export type JsonSchemaProperty = {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object";
  description?: string;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
};

/**
 * OpenAI function-tool definition shape.
 *
 * Matches the chat.completions tools array entry:
 *   { type: "function", function: { name, description, parameters } }
 */
export type OpenAIFunctionTool = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, JsonSchemaProperty>;
      required: string[];
      additionalProperties?: boolean;
    };
  };
};

/**
 * Peel off `.optional()` and `.describe(...)` wrappers and surface the inner
 * Zod node along with any collected description and whether the field is
 * optional.
 */
function unwrap(node: z.ZodTypeAny): {
  inner: z.ZodTypeAny;
  optional: boolean;
  description: string | undefined;
} {
  let current: z.ZodTypeAny = node;
  let optional = false;
  let description: string | undefined = current._def.description;

  // Iteratively peel wrappers. Zod chains description+optional via _def.
  // ZodOptional wraps the inner type; ZodDefault would too but is unsupported.
  while (
    current instanceof z.ZodOptional ||
    current._def.description !== undefined
  ) {
    if (current._def.description !== undefined && description === undefined) {
      description = current._def.description;
    }
    if (current instanceof z.ZodOptional) {
      optional = true;
      current = current._def.innerType as z.ZodTypeAny;
      // After unwrapping, prefer inner description if outer didn't have one.
      if (description === undefined) {
        description = current._def.description;
      }
      continue;
    }
    // Description-only wrapper: ZodType with _def.description set. We already
    // captured the description; break out.
    break;
  }

  return { inner: current, optional, description };
}

/**
 * Convert a Zod node into a JSON Schema fragment. Throws on unsupported nodes.
 */
function convertNode(node: z.ZodTypeAny, path: string): JsonSchemaProperty {
  const { inner, description } = unwrap(node);

  if (inner instanceof z.ZodString) {
    return description !== undefined
      ? { type: "string", description }
      : { type: "string" };
  }

  if (inner instanceof z.ZodNumber) {
    const isInt = inner._def.checks?.some(
      (c: { kind: string }) => c.kind === "int",
    );
    const type: "integer" | "number" = isInt ? "integer" : "number";
    return description !== undefined ? { type, description } : { type };
  }

  if (inner instanceof z.ZodBoolean) {
    return description !== undefined
      ? { type: "boolean", description }
      : { type: "boolean" };
  }

  if (inner instanceof z.ZodArray) {
    const elementType = inner._def.type as z.ZodTypeAny;
    const { inner: elInner } = unwrap(elementType);
    if (
      !(elInner instanceof z.ZodString) &&
      !(elInner instanceof z.ZodNumber) &&
      !(elInner instanceof z.ZodObject)
    ) {
      throw new Error(
        `zod-to-openai: unsupported array element at "${path}". ` +
          `Only string, number, or object elements are supported.`,
      );
    }
    const items = convertNode(elementType, `${path}[]`);
    return description !== undefined
      ? { type: "array", description, items }
      : { type: "array", items };
  }

  if (inner instanceof z.ZodObject) {
    const shape = inner.shape as Record<string, z.ZodTypeAny>;
    const properties: Record<string, JsonSchemaProperty> = {};
    const required: string[] = [];
    for (const key of Object.keys(shape)) {
      const child = shape[key];
      const { optional: childOptional } = unwrap(child);
      properties[key] = convertNode(child, `${path}.${key}`);
      if (!childOptional) required.push(key);
    }
    const out: JsonSchemaProperty = { type: "object", properties };
    if (required.length > 0) out.required = required;
    if (description !== undefined) out.description = description;
    return out;
  }

  throw new Error(
    `zod-to-openai: unsupported Zod node at "${path}". Got ${inner.constructor.name}. ` +
      `Supported: ZodString, ZodNumber, ZodBoolean, ZodArray<ZodString|ZodNumber|ZodObject>, ZodObject, .optional(), .describe(...).`,
  );
}

/**
 * Convert a top-level Zod object schema into an OpenAI function-tool definition.
 *
 * Throws if the input is not a ZodObject or contains unsupported nodes.
 */
export function zodToOpenAI(
  schema: z.ZodTypeAny,
  name: string,
  description: string,
): OpenAIFunctionTool {
  const { inner } = unwrap(schema);
  if (!(inner instanceof z.ZodObject)) {
    throw new Error(
      `zod-to-openai: top-level schema for "${name}" must be a ZodObject. ` +
        `Got ${inner.constructor.name}.`,
    );
  }

  const shape = inner.shape as Record<string, z.ZodTypeAny>;
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];
  for (const key of Object.keys(shape)) {
    const child = shape[key];
    const { optional: childOptional } = unwrap(child);
    properties[key] = convertNode(child, `${name}.${key}`);
    if (!childOptional) required.push(key);
  }

  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties,
        required,
        additionalProperties: false,
      },
    },
  };
}

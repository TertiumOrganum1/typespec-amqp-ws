/**
 * Типизированное представление AsyncAPI 3.0 документа.
 * Используется как промежуточная структура перед сериализацией в YAML/JSON.
 */
export interface AsyncApiDoc {
  asyncapi: "3.0.0";
  info: AsyncApiInfo;
  servers?: Record<string, AsyncApiServer>;
  channels?: Record<string, AsyncApiChannel>;
  operations?: Record<string, AsyncApiOperation>;
  components?: AsyncApiComponents;
}

export interface AsyncApiInfo {
  title: string;
  version: string;
  description?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name: string; url?: string };
  externalDocs?: { url: string; description?: string };
}

export interface AsyncApiServer {
  host: string;
  protocol: string;
  pathname?: string;
  description?: string;
  variables?: Record<string, { default?: string; description?: string; enum?: string[] }>;
}

export interface AsyncApiChannel {
  address?: string;
  description?: string;
  messages?: Record<string, { $ref: string }>;
  bindings?: Record<string, unknown>;
}

export interface AsyncApiOperation {
  action: "send" | "receive";
  channel: { $ref: string };
  summary?: string;
  description?: string;
  messages?: Array<{ $ref: string }>;
  reply?: {
    channel: { $ref: string };
    messages: Array<{ $ref: string }>;
  };
}

export interface AsyncApiComponents {
  schemas?: Record<string, Schema>;
  messages?: Record<string, AsyncApiMessage>;
}

export interface AsyncApiMessage {
  summary?: string;
  description?: string;
  contentType?: string;
  payload?: Schema | { $ref: string };
}

/**
 * JSON Schema подмножество, которое мы реально генерируем.
 * Намеренно не пытаемся типизировать всё JSON Schema — только то, что эмиттим.
 */
export type Schema =
  | RefSchema
  | StringSchema
  | BooleanSchema
  | IntegerSchema
  | NullableStringSchema
  | NullableBooleanSchema
  | NullableIntegerSchema
  | ArraySchema
  | ObjectSchema
  | AllOfSchema;

export interface RefSchema {
  $ref: string;
  description?: string;
}

export interface StringSchema {
  type: "string";
  title?: string;
  description?: string;
  enum?: string[];
  const?: string;
  format?: "binary";
}

export interface BooleanSchema {
  type: "boolean";
  const?: boolean;
  description?: string;
}

export interface IntegerSchema {
  type: "integer";
  const?: number;
  description?: string;
}

export interface NullableStringSchema {
  type: ["string", "null"];
  description?: string;
}

export interface NullableBooleanSchema {
  type: ["boolean", "null"];
  description?: string;
}

export interface NullableIntegerSchema {
  type: ["integer", "null"];
  description?: string;
}

export interface ArraySchema {
  type: "array";
  items: Schema;
  description?: string;
}

export interface ObjectSchema {
  type: "object";
  properties?: Record<string, Schema>;
  required?: string[];
  additionalProperties?: false | Schema;
  description?: string;
}

export interface AllOfSchema {
  allOf: Schema[];
  description?: string;
}

export function emptyDoc(): AsyncApiDoc {
  return { asyncapi: "3.0.0", info: { title: "Untitled", version: "0.0.0" } };
}

import type { AsyncApiDoc, AsyncApiInfo } from "./document.js";
import {
  ACTION_HINT,
  ACTION_LABEL,
  capitalize,
  code,
  contentType,
  detectTransport,
  messagesDescription,
  operationDetails,
  orderedOperations,
  viewNote,
  type ResolvedMessage,
  type Transport,
  type ViewOperation,
} from "./view-common.js";

/**
 * OpenAPI 3.0-витрина AsyncAPI-документа: только то, что реально эмиттим.
 * Документ нужен для просмотра в GitLab (Swagger UI), кодогенерации по нему нет.
 *
 * Версия 3.0, а не 3.1: GitLab перед показом разбирает спеку своей сборкой swagger-client,
 * и её ветка для 3.1 (ApiDOM) падает с «i is not a function» на любом документе.
 * Поэтому операции лежат в `paths` (webhooks есть только в 3.1), а схемы приводятся
 * к диалекту OpenAPI 3.0.
 */
export interface OpenApiDoc {
  openapi: "3.0.3";
  info: OpenApiInfo;
  externalDocs?: { url: string; description?: string };
  servers: OpenApiServer[];
  /** Всегда пусто: у брокерных сообщений нет HTTP-авторизации, а линтеры требуют поле явно. */
  security: [];
  tags?: OpenApiTag[];
  paths: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, OpenApiSchema> };
}

export type OpenApiInfo = Omit<AsyncApiInfo, "externalDocs">;

export interface OpenApiServer {
  url: string;
  description?: string;
  variables?: Record<string, { default: string; description?: string; enum?: string[] }>;
}

export interface OpenApiTag {
  name: string;
  description: string;
}

export interface OpenApiPathItem {
  post: OpenApiOperation;
}

export interface OpenApiOperation {
  operationId: string;
  summary?: string;
  description?: string;
  tags: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses: Record<string, OpenApiResponse>;
  /** Сырые bindings канала: `x-amqp`, `x-ws`. */
  [extension: `x-${string}`]: unknown;
}

/** Параметр routing key (`{taskUid}` в адресе канала), оформленный как параметр пути. */
export interface OpenApiParameter {
  name: string;
  in: "path";
  required: true;
  description: string;
  schema: { type: "string" };
}

export interface OpenApiRequestBody {
  required: true;
  description?: string;
  content: OpenApiContent;
}

export interface OpenApiResponse {
  description: string;
  content?: OpenApiContent;
}

export type OpenApiContent = Record<string, { schema: OpenApiSchema }>;

/** Схема OpenAPI 3.0 (подмножество JSON Schema Draft 4 с `nullable`). */
export type OpenApiSchema = Record<string, unknown>;

/** Строит OpenAPI 3.0-витрину из готового AsyncAPI-документа. Исходный документ не меняется. */
export function toOpenApiView(doc: AsyncApiDoc): OpenApiDoc {
  const transport = detectTransport(doc);
  const operations = orderedOperations(doc);

  const usedActions = new Set(operations.map((v) => v.op.action));
  const tags = (["receive", "send"] as const)
    .filter((action) => usedActions.has(action))
    .map((action) => ({ name: ACTION_LABEL[action], description: capitalize(ACTION_HINT[action]) }));

  // Ключ пути — «/принимает <routing key>»; при совпадении добавляется operationId.
  const baseKeys = operations.map((v) => `/${ACTION_LABEL[v.op.action]} ${v.address}`);
  const counts = new Map<string, number>();
  for (const key of baseKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const paths: Record<string, OpenApiPathItem> = {};
  operations.forEach((view, i) => {
    const base = baseKeys[i]!;
    const key = counts.get(base)! > 1 ? `${base} (${view.id})` : base;
    paths[key] = { post: buildOperation(transport, view) };
  });

  // Порядок ключей задаёт порядок разделов в YAML.
  const out: OpenApiDoc = {
    openapi: "3.0.3",
    info: buildInfo(doc, transport),
    ...(doc.info.externalDocs ? { externalDocs: structuredClone(doc.info.externalDocs) } : {}),
    servers: buildServers(doc),
    security: [],
    ...(tags.length > 0 ? { tags } : {}),
    paths,
  };

  if (doc.components?.schemas) {
    out.components = {
      schemas: Object.fromEntries(
        Object.entries(doc.components.schemas).map(([name, s]) => [name, toSchema30(s)]),
      ),
    };
  }
  return out;
}

/**
 * Серверы брокера в виде URL `<protocol>://<host><pathname>`. Swagger UI их только показывает,
 * а линтеры требуют непустой `servers`, поэтому без серверов в AsyncAPI ставится заглушка.
 */
function buildServers(doc: AsyncApiDoc): OpenApiServer[] {
  const servers = Object.entries(doc.servers ?? {}).map(([name, s]) => {
    const server: OpenApiServer = {
      url: `${s.protocol}://${s.host}${s.pathname ? `/${s.pathname.replace(/^\//, "")}` : ""}`,
      description: s.description ? `${name} — ${s.description}` : name,
    };
    const variables = Object.entries(s.variables ?? {});
    if (variables.length > 0) {
      server.variables = Object.fromEntries(
        variables.map(([key, v]) => [
          key,
          {
            // В OpenAPI default у переменной сервера обязателен.
            default: v.default ?? v.enum?.[0] ?? "",
            ...(v.description ? { description: v.description } : {}),
            ...(v.enum ? { enum: [...v.enum] } : {}),
          },
        ]),
      );
    }
    return server;
  });
  return servers.length > 0
    ? servers
    : [{ url: "/", description: "Заглушка: в AsyncAPI-документе серверы не описаны" }];
}

function buildInfo(doc: AsyncApiDoc, transport: Transport): OpenApiInfo {
  const src = doc.info;
  const note = viewNote(doc, transport, "в разделе путей, у каждой метод POST");
  const info: OpenApiInfo = {
    title: src.title,
    version: src.version,
    description: src.description ? `${src.description}\n\n---\n\n${note}` : note,
  };
  if (src.contact) info.contact = structuredClone(src.contact);
  if (src.license) info.license = structuredClone(src.license);
  return info;
}

function buildOperation(transport: Transport, view: ViewOperation): OpenApiOperation {
  const { id, op, channel, messages, replies } = view;

  const summary = op.summary ?? messages.find((m) => m.message.summary)?.message.summary;

  // Ключ пути содержит routing key с `{param}`; линтеры требуют описать каждый параметр.
  const parameters: OpenApiParameter[] = Object.entries(channel.parameters ?? {}).map(([name, p]) => ({
    name,
    in: "path",
    required: true,
    description: p.description,
    schema: { type: "string" },
  }));

  const bodyDescription = messagesDescription(messages);
  const requestBody: OpenApiRequestBody | undefined =
    messages.length > 0
      ? {
          required: true,
          ...(bodyDescription ? { description: bodyDescription } : {}),
          content: buildContent(messages),
        }
      : undefined;

  // В 3.0 responses обязателен. Ответ есть только у WS с reply; иначе — 202 «ответа нет».
  const responses: Record<string, OpenApiResponse> =
    replies.length > 0
      ? {
          "200": {
            description:
              messagesDescription(replies) ?? `Ответ: ${replies.map((r) => code(r.name)).join(", ")}`,
            content: buildContent(replies),
          },
        }
      : { "202": { description: "Ответа нет: сообщение передаётся асинхронно." } };

  // Порядок ключей задаёт порядок полей в YAML.
  const result: OpenApiOperation = {
    operationId: id,
    ...(summary ? { summary } : {}),
    description: operationDetails(transport, view, { messageLabel: (m) => code(m.name) }),
    tags: [ACTION_LABEL[op.action]],
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(requestBody ? { requestBody } : {}),
    responses,
  };

  for (const [name, binding] of Object.entries(channel.bindings ?? {})) {
    result[`x-${name}`] = structuredClone(binding);
  }
  return result;
}

function buildContent(messages: ResolvedMessage[]): OpenApiContent {
  const byType = new Map<string, OpenApiSchema[]>();
  for (const { message } of messages) {
    const type = contentType(message);
    const schema = message.payload ? toSchema30(message.payload) : { type: "string", format: "binary" };
    byType.set(type, [...(byType.get(type) ?? []), schema]);
  }
  const content: OpenApiContent = {};
  for (const [type, schemas] of byType) {
    content[type] = { schema: schemas.length === 1 ? schemas[0]! : { oneOf: schemas } };
  }
  return content;
}

/**
 * Схема из SchemaBuilder (JSON Schema 2020-12) → диалект OpenAPI 3.0:
 * `type: [T, "null"]` → `nullable`, `const` → `enum` из одного значения, числовые
 * `exclusiveMinimum/Maximum` → `minimum/maximum` + `true`, `$ref` с соседними полями → `allOf`
 * (в 3.0 соседи `$ref` игнорируются). Возвращает новую схему, исходную не меняет.
 */
export function toSchema30(schema: unknown): OpenApiSchema {
  const src = schema as Record<string, unknown>;
  const out: OpenApiSchema = {};
  for (const [key, value] of Object.entries(src)) {
    if (key === "type" && Array.isArray(value)) {
      const types = value.filter((t) => t !== "null");
      out.type = types[0];
      if (types.length < value.length) out.nullable = true;
    } else if (key === "const") {
      out.enum = [structuredClone(value)];
    } else if ((key === "exclusiveMinimum" || key === "exclusiveMaximum") && typeof value === "number") {
      out[key === "exclusiveMinimum" ? "minimum" : "maximum"] = value;
      out[key] = true;
    } else if (key === "properties") {
      // Ключи здесь — имена полей, а не ключевые слова схемы.
      out.properties = Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([field, s]) => [field, toSchema30(s)]),
      );
    } else if (key === "items" || (key === "additionalProperties" && typeof value === "object")) {
      out[key] = toSchema30(value);
    } else if (key === "allOf" || key === "oneOf" || key === "anyOf") {
      out[key] = (value as unknown[]).map(toSchema30);
    } else {
      out[key] = structuredClone(value);
    }
  }
  if (typeof out.$ref === "string" && Object.keys(out).length > 1) {
    const { $ref, ...rest } = out;
    return { allOf: [{ $ref }], ...rest };
  }
  return out;
}

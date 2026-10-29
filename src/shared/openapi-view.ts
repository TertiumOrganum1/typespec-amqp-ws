import type { AsyncApiDoc, AsyncApiInfo, Schema } from "./document.js";
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
 * OpenAPI 3.1-витрина AsyncAPI-документа: только то, что реально эмиттим.
 * Документ нужен для просмотра в GitLab (Swagger UI), кодогенерации по нему нет.
 */
export interface OpenApiDoc {
  openapi: "3.1.0";
  info: OpenApiInfo;
  externalDocs?: { url: string; description?: string };
  servers: OpenApiServer[];
  /** Всегда пусто: у брокерных сообщений нет HTTP-авторизации, а линтеры требуют поле явно. */
  security: [];
  tags?: OpenApiTag[];
  webhooks?: Record<string, OpenApiPathItem>;
  components?: { schemas?: Record<string, Schema> };
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
  responses?: Record<string, OpenApiResponse>;
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

export type OpenApiSchema = Schema | { oneOf: Schema[] };

/** Строит OpenAPI 3.1-витрину из готового AsyncAPI-документа. Исходный документ не меняется. */
export function toOpenApiView(doc: AsyncApiDoc): OpenApiDoc {
  const transport = detectTransport(doc);
  const out: OpenApiDoc = {
    openapi: "3.1.0",
    info: buildInfo(doc, transport),
    ...(doc.info.externalDocs ? { externalDocs: structuredClone(doc.info.externalDocs) } : {}),
    servers: buildServers(doc),
    security: [],
  };

  const operations = orderedOperations(doc);

  const usedActions = new Set(operations.map((v) => v.op.action));
  const tags = (["receive", "send"] as const)
    .filter((action) => usedActions.has(action))
    .map((action) => ({ name: ACTION_LABEL[action], description: capitalize(ACTION_HINT[action]) }));
  if (tags.length > 0) out.tags = tags;

  if (operations.length > 0) {
    const baseKeys = operations.map((v) => `${ACTION_LABEL[v.op.action]} ${v.address}`);
    const counts = new Map<string, number>();
    for (const key of baseKeys) counts.set(key, (counts.get(key) ?? 0) + 1);

    const webhooks: Record<string, OpenApiPathItem> = {};
    operations.forEach((view, i) => {
      const base = baseKeys[i]!;
      const key = counts.get(base)! > 1 ? `${base} (${view.id})` : base;
      webhooks[key] = { post: buildOperation(transport, view) };
    });
    out.webhooks = webhooks;
  }

  if (doc.components?.schemas) {
    out.components = { schemas: structuredClone(doc.components.schemas) };
  }
  return out;
}

/**
 * Серверы брокера в виде URL `<protocol>://<host><pathname>`. Swagger UI их только показывает
 * (Try it out у webhooks нет), а линтеры требуют непустой `servers`, поэтому без серверов
 * в AsyncAPI ставится заглушка.
 */
function buildServers(doc: AsyncApiDoc): OpenApiServer[] {
  const servers = Object.entries(doc.servers ?? {}).map(([name, s]) => {
    const server: OpenApiServer = {
      url: `${s.protocol}://${s.host}${s.pathname ?? ""}`,
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
  const note = viewNote(doc, transport, "в разделе **Webhooks**");
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

  // Порядок ключей задаёт порядок полей в YAML.
  const summary = op.summary ?? messages.find((m) => m.message.summary)?.message.summary;
  const result: OpenApiOperation = {
    operationId: id,
    ...(summary ? { summary } : {}),
    description: operationDetails(transport, view, { messageLabel: (m) => code(m.name) }),
    tags: [ACTION_LABEL[op.action]],
  };

  // Ключ webhook содержит routing key с `{param}`; линтеры читают его как шаблон пути
  // и требуют описать каждый параметр. Swagger UI покажет их в блоке Parameters.
  const params = Object.entries(channel.parameters ?? {});
  if (params.length > 0) {
    result.parameters = params.map(([name, p]) => ({
      name,
      in: "path",
      required: true,
      description: p.description,
      schema: { type: "string" },
    }));
  }

  if (messages.length > 0) {
    const bodyDescription = messagesDescription(messages);
    result.requestBody = {
      required: true,
      ...(bodyDescription ? { description: bodyDescription } : {}),
      content: buildContent(messages),
    };
  }

  if (replies.length > 0) {
    result.responses = {
      "200": {
        description:
          messagesDescription(replies) ?? `Ответ: ${replies.map((r) => code(r.name)).join(", ")}`,
        content: buildContent(replies),
      },
    };
  }

  for (const [name, binding] of Object.entries(channel.bindings ?? {})) {
    result[`x-${name}`] = structuredClone(binding);
  }
  return result;
}

function buildContent(messages: ResolvedMessage[]): OpenApiContent {
  const byType = new Map<string, Schema[]>();
  for (const { message } of messages) {
    const type = contentType(message);
    const schema: Schema = message.payload
      ? (structuredClone(message.payload) as Schema)
      : { type: "string", format: "binary" };
    byType.set(type, [...(byType.get(type) ?? []), schema]);
  }
  const content: OpenApiContent = {};
  for (const [type, schemas] of byType) {
    content[type] = { schema: schemas.length === 1 ? schemas[0]! : { oneOf: schemas } };
  }
  return content;
}

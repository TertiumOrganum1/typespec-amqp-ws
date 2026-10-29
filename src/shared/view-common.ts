import type {
  AsyncApiChannel,
  AsyncApiDoc,
  AsyncApiMessage,
  AsyncApiOperation,
  AsyncApiServer,
} from "./document.js";

/**
 * Общие куски витрин AsyncAPI-документа (OpenAPI и Markdown): разыменование ссылок,
 * порядок операций и markdown-таблицы транспорта. Работают только с готовым `AsyncApiDoc`.
 */

export type Transport = "amqp" | "ws";
export type Action = AsyncApiOperation["action"];

export const ACTION_LABEL: Record<Action, string> = { receive: "принимает", send: "публикует" };
export const ACTION_HINT: Record<Action, string> = {
  receive: "сервис получает сообщение",
  send: "сервис отправляет сообщение",
};
export const TRANSPORT_LABEL: Record<Transport, string> = { amqp: "AMQP", ws: "WebSocket" };

const DEFAULT_CONTENT_TYPE = "application/json";
const BINARY_CONTENT_TYPE = "application/octet-stream";

export interface ResolvedMessage {
  name: string;
  message: AsyncApiMessage;
}

/** Операция со всем, что на неё ссылается, в удобном для витрин виде. */
export interface ViewOperation {
  id: string;
  op: AsyncApiOperation;
  channel: AsyncApiChannel;
  /** Адрес канала (routing key), если его нет — имя канала. */
  address: string;
  messages: ResolvedMessage[];
  replies: ResolvedMessage[];
}

interface AmqpChannelBinding {
  is?: string;
  exchange?: { name?: string; type?: string; durable?: boolean; autoDelete?: boolean };
  queue?: { name?: string; durable?: boolean; autoDelete?: boolean; exclusive?: boolean };
}

export function detectTransport(doc: AsyncApiDoc): Transport {
  const channels = Object.values(doc.channels ?? {});
  if (channels.some((c) => c.bindings?.amqp !== undefined)) return "amqp";
  if (channels.length > 0) return "ws";
  const protocols = Object.values(doc.servers ?? {}).map((s) => s.protocol.toLowerCase());
  return protocols.some((p) => p.startsWith("ws")) ? "ws" : "amqp";
}

/** Операции документа: сначала все receive, потом все send; внутри — порядок объявления. */
export function orderedOperations(doc: AsyncApiDoc): ViewOperation[] {
  const entries = Object.entries(doc.operations ?? {});
  return [
    ...entries.filter(([, op]) => op.action === "receive"),
    ...entries.filter(([, op]) => op.action === "send"),
  ].map(([id, op]) => {
    const channel = resolveRef<AsyncApiChannel>(doc, op.channel.$ref) ?? {};
    return {
      id,
      op,
      channel,
      address: channel.address ?? refName(op.channel.$ref),
      messages: resolveMessages(doc, op.messages),
      replies: resolveMessages(doc, op.reply?.messages),
    };
  });
}

export interface DetailsOptions {
  /** Как показать имя сообщения в таблице: код или ссылка на модель. */
  messageLabel: (message: ResolvedMessage) => string;
  /** Подготовка свободного текста из AsyncAPI (описаний) к выводу. По умолчанию — как есть. */
  text?: (s: string) => string;
}

/**
 * Markdown-описание операции: описание операции и канала, таблица транспорта,
 * параметры routing key.
 */
export function operationDetails(
  transport: Transport,
  view: ViewOperation,
  opts: DetailsOptions,
): string {
  const { op, channel, messages, replies } = view;
  const text = opts.text ?? ((s: string) => s);
  const parts: string[] = [];
  if (op.description) parts.push(text(op.description));
  // У AMQP описание канала по умолчанию берётся из @doc операции — не дублируем.
  if (channel.description && channel.description !== op.description) {
    parts.push(text(channel.description));
  }

  const rows: Array<[string, string]> = [
    ["Направление", `${ACTION_LABEL[op.action]} — ${ACTION_HINT[op.action]}`],
  ];
  if (transport === "amqp") {
    rows.push(...amqpRows(channel));
  } else if (channel.address) {
    rows.push(["Канал", code(channel.address)]);
  }
  if (messages.length > 0) {
    rows.push(["Сообщение", messages.map(opts.messageLabel).join(", ")]);
    rows.push(["Content type", contentTypes(messages).map(code).join(", ")]);
  }
  if (replies.length > 0) {
    rows.push(["Ответ", replies.map(opts.messageLabel).join(", ")]);
    rows.push(["Content type ответа", contentTypes(replies).map(code).join(", ")]);
  }
  parts.push(table(["Поле", "Значение"], rows));

  const params = Object.entries(channel.parameters ?? {});
  if (params.length > 0) {
    parts.push(
      "**Параметры routing key**\n\n" +
        table(["Параметр", "Описание"], params.map(([name, p]) => [code(name), text(p.description)])),
    );
  }
  return parts.join("\n\n");
}

function amqpRows(channel: AsyncApiChannel): Array<[string, string]> {
  const rows: Array<[string, string]> = [];
  if (channel.address) rows.push(["Routing key", code(channel.address)]);
  const binding = channel.bindings?.amqp as AmqpChannelBinding | undefined;
  const exchange = binding?.exchange;
  if (exchange) {
    if (exchange.name) rows.push(["Exchange", code(exchange.name)]);
    if (exchange.type) rows.push(["Тип exchange", code(exchange.type)]);
    if (exchange.durable !== undefined) rows.push(["Exchange durable", code(String(exchange.durable))]);
    if (exchange.autoDelete !== undefined) {
      rows.push(["Exchange autoDelete", code(String(exchange.autoDelete))]);
    }
  }
  const queue = binding?.queue;
  if (queue) {
    if (queue.name) rows.push(["Очередь", code(queue.name)]);
    if (queue.durable !== undefined) rows.push(["Очередь durable", code(String(queue.durable))]);
    if (queue.autoDelete !== undefined) {
      rows.push(["Очередь autoDelete", code(String(queue.autoDelete))]);
    }
    if (queue.exclusive !== undefined) {
      rows.push(["Очередь exclusive", code(String(queue.exclusive))]);
    }
  }
  return rows;
}

/** Абзац «что это за файл» с таблицей серверов. `whereOperations` — куда смотреть за операциями. */
export function viewNote(doc: AsyncApiDoc, transport: Transport, whereOperations: string): string {
  // Переносы внутри абзацев держат строки короче lineWidth YAML: иначе js-yaml
  // уходит в folded-стиль, и сырой файл читается хуже.
  const parts = [
    `**Витрина AsyncAPI-документа.** Этот файл построен из AsyncAPI-описания сервиса\n` +
      `только для просмотра; кодогенерация и проверки идут от AsyncAPI.\n` +
      `Транспорт: **${TRANSPORT_LABEL[transport]}**.`,
  ];
  const servers = Object.entries(doc.servers ?? {});
  if (servers.length > 0) parts.push(serversTable(servers));
  parts.push(
    `Операции — ${whereOperations}: «принимает» — сервис получает сообщение,\n` +
      "«публикует» — сервис отправляет.",
  );
  return parts.join("\n\n");
}

function serversTable(servers: Array<[string, AsyncApiServer]>): string {
  return table(
    ["Сервер", "Protocol", "Host", "Pathname", "Описание"],
    servers.map(([name, s]) => [
      code(name),
      code(s.protocol),
      code(s.host),
      s.pathname ? code(s.pathname) : "",
      s.description ?? "",
    ]),
  );
}

export function contentType(message: AsyncApiMessage): string {
  return message.contentType ?? (message.payload ? DEFAULT_CONTENT_TYPE : BINARY_CONTENT_TYPE);
}

function contentTypes(messages: ResolvedMessage[]): string[] {
  return [...new Set(messages.map((m) => contentType(m.message)))];
}

export function messagesDescription(messages: ResolvedMessage[]): string | undefined {
  const parts = messages.flatMap(({ message }) =>
    [message.summary, message.description].filter((s): s is string => Boolean(s)),
  );
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function resolveMessages(
  doc: AsyncApiDoc,
  refs: Array<{ $ref: string }> | undefined,
): ResolvedMessage[] {
  const out: ResolvedMessage[] = [];
  for (const { $ref } of refs ?? []) {
    const resolved = resolveMessage(doc, $ref);
    if (resolved) out.push(resolved);
  }
  return out;
}

/** Идёт по цепочке `channels.X.messages.Y → components.messages.Y` до объекта сообщения. */
function resolveMessage(doc: AsyncApiDoc, ref: string): ResolvedMessage | undefined {
  let current = ref;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const node = resolveRef<Record<string, unknown>>(doc, current);
    if (!node) return undefined;
    if (typeof node.$ref === "string") {
      current = node.$ref;
      continue;
    }
    return { name: refName(current), message: node as AsyncApiMessage };
  }
  return undefined;
}

export function resolveRef<T>(doc: AsyncApiDoc, ref: string): T | undefined {
  if (!ref.startsWith("#/")) return undefined;
  let node: unknown = doc;
  for (const segment of ref.slice(2).split("/")) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Record<string, unknown>)[unescapePointer(segment)];
  }
  return node as T | undefined;
}

export function refName(ref: string): string {
  return unescapePointer(ref.slice(ref.lastIndexOf("/") + 1));
}

function unescapePointer(segment: string): string {
  return segment.replace(/~1/g, "/").replace(/~0/g, "~");
}

export function table(header: string[], rows: string[][]): string {
  return [
    row(header),
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map(row),
  ].join("\n");
}

function row(cells: string[]): string {
  return `| ${cells.map(cell).join(" | ")} |`;
}

function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

export function code(text: string): string {
  return `\`${text}\``;
}

export function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

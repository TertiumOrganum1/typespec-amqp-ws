import type { AsyncApiDoc, Schema } from "./document.js";
import {
  ACTION_LABEL,
  code,
  contentType,
  detectTransport,
  operationDetails,
  orderedOperations,
  refName,
  table,
  viewNote,
  type ResolvedMessage,
  type Transport,
  type ViewOperation,
} from "./view-common.js";

/**
 * Markdown-витрина AsyncAPI-документа. GitLab показывает Markdown сразу целиком,
 * поэтому операции и поля сообщений здесь развёрнуты таблицами, без кликов.
 */
export function toMarkdownView(doc: AsyncApiDoc): string {
  const transport = detectTransport(doc);
  const operations = orderedOperations(doc);
  const schemas = doc.components?.schemas ?? {};
  const groups = (
    [
      ["Принимает", operations.filter((v) => v.op.action === "receive")],
      ["Публикует", operations.filter((v) => v.op.action === "send")],
    ] as const
  ).filter(([, group]) => group.length > 0);
  const modelNames = Object.keys(schemas);

  // Якоря считаются в порядке заголовков в документе — так же, как их нумерует GitLab
  // при совпадениях (второй `updateavailable` станет `updateavailable-1`).
  const slugger = new Slugger();
  slugger.slug(`${doc.info.title} ${doc.info.version}`);
  slugger.slug("Содержание");
  const groupAnchor = new Map<string, string>();
  const opAnchor = new Map<string, string>();
  for (const [title, group] of groups) {
    groupAnchor.set(title, slugger.slug(title));
    for (const v of group) opAnchor.set(v.id, slugger.slug(v.id));
  }
  const modelsAnchor = modelNames.length > 0 ? slugger.slug("Модели") : "";
  const ctx: RenderContext = {
    schemas,
    opAnchor,
    modelAnchor: new Map(modelNames.map((name) => [name, slugger.slug(name)])),
  };

  const out: string[] = [`# ${doc.info.title} ${doc.info.version}`];
  if (doc.info.description) out.push(text(doc.info.description));
  out.push(viewNote(doc, transport, "в разделах «Принимает» и «Публикует»"));
  if (doc.info.externalDocs) {
    const { url, description } = doc.info.externalDocs;
    out.push(`Документация: [${text(description ?? url)}](${url})`);
  }

  const toc: string[] = [];
  for (const [title, group] of groups) {
    toc.push(`- [${title}](#${groupAnchor.get(title)})`);
    for (const v of group) {
      const summary = operationSummary(v);
      toc.push(
        `  - [${v.id}](#${opAnchor.get(v.id)}) — ${code(v.address)}` +
          (summary ? ` — ${text(summary)}` : ""),
      );
    }
  }
  if (modelNames.length > 0) toc.push(`- [Модели](#${modelsAnchor}) — ${modelNames.length}`);
  if (toc.length > 0) out.push(`## Содержание\n\n${toc.join("\n")}`);

  for (const [title, group] of groups) {
    out.push(`## ${title}`);
    for (const v of group) out.push(renderOperation(transport, v, ctx));
  }

  if (modelNames.length > 0) {
    out.push("## Модели");
    out.push(
      table(
        ["Модель", "Описание"],
        modelNames.map((name) => [modelLink(name, ctx), text(firstSentence(schemas[name]!.description))]),
      ),
    );
    const usage = messageUsage(operations);
    for (const name of modelNames) out.push(renderModel(name, schemas[name]!, usage.get(name), ctx));
  }
  return `${out.join("\n\n")}\n`;
}

interface RenderContext {
  schemas: Record<string, Schema>;
  opAnchor: Map<string, string>;
  modelAnchor: Map<string, string>;
}

function renderOperation(transport: Transport, view: ViewOperation, ctx: RenderContext): string {
  const summary = operationSummary(view);
  const parts = [
    `### ${view.id}`,
    `**${ACTION_LABEL[view.op.action]}** ${code(view.address)}${summary ? ` — ${text(summary)}` : ""}`,
    operationDetails(transport, view, { messageLabel: (m) => messageLink(m, ctx), text }),
  ];
  // Тексты, уже показанные у операции, у сообщения не повторяем.
  const shown = new Set([summary, view.op.description].filter(Boolean));
  for (const m of view.messages) parts.push(renderMessage("Сообщение", m, shown, ctx));
  for (const m of view.replies) parts.push(renderMessage("Ответ", m, shown, ctx));
  return parts.join("\n\n");
}

function operationSummary(view: ViewOperation): string | undefined {
  return view.op.summary ?? view.messages.find((m) => m.message.summary)?.message.summary;
}

function renderMessage(
  label: string,
  resolved: ResolvedMessage,
  shown: Set<string | undefined>,
  ctx: RenderContext,
): string {
  const { message } = resolved;
  const parts = [`**${label}** ${messageLink(resolved, ctx)} · ${code(contentType(message))}`];
  const texts = [message.summary, message.description].filter(
    (s): s is string => Boolean(s) && !shown.has(s),
  );
  if (texts.length > 0) parts.push(texts.map(text).join("\n\n"));

  if (!message.payload) {
    parts.push("Без схемы: бинарный фрейм, формат — в описании.");
    return parts.join("\n\n");
  }
  // Поля сообщения разворачиваем прямо в операции: ради этого витрина и нужна.
  const payload = message.payload as Schema;
  const target = "$ref" in payload ? ctx.schemas[refName(payload.$ref)] : payload;
  if (target && hasProperties(target)) {
    parts.push(fieldsTable(target, ctx));
  } else if (target && "$ref" in payload) {
    parts.push(`Тип: ${typeLabel(payload, ctx)} — ${typeLabel(target, ctx)}`);
  } else {
    parts.push(`Тип: ${typeLabel(payload, ctx)}`);
  }
  return parts.join("\n\n");
}

function renderModel(
  name: string,
  schema: Schema,
  usedBy: string[] | undefined,
  ctx: RenderContext,
): string {
  const parts = [`### ${name}`];
  if (schema.description) parts.push(text(schema.description));
  if (usedBy && usedBy.length > 0) {
    parts.push(
      `Сообщение операций: ${usedBy.map((id) => `[${id}](#${ctx.opAnchor.get(id)})`).join(", ")}`,
    );
  }

  if (hasProperties(schema)) {
    parts.push(fieldsTable(schema, ctx));
    const ap = "additionalProperties" in schema ? schema.additionalProperties : undefined;
    if (ap && typeof ap === "object") parts.push(`Дополнительные ключи: ${typeLabel(ap, ctx)}`);
  } else {
    parts.push(["Тип: " + typeLabel(schema, ctx), ...constraintNotes(schema)].join("; "));
  }
  return parts.join("\n\n");
}

function hasProperties(schema: Schema): schema is Schema & { properties: Record<string, Schema> } {
  return "properties" in schema && schema.properties !== undefined;
}

function fieldsTable(schema: Schema, ctx: RenderContext): string {
  if (!hasProperties(schema)) return "";
  const required = new Set(("required" in schema ? schema.required : undefined) ?? []);
  return table(
    ["Поле", "Тип", "Обязательное", "Описание"],
    Object.entries(schema.properties).map(([field, s]) => [
      code(field),
      typeLabel(s, ctx),
      required.has(field) ? "да" : "",
      [s.description ? text(s.description) : "", ...constraintNotes(s)].filter(Boolean).join("<br>"),
    ]),
  );
}

/** Короткая запись типа: примитивы кодом, именованные модели ссылками. */
function typeLabel(schema: Schema, ctx: RenderContext): string {
  if ("$ref" in schema) return modelLink(refName(schema.$ref), ctx);
  if ("allOf" in schema) return schema.allOf.map((s) => typeLabel(s, ctx)).join(" & ");
  if (Array.isArray(schema.type)) return code(schema.type.join(" | "));
  if (schema.type === "array" && "items" in schema) return `${typeLabel(schema.items, ctx)}[]`;
  if (schema.type === "object") {
    const ap = "additionalProperties" in schema ? schema.additionalProperties : undefined;
    if (ap && typeof ap === "object" && !hasProperties(schema)) {
      return `${code("map")} string → ${typeLabel(ap, ctx)}`;
    }
    return code("object");
  }
  return code(schema.format ? `${schema.type} (${schema.format})` : schema.type);
}

/** Ограничения, const/enum и значение по умолчанию. */
function constraintNotes(schema: Schema): string[] {
  const notes: string[] = [];
  const s = schema as unknown as Record<string, unknown>;
  if (s.const !== undefined) notes.push(`константа ${code(JSON.stringify(s.const))}`);
  if (Array.isArray(s.enum)) notes.push(`значения: ${s.enum.map((v) => code(String(v))).join(", ")}`);
  if (s.pattern !== undefined) notes.push(`pattern ${code(String(s.pattern))}`);
  for (const key of [
    "minLength",
    "maxLength",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minItems",
    "maxItems",
  ]) {
    if (s[key] !== undefined) notes.push(`${key}: ${code(String(s[key]))}`);
  }
  if (s.default !== undefined) notes.push(`по умолчанию ${code(JSON.stringify(s.default))}`);
  return notes;
}

function messageLink(resolved: ResolvedMessage, ctx: RenderContext): string {
  const payload = resolved.message.payload;
  if (payload && "$ref" in payload) {
    const model = refName(payload.$ref);
    if (ctx.modelAnchor.has(model)) return modelLink(model, ctx);
  }
  return code(resolved.name);
}

function modelLink(name: string, ctx: RenderContext): string {
  const anchor = ctx.modelAnchor.get(name);
  return anchor ? `[${name}](#${anchor})` : code(name);
}

/** Модель payload → операции, которые её передают. */
function messageUsage(operations: ViewOperation[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const v of operations) {
    for (const m of [...v.messages, ...v.replies]) {
      const payload = m.message.payload;
      if (!payload || !("$ref" in payload)) continue;
      const model = refName(payload.$ref);
      const ids = usage.get(model) ?? [];
      if (!ids.includes(v.id)) ids.push(v.id);
      usage.set(model, ids);
    }
  }
  return usage;
}

/** Первое предложение описания — для сводной таблицы моделей. */
function firstSentence(description: string | undefined): string {
  if (!description) return "";
  const match = /^.*?[.!?](?=\s|$)/s.exec(description);
  return (match ? match[0] : description).replace(/\s+/g, " ").trim();
}

/**
 * Свободный текст из AsyncAPI: `<` и `>` экранируются, иначе GitLab примет `<Template>_Data`
 * за HTML-тег и вырежет его. Остальная markdown-разметка описаний сохраняется.
 */
function text(s: string): string {
  return s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Якоря заголовков как в GitLab и GitHub: нижний регистр, без пунктуации, пробелы → `-`,
 * повторы получают суффикс `-1`, `-2`.
 */
class Slugger {
  private readonly seen = new Map<string, number>();

  slug(title: string): string {
    const base = title
      .toLowerCase()
      .trim()
      .replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "")
      .replace(/ /g, "-");
    const count = this.seen.get(base);
    if (count === undefined) {
      this.seen.set(base, 0);
      return base;
    }
    this.seen.set(base, count + 1);
    return `${base}-${count + 1}`;
  }
}

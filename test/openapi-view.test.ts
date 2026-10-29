import { describe, expect, test } from "vitest";
import { toOpenApiView, toSchema30 } from "../src/shared/openapi-view.js";
import { amqpDoc, wsDoc } from "./utils/view-docs.js";

describe("toOpenApiView", () => {
  test("документ OpenAPI 3.0: операции в paths, схемы приведены к 3.0", () => {
    const view = toOpenApiView(amqpDoc()) as unknown as Record<string, unknown>;
    expect(view.openapi).toBe("3.0.3");
    expect(view).not.toHaveProperty("webhooks");
    const schemas = amqpDoc().components!.schemas!;
    expect(view.components).toEqual({
      schemas: Object.fromEntries(Object.entries(schemas).map(([k, s]) => [k, toSchema30(s)])),
    });
    expect(view.components).not.toHaveProperty("messages");
  });

  test("info: описание дополнено витриной, externalDocs вынесен на верхний уровень", () => {
    const view = toOpenApiView(amqpDoc());
    expect(view.info.title).toBe("Reports");
    expect(view.info.version).toBe("1.2.3");
    expect(view.info).not.toHaveProperty("externalDocs");
    expect(view.externalDocs).toEqual({ url: "https://example.com/docs" });
    const description = view.info.description!;
    expect(description.startsWith("Сервис отчётов.\n\n---\n\n")).toBe(true);
    expect(description).toContain("Транспорт: **AMQP**");
    expect(description).toContain("| `rabbit` | `amqp` | `rabbit:5672` | `/reports` |  |");
    expect(description).toContain("«принимает» — сервис получает сообщение");
  });

  test("servers: URL брокера из AsyncAPI, переменные с обязательным default", () => {
    expect(toOpenApiView(amqpDoc()).servers).toEqual([
      { url: "amqp://rabbit:5672/reports", description: "rabbit" },
    ]);
    const ws = wsDoc();
    ws.servers!.public!.variables = { port: { enum: ["8080", "8443"], description: "порт" } };
    expect(toOpenApiView(ws).servers).toEqual([
      {
        url: "ws://localhost:{port}/chat",
        description: "public",
        variables: { port: { default: "8080", description: "порт", enum: ["8080", "8443"] } },
      },
    ]);
  });

  test("servers: заглушка, если в AsyncAPI серверов нет", () => {
    const doc = amqpDoc();
    delete doc.servers;
    expect(toOpenApiView(doc).servers).toEqual([
      { url: "/", description: "Заглушка: в AsyncAPI-документе серверы не описаны" },
    ]);
  });

  test("receive идут раньше send, путь — направление и адрес канала", () => {
    const view = toOpenApiView(amqpDoc());
    expect(Object.keys(view.paths)).toEqual(["/принимает render.request", "/публикует pdf.{uid}"]);
    expect(view.tags!.map((t) => t.name)).toEqual(["принимает", "публикует"]);
  });

  test("receive: queue в таблице транспорта, JSON-payload по ссылке, ответ 202", () => {
    const op = toOpenApiView(amqpDoc()).paths["/принимает render.request"]!.post;
    expect(op.operationId).toBe("consumeRender");
    expect(op.summary).toBe("принять команду рендеринга");
    expect(op.tags).toEqual(["принимает"]);
    // Описание канала совпадает с описанием операции — не дублируется.
    expect(op.description!.match(/Команды рендеринга/g)).toHaveLength(1);
    expect(op.description).toContain("| Routing key | `render.request` |");
    expect(op.description).toContain("| Очередь | `render-queue` |");
    expect(op.description).toContain("| Очередь durable | `true` |");
    expect(op.description).toContain("| Очередь exclusive | `false` |");
    expect(op.description).toContain("| Content type | `application/json` |");
    expect(op.requestBody).toEqual({
      required: true,
      content: { "application/json": { schema: { $ref: "#/components/schemas/RenderCommand" } } },
    });
    expect(op.responses).toEqual({
      "202": { description: "Ответа нет: сообщение передаётся асинхронно." },
    });
    expect(op).not.toHaveProperty("parameters");
    expect(op["x-amqp"]).toEqual(amqpDoc().channels!.render!.bindings!.amqp);
  });

  test("send: exchange, параметры routing key, summary из сообщения", () => {
    const op = toOpenApiView(amqpDoc()).paths["/публикует pdf.{uid}"]!.post;
    expect(op.operationId).toBe("sendPdf");
    expect(op.summary).toBe("готовый PDF");
    expect(op.tags).toEqual(["публикует"]);
    expect(op.description!.startsWith("Отправляет результат.")).toBe(true);
    expect(op.description).toContain("| Exchange | `results` |");
    expect(op.description).toContain("| Тип exchange | `topic` |");
    expect(op.description).toContain("| Exchange autoDelete | `false` |");
    expect(op.description).toContain("**Параметры routing key**");
    expect(op.description).toContain("| `uid` | Routing key parameter: uid. |");
    expect(op.parameters).toEqual([
      {
        name: "uid",
        in: "path",
        required: true,
        description: "Routing key parameter: uid.",
        schema: { type: "string" },
      },
    ]);
    expect(op.requestBody).toEqual({
      required: true,
      description: "готовый PDF",
      content: { "application/pdf": { schema: { $ref: "#/components/schemas/PdfResult" } } },
    });
  });

  test("WS: бинарное сообщение без payload — octet-stream со схемой binary", () => {
    const view = toOpenApiView(wsDoc());
    const op = view.paths["/публикует / (upload)"]!.post;
    expect(op.summary).toBe("загрузить блоб");
    expect(op.requestBody).toEqual({
      required: true,
      description: "загрузить блоб\n\nБинарный фрейм.",
      content: { "application/octet-stream": { schema: { type: "string", format: "binary" } } },
    });
    expect(op.description).toContain("| Канал | `/` |");
    expect(view.info.description).toContain("Транспорт: **WebSocket**");
  });

  test("WS: reply превращается в ответ 200", () => {
    const op = toOpenApiView(wsDoc()).paths["/публикует / (echo)"]!.post;
    expect(op.responses).toEqual({
      "200": {
        description: "эхо-ответ",
        content: { "application/json": { schema: { $ref: "#/components/schemas/EchoReply" } } },
      },
    });
    expect(op.description).toContain("| Ответ | `EchoReply` |");
  });

  test("коллизия ключей: суффикс operationId только у совпавших", () => {
    const view = toOpenApiView(wsDoc());
    expect(Object.keys(view.paths)).toEqual([
      "/принимает /",
      "/публикует / (echo)",
      "/публикует / (upload)",
    ]);
  });

  test("без адреса канала путь строится по имени канала", () => {
    const doc = amqpDoc();
    delete doc.channels!.result!.address;
    delete doc.channels!.result!.parameters;
    expect(Object.keys(toOpenApiView(doc).paths)).toContain("/публикует result");
  });

  test("исходный документ не меняется, схемы скопированы глубоко", () => {
    const doc = amqpDoc();
    const view = toOpenApiView(doc);
    expect(doc).toEqual(amqpDoc());
    expect(view.components!.schemas!.RenderCommand).not.toBe(doc.components!.schemas!.RenderCommand);
  });
});

describe("toSchema30", () => {
  test("type с null → nullable", () => {
    expect(toSchema30({ type: ["string", "null"] })).toEqual({ type: "string", nullable: true });
    expect(toSchema30({ type: ["integer"] })).toEqual({ type: "integer" });
  });

  test("const → enum из одного значения", () => {
    expect(toSchema30({ type: "string", const: "pdf" })).toEqual({ type: "string", enum: ["pdf"] });
  });

  test("числовые exclusiveMinimum/Maximum → minimum/maximum + флаг", () => {
    expect(toSchema30({ type: "number", exclusiveMinimum: 0, exclusiveMaximum: 10 })).toEqual({
      type: "number",
      minimum: 0,
      exclusiveMinimum: true,
      maximum: 10,
      exclusiveMaximum: true,
    });
  });

  test("$ref с соседними полями → allOf, вложенные схемы обходятся", () => {
    const src = {
      type: "object",
      properties: {
        kind: { $ref: "#/components/schemas/Kind", description: "вид" },
        tags: { type: "array", items: { type: ["string", "null"] } },
        extra: { type: "object", additionalProperties: { const: 1 } },
        // Имя поля совпадает с ключевым словом — не преобразуется как ключевое слово.
        const: { type: "string" },
      },
      oneOf: [{ $ref: "#/components/schemas/A" }],
    };
    const before = structuredClone(src);
    expect(toSchema30(src)).toEqual({
      type: "object",
      properties: {
        kind: { allOf: [{ $ref: "#/components/schemas/Kind" }], description: "вид" },
        tags: { type: "array", items: { type: "string", nullable: true } },
        extra: { type: "object", additionalProperties: { enum: [1] } },
        const: { type: "string" },
      },
      oneOf: [{ $ref: "#/components/schemas/A" }],
    });
    expect(src).toEqual(before);
  });
});

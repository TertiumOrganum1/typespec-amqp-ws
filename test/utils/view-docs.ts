import type { AsyncApiDoc } from "../../src/shared/document.js";

/** Вручную собранные AsyncAPI-документы для юнит-тестов витрин. */

export function amqpDoc(): AsyncApiDoc {
  return {
    asyncapi: "3.0.0",
    info: {
      title: "Reports",
      version: "1.2.3",
      description: "Сервис отчётов.",
      externalDocs: { url: "https://example.com/docs" },
    },
    servers: {
      rabbit: { host: "rabbit:5672", protocol: "amqp", pathname: "/reports" },
    },
    components: {
      schemas: {
        RenderCommand: {
          type: "object",
          properties: { uid: { type: ["string", "null"] }, kind: { type: "string", const: "pdf" } },
          required: ["kind"],
          additionalProperties: false,
        },
        PdfResult: { type: "string", format: "binary" },
        TemplateParams: { type: "object", properties: { a: { type: "integer", default: 1 } } },
      },
      messages: {
        RenderCommand: { payload: { $ref: "#/components/schemas/RenderCommand" } },
        PdfResult: {
          summary: "готовый PDF",
          contentType: "application/pdf",
          payload: { $ref: "#/components/schemas/PdfResult" },
        },
      },
    },
    channels: {
      render: {
        address: "render.request",
        description: "Команды рендеринга",
        bindings: {
          amqp: { is: "queue", queue: { name: "render-queue", durable: true, exclusive: false } },
        },
        messages: { RenderCommand: { $ref: "#/components/messages/RenderCommand" } },
      },
      result: {
        address: "pdf.{uid}",
        parameters: { uid: { description: "Routing key parameter: uid." } },
        bindings: {
          amqp: {
            is: "routingKey",
            exchange: { name: "results", type: "topic", durable: true, autoDelete: false },
          },
        },
        messages: { PdfResult: { $ref: "#/components/messages/PdfResult" } },
      },
    },
    operations: {
      sendPdf: {
        action: "send",
        channel: { $ref: "#/channels/result" },
        messages: [{ $ref: "#/channels/result/messages/PdfResult" }],
        description: "Отправляет результат.",
      },
      consumeRender: {
        action: "receive",
        channel: { $ref: "#/channels/render" },
        messages: [{ $ref: "#/channels/render/messages/RenderCommand" }],
        summary: "принять команду рендеринга",
        description: "Команды рендеринга",
      },
    },
  };
}

export function wsDoc(): AsyncApiDoc {
  return {
    asyncapi: "3.0.0",
    info: { title: "Chat", version: "1.0.0" },
    servers: { public: { host: "localhost:{port}", protocol: "ws", pathname: "/chat" } },
    components: {
      schemas: {
        Ping: { type: "object", properties: { t: { type: "string" } } },
        Echo: { type: "object", properties: { t: { type: "string" } } },
        EchoReply: { type: "object", properties: { t: { type: "string" } } },
      },
      messages: {
        Ping: { payload: { $ref: "#/components/schemas/Ping" } },
        Echo: { payload: { $ref: "#/components/schemas/Echo" } },
        EchoReply: { summary: "эхо-ответ", payload: { $ref: "#/components/schemas/EchoReply" } },
        Upload: {
          contentType: "application/octet-stream",
          summary: "загрузить блоб",
          description: "Бинарный фрейм.",
        },
      },
    },
    channels: {
      "/": {
        address: "/",
        messages: {
          Ping: { $ref: "#/components/messages/Ping" },
          Echo: { $ref: "#/components/messages/Echo" },
          EchoReply: { $ref: "#/components/messages/EchoReply" },
          Upload: { $ref: "#/components/messages/Upload" },
        },
      },
    },
    operations: {
      echo: {
        action: "send",
        channel: { $ref: "#/channels/~1" },
        messages: [{ $ref: "#/channels/~1/messages/Echo" }],
        reply: {
          channel: { $ref: "#/channels/~1" },
          messages: [{ $ref: "#/channels/~1/messages/EchoReply" }],
        },
      },
      upload: {
        action: "send",
        channel: { $ref: "#/channels/~1" },
        messages: [{ $ref: "#/channels/~1/messages/Upload" }],
      },
      ping: {
        action: "receive",
        channel: { $ref: "#/channels/~1" },
        messages: [{ $ref: "#/channels/~1/messages/Ping" }],
        summary: "получить ping",
      },
    },
  };
}

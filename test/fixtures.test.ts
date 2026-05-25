import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

describe("end-to-end fixtures", () => {
  test("example-amqp produces expected AsyncAPI structure", async () => {
    const src = readFileSync(
      new URL("./fixtures/example-amqp.tsp", import.meta.url),
      "utf-8",
    );
    const r = await emit(src, "amqp");
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.info.title).toBe("Example AMQP Service");
    expect(d.info.version).toBe("1.0.0");
    expect(d.servers.rabbit.host).toBe("rabbit.example.com:5672");
    expect(d.servers.rabbit.protocol).toBe("amqp");

    // Three channels — direct publish, fanout publish, queue consume.
    expect(d.channels["event-created"].address).toBe("v1-events-created");
    expect(d.channels["event-created"].bindings.amqp).toEqual({
      is: "routingKey",
      exchange: { name: "events-exchange", type: "direct", durable: true },
    });

    expect(d.channels["announcement-broadcast"].address).toBeUndefined();
    expect(d.channels["announcement-broadcast"].bindings.amqp.exchange.type).toBe("fanout");

    expect(d.channels["ack-requests"].address).toBe("v1-events-ack");
    expect(d.channels["ack-requests"].bindings.amqp).toEqual({
      is: "queue",
      queue: { name: "ack-requests-queue", durable: true, autoDelete: false },
    });

    // Operations: action send vs receive
    expect(d.operations.publishEvent.action).toBe("send");
    expect(d.operations.broadcastAnnouncement.action).toBe("send");
    expect(d.operations.consumeAck.action).toBe("receive");

    // Schemas
    expect(d.components.schemas.Uuid).toEqual({
      type: "string",
      description: "UUID v7 identifier",
    });
    expect(d.components.schemas.EventCategory.enum).toEqual(["Created", "Updated", "Deleted"]);
    expect(d.components.schemas.EventPayload.properties.tags).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/Tag" },
      description: "Arbitrary tags",
    });
    expect(d.components.schemas.EventPayload.properties.extra).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
      description: "Arbitrary extension parameters",
    });
  });

  test("example-amqp YAML snapshot", async () => {
    const src = readFileSync(
      new URL("./fixtures/example-amqp.tsp", import.meta.url),
      "utf-8",
    );
    const r = await emit(src, "amqp");
    expectNoErrors(r);
    expect(r.yaml).toMatchSnapshot();
  });

  test("example-ws produces expected AsyncAPI structure", async () => {
    const src = readFileSync(
      new URL("./fixtures/example-ws.tsp", import.meta.url),
      "utf-8",
    );
    const r = await emit(src, "ws");
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.info.title).toBe("Example WebSocket Service");
    expect(d.info.version).toBe("2.3.4");

    // Single default channel "/"
    expect(d.channels["/"]).toBeDefined();
    expect(d.channels["/"].address).toBe("/");

    // Discriminator: literal field becomes JSON Schema const
    expect(d.components.schemas.Ping.properties.eventType).toEqual({
      type: "string",
      const: "ping",
    });
    expect(d.components.schemas.EchoRequest.properties.eventType).toEqual({
      type: "string",
      const: "echoRequest",
    });

    // Reply pattern
    expect(d.operations.echo.reply).toBeDefined();
    expect(d.operations.echo.reply.messages).toEqual([
      { $ref: "#/channels/~1/messages/EchoResponse" },
    ]);

    // No reply where not declared
    expect(d.operations.sendPong.reply).toBeUndefined();

    // Binary message: contentType set, no payload (opaque bytes)
    expect(d.components.messages.UploadUpdate.contentType).toBe(
      "application/octet-stream",
    );
    expect(d.components.messages.UploadUpdate.payload).toBeUndefined();

    // Action send vs receive
    expect(d.operations.receivePing.action).toBe("receive");
    expect(d.operations.sendPong.action).toBe("send");
    expect(d.operations.echo.action).toBe("send");
    expect(d.operations.updateAvailable.action).toBe("receive");
    expect(d.operations.uploadUpdate.action).toBe("send");
  });

  test("example-ws YAML snapshot", async () => {
    const src = readFileSync(
      new URL("./fixtures/example-ws.tsp", import.meta.url),
      "utf-8",
    );
    const r = await emit(src, "ws");
    expectNoErrors(r);
    expect(r.yaml).toMatchSnapshot();
  });
});

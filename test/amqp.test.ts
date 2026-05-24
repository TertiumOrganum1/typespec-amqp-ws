import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

describe("amqp — @publish/@consume validation", () => {
  test("@publish without exchange — typespec rejects", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Msg { id: string; }
      @publish(#{ routingKey: "rk" })
      op send(): Msg;
    `,
      "amqp",
    );
    // TypeSpec сам ловит отсутствие обязательного 'exchange' — наш дополнительный диагностик не нужен.
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  test("@consume without queue — typespec rejects", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Msg { id: string; }
      @consume(#{ routingKey: "rk" })
      op consume(): Msg;
    `,
      "amqp",
    );
    expect(r.diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  test("unknown exchange type raises error", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Msg { id: string; }
      @publish(#{ routingKey: "rk", exchange: #{ name: "e", type: "topic" } })
      op send(): Msg;
    `,
      "amqp",
    );
    expect(r.diagnostics.some((d) => d.code === "@tertiumorganum/typespec-amqp-ws/unknown-exchange-type")).toBe(
      true,
    );
  });

  test("@publish with valid direct exchange — no errors", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Msg { id: string; }
      @publish(#{
        routingKey: "rk",
        exchange: #{ name: "e", type: "direct", durable: true },
      })
      op send(): Msg;
    `,
      "amqp",
    );
    expectNoErrors(r);
  });
});

describe("amqp — channel/operation/message assembly", () => {
  test("publish operation produces channel + operation + message + schema", async () => {
    const r = await emit(
      `
      @service(#{ title: "Wr" })
      @info(#{ version: "1.0.0" })
      namespace Wr;
      model UpdateMsg { id: string; }
      @publish(#{
        routingKey: "v1-update",
        exchange: #{ name: "wr-ex", type: "direct", durable: true },
      })
      @summary("отправить обновление")
      op sendUpdate(): UpdateMsg;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    // channel
    expect(d.channels.sendUpdate.address).toBe("v1-update");
    expect(d.channels.sendUpdate.bindings.amqp).toEqual({
      is: "routingKey",
      exchange: { name: "wr-ex", type: "direct", durable: true },
    });
    expect(d.channels.sendUpdate.messages.updateMsg).toEqual({
      $ref: "#/components/messages/updateMsg",
    });
    // operation
    expect(d.operations.sendUpdate.action).toBe("send");
    expect(d.operations.sendUpdate.summary).toBe("отправить обновление");
    expect(d.operations.sendUpdate.channel.$ref).toBe("#/channels/sendUpdate");
    expect(d.operations.sendUpdate.messages).toEqual([
      { $ref: "#/channels/sendUpdate/messages/updateMsg" },
    ]);
    // message
    expect(d.components.messages.updateMsg.payload.$ref).toBe(
      "#/components/schemas/UpdateMsg",
    );
    // schema
    expect(d.components.schemas.UpdateMsg).toBeDefined();
  });

  test("@message overrides key and summary", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Foo { id: string; }
      @publish(#{
        routingKey: "rk",
        exchange: #{ name: "ex", type: "direct" },
      })
      @message(#{ name: "customMsgKey", summary: "сводка" })
      op send(): Foo;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels.send.messages.customMsgKey).toBeDefined();
    expect(d.components.messages.customMsgKey.summary).toBe("сводка");
  });

  test("consume operation produces queue channel", async () => {
    const r = await emit(
      `
      @service(#{ title: "Rcm" })
      @info(#{ version: "1.0.0" })
      namespace Rcm;
      model Cmd { id: string; }
      @consume(#{
        routingKey: "v1-cmd",
        queue: #{ name: "rcm-q", durable: true, autoDelete: false },
      })
      op handleCmd(): Cmd;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels.handleCmd.address).toBe("v1-cmd");
    expect(d.channels.handleCmd.bindings.amqp).toEqual({
      is: "queue",
      queue: { name: "rcm-q", durable: true, autoDelete: false },
    });
    expect(d.operations.handleCmd.action).toBe("receive");
  });

  test("fanout exchange without routingKey", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model E { id: string; }
      @publish(#{ exchange: #{ name: "ex", type: "fanout", durable: true } })
      op broadcast(): E;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels.broadcast.bindings.amqp.exchange.type).toBe("fanout");
    expect(d.channels.broadcast.address).toBeUndefined();
  });

  test("channelName override changes the YAML key", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model E { id: string; }
      @publish(#{
        channelName: "my-cool-channel",
        routingKey: "rk",
        exchange: #{ name: "ex", type: "direct" },
      })
      op send(): E;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels["my-cool-channel"]).toBeDefined();
    expect(d.operations.send.channel.$ref).toBe("#/channels/my-cool-channel");
  });
});

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
      op send(msg: Msg): void;
    `,
      "amqp",
    );
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
      op send(msg: Msg): void;
    `,
      "amqp",
    );
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unknown-exchange-type")).toBe(
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
      op send(msg: Msg): void;
    `,
      "amqp",
    );
    expectNoErrors(r);
  });

  test("@publish without param raises publish-must-have-param", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Msg { id: string; }
      @publish(#{ routingKey: "rk", exchange: #{ name: "e", type: "direct" } })
      op send(): Msg;
    `,
      "amqp",
    );
    expect(
      r.diagnostics.some(
        (d) => d.code === "@etc-utils/typespec-amqp-ws/publish-must-have-param",
      ),
    ).toBe(true);
  });

  test("@publish with multiple params raises publish-multiple-params", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model A { id: string; }
      model B { id: string; }
      @publish(#{ routingKey: "rk", exchange: #{ name: "e", type: "direct" } })
      op send(a: A, b: B): void;
    `,
      "amqp",
    );
    expect(
      r.diagnostics.some(
        (d) => d.code === "@etc-utils/typespec-amqp-ws/publish-multiple-params",
      ),
    ).toBe(true);
  });

  test("@consume without returnType raises consume-must-return", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Msg { id: string; }
      @consume(#{ routingKey: "rk", queue: #{ name: "q" } })
      op recv(m: Msg): void;
    `,
      "amqp",
    );
    expect(
      r.diagnostics.some(
        (d) => d.code === "@etc-utils/typespec-amqp-ws/consume-must-return",
      ),
    ).toBe(true);
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
      op sendUpdate(msg: UpdateMsg): void;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels.sendUpdate.address).toBe("v1-update");
    expect(d.channels.sendUpdate.bindings.amqp).toEqual({
      is: "routingKey",
      exchange: { name: "wr-ex", type: "direct", durable: true },
    });
    expect(d.channels.sendUpdate.messages.UpdateMsg).toEqual({
      $ref: "#/components/messages/UpdateMsg",
    });
    expect(d.operations.sendUpdate.action).toBe("send");
    expect(d.operations.sendUpdate.summary).toBe("отправить обновление");
    expect(d.operations.sendUpdate.channel.$ref).toBe("#/channels/sendUpdate");
    expect(d.operations.sendUpdate.messages).toEqual([
      { $ref: "#/channels/sendUpdate/messages/UpdateMsg" },
    ]);
    expect(d.components.messages.UpdateMsg.payload.$ref).toBe(
      "#/components/schemas/UpdateMsg",
    );
    expect(d.components.schemas.UpdateMsg).toBeDefined();
  });

  test("default messageKey preserves PascalCase from model name", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model CacheInvalidateInstruction { id: string; }
      @publish(#{
        routingKey: "rk",
        exchange: #{ name: "ex", type: "direct" },
      })
      op send(msg: CacheInvalidateInstruction): void;
    `,
      "amqp",
    );
    expectNoErrors(r);
    const d = r.doc as any;
    expect(d.components.messages.CacheInvalidateInstruction).toBeDefined();
    expect(d.components.messages.cacheInvalidateInstruction).toBeUndefined();
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
      op send(msg: Foo): void;
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
      op broadcast(msg: E): void;
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
      op send(msg: E): void;
    `,
      "amqp",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels["my-cool-channel"]).toBeDefined();
    expect(d.operations.send.channel.$ref).toBe("#/channels/my-cool-channel");
  });

  test("explicit description in @consume wins", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Cmd { id: string; }
      @consume(#{
        description: "явное описание канала",
        routingKey: "rk",
        queue: #{ name: "q" },
      })
      @doc("документация операции")
      op recv(): Cmd;
    `,
      "amqp",
    );
    expectNoErrors(r);
    const d = r.doc as any;
    expect(d.channels.recv.description).toBe("явное описание канала");
    expect(d.operations.recv.description).toBe("документация операции");
  });

  test("explicit description in @publish wins", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model E { id: string; }
      @publish(#{
        description: "канал для бродкаста",
        exchange: #{ name: "ex", type: "fanout" },
      })
      op broadcast(msg: E): void;
    `,
      "amqp",
    );
    expectNoErrors(r);
    expect((r.doc as any).channels.broadcast.description).toBe("канал для бродкаста");
  });

  test("channel description falls back to operation @doc when omitted", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Cmd { id: string; }
      @consume(#{ routingKey: "rk", queue: #{ name: "q" } })
      @doc("описание из @doc")
      op recv(): Cmd;
    `,
      "amqp",
    );
    expectNoErrors(r);
    const d = r.doc as any;
    expect(d.channels.recv.description).toBe("описание из @doc");
    expect(d.operations.recv.description).toBe("описание из @doc");
  });

  test("channel description omitted when neither set", async () => {
    const r = await emit(
      `
      @service(#{ title: "X" })
      @info(#{ version: "1.0.0" })
      namespace X;
      model Cmd { id: string; }
      @consume(#{ routingKey: "rk", queue: #{ name: "q" } })
      op recv(): Cmd;
    `,
      "amqp",
    );
    expectNoErrors(r);
    expect((r.doc as any).channels.recv.description).toBeUndefined();
  });
});

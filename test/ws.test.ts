import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

describe("ws — publish/consume on default channel", () => {
  test("publish + consume share channel '/'", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model Local { id: string; }
      model Global { id: string; }
      @consume op getLocal(): Local;
      @publish op sendGlobal(msg: Global): void;
    `,
      "ws",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.channels["/"].messages.Local).toEqual({ $ref: "#/components/messages/Local" });
    expect(d.channels["/"].messages.Global).toEqual({ $ref: "#/components/messages/Global" });
    expect(d.operations.getLocal.action).toBe("receive");
    expect(d.operations.sendGlobal.action).toBe("send");
    expect(d.operations.getLocal.channel.$ref).toBe("#/channels/~1");
    expect(d.operations.getLocal.messages).toEqual([
      { $ref: "#/channels/~1/messages/Local" },
    ]);
  });

  test("request/reply: param = request, returnType = reply", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model Req { id: string; }
      model Resp { ok: boolean; }
      @publish op send(req: Req): Resp;
    `,
      "ws",
    );
    expectNoErrors(r);
    const d = r.doc as any;
    expect(d.operations.send.reply).toEqual({
      channel: { $ref: "#/channels/~1" },
      messages: [{ $ref: "#/channels/~1/messages/Resp" }],
    });
    expect(d.channels["/"].messages.Resp).toBeDefined();
    expect(d.components.messages.Resp.payload.$ref).toBe("#/components/schemas/Resp");
    expect(d.components.messages.Req.payload.$ref).toBe("#/components/schemas/Req");
  });

  test("@binary emits message without payload (opaque bytes)", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      @publish
      @binary
      @summary("Send update blob")
      @doc("Бинарный фрейм: [1B version][N bytes payload]")
      op uploadUpdate(): void;
    `,
      "ws",
    );
    expectNoErrors(r);
    const d = r.doc as any;
    expect(d.components.messages.UploadUpdate).toEqual({
      contentType: "application/octet-stream",
      summary: "Send update blob",
      description: "Бинарный фрейм: [1B version][N bytes payload]",
    });
    expect(d.components.messages.UploadUpdate.payload).toBeUndefined();
    expect(d.operations.uploadUpdate.action).toBe("send");
  });

  test("@binary with param raises binary-with-payload", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model M { id: string; }
      @publish @binary op X(m: M): void;
    `,
      "ws",
    );
    expect(
      r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/binary-with-payload"),
    ).toBe(true);
  });

  test("@publish without param raises publish-must-have-param", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model M { id: string; }
      @publish op send(): M;
    `,
      "ws",
    );
    expect(
      r.diagnostics.some(
        (d) => d.code === "@etc-utils/typespec-amqp-ws/publish-must-have-param",
      ),
    ).toBe(true);
  });

  test("@consume without returnType raises consume-must-return", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model M { id: string; }
      @consume op recv(m: M): void;
    `,
      "ws",
    );
    expect(
      r.diagnostics.some(
        (d) => d.code === "@etc-utils/typespec-amqp-ws/consume-must-return",
      ),
    ).toBe(true);
  });

  test("eventType discriminator works on WS payloads", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model LocalPayload { data: string; }
      model LocalActions {
        eventType: "localActions";
        msgUid: string;
        payload: LocalPayload;
      }
      @consume op getLocalActions(): LocalActions;
    `,
      "ws",
    );
    expectNoErrors(r);

    const d = r.doc as any;
    expect(d.components.schemas.LocalActions.properties.eventType).toEqual({
      type: "string",
      const: "localActions",
    });
  });
});

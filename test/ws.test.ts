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
      @publish op sendGlobal(): Global;
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

  test("@reply produces operations.X.reply", async () => {
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      model Req { id: string; }
      model Resp { ok: boolean; }
      @publish @reply(Resp) op send(): Req;
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
  });

  test("@binary sets contentType on message", async () => {
    // Бинарное сообщение объявляется через скаляр extends bytes — это даст schema { type: string, format: binary }.
    // А @binary помечает сам message как application/octet-stream.
    // ВАЖНО: возвращаемый тип всё ещё должен быть Model (а не Scalar), потому что builder проверяет.
    // Для бинарных payload используем модель-обёртку или прямой scalar (поддержим scalar отдельно).
    const r = await emit(
      `
      @service(#{ title: "Demo" })
      @info(#{ version: "1.0.0" })
      namespace Demo;
      @doc("Бинарный апдейт")
      scalar Update extends bytes;
      model UpdatePayload { data: Update; }
      @publish @binary op update(): UpdatePayload;
    `,
      "ws",
    );
    expectNoErrors(r);
    expect((r.doc as any).components.messages.UpdatePayload.contentType).toBe(
      "application/octet-stream",
    );
    expect((r.doc as any).components.schemas.Update).toEqual({
      type: "string",
      format: "binary",
      description: "Бинарный апдейт",
    });
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

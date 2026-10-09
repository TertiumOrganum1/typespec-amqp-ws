import { expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

test("builtin scalar payload requires a named declaration", async () => {
  const r = await emit(`
    namespace Reports;
    @publish(#{ exchange: #{ name: "results", type: "direct" } })
    op send(pdf: bytes): void;
    @consume(#{ queue: #{ name: "results" } })
    op receive(): bytes;
  `);
  expect(r.diagnostics.some((d) => d.code.endsWith("/anonymous-param"))).toBe(true);
  expect(r.diagnostics.some((d) => d.code.endsWith("/anonymous-return"))).toBe(true);
});

test("topic routing parameters, named binary payload and trace headers", async () => {
  const r = await emit(`
    namespace Reports;
    @doc("Raw PDF bytes")
    scalar Pdf extends bytes;
    @publish(#{ routingKey: "pdf.{uid}", exchange: #{ name: "results", type: "topic" } })
    @message(#{ contentType: "application/pdf", headers: #{ \`u-trace-id\`: "Trace identifier" } })
    op send(pdf: Pdf): void;
    @consume(#{ routingKey: "pdf.{uid}", queue: #{ name: "results" } })
    @message(#{ contentType: "application/pdf", headers: #{ \`u-trace-id\`: "Trace identifier" } })
    op receive(): Pdf;
  `);
  expectNoErrors(r);
  const d = r.doc as any;
  expect(d.channels.send.bindings.amqp.exchange.type).toBe("topic");
  expect(d.channels.send.parameters.uid).toBeDefined();
  expect(d.channels.receive.parameters.uid).toBeDefined();
  expect(d.components.schemas.Pdf).toMatchObject({ type: "string", format: "binary" });
  expect(d.components.messages.Pdf.contentType).toBe("application/pdf");
  expect(d.components.messages.Pdf.headers.properties["u-trace-id"]).toEqual({
    type: "string", description: "Trace identifier",
  });
  expect(d.components.messages.Pdf.correlationId).toBeUndefined();
});

test("schema formats, limits and defaults survive emission", async () => {
  const r = await emit(`
    namespace Reports;
    enum Mode { Gray, Mono }
    @format("uuid") scalar UUID extends string;
    model Command {
      @format("uuid") uid: string;
      @format("date-time") createdAt: string;
      @minLength(2) @maxLength(40) @pattern("^[A-Z]+$") title: string;
      @minValue(72) @maxValue(600) dpi?: integer = 300;
      @minItems(1) @maxItems(50) rows: string[];
      @doc("Image mode") mode?: Mode = Mode.Gray;
      named: UUID;
      @minLength(36) constrained: UUID;
    }
  `);
  expectNoErrors(r);
  const s = (r.doc as any).components.schemas;
  expect(s.UUID.format).toBe("uuid");
  expect(s.Command.properties.uid.format).toBe("uuid");
  expect(s.Command.properties.createdAt.format).toBe("date-time");
  expect(s.Command.properties.title).toMatchObject({ minLength: 2, maxLength: 40, pattern: "^[A-Z]+$" });
  expect(s.Command.properties.dpi).toMatchObject({ minimum: 72, maximum: 600, default: 300 });
  expect(s.Command.properties.rows).toMatchObject({ minItems: 1, maxItems: 50 });
  expect(s.Command.properties.mode).toMatchObject({ $ref: "#/components/schemas/Mode", default: "Gray" });
  expect(s.Command.additionalProperties).toBe(false);
  expect(s.Command.properties.constrained).toMatchObject({
    allOf: [{ $ref: "#/components/schemas/UUID" }], minLength: 36,
  });
});

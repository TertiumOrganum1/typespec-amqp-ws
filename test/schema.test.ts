import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

describe("schema emitter — smoke", () => {
  test("empty service emits minimal valid doc", async () => {
    const result = await emit(`namespace Smoke;`);
    expectNoErrors(result);
    expect(result.doc.asyncapi).toBe("3.0.0");
  });
});

describe("schema emitter — forbidden types", () => {
  test("uint32 raises unsupported-sized-int", async () => {
    const r = await emit(`namespace T; model M { foo: uint32; }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unsupported-sized-int")).toBe(true);
  });

  test("int64 raises unsupported-int64", async () => {
    const r = await emit(`namespace T; model M { foo: int64; }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unsupported-int64")).toBe(true);
  });

  test("float64 raises unsupported-float", async () => {
    const r = await emit(`namespace T; model M { foo: float64; }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unsupported-float")).toBe(true);
  });

  test("safeint raises unsupported-fuzzy-numeric", async () => {
    const r = await emit(`namespace T; model M { foo: safeint; }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unsupported-fuzzy-numeric")).toBe(true);
  });

  test("utcDateTime raises unsupported-temporal", async () => {
    const r = await emit(`namespace T; model M { foo: utcDateTime; }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unsupported-temporal")).toBe(true);
  });

  test("url raises unsupported-url", async () => {
    const r = await emit(`namespace T; model M { foo: url; }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/unsupported-url")).toBe(true);
  });

  test("bytes → format binary", async () => {
    const r = await emit(`namespace T; model M { foo: bytes; }`);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.foo).toEqual({
      type: "string",
      format: "binary",
    });
  });
});

describe("schema emitter — enums", () => {
  test("simple string enum", async () => {
    const r = await emit(`
      namespace T;
      @doc("Класс устройства")
      enum DeviceClass { Printer, Scanner, Scales }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.DeviceClass).toEqual({
      type: "string",
      enum: ["Printer", "Scanner", "Scales"],
      description: "Класс устройства",
    });
  });

  test("enum without doc emits without description", async () => {
    const r = await emit(`
      namespace T;
      enum X { A, B }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.X).toEqual({
      type: "string",
      enum: ["A", "B"],
    });
  });

  test("enum as field type emits $ref", async () => {
    const r = await emit(`
      namespace T;
      enum Color { Red, Green, Blue }
      model M { color: Color; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.color).toEqual({
      $ref: "#/components/schemas/Color",
    });
  });

  test("numeric enum value raises non-string-enum", async () => {
    const r = await emit(`namespace T; enum X { A: 1, B: 2 }`);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/non-string-enum")).toBe(true);
  });
});

describe("schema emitter — named scalars", () => {
  test("scalar extends string emits named schema", async () => {
    const r = await emit(`
      namespace T;
      @doc("UUID v7")
      scalar UUID extends string;
      model M { id: UUID; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.UUID).toEqual({
      type: "string",
      description: "UUID v7",
    });
  });

  test("scalar chain flattens to base type", async () => {
    const r = await emit(`
      namespace T;
      scalar UUID extends string;
      @doc("Идентификатор группы")
      scalar GroupUid extends UUID;
      model M { g: GroupUid; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.GroupUid).toEqual({
      type: "string",
      description: "Идентификатор группы",
    });
  });

  test("field referencing named scalar emits $ref", async () => {
    const r = await emit(`
      namespace T;
      scalar UUID extends string;
      model M { id: UUID; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.id).toEqual({
      $ref: "#/components/schemas/UUID",
    });
  });

  test("field with @doc wraps $ref in allOf", async () => {
    const r = await emit(`
      namespace T;
      scalar UUID extends string;
      model M {
        @doc("идентификатор записи")
        id: UUID;
      }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.id).toEqual({
      allOf: [{ $ref: "#/components/schemas/UUID" }],
      description: "идентификатор записи",
    });
  });

  test("primitive field with @doc gets description inline (no allOf)", async () => {
    const r = await emit(`
      namespace T;
      model M {
        @doc("обычное имя")
        name: string;
      }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.name).toEqual({
      type: "string",
      description: "обычное имя",
    });
  });
});

describe("schema emitter — optional and literals", () => {
  test("optional field not in required", async () => {
    const r = await emit(`
      namespace T;
      model M { a: string; b?: string; }
    `);
    expectNoErrors(r);
    const m = (r.doc as any).components.schemas.M;
    expect(m.required).toEqual(["a"]);
    expect(m.properties.b).toEqual({ type: "string" });
  });

  test("string literal becomes const", async () => {
    const r = await emit(`
      namespace T;
      model M { kind: "userCreated"; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.kind).toEqual({
      type: "string",
      const: "userCreated",
    });
  });

  test("literal field is required by default", async () => {
    const r = await emit(`
      namespace T;
      model M { kind: "x"; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.required).toEqual(["kind"]);
  });

  test("integer literal becomes const integer", async () => {
    const r = await emit(`
      namespace T;
      model M { version: 1; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.version).toEqual({
      type: "integer",
      const: 1,
    });
  });

  test("non-integer numeric literal degrades to string const", async () => {
    const r = await emit(`
      namespace T;
      model M { ratio: 1.5; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.ratio).toEqual({
      type: "string",
      const: "1.5",
    });
  });

  test("boolean literal becomes const boolean", async () => {
    const r = await emit(`
      namespace T;
      model M { flag: true; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.flag).toEqual({
      type: "boolean",
      const: true,
    });
  });

  test("eventType discriminator pattern", async () => {
    const r = await emit(`
      namespace T;
      model LocalActionsPayload { data: string; }
      model LocalActions {
        eventType: "localActions";
        msgUid: string;
        payload: LocalActionsPayload;
      }
    `);
    expectNoErrors(r);
    const m = (r.doc as any).components.schemas.LocalActions;
    expect(m.properties.eventType).toEqual({ type: "string", const: "localActions" });
    expect(m.properties.payload).toEqual({ $ref: "#/components/schemas/LocalActionsPayload" });
    expect(m.required).toEqual(["eventType", "msgUid", "payload"]);
  });
});

describe("schema emitter — collections and nullable", () => {
  test("array T[] → array schema", async () => {
    const r = await emit(`namespace T; model M { items: string[]; }`);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.items).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  test("array of named model", async () => {
    const r = await emit(`
      namespace T;
      model Inner { foo: string; }
      model Outer { items: Inner[]; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.Outer.properties.items).toEqual({
      type: "array",
      items: { $ref: "#/components/schemas/Inner" },
    });
  });

  test("Record<string> → additionalProperties typed", async () => {
    const r = await emit(`namespace T; model M { extras: Record<string>; }`);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.extras).toEqual({
      type: "object",
      additionalProperties: { type: "string" },
    });
  });

  test("string | null → type array", async () => {
    const r = await emit(`namespace T; model M { foo: string | null; }`);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.foo).toEqual({
      type: ["string", "null"],
    });
  });

  test("integer | null", async () => {
    const r = await emit(`namespace T; model M { foo: integer | null; }`);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.foo).toEqual({
      type: ["integer", "null"],
    });
  });

  test("optional nullable: ?: T | null", async () => {
    const r = await emit(`namespace T; model M { foo?: integer | null; }`);
    expectNoErrors(r);
    const m = (r.doc as any).components.schemas.M;
    expect(m.required).toBeUndefined();
    expect(m.properties.foo).toEqual({ type: ["integer", "null"] });
  });
});

describe("schema emitter — anonymous models forbidden", () => {
  test("inline payload object raises anonymous-model", async () => {
    const r = await emit(`
      namespace T;
      model M {
        payload: { foo: string };
      }
    `);
    expect(r.diagnostics.some((d) => d.code === "@etc-utils/typespec-amqp-ws/anonymous-model")).toBe(true);
  });

  test("named nested model is fine", async () => {
    const r = await emit(`
      namespace T;
      model Inner { foo: string; }
      model Outer { payload: Inner; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.Outer.properties.payload).toEqual({
      $ref: "#/components/schemas/Inner",
    });
  });
});

describe("schema emitter — namespace prefix", () => {
  test("nested namespace schema uses dot prefix, service root stripped", async () => {
    const r = await emit(`
      namespace T;
      namespace audit {
        enum Type { A, B }
        model AccountCreated { id: string; }
      }
    `);
    expectNoErrors(r);
    const schemas = (r.doc as any).components.schemas;
    expect(schemas["audit.Type"]).toBeDefined();
    expect(schemas["audit.AccountCreated"]).toBeDefined();
    expect(schemas["T.audit.AccountCreated"]).toBeUndefined();
  });

  test("field referencing nested model uses dotted $ref", async () => {
    const r = await emit(`
      namespace T;
      namespace nested {
        model Inner { id: string; }
      }
      model Outer { inner: nested.Inner; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.Outer.properties.inner).toEqual({
      $ref: "#/components/schemas/nested.Inner",
    });
  });
});

describe("schema emitter — primitives", () => {
  test("string field", async () => {
    const r = await emit(`
      namespace T;
      model M { foo: string; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.foo).toEqual({ type: "string" });
  });

  test("boolean field", async () => {
    const r = await emit(`
      namespace T;
      model M { foo: boolean; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.foo).toEqual({ type: "boolean" });
  });

  test("integer field", async () => {
    const r = await emit(`
      namespace T;
      model M { foo: integer; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M.properties.foo).toEqual({ type: "integer" });
  });

  test("model with required and optional", async () => {
    const r = await emit(`
      namespace T;
      model M { a: string; b: boolean; c: integer; }
    `);
    expectNoErrors(r);
    expect((r.doc as any).components.schemas.M).toEqual({
      type: "object",
      properties: {
        a: { type: "string" },
        b: { type: "boolean" },
        c: { type: "integer" },
      },
      required: ["a", "b", "c"],
      additionalProperties: false,
    });
  });
});

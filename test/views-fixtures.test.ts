import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as yaml from "js-yaml";
import { emit, expectNoErrors } from "./utils/test-host.js";
import { runRedocly, HAS_REDOCLY } from "../scripts/run-tools.js";
import { toOpenApiView } from "../src/shared/openapi-view.js";
import { serialize } from "../src/shared/yaml-writer.js";
import { amqpDoc } from "./utils/view-docs.js";

const fixtures = [
  { name: "example-amqp", target: "amqp" as const, file: "amqp.openapi.yaml" },
  { name: "example-ws", target: "ws" as const, file: "ws.openapi.yaml" },
];

function source(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}.tsp`, import.meta.url), "utf-8");
}

describe("витрины: openapi-output-file и markdown-output-file", () => {
  for (const f of fixtures) {
    test(`${f.name}: без опции пишется только asyncapi.yaml`, async () => {
      const r = await emit(source(f.name), f.target);
      expectNoErrors(r);
      expect(Object.keys(r.outputs)).toEqual(["asyncapi.yaml"]);
    });

    test(`${f.name}: asyncapi.yaml с опцией совпадает побайтно`, async () => {
      const plain = await emit(source(f.name), f.target);
      const withView = await emit(source(f.name), f.target, { "openapi-output-file": f.file });
      expectNoErrors(withView);
      expect(Object.keys(withView.outputs).sort()).toEqual(["asyncapi.yaml", f.file].sort());
      expect(withView.outputs["asyncapi.yaml"]).toBe(plain.outputs["asyncapi.yaml"]);
    });

    test(`${f.name}: OpenAPI-витрина (snapshot)`, async () => {
      const r = await emit(source(f.name), f.target, { "openapi-output-file": f.file });
      expectNoErrors(r);
      const text = r.outputs[f.file]!;
      const view = yaml.load(text) as Record<string, any>;
      expect(view.openapi).toBe("3.0.3");
      expect(view).not.toHaveProperty("webhooks");
      expect(view.servers).toHaveLength(1);
      expect(Object.keys(view.components.schemas)).toEqual(Object.keys((r.doc as any).components.schemas));
      expect(Object.keys(view.paths)).toHaveLength(Object.keys((r.doc as any).operations).length);
      expect(text).toMatchSnapshot();
    });

    test(`${f.name}: Markdown-витрина (snapshot), asyncapi.yaml не меняется`, async () => {
      const plain = await emit(source(f.name), f.target);
      const r = await emit(source(f.name), f.target, { "markdown-output-file": "asyncapi.md" });
      expectNoErrors(r);
      expect(Object.keys(r.outputs).sort()).toEqual(["asyncapi.md", "asyncapi.yaml"]);
      expect(r.outputs["asyncapi.yaml"]).toBe(plain.outputs["asyncapi.yaml"]);
      expect(r.outputs["asyncapi.md"]).toMatchSnapshot();
    });

    test(`${f.name}: витрина в JSON при file-type: json`, async () => {
      const r = await emit(source(f.name), f.target, {
        "file-type": "json",
        "output-file": "asyncapi.json",
        "openapi-output-file": "openapi.json",
      });
      expectNoErrors(r);
      expect(JSON.parse(r.outputs["openapi.json"]!).openapi).toBe("3.0.3");
    });
  }
});

describe.skipIf(!HAS_REDOCLY)("integration: redocly lint OpenAPI-витрины", () => {
  for (const f of fixtures) {
    test(`${f.name} passes redocly lint`, async () => {
      const r = await emit(source(f.name), f.target, { "openapi-output-file": f.file });
      expectNoErrors(r);
      const result = runRedocly(r.outputs[f.file]!, { fileName: f.file });
      expect(result.ok, result.error ?? "").toBe(true);
    });
  }

  test("routing key с параметром проходит lint (path-parameters-defined)", () => {
    const text = serialize(toOpenApiView(amqpDoc()), { fileType: "yaml", newLine: "lf" });
    expect(text).toContain("публикует pdf.{uid}");
    const result = runRedocly(text, { fileName: "amqp.openapi.yaml" });
    expect(result.ok, result.error ?? "").toBe(true);
  });
});

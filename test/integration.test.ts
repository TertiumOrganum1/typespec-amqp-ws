import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";
import { runModelina, runRedocly, HAS_ASYNCAPI, HAS_REDOCLY } from "../scripts/run-tools.js";

/**
 * Эти тесты требуют установленных CLI:
 *   npm install -g @asyncapi/cli @redocly/cli
 * Если они не установлены — тесты помечаются как пропущенные.
 */

const fixtures = [
  { name: "example-amqp", target: "amqp" as const },
  { name: "example-ws", target: "ws" as const },
];

describe.skipIf(!HAS_REDOCLY)("integration: redocly lint", () => {
  for (const f of fixtures) {
    test(`${f.name} passes redocly lint`, async () => {
      const src = readFileSync(
        new URL(`./fixtures/${f.name}.tsp`, import.meta.url),
        "utf-8",
      );
      const r = await emit(src, f.target);
      expectNoErrors(r);
      const result = runRedocly(r.yaml);
      expect(result.ok, result.error ?? "").toBe(true);
    });
  }
});

describe.skipIf(!HAS_ASYNCAPI)("integration: modelina Go codegen", () => {
  for (const f of fixtures) {
    test(`${f.name} → Go models generate`, async () => {
      const src = readFileSync(
        new URL(`./fixtures/${f.name}.tsp`, import.meta.url),
        "utf-8",
      );
      const r = await emit(src, f.target);
      expectNoErrors(r);
      const result = runModelina(r.yaml, "golang");
      expect(result.ok, result.error ?? "").toBe(true);
      if (result.ok) {
        expect(result.files!.length).toBeGreaterThan(0);
      }
    });
  }
});

describe.skipIf(!HAS_ASYNCAPI)("integration: modelina TypeScript codegen", () => {
  for (const f of fixtures) {
    test(`${f.name} → TS models generate`, async () => {
      const src = readFileSync(
        new URL(`./fixtures/${f.name}.tsp`, import.meta.url),
        "utf-8",
      );
      const r = await emit(src, f.target);
      expectNoErrors(r);
      const result = runModelina(r.yaml, "typescript");
      expect(result.ok, result.error ?? "").toBe(true);
    });
  }
});

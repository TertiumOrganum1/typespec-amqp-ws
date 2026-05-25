import { describe, expect, test } from "vitest";
import { emit, expectNoErrors } from "./utils/test-host.js";

describe("smoke", () => {
  test("empty namespace compiles", async () => {
    const result = await emit(`
      namespace Smoke;
    `);
    // На этой стадии эмиттер ещё пустой, проверяем только что компиляция и эмиттер не падают.
    expectNoErrors(result);
  });
});

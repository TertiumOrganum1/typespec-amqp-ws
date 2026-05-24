import {
  createTestHost,
  createTestWrapper,
  type BasicTestRunner,
  type TestHost,
} from "@typespec/compiler/testing";
import { TypeSpecAmqpWsTestLibrary } from "../../src/testing.js";
import * as yaml from "js-yaml";

export interface EmitResult {
  yaml: string;
  doc: Record<string, unknown>;
  diagnostics: readonly { code: string; message: string; severity: string }[];
}

export type EmitTarget = "amqp" | "ws";

/**
 * Компилирует TypeSpec-сниппет, запускает наш эмиттер и возвращает YAML/parsed-doc/diagnostics.
 */
export async function emit(
  source: string,
  target: EmitTarget = "amqp",
  options: Record<string, unknown> = {},
): Promise<EmitResult> {
  const host: TestHost = await createTestHost({
    libraries: [TypeSpecAmqpWsTestLibrary],
  });

  const emitterName = `@etc-utils/typespec-amqp-ws/${target}`;
  const subNamespace = target === "amqp" ? "TspAsyncApi.Amqp" : "TspAsyncApi.WebSocket";

  const wrapper: BasicTestRunner = createTestWrapper(host, {
    autoImports: ["@etc-utils/typespec-amqp-ws"],
    autoUsings: ["TspAsyncApi", subNamespace],
    compilerOptions: {
      emit: [emitterName],
      options: { [emitterName]: options },
      noEmit: false,
    },
  });

  const [_program, diagnostics] = await wrapper.compileAndDiagnose(source);

  // Найти выходной YAML-файл во всём виртуальном FS теста.
  const filename = (options["output-file"] as string) ?? "asyncapi.yaml";
  let yamlText = "";
  for (const [path, content] of host.fs.entries()) {
    if (path.endsWith(`/${filename}`)) {
      yamlText = content;
      break;
    }
  }

  const doc = yamlText ? (yaml.load(yamlText) as Record<string, unknown>) : {};

  return {
    yaml: yamlText,
    doc,
    diagnostics: diagnostics.map((d) => ({
      code: String(d.code),
      message: typeof d.message === "string" ? d.message : String(d.message),
      severity: d.severity,
    })),
  };
}

export function expectNoErrors(result: EmitResult): void {
  const errors = result.diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    throw new Error(
      `Expected no errors, got:\n${errors.map((d) => `  [${d.code}] ${d.message}`).join("\n")}`,
    );
  }
}

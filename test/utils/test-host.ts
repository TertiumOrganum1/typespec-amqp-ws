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
  /** Все файлы, записанные эмиттером: путь относительно каталога вывода → содержимое. */
  outputs: Record<string, string>;
  diagnostics: readonly { code: string; message: string; severity: string }[];
}

export type EmitTarget = "amqp" | "ws";

const PACKAGE_NAME = "@etc-utils/typespec-amqp-ws";

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

  const emitterName = `${PACKAGE_NAME}/${target}`;
  const subNamespace = target === "amqp" ? "TspAsyncApi.Amqp" : "TspAsyncApi.WebSocket";

  const wrapper: BasicTestRunner = createTestWrapper(host, {
    autoImports: [PACKAGE_NAME],
    autoUsings: ["TspAsyncApi", subNamespace],
    compilerOptions: {
      emit: [emitterName],
      // Компилятор ищет опции эмиттера по имени пакета из package.json, а не по sub-path экспорта.
      options: { [PACKAGE_NAME]: options },
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

  // Каталог вывода по умолчанию — `<output-dir>/<имя пакета>/`; копия библиотеки лежит в node_modules.
  const outputDirMarker = `/${PACKAGE_NAME}/`;
  const outputs: Record<string, string> = {};
  for (const [path, content] of host.fs.entries()) {
    const idx = path.indexOf(outputDirMarker);
    if (idx < 0 || path.includes("/node_modules/")) continue;
    outputs[path.slice(idx + outputDirMarker.length)] = content;
  }

  return {
    yaml: yamlText,
    doc,
    outputs,
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

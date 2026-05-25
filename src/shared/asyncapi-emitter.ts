import type { EmitContext, Namespace } from "@typespec/compiler";
import { listServices } from "@typespec/compiler";
import {
  emptyDoc,
  type AsyncApiDoc,
  type AsyncApiInfo,
  type AsyncApiServer,
} from "./document.js";
import { SchemaBuilder } from "./schema-emitter.js";
import { serialize } from "./yaml-writer.js";
import { InfoKey, ServerKey } from "./state.js";
import type { InfoOptions, ServerOptions } from "./decorators-service.js";
import { buildAmqp } from "../amqp/builder.js";
import { buildWs } from "../ws/builder.js";
import type { EmitterOptions } from "./options.js";

export type EmitTarget = "amqp" | "ws";

export async function emitAsyncApi(
  context: EmitContext<EmitterOptions>,
  target: EmitTarget,
): Promise<void> {
  if (context.program.compilerOptions.noEmit) return;

  const doc: AsyncApiDoc = emptyDoc();

  buildServiceInfo(context, doc);

  const schemas = new SchemaBuilder(context.program);
  schemas.collect();
  const collectedSchemas = schemas.collectedSchemas();
  if (Object.keys(collectedSchemas).length > 0) {
    doc.components = { ...(doc.components ?? {}), schemas: collectedSchemas };
  }

  // Транспорт-специфичная сборка channels/operations/messages
  if (target === "amqp") {
    buildAmqp(context.program, doc);
  } else {
    buildWs(context.program, doc);
  }

  const outputFile = context.options["output-file"] ?? "asyncapi.yaml";
  const text = serialize(doc, {
    fileType: context.options["file-type"] ?? "yaml",
    newLine: context.options["new-line"] ?? "lf",
  });
  const outputPath = `${context.emitterOutputDir}/${outputFile}`;
  // На реальной FS родительская директория может не существовать — создаём её.
  // mkdirp на host'е не предоставлен напрямую, поэтому через стандартный fs API.
  // В test-окружении host.writeFile сам создаст родителей; в production-режиме — нет.
  if (typeof context.program.host.mkdirp === "function") {
    const parent = outputPath.slice(0, outputPath.lastIndexOf("/"));
    await context.program.host.mkdirp(parent);
  }
  await context.program.host.writeFile(outputPath, text);
}

function buildServiceInfo(context: EmitContext<EmitterOptions>, doc: AsyncApiDoc): void {
  const services = listServices(context.program);
  if (services.length === 0) return;

  const serviceNs: Namespace = services[0]!.type;
  const serviceMeta = services[0]!;
  const infoOpts = context.program.stateMap(InfoKey).get(serviceNs) as InfoOptions | undefined;

  const info: AsyncApiInfo = {
    title: serviceMeta.title ?? "Untitled",
    version: infoOpts?.version ?? "0.0.0",
  };
  if (infoOpts?.description) info.description = infoOpts.description;
  if (infoOpts?.contact) info.contact = { ...infoOpts.contact };
  if (infoOpts?.license) info.license = { ...infoOpts.license };
  if (infoOpts?.externalDocs) info.externalDocs = { ...infoOpts.externalDocs };
  doc.info = info;

  const serverMap = context.program.stateMap(ServerKey).get(serviceNs) as
    | Map<string, ServerOptions>
    | undefined;
  if (serverMap && serverMap.size > 0) {
    const servers: Record<string, AsyncApiServer> = {};
    for (const [name, opts] of serverMap.entries()) {
      servers[name] = { ...opts };
    }
    doc.servers = servers;
  }
}

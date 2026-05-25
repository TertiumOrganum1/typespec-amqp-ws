import type { DecoratorContext, Namespace } from "@typespec/compiler";
import { InfoKey, ServerKey } from "./state.js";

// Сопоставление TypeSpec-namespace с JS-модулем.
export const namespace = "TspAsyncApi";

export interface InfoOptions {
  version: string;
  description?: string;
  contact?: { name?: string; url?: string; email?: string };
  license?: { name: string; url?: string };
  externalDocs?: { url: string; description?: string };
}

export interface ServerOptions {
  host: string;
  protocol: string;
  pathname?: string;
  description?: string;
  variables?: Record<string, { default?: string; description?: string; enum?: string[] }>;
}

export function $info(context: DecoratorContext, target: Namespace, options: InfoOptions): void {
  context.program.stateMap(InfoKey).set(target, options);
}

export function $server(
  context: DecoratorContext,
  target: Namespace,
  name: string,
  options: ServerOptions,
): void {
  const map: Map<string, ServerOptions> =
    (context.program.stateMap(ServerKey).get(target) as Map<string, ServerOptions> | undefined) ??
    new Map();
  map.set(name, options);
  context.program.stateMap(ServerKey).set(target, map);
}

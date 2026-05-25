import type { DecoratorContext, Operation } from "@typespec/compiler";
import {
  WsPublishKey,
  WsConsumeKey,
  WsBinaryKey,
  MessageKey,
} from "../shared/state.js";

export const namespace = "TspAsyncApi.WebSocket";

export function $publish(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(WsPublishKey).set(target, true);
}

export function $consume(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(WsConsumeKey).set(target, true);
}

export function $binary(context: DecoratorContext, target: Operation): void {
  context.program.stateMap(WsBinaryKey).set(target, true);
}

export interface MessageOverride {
  name?: string;
  summary?: string;
}

export function $message(
  context: DecoratorContext,
  target: Operation,
  config: MessageOverride,
): void {
  context.program.stateMap(MessageKey).set(target, config);
}

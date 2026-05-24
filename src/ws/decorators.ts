import type { DecoratorContext, Operation, Model } from "@typespec/compiler";
import {
  WsPublishKey,
  WsConsumeKey,
  WsReplyKey,
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

export function $reply(context: DecoratorContext, target: Operation, replyType: Model): void {
  context.program.stateMap(WsReplyKey).set(target, replyType);
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

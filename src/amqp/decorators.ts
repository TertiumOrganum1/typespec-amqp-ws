import type { DecoratorContext, Operation } from "@typespec/compiler";
import { AmqpPublishKey, AmqpConsumeKey, MessageKey } from "../shared/state.js";
import { reportDiagnostic } from "../shared/lib.js";

export const namespace = "TspAsyncApi.Amqp";

export interface ExchangeConfig {
  name: string;
  type: string;
  durable?: boolean;
  autoDelete?: boolean;
}

export interface QueueConfig {
  name: string;
  durable?: boolean;
  autoDelete?: boolean;
  exclusive?: boolean;
}

export interface PublishConfig {
  channelName?: string;
  description?: string;
  routingKey?: string;
  exchange?: ExchangeConfig;
}

export interface ConsumeConfig {
  channelName?: string;
  description?: string;
  routingKey?: string;
  queue?: QueueConfig;
}

const ALLOWED_EXCHANGE_TYPES = new Set(["direct", "fanout"]);

export function $publish(
  context: DecoratorContext,
  target: Operation,
  config: PublishConfig,
): void {
  if (!config.exchange) {
    reportDiagnostic(context.program, {
      code: "publish-without-exchange",
      target,
      format: {},
    });
    return;
  }
  if (!ALLOWED_EXCHANGE_TYPES.has(config.exchange.type)) {
    reportDiagnostic(context.program, {
      code: "unknown-exchange-type",
      target,
      format: { type: config.exchange.type },
    });
    return;
  }
  context.program.stateMap(AmqpPublishKey).set(target, config);
}

export function $consume(
  context: DecoratorContext,
  target: Operation,
  config: ConsumeConfig,
): void {
  if (!config.queue) {
    reportDiagnostic(context.program, {
      code: "consume-without-queue",
      target,
      format: {},
    });
    return;
  }
  context.program.stateMap(AmqpConsumeKey).set(target, config);
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

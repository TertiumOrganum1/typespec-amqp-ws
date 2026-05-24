import type { Program, Operation } from "@typespec/compiler";
import { navigateProgram, getDoc, getSummary } from "@typespec/compiler";
import { AmqpPublishKey, AmqpConsumeKey, MessageKey } from "../shared/state.js";
import type {
  AsyncApiDoc,
  AsyncApiChannel,
  AsyncApiOperation,
  AsyncApiMessage,
} from "../shared/document.js";
import { reportDiagnostic } from "../shared/lib.js";
import type {
  PublishConfig,
  ConsumeConfig,
  MessageOverride,
  ExchangeConfig,
  QueueConfig,
} from "./decorators.js";

export function buildAmqp(program: Program, doc: AsyncApiDoc): void {
  navigateProgram(program, {
    operation(op) {
      const pub = program.stateMap(AmqpPublishKey).get(op) as PublishConfig | undefined;
      const con = program.stateMap(AmqpConsumeKey).get(op) as ConsumeConfig | undefined;
      if (pub) attachPublish(program, doc, op, pub);
      else if (con) attachConsume(program, doc, op, con);
    },
  });
}

function attachPublish(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  config: PublishConfig,
): void {
  const ctx = prepareCommon(program, doc, op, config.channelName);
  if (!ctx) return;
  const { channelKey, messageKey, returnTypeName } = ctx;

  const channel: AsyncApiChannel = doc.channels![channelKey] ?? {};
  if (config.routingKey) channel.address = config.routingKey;
  channel.bindings = {
    ...(channel.bindings ?? {}),
    amqp: {
      is: "routingKey",
      exchange: cleanExchange(config.exchange!),
    },
  };
  channel.messages = channel.messages ?? {};
  channel.messages[messageKey] = { $ref: `#/components/messages/${messageKey}` };
  doc.channels![channelKey] = channel;

  registerMessage(program, doc, op, messageKey, returnTypeName);
  registerOperation(program, doc, op, channelKey, messageKey, "send");
}

function attachConsume(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  config: ConsumeConfig,
): void {
  const ctx = prepareCommon(program, doc, op, config.channelName);
  if (!ctx) return;
  const { channelKey, messageKey, returnTypeName } = ctx;

  const channel: AsyncApiChannel = doc.channels![channelKey] ?? {};
  if (config.routingKey) channel.address = config.routingKey;
  channel.bindings = {
    ...(channel.bindings ?? {}),
    amqp: {
      is: "queue",
      queue: cleanQueue(config.queue!),
    },
  };
  channel.messages = channel.messages ?? {};
  channel.messages[messageKey] = { $ref: `#/components/messages/${messageKey}` };
  doc.channels![channelKey] = channel;

  registerMessage(program, doc, op, messageKey, returnTypeName);
  registerOperation(program, doc, op, channelKey, messageKey, "receive");
}

interface PrepareCtx {
  channelKey: string;
  messageKey: string;
  returnTypeName: string;
}

function prepareCommon(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  channelNameOverride: string | undefined,
): PrepareCtx | undefined {
  const rt = op.returnType;
  if (rt.kind !== "Model" || !rt.name) {
    reportDiagnostic(program, {
      code: "anonymous-return",
      target: op,
      format: { op: op.name },
    });
    return undefined;
  }

  const channelKey = channelNameOverride ?? op.name;
  const override = program.stateMap(MessageKey).get(op) as MessageOverride | undefined;
  const messageKey = override?.name ?? lowerFirst(rt.name);

  doc.channels = doc.channels ?? {};
  doc.operations = doc.operations ?? {};
  doc.components = doc.components ?? {};
  doc.components.messages = doc.components.messages ?? {};

  return { channelKey, messageKey, returnTypeName: rt.name };
}

function registerMessage(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  messageKey: string,
  returnTypeName: string,
): void {
  const override = program.stateMap(MessageKey).get(op) as MessageOverride | undefined;
  const message: AsyncApiMessage = {
    payload: { $ref: `#/components/schemas/${returnTypeName}` },
  };
  if (override?.summary) message.summary = override.summary;
  doc.components!.messages![messageKey] = message;
}

function registerOperation(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  channelKey: string,
  messageKey: string,
  action: "send" | "receive",
): void {
  const summary = getSummary(program, op);
  const description = getDoc(program, op);
  const operation: AsyncApiOperation = {
    action,
    channel: { $ref: `#/channels/${channelKey}` },
    messages: [{ $ref: `#/channels/${channelKey}/messages/${messageKey}` }],
  };
  if (summary) operation.summary = summary;
  if (description) operation.description = description;
  doc.operations![op.name] = operation;
}

function cleanExchange(e: ExchangeConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { name: e.name, type: e.type };
  if (e.durable !== undefined) out.durable = e.durable;
  if (e.autoDelete !== undefined) out.autoDelete = e.autoDelete;
  return out;
}

function cleanQueue(q: QueueConfig): Record<string, unknown> {
  const out: Record<string, unknown> = { name: q.name };
  if (q.durable !== undefined) out.durable = q.durable;
  if (q.autoDelete !== undefined) out.autoDelete = q.autoDelete;
  if (q.exclusive !== undefined) out.exclusive = q.exclusive;
  return out;
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

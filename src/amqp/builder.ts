import type { Program, Operation, Model } from "@typespec/compiler";
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
  const messageModel = extractParamModel(program, op);
  if (!messageModel) return;
  const ctx = prepareCommon(program, doc, op, config.channelName, messageModel);

  const channel: AsyncApiChannel = doc.channels![ctx.channelKey] ?? {};
  if (config.routingKey) channel.address = config.routingKey;
  channel.bindings = {
    ...(channel.bindings ?? {}),
    amqp: {
      is: "routingKey",
      exchange: cleanExchange(config.exchange!),
    },
  };
  channel.messages = channel.messages ?? {};
  channel.messages[ctx.messageKey] = { $ref: `#/components/messages/${ctx.messageKey}` };
  const channelDesc = config.description ?? getDoc(program, op);
  if (channelDesc) channel.description = channelDesc;
  doc.channels![ctx.channelKey] = channel;

  registerMessage(program, doc, op, ctx.messageKey, ctx.messageTypeName);
  registerOperation(program, doc, op, ctx.channelKey, ctx.messageKey, "send");
}

function attachConsume(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  config: ConsumeConfig,
): void {
  const messageModel = extractReturnModel(program, op);
  if (!messageModel) return;
  const ctx = prepareCommon(program, doc, op, config.channelName, messageModel);

  const channel: AsyncApiChannel = doc.channels![ctx.channelKey] ?? {};
  if (config.routingKey) channel.address = config.routingKey;
  channel.bindings = {
    ...(channel.bindings ?? {}),
    amqp: {
      is: "queue",
      queue: cleanQueue(config.queue!),
    },
  };
  channel.messages = channel.messages ?? {};
  channel.messages[ctx.messageKey] = { $ref: `#/components/messages/${ctx.messageKey}` };
  const channelDesc = config.description ?? getDoc(program, op);
  if (channelDesc) channel.description = channelDesc;
  doc.channels![ctx.channelKey] = channel;

  registerMessage(program, doc, op, ctx.messageKey, ctx.messageTypeName);
  registerOperation(program, doc, op, ctx.channelKey, ctx.messageKey, "receive");
}

interface PrepareCtx {
  channelKey: string;
  messageKey: string;
  messageTypeName: string;
}

function prepareCommon(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  channelNameOverride: string | undefined,
  messageModel: Model,
): PrepareCtx {
  const channelKey = channelNameOverride ?? op.name;
  const override = program.stateMap(MessageKey).get(op) as MessageOverride | undefined;
  const messageKey = override?.name ?? messageModel.name!;

  doc.channels = doc.channels ?? {};
  doc.operations = doc.operations ?? {};
  doc.components = doc.components ?? {};
  doc.components.messages = doc.components.messages ?? {};

  return { channelKey, messageKey, messageTypeName: messageModel.name! };
}

function registerMessage(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  messageKey: string,
  messageTypeName: string,
): void {
  const override = program.stateMap(MessageKey).get(op) as MessageOverride | undefined;
  const message: AsyncApiMessage = {
    payload: { $ref: `#/components/schemas/${messageTypeName}` },
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

function extractParamModel(program: Program, op: Operation): Model | undefined {
  const params = [...op.parameters.properties.values()];
  if (params.length === 0) {
    reportDiagnostic(program, {
      code: "publish-must-have-param",
      target: op,
      format: { op: op.name },
    });
    return undefined;
  }
  if (params.length > 1) {
    reportDiagnostic(program, {
      code: "publish-multiple-params",
      target: op,
      format: { op: op.name },
    });
    return undefined;
  }
  const t = params[0]!.type;
  if (t.kind !== "Model" || !t.name) {
    reportDiagnostic(program, {
      code: "anonymous-param",
      target: op,
      format: { op: op.name },
    });
    return undefined;
  }
  return t;
}

function extractReturnModel(program: Program, op: Operation): Model | undefined {
  const rt = op.returnType;
  if (rt.kind === "Intrinsic" && (rt.name === "void" || rt.name === "never")) {
    reportDiagnostic(program, {
      code: "consume-must-return",
      target: op,
      format: { op: op.name },
    });
    return undefined;
  }
  if (rt.kind !== "Model" || !rt.name) {
    reportDiagnostic(program, {
      code: "anonymous-return",
      target: op,
      format: { op: op.name },
    });
    return undefined;
  }
  return rt;
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

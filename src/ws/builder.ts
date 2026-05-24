import type { Program, Operation, Model } from "@typespec/compiler";
import { navigateProgram, getDoc, getSummary } from "@typespec/compiler";
import {
  WsPublishKey,
  WsConsumeKey,
  WsReplyKey,
  WsBinaryKey,
  MessageKey,
} from "../shared/state.js";
import type {
  AsyncApiDoc,
  AsyncApiChannel,
  AsyncApiMessage,
  AsyncApiOperation,
} from "../shared/document.js";
import { reportDiagnostic } from "../shared/lib.js";
import type { MessageOverride } from "./decorators.js";

const DEFAULT_CHANNEL = "/";

export function buildWs(program: Program, doc: AsyncApiDoc): void {
  let hasOps = false;

  navigateProgram(program, {
    operation(op) {
      const isPub = program.stateMap(WsPublishKey).has(op);
      const isCon = program.stateMap(WsConsumeKey).has(op);
      if (!isPub && !isCon) return;
      hasOps = true;
      attach(program, doc, op, isPub ? "send" : "receive");
    },
  });

  // Если есть операции — гарантируем существование канала "/".
  if (hasOps) {
    doc.channels = doc.channels ?? {};
    doc.channels[DEFAULT_CHANNEL] = doc.channels[DEFAULT_CHANNEL] ?? {
      address: DEFAULT_CHANNEL,
      messages: {},
    };
  }
}

function attach(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  action: "send" | "receive",
): void {
  const rt = op.returnType;
  if (rt.kind !== "Model" || !rt.name) {
    reportDiagnostic(program, {
      code: "anonymous-return",
      target: op,
      format: { op: op.name },
    });
    return;
  }

  const override = program.stateMap(MessageKey).get(op) as MessageOverride | undefined;
  const messageKey = override?.name ?? lowerFirst(rt.name);
  const isBinary = program.stateMap(WsBinaryKey).has(op);

  doc.channels = doc.channels ?? {};
  doc.operations = doc.operations ?? {};
  doc.components = doc.components ?? {};
  doc.components.messages = doc.components.messages ?? {};

  // Регистрация message
  const message: AsyncApiMessage = {
    payload: { $ref: `#/components/schemas/${rt.name}` },
  };
  if (override?.summary) message.summary = override.summary;
  if (isBinary) message.contentType = "application/octet-stream";
  doc.components.messages[messageKey] = message;

  // Регистрация канала (создаём если не было)
  const channel: AsyncApiChannel =
    doc.channels[DEFAULT_CHANNEL] ?? { address: DEFAULT_CHANNEL, messages: {} };
  channel.messages = channel.messages ?? {};
  channel.messages[messageKey] = { $ref: `#/components/messages/${messageKey}` };

  // Reply
  let replyBlock: AsyncApiOperation["reply"] | undefined;
  const replyType = program.stateMap(WsReplyKey).get(op) as Model | undefined;
  if (replyType && replyType.name) {
    const replyKey = lowerFirst(replyType.name);
    doc.components.messages[replyKey] = {
      payload: { $ref: `#/components/schemas/${replyType.name}` },
    };
    channel.messages[replyKey] = { $ref: `#/components/messages/${replyKey}` };
    replyBlock = {
      channel: { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}` },
      messages: [
        { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}/messages/${replyKey}` },
      ],
    };
  }

  doc.channels[DEFAULT_CHANNEL] = channel;

  const summary = getSummary(program, op);
  const description = getDoc(program, op);
  const operation: AsyncApiOperation = {
    action,
    channel: { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}` },
    messages: [{ $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}/messages/${messageKey}` }],
  };
  if (summary) operation.summary = summary;
  if (description) operation.description = description;
  if (replyBlock) operation.reply = replyBlock;
  doc.operations[op.name] = operation;
}

function lowerFirst(s: string): string {
  return s.length === 0 ? s : s[0]!.toLowerCase() + s.slice(1);
}

function escapePointer(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

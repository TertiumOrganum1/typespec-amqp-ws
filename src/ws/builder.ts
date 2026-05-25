import type { Program, Operation, Model } from "@typespec/compiler";
import { navigateProgram, getDoc, getSummary } from "@typespec/compiler";
import {
  WsPublishKey,
  WsConsumeKey,
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
  const isBinary = program.stateMap(WsBinaryKey).has(op);
  const override = program.stateMap(MessageKey).get(op) as MessageOverride | undefined;

  doc.channels = doc.channels ?? {};
  doc.operations = doc.operations ?? {};
  doc.components = doc.components ?? {};
  doc.components.messages = doc.components.messages ?? {};

  // Binary: ни параметра, ни returnType — opaque bytes без JSON-payload.
  if (isBinary) {
    if (op.parameters.properties.size > 0 || !isVoidReturn(op)) {
      reportDiagnostic(program, {
        code: "binary-with-payload",
        target: op,
        format: { op: op.name },
      });
      return;
    }
    const messageKey = override?.name ?? capitalize(op.name);
    const message: AsyncApiMessage = { contentType: "application/octet-stream" };
    const summary = override?.summary ?? getSummary(program, op);
    const description = getDoc(program, op);
    if (summary) message.summary = summary;
    if (description) message.description = description;
    doc.components.messages[messageKey] = message;
    attachToChannel(program, doc, op, action, messageKey, undefined);
    return;
  }

  let primaryModel: Model | undefined;
  let replyModel: Model | undefined;

  if (action === "receive") {
    primaryModel = extractReturnModel(program, op);
    if (!primaryModel) return;
  } else {
    primaryModel = extractParamModel(program, op);
    if (!primaryModel) return;
    if (!isVoidReturn(op)) {
      const rt = op.returnType;
      if (rt.kind === "Model" && rt.name) {
        replyModel = rt;
      } else {
        reportDiagnostic(program, {
          code: "anonymous-return",
          target: op,
          format: { op: op.name },
        });
        return;
      }
    }
  }

  const messageKey = override?.name ?? primaryModel.name!;
  const message: AsyncApiMessage = {
    payload: { $ref: `#/components/schemas/${primaryModel.name}` },
  };
  if (override?.summary) message.summary = override.summary;
  doc.components.messages[messageKey] = message;

  let replyKey: string | undefined;
  if (replyModel) {
    replyKey = replyModel.name!;
    doc.components.messages[replyKey] = {
      payload: { $ref: `#/components/schemas/${replyModel.name}` },
    };
  }

  attachToChannel(program, doc, op, action, messageKey, replyKey);
}

function attachToChannel(
  program: Program,
  doc: AsyncApiDoc,
  op: Operation,
  action: "send" | "receive",
  messageKey: string,
  replyKey: string | undefined,
): void {
  const channel: AsyncApiChannel =
    doc.channels![DEFAULT_CHANNEL] ?? { address: DEFAULT_CHANNEL, messages: {} };
  channel.messages = channel.messages ?? {};
  channel.messages[messageKey] = { $ref: `#/components/messages/${messageKey}` };
  if (replyKey) {
    channel.messages[replyKey] = { $ref: `#/components/messages/${replyKey}` };
  }
  doc.channels![DEFAULT_CHANNEL] = channel;

  const summary = getSummary(program, op);
  const description = getDoc(program, op);
  const operation: AsyncApiOperation = {
    action,
    channel: { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}` },
    messages: [
      { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}/messages/${messageKey}` },
    ],
  };
  if (summary) operation.summary = summary;
  if (description) operation.description = description;
  if (replyKey) {
    operation.reply = {
      channel: { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}` },
      messages: [
        { $ref: `#/channels/${escapePointer(DEFAULT_CHANNEL)}/messages/${replyKey}` },
      ],
    };
  }
  doc.operations![op.name] = operation;
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

function isVoidReturn(op: Operation): boolean {
  const rt = op.returnType;
  return rt.kind === "Intrinsic" && (rt.name === "void" || rt.name === "never");
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

function escapePointer(s: string): string {
  return s.replace(/~/g, "~0").replace(/\//g, "~1");
}

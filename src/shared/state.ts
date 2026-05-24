// Уникальные ключи для хранения декораторного состояния в program.stateMap.

export const ServiceKey = Symbol.for("typespec-amqp-ws.service");
export const InfoKey = Symbol.for("typespec-amqp-ws.info");
export const ServerKey = Symbol.for("typespec-amqp-ws.server");

export const AmqpPublishKey = Symbol.for("typespec-amqp-ws.amqp.publish");
export const AmqpConsumeKey = Symbol.for("typespec-amqp-ws.amqp.consume");

export const WsPublishKey = Symbol.for("typespec-amqp-ws.ws.publish");
export const WsConsumeKey = Symbol.for("typespec-amqp-ws.ws.consume");
export const WsReplyKey = Symbol.for("typespec-amqp-ws.ws.reply");
export const WsBinaryKey = Symbol.for("typespec-amqp-ws.ws.binary");

export const ChannelKey = Symbol.for("typespec-amqp-ws.channel");
export const SummaryKey = Symbol.for("typespec-amqp-ws.summary");
export const MessageKey = Symbol.for("typespec-amqp-ws.message");

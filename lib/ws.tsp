import "../dist/src/ws/decorators.js";

using TypeSpec.Reflection;

namespace TspAsyncApi.WebSocket;

@doc("Override параметров сообщения")
model MessageOverride {
  @doc("Имя ключа сообщения в YAML")
  name?: string;

  @doc("Краткое описание сообщения")
  summary?: string;
}

/**
 * Операция-publisher: сервис отправляет сообщение.
 * → AsyncAPI action: send.
 * Все WS-операции по умолчанию на канале "/".
 */
extern dec publish(target: Operation);

/**
 * Операция-consumer: сервис принимает сообщение.
 * → AsyncAPI action: receive.
 */
extern dec consume(target: Operation);

/**
 * Указывает модель ответного сообщения (request/reply pattern).
 * Реплай-сообщение автоматически добавится в канал и components.messages.
 */
extern dec reply(target: Operation, replyType: Model);

/**
 * Помечает сообщение операции как бинарное.
 * → components.messages.X.contentType: application/octet-stream
 */
extern dec binary(target: Operation);

/** Override параметров сообщения */
extern dec message(target: Operation, config: valueof MessageOverride);

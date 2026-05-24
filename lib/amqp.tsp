import "../dist/src/amqp/decorators.js";

using TypeSpec.Reflection;

namespace TspAsyncApi.Amqp;

@doc("Конфиг AMQP-обменника (exchange)")
model ExchangeConfig {
  @doc("Имя exchange в RabbitMQ")
  name: string;

  @doc("Тип exchange: direct либо fanout")
  type: string;

  @doc("Переживает рестарт брокера")
  durable?: boolean;

  @doc("Удаляется когда последний биндинг отвалился")
  autoDelete?: boolean;
}

@doc("Конфиг AMQP-очереди (queue)")
model QueueConfig {
  @doc("Имя очереди в RabbitMQ")
  name: string;

  @doc("Переживает рестарт брокера")
  durable?: boolean;

  @doc("Удаляется когда последний consumer отвалился")
  autoDelete?: boolean;

  @doc("Эксклюзивная — только один consumer")
  exclusive?: boolean;
}

@doc("Конфиг операции-publisher (action: send)")
model PublishConfig {
  @doc("Имя канала в YAML (override). Default — имя операции верзатим")
  channelName?: string;

  @doc("Routing key. Может быть опущен для fanout exchange")
  routingKey?: string;

  @doc("Exchange, в который публикуется сообщение")
  exchange: ExchangeConfig;
}

@doc("Конфиг операции-consumer (action: receive)")
model ConsumeConfig {
  @doc("Имя канала в YAML (override)")
  channelName?: string;

  @doc("Routing key (биндинг очереди к exchange)")
  routingKey?: string;

  @doc("Очередь, из которой читаются сообщения")
  queue: QueueConfig;
}

@doc("Override параметров сообщения")
model MessageOverride {
  @doc("Имя ключа сообщения в YAML")
  name?: string;

  @doc("Краткое описание сообщения")
  summary?: string;
}

/**
 * Операция-publisher: сервис отправляет сообщение в exchange.
 * → AsyncAPI action: send.
 */
extern dec publish(target: Operation, config: valueof PublishConfig);

/**
 * Операция-consumer: сервис читает сообщения из очереди.
 * → AsyncAPI action: receive.
 */
extern dec consume(target: Operation, config: valueof ConsumeConfig);

/** Override параметров сообщения, выводимого эмиттером */
extern dec message(target: Operation, config: valueof MessageOverride);

# Документация `typespec-amqp-ws`

Эмиттер TypeSpec для генерации AsyncAPI 3.0 спецификаций.

## Содержание

- [usage.md](usage.md) — Установка, конфигурация, синтаксис, поддерживаемые типы, типичные сценарии использования.
- [architecture.md](architecture.md) — Внутреннее устройство эмиттера: модули, поток данных, принципы преобразования TypeSpec в JSON Schema, особенности реализации.

## TL;DR

`typespec-amqp-ws` — это TypeSpec-эмиттер, который превращает декларативное описание сервиса на TypeSpec в YAML-файл AsyncAPI 3.0. Поддерживает два транспорта:

- **AMQP (RabbitMQ)** — publish в exchange, consume из очереди, exchange-типы `direct` и `fanout`.
- **WebSocket** — единый канал `/`, дискриминатор сообщений через literal-типы, request/reply, бинарные сообщения через `contentType: application/octet-stream`.

Эмиттер задуман с осознанным **ограниченным** объёмом фич: только то, что реально нужно для микросервисов команды. Не Kafka, не MQTT, не security schemes, не topic-exchanges, не numeric enums. Из-за этого его реализация и API проще, чем у универсальных AsyncAPI-эмиттеров.

## Минимальный пример

```typespec
import "typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.Amqp;

@service(#{ title: "My Service" })
@info(#{ version: "1.0.0" })
@server("rabbit", #{ host: "localhost:5672", protocol: "amqp" })
namespace MyService;

model Event {
  id: string;
  payload: string;
}

@publish(#{
  routingKey: "events.created",
  exchange: #{ name: "events", type: "direct", durable: true },
})
op sendEvent(): Event;
```

После `tsp compile .` получите валидный `asyncapi.yaml`, который скармливается стандартным инструментам — `modelina` для генерации Go/TS-моделей, `redocly` для HTML-документации.

## Лицензия

[MIT](../LICENSE).

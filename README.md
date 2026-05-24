# @tertiumorganum/typespec-amqp-ws

TypeSpec-эмиттер для генерации **AsyncAPI 3.0** спецификаций из лаконичных TypeSpec-описаний. Поддерживает два транспорта:

- **AMQP** (RabbitMQ): publish в exchange, consume из queue, типы exchange `direct` и `fanout`.
- **WebSocket**: единый канал `/`, дискриминатор сообщений через literal-типы, request/reply, бинарные сообщения.

Эмиттер сознательно **ограничен** — поддерживает только то подмножество AsyncAPI, которое реально применяется на практике в типичных микросервисах с RabbitMQ и WebSocket. Это упрощает реализацию, валидацию и сопровождение.

## Установка

```bash
npm install -D @tertiumorganum/typespec-amqp-ws @typespec/compiler @typespec/asset-emitter
```

Требования: Node.js 22+.

## Конфигурация

В `tspconfig.yaml` сервиса выбирается один из двух emit-таргетов:

```yaml
# Для сервиса с AMQP/RabbitMQ:
emit:
  - "@tertiumorganum/typespec-amqp-ws/amqp"
options:
  "@tertiumorganum/typespec-amqp-ws/amqp":
    file-type: yaml          # yaml | json. Default: yaml
    output-file: "asyncapi.yaml"
    new-line: "lf"           # lf | crlf. Default: lf
output-dir: "{project-root}/tsp-output"
```

```yaml
# Для сервиса с WebSocket-API:
emit:
  - "@tertiumorganum/typespec-amqp-ws/ws"
output-dir: "{project-root}/tsp-output"
```

Запуск:

```bash
tsp compile .
```

Полученный `asyncapi.yaml` можно скармливать `@asyncapi/cli` для генерации моделей на Go/TypeScript и `@redocly/cli` для документации.

## Полный AMQP-пример

```typespec
import "@tertiumorganum/typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.Amqp;

@service(#{ title: "Notifications Service" })
@info(#{
  version: "1.0.0",
  description: "Сервис рассылки уведомлений через RabbitMQ",
})
@server("rabbit", #{
  host: "rabbit.example.com:5672",
  pathname: "/notifications",
  protocol: "amqp",
  description: "RabbitMQ-сервер",
})
namespace Notifications;

@doc("Уведомление пользователю")
model Notification {
  @doc("Идентификатор уведомления")
  notificationId: string;

  @doc("Текст уведомления")
  text: string;
}

// PUBLISH: один декоратор содержит всё — routing key, exchange, тип.
@publish(#{
  routingKey: "notifications.created",
  exchange: #{
    name: "notifications-exchange",
    type: "direct",
    durable: true,
  },
})
@summary("Опубликовать новое уведомление")
op sendNotification(): Notification;

// CONSUME: чтение из именованной очереди, биндинг по routing key.
@consume(#{
  routingKey: "notifications.acknowledge",
  queue: #{
    name: "notifications-ack-queue",
    durable: true,
    autoDelete: false,
  },
})
@summary("Обработать подтверждение доставки")
op handleAck(): Notification;
```

Результат компиляции — валидный AsyncAPI 3.0 YAML с двумя каналами, операциями и AMQP-биндингами.

## Полный WebSocket-пример

```typespec
import "@tertiumorganum/typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.WebSocket;

@service(#{ title: "Chat WS" })
@info(#{ version: "1.0.0" })
@server("public", #{
  host: "localhost:{port}",
  protocol: "ws",
  pathname: "/chat",
  variables: #{
    port: #{ `default`: "8080", description: "Порт WS-сервера" },
  },
})
namespace Chat;

// Дискриминатор сообщения — обычное поле литерального типа.
// Эмиттер выведет { type: "string", const: "userJoined" } в JSON Schema.
model UserJoined {
  eventType: "userJoined";
  msgUid: string;
  userId: string;
  nickname: string;
}

model SendMessage {
  eventType: "sendMessage";
  msgUid: string;
  text: string;
}

model SendMessageResponse {
  eventType: "sendMessageResponse";
  msgUid: string;
  ok: boolean;
}

// Receive: сервер получает сообщение от клиента
@consume
@summary("Пользователь подключился к чату")
op userJoined(): UserJoined;

// Send + reply: request/reply pattern
@publish
@reply(SendMessageResponse)
@summary("Отправить сообщение в чат")
op sendMessage(): SendMessage;
```

Все WebSocket-операции автоматически складываются на единый канал `/`. Это типичный паттерн WebSocket-API, где дискриминация сообщений происходит через literal-поле модели (например, `eventType`).

## Поддерживаемые TypeSpec-типы

| TypeSpec | JSON Schema | Кодген (Go / TS / C++) |
|---|---|---|
| `string` | `{ type: string }` | `string` / `string` / `std::string` |
| `boolean` | `{ type: boolean }` | `bool` / `boolean` / `bool` |
| `integer` | `{ type: integer }` | `int32` / `number` / `int` |
| `bytes` | `{ type: string, format: binary }` | `[]byte` / `Uint8Array` / `std::vector<uint8_t>` |
| `enum X { A, B }` | `{ type: string, enum: [A, B] }` | string-typedef |
| `scalar X extends string` | именованная схема `{ type: string }` | string-typedef |
| `model X { ... }` | `{ type: object, properties, required, additionalProperties: false }` | struct/interface |
| `T[]` | `{ type: array, items: <T> }` | slice/array |
| `Record<T>` | `{ type: object, additionalProperties: <T> }` | `map[string]T` / `Record<string, T>` |
| literal `"foo"` | `{ type: string, const: "foo" }` | константа |
| `T \| null` | `{ type: [<base>, null] }` | pointer / nullable |
| `foo?: T` | поле не входит в `required` | опциональное поле |

### Запрещённые типы

Эти типы вызывают **ошибку компиляции** — намеренно, ради переносимости между языками:

| Тип | Почему запрещён |
|---|---|
| `int8`/`int16`/`int32`, `uint8`/`uint16`/`uint32` | Codegen всё равно генерирует signed `int32` / `number` для всех ширин. Размер-специфичные типы создают ложное ожидание сохранения семантики. Используйте `integer`. |
| `int64`/`uint64` | 64-битные числа должны передаваться как `string` (JS не умеет точно представлять 64-битные числа в JSON). Поясните формат в `@doc`. |
| `float32`/`float64`/`decimal`/`decimal128` | Числа с плавающей точкой — через `string` во избежание потерь точности на границе языков. |
| `safeint`/`numeric` | Неоднозначно для кодогенерации. Используйте `integer`. |
| `utcDateTime`/`plainDate`/`plainTime`/`duration` | Дата/время — это `string` в RFC-3339. TypeScript-codegen иначе подставляет `Date`, что ломает разбор в разных локалях. |
| `url` | URL — это `string`. |

### Запрет анонимных моделей

```typespec
// ❌ Нельзя — ошибка эмиттера
model M {
  payload: { foo: string };
}

// ✅ Только через явно объявленную модель
model MPayload { foo: string; }
model M { payload: MPayload; }
```

Обоснование: детерминированные имена в выводе важнее лаконичности. `modelina` (генератор моделей AsyncAPI) требует осмысленных имён, и авто-генерация ненадёжна.

## Декораторы

### Сервис

| Декоратор | Назначение |
|---|---|
| `@service(#{ title })` | Стандартный из `@typespec/compiler`. Маркирует namespace как сервис. |
| `@info(#{ version, description?, contact?, license?, externalDocs? })` | Метаданные info-блока AsyncAPI. |
| `@server(name, #{ host, protocol, pathname?, description?, variables? })` | Описание одного брокера/сервера. Можно вызывать несколько раз. |

### AMQP

| Декоратор | Назначение |
|---|---|
| `@publish(#{ channelName?, routingKey?, exchange })` | Операция-publisher → `action: send`. Exchange-типы: `direct`, `fanout`. |
| `@consume(#{ channelName?, routingKey?, queue })` | Операция-consumer → `action: receive`. |
| `@summary(text)` | Стандартный из `@typespec/compiler`. Short summary операции. |
| `@message(#{ name?, summary? })` | Override параметров сгенерированного message. |
| `@doc(text)` | Стандартный. Длинное описание (description). |

### WebSocket

| Декоратор | Назначение |
|---|---|
| `@publish` | Без аргументов. Операция → `action: send`. |
| `@consume` | Без аргументов. Операция → `action: receive`. |
| `@reply(MessageModel)` | Указывает модель сообщения-ответа (request/reply pattern). |
| `@binary` | Помечает сообщение как бинарное → `contentType: application/octet-stream`. |
| `@message`, `@summary`, `@doc` | Как в AMQP. |

## Принципы преобразования

1. **`additionalProperties: false`** — по умолчанию на всех моделях. Намеренное отличие от `@typespec/openapi3`: мы не разрешаем произвольные поля без явного указания.
2. **Поле с `@doc`, ссылающееся на скаляр** — оборачивается в `allOf` с описанием. Копия поведения `@typespec/openapi3`: JSON Schema не допускает соседства `$ref` с `description`.
3. **Namespace prefix**: вложенные namespace дают префикс через точку (`outer.Inner`). Top-level service-namespace в префикс не входит. Соответствует `@typespec/openapi3`.
4. **AsyncAPI 3.0.0** — выбранная версия. 3.1 backward-совместима, но 3.0 проверена на широкой инструментальной поддержке.

## Диагностика

Все диагностики с префиксом `@tertiumorganum/typespec-amqp-ws/`:

- `unsupported-sized-int`, `unsupported-int64`, `unsupported-float`, `unsupported-fuzzy-numeric`, `unsupported-temporal`, `unsupported-url` — попытка использовать запрещённый тип.
- `anonymous-model`, `anonymous-return` — анонимная inline-модель.
- `non-string-enum`, `invalid-enum-value` — некорректный enum.
- `unknown-exchange-type` — неподдерживаемый тип exchange (только `direct`, `fanout`).
- `unsupported-union` — union, не являющийся `T | null`.
- `missing-doc` (warning) — модель/enum без `@doc`.

## Out of scope (v1)

Намеренно **не реализовано** в v1 — добавляется при реальной потребности:

- Транспорты Kafka, MQTT, HTTP/SSE, SNS/SQS.
- Exchange types `topic`, `headers`.
- AsyncAPI security schemes.
- `correlationId`.
- Traits (`channelTraits`, `operationTraits`, `messageTraits`).
- AsyncAPI extensions (`x-` properties).
- Polymorphism: пользовательские `oneOf`/`anyOf`/`allOf`.
- TypeSpec `@versioned` интеграция.
- Numeric-валуированные enum.
- `@tag` на operations.
- AsyncAPI 3.1.
- JSON output (только YAML).

## Документация

Подробная документация — в [docs/](docs/):
- [docs/usage.md](docs/usage.md) — установка, конфигурация, синтаксис, поддерживаемые типы, типичные сценарии.
- [docs/architecture.md](docs/architecture.md) — внутреннее устройство эмиттера, ключевые решения, точки расширения.

## Примеры

В [examples/](examples/):
- [amqp-publish.tsp](examples/amqp-publish.tsp) — простой AMQP publisher.
- [amqp-consume.tsp](examples/amqp-consume.tsp) — простой AMQP consumer.
- [ws-discriminator.tsp](examples/ws-discriminator.tsp) — WebSocket с literal-дискриминатором.
- [ws-reply.tsp](examples/ws-reply.tsp) — WebSocket с request/reply.

## Лицензия

[MIT](LICENSE).

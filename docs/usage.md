# Использование `@etc-utils/typespec-amqp-ws`

## Установка

```bash
npm install -D @etc-utils/typespec-amqp-ws @typespec/compiler @typespec/asset-emitter
```

Требования:
- Node.js 22+ (рекомендуется 24+ для совместимости с `@asyncapi/cli`)
- TypeSpec 1.12+

## Конфигурация

В корне папки с TypeSpec-описанием сервиса (например, `<service>/asyncapi/`) создаётся файл `tspconfig.yaml`. Эмиттер `@etc-utils/typespec-amqp-ws` имеет два emit-таргета: `/amqp` и `/ws`. Один проект использует **один** из них.

### Конфиг для AMQP-сервиса

```yaml
emit:
  - "@etc-utils/typespec-amqp-ws/amqp"
options:
  "@etc-utils/typespec-amqp-ws/amqp":
    file-type: yaml          # yaml (default) или json
    output-file: "asyncapi.yaml"
    new-line: "lf"           # lf (default) или crlf
output-dir: "{project-root}/tsp-output"
```

### Конфиг для WebSocket-сервиса

```yaml
emit:
  - "@etc-utils/typespec-amqp-ws/ws"
options:
  "@etc-utils/typespec-amqp-ws/ws":
    file-type: yaml
    output-file: "asyncapi.yaml"
    new-line: "lf"
output-dir: "{project-root}/tsp-output"
```

После компиляции (`tsp compile .`) сгенерированный YAML лежит в `tsp-output/@etc-utils/typespec-amqp-ws/asyncapi.yaml`. Дальнейший пайплайн (redocly lint, modelina codegen, документация) идёт от этого файла.

## Структура проекта

Рекомендованная (соответствует тому, как у нас в команде):

```
<service>/asyncapi/
├── main.tsp                     # @service / @info / @server + операции
├── tsp-components/
│   └── models.tsp               # scalars + enums + модели
├── tspconfig.yaml               # конфиг эмиттера
├── package.json                 # зависимости (typespec, asset-emitter)
├── redocly.yaml                 # конфиг линтера
└── Makefile                     # include шаблонного build pipeline
```

## API эмиттера

### Декораторы общего назначения (namespace `TspAsyncApi`)

| Декоратор | Применяется к | Что делает |
|---|---|---|
| `@service(#{title})` | namespace | Стандартный из `@typespec/compiler`. Маркирует namespace как корневой сервис. |
| `@info(#{...})` | namespace | Заполняет блок `info:` AsyncAPI. Поля: `version`, `description?`, `contact?{name?, url?, email?}`, `license?{name, url?}`, `externalDocs?{url, description?}` |
| `@server(name, #{...})` | namespace | Описывает один сервер (брокер). Поля: `host`, `protocol`, `pathname?`, `description?`, `variables?: Record<#{default?, description?, enum?}>` |

### Декораторы AMQP (namespace `TspAsyncApi.Amqp`)

| Декоратор | Применяется к | Описание |
|---|---|---|
| `@publish(#{...})` | op | Операция-publisher → `action: send`. Поля: `channelName?`, `description?`, `routingKey?`, `exchange: #{name, type: "direct"\|"fanout", durable?, autoDelete?}`. Payload — параметр операции (`op X(msg: M): void`). |
| `@consume(#{...})` | op | Операция-consumer → `action: receive`. Поля: `channelName?`, `description?`, `routingKey?`, `queue: #{name, durable?, autoDelete?, exclusive?}`. Принимаемое сообщение — returnType (`op X(): M`). |
| `@message(#{...})` | op | Override параметров сообщения: `name?`, `summary?` |

### Декораторы WebSocket (namespace `TspAsyncApi.WebSocket`)

| Декоратор | Применяется к | Описание |
|---|---|---|
| `@publish` | op | без аргументов → `action: send` |
| `@consume` | op | без аргументов → `action: receive` |
| `@reply(MessageModel)` | op | Модель ответного сообщения (request/reply pattern). Reply-сообщение автоматически добавится в канал и `components.messages`. |
| `@binary` | op | Помечает сообщение бинарным → `contentType: application/octet-stream` |
| `@message(#{...})` | op | Override параметров сообщения |

### Стандартные TypeSpec-декораторы

Из `@typespec/compiler`:
- `@doc("...")` — длинное описание (попадает в `description` YAML)
- `@summary("...")` — короткое summary (попадает в `summary` YAML)

## Поддерживаемые TypeSpec-типы

| TypeSpec | YAML | Go / TS / C++ |
|---|---|---|
| `string` | `{type: string}` | string / string / std::string |
| `boolean` | `{type: boolean}` | bool / boolean / bool |
| `integer` | `{type: integer}` | int32 / number / int |
| `bytes` | `{type: string, format: binary}` | []byte / Uint8Array / std::vector<uint8_t> |
| `enum X { A, B }` | `{type: string, enum: [A, B]}` | string-typedef с константами |
| `scalar X extends string` | `{type: string}` в `components.schemas.X` | именованный string-typedef |
| `model X { ... }` | `{type: object, properties, required, additionalProperties: false}` | сгенерированная структура |
| `T[]` | `{type: array, items: <T>}` | slice / array |
| `Record<T>` | `{type: object, additionalProperties: <T>}` | `map[string]T` / `Record<string, T>` |
| literal `"foo"` (на поле модели) | `{type: string, const: "foo"}` | const-значение |
| literal `1` (integer) | `{type: integer, const: 1}` | const integer (например, маркер версии формата) |
| literal `1.5` (не integer) | `{type: string, const: "1.5"}` | float'ы не передаём по API — деградация в строку |
| literal `true` / `false` | `{type: boolean, const: <value>}` | const boolean |
| `T \| null` | `{type: [<base>, null]}` | pointer / nullable |
| `field?: T` | поле не в `required` | optional |

## Запрещённые типы (ошибка компиляции)

Эмиттер намеренно **запрещает**:

| Тип | Почему |
|---|---|
| `int8`/`int16`/`int32`, `uint8`/`uint16`/`uint32` | Кодгенераторы (`modelina`, `openapi-generator-cli`) **игнорируют** ширину и signed/unsigned, генерируют `int32`/`number`. Размер-специфичные типы создают ложное ожидание сохранения семантики на границе между языками. |
| `int64`/`uint64` | 64-битные числа должны передаваться как `string` — JavaScript не умеет точно представлять 64-битные числа в JSON. Поясните формат в `@doc`. |
| `float32`/`float64`/`decimal`/`decimal128` | Числа с плавающей точкой передавайте через `string` во избежание потерь точности на границе между языками. |
| `safeint`/`numeric` | Неоднозначно для кодогенерации. Используйте `integer`. |
| `utcDateTime`/`plainDate`/`plainTime`/`duration` | Дата/время — это `string` в RFC-3339 с пояснением в `@doc`. TypeScript-кодген иначе подставляет `Date`, что ломает разбор в разных локалях. |
| `url` | URL — это `string`. |

Эмиттер также **запрещает анонимные inline-модели в полях**:

```typespec
// ❌ Ошибка эмиттера
model M {
  payload: { foo: string };
}

// ✅ Только через явно объявленную модель
model MPayload { foo: string; }
model M { payload: MPayload; }
```

Обоснование: детерминированные имена в выводе важнее лаконичности на стороне источника. modelina требует осмысленных имён для генерации Go/TS-типов; авто-генерация ненадёжна.

## Полный пример: AMQP-сервис

```typespec
import "@etc-utils/typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.Amqp;

@service(#{ title: "Notifications" })
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

## Полный пример: WebSocket с дискриминатором и reply

```typespec
import "@etc-utils/typespec-amqp-ws";

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

// Дискриминатор сообщения — обычное поле literal-типа.
// Эмиттер выведет {type: "string", const: "userJoined"} в JSON Schema.
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

// Receive
@consume
@summary("Пользователь подключился к чату")
op userJoined(): UserJoined;

// Send + reply (request/reply pattern)
@publish
@reply(SendMessageResponse)
@summary("Отправить сообщение в чат")
op sendMessage(): SendMessage;
```

Все WS-операции автоматически складываются на единый канал `/`. Это типичный паттерн WebSocket-API, где дискриминация сообщений происходит через поле `eventType`.

## Версионирование AsyncAPI

Эмиттер генерирует AsyncAPI 3.0.0. Версия 3.1 backward-совместима, но мы остаёмся на 3.0 ради консервативности и максимальной совместимости с `modelina`/`redocly`.

## Дискриминация сообщений в WebSocket

В TypeSpec литерал-типы (`"localActions"`) превращаются в JSON Schema `const` — нативный механизм без специальных декораторов. **Любое** поле модели типа `: "значение"` становится `const` в схеме. Поле может называться как угодно — `eventType`, `kind`, `type`, и т.д. Модели без таких полей тоже валидны (например, AMQP-сообщения обычно без дискриминатора).

## Диагностики

Эмиттер выдаёт следующие коды (все с префиксом `@etc-utils/typespec-amqp-ws/`):

- `unsupported-sized-int`, `unsupported-int64`, `unsupported-float`, `unsupported-fuzzy-numeric`, `unsupported-temporal`, `unsupported-url` — попытка использовать запрещённый тип.
- `anonymous-model`, `anonymous-return` — анонимная inline-модель в поле или return type.
- `non-string-enum`, `invalid-enum-value` — некорректный enum (numeric или не-идентификаторное значение).
- `unknown-exchange-type` — `topic` или `headers` exchange (вне scope).
- `unsupported-union` — union, не являющийся `T | null`.
- `missing-doc` (warning) — модель/enum без `@doc`.

## Out of scope (v1)

Намеренно **не реализовано** в v1 — добавляется по запросу при реальной потребности:

- Транспорты Kafka, MQTT, HTTP/SSE, SNS/SQS.
- Exchange types `topic`, `headers`.
- AsyncAPI security schemes.
- `correlationId`.
- Traits (`channelTraits`, `operationTraits`, `messageTraits`).
- AsyncAPI extensions (`x-` properties).
- Polymorphism: пользовательские `oneOf`/`anyOf`/`allOf` (внутренний `allOf` для $ref+description — используется автоматически).
- TypeSpec `@versioned` интеграция.
- Numeric-валуированные enum.
- `@tag` на operations.
- AsyncAPI 3.1.
- JSON output (только YAML).

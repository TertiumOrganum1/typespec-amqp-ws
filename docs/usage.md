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
  "@etc-utils/typespec-amqp-ws":
    file-type: yaml          # yaml (default) или json
    output-file: "asyncapi.yaml"
    new-line: "lf"           # lf (default) или crlf
output-dir: "{project-root}/tsp-output"
```

Ключ в `options` — имя пакета без `/amqp` и `/ws`. Компилятор TypeSpec ищет опции эмиттера по полю `name` из `package.json`, поэтому опции под ключом `"@etc-utils/typespec-amqp-ws/amqp"` молча игнорируются, и эмиттер работает на значениях по умолчанию.

### Конфиг для WebSocket-сервиса

```yaml
emit:
  - "@etc-utils/typespec-amqp-ws/ws"
options:
  "@etc-utils/typespec-amqp-ws":
    file-type: yaml
    output-file: "asyncapi.yaml"
    new-line: "lf"
output-dir: "{project-root}/tsp-output"
```

После компиляции (`tsp compile .`) сгенерированный YAML лежит в `tsp-output/@etc-utils/typespec-amqp-ws/asyncapi.yaml`. Дальнейший пайплайн (redocly lint, modelina codegen, документация) идёт от этого файла.

### OpenAPI-витрина для GitLab

GitLab не умеет показывать AsyncAPI: `asyncapi.yaml` открывается как сырой YAML. OpenAPI GitLab рендерит через Swagger UI. Опция `openapi-output-file` (по умолчанию не задана) пишет рядом с основным файлом OpenAPI 3.0, построенный из того же AsyncAPI-документа:

```yaml
emit:
  - "@etc-utils/typespec-amqp-ws/amqp"
options:
  "@etc-utils/typespec-amqp-ws":
    emitter-output-dir: "{output-dir}/@etc-utils/typespec-amqp-ws"
    file-type: yaml
    output-file: asyncapi.yaml
    openapi-output-file: amqp.openapi.yaml
output-dir: "{project-root}/tsp-output"
```

Результат — `tsp-output/@etc-utils/typespec-amqp-ws/amqp.openapi.yaml`. `file-type` и `new-line` общие с основным файлом. Опция работает для обоих таргетов, `/amqp` и `/ws`.

**Имя файла.** GitLab включает Swagger UI, если в имени файла есть `openapi` или `swagger`, а расширение — `yaml`, `yml` или `json`. Подойдут `amqp.openapi.yaml`, `ws.openapi.yaml`, `openapi.yaml`.

**Это витрина, а не источник.** Кодогенерации по OpenAPI-файлу нет, Modelina и экстракторы работают только с `asyncapi.yaml`. Без опции вывод эмиттера не меняется ни на байт; с опцией `asyncapi.yaml` тоже остаётся прежним.

Как устроен документ:

| Что | Где в OpenAPI |
|---|---|
| `info` | `info`; в описание дописан блок: что это витрина, транспорт, таблица серверов из AsyncAPI. `info.externalDocs` вынесен на верхний уровень — в OpenAPI он живёт там |
| Операции (`receive` и `send`) | `paths`, метод `post`. Путь — `/принимает <address>` или `/публикует <address>`; без адреса — имя канала. При совпадении путей к ним дописывается `(<operationId>)`. Сначала все `receive`, потом все `send` |
| `operationId`, `summary` | ключ операции AsyncAPI; `operation.summary`, иначе `message.summary` |
| Транспорт | таблица в `description` операции: направление, routing key, exchange или очередь, сообщение, content type, параметры routing key |
| `channel.parameters` | ещё и `parameters` операции (`in: path`), чтобы линтер принимал `{param}` в пути |
| Bindings канала | `x-amqp` (и вообще `x-<протокол>`) — как есть, для машинного чтения |
| Сообщение | `requestBody`, `content.<contentType>.schema` — ссылка `#/components/schemas/X` как в AsyncAPI. Схема payload приводится к диалекту 3.0 (см. ниже). Без payload (WS `@binary`) — `application/octet-stream`, `{type: string, format: binary}` |
| WS `reply` | `responses."200"` с сообщением ответа; без reply — `responses."202"` «ответа нет» (в 3.0 `responses` обязателен) |
| `components.schemas` | все схемы из AsyncAPI, включая те, на которые операции не ссылаются, в диалекте 3.0 |
| `servers` | `<protocol>://<host><pathname>` для каждого сервера AsyncAPI, переменные переносятся (`default` обязателен в OpenAPI — при отсутствии берётся первый `enum` или пустая строка). Нет серверов — заглушка `url: /`. Swagger UI показывает их только для справки |
| `components.messages` | не выводится |

Почему OpenAPI 3.0, а не 3.1: GitLab перед показом разбирает файл своей сборкой swagger-client, и её ветка для 3.1 падает (`TypeError: i is not a function`) на любом документе — превью остаётся пустым. Из-за этого операции лежат в `paths` (в 3.0 нет `webhooks`), и у них есть кнопка Try it out; запрос по ней уйдёт в никуда, это ожидаемо.

Схемы эмиттер пишет в JSON Schema 2020-12, а 3.0 понимает свой диалект, поэтому в витрине они переводятся: `type: [T, "null"]` → `type: T` + `nullable: true`, `const` → `enum` из одного значения, числовые `exclusiveMinimum`/`exclusiveMaximum` → `minimum`/`maximum` + `true`, `$ref` с соседними полями (например, `description`) → `allOf: [{$ref}]` + эти поля.

Параметры routing key (`{taskUid}` в `публикует pdf.{taskUid}`) дополнительно выводятся в `parameters` операции как `in: path`, `required: true`, `schema: {type: string}`: линтеры читают путь как шаблон и требуют описать каждый параметр. Swagger UI показывает их в блоке Parameters. `redocly lint` с recommended-конфигом проходит без ошибок; остаются предупреждения `info-license` (если у сервиса нет `license`) и `no-server-example.com` (если брокер описан как `localhost`).

### Markdown-витрина

Просмотрщик GitLab запускает Swagger UI со своими настройками: операции свёрнуты, внутри операции сначала показан пример JSON, а не схема. Из OpenAPI-файла это не меняется. Опция `markdown-output-file` (по умолчанию не задана) пишет рядом третий файл — Markdown, который GitLab показывает сразу целиком:

```yaml
options:
  "@etc-utils/typespec-amqp-ws":
    output-file: asyncapi.yaml
    openapi-output-file: amqp.openapi.yaml
    markdown-output-file: asyncapi.md
```

Что внутри:

- заголовок, описание сервиса, блок «витрина» с таблицей серверов;
- оглавление: операции по группам «Принимает» и «Публикует» (receive раньше send), ссылка на модели;
- по операции: таблица транспорта (как в OpenAPI-витрине), параметры routing key и поля сообщения (и ответа WS) прямо таблицей;
- раздел «Модели»: сводная таблица с первым предложением описания, затем каждая модель — поля, тип, обязательность, описание, ограничения и значения по умолчанию, ссылки на операции, которые её передают.

Типы-модели в таблицах — ссылки на их разделы. Якоря строятся по правилам GitLab, совпадения нумеруются суффиксом `-1`. Угловые скобки в описаниях экранируются, иначе GitLab принял бы `<Template>_Data` за HTML-тег.

Swagger UI разрешает `$ref` относительно адреса страницы. Если открыть локальный HTML со встроенной спекой через `file://`, ссылки не разворачиваются и все типы показываются как `any`; в GitLab (https) и через локальный HTTP-сервер всё работает.

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
| `@publish(#{...})` | op | Операция-publisher → `action: send`. Поля: `channelName?`, `description?`, `routingKey?`, `exchange: #{name, type: "direct"\|"fanout"\|"topic", durable?, autoDelete?}`. Payload — параметр операции (`op X(msg: M): void`). |
| `@consume(#{...})` | op | Операция-consumer → `action: receive`. Поля: `channelName?`, `description?`, `routingKey?`, `queue: #{name, durable?, autoDelete?, exclusive?}`. Принимаемое сообщение — returnType (`op X(): M`). |
| `@message(#{...})` | op | Параметры сообщения: `name?`, `summary?`, `contentType?` |

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

Стандартные `@format`, `@pattern`, `@minLength`/`@maxLength`, `@minValue`/`@maxValue`, `@minItems`/`@maxItems` и значения по умолчанию переносятся в JSON Schema. Описания рядом с именованными типами не создают дополнительные модели через `allOf`; ограничения поверх `$ref` используют `allOf` для корректной валидации Draft-07.

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

## Бинарное сообщение AMQP

В файле моделей объявляется именованный скаляр:

```typespec
@doc("Бинарные байты PDF без JSON и base64.")
scalar PdfResult extends bytes;
```

Операция использует его как payload:

```typespec
@publish(#{
  routingKey: "pdf.{uid}",
  exchange: #{ name: "results", type: "topic", durable: true },
})
@message(#{
  contentType: "application/pdf",
})
op sendPdf(result: PdfResult): void;
```

`@consume` также принимает именованный скаляр в return type. Для `{uid}` в routing key создаётся `channels.parameters.uid`. Native AMQP `CorrelationId` не объявляется как JSON header: это отдельное свойство сообщения, которое задаёт транспортный код.

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
- `unknown-exchange-type` — `headers` exchange (вне scope).
- `unsupported-union` — union, не являющийся `T | null`.
- `missing-doc` (warning) — модель/enum без `@doc`.

## Out of scope (v1)

Намеренно **не реализовано** в v1 — добавляется по запросу при реальной потребности:

- Транспорты Kafka, MQTT, HTTP/SSE, SNS/SQS.
- Exchange type `headers`.
- AsyncAPI security schemes.
- `correlationId`.
- Traits (`channelTraits`, `operationTraits`, `messageTraits`).
- AsyncAPI extensions (`x-` properties).
- Polymorphism: пользовательские `oneOf`/`anyOf`/`allOf` (`allOf` используется для ограничений поверх именованных типов).
- TypeSpec `@versioned` интеграция.
- Numeric-валуированные enum.
- `@tag` на operations.
- AsyncAPI 3.1.
- JSON output (только YAML).

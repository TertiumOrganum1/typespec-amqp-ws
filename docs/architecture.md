# Архитектура `typespec-amqp-ws`

Этот документ — для тех, кто разрабатывает или модифицирует эмиттер. Описывает внутреннее устройство, ключевые архитектурные решения и точки расширения.

## Общая картина

```
TypeSpec sources (.tsp)
        │
        ▼ tsp compile
TypeSpec compiler AST + decorator state map
        │
        ▼ $onEmit($context)
┌────────────────────────────────────────────────┐
│  emitAsyncApi(context, target)                 │
│  ├─ buildServiceInfo  (info + servers)         │
│  ├─ SchemaBuilder     (модели/enum/scalars)    │
│  ├─ buildAmqp  либо  buildWs                   │
│  │   (channels + operations + messages)        │
│  └─ serialize → YAML/JSON                      │
└────────────────────────────────────────────────┘
        │
        ▼ writeFile
asyncapi.yaml (или .json)
```

Эмиттер построен на **`@typespec/asset-emitter`** — тот же фреймворк, на котором работают официальные `@typespec/openapi3` и `@typespec/json-schema`. Это даёт нам стандартные механизмы для разрешения `$ref`-ссылок, именования схем, обхода типов компилятора.

## Структура пакета

```
asyncapi/
├── package.json                   # exports: ".", "./amqp", "./ws", "./testing"
├── lib/
│   ├── main.tsp                   # точка входа (импортируется при `import "typespec-amqp-ws"`)
│   ├── amqp.tsp                   # объявления декораторов TspAsyncApi.Amqp
│   └── ws.tsp                     # объявления декораторов TspAsyncApi.WebSocket
├── src/
│   ├── index.ts                   # корневой entry: экспортирует $lib
│   ├── shared/
│   │   ├── lib.ts                 # createTypeSpecLibrary, диагностики, опции
│   │   ├── options.ts             # JSON Schema опций эмиттера
│   │   ├── state.ts               # Symbol-ключи для program.stateMap
│   │   ├── document.ts            # типы AsyncApiDoc, AsyncApiOperation и т.п.
│   │   ├── schema-emitter.ts      # SchemaBuilder: TypeSpec → JSON Schema
│   │   ├── decorators-service.ts  # @info, @server (namespace = "TspAsyncApi")
│   │   ├── asyncapi-emitter.ts    # оркестратор emitAsyncApi()
│   │   └── yaml-writer.ts         # сериализация YAML/JSON
│   ├── amqp/
│   │   ├── index.ts               # $onEmit для AMQP-таргета
│   │   ├── decorators.ts          # @publish, @consume, @message (namespace = "TspAsyncApi.Amqp")
│   │   └── builder.ts             # buildAmqp(program, doc)
│   └── ws/
│       ├── index.ts               # $onEmit для WS-таргета
│       ├── decorators.ts          # @publish, @consume, @reply, @binary, @message (namespace = "TspAsyncApi.WebSocket")
│       └── builder.ts             # buildWs(program, doc)
└── test/                          # vitest-тесты
```

## Ключевые решения

### Один пакет — два emit-таргета

`typespec-amqp-ws` экспортирует два независимых эмиттера через **sub-path exports** в `package.json`:

```json
"exports": {
  ".": { ... },           // корневые декораторы (@info, @server)
  "./amqp": { ... },      // $onEmit для AMQP
  "./ws": { ... }         // $onEmit для WebSocket
}
```

Пользователь подключает один из них в `tspconfig.yaml`:

```yaml
emit:
  - "typespec-amqp-ws/amqp"   # или "/ws"
```

**Почему так**: каждый сервис должен иметь либо AMQP, либо WebSocket API. Смешивать их в одном `asyncapi.yaml` — концептуально неправильно (разные транспорты, разные паттерны). Два emit-таргета обеспечивают чёткое разделение, при этом весь общий код (схемы, info, servers) живёт в `src/shared/`.

Эта возможность (`exports` с sub-paths в TypeSpec-пакете) появилась в TypeSpec 1.0+. До 1.0 пришлось бы делать два отдельных npm-пакета.

### Декораторы — три namespace, три JS-модуля

| TypeSpec namespace | JS-модуль (с `export const namespace`) |
|---|---|
| `TspAsyncApi` | `src/shared/decorators-service.ts` |
| `TspAsyncApi.Amqp` | `src/amqp/decorators.ts` |
| `TspAsyncApi.WebSocket` | `src/ws/decorators.ts` |

Каждый JS-модуль с декораторами объявляет `export const namespace = "..."`. Это **обязательное соглашение** TypeSpec — компилятор по этому экспорту узнаёт, к какому namespace относятся `$decoratorName`-функции из этого файла.

Все три файла импортируются в `lib/main.tsp` через `import "../dist/src/.../decorators.js"`. Когда пользователь пишет `import "typespec-amqp-ws"`, эта цепочка подгружает декораторы.

### Декораторы только пишут в state, эмиттер только читает

Все декораторы устроены одинаково:

```typescript
export function $publish(context: DecoratorContext, target: Operation, config: PublishConfig): void {
  // (опциональная валидация config)
  context.program.stateMap(AmqpPublishKey).set(target, config);
}
```

Они **не** делают эмит, не модифицируют типы, не обращаются к другим декораторам. Это правило TypeSpec — порядок выполнения декораторов относительно других файлов не гарантирован, поэтому декоратор должен только сохранять данные.

Эмиттер `$onEmit` затем обходит программу через `navigateProgram` и читает state.

### State-keys через Symbol.for()

```typescript
// src/shared/state.ts
export const AmqpPublishKey = Symbol.for("typespec-amqp-ws.amqp.publish");
export const AmqpConsumeKey = Symbol.for("typespec-amqp-ws.amqp.consume");
// ...
```

`Symbol.for(...)` создаёт глобальный symbol — два разных JS-модуля, получающие symbol с одной строкой, получат **тот же** symbol. Это важно, потому что декораторы и эмиттер живут в разных файлах, но обращаются к одному state.

### `@typespec/asset-emitter` vs самописный обход

Для большинства схемных типов мы используем **самописный обход** через `navigateProgram`. `@typespec/asset-emitter` (TypeEmitter) обеспечивает только общую инфраструктуру — `$ref` resolution мы делаем вручную через имена.

**Почему так**: наш набор типов узкий (запрещены циклические зависимости через `Union`, нет `oneOf`/`anyOf`), и простой `navigateProgram + map имён в namedSchemas` справляется. TypeEmitter добавил бы сложности (lifecycle методы, кэширование), которая для нашего объёма не окупается.

### Запрет анонимных моделей в полях

Принципиальное решение: анонимные `{...}`-объекты в полях запрещены. Только именованные `model X`.

```typespec
// ❌ ошибка эмиттера
model M {
  payload: { foo: string };
}
```

**Почему**: `modelina` (генератор Go/TS моделей) требует осмысленных имён для типов. Авто-генерация имён (`AnonymousSchema1`, и т.п.) ненадёжна и непредсказуема. Запрет на старте проще, чем чинить потом.

### `additionalProperties: false` по умолчанию

В отличие от `@typespec/openapi3` (где `additionalProperties` по умолчанию не указан, что эквивалентно "разрешены"), у нас на **каждой** модели объекта по умолчанию `additionalProperties: false`.

**Почему**: это соответствует руко­писной AsyncAPI-конвенции команды. "Зачем мне в структуры произвольно добавлять всякую фигню" (с) — лучше быть строгим по умолчанию.

### Узкий белый список типов с диагностиками

В `SchemaBuilder.scalarSchema` и связанной логике мы **явно отбрасываем**:
- Размер-специфичные int (int8/16/32, uint8/16/32) → ошибка `unsupported-sized-int`
- 64-битные числа → ошибка `unsupported-int64`
- Float / decimal → ошибка `unsupported-float`
- Date / time типы → ошибка `unsupported-temporal`
- URL → ошибка `unsupported-url`
- `safeint`/`numeric` → ошибка `unsupported-fuzzy-numeric`

**Почему**: эмпирически проверено, что modelina и openapi-generator-cli **игнорируют** `format` подсказки и генерируют `int32`/`number`/`string` независимо. Размер-специфичные типы создают ложное ожидание. На границе между языками (C++, Go, TypeScript) переносимо работают только `string`, `boolean`, `integer`, `bytes`. Любой другой числовой тип — мина под кодгеном.

### `allOf`-обёртка для $ref с description

Если у поля модели есть `@doc`, а тип — именованный (scalar или другая model), то генерируется:

```yaml
field:
  allOf:
    - $ref: '#/components/schemas/SomeType'
  description: "пояснение"
```

**Почему**: JSON Schema запрещает рядом с `$ref` иметь другие keywords. `allOf` — стандартный обход этого ограничения. Это копия поведения `@typespec/openapi3` — гарантирует совместимость с тем же `modelina`.

### Namespace-префикс через `.`

```typespec
namespace MyService;
namespace business_event {
  model TokenIssued { ... }
}
```

→
```yaml
components.schemas:
  business_event.TokenIssued: ...
```

Корневой service-namespace (`MyService`) **не входит** в префикс — он считается "scope" сервиса. Вложенные namespace — входят через `.`.

Это копия поведения `@typespec/openapi3` для имён схем (для operationId openapi3 использует `_`, но у AsyncAPI нет operationId как такового — все ключи в `operations:` объекте).

## Поток обработки

### 1. Декораторы пишут state

При обходе `.tsp`-файлов компилятор вызывает декораторы. Они записывают конфиги в `program.stateMap(<Key>)`:

```
@publish(#{...})  →  AmqpPublishKey.set(operation, config)
@consume(#{...})  →  AmqpConsumeKey.set(operation, config)
@reply(M)         →  WsReplyKey.set(operation, M)
@binary           →  WsBinaryKey.set(operation, true)
@info(#{...})     →  InfoKey.set(namespace, config)
@server(name, ...) →  ServerKey.set(namespace, Map<string, ServerConfig>)
```

### 2. `$onEmit(context)` запускается компилятором после AST-парсинга

`src/amqp/index.ts` (или `src/ws/index.ts`) экспортирует `$onEmit`, который делегирует в `emitAsyncApi(context, "amqp"|"ws")`.

### 3. `emitAsyncApi` собирает документ

```typescript
const doc: AsyncApiDoc = emptyDoc();         // { asyncapi: "3.0.0", info: ... }
buildServiceInfo(context, doc);              // info + servers
new SchemaBuilder(program).collect();        // обход моделей/enums/scalars
                                             // → components.schemas
buildAmqp(program, doc);  // или buildWs     // channels + operations + messages
serialize(doc, opts);                        // → YAML или JSON
host.writeFile(path, text);                  // mkdirp + write
```

### 4. SchemaBuilder обход

```typescript
navigateProgram(program, {
  model: m => this.addModel(m),
  enum: e => this.addEnum(e),
  scalar: s => this.addScalar(s),
});
```

Для каждого типа `addX` фильтрует stdlib (`isInLibraryNs`), конструирует JSON Schema-фрагмент, кладёт в `namedSchemas`. Поля модели рекурсивно обрабатываются через `schemaFor(prop.type)`.

### 5. buildAmqp / buildWs

```typescript
navigateProgram(program, {
  operation(op) {
    const pub = program.stateMap(AmqpPublishKey).get(op);
    const con = program.stateMap(AmqpConsumeKey).get(op);
    if (pub) attachPublish(...);
    else if (con) attachConsume(...);
  },
});
```

`attachPublish` собирает channel + operation + message:

```typescript
doc.channels[channelKey] = {
  address: config.routingKey,
  bindings: { amqp: { is: "routingKey", exchange: cleanExchange(config.exchange) } },
  messages: { [messageKey]: { $ref: ... } },
};
doc.operations[op.name] = {
  action: "send",
  channel: { $ref: ... },
  messages: [{ $ref: ... }],
  summary, description,
};
doc.components.messages[messageKey] = {
  payload: { $ref: `#/components/schemas/${returnTypeName}` },
};
```

`buildWs` устроен похоже, но все операции сворачивает на единый канал `/`, плюс обрабатывает `@reply` и `@binary`.

### 6. Сериализация

`yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })`. `sortKeys: false` сохраняет порядок вставки полей в JS-объекте — поэтому документ читается в логическом порядке (asyncapi → info → servers → channels → operations → components).

## Тестирование

Тесты на `vitest`. Главный харнесс — `test/utils/test-host.ts`:

```typescript
const result = await emit(`...TypeSpec код...`, "amqp" | "ws");
expectNoErrors(result);
expect(result.doc.components.schemas.X).toEqual({...});
```

Под капотом `emit()` использует `createTestHost` + `createTestWrapper` из `@typespec/compiler/testing`. Все имеющиеся `tsp`-фикстуры компилируются в виртуальной FS, эмиттер пишет туда `asyncapi.yaml`, мы его парсим и инспектим.

Snapshot-тесты на нескольких end-to-end фикстурах в `test/fixtures/` (по одному файлу на типичный сценарий: AMQP send+receive, AMQP fanout, WebSocket с дискриминатором, WebSocket с reply и binary) лежат в `test/__snapshots__/fixtures.test.ts.snap` — это контракт регрессии.

## Точки расширения

### Добавить новый AsyncAPI binding (например, Kafka)

1. Создать `src/kafka/` с `decorators.ts` (namespace = "TspAsyncApi.Kafka") и `builder.ts`
2. Добавить `lib/kafka.tsp` с extern dec'ами
3. Импортировать `lib/kafka.tsp` в `lib/main.tsp`
4. Добавить новый emit-таргет: `"./kafka"` в `package.json` exports, `src/kafka/index.ts` с `$onEmit`
5. В `emitAsyncApi` (или общем switch) добавить ветку `if (target === "kafka") buildKafka(...)`
6. Добавить тесты

### Поддержать новый TypeSpec-тип в схемах

В `src/shared/schema-emitter.ts` метод `schemaFor(type)` — это switch по `type.kind`. Добавить ветку и при необходимости — отдельный `addX(...)` для именованных типов.

### Новая диагностика

В `src/shared/lib.ts` секция `diagnostics:` — добавить новый код с `severity`, `messages.default` (с `paramMessage` для интерполяции). Использовать в коде через `reportDiagnostic(program, { code, target, format })`.

## Совместимость

- `@typespec/compiler` ^1.12.0 — API стабилен (1.0+).
- `@typespec/asset-emitter` ^0.79.0 — пока pre-1.0, может ломаться в будущем.
- Тестируется на Node.js 22+ и 24+.

Запас совместимости с TypeSpec API минимальный — мы используем `@typespec/compiler` напрямую (типы `Type`, `Model`, `Enum`, `Scalar`, `Operation`, `Namespace`, `Union`). Если они мигрируют — придётся обновлять. Сейчас в 1.x намерение Microsoft — держать API стабильным.

## Известные ограничения

- **Циклические зависимости в Union** не поддерживаются (валится в `unionSchema`). На практике для наших сервисов не используются.
- **Только `T | null` форма Union**. Прочие union'ы — диагностика `unsupported-union`. Если нужны поли­морфные сообщения в будущем — потребуется реализация `oneOf`/`discriminator`.
- **Реальная FS** — `writeFile` требует чтобы родительская директория существовала (для test-FS она auto-create). Мы делаем `host.mkdirp` перед записью.
- **Версия AsyncAPI** хардкоднута на `3.0.0`. Для 3.1 нужно поменять одну константу в `document.ts` и проверить, что `modelina`/`redocly` принимают.

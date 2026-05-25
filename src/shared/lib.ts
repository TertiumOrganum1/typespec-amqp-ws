import { createTypeSpecLibrary, paramMessage } from "@typespec/compiler";
import { EmitterOptionsSchema, type EmitterOptions } from "./options.js";

export const $lib = createTypeSpecLibrary({
  name: "@etc-utils/typespec-amqp-ws",
  diagnostics: {
    "unsupported-sized-int": {
      severity: "error",
      messages: {
        default: paramMessage`Тип '${"name"}' не поддерживается. Используйте 'integer' — codegen всё равно генерирует signed int32 для всех ширин и игнорирует format. Размер-специфичные типы создают ложное ожидание сохранения семантики.`,
      },
    },
    "unsupported-int64": {
      severity: "error",
      messages: {
        default: `64-битные числа должны передаваться через 'string'. Поясните формат в @doc.`,
      },
    },
    "unsupported-float": {
      severity: "error",
      messages: {
        default: `Числа с плавающей точкой передавайте через 'string' во избежание потерь точности на границе между языками.`,
      },
    },
    "unsupported-fuzzy-numeric": {
      severity: "error",
      messages: {
        default: paramMessage`Тип '${"name"}' неоднозначен для кодогенерации; используйте 'integer'.`,
      },
    },
    "unsupported-temporal": {
      severity: "error",
      messages: {
        default: paramMessage`Тип '${"name"}' не поддерживается. Дата/время — это 'string' в RFC-3339 с пояснением в @doc. Типизированных дат не используем — TypeScript-codegen подставляет Date, что ломает разбор RFC-3339 при разных локалях.`,
      },
    },
    "unsupported-url": {
      severity: "error",
      messages: {
        default: `URL — это 'string'.`,
      },
    },
    "anonymous-model": {
      severity: "error",
      messages: {
        default: paramMessage`Поле '${"field"}' в модели '${"parent"}' использует анонимную inline-модель. Объявите её через 'model ${"suggested"} { ... }' и используйте именованный тип.`,
      },
    },
    "anonymous-return": {
      severity: "error",
      messages: {
        default: paramMessage`Операция '${"op"}' возвращает анонимную inline-модель. Объявите модель отдельно.`,
      },
    },
    "anonymous-param": {
      severity: "error",
      messages: {
        default: paramMessage`Операция '${"op"}' принимает анонимную inline-модель в параметре. Объявите модель отдельно.`,
      },
    },
    "consume-must-return": {
      severity: "error",
      messages: {
        default: paramMessage`Операция '${"op"}' помечена @consume, но не имеет returnType. Принимаемое сообщение объявляется через 'op X(): MessageModel;'.`,
      },
    },
    "publish-must-have-param": {
      severity: "error",
      messages: {
        default: paramMessage`Операция '${"op"}' помечена @publish, но не имеет параметра с payload. Отправляемое сообщение объявляется через 'op X(msg: MessageModel);'. Для @binary параметр не нужен.`,
      },
    },
    "publish-multiple-params": {
      severity: "error",
      messages: {
        default: paramMessage`Операция '${"op"}' помечена @publish и имеет более одного параметра. Допустим ровно один параметр — payload сообщения.`,
      },
    },
    "binary-with-payload": {
      severity: "error",
      messages: {
        default: paramMessage`Операция '${"op"}' помечена @binary — она не должна иметь ни параметра, ни returnType. Бинарное сообщение — это opaque-байты без JSON-payload; формат описывается в @doc.`,
      },
    },
    "non-string-enum": {
      severity: "error",
      messages: {
        default: paramMessage`Enum '${"name"}' содержит non-string значения. Поддерживаются только string-enum.`,
      },
    },
    "invalid-enum-value": {
      severity: "error",
      messages: {
        default: paramMessage`Значение enum '${"value"}' не подходит как идентификатор C++/Go/TS. Допустимый regex: ^[a-zA-Z][a-zA-Z0-9_]*$`,
      },
    },
    "publish-without-exchange": {
      severity: "error",
      messages: {
        default: `@publish требует поле 'exchange' в конфиге.`,
      },
    },
    "consume-without-queue": {
      severity: "error",
      messages: {
        default: `@consume требует поле 'queue' в конфиге.`,
      },
    },
    "unknown-exchange-type": {
      severity: "error",
      messages: {
        default: paramMessage`Неизвестный тип exchange: '${"type"}'. Поддерживаются: direct, fanout.`,
      },
    },
    "missing-doc": {
      severity: "warning",
      messages: {
        default: paramMessage`Модель/enum '${"name"}' не имеет @doc — добавьте описание для читаемости.`,
      },
    },
    "unsupported-union": {
      severity: "error",
      messages: {
        default: `Поддерживаются только union'ы формы 'T | null'. Прочие union'ы не входят в v1.`,
      },
    },
  },
  emitter: {
    options: EmitterOptionsSchema,
  },
});

export const { reportDiagnostic, createDiagnostic, createStateSymbol } = $lib;
export type { EmitterOptions };

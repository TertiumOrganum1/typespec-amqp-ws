import type {
  Program,
  Type,
  Scalar,
  Model,
  Enum,
  Namespace,
  Union,
} from "@typespec/compiler";
import {
  navigateProgram,
  getDoc,
  isArrayModelType,
  isRecordModelType,
} from "@typespec/compiler";

/** Скип stdlib и наших собственных library-моделей (TspAsyncApi.*) */
function isInLibraryNs(t: { namespace?: Namespace }): boolean {
  let ns: Namespace | undefined = t.namespace;
  while (ns) {
    if (ns.name === "TypeSpec") return true;
    if (ns.name === "TspAsyncApi") return true;
    ns = ns.namespace;
  }
  return false;
}

// Сохраняем старое имя для обратной совместимости в коде ниже.
const isInTypeSpecNs = isInLibraryNs;

/**
 * Полное имя типа с префиксом namespace через `.`.
 * Top-level (root service) namespace в префикс не входит.
 * Например, для `namespace T; namespace business_event { model X }` → "business_event.X".
 */
function schemaNameOf(t: { name: string; namespace?: Namespace }): string {
  const parts: string[] = [];
  let ns: Namespace | undefined = t.namespace;
  // Соберём имена всех родительских namespace, кроме самого корневого (его родитель — global).
  while (ns && ns.namespace && ns.namespace.name) {
    if (ns.name) parts.unshift(ns.name);
    ns = ns.namespace;
  }
  return parts.length > 0 ? `${parts.join(".")}.${t.name}` : t.name;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}
import { reportDiagnostic } from "./lib.js";
import type { Schema } from "./document.js";

const ID_REGEX = /^[a-zA-Z][a-zA-Z0-9_]*$/;

const BUILTIN_SCALAR_NAMES = new Set([
  "string",
  "boolean",
  "integer",
  "bytes",
  ...["int8", "int16", "int32", "uint8", "uint16", "uint32"],
  ...["int64", "uint64"],
  ...["float32", "float64", "decimal", "decimal128", "float"],
  ...["safeint", "numeric"],
  ...["utcDateTime", "offsetDateTime", "plainDate", "plainTime", "duration"],
  "url",
]);

const SIZED_INT = new Set(["int8", "int16", "int32", "uint8", "uint16", "uint32"]);
const INT64 = new Set(["int64", "uint64"]);
const FLOAT = new Set(["float32", "float64", "decimal", "decimal128", "float"]);
const FUZZY = new Set(["safeint", "numeric"]);
const TEMPORAL = new Set([
  "utcDateTime",
  "offsetDateTime",
  "plainDate",
  "plainTime",
  "duration",
]);

/**
 * Преобразует TypeSpec-типы в JSON Schema-фрагменты и собирает их в components.schemas.
 */
export class SchemaBuilder {
  private readonly namedSchemas = new Map<string, Schema>();

  constructor(private readonly program: Program) {}

  /** Обход программы и сбор всех именованных типов. */
  collect(): void {
    navigateProgram(this.program, {
      model: (m) => this.addModel(m),
      enum: (e) => this.addEnum(e),
      scalar: (s) => this.addScalar(s),
    });
  }

  /** Возвращает finalized map имён → схем для components.schemas. */
  collectedSchemas(): Record<string, Schema> {
    return Object.fromEntries(this.namedSchemas);
  }

  /** Конвертирует TypeSpec тип в JSON Schema. */
  schemaFor(type: Type): Schema {
    if (type.kind === "Scalar") {
      return this.scalarSchemaForUsage(type);
    }
    if (type.kind === "Enum" && type.name) {
      return { $ref: `#/components/schemas/${schemaNameOf(type)}` };
    }
    if (type.kind === "String") {
      return { type: "string", const: type.value };
    }
    if (type.kind === "Model") {
      // Array<T> и Record<T,V>
      if (isArrayModelType(this.program, type)) {
        const itemType = type.indexer!.value;
        return { type: "array", items: this.schemaFor(itemType) };
      }
      if (isRecordModelType(this.program, type)) {
        const valueType = type.indexer!.value;
        return { type: "object", additionalProperties: this.schemaFor(valueType) };
      }
      if (type.name && !isInTypeSpecNs(type)) {
        return { $ref: `#/components/schemas/${schemaNameOf(type)}` };
      }
    }
    if (type.kind === "Union") {
      return this.unionSchema(type);
    }
    // Заглушка
    return { type: "string" };
  }

  /** Поддерживаем только T | null. Прочие union'ы — ошибка. */
  private unionSchema(u: Union): Schema {
    const variants = [...u.variants.values()];
    let hasNull = false;
    const nonNull: typeof variants = [];
    for (const v of variants) {
      const t = v.type;
      if (t.kind === "Intrinsic" && t.name === "null") {
        hasNull = true;
      } else {
        nonNull.push(v);
      }
    }

    if (!hasNull || nonNull.length !== 1) {
      reportDiagnostic(this.program, {
        code: "unsupported-union",
        target: u,
        format: {},
      });
      return { type: "string" };
    }

    const base = this.schemaFor(nonNull[0]!.type);
    if (!("type" in base) || typeof base.type !== "string") {
      // Nullable $ref пока не поддерживаем — JSON Schema требует unwrap'нутый base.
      reportDiagnostic(this.program, {
        code: "unsupported-union",
        target: u,
        format: {},
      });
      return { type: "string" };
    }
    const t = base.type as "string" | "boolean" | "integer";
    return { type: [t, "null"] } as Schema;
  }

  /** Скаляр в позиции использования: builtin → inline, custom → $ref. */
  private scalarSchemaForUsage(s: Scalar): Schema {
    if (this.isCustomScalar(s)) {
      return { $ref: `#/components/schemas/${schemaNameOf(s)}` };
    }
    return this.scalarSchema(s);
  }

  private isCustomScalar(s: Scalar): boolean {
    // Любой скаляр из стандартной библиотеки (TypeSpec.* — любая глубина вложенности) — НЕ custom.
    if (isInTypeSpecNs(s)) return false;
    return true;
  }

  private addModel(m: Model): void {
    if (!m.name) return;
    if (isInTypeSpecNs(m)) return;
    if (isArrayModelType(this.program, m)) return;
    if (isRecordModelType(this.program, m)) return;
    const key = schemaNameOf(m);
    if (this.namedSchemas.has(key)) return;

    const properties: Record<string, Schema> = {};
    const required: string[] = [];

    for (const [propName, prop] of m.properties) {
      // Запрет на анонимные inline-модели в полях.
      if (
        prop.type.kind === "Model" &&
        !prop.type.name &&
        !isArrayModelType(this.program, prop.type) &&
        !isRecordModelType(this.program, prop.type)
      ) {
        reportDiagnostic(this.program, {
          code: "anonymous-model",
          target: prop,
          format: {
            field: propName,
            parent: m.name,
            suggested: `${capitalize(m.name)}${capitalize(propName)}`,
          },
        });
        continue;
      }
      const baseSchema = this.schemaFor(prop.type);
      const propDoc = getDoc(this.program, prop);
      properties[propName] = this.attachDescription(baseSchema, propDoc);
      if (!prop.optional) required.push(propName);
    }

    const description = getDoc(this.program, m);
    const schema: Schema = {
      type: "object",
      properties,
      ...(required.length > 0 ? { required } : {}),
      additionalProperties: false,
      ...(description ? { description } : {}),
    };
    this.namedSchemas.set(key, schema);
  }

  /**
   * Прикрепляет description к field-схеме.
   * Если схема — $ref, оборачивает в allOf (JSON Schema запрещает соседство $ref с другими полями).
   * Иначе — добавляет description inline.
   */
  private attachDescription(schema: Schema, doc: string | undefined): Schema {
    if (!doc) return schema;
    if ("$ref" in schema) {
      return { allOf: [schema], description: doc };
    }
    return { ...schema, description: doc } as Schema;
  }

  private addScalar(s: Scalar): void {
    if (!this.isCustomScalar(s)) return;
    const key = schemaNameOf(s);
    if (this.namedSchemas.has(key)) return;

    // Прокатиться по цепочке extends до builtin'а.
    const base = this.rootBaseScalar(s);
    if (!base) return;

    const baseSchema = this.scalarSchema(base);
    const description = getDoc(this.program, s);
    if ("$ref" in baseSchema) return; // не должно случиться, но защитимся

    // Сплющиваем: schema = { ...baseSchema, description? }
    const schema: Schema = description
      ? ({ ...baseSchema, description } as Schema)
      : (baseSchema as Schema);
    this.namedSchemas.set(key, schema);
  }

  private rootBaseScalar(s: Scalar): Scalar | undefined {
    let current: Scalar | undefined = s;
    while (current && this.isCustomScalar(current)) {
      current = current.baseScalar;
    }
    return current;
  }

  private addEnum(e: Enum): void {
    if (!e.name) return;
    if (isInTypeSpecNs(e)) return;
    const key = schemaNameOf(e);
    if (this.namedSchemas.has(key)) return;

    const values: string[] = [];
    let hasError = false;

    for (const [memberName, member] of e.members) {
      // member.value undefined → используем имя, иначе значение должно быть строкой
      if (member.value !== undefined && typeof member.value !== "string") {
        reportDiagnostic(this.program, {
          code: "non-string-enum",
          target: e,
          format: { name: e.name },
        });
        hasError = true;
        break;
      }
      const v = (member.value as string | undefined) ?? memberName;
      if (!ID_REGEX.test(v)) {
        reportDiagnostic(this.program, {
          code: "invalid-enum-value",
          target: member,
          format: { value: v },
        });
        hasError = true;
      }
      values.push(v);
    }
    if (hasError) return;

    const description = getDoc(this.program, e);
    const schema: Schema = {
      type: "string",
      enum: values,
      ...(description ? { description } : {}),
    };
    this.namedSchemas.set(key, schema);
  }

  private scalarSchema(s: Scalar): Schema {
    switch (s.name) {
      case "string":
        return { type: "string" };
      case "boolean":
        return { type: "boolean" };
      case "integer":
        return { type: "integer" };
      case "bytes":
        return { type: "string", format: "binary" };
      default:
        this.reportForbidden(s);
        return { type: "string" }; // fallback, чтобы компиляция не падала каскадно
    }
  }

  private reportForbidden(s: Scalar): void {
    if (s.namespace?.name !== "TypeSpec") return; // пользовательские скаляры — Task 9
    if (SIZED_INT.has(s.name)) {
      reportDiagnostic(this.program, {
        code: "unsupported-sized-int",
        target: s,
        format: { name: s.name },
      });
    } else if (INT64.has(s.name)) {
      reportDiagnostic(this.program, {
        code: "unsupported-int64",
        target: s,
        format: {},
      });
    } else if (FLOAT.has(s.name)) {
      reportDiagnostic(this.program, {
        code: "unsupported-float",
        target: s,
        format: {},
      });
    } else if (FUZZY.has(s.name)) {
      reportDiagnostic(this.program, {
        code: "unsupported-fuzzy-numeric",
        target: s,
        format: { name: s.name },
      });
    } else if (TEMPORAL.has(s.name)) {
      reportDiagnostic(this.program, {
        code: "unsupported-temporal",
        target: s,
        format: { name: s.name },
      });
    } else if (s.name === "url") {
      reportDiagnostic(this.program, {
        code: "unsupported-url",
        target: s,
        format: {},
      });
    }
  }
}

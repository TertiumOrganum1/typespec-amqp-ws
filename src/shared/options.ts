import type { JSONSchemaType } from "@typespec/compiler";

export interface EmitterOptions {
  "file-type"?: "yaml" | "json";
  "output-file"?: string;
  "new-line"?: "lf" | "crlf";
  /** Имя файла OpenAPI 3.0-витрины рядом с основным выводом. Не задано — витрина не пишется. */
  "openapi-output-file"?: string;
  /** Имя файла Markdown-витрины рядом с основным выводом. Не задано — витрина не пишется. */
  "markdown-output-file"?: string;
}

export const EmitterOptionsSchema: JSONSchemaType<EmitterOptions> = {
  type: "object",
  additionalProperties: false,
  properties: {
    "file-type": {
      type: "string",
      enum: ["yaml", "json"],
      nullable: true,
      default: "yaml",
    },
    "output-file": {
      type: "string",
      nullable: true,
      default: "asyncapi.yaml",
    },
    "new-line": {
      type: "string",
      enum: ["lf", "crlf"],
      nullable: true,
      default: "lf",
    },
    "openapi-output-file": {
      type: "string",
      nullable: true,
    },
    "markdown-output-file": {
      type: "string",
      nullable: true,
    },
  },
  required: [],
};

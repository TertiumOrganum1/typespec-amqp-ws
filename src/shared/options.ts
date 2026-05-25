import type { JSONSchemaType } from "@typespec/compiler";

export interface EmitterOptions {
  "file-type"?: "yaml" | "json";
  "output-file"?: string;
  "new-line"?: "lf" | "crlf";
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
  },
  required: [],
};

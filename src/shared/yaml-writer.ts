import * as yaml from "js-yaml";
import type { AsyncApiDoc } from "./document.js";
import type { OpenApiDoc } from "./openapi-view.js";

export interface SerializeOptions {
  fileType: "yaml" | "json";
  newLine: "lf" | "crlf";
}

export function serialize(doc: AsyncApiDoc | OpenApiDoc, opts: SerializeOptions): string {
  const text =
    opts.fileType === "yaml"
      ? yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
      : JSON.stringify(doc, null, 2);
  return applyNewLine(text, opts.newLine);
}

export function applyNewLine(text: string, newLine: SerializeOptions["newLine"]): string {
  return newLine === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}

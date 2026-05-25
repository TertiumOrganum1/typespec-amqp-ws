import * as yaml from "js-yaml";
import type { AsyncApiDoc } from "./document.js";

export interface SerializeOptions {
  fileType: "yaml" | "json";
  newLine: "lf" | "crlf";
}

export function serialize(doc: AsyncApiDoc, opts: SerializeOptions): string {
  const text =
    opts.fileType === "yaml"
      ? yaml.dump(doc, { lineWidth: 120, noRefs: true, sortKeys: false })
      : JSON.stringify(doc, null, 2);
  return opts.newLine === "crlf" ? text.replace(/\n/g, "\r\n") : text;
}

import type { EmitContext } from "@typespec/compiler";
import { $lib, type EmitterOptions } from "../shared/lib.js";
import { emitAsyncApi } from "../shared/asyncapi-emitter.js";

export { $lib };

export async function $onEmit(context: EmitContext<EmitterOptions>): Promise<void> {
  await emitAsyncApi(context, "ws");
}

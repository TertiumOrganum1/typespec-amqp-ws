import { createTestLibrary, findTestPackageRoot } from "@typespec/compiler/testing";

export const TypeSpecAmqpWsTestLibrary = createTestLibrary({
  name: "@etc-utils/typespec-amqp-ws",
  packageRoot: await findTestPackageRoot(import.meta.url),
});

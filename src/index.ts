// Корневая точка пакета. Регистрирует $lib (общая на оба emit-таргета).
// Декораторы JS реализованы в отдельных модулях (./shared/decorators-service.ts, ./amqp/decorators.ts, ./ws/decorators.ts),
// чтобы у каждого было своё `export const namespace = "..."` для TypeSpec-связки.

export { $lib } from "./shared/lib.js";
export type { EmitterOptions } from "./shared/lib.js";

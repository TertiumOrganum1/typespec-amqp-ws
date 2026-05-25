import "../dist/src/index.js";
import "../dist/src/shared/decorators-service.js";

import "./amqp.tsp";
import "./ws.tsp";

using TypeSpec.Reflection;

namespace TspAsyncApi;

@doc("Контактные данные владельца API")
model ContactInfo {
  name?: string;
  url?: string;
  email?: string;
}

@doc("Лицензия API")
model LicenseInfo {
  name: string;
  url?: string;
}

@doc("Ссылка на внешнюю документацию")
model ExternalDocs {
  url: string;
  description?: string;
}

@doc("Блок info AsyncAPI документа")
model InfoConfig {
  version: string;
  description?: string;
  contact?: ContactInfo;
  license?: LicenseInfo;
  externalDocs?: ExternalDocs;
}

@doc("Переменная в шаблоне URL сервера (например, {port})")
model ServerVariable {
  `default`?: string;
  description?: string;
  `enum`?: string[];
}

@doc("Описание сервера (брокера). Соответствует одному ключу в servers AsyncAPI")
model ServerConfig {
  host: string;
  protocol: string;
  pathname?: string;
  description?: string;
  variables?: Record<ServerVariable>;
}

/**
 * Заполняет блок info AsyncAPI документа.
 * Применяется к корневому namespace сервиса (тому же, к которому @service).
 */
extern dec info(target: Namespace, options: valueof InfoConfig);

/**
 * Добавляет одну запись в блок servers AsyncAPI документа.
 * Можно вызывать многократно для нескольких серверов.
 */
extern dec server(target: Namespace, name: valueof string, options: valueof ServerConfig);

import "typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.WebSocket;

@service(#{ title: "Auth WS" })
@info(#{ version: "1.0.0" })
@server("public", #{ host: "localhost:8080", protocol: "ws", pathname: "/ws" })
namespace Auth;

model LoginRequestPayload { username: string; password: string; }
model LoginResponsePayload { ok: boolean; token?: string; }

model LoginRequest {
  eventType: "loginRequest";
  msgUid: string;
  payload: LoginRequestPayload;
}

model LoginResponse {
  eventType: "loginResponse";
  msgUid: string;
  payload: LoginResponsePayload;
}

@publish
@reply(LoginResponse)
@summary("Запрос на аутентификацию")
op login(): LoginRequest;

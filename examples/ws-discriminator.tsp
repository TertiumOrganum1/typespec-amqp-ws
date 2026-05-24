import "typespec-amqp-ws";

using TspAsyncApi;
using TspAsyncApi.WebSocket;

@service(#{ title: "Chat WS" })
@info(#{ version: "1.0.0" })
@server("public", #{ host: "localhost:8080", protocol: "ws", pathname: "/ws" })
namespace Chat;

model UserJoinedPayload { userId: string; nickname: string; }
model MessagePayload { from: string; text: string; }

// Дискриминатор через literal-тип — никаких специальных декораторов.
model UserJoined {
  eventType: "userJoined";
  payload: UserJoinedPayload;
}

model NewMessage {
  eventType: "newMessage";
  payload: MessagePayload;
}

@consume op userJoined(): UserJoined;
@consume op newMessage(): NewMessage;

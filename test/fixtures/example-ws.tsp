// Generic WebSocket fixture for end-to-end testing.
// Exercises: @publish, @consume, @reply, @binary, literal-type discriminator,
// single default channel "/", server variables.

@service(#{ title: "Example WebSocket Service" })
@info(#{
  version: "2.3.4",
  description: "End-to-end test fixture covering WebSocket emitter features.",
  externalDocs: #{ url: "https://example.com/docs" },
})
@server("public", #{
  host: "localhost:{port}",
  protocol: "ws",
  pathname: "/v1/ws",
  variables: #{
    port: #{ `default`: "8080", description: "WebSocket port" },
  },
})
namespace ExampleWs;

// ────────── Models ──────────

model PingPayload {
  ts: string;
}

model PongPayload {
  ts: string;
}

model EchoRequestPayload {
  text: string;
}

model EchoResponsePayload {
  text: string;
}

model UpdateAvailablePayload {
  version: string;
  url: string;
}

// Discriminator pattern: each message has eventType: "literal".
// Emitter outputs { type: "string", const: "..." } in JSON Schema.

@doc("Server sends a periodic ping; client should reply with Pong")
model Ping {
  eventType: "ping";
  msgUid: string;
  payload: PingPayload;
}

@doc("Client responds to Ping")
model Pong {
  eventType: "pong";
  msgUid: string;
  payload: PongPayload;
}

@doc("Client asks server to echo a message")
model EchoRequest {
  eventType: "echoRequest";
  msgUid: string;
  payload: EchoRequestPayload;
}

@doc("Server reply with the echoed text")
model EchoResponse {
  eventType: "echoResponse";
  msgUid: string;
  payload: EchoResponsePayload;
}

@doc("Server pushes notification that an update is available")
model UpdateAvailable {
  eventType: "updateAvailable";
  msgUid: string;
  payload: UpdateAvailablePayload;
}

@doc("Binary update payload — opaque bytes")
model UpdateBinary {
  data: bytes;
}

// ────────── Operations ──────────

@consume
@summary("receive a ping from the server")
op receivePing(): Ping;

@publish
@summary("send a pong in response to a ping")
op sendPong(): Pong;

@publish
@reply(EchoResponse)
@summary("ask server to echo a message and wait for the response")
op echo(): EchoRequest;

@consume
@summary("notification that an update is available")
op updateAvailable(): UpdateAvailable;

@publish
@binary
@summary("upload the binary update blob")
op uploadUpdate(): UpdateBinary;

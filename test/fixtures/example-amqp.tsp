// Generic AMQP fixture for end-to-end testing.
// Exercises: @publish (direct + fanout), @consume (queue), models, enums,
// scalars, arrays, Records, optional fields, channelName override.

@service(#{ title: "Example AMQP Service" })
@info(#{
  version: "1.0.0",
  description: "End-to-end test fixture covering AMQP publish/consume features.",
})
@server("rabbit", #{
  host: "rabbit.example.com:5672",
  pathname: "/example",
  protocol: "amqp",
  description: "Example RabbitMQ broker",
})
namespace ExampleAmqp;

// ────────── Scalars ──────────

@doc("UUID v7 identifier")
scalar Uuid extends string;

@doc("Unix timestamp microseconds as string (to avoid 64-bit precision loss)")
scalar Microseconds extends string;

// ────────── Enums ──────────

@doc("Category of an event")
enum EventCategory {
  Created,
  Updated,
  Deleted,
}

@doc("Priority of a notification")
enum Priority {
  Low,
  Normal,
  High,
}

// ────────── Models ──────────

@doc("Key-value tag attached to events")
model Tag {
  @doc("Tag name")
  name: string;

  @doc("Tag value")
  value: string;
}

@doc("Detailed event payload")
model EventPayload {
  @doc("Free-form text")
  text: string;

  category: EventCategory;

  @doc("Optional priority override")
  priority?: Priority;

  @doc("Arbitrary tags")
  tags: Tag[];

  @doc("Arbitrary extension parameters")
  extra: Record<string>;
}

@doc("Event message sent on the events exchange")
model EventMessage {
  @doc("Unique message identifier")
  uid: Uuid;

  sentAt: Microseconds;

  payload: EventPayload;
}

@doc("Broadcast announcement, sent via fanout")
model AnnouncementMessage {
  @doc("Announcement identifier")
  uid: Uuid;

  @doc("Announcement text")
  message: string;
}

@doc("Acknowledgement command from a consumer back to the producer")
model AckCommand {
  @doc("Identifier of the original message being acknowledged")
  uid: Uuid;

  @doc("Whether the consumer processed the message successfully")
  success: boolean;

  @doc("Optional error description")
  error?: string;
}

// ────────── Operations ──────────

@publish(#{
  channelName: "event-created",
  description: "Channel for individual domain events",
  routingKey: "v1-events-created",
  exchange: #{ name: "events-exchange", type: "direct", durable: true },
})
@summary("publish a new event")
@doc("Publishes a domain event onto the events exchange.")
op publishEvent(message: EventMessage): void;

@publish(#{
  channelName: "announcement-broadcast",
  exchange: #{ name: "announcements-fanout", type: "fanout", durable: true },
})
@summary("broadcast an announcement to all subscribers")
@doc("Fanout exchange — every bound queue receives the message.")
op broadcastAnnouncement(message: AnnouncementMessage): void;

@consume(#{
  channelName: "ack-requests",
  routingKey: "v1-events-ack",
  queue: #{
    name: "ack-requests-queue",
    durable: true,
    autoDelete: false,
  },
})
@summary("consume acknowledgement commands")
@doc("Processes acknowledgement commands from downstream consumers.")
op consumeAck(): AckCommand;
